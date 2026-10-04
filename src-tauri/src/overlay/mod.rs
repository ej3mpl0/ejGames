//! Overlay dentro del juego, sin inyectar nada en el juego: una ventana
//! transparente, siempre encima, que no coge el foco y deja pasar los clics.
//! Se coloca en el monitor de la ventana del juego (no en el de la ventana
//! activa). Funciona en ventana, en ventana sin bordes y en la pantalla completa
//! "optimizada" de Windows 10/11. En una pantalla completa exclusiva de verdad no
//! se ve nada encima: al cerrar el juego sale un resumen de lo desbloqueado.
//!
//! La ventana solo existe mientras se ve algo (avisos o el panel) y se
//! destruye a los pocos segundos, así que no gasta memoria durante la partida.
//!
//! Los avisos imitan a la plataforma del tema activo (Steam, PlayStation,
//! Xbox…): el tema lo declara en su theme.json (`"overlay": {"style": …}`) y el
//! usuario puede forzar otro en Ajustes → Overlay.

pub mod capture;
pub mod fps;
pub mod hotkey;
pub mod live;
#[cfg(windows)]
pub mod win;

use crate::achievements::{self, AchList, NewUnlock};
use crate::db::models::{Game, MediaUrls};
use crate::db::repo;
use crate::launcher::tracker::{self, Target};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";

/// Tamaño de la zona de avisos (px lógicos).
const NOTICE_W: f64 = 480.0;
const NOTICE_H: f64 = 460.0;

pub const STYLES: [&str; 7] = ["steam", "playstation", "xbox", "switch", "cinema", "retro", "ejgames"];

/// Aspecto de los avisos: estilo y, si es el del propio tema, sus colores.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Look {
    pub style: String,
    /// top-left | top-center | top-right | bottom-left | bottom-center | bottom-right
    pub corner: String,
    pub accent: Option<String>,
    pub surface: Option<String>,
    pub text: Option<String>,
    pub radius: Option<String>,
    pub font: Option<String>,
    pub dark: bool,
    /// Paleta del tema Retro (arcade, phosphor…).
    pub palette: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: u64,
    /// "achievement" | "info" | "summary" | "screenshot"
    pub kind: String,
    pub game_id: Option<i64>,
    pub game: Option<String>,
    pub title: String,
    pub body: Option<String>,
    pub icon: Option<String>,
    pub rarity: Option<f64>,
    pub at: i64,
    /// Puntos al estilo Xbox (1000 por juego, repartidos por rareza).
    pub score: Option<i64>,
    /// (conseguidos, total) contando este.
    pub progress: Option<(i64, i64)>,
    /// Se rellena al avisar.
    pub look: Look,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelData {
    pub game_id: i64,
    pub title: String,
    pub started_at: Option<i64>,
    pub media: MediaUrls,
    pub hotkey: Option<String>,
    /// Atajo de las capturas (si está activo en esta partida).
    pub screenshot_hotkey: Option<String>,
    pub achievements: Option<AchList>,
    /// Abierto con el mando: la UI muestra botones de mando.
    pub pad: bool,
    /// Estilo de la plataforma del tema (el mismo que el de los avisos).
    pub look: Look,
    /// Tiempo jugado antes de esta partida (s) y veces que se ha abierto.
    pub playtime: i64,
    pub launch_count: i64,
    pub note: String,
    pub captures: Vec<capture::Capture>,
    /// Carpeta de las capturas del juego.
    pub captures_dir: String,
    /// Datos vivos del último muestreo (el resto llega con `overlay:live`).
    pub live: live::LiveInfo,
    pub developer: Option<String>,
    pub release_year: Option<String>,
    /// Volumen de los sonidos de la interfaz del perfil (0..1).
    pub sounds_volume: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInit {
    pub notices: Vec<Notice>,
    pub panel: Option<PanelData>,
    pub pin: Option<Pin>,
}

/// Mapa anclado encima del juego (sin coger clics ni el foco).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub game_id: i64,
    /// Página de Map Genie.
    pub url: String,
}

struct Live {
    game_id: i64,
    profile_id: i64,
    title: String,
    started_at: i64,
    hotkey: Option<String>,
    screenshot_hotkey: Option<String>,
    target: Target,
    /// Ventana principal del juego (caché).
    game_hwnd: isize,
    /// Algún aviso salió con el juego en pantalla completa exclusiva.
    fs_seen: bool,
    /// Logros avisados en esta partida (para el resumen final).
    unlocked: Vec<Notice>,
    _guard: Option<hotkey::Guard>,
}

#[derive(Default)]
struct Inner {
    /// Avisos esperando a que la ventana cargue.
    pending: Vec<Notice>,
    live: Option<Live>,
    /// La ventana existe o se está creando.
    alive: bool,
    /// La página cargó y escucha eventos.
    ready: bool,
    panel: Option<PanelData>,
    /// Ventana del juego antes de abrir el panel (para devolverle el foco).
    prev_fg: isize,
    gen: u64,
    /// Mapa anclado: la ventana ocupa el monitor del juego y no se destruye.
    pin: Option<Pin>,
}

#[derive(Default)]
pub struct Overlay {
    inner: Mutex<Inner>,
    pub panel_open: AtomicBool,
    next_id: AtomicU64,
    hwnd: AtomicIsize,
    /// Datos vivos del panel (rendimiento, música, volumen…).
    pub sampler: live::Sampler,
}

pub enum PadEvent {
    Home,
    Nav(&'static str),
    /// Batería del mando (None: sin mando).
    Power(Option<live::PadPower>),
}

fn next_id(st: &AppState) -> u64 {
    st.overlay.next_id.fetch_add(1, Ordering::Relaxed) + 1
}

// ───────────────────────────── aspecto ─────────────────────────────

/// Posición natural de cada estilo (donde la pone su plataforma).
fn default_corner(style: &str) -> &'static str {
    match style {
        "playstation" => "top-right",
        "xbox" => "bottom-center",
        "switch" => "top-left",
        "cinema" => "bottom-left",
        "retro" => "top-center",
        _ => "bottom-right",
    }
}

/// Estilo propio de un tema: el de su theme.json o, en los de serie y sus
/// copias ("xbox-custom"), el de la plataforma que imitan.
fn native_style(m: &crate::themes::ThemeManifest) -> Option<&'static str> {
    let declared = m.overlay.get("style").and_then(|v| v.as_str());
    let by_id = match m.id.split(['-', '_']).next().unwrap_or("") {
        "ps5" => "playstation",
        id => id,
    };
    let find = |s: &str| STYLES.iter().find(|x| **x == s).copied();
    declared.and_then(find).or_else(|| find(by_id))
}

/// Estilo y colores de los avisos para el perfil que juega (o el activo).
pub fn look(st: &AppState) -> Look {
    let s = st.settings.get();
    let profile_id = st.overlay.inner.lock().live.as_ref().map(|l| l.profile_id).or(*st.profile.read());
    let profile = profile_id.and_then(|id| st.db.with(|c| repo::get_profile(c, id)).ok());
    let manifest = |id: &str| crate::themes::dir_of(&st.paths, id).and_then(|d| crate::themes::read_manifest(&d).ok());
    let theme = profile.as_ref().and_then(|p| manifest(&p.theme_id)).or_else(|| manifest("steam"));
    let native = theme.as_ref().and_then(native_style);
    let style = STYLES.iter().find(|x| **x == s.overlay_style).copied().or(native).unwrap_or("ejgames");
    let corner = if s.overlay_corner == "auto" || s.overlay_corner.is_empty() { default_corner(style).to_string() } else { s.overlay_corner };
    let mut look = Look { style: style.into(), corner, dark: style != "switch", ..Default::default() };
    let Some(m) = theme else { return look };
    // Ajustes del tema (los de serie + los del perfil).
    let saved = profile.as_ref().and_then(|p| p.theme_settings.get(&m.id)).cloned().unwrap_or_default();
    let setting = |k: &str| {
        saved.get(k).cloned().filter(|v| !v.is_null()).or_else(|| {
            m.settings.iter().find(|d| d.get("key").and_then(|x| x.as_str()) == Some(k)).and_then(|d| d.get("default").cloned())
        })
    };
    let text = |v: Option<serde_json::Value>| v.and_then(|v| v.as_str().map(String::from)).filter(|v| !v.trim().is_empty());
    let host = |k: &str| text(m.host.get(k).cloned());
    if style == "ejgames" {
        look.accent = host("accent");
        look.surface = host("surface");
        look.text = host("text");
        look.radius = host("radius");
        look.font = host("font");
        look.dark = m.host.get("dark").and_then(|v| v.as_bool()) != Some(false);
    } else if native == Some(style) {
        // Los colores del tema solo en su propio estilo: un aviso de Xbox con
        // el azul del tema Steam ya no parecería de Xbox.
        look.accent = text(setting("accent")).or_else(|| host("accent"));
        if let Some(d) = setting("dark").and_then(|v| v.as_bool()) {
            look.dark = d;
        }
        look.palette = text(setting("palette"));
    }
    look
}

// ───────────────────────────── ventana ─────────────────────────────

/// Rectángulo en px físicos + escala del monitor.
#[derive(Debug, Clone, Copy)]
struct Geo {
    rect: (i32, i32, i32, i32),
    scale: f64,
}

/// Ventana principal del juego en marcha (la visible más grande de sus procesos).
#[cfg(windows)]
fn game_window(st: &AppState) -> Option<isize> {
    let target = {
        let g = st.overlay.inner.lock();
        let live = g.live.as_ref()?;
        if win::is_visible(live.game_hwnd) {
            return Some(live.game_hwnd);
        }
        live.target.clone()
    };
    let found = win::find_window(&|pid| tracker::matches_pid(&target, pid))?;
    if let Some(live) = st.overlay.inner.lock().live.as_mut() {
        live.game_hwnd = found;
    }
    Some(found)
}

#[cfg(windows)]
fn geometry(st: &AppState, panel: bool) -> Geo {
    let prev = st.overlay.inner.lock().prev_fg;
    let reference = game_window(st)
        .or_else(|| (panel && win::is_window(prev)).then_some(prev))
        .unwrap_or_else(win::foreground);
    let m = win::monitor_of(reference).unwrap_or(win::Monitor { full: (0, 0, 1920, 1080), work: (0, 0, 1920, 1040), scale: 1.0 });
    if panel {
        return Geo { rect: m.full, scale: m.scale };
    }
    // Con el juego a pantalla completa no hay barra de tareas: los avisos van
    // pegados al borde, como en las consolas.
    let (x, y, w, h) = if win::covers(reference, m.full) { m.full } else { m.work };
    let nw = ((NOTICE_W * m.scale) as i32).min(w);
    let nh = ((NOTICE_H * m.scale) as i32).min(h);
    let corner = look(st).corner;
    let px = if corner.ends_with("left") {
        x
    } else if corner.ends_with("center") {
        x + (w - nw) / 2
    } else {
        x + w - nw
    };
    let py = if corner.starts_with("top") { y } else { y + h - nh };
    Geo { rect: (px, py, nw, nh), scale: m.scale }
}

#[cfg(not(windows))]
fn geometry(_st: &AppState, _panel: bool) -> Geo {
    Geo { rect: (0, 0, NOTICE_W as i32, NOTICE_H as i32), scale: 1.0 }
}

/// Mueve y redimensiona en una sola operación (px físicos), siempre encima.
fn place(w: &tauri::WebviewWindow, geo: Geo) {
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        win::set_rect(h.0 as isize, geo.rect);
    }
    #[cfg(not(windows))]
    {
        let (x, y, cw, ch) = geo.rect;
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
        let _ = w.set_size(tauri::PhysicalSize::new(cw as u32, ch as u32));
    }
}

/// Ventana a pantalla completa del juego: con el panel o con un mapa anclado.
fn full(st: &AppState, panel: bool) -> bool {
    panel || st.overlay.inner.lock().pin.is_some()
}

fn apply_mode(st: &AppState, w: &tauri::WebviewWindow, panel: bool) {
    let geo = geometry(st, full(st, panel));
    let _ = w.set_ignore_cursor_events(!panel);
    let _ = w.set_focusable(panel);
    place(w, geo);
    if panel {
        let _ = w.set_focus();
    }
}

/// Crea la ventana si hace falta o la coloca para el modo actual.
fn ensure_window(st: &Arc<AppState>) {
    let panel = st.overlay.panel_open.load(Ordering::Relaxed);
    {
        let mut g = st.overlay.inner.lock();
        g.gen += 1;
        if g.alive {
            drop(g);
            if let Some(w) = st.app.get_webview_window(LABEL) {
                apply_mode(st, &w, panel);
            }
            return;
        }
        g.alive = true;
        g.ready = false;
    }
    let st = st.clone();
    // Siempre desde una tarea async: crear ventanas desde según qué hilo bloquea.
    tauri::async_runtime::spawn(async move {
        for _ in 0..50 {
            if st.app.get_webview_window(LABEL).is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let panel = st.overlay.panel_open.load(Ordering::Relaxed);
        let geo = geometry(&st, full(&st, panel));
        tracing::info!("overlay: creando ventana en {:?} (escala {}), panel: {panel}", geo.rect, geo.scale);
        let (x, y, cw, ch) = geo.rect;
        let sc = geo.scale.max(0.5);
        let mut builder = WebviewWindowBuilder::new(&st.app, LABEL, WebviewUrl::App("index.html#overlay".into()));
        if let Some(dir) = crate::paths::webview_dir() {
            builder = builder.data_directory(dir);
        }
        let built = builder
            .title("ejGames overlay")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(panel)
            .visible(false)
            // Ya en su monitor: así no cambia de DPI al colocarla.
            .position(x as f64 / sc, y as f64 / sc)
            .inner_size(cw as f64 / sc, ch as f64 / sc)
            .background_color(tauri::window::Color(0, 0, 0, 0))
            .initialization_script(crate::lifecycle::FREEZE_OURS)
            .build();
        match built {
            Ok(w) => {
                let _ = w.set_ignore_cursor_events(!panel);
                // Primera vez visible con MARKER_DONT_FOCUS: SW_SHOWNOACTIVATE.
                let _ = w.show();
                #[cfg(windows)]
                if let Ok(h) = w.hwnd() {
                    st.overlay.hwnd.store(h.0 as isize, Ordering::Relaxed);
                }
                place(&w, geo);
                if panel {
                    let _ = w.set_focus();
                }
                // Por si Windows la reajustó al mostrarla (DPI por monitor).
                tokio::time::sleep(Duration::from_millis(250)).await;
                let panel = st.overlay.panel_open.load(Ordering::Relaxed);
                place(&w, geometry(&st, full(&st, panel)));
            }
            Err(e) => {
                tracing::warn!("overlay: {e}");
                let pending = {
                    let mut g = st.overlay.inner.lock();
                    g.alive = false;
                    std::mem::take(&mut g.pending)
                };
                for n in pending {
                    fallback_toast(&st, &n);
                }
            }
        }
    });
}

fn schedule_destroy(st: &Arc<AppState>) {
    let gen = st.overlay.inner.lock().gen;
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(4)).await;
        {
            let mut g = st.overlay.inner.lock();
            if g.gen != gen || !g.alive || g.panel.is_some() || g.pin.is_some() || !g.pending.is_empty() {
                return;
            }
            g.alive = false;
            g.ready = false;
        }
        st.overlay.hwnd.store(0, Ordering::Relaxed);
        if let Some(w) = st.app.get_webview_window(LABEL) {
            let _ = w.destroy();
        }
        // En modo ahorro, volver a dejar el proceso en lo mínimo.
        if st.saver_active.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_secs(2)).await;
            crate::lifecycle::trim_memory();
        }
    });
}

fn fallback_toast(st: &AppState, n: &Notice) {
    let msg = match n.kind.as_str() {
        "achievement" => format!("🏆 Logro desbloqueado: {}", n.title),
        "screenshot" => format!("📷 {}", n.title),
        _ => n.title.clone(),
    };
    crate::events::toast(st, "ok", msg);
}

// ───────────────────────────── avisos ─────────────────────────────

pub fn notify(st: &Arc<AppState>, mut n: Notice) {
    let s = st.settings.get();
    n.look = look(st);
    if !s.overlay_enabled {
        #[cfg(windows)]
        if n.kind == "achievement" && s.overlay_sound {
            win::play_chime(&n.look.style, n.rarity.map(|r| r < 10.0).unwrap_or(false));
        }
        fallback_toast(st, &n);
        return;
    }
    // El sonido lo pide la página al enseñar el aviso (a la vez que la animación).
    let deliver_now = {
        let mut g = st.overlay.inner.lock();
        if let Some(live) = g.live.as_mut() {
            // En pantalla completa exclusiva quizá no se vea: resumen al terminar.
            #[cfg(windows)]
            if win::exclusive_fullscreen() {
                live.fs_seen = true;
            }
            if n.kind == "achievement" && n.game_id == Some(live.game_id) {
                live.unlocked.push(n.clone());
            }
        }
        if g.ready && g.alive {
            true
        } else {
            g.pending.push(n.clone());
            false
        }
    };
    if deliver_now {
        let _ = st.app.emit_to(LABEL, "overlay:notice", &n);
    }
    ensure_window(st);
}

/// Al cerrar el juego: si hubo pantalla completa exclusiva, resumen de los
/// logros de la partida (puede que no se vieran encima del juego).
fn session_summary(st: &Arc<AppState>, live: Live) {
    if !live.fs_seen || live.unlocked.is_empty() {
        return;
    }
    let n = live.unlocked.len();
    let first = &live.unlocked[0];
    notify(
        st,
        Notice {
            id: next_id(st),
            kind: if n == 1 { "achievement".into() } else { "summary".into() },
            game_id: Some(live.game_id),
            game: Some(live.title.clone()),
            title: if n == 1 { first.title.clone() } else { format!("{n} logros desbloqueados") },
            body: if n == 1 {
                first.body.clone()
            } else {
                Some(live.unlocked.iter().map(|x| x.title.as_str()).take(5).collect::<Vec<_>>().join(" · "))
            },
            icon: first.icon.clone(),
            rarity: if n == 1 { first.rarity } else { None },
            at: crate::util::now(),
            score: if n == 1 { first.score } else { Some(live.unlocked.iter().filter_map(|x| x.score).sum()) },
            progress: st.db.with(|c| achievements::summary(c, live.game_id)).ok().flatten().map(|s| (s.unlocked, s.total)),
            look: Look::default(),
        },
    );
}

/// Sonido del aviso, cuando la página lo enseña.
pub fn chime(st: &AppState, rare: bool) {
    if !st.settings.get().overlay_sound {
        return;
    }
    #[cfg(windows)]
    win::play_chime(&look(st).style, rare);
    let _ = rare;
}

/// Aviso de logro nuevo (con su icono ya en caché para que salga al instante).
pub fn notify_achievement(st: &Arc<AppState>, game_id: i64, u: &NewUnlock) {
    let def = st.db.with(|c| achievements::def_of(c, game_id, &u.api_name)).ok().flatten();
    let score = st.db.with(|c| achievements::score(c, game_id, &u.api_name)).ok().flatten();
    let progress = st.db.with(|c| achievements::summary(c, game_id)).ok().flatten().map(|s| (s.unlocked, s.total));
    let game = st.db.with(|c| repo::get_game(c, game_id)).ok().map(|g| g.title);
    let (appid, name, body, icon_file, rarity) = match def {
        Some((appid, d)) => (appid, d.name, d.description, d.icon, d.global_pct),
        None => (None, achievements::pretty_name(&u.api_name), None, None, None),
    };
    if let (Some(a), Some(f)) = (appid, icon_file.as_deref()) {
        if achievements::valid_icon_name(f) {
            let url = achievements::icon_remote(a, f);
            let st2 = st.clone();
            let _ = tauri::async_runtime::block_on(async move {
                tokio::time::timeout(Duration::from_secs(3), crate::media::download::cached_remote(&st2, &url)).await
            });
        }
    }
    notify(
        st,
        Notice {
            id: next_id(st),
            kind: "achievement".into(),
            game_id: Some(game_id),
            game,
            title: name,
            body,
            icon: achievements::icon_url(appid, icon_file.as_deref()),
            rarity,
            at: u.unlocked_at,
            score,
            progress,
            look: Look::default(),
        },
    );
    // Con el panel abierto, que el contador y la lista se pongan al día.
    if st.overlay.panel_open.load(Ordering::Relaxed) {
        refresh_panel(st);
    }
}

fn refresh_panel(st: &Arc<AppState>) {
    // Fuera del cerrojo: look() también lo toma.
    let lk = look(st);
    let data = {
        let mut g = st.overlay.inner.lock();
        let pad = g.panel.as_ref().map(|p| p.pad).unwrap_or(false);
        let Some(live) = g.live.as_ref() else { return };
        let d = panel_data(st, live, pad, lk);
        g.panel = Some(d.clone());
        d
    };
    let _ = st.app.emit_to(LABEL, "overlay:panel", &Some(data));
}

/// Aviso de prueba (Ajustes → Overlay).
pub fn test(st: &Arc<AppState>) {
    // El último logro desbloqueado, si hay; si no, uno de ejemplo.
    let last: Option<(i64, String, i64)> = st
        .db
        .with(|c| {
            use rusqlite::OptionalExtension;
            c.query_row("SELECT game_id, api_name, unlocked_at FROM achievement_unlocks ORDER BY unlocked_at DESC LIMIT 1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()
        })
        .ok()
        .flatten();
    if let Some((gid, api, t)) = last {
        notify_achievement(st, gid, &NewUnlock { api_name: api, unlocked_at: t });
        return;
    }
    notify(
        st,
        Notice {
            id: next_id(st),
            kind: "achievement".into(),
            game_id: None,
            game: Some("ejGames".into()),
            title: "¡Primer logro!".into(),
            body: Some("Así se verán tus logros durante la partida.".into()),
            icon: None,
            rarity: Some(12.5),
            at: crate::util::now(),
            score: Some(30),
            progress: Some((1, 12)),
            look: Look::default(),
        },
    );
}

// ───────────────────────────── página del overlay ─────────────────────────────

pub fn on_ready(st: &Arc<AppState>) -> OverlayInit {
    let mut g = st.overlay.inner.lock();
    g.ready = true;
    g.gen += 1;
    OverlayInit { notices: std::mem::take(&mut g.pending), panel: g.panel.clone(), pin: g.pin.clone() }
}

/// La página no enseña nada: destruir la ventana en unos segundos.
pub fn on_idle(st: &Arc<AppState>) {
    if st.overlay.panel_open.load(Ordering::Relaxed) || st.overlay.inner.lock().pin.is_some() {
        return;
    }
    schedule_destroy(st);
}

// ───────────────────────────── mapa anclado ─────────────────────────────

/// Ancla un mapa de Map Genie encima del juego (y cierra el panel devolviendo
/// el foco al juego) o lo quita (`None`).
pub fn pin_map(st: &Arc<AppState>, url: Option<String>) -> anyhow::Result<()> {
    let pin = match url {
        Some(u) => {
            let ok = url::Url::parse(&u).map(|x| x.scheme() == "https" && x.host_str() == Some("mapgenie.io")).unwrap_or(false);
            if !ok {
                anyhow::bail!("Solo mapas de Map Genie");
            }
            let game_id = st.overlay.inner.lock().live.as_ref().map(|l| l.game_id).ok_or_else(|| anyhow::anyhow!("No hay ningún juego en marcha"))?;
            Some(Pin { game_id, url: u })
        }
        None => None,
    };
    let pinning = pin.is_some();
    let was_pinned = {
        let mut g = st.overlay.inner.lock();
        if !pinning && g.pin.is_none() {
            return Ok(());
        }
        std::mem::replace(&mut g.pin, pin.clone()).is_some()
    };
    let _ = st.app.emit_to(LABEL, "overlay:pin", &pin);
    // Anclar cierra el panel; cambiar de mapa ya anclado, no.
    if pinning && !was_pinned && st.overlay.panel_open.load(Ordering::Relaxed) {
        // close_panel recoloca la ventana en modo anclado.
        close_panel(st, true);
    } else if let Some(w) = st.app.get_webview_window(LABEL) {
        apply_mode(st, &w, st.overlay.panel_open.load(Ordering::Relaxed));
    }
    if pinning {
        ensure_window(st);
    }
    Ok(())
}


// ───────────────────────────── panel ─────────────────────────────

/// Se llama con `inner` bloqueado: nada de aquí puede volver a tomarlo (por eso
/// el aspecto llega hecho).
fn panel_data(st: &AppState, live: &Live, pad: bool, look: Look) -> PanelData {
    let game = st.db.with(|c| repo::lib_game(c, live.profile_id, live.game_id)).ok();
    let achievements = st.db.with(|c| achievements::list(c, live.game_id)).ok().filter(|l| l.total > 0);
    PanelData {
        game_id: live.game_id,
        title: live.title.clone(),
        started_at: Some(live.started_at),
        hotkey: live.hotkey.clone(),
        screenshot_hotkey: live.screenshot_hotkey.clone(),
        achievements,
        pad,
        look,
        // La partida en curso aún no está sumada.
        playtime: game.as_ref().map(|g| g.playtime).unwrap_or(0),
        launch_count: game.as_ref().map(|g| g.launch_count).unwrap_or(0),
        note: get_note(st, live.profile_id, live.game_id),
        captures: capture::list(st, live.game_id, 24),
        captures_dir: capture::game_folder(st, &live.title).to_string_lossy().into_owned(),
        live: st.overlay.sampler.last.lock().clone(),
        developer: game.as_ref().and_then(|g| g.developer.clone()),
        release_year: game.as_ref().and_then(|g| g.release_date.as_deref().map(|d| d.chars().take(4).collect())),
        media: game.map(|g| g.media).unwrap_or_default(),
        sounds_volume: st.db.with(|c| repo::get_profile(c, live.profile_id)).map(|p| p.sounds_volume).unwrap_or(0.6),
    }
}

pub fn open_panel(st: &Arc<AppState>, pad: bool) {
    if !st.settings.get().overlay_enabled {
        crate::lifecycle::show_main(st);
        return;
    }
    #[cfg(windows)]
    let game = game_window(st);
    let lk = look(st);
    let data = {
        let mut g = st.overlay.inner.lock();
        let Some(live) = g.live.as_ref() else { return };
        let data = panel_data(st, live, pad, lk);
        #[cfg(windows)]
        {
            let fg = win::foreground();
            let overlay = st.overlay.hwnd.load(Ordering::Relaxed);
            g.prev_fg = game.unwrap_or(if fg != overlay { fg } else { 0 });
            tracing::info!(
                "overlay: abrir panel (ventana del juego {:?}, primer plano {fg}, pantalla completa exclusiva: {})",
                game,
                win::exclusive_fullscreen()
            );
        }
        g.panel = Some(data.clone());
        data
    };
    st.overlay.panel_open.store(true, Ordering::Relaxed);
    live::start(st);
    let ready = st.overlay.inner.lock().ready;
    ensure_window(st);
    if ready {
        let _ = st.app.emit_to(LABEL, "overlay:panel", &Some(data));
    }
}

pub fn close_panel(st: &Arc<AppState>, restore_focus: bool) {
    if !st.overlay.panel_open.swap(false, Ordering::Relaxed) {
        return;
    }
    let prev = {
        let mut g = st.overlay.inner.lock();
        g.panel = None;
        std::mem::take(&mut g.prev_fg)
    };
    let _ = st.app.emit_to(LABEL, "overlay:panel", &None::<PanelData>);
    if let Some(w) = st.app.get_webview_window(LABEL) {
        apply_mode(st, &w, false);
    }
    #[cfg(windows)]
    if restore_focus {
        win::force_foreground(game_window(st).unwrap_or(prev));
    }
    let _ = (restore_focus, prev);
}

/// Captura del juego. Con el panel abierto, primero se cierra: la captura es
/// del juego, no del panel.
pub fn screenshot(st: &Arc<AppState>) {
    let open = st.overlay.panel_open.load(Ordering::Relaxed);
    if open {
        close_panel(st, true);
    }
    capture::take(st, if open { 450 } else { 0 });
}

pub fn toggle_panel(st: &Arc<AppState>, pad: bool) {
    if st.overlay.panel_open.load(Ordering::Relaxed) {
        close_panel(st, true);
    } else {
        open_panel(st, pad);
    }
}

/// Mando durante la partida (hilo de gamepad_home).
pub fn pad_event(st: &Arc<AppState>, ev: PadEvent) {
    match ev {
        PadEvent::Home => {
            if st.settings.get().overlay_enabled && st.overlay.inner.lock().live.is_some() {
                toggle_panel(st, true);
            } else {
                crate::lifecycle::show_main(st);
            }
        }
        PadEvent::Nav(action) => {
            if st.overlay.panel_open.load(Ordering::Relaxed) {
                let _ = st.app.emit_to(LABEL, "overlay:nav", action);
            }
        }
        PadEvent::Power(p) => *st.overlay.sampler.pad.lock() = p,
    }
}

/// Tras una captura: que la galería del panel se ponga al día.
pub fn refresh_captures(st: &Arc<AppState>) {
    if st.overlay.panel_open.load(Ordering::Relaxed) {
        refresh_panel(st);
    }
}

/// Cierra el juego a la fuerza (se ha colgado o no tiene menú para salir).
pub fn quit_game(st: &Arc<AppState>) -> anyhow::Result<()> {
    let target = st
        .overlay
        .inner
        .lock()
        .live
        .as_ref()
        .map(|l| l.target.clone())
        .ok_or_else(|| anyhow::anyhow!("No hay ningún juego en marcha"))?;
    let pids = tracker::find_pids(&target, &mut Default::default());
    if pids.is_empty() {
        anyhow::bail!("No se encuentran los procesos del juego");
    }
    close_panel(st, false);
    #[cfg(windows)]
    {
        let done = win::terminate(&pids);
        tracing::info!("overlay: cerrar juego: {done} de {} procesos", pids.len());
        if done == 0 {
            let admin = pids.iter().any(|p| crate::launcher::admin::above_us(*p));
            anyhow::bail!(if admin {
                "El juego se ejecuta como administrador y Windows no deja que ejGames lo cierre."
            } else {
                "Windows no dejó cerrar el juego."
            });
        }
    }
    Ok(())
}

// ───────────────────────────── notas ─────────────────────────────

pub fn get_note(st: &AppState, profile_id: i64, game_id: i64) -> String {
    use rusqlite::OptionalExtension;
    st.db
        .with(|c| {
            c.query_row("SELECT text FROM game_notes WHERE profile_id = ?1 AND game_id = ?2", [profile_id, game_id], |r| r.get(0))
                .optional()
        })
        .ok()
        .flatten()
        .unwrap_or_default()
}

pub fn set_note(st: &AppState, profile_id: i64, game_id: i64, text: &str) -> anyhow::Result<()> {
    let text: String = text.chars().take(20_000).collect();
    st.db.with(|c| {
        if text.trim().is_empty() {
            c.execute("DELETE FROM game_notes WHERE profile_id = ?1 AND game_id = ?2", [profile_id, game_id])?;
        } else {
            c.execute(
                "INSERT INTO game_notes (profile_id, game_id, text, updated_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT (profile_id, game_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at",
                rusqlite::params![profile_id, game_id, text, crate::util::now()],
            )?;
        }
        Ok(())
    })?;
    if let Some(p) = st.overlay.inner.lock().panel.as_mut() {
        if p.game_id == game_id {
            p.note = text;
        }
    }
    Ok(())
}

/// Nota de la partida en curso (panel del overlay).
pub fn set_live_note(st: &AppState, text: &str) -> anyhow::Result<()> {
    let (profile, game) = st
        .overlay
        .inner
        .lock()
        .live
        .as_ref()
        .map(|l| (l.profile_id, l.game_id))
        .ok_or_else(|| anyhow::anyhow!("No hay partida"))?;
    set_note(st, profile, game, text)
}

// ───────────────────────────── sesión ─────────────────────────────

pub fn session_started(st: &Arc<AppState>, game: &Game, profile_id: i64, started_at: i64, target: Target) {
    let s = st.settings.get();
    let mut keys: Vec<(&'static str, String, hotkey::Action)> = vec![];
    let panel_key = (s.overlay_enabled && !s.overlay_hotkey.trim().is_empty()).then(|| s.overlay_hotkey.clone());
    let shot_key = (s.overlay_enabled && !s.screenshot_hotkey.trim().is_empty()).then(|| s.screenshot_hotkey.clone());
    if let Some(k) = &panel_key {
        let st_p = st.clone();
        keys.push(("panel", k.clone(), Arc::new(move || toggle_panel(&st_p, false))));
    }
    if let Some(k) = &shot_key {
        let st_c = st.clone();
        keys.push(("captura", k.clone(), Arc::new(move || screenshot(&st_c))));
    }
    let st_t = st.clone();
    let guard = hotkey::start(
        keys,
        Box::new({
            let target = target.clone();
            move |pid, hwnd| (hwnd != 0 && hwnd == st_t.overlay.hwnd.load(Ordering::Relaxed)) || tracker::matches_pid(&target, pid)
        }),
    );
    if s.overlay_fps {
        let target = target.clone();
        let _ = std::thread::Builder::new().name("ejg-fps-start".into()).spawn(move || fps::start(target));
    }
    let hotkey_label = guard.as_ref().and(panel_key);
    let screenshot_label = guard.as_ref().and(shot_key);
    tracing::info!("overlay: partida de «{}», atajo: {:?}, capturas: {:?}", game.title, hotkey_label, screenshot_label);
    {
        let mut g = st.overlay.inner.lock();
        g.live = Some(Live {
            game_id: game.id,
            profile_id,
            title: game.title.clone(),
            started_at,
            hotkey: hotkey_label.clone(),
            screenshot_hotkey: screenshot_label,
            target,
            game_hwnd: 0,
            fs_seen: false,
            unlocked: vec![],
            _guard: guard,
        });
    }
    let pad = s.gamepad_home_button;
    if s.overlay_enabled && s.overlay_start_hint && (hotkey_label.is_some() || pad) {
        let how = match (&hotkey_label, pad) {
            (Some(k), true) => format!("Pulsa {} o el botón Guía del mando", display_hotkey(k)),
            (Some(k), false) => format!("Pulsa {}", display_hotkey(k)),
            (None, _) => "Pulsa el botón Guía del mando (o Select + Start)".into(),
        };
        let hint = Notice {
            id: next_id(st),
            kind: "info".into(),
            game_id: Some(game.id),
            game: Some(game.title.clone()),
            title: "Overlay de ejGames".into(),
            body: Some(format!("{how} para ver tus logros y la sesión.")),
            icon: None,
            rarity: None,
            at: crate::util::now(),
            score: None,
            progress: None,
            look: Look::default(),
        };
        // Cuando el juego ya tiene ventana (si no, saldría en el monitor de la
        // ventana activa, que puede ser otro).
        let st = st.clone();
        let game_id = game.id;
        let keyboard = hotkey_label.is_some();
        let admin_in_ejgames = game.run_as_admin;
        let _ = std::thread::Builder::new().name("ejg-overlay-hint".into()).spawn(move || {
            for _ in 0..180 {
                std::thread::sleep(Duration::from_millis(500));
                let same = st.overlay.inner.lock().live.as_ref().map(|l| l.game_id) == Some(game_id);
                if !same {
                    return;
                }
                #[cfg(windows)]
                if let Some(hwnd) = game_window(&st) {
                    // Margen para que el juego pase a pantalla completa.
                    std::thread::sleep(Duration::from_millis(2500));
                    let mut hint = hint;
                    // Juego como administrador: Windows (UIPI) no deja que ejGames
                    // lea el teclado mientras está delante, así que el atajo no llega.
                    if keyboard && crate::launcher::admin::above_us(win::window_pid(hwnd)) {
                        let how = if pad {
                            "usa el botón Guía del mando (o Select + Start)."
                        } else {
                            "el atajo de teclado no funcionará."
                        };
                        let fix = if admin_in_ejgames { " Puedes quitarlo en Editar juego." } else { "" };
                        hint.body = Some(format!("Este juego se abre como administrador y Windows no deja que ejGames lea el teclado: {how}{fix}"));
                    }
                    notify(&st, hint);
                    return;
                }
            }
        });
    }
}

pub fn session_ended(st: &Arc<AppState>, game_id: i64) {
    let ended = {
        let mut g = st.overlay.inner.lock();
        if g.live.as_ref().map(|l| l.game_id) == Some(game_id) {
            g.live.take() // suelta el atajo global
        } else {
            None
        }
    };
    if let Some(live) = ended {
        fps::stop();
        close_panel(st, false);
        let _ = pin_map(st, None);
        session_summary(st, live);
    }
}

pub fn display_hotkey(k: &str) -> String {
    k.split('+').map(|p| p.trim()).map(|p| if p.eq_ignore_ascii_case("shift") { crate::i18n::t("Mayús").into_owned() } else { p.to_string() }).collect::<Vec<_>>().join(" + ")
}
