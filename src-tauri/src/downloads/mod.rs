//! Descargas de Explorar: cola persistente (tabla `downloads`), motor torrent
//! perezoso (`engine`), planificador y progreso (`queue`) e instalación
//! (`install`).
//!
//! Estados: queued (esperando hueco o parada sola: al jugar, instalando) →
//! downloading → seeding (compartiendo hasta instalar) | completed → installing
//! → installed. `paused` solo si la pausó el usuario; `error` si falló.

pub mod engine;
pub mod files;
pub mod install;
pub mod queue;
pub mod win;

use crate::db::models::{DownloadRow, NewDownload};
use crate::db::repo;
use crate::explore;
use crate::state::AppState;
use files::TorrentFile;
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, Magnet};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Marca en la carpeta de cada descarga: solo se borran carpetas que la tengan.
pub const MARKER: &str = ".ejgames-download";

/// Estadísticas en vivo de una descarga (no se guardan).
#[derive(Debug, Clone, Default)]
pub struct Live {
    pub down_bps: u64,
    pub up_bps: u64,
    pub peers: u32,
    pub eta: Option<u64>,
    pub done: u64,
    pub total: u64,
    pub uploaded: u64,
    /// Subido en sesiones anteriores (librqbit empieza de 0 al volver a añadirlo).
    pub uploaded_base: u64,
    pub checking: bool,
}

/// Torrent con la lista de archivos ya pedida, esperando confirmación.
struct Prepared {
    details: explore::RepackDetails,
    magnet: String,
    info_hash: String,
    torrent: Vec<u8>,
    name: String,
    files: Vec<TorrentFile>,
    seen_peers: Vec<SocketAddr>,
    created: Instant,
}

#[derive(Default)]
pub struct Downloads {
    pub engine: engine::Engine,
    prepared: Mutex<HashMap<String, Prepared>>,
    /// Pidiendo la lista de archivos de un torrent (mantiene el motor vivo).
    preparing: AtomicUsize,
    cancel_prepare: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
    /// Descarga que se está instalando.
    pub installing: Mutex<Option<i64>>,
    /// Serializa la planificación.
    plan: tokio::sync::Mutex<()>,
    ticker_on: AtomicBool,
    pub live: Mutex<HashMap<i64, Live>>,
    /// Estado de "jugando" que vio el planificador por última vez.
    playing: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: i64,
    pub source: String,
    pub source_id: String,
    pub slug: Option<String>,
    pub title: String,
    pub version: Option<String>,
    pub cover: Option<String>,
    pub hero: Option<String>,
    pub page_url: Option<String>,
    pub state: String,
    pub pause_reason: Option<String>,
    pub error: Option<String>,
    pub total_bytes: u64,
    pub done_bytes: u64,
    pub uploaded_bytes: u64,
    /// 0..1
    pub progress: f64,
    pub down_bps: u64,
    pub up_bps: u64,
    pub peers: u32,
    /// Segundos que faltan (si se sabe).
    pub eta: Option<u64>,
    /// Comprobando lo ya descargado.
    pub checking: bool,
    pub queue_pos: i64,
    pub install_size: Option<String>,
    pub output_dir: String,
    /// Nombre del torrent (la carpeta de la descarga).
    pub name: String,
    pub file_count: i64,
    pub selected_count: usize,
    pub install_dir: Option<String>,
    pub game_id: Option<i64>,
    pub added_at: i64,
    pub completed_at: Option<i64>,
    pub installed_at: Option<i64>,
    pub files_deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDownload {
    pub token: String,
    pub slug: String,
    pub title: String,
    pub version: Option<String>,
    pub name: String,
    pub files: Vec<TorrentFile>,
    pub total_bytes: u64,
    /// Carpeta de descargas ("" si aún no hay ninguna: hay que elegirla).
    pub dir: String,
    pub free_bytes: Option<u64>,
    pub install_size: Option<String>,
    pub install_dir: String,
    pub install_free_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Defaults {
    pub download_dir: String,
    pub install_dir: String,
    /// El usuario ya eligió carpeta de descargas (o hay biblioteca).
    pub configured: bool,
}

fn item(row: &DownloadRow, live: Option<&Live>) -> DownloadItem {
    let (mut done, mut total) = (row.done_bytes.max(0) as u64, row.total_bytes.max(0) as u64);
    let mut uploaded = row.uploaded_bytes.max(0) as u64;
    let active = matches!(row.state.as_str(), "downloading" | "seeding");
    // Lo último que dijo el motor vale también en pausa o en cola (la BD solo
    // se guarda cada 30 s).
    if let Some(l) = live.filter(|l| l.total > 0 && l.done >= done) {
        done = l.done;
        total = l.total;
    }
    if let Some(l) = live {
        uploaded = uploaded.max(l.uploaded_base + l.uploaded);
    }
    let progress = if total > 0 { (done as f64 / total as f64).min(1.0) } else { 0.0 };
    let live = live.filter(|_| active);
    DownloadItem {
        id: row.id,
        source: row.source.clone(),
        source_id: row.source_id.clone(),
        slug: row.slug.clone(),
        title: row.title.clone(),
        version: row.version.clone(),
        cover: explore::proxied(row.cover_url.as_deref()),
        hero: explore::proxied(row.hero_url.as_deref()),
        page_url: row.page_url.clone(),
        state: row.state.clone(),
        pause_reason: row.pause_reason.clone(),
        error: row.error.clone(),
        total_bytes: total,
        done_bytes: done,
        uploaded_bytes: uploaded,
        progress: if matches!(row.state.as_str(), "seeding" | "completed" | "installing" | "installed") { 1.0 } else { progress },
        down_bps: live.map(|l| l.down_bps).unwrap_or(0),
        up_bps: live.map(|l| l.up_bps).unwrap_or(0),
        peers: live.map(|l| l.peers).unwrap_or(0),
        eta: live.and_then(|l| l.eta),
        checking: live.map(|l| l.checking).unwrap_or(false),
        queue_pos: row.queue_pos,
        install_size: row.install_size.clone(),
        output_dir: row.output_dir.clone(),
        name: row.torrent_name.clone(),
        file_count: row.file_count,
        selected_count: row.selected_files.len(),
        install_dir: row.install_dir.clone(),
        game_id: row.game_id,
        added_at: row.added_at,
        completed_at: row.completed_at,
        installed_at: row.installed_at,
        files_deleted: row.files_deleted,
    }
}

pub fn list(st: &AppState) -> anyhow::Result<Vec<DownloadItem>> {
    let rows = st.db.with(repo::list_downloads)?;
    let live = st.downloads.live.lock();
    Ok(rows.iter().map(|r| item(r, live.get(&r.id))).collect())
}

pub fn get_item(st: &AppState, id: i64) -> anyhow::Result<DownloadItem> {
    let row = st.db.with(|c| repo::get_download(c, id))?.ok_or_else(|| anyhow::anyhow!("Esa descarga ya no existe"))?;
    let live = st.downloads.live.lock();
    Ok(item(&row, live.get(&id)))
}

/// Avisa a la interfaz de que la lista cambió (estado, altas, bajas).
pub fn emit_changed(st: &AppState) {
    if let Ok(items) = list(st) {
        let _ = st.app.emit("downloads:changed", items);
    }
}

// ───────────────────────────── carpetas ─────────────────────────────

fn first_library_folder(st: &AppState) -> Option<String> {
    st.db
        .with(repo::list_folders)
        .ok()?
        .into_iter()
        .find(|f| f.enabled && Path::new(&f.path).is_dir())
        .map(|f| f.path)
}

pub fn defaults(st: &AppState) -> Defaults {
    let s = st.settings.get();
    let lib = first_library_folder(st);
    let download_dir = if s.download_dir.trim().is_empty() { lib.clone().unwrap_or_default() } else { s.download_dir.clone() };
    let install_dir = if s.install_dir.trim().is_empty() { lib.unwrap_or_else(|| download_dir.clone()) } else { s.install_dir.clone() };
    Defaults {
        configured: !download_dir.is_empty(),
        download_dir,
        install_dir,
    }
}

/// Nombre de carpeta válido en Windows.
pub fn sanitize(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect();
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut s: String = s.chars().take(120).collect();
    while s.ends_with(['.', ' ']) {
        s.pop();
    }
    let upper = s.to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
    if s.is_empty() || reserved.contains(&upper.as_str()) {
        s = format!("Descarga {s}").trim().to_string();
    }
    s
}

// ───────────────────────────── preparar y empezar ─────────────────────────────

fn token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(Instant::now().elapsed().as_nanos() ^ crate::util::now() as u128);
    format!("{:016x}", h.finish())
}

fn hex_of(magnet: &str) -> anyhow::Result<(Magnet, String)> {
    let m = Magnet::parse(magnet).map_err(|_| anyhow::anyhow!("El enlace magnet de esta ficha no es válido"))?;
    let id = m.as_id20().ok_or_else(|| anyhow::anyhow!("El enlace magnet de esta ficha no es válido"))?;
    Ok((m, id.as_string()))
}

/// Pide la lista de archivos del torrent de una ficha (sin empezar a bajar).
pub async fn prepare(st: &Arc<AppState>, slug: &str) -> anyhow::Result<PreparedDownload> {
    let details = explore::details_raw(st, slug, true).await?;
    prepare_details(st, slug, details).await
}

/// Solo en desarrollo: prepara un magnet cualquiera (para probar el motor con
/// torrents legales, sin pasar por una ficha).
#[cfg(debug_assertions)]
pub async fn prepare_magnet(st: &Arc<AppState>, magnet: &str, title: &str) -> anyhow::Result<PreparedDownload> {
    let (_, hash) = hex_of(magnet)?;
    let details = explore::RepackDetails {
        repack: explore::Repack {
            source: "test".into(),
            id: i64::from_str_radix(&hash[..12], 16).unwrap_or(0),
            slug: format!("test-{}", &hash[..8]),
            title: title.into(),
            version: None,
            full_title: title.into(),
            url: String::new(),
            date: String::new(),
            number: None,
            cover: None,
            cover_full: None,
            hero: None,
            genres: vec![],
            companies: None,
            languages: None,
            original_size: None,
            repack_size: None,
            repack_bytes: None,
            selective: false,
            adult: false,
            status: Default::default(),
        },
        screenshots: vec![],
        features: vec![],
        install_size: None,
        description: None,
        magnet: Some(magnet.into()),
    };
    let slug = details.repack.slug.clone();
    prepare_details(st, &slug, details).await
}

async fn prepare_details(st: &Arc<AppState>, slug: &str, details: explore::RepackDetails) -> anyhow::Result<PreparedDownload> {
    let magnet = details.magnet.clone().ok_or_else(|| anyhow::anyhow!("Esta ficha no tiene torrent"))?;
    let (m, hash) = hex_of(&magnet)?;
    if let Some(row) = st.db.with(|c| repo::download_by_hash(c, &hash))? {
        if row.state != "installed" || !row.files_deleted {
            anyhow::bail!("«{}» ya está en tus descargas", row.title);
        }
        // Ya instalado y sin archivos: se puede volver a bajar.
        st.db.with(|c| repo::delete_download(c, row.id))?;
    }

    let notify = Arc::new(tokio::sync::Notify::new());
    st.downloads.cancel_prepare.lock().insert(slug.to_string(), notify.clone());
    st.downloads.preparing.fetch_add(1, Ordering::SeqCst);
    let res = async {
        let session = st.downloads.engine.ensure(st).await?;
        queue::kick(st);
        let opts = AddTorrentOptions {
            list_only: true,
            trackers: Some(m.trackers.clone()),
            ..Default::default()
        };
        tokio::select! {
            r = tokio::time::timeout(Duration::from_secs(120), session.add_torrent(AddTorrent::from_url(magnet.as_str()), Some(opts))) => {
                r.map_err(|_| anyhow::anyhow!("No se encontró a nadie compartiendo este torrent. Prueba más tarde."))?
            }
            _ = notify.notified() => anyhow::bail!("cancelado"),
        }
    }
    .await;
    st.downloads.preparing.fetch_sub(1, Ordering::SeqCst);
    st.downloads.cancel_prepare.lock().remove(slug);
    let resp = res?;
    let AddTorrentResponse::ListOnly(r) = resp else {
        anyhow::bail!("Ese torrent ya está en el motor de descargas");
    };

    let mut list = Vec::new();
    for (i, fd) in r.info.iter_file_details().enumerate() {
        if fd.attrs().padding {
            continue;
        }
        let path = fd.filename.to_vec().join("\\");
        list.push(files::classify(i, &path, fd.len));
    }
    let lang = st.settings.get().language;
    files::default_selection(&mut list, &lang);
    let name = r.info.name().map(|n| n.to_string()).unwrap_or_else(|| details.repack.title.clone());
    let total: u64 = list.iter().map(|f| f.size).sum();
    let d = defaults(st);
    let tok = token();
    let out = PreparedDownload {
        token: tok.clone(),
        slug: slug.to_string(),
        title: details.repack.title.clone(),
        version: details.repack.version.clone(),
        name: name.clone(),
        files: list.clone(),
        total_bytes: total,
        free_bytes: (!d.download_dir.is_empty()).then(|| win::disk_free(Path::new(&d.download_dir))).flatten(),
        dir: d.download_dir.clone(),
        install_size: details.install_size.clone(),
        install_free_bytes: (!d.install_dir.is_empty()).then(|| win::disk_free(Path::new(&d.install_dir))).flatten(),
        install_dir: d.install_dir,
    };
    let mut p = st.downloads.prepared.lock();
    p.retain(|_, v| v.created.elapsed() < Duration::from_secs(1800));
    p.insert(
        tok,
        Prepared {
            details,
            magnet,
            info_hash: hash,
            torrent: r.torrent_bytes.to_vec(),
            name,
            files: list,
            seen_peers: r.seen_peers,
            created: Instant::now(),
        },
    );
    Ok(out)
}

pub fn cancel_prepare(st: &AppState, slug_or_token: &str) {
    if let Some(n) = st.downloads.cancel_prepare.lock().remove(slug_or_token) {
        n.notify_waiters();
    }
    st.downloads.prepared.lock().remove(slug_or_token);
}

/// Confirma una descarga preparada con los archivos elegidos.
pub async fn start(st: &Arc<AppState>, tok: &str, selected: &[usize], dir: Option<String>) -> anyhow::Result<DownloadItem> {
    let (sel, row) = {
        let p = st.downloads.prepared.lock();
        let prep = p.get(tok).ok_or_else(|| anyhow::anyhow!("La lista de archivos caducó; vuelve a pulsar Descargar"))?;
        let sel = files::validate(&prep.files, selected)?;
        let size: u64 = prep.files.iter().filter(|f| sel.contains(&f.index)).map(|f| f.size).sum();
        (sel, (prep.name.clone(), size, prep.info_hash.clone()))
    };
    let (name, size, hash) = row;

    let base = dir
        .map(|d| crate::util::clean_dir(&d))
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| defaults(st).download_dir);
    if base.is_empty() {
        anyhow::bail!("Elige dónde guardar las descargas");
    }
    let base_path = PathBuf::from(&base);
    std::fs::create_dir_all(&base_path).map_err(|e| anyhow::anyhow!("No se puede usar la carpeta {base}: {e}"))?;
    if let Some(free) = win::disk_free(&base_path) {
        let need = size + 512 * 1024 * 1024;
        if free < need {
            anyhow::bail!(
                "No hay espacio en {}: hacen falta {} y quedan {}",
                base_path.display(),
                human(need),
                human(free)
            );
        }
    }
    // La primera vez, la carpeta elegida queda como la de descargas.
    if st.settings.get().download_dir.trim().is_empty() {
        let b = base.clone();
        let _ = st.settings.update(|s| s.download_dir = b);
    }
    let out = base_path.join(sanitize(&name));
    std::fs::create_dir_all(&out)?;
    let _ = std::fs::write(out.join(MARKER), format!("ejGames\n{hash}\n"));

    let prep = st.downloads.prepared.lock().remove(tok).ok_or_else(|| anyhow::anyhow!("La lista de archivos caducó"))?;
    let r = &prep.details.repack;
    let new = NewDownload {
        source: r.source.clone(),
        source_id: format!("{}:{}", r.source, r.id),
        slug: Some(r.slug.clone()),
        title: r.title.clone(),
        version: r.version.clone(),
        page_url: Some(r.url.clone()),
        cover_url: r.cover.clone(),
        hero_url: r.hero.clone(),
        magnet: prep.magnet.clone(),
        info_hash: prep.info_hash.clone(),
        torrent: prep.torrent.clone(),
        torrent_name: prep.name.clone(),
        output_dir: out.to_string_lossy().to_string(),
        selected_files: sel,
        file_count: prep.files.len() as i64,
        total_bytes: size as i64,
        install_size: prep.details.install_size.clone(),
    };
    let id = st.db.with(|c| repo::insert_download(c, &new))?;
    st.downloads.live.lock().insert(
        id,
        Live {
            total: size,
            ..Default::default()
        },
    );
    queue::remember_peers(id, prep.seen_peers);
    tracing::info!("descarga añadida: {} ({})", new.title, human(size));
    queue::reconcile(st).await;
    emit_changed(st);
    get_item(st, id)
}

pub fn human(b: u64) -> String {
    let gb = b as f64 / 1024f64.powi(3);
    if gb >= 1.0 {
        format!("{gb:.1} GB")
    } else {
        format!("{:.0} MB", b as f64 / 1024f64.powi(2))
    }
}

// ───────────────────────────── control ─────────────────────────────

fn targets(st: &AppState, id: Option<i64>, states: &[&str]) -> anyhow::Result<Vec<DownloadRow>> {
    Ok(st
        .db
        .with(repo::list_downloads)?
        .into_iter()
        .filter(|r| id.map(|i| i == r.id).unwrap_or(true) && states.contains(&r.state.as_str()))
        .collect())
}

pub async fn pause(st: &Arc<AppState>, id: Option<i64>) -> anyhow::Result<()> {
    queue::save_progress(st);
    for r in targets(st, id, &["queued", "downloading"])? {
        st.db.with(|c| repo::set_download_state(c, r.id, "paused", Some("user"), None))?;
    }
    queue::reconcile(st).await;
    emit_changed(st);
    Ok(())
}

pub async fn resume(st: &Arc<AppState>, id: Option<i64>) -> anyhow::Result<()> {
    for r in targets(st, id, &["paused", "error"])? {
        st.db.with(|c| repo::set_download_state(c, r.id, "queued", None, None))?;
    }
    queue::reconcile(st).await;
    emit_changed(st);
    Ok(())
}

pub async fn move_to(st: &Arc<AppState>, id: i64, pos: usize) -> anyhow::Result<()> {
    st.db.with_mut(|c| repo::move_download(c, id, pos))?;
    queue::reconcile(st).await;
    emit_changed(st);
    Ok(())
}

/// Borra la carpeta de una descarga si es nuestra (tiene la marca).
pub fn delete_files(row: &DownloadRow) -> anyhow::Result<()> {
    let dir = Path::new(&row.output_dir);
    if !dir.is_dir() {
        return Ok(());
    }
    if !dir.join(MARKER).exists() {
        anyhow::bail!("La carpeta {} no es de ejGames; bórrala a mano si quieres", dir.display());
    }
    std::fs::remove_dir_all(dir).map_err(|e| anyhow::anyhow!("No se pudo borrar {}: {e}", dir.display()))
}

/// Saca un torrent del motor (conservando los archivos).
pub async fn forget(st: &AppState, info_hash: &str) {
    let Some(s) = st.downloads.engine.get() else { return };
    let Ok(id) = info_hash.parse::<librqbit_core::Id20>() else { return };
    if s.get(id.into()).is_some() {
        if let Err(e) = s.delete(id.into(), false).await {
            tracing::warn!("olvidar torrent: {e:#}");
        }
    }
}

pub async fn remove(st: &Arc<AppState>, id: i64, delete: bool) -> anyhow::Result<()> {
    let row = st.db.with(|c| repo::get_download(c, id))?.ok_or_else(|| anyhow::anyhow!("Esa descarga ya no existe"))?;
    if row.state == "installing" {
        anyhow::bail!("Espera a que termine la instalación");
    }
    forget(st, &row.info_hash).await;
    if delete && !row.files_deleted {
        let r = row.clone();
        tauri::async_runtime::spawn_blocking(move || delete_files(&r)).await??;
    }
    st.db.with(|c| repo::delete_download(c, id))?;
    st.downloads.live.lock().remove(&id);
    queue::reconcile(st).await;
    emit_changed(st);
    Ok(())
}

/// Borra los archivos de un repack ya instalado y conserva la entrada.
pub async fn delete_repack(st: &Arc<AppState>, id: i64) -> anyhow::Result<()> {
    let row = st.db.with(|c| repo::get_download(c, id))?.ok_or_else(|| anyhow::anyhow!("Esa descarga ya no existe"))?;
    forget(st, &row.info_hash).await;
    let r = row.clone();
    tauri::async_runtime::spawn_blocking(move || delete_files(&r)).await??;
    st.db.with(|c| repo::set_download_files_deleted(c, id))?;
    emit_changed(st);
    Ok(())
}

// ───────────────────────────── ciclo de vida ─────────────────────────────

impl Downloads {
    /// Hay que seguir en marcha (bajando, compartiendo o instalando).
    pub fn keep_alive(&self, st: &AppState) -> bool {
        self.installing.lock().is_some()
            || st
                .db
                .with(|c| c.query_row("SELECT COUNT(*) FROM downloads WHERE state IN ('queued', 'downloading', 'seeding')", [], |r| r.get::<_, i64>(0)))
                .map(|n| n > 0)
                .unwrap_or(false)
    }
}

/// Al arrancar: retoma lo pendiente (el motor solo arranca si hace falta).
pub async fn startup(st: &Arc<AppState>) {
    // Una instalación que quedó a medias al cerrar ejGames.
    if let Ok(rows) = st.db.with(repo::list_downloads) {
        for r in rows.iter().filter(|r| r.state == "installing") {
            install::recover(st, r).await;
        }
    }
    queue::reconcile(st).await;
}

/// Al salir: guarda el progreso y para el motor (con tiempo límite).
pub fn shutdown(st: &Arc<AppState>) {
    queue::save_progress(st);
    let st = st.clone();
    tauri::async_runtime::block_on(async move {
        let _ = tokio::time::timeout(Duration::from_secs(3), st.downloads.engine.stop()).await;
    });
}
