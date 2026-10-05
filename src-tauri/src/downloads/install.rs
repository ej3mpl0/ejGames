//! Instalar un repack: abre su setup.exe (Inno Setup, pide administrador),
//! espera a que termine, averigua dónde quedó el juego y lo mete en la
//! biblioteca.

use super::{emit_changed, forget, queue, sanitize, win};
use crate::db::models::DownloadRow;
use crate::db::repo;
use crate::events;
use crate::library::{exe_detect, scanner};
use crate::state::AppState;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Emitter;

fn emit(st: &AppState, id: i64, phase: &str, message: Option<String>, game_id: Option<i64>) {
    let _ = st.app.emit("downloads:install", json!({ "id": id, "phase": phase, "message": message, "gameId": game_id }));
}

/// Carpeta donde se propone instalar (Inno Setup la pone por defecto).
fn target(st: &AppState, row: &DownloadRow) -> Option<PathBuf> {
    let base = super::defaults(st).install_dir;
    (!base.is_empty()).then(|| Path::new(&base).join(sanitize(&crate::explore::parse::clean_repack_title(&row.title))))
}

pub async fn install(st: &Arc<AppState>, id: i64) -> anyhow::Result<()> {
    let row = st.db.with(|c| repo::get_download(c, id))?.ok_or_else(|| anyhow::anyhow!("Esa descarga ya no existe"))?;
    if !matches!(row.state.as_str(), "seeding" | "completed") {
        anyhow::bail!("«{}» aún no ha terminado de descargarse", row.title);
    }
    if row.files_deleted {
        anyhow::bail!("Los archivos de este repack ya se borraron");
    }
    // Descargas de los catálogos: ROMs que se ordenan y se meten en la biblioteca.
    if row.source == "catalog" {
        return install_catalog(st, row).await;
    }
    let setup = Path::new(&row.output_dir).join("setup.exe");
    if !setup.is_file() {
        anyhow::bail!("No encuentro setup.exe en {}", row.output_dir);
    }
    {
        let mut g = st.downloads.installing.lock();
        if g.is_some() {
            anyhow::bail!("Ya hay una instalación en curso");
        }
        *g = Some(id);
    }
    // Windows no deja ejecutar el setup (ni leer bien los .bin) mientras el
    // motor tiene los archivos abiertos.
    forget(st, &row.info_hash).await;
    st.db.with(|c| repo::set_download_state(c, id, "installing", None, None))?;
    let dest = target(st, &row);
    if let Some(d) = &dest {
        scanner::set_ignored(d, true);
        let _ = st.db.with(|c| repo::set_download_install_dir(c, id, &d.to_string_lossy()));
    }
    // Pausa el resto de descargas: el instalador necesita el disco.
    queue::reconcile(st).await;
    emit_changed(st);
    emit(st, id, "running", None, None);

    let st2 = st.clone();
    std::thread::Builder::new().name("ejg-install".into()).spawn(move || run(st2, row, setup, dest))?;
    Ok(())
}

async fn install_catalog(st: &Arc<AppState>, row: DownloadRow) -> anyhow::Result<()> {
    let id = row.id;
    {
        let mut g = st.downloads.installing.lock();
        if g.is_some() {
            anyhow::bail!("Ya hay una instalación en curso");
        }
        *g = Some(id);
    }
    // Los archivos se mueven: el motor tiene que soltarlos antes.
    forget(st, &row.info_hash).await;
    st.db.with(|c| repo::set_download_state(c, id, "installing", None, None))?;
    queue::reconcile(st).await;
    emit_changed(st);
    emit(st, id, "running", None, None);
    let st2 = st.clone();
    tauri::async_runtime::spawn(async move {
        let st = st2;
        match crate::catalogs::pipeline::from_torrent(&st, &row).await {
            Ok(o) => {
                let gid = o.game_ids.first().copied();
                let _ = st.db.with(|c| repo::set_download_installed(c, id, &o.dir, gid));
                if st.settings.get().delete_repack_after_install {
                    let r = row.clone();
                    if let Ok(Ok(())) = tauri::async_runtime::spawn_blocking(move || super::delete_files(&r)).await {
                        let _ = st.db.with(|c| repo::set_download_files_deleted(c, id));
                    }
                }
                let msg = if o.not_emulated {
                    format!("«{}»: {} {}", row.title, crate::i18n::t("sin emulador en ejGames; los archivos están en"), o.dir)
                } else {
                    format!("«{}» {}", row.title, crate::i18n::t("ya está en tu biblioteca."))
                };
                events::toast(&st, "ok", msg);
                emit(&st, id, "done", None, gid);
            }
            Err(e) => {
                let msg = format!("{e:#}");
                let _ = st.db.with(|c| repo::set_download_state(c, id, "completed", None, Some(&msg)));
                emit(&st, id, "error", Some(msg.clone()), None);
                events::toast(&st, "error", msg);
            }
        }
        *st.downloads.installing.lock() = None;
        queue::reconcile(&st).await;
        emit_changed(&st);
    });
    Ok(())
}

enum Outcome {
    Done(PathBuf),
    NotFound,
    Cancelled(String),
    Failed(String),
}

fn run(st: Arc<AppState>, row: DownloadRow, setup: PathBuf, dest: Option<PathBuf>) {
    let before = win::uninstall_snapshot();
    // Solo en desarrollo: EJGAMES_INSTALL_VERB=open prueba sin pedir administrador.
    let test = cfg!(debug_assertions) && std::env::var("EJGAMES_INSTALL_VERB").map(|v| v == "open").unwrap_or(false);
    let verb = if test { "open" } else { "runas" };
    let params = dest.as_ref().map(|d| format!("/DIR=\"{}\"", d.display())).unwrap_or_default();
    tracing::info!("instalando {} ({verb} {} {params})", row.title, setup.display());

    let outcome = match start(verb, &setup, &params, &row.output_dir) {
        Err(o) => o,
        Ok(code) => match code {
            Some(0) | None => {
                let after = win::uninstall_snapshot();
                match find_install_dir(dest.as_deref(), &before, &after) {
                    Some(dir) => Outcome::Done(dir),
                    None => Outcome::NotFound,
                }
            }
            // Inno Setup: 2 = cancelado antes de empezar, 5 = cancelado durante.
            Some(2) | Some(5) => Outcome::Cancelled("Instalación cancelada".into()),
            Some(c) => Outcome::Failed(format!("El instalador terminó con un error (código {c})")),
        },
    };
    if let Some(d) = &dest {
        scanner::set_ignored(d, false);
    }
    tauri::async_runtime::block_on(finish(&st, &row, outcome));
}

#[cfg(windows)]
fn start(verb: &str, setup: &Path, params: &str, dir: &str) -> Result<Option<u32>, Outcome> {
    use crate::launcher::launch::{start_installer, InstallerError};
    match start_installer(verb, &setup.to_string_lossy(), params, Some(dir)) {
        Err(InstallerError::Cancelled) => Err(Outcome::Cancelled("Has cancelado el permiso de administrador".into())),
        Err(InstallerError::Other(e)) => Err(Outcome::Failed(format!("No se pudo abrir el instalador: {e:#}"))),
        Ok(None) => Ok(None),
        Ok(Some(p)) => {
            while !p.wait(1000) {}
            Ok(p.exit_code())
        }
    }
}

#[cfg(not(windows))]
fn start(_verb: &str, _setup: &Path, _params: &str, _dir: &str) -> Result<Option<u32>, Outcome> {
    Err(Outcome::Failed("Solo en Windows".into()))
}

fn has_exe(dir: &Path) -> bool {
    walkdir::WalkDir::new(dir)
        .max_depth(3)
        .into_iter()
        .flatten()
        .any(|e| e.file_type().is_file() && e.path().extension().map(|x| x.eq_ignore_ascii_case("exe")).unwrap_or(false))
}

fn find_install_dir(dest: Option<&Path>, before: &win::UninstallSnapshot, after: &win::UninstallSnapshot) -> Option<PathBuf> {
    if let Some(d) = dest.filter(|d| d.is_dir() && has_exe(d)) {
        return Some(d.to_path_buf());
    }
    win::new_install_dirs(before, after).into_iter().map(PathBuf::from).find(|d| has_exe(d))
}

/// Mete el juego instalado en la biblioteca. Devuelve su id.
pub async fn register(st: &Arc<AppState>, row: &DownloadRow, dir: &Path) -> anyhow::Result<i64> {
    let d = dir.to_path_buf();
    let analysis = tauri::async_runtime::spawn_blocking(move || exe_detect::analyze(&d)).await?;
    let a = analysis.ok_or_else(|| anyhow::anyhow!("No encuentro el ejecutable del juego en {}", dir.display()))?;
    let mut g = scanner::to_new_game(&a, None).ok_or_else(|| anyhow::anyhow!("No encuentro el ejecutable del juego en {}", dir.display()))?;
    g.source = "repack".into();
    g.source_id = row.source_id.clone();
    g.title = row.title.clone();
    let candidates = g.exe_candidates.clone();
    let res = st.db.with_mut(|c| {
        let tx = c.transaction()?;
        let r = repo::upsert_game(&tx, &g)?;
        if let Some((id, _)) = r {
            repo::replace_exe_candidates(&tx, id, &candidates)?;
        }
        tx.commit()?;
        Ok(r)
    })?;
    let (id, is_new) = res.ok_or_else(|| anyhow::anyhow!("Esa carpeta ya es de otro juego de tu biblioteca"))?;
    if is_new {
        crate::services::after_new_games(st, vec![(id, g.exe_path.clone())]).await;
    } else {
        events::library_changed(st, vec![id]);
    }
    Ok(id)
}

async fn finish(st: &Arc<AppState>, row: &DownloadRow, outcome: Outcome) {
    let id = row.id;
    match outcome {
        Outcome::Done(dir) => complete(st, row, &dir).await,
        Outcome::NotFound => {
            let msg = "No sé dónde se instaló. Elige la carpeta del juego.".to_string();
            let _ = st.db.with(|c| repo::set_download_state(c, id, "completed", Some("needs-folder"), Some(&msg)));
            emit(st, id, "needs-folder", Some(msg), None);
        }
        Outcome::Cancelled(msg) => {
            let _ = st.db.with(|c| repo::set_download_state(c, id, "completed", None, None));
            emit(st, id, "cancelled", Some(msg.clone()), None);
            events::toast(st, "info", msg);
        }
        Outcome::Failed(msg) => {
            let _ = st.db.with(|c| repo::set_download_state(c, id, "completed", None, Some(&msg)));
            emit(st, id, "error", Some(msg.clone()), None);
            events::toast(st, "error", msg);
        }
    }
    *st.downloads.installing.lock() = None;
    queue::reconcile(st).await;
    emit_changed(st);
}

async fn complete(st: &Arc<AppState>, row: &DownloadRow, dir: &Path) {
    let id = row.id;
    let game_id = match register(st, row, dir).await {
        Ok(g) => Some(g),
        Err(e) => {
            tracing::warn!("alta del juego instalado: {e:#}");
            events::toast(st, "error", format!("{e:#}"));
            None
        }
    };
    let _ = st.db.with(|c| repo::set_download_installed(c, id, &dir.to_string_lossy(), game_id));
    tracing::info!("instalado {} en {}", row.title, dir.display());
    if st.settings.get().delete_repack_after_install {
        let r = row.clone();
        match tauri::async_runtime::spawn_blocking(move || super::delete_files(&r)).await {
            Ok(Ok(())) => {
                let _ = st.db.with(|c| repo::set_download_files_deleted(c, id));
            }
            Ok(Err(e)) => tracing::warn!("borrar repack: {e:#}"),
            Err(e) => tracing::warn!("borrar repack: {e}"),
        }
    }
    events::toast(st, "ok", format!("«{}» instalado. Ya está en tu biblioteca.", row.title));
    emit(st, id, "done", None, game_id);
}

/// El usuario eligió a mano la carpeta del juego instalado.
pub async fn finish_manual(st: &Arc<AppState>, id: i64, dir: &str) -> anyhow::Result<()> {
    let row = st.db.with(|c| repo::get_download(c, id))?.ok_or_else(|| anyhow::anyhow!("Esa descarga ya no existe"))?;
    let path = PathBuf::from(crate::util::clean_dir(dir));
    if !path.is_dir() {
        anyhow::bail!("Esa carpeta no existe");
    }
    complete(st, &row, &path).await;
    queue::reconcile(st).await;
    emit_changed(st);
    Ok(())
}

/// Al arrancar, una instalación que quedó a medias (se cerró ejGames).
pub async fn recover(st: &Arc<AppState>, row: &DownloadRow) {
    let dest = row.install_dir.as_deref().map(PathBuf::from).filter(|d| d.is_dir() && has_exe(d));
    match dest {
        Some(d) => complete(st, row, &d).await,
        None => {
            let _ = st.db.with(|c| repo::set_download_state(c, row.id, "completed", None, None));
        }
    }
}
