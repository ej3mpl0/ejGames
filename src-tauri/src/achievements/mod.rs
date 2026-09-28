//! Logros: esquema (Steam sin clave, o el que trae el emulador) + desbloqueos de
//! las estadísticas locales de Steam y de los ficheros de emuladores. Mientras
//! se juega, un hilo vigila esos ficheros (solo `stat` cada 2 s) y avisa al
//! overlay de cada logro nuevo.

pub mod emu;
pub mod kv;
pub mod schema;
pub mod steam_local;

use crate::db::models::{Game, MEDIA_ORIGIN};
use crate::db::repo;
use crate::state::AppState;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime};

const SCHEMA_MAX_AGE: i64 = 7 * 86400;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Def {
    pub api_name: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub icon_gray: Option<String>,
    pub hidden: bool,
    pub global_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub api_name: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub icon_gray: Option<String>,
    pub hidden: bool,
    pub global_pct: Option<f64>,
    pub unlocked_at: Option<i64>,
    /// Puntos al estilo Xbox (ver `score`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AchList {
    pub game_id: i64,
    pub appid: Option<i64>,
    pub total: i64,
    pub unlocked: i64,
    pub items: Vec<Achievement>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AchSummary {
    pub unlocked: i64,
    pub total: i64,
}

#[derive(Debug, Clone)]
pub struct NewUnlock {
    pub api_name: String,
    pub unlocked_at: i64,
    pub source: String,
}

/// "ACH_FIRST_STEPS" → "First Steps" (cuando no hay esquema).
pub fn pretty_name(api: &str) -> String {
    let mut s = api;
    for p in ["NEW_ACHIEVEMENT_", "ACHIEVEMENT_", "ACH_", "ACV_"] {
        // `get` y no `[..]`: con nombres no ASCII el corte puede caer en medio
        // de un carácter.
        if s.len() > p.len() && s.get(..p.len()).map(|h| h.eq_ignore_ascii_case(p)).unwrap_or(false) {
            s = &s[p.len()..];
            break;
        }
    }
    let mut words: Vec<String> = vec![];
    let mut cur = String::new();
    let mut prev_lower = false;
    for c in s.chars() {
        if c == '_' || c == '-' || c == ' ' {
            if !cur.is_empty() {
                words.push(std::mem::take(&mut cur));
            }
            prev_lower = false;
            continue;
        }
        if c.is_uppercase() && prev_lower && !cur.is_empty() {
            words.push(std::mem::take(&mut cur));
        }
        prev_lower = c.is_lowercase() || c.is_ascii_digit();
        cur.push(c);
    }
    if !cur.is_empty() {
        words.push(cur);
    }
    words
        .iter()
        .map(|w| {
            let lower = w.to_lowercase();
            let mut ch = lower.chars();
            ch.next().map(|f| f.to_uppercase().chain(ch).collect()).unwrap_or_default()
        })
        .collect::<Vec<String>>()
        .join(" ")
}

/// Nombre de fichero de icono de Steam aceptable (hash.jpg).
pub fn valid_icon_name(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    !s.is_empty()
        && s.len() <= 120
        && !s.contains("..")
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        && [".jpg", ".jpeg", ".png", ".gif"].iter().any(|e| lower.ends_with(e))
}

pub fn icon_remote(appid: i64, file: &str) -> String {
    format!("https://cdn.fastly.steamstatic.com/steamcommunity/public/images/apps/{appid}/{file}")
}

/// URL local (caché en disco vía ejg-media) de un icono de logro.
pub fn icon_url(appid: Option<i64>, icon: Option<&str>) -> Option<String> {
    let (a, i) = (appid?, icon?);
    valid_icon_name(i).then(|| format!("{MEDIA_ORIGIN}/a/{a}/{i}"))
}

// ───────────────────────────── fuentes ─────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct Sources {
    pub appid: Option<i64>,
    /// (raíz de Steam, account id) del usuario activo.
    pub steam: Option<(PathBuf, u32)>,
    pub emu_files: Vec<PathBuf>,
    pub emu_schema: Option<PathBuf>,
    pub install_files: Vec<PathBuf>,
}

impl Sources {
    fn watched(&self) -> Vec<PathBuf> {
        let mut v = self.emu_files.clone();
        if let (Some(a), Some((root, acc))) = (self.appid, &self.steam) {
            v.push(steam_local::user_stats_file(root, *acc, a));
        }
        v
    }
}

/// (raíz de Steam, account id).
type SteamUser = Option<(PathBuf, u32)>;

fn steam_user() -> SteamUser {
    static CACHE: Mutex<Option<(Instant, SteamUser)>> = Mutex::new(None);
    let mut g = CACHE.lock();
    if let Some((t, v)) = g.as_ref() {
        if t.elapsed() < Duration::from_secs(600) {
            return v.clone();
        }
    }
    let v = crate::import::steam::steam_root()
        .and_then(|r| crate::import::steam::active_user(&r).map(|(acc, _)| (r, acc)));
    *g = Some((Instant::now(), v.clone()));
    v
}

type ScanCache = Mutex<HashMap<i64, (Instant, emu::InstallScan)>>;

fn scans() -> &'static ScanCache {
    static S: OnceLock<ScanCache> = OnceLock::new();
    S.get_or_init(Default::default)
}

/// Busca en la carpeta del juego (appid del emulador, saves locales, esquema).
/// Se cachea en memoria y en la BD: recorrer la carpeta cuesta más que el resto.
fn install_scan(st: &AppState, g: &Game, max_age: Duration) -> emu::InstallScan {
    let Some(dir) = g.install_dir.as_deref().map(Path::new) else { return Default::default() };
    if !crate::launcher::tracker::safe_install_dir(dir) || !dir.is_dir() {
        return Default::default();
    }
    if let Some((t, s)) = scans().lock().get(&g.id) {
        if t.elapsed() < max_age {
            return s.clone();
        }
    }
    let key = format!("{}|{}", g.id, crate::util::norm_path(dir));
    if !max_age.is_zero() {
        let cached = st
            .db
            .with(|c| repo::cache_get(c, "ach_scan", &key, max_age.as_secs() as i64))
            .ok()
            .flatten()
            .and_then(|j| serde_json::from_str::<emu::InstallScan>(&j).ok());
        if let Some(s) = cached {
            scans().lock().insert(g.id, (Instant::now(), s.clone()));
            return s;
        }
    }
    let s = emu::scan_install(dir);
    scans().lock().insert(g.id, (Instant::now(), s.clone()));
    if let Ok(j) = serde_json::to_string(&s) {
        let _ = st.db.with(|c| repo::cache_put(c, "ach_scan", &key, &j));
    }
    s
}

pub fn sources(st: &AppState, g: &Game, scan_age: Duration) -> Sources {
    let is_steam = g.source == "steam";
    let scan = if is_steam { Default::default() } else { install_scan(st, g, scan_age) };
    // En juegos sueltos manda el appid del emulador (el de los metadatos puede
    // ser otra edición); en Steam, el de la tienda. Uno de una coincidencia
    // dudosa ("review") no vale: saldrían los logros de otro juego.
    let appid = if is_steam {
        g.steam_appid.or_else(|| g.source_id.parse().ok())
    } else {
        scan.appid.or(g.steam_appid.filter(|_| g.meta_status != "review"))
    };
    let mut emu_files = vec![];
    if let (Some(a), false) = (appid, is_steam) {
        emu_files = emu::find_in_roots(a, &emu::roots(&st.settings.get().achievement_dirs));
        for f in &scan.files {
            if !emu_files.contains(f) {
                emu_files.push(f.clone());
            }
        }
    }
    Sources { appid, steam: steam_user(), emu_files, emu_schema: scan.schema, install_files: scan.files }
}

/// Desbloqueos de todas las fuentes (nombre API, fecha, origen).
fn collect(src: &Sources, lang: &str) -> Vec<(String, i64, &'static str)> {
    let mut out = vec![];
    if let (Some(appid), Some((root, acc))) = (src.appid, &src.steam) {
        let f = steam_local::user_stats_file(root, *acc, appid);
        if let Ok(bytes) = std::fs::read(&f) {
            let schema = steam_local::schema(root, appid, lang);
            if let Some(u) = steam_local::parse_unlocks(&bytes, &schema) {
                out.extend(u.into_iter().map(|(a, t)| (a, t, "steam")));
            }
        }
    }
    for f in &src.emu_files {
        if let Some(u) = emu::parse_file(f) {
            out.extend(u.into_iter().map(|(a, t)| (a, t, "local")));
        }
    }
    out
}

fn signature(src: &Sources) -> Vec<(PathBuf, Option<(SystemTime, u64)>)> {
    src.watched()
        .into_iter()
        .map(|p| {
            let m = std::fs::metadata(&p).ok().and_then(|m| Some((m.modified().ok()?, m.len())));
            (p, m)
        })
        .collect()
}

// ───────────────────────────── BD ─────────────────────────────

fn store_defs(c: &mut Connection, game_id: i64, appid: i64, defs: &[Def]) -> rusqlite::Result<()> {
    let tx = c.transaction()?;
    tx.execute("DELETE FROM achievement_defs WHERE game_id = ?1", [game_id])?;
    {
        let mut ins = tx.prepare(
            "INSERT OR IGNORE INTO achievement_defs
               (game_id, api_name, appid, name, description, icon, icon_gray, hidden, global_pct, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )?;
        for (i, d) in defs.iter().enumerate() {
            ins.execute(params![game_id, d.api_name, appid, d.name, d.description, d.icon, d.icon_gray, d.hidden, d.global_pct, i as i64])?;
        }
    }
    tx.commit()
}

fn defs_state(c: &Connection, game_id: i64) -> rusqlite::Result<(usize, Option<i64>)> {
    c.query_row("SELECT COUNT(*), MAX(appid) FROM achievement_defs WHERE game_id = ?1", [game_id], |r| {
        Ok((r.get::<_, i64>(0)? as usize, r.get(1)?))
    })
}

fn store_unlocks(
    c: &mut Connection,
    game_id: i64,
    profile: Option<i64>,
    unlocks: &[(String, i64, &str)],
) -> rusqlite::Result<Vec<NewUnlock>> {
    let now = crate::util::now();
    let tx = c.transaction()?;
    let mut out = vec![];
    {
        let mut ins = tx.prepare(
            "INSERT OR IGNORE INTO achievement_unlocks (game_id, api_name, unlocked_at, source, profile_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for (api, t, src) in unlocks {
            let t = if *t > 0 { *t } else { now };
            if ins.execute(params![game_id, api, t, src, profile])? == 1 {
                out.push(NewUnlock { api_name: api.clone(), unlocked_at: t, source: src.to_string() });
            }
        }
    }
    tx.commit()?;
    Ok(out)
}

pub fn summaries(c: &Connection) -> rusqlite::Result<HashMap<i64, AchSummary>> {
    let mut st = c.prepare_cached(
        "SELECT d.game_id, COUNT(*), COUNT(u.api_name) FROM achievement_defs d
         LEFT JOIN achievement_unlocks u ON u.game_id = d.game_id AND u.api_name = d.api_name
         GROUP BY d.game_id",
    )?;
    let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, AchSummary { total: r.get(1)?, unlocked: r.get(2)? })))?;
    rows.collect()
}

pub fn summary(c: &Connection, game_id: i64) -> rusqlite::Result<Option<AchSummary>> {
    let (total, unlocked): (i64, i64) = c.query_row(
        "SELECT COUNT(*), COUNT(u.api_name) FROM achievement_defs d
         LEFT JOIN achievement_unlocks u ON u.game_id = d.game_id AND u.api_name = d.api_name
         WHERE d.game_id = ?1",
        [game_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((total > 0).then_some(AchSummary { unlocked, total }))
}

/// Lista completa para la UI. Los ocultos sin desbloquear no enseñan nada.
pub fn list(c: &Connection, game_id: i64) -> rusqlite::Result<AchList> {
    let mut st = c.prepare_cached(
        "SELECT d.api_name, d.appid, d.name, d.description, d.icon, d.icon_gray, d.hidden, d.global_pct, u.unlocked_at
         FROM achievement_defs d
         LEFT JOIN achievement_unlocks u ON u.game_id = d.game_id AND u.api_name = d.api_name
         WHERE d.game_id = ?1 ORDER BY d.position",
    )?;
    let mut appid: Option<i64> = None;
    let mut items: Vec<Achievement> = st
        .query_map([game_id], |r| {
            let a: Option<i64> = r.get(1)?;
            let icon: Option<String> = r.get(4)?;
            let icon_gray: Option<String> = r.get(5)?;
            let hidden: bool = r.get(6)?;
            let unlocked_at: Option<i64> = r.get(8)?;
            let masked = hidden && unlocked_at.is_none();
            Ok((
                a,
                Achievement {
                    api_name: r.get(0)?,
                    name: if masked { "Logro oculto".into() } else { r.get(2)? },
                    description: if masked { Some("Sigue jugando para descubrirlo.".into()) } else { r.get(3)? },
                    icon: if masked { None } else { icon_url(a, icon.as_deref()) },
                    icon_gray: if masked { None } else { icon_url(a, icon_gray.as_deref()) },
                    hidden,
                    global_pct: r.get(7)?,
                    unlocked_at,
                    score: None,
                },
            ))
        })?
        .filter_map(Result::ok)
        .map(|(a, item)| {
            appid = appid.or(a);
            item
        })
        .collect();
    // Desbloqueos sin definición (sin esquema todavía, p. ej. sin conexión).
    let mut orphans = c.prepare_cached(
        "SELECT api_name, unlocked_at FROM achievement_unlocks u WHERE game_id = ?1 AND NOT EXISTS
           (SELECT 1 FROM achievement_defs d WHERE d.game_id = u.game_id AND d.api_name = u.api_name)
         ORDER BY unlocked_at",
    )?;
    let extra: Vec<(String, i64)> = orphans.query_map([game_id], |r| Ok((r.get(0)?, r.get(1)?)))?.filter_map(Result::ok).collect();
    for (api, t) in extra {
        items.push(Achievement {
            name: pretty_name(&api),
            api_name: api,
            description: None,
            icon: None,
            icon_gray: None,
            hidden: false,
            global_pct: None,
            unlocked_at: Some(t),
            score: None,
        });
    }
    let defs: Vec<(String, Option<f64>)> = items.iter().map(|i| (i.api_name.clone(), i.global_pct)).collect();
    for it in items.iter_mut() {
        it.score = score_of(&defs, &it.api_name);
    }
    let unlocked = items.iter().filter(|i| i.unlocked_at.is_some()).count() as i64;
    Ok(AchList { game_id, appid, total: items.len() as i64, unlocked, items })
}

/// Peso de un logro según su rareza (los raros valen más).
fn weight(pct: Option<f64>) -> f64 {
    match pct {
        None => 2.0,
        Some(p) if p < 5.0 => 8.0,
        Some(p) if p < 10.0 => 5.0,
        Some(p) if p < 20.0 => 3.0,
        Some(p) if p < 50.0 => 2.0,
        _ => 1.0,
    }
}

/// Puntos al estilo Xbox: 1000 por juego repartidos por rareza, en múltiplos de 5.
fn score_of(defs: &[(String, Option<f64>)], api: &str) -> Option<i64> {
    let total: f64 = defs.iter().map(|d| weight(d.1)).sum();
    let w = weight(defs.iter().find(|d| d.0 == api)?.1);
    Some(((1000.0 * w / total / 5.0).round() as i64 * 5).max(5))
}

pub fn score(c: &Connection, game_id: i64, api: &str) -> rusqlite::Result<Option<i64>> {
    let mut q = c.prepare_cached("SELECT api_name, global_pct FROM achievement_defs WHERE game_id = ?1")?;
    let defs: Vec<(String, Option<f64>)> = q.query_map([game_id], |r| Ok((r.get(0)?, r.get(1)?)))?.filter_map(Result::ok).collect();
    Ok(score_of(&defs, api))
}

/// Datos de un logro para la notificación.
pub fn def_of(c: &Connection, game_id: i64, api: &str) -> rusqlite::Result<Option<(Option<i64>, Def)>> {
    use rusqlite::OptionalExtension;
    c.query_row(
        "SELECT appid, name, description, icon, icon_gray, hidden, global_pct FROM achievement_defs
         WHERE game_id = ?1 AND api_name = ?2",
        params![game_id, api],
        |r| {
            Ok((
                r.get(0)?,
                Def {
                    api_name: api.to_string(),
                    name: r.get(1)?,
                    description: r.get(2)?,
                    icon: r.get(3)?,
                    icon_gray: r.get(4)?,
                    hidden: r.get(5)?,
                    global_pct: r.get(6)?,
                },
            ))
        },
    )
    .optional()
}

// ───────────────────────────── esquema ─────────────────────────────

fn failures() -> &'static Mutex<HashMap<i64, Instant>> {
    static F: OnceLock<Mutex<HashMap<i64, Instant>>> = OnceLock::new();
    F.get_or_init(Default::default)
}

fn local_defs(src: &Sources, appid: i64, lang: &str) -> Vec<Def> {
    if let Some((root, _)) = &src.steam {
        let s = steam_local::schema(root, appid, lang);
        if !s.is_empty() {
            return s.into_iter().map(|b| b.def).collect();
        }
    }
    src.emu_schema.as_deref().map(|p| emu::goldberg_schema(p, lang)).unwrap_or_default()
}

/// Deja en la BD el esquema del juego (red como mucho una vez por semana).
pub async fn ensure_schema(st: &Arc<AppState>, game_id: i64, appid: i64, src: &Sources) -> anyhow::Result<()> {
    let lang = st.settings.get().language;
    let key = format!("{appid}:{lang}");
    let cached: Option<Vec<Def>> = st
        .db
        .with(|c| repo::cache_get(c, "steam_ach", &key, SCHEMA_MAX_AGE))?
        .and_then(|j| serde_json::from_str(&j).ok());
    let fresh = cached.is_some();
    let mut defs = match cached {
        Some(d) => d,
        None => {
            let recently_failed = failures().lock().get(&appid).map(|t| t.elapsed() < Duration::from_secs(600)).unwrap_or(false);
            if recently_failed {
                vec![]
            } else {
                match schema::fetch(&st.http, appid, &lang).await {
                    Ok(d) => {
                        let json = serde_json::to_string(&d)?;
                        st.db.with(|c| repo::cache_put(c, "steam_ach", &key, &json))?;
                        d
                    }
                    Err(e) => {
                        tracing::debug!("esquema de logros {appid}: {e:#}");
                        failures().lock().insert(appid, Instant::now());
                        vec![]
                    }
                }
            }
        }
    };
    if defs.is_empty() {
        defs = local_defs(src, appid, &lang);
    }
    let (count, cur) = st.db.with(|c| defs_state(c, game_id))?;
    if defs.is_empty() {
        if count > 0 && cur != Some(appid) {
            st.db.with(|c| c.execute("DELETE FROM achievement_defs WHERE game_id = ?1", [game_id]).map(|_| ()))?;
        }
        return Ok(());
    }
    if !fresh || count != defs.len() || cur != Some(appid) {
        st.db.with_mut(|c| store_defs(c, game_id, appid, &defs))?;
    }
    Ok(())
}

// ───────────────────────────── sincronizar ─────────────────────────────

fn sync_with(st: &AppState, game_id: i64, profile: Option<i64>, src: &Sources) -> anyhow::Result<Vec<NewUnlock>> {
    let lang = st.settings.get().language;
    let unlocks = collect(src, &lang);
    if unlocks.is_empty() {
        return Ok(vec![]);
    }
    st.db.with_mut(|c| store_unlocks(c, game_id, profile, &unlocks))
}

/// Esquema + desbloqueos de un juego. Devuelve los logros nuevos. `scan_age`:
/// antigüedad aceptable de la búsqueda en la carpeta del juego.
pub async fn refresh(st: &Arc<AppState>, game_id: i64, profile: Option<i64>, scan_age: Duration) -> anyhow::Result<Vec<NewUnlock>> {
    let g = st.db.with(|c| repo::get_game(c, game_id))?;
    let st2 = st.clone();
    let src = tauri::async_runtime::spawn_blocking(move || sources(&st2, &g, scan_age)).await?;
    let Some(appid) = src.appid else { return Ok(vec![]) };
    if let Err(e) = ensure_schema(st, game_id, appid, &src).await {
        tracing::warn!("logros de {game_id}: {e:#}");
    }
    let st2 = st.clone();
    let before = st.db.with(|c| summary(c, game_id)).ok().flatten();
    let new = tauri::async_runtime::spawn_blocking(move || sync_with(&st2, game_id, profile, &src)).await??;
    let after = st.db.with(|c| summary(c, game_id)).ok().flatten();
    if !new.is_empty() || before != after {
        crate::events::library_changed(st, vec![game_id]);
    }
    Ok(new)
}

/// Al arrancar: juegos instalados y los de Steam con estadísticas locales.
pub async fn refresh_library(st: &Arc<AppState>) {
    let steam = steam_user();
    let ids: Vec<(i64, bool)> = st
        .db
        .with(|c| {
            let mut q = c.prepare("SELECT id, installed, source, steam_appid FROM games WHERE missing = 0")?;
            let rows = q.query_map([], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, bool>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<i64>>(3)?))
            })?;
            Ok(rows
                .filter_map(Result::ok)
                .filter(|(_, installed, source, appid)| {
                    *installed
                        || (source == "steam"
                            && appid
                                .zip(steam.as_ref())
                                .map(|(a, (root, acc))| steam_local::user_stats_file(root, *acc, a).exists())
                                .unwrap_or(false))
                })
                .map(|(id, installed, ..)| (id, installed))
                .collect())
        })
        .unwrap_or_default();
    for (id, _) in ids {
        if st.sessions.any() && st.saver_active.load(Ordering::Relaxed) {
            // Jugando en modo ahorro: no molestar.
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
        let had_cache = st.db.with(|c| defs_state(c, id)).map(|(n, _)| n > 0).unwrap_or(false);
        // Al arrancar vale la búsqueda guardada (hasta una semana): al jugar se
        // repite en fresco.
        if let Err(e) = refresh(st, id, None, Duration::from_secs(7 * 86400)).await {
            tracing::debug!("logros {id}: {e:#}");
        }
        // Sin caché hubo red: espaciar peticiones.
        tokio::time::sleep(Duration::from_millis(if had_cache { 20 } else { 350 })).await;
    }
}

// ───────────────────────────── durante la partida ─────────────────────────────

/// Vigila los ficheros de logros del juego hasta que `stop` se active.
pub fn watch(st: Arc<AppState>, game_id: i64, profile: i64, stop: Arc<AtomicBool>) {
    let _ = std::thread::Builder::new().name(format!("ejg-ach-{game_id}")).spawn(move || {
        let Ok(g) = st.db.with(|c| repo::get_game(c, game_id)) else { return };
        let mut src = sources(&st, &g, Duration::ZERO);
        let Some(appid) = src.appid else {
            tracing::debug!("{}: sin appid, no hay logros que vigilar", g.title);
            return;
        };
        if let Err(e) = tauri::async_runtime::block_on(ensure_schema(&st, game_id, appid, &src)) {
            tracing::debug!("esquema {appid}: {e:#}");
        }
        // Lo que ya estaba desbloqueado entra sin avisar.
        let _ = sync_with(&st, game_id, Some(profile), &src);
        crate::events::library_changed(&st, vec![game_id]);
        let mut sig = signature(&src);
        let mut last_scan = Instant::now();
        let roots = emu::roots(&st.settings.get().achievement_dirs);
        let check = |src: &Sources, sig: &mut Vec<(PathBuf, Option<(SystemTime, u64)>)>| {
            let now_sig = signature(src);
            if now_sig == *sig {
                return;
            }
            *sig = now_sig;
            match sync_with(&st, game_id, Some(profile), src) {
                Ok(new) if !new.is_empty() => {
                    crate::events::library_changed(&st, vec![game_id]);
                    let steam_notify = st.settings.get().overlay_steam_notify;
                    for n in new {
                        if n.source != "steam" || steam_notify || g.source != "steam" {
                            crate::overlay::notify_achievement(&st, game_id, &n);
                        }
                    }
                }
                Ok(_) => {}
                Err(e) => tracing::debug!("logros {game_id}: {e:#}"),
            }
        };
        while !stop.load(Ordering::Relaxed) {
            for _ in 0..8 {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            if g.source != "steam" {
                // Ficheros nuevos: en las carpetas de los emuladores cada vez
                // (barato). La del juego solo se vuelve a recorrer (cada 5 min)
                // mientras no se sepa dónde guarda los logros.
                if src.emu_files.is_empty() && last_scan.elapsed() > Duration::from_secs(300) {
                    src = sources(&st, &g, Duration::ZERO);
                    last_scan = Instant::now();
                } else {
                    let mut files = emu::find_in_roots(appid, &roots);
                    for f in &src.install_files {
                        if !files.contains(f) {
                            files.push(f.clone());
                        }
                    }
                    src.emu_files = files;
                }
            }
            check(&src, &mut sig);
        }
        // Lo escrito al cerrar el juego: enseguida y un par de veces más, por
        // si el emulador termina de guardar un poco después.
        for wait in [0, 1500, 2500] {
            std::thread::sleep(Duration::from_millis(wait));
            check(&src, &mut sig);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pretty() {
        assert_eq!(pretty_name("ACH_FIRST_STEPS"), "First Steps");
        assert_eq!(pretty_name("TheFool"), "The Fool");
        assert_eq!(pretty_name("NEW_ACHIEVEMENT_1_0"), "1 0");
        // Cortes por bytes en medio de un carácter: no debe hacer panic.
        assert_eq!(pretty_name("隠された実績です"), "隠された実績です");
        assert_eq!(pretty_name("ÁCH_ñandú"), "Ách Ñandú");
    }

    #[test]
    fn icons() {
        assert!(valid_icon_name("7975d6e5d790b88f030195e3b1a38e49a5de1c8d.jpg"));
        assert!(!valid_icon_name("../x.jpg"));
        assert!(!valid_icon_name("a.exe"));
        assert_eq!(icon_url(Some(10), Some("a.jpg")).unwrap(), "http://ejg-media.localhost/a/10/a.jpg");
    }

    #[test]
    fn scores() {
        let defs: Vec<(String, Option<f64>)> = (0..10).map(|i| (format!("A{i}"), Some(60.0))).chain([("RARE".into(), Some(2.0))]).collect();
        let common = score_of(&defs, "A0").unwrap();
        let rare = score_of(&defs, "RARE").unwrap();
        assert!(rare > common * 4, "{rare} vs {common}");
        assert_eq!(common % 5, 0);
        let sum: i64 = defs.iter().map(|d| score_of(&defs, &d.0).unwrap()).sum();
        assert!((950..=1050).contains(&sum), "{sum}");
        assert_eq!(score_of(&defs, "NO"), None);
    }

    #[test]
    fn db_roundtrip() {
        let db = crate::db::Db::memory().unwrap();
        let gid = db
            .with(|c| {
                c.execute("INSERT INTO games (title, sort_title, source, source_id, added_at, updated_at) VALUES ('x','x','folder','1',0,0)", [])?;
                Ok(c.last_insert_rowid())
            })
            .unwrap();
        let defs = vec![
            Def { api_name: "A".into(), name: "Uno".into(), description: None, icon: Some("a.jpg".into()), icon_gray: None, hidden: false, global_pct: Some(50.0) },
            Def { api_name: "B".into(), name: "Dos".into(), description: Some("secreto".into()), icon: None, icon_gray: None, hidden: true, global_pct: None },
        ];
        db.with_mut(|c| store_defs(c, gid, 480, &defs)).unwrap();
        let new = db.with_mut(|c| store_unlocks(c, gid, None, &[("A".into(), 100, "local"), ("Z".into(), 5, "local")])).unwrap();
        assert_eq!(new.len(), 2);
        let again = db.with_mut(|c| store_unlocks(c, gid, None, &[("A".into(), 100, "local")])).unwrap();
        assert!(again.is_empty());
        let l = db.with(|c| list(c, gid)).unwrap();
        assert_eq!((l.total, l.unlocked), (3, 2));
        assert_eq!(l.items[1].name, "Logro oculto");
        assert_eq!(l.items[2].name, "Z");
        assert_eq!(db.with(|c| summary(c, gid)).unwrap(), Some(AchSummary { unlocked: 1, total: 2 }));
    }
}
