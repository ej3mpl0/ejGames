//! API del host (React). Los temas NO llaman a esto: pasan por el puente
//! postMessage del host, que decide qué exponer.

use crate::db::models::*;
use crate::db::repo;
use crate::launcher::RunningGame;
use crate::library::scanner::{self, FolderInspection};
use crate::metadata::{self, queue::Job, ArtItem, Candidate};
use crate::settings::Settings;
use crate::state::AppState;
use crate::themes::{self, ThemeInfo};
use crate::util::{blocking, CmdError, CmdResult};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

type St<'a> = State<'a, Arc<AppState>>;

fn active(st: &AppState) -> CmdResult<i64> {
    st.profile.read().ok_or_else(|| CmdError::Msg("No hay perfil activo".into()))
}

// ───────────────────────────── arranque ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    profiles: Vec<Profile>,
    settings: Settings,
    themes: Vec<ThemeInfo>,
    active_profile: Option<i64>,
    safe_mode: bool,
    version: String,
    data_dir: String,
    portable: bool,
    running: Vec<RunningGame>,
    has_folders: bool,
    downloads: Vec<crate::downloads::DownloadItem>,
}

#[tauri::command]
pub async fn bootstrap(st: St<'_>) -> CmdResult<Bootstrap> {
    let s = st.inner().clone();
    let (profiles, has_folders) = blocking({
        let s = s.clone();
        move || s.db.with(|c| Ok((repo::list_profiles(c)?, !repo::list_folders(c)?.is_empty())))
    })
    .await?;
    let active_profile = *s.profile.read();
    Ok(Bootstrap {
        profiles,
        settings: s.settings.get(),
        themes: themes::list(&s.paths),
        active_profile,
        safe_mode: s.safe_mode,
        version: s.app.package_info().version.to_string(),
        data_dir: s.paths.root.to_string_lossy().to_string(),
        portable: s.paths.portable,
        running: s.sessions.list(),
        has_folders,
        downloads: crate::downloads::list(&s).unwrap_or_default(),
    })
}

/// El host ya pintó: mostrar la ventana (se crea oculta para evitar destellos).
#[tauri::command]
pub async fn app_ready(window: tauri::WebviewWindow) -> CmdResult<()> {
    window.show()?;
    window.set_focus()?;
    Ok(())
}

#[tauri::command]
pub async fn window_action(window: tauri::WebviewWindow, action: String, value: Option<bool>) -> CmdResult<()> {
    match action.as_str() {
        "minimize" => window.minimize()?,
        "toggle-maximize" => {
            if window.is_maximized()? {
                window.unmaximize()?
            } else {
                window.maximize()?
            }
        }
        "close" => window.close()?,
        "hide" => window.hide()?,
        "fullscreen" => {
            let v = value.unwrap_or(!window.is_fullscreen()?);
            window.set_fullscreen(v)?
        }
        "drag" => window.start_dragging()?,
        _ => return Err(CmdError::Msg("acción desconocida".into())),
    }
    Ok(())
}

#[tauri::command]
pub async fn window_state(window: tauri::WebviewWindow) -> CmdResult<Value> {
    Ok(serde_json::json!({
        "maximized": window.is_maximized()?,
        "fullscreen": window.is_fullscreen()?,
    }))
}

// ───────────────────────────── perfiles ─────────────────────────────

#[tauri::command]
pub async fn list_profiles(st: St<'_>) -> CmdResult<Vec<Profile>> {
    let s = st.inner().clone();
    blocking(move || s.db.with(repo::list_profiles)).await
}

#[tauri::command]
pub async fn create_profile(st: St<'_>, name: String, color: String, theme_id: String) -> CmdResult<Profile> {
    let s = st.inner().clone();
    let name = name.trim().chars().take(32).collect::<String>();
    if name.is_empty() {
        return Err(CmdError::Msg("El nombre no puede estar vacío".into()));
    }
    blocking(move || {
        s.db.with(|c| {
            let id = repo::create_profile(c, &name, &color, &theme_id)?;
            repo::get_profile(c, id)
        })
    })
    .await
}

#[tauri::command]
pub async fn update_profile(st: St<'_>, id: i64, patch: ProfilePatch) -> CmdResult<Profile> {
    let s = st.inner().clone();
    let r = blocking(move || {
        s.db.with(|c| {
            repo::update_profile(c, id, &patch)?;
            repo::get_profile(c, id)
        })
    })
    .await?;
    watch_active_theme(st.inner());
    Ok(r)
}

#[tauri::command]
pub async fn delete_profile(st: St<'_>, id: i64) -> CmdResult<()> {
    let s = st.inner().clone();
    let count = blocking({
        let s = s.clone();
        move || s.db.with(|c| Ok(repo::list_profiles(c)?.len()))
    })
    .await?;
    if count <= 1 {
        return Err(CmdError::Msg("Tiene que quedar al menos un perfil".into()));
    }
    blocking(move || s.db.with(|c| repo::delete_profile(c, id))).await?;
    if *st.profile.read() == Some(id) {
        *st.profile.write() = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn login(st: St<'_>, id: i64, pin: Option<String>) -> CmdResult<Profile> {
    let s = st.inner().clone();
    let pin = pin.unwrap_or_default();
    let p = blocking(move || {
        s.db.with(|c| {
            if !repo::verify_pin(c, id, &pin)? {
                return Ok(None);
            }
            repo::touch_profile(c, id)?;
            repo::get_profile(c, id).map(Some)
        })
    })
    .await?
    .ok_or_else(|| CmdError::Msg("PIN incorrecto".into()))?;
    *st.profile.write() = Some(id);
    st.settings.update(|s| s.last_profile = Some(id))?;
    watch_active_theme(st.inner());
    Ok(p)
}

#[tauri::command]
pub async fn logout(st: St<'_>) -> CmdResult<()> {
    *st.profile.write() = None;
    Ok(())
}

#[tauri::command]
pub async fn set_avatar(st: St<'_>, id: i64, path: Option<String>) -> CmdResult<Profile> {
    let s = st.inner().clone();
    blocking(move || {
        let url = match path {
            Some(p) => {
                let bytes = std::fs::read(&p)?;
                let img = image::load_from_memory(&bytes)?;
                let img = img.resize_to_fill(256, 256, image::imageops::FilterType::Triangle);
                let mut out = std::io::Cursor::new(Vec::new());
                img.to_rgb8().write_to(&mut out, image::ImageFormat::Jpeg)?;
                let hash = crate::media::store::put(&s.paths, out.get_ref(), "jpg")?;
                Some(media_url(&hash, "jpg"))
            }
            None => None,
        };
        s.db.with(|c| {
            repo::update_profile(c, id, &ProfilePatch { avatar: Some(url), ..Default::default() })?;
            repo::get_profile(c, id)
        })
    })
    .await
}

/// Copia una imagen (o vídeo mp4/webm) elegida por el usuario al almacén de
/// medios y devuelve su URL ejg-media (para fondos y ajustes de tipo imagen).
#[tauri::command]
pub async fn import_image(st: St<'_>, path: String, max: Option<u32>) -> CmdResult<String> {
    let s = st.inner().clone();
    blocking(move || {
        let lower = path.to_ascii_lowercase();
        let bytes = std::fs::read(&path)?;
        if lower.ends_with(".mp4") || lower.ends_with(".webm") {
            if bytes.len() > 300 * 1024 * 1024 {
                anyhow::bail!("El vídeo es demasiado grande (máx. 300 MB)");
            }
            let ext = if lower.ends_with(".mp4") { "mp4" } else { "webm" };
            let hash = crate::media::store::put(&s.paths, &bytes, ext)?;
            return Ok(media_url(&hash, ext));
        }
        let ext = crate::media::store::ext_for(&bytes, "png");
        let max = max.unwrap_or(2560);
        let img = image::load_from_memory(&bytes)?;
        // GIF animados y tamaños razonables se guardan tal cual.
        if ext == "gif" || (img.width() <= max && img.height() <= max) {
            let hash = crate::media::store::put(&s.paths, &bytes, &ext)?;
            return Ok(media_url(&hash, &ext));
        }
        let small = img.resize(max, max, image::imageops::FilterType::Triangle);
        let mut out = std::io::Cursor::new(Vec::new());
        let ext = if small.color().has_alpha() {
            small.write_to(&mut out, image::ImageFormat::Png)?;
            "png"
        } else {
            small.to_rgb8().write_to(&mut out, image::ImageFormat::Jpeg)?;
            "jpg"
        };
        let hash = crate::media::store::put(&s.paths, out.get_ref(), ext)?;
        Ok(media_url(&hash, ext))
    })
    .await
}

#[tauri::command]
pub async fn set_theme_settings(st: St<'_>, theme_id: String, values: Value) -> CmdResult<()> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::set_theme_settings(c, pid, &theme_id, &values))).await
}

#[tauri::command]
pub async fn set_custom_css(st: St<'_>, theme_id: String, css: String) -> CmdResult<()> {
    let pid = active(&st)?;
    if css.len() > 256 * 1024 {
        return Err(CmdError::Msg("CSS demasiado grande".into()));
    }
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::set_custom_css(c, pid, &theme_id, &css))).await
}

// ───────────────────────────── biblioteca ─────────────────────────────

fn mark_running(st: &AppState, mut games: Vec<LibGame>) -> Vec<LibGame> {
    let running: Vec<i64> = st.sessions.list().iter().map(|r| r.game_id).collect();
    for g in games.iter_mut() {
        g.running = running.contains(&g.id);
    }
    games
}

#[tauri::command]
pub async fn get_library(st: St<'_>) -> CmdResult<Vec<LibGame>> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    let games = blocking(move || s.db.with(|c| repo::library(c, pid))).await?;
    Ok(mark_running(&st, games))
}

#[tauri::command]
pub async fn get_games(st: St<'_>, ids: Vec<i64>) -> CmdResult<Vec<LibGame>> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    let games = blocking(move || s.db.with(|c| Ok(ids.iter().filter_map(|id| repo::lib_game(c, pid, *id).ok()).collect()))).await?;
    Ok(mark_running(&st, games))
}

#[tauri::command]
pub async fn get_game_details(st: St<'_>, id: i64) -> CmdResult<GameDetails> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    let mut d = blocking(move || s.db.with(|c| repo::game_details(c, pid, id))).await?;
    d.lib.running = st.sessions.is_running(id);
    Ok(d)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFull {
    game: Game,
    exe_candidates: Vec<(String, f64)>,
    media: Vec<MediaItem>,
    /// Por qué se abriría como administrador sin pedirlo en ejGames:
    /// "manifest" (el exe lo exige) o "windows" (marca de compatibilidad).
    elevation: Option<&'static str>,
}

#[tauri::command]
pub async fn get_game_full(st: St<'_>, id: i64) -> CmdResult<GameFull> {
    let s = st.inner().clone();
    blocking(move || {
        let (game, exe_candidates, media) =
            s.db.with(|c| Ok((repo::get_game(c, id)?, repo::exe_candidates(c, id)?, repo::list_media(c, id, None)?)))?;
        let elevation = game
            .exe_path
            .as_deref()
            .filter(|_| game.launch_uri.as_deref().unwrap_or("").is_empty())
            .and_then(|p| crate::launcher::admin::elevation_reason(std::path::Path::new(p)));
        Ok(GameFull { game, exe_candidates, media, elevation })
    })
    .await
}

#[tauri::command]
pub async fn update_game(st: St<'_>, id: i64, patch: GamePatch) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::update_game(c, id, &patch))).await?;
    crate::events::library_changed(&st, vec![id]);
    Ok(())
}

#[tauri::command]
pub async fn delete_game(st: St<'_>, id: i64) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::delete_game(c, id))).await?;
    crate::events::library_reset(&st);
    Ok(())
}

/// Qué hará «Desinstalar» con este juego (para el diálogo de confirmación).
#[tauri::command]
pub async fn uninstall_plan(st: St<'_>, id: i64) -> CmdResult<crate::library::uninstall::Plan> {
    let s = st.inner().clone();
    blocking(move || crate::library::uninstall::plan(&s, id)).await
}

/// Desinstala el juego: `started` (abierto su desinstalador o Steam) o `removed`.
#[tauri::command]
pub async fn uninstall_game(st: St<'_>, id: i64) -> CmdResult<String> {
    let s = st.inner().clone();
    blocking(move || crate::library::uninstall::run(s, id).map(String::from)).await
}

#[tauri::command]
pub async fn purge_missing(st: St<'_>) -> CmdResult<usize> {
    let s = st.inner().clone();
    let n = blocking(move || s.db.with(repo::purge_missing)).await?;
    crate::events::library_reset(&st);
    Ok(n)
}

#[tauri::command]
pub async fn set_favorite(st: St<'_>, id: i64, value: bool) -> CmdResult<()> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::set_favorite(c, pid, id, value))).await?;
    crate::events::library_changed(&st, vec![id]);
    Ok(())
}

#[tauri::command]
pub async fn set_hidden(st: St<'_>, id: i64, value: bool) -> CmdResult<()> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::set_hidden(c, pid, id, value))).await?;
    crate::events::library_changed(&st, vec![id]);
    Ok(())
}

#[tauri::command]
pub async fn set_user_rating(st: St<'_>, id: i64, value: Option<i64>) -> CmdResult<()> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::set_user_rating(c, pid, id, value))).await?;
    crate::events::library_changed(&st, vec![id]);
    Ok(())
}

#[tauri::command]
pub async fn add_manual_game(st: St<'_>, exe: String) -> CmdResult<i64> {
    Ok(crate::services::add_manual(st.inner(), exe).await?)
}

// ───────────────────────────── carpetas ─────────────────────────────

#[tauri::command]
pub async fn inspect_folder(path: String) -> CmdResult<FolderInspection> {
    blocking(move || Ok(scanner::inspect(&PathBuf::from(path)))).await
}

#[tauri::command]
pub async fn list_folders(st: St<'_>) -> CmdResult<Vec<LibraryFolder>> {
    let s = st.inner().clone();
    blocking(move || s.db.with(repo::list_folders)).await
}

#[tauri::command]
pub async fn add_folder(st: St<'_>, path: String, mode: String) -> CmdResult<i64> {
    let mode = if mode == "single" { "single" } else { "subfolders" }.to_string();
    let s = st.inner().clone();
    let path_norm = crate::util::clean_dir(&path);
    if !PathBuf::from(&path_norm).is_dir() {
        return Err(CmdError::Msg(format!("No existe la carpeta: {path_norm}")));
    }
    let id = blocking(move || s.db.with(|c| repo::add_folder(c, &path_norm, &mode))).await?;
    crate::services::sync_watcher(st.inner());
    let s = st.inner().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::services::scan_folder(&s, id, false).await {
            crate::events::toast(&s, "error", format!("{e:#}"));
        }
    });
    Ok(id)
}

#[tauri::command]
pub async fn remove_folder(st: St<'_>, id: i64) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::remove_folder(c, id))).await?;
    crate::services::sync_watcher(st.inner());
    crate::events::library_reset(&st);
    Ok(())
}

#[tauri::command]
pub async fn rescan(st: St<'_>, folder_id: Option<i64>) -> CmdResult<()> {
    let s = st.inner().clone();
    tauri::async_runtime::spawn(async move {
        let r = match folder_id {
            Some(id) => crate::services::scan_folder(&s, id, false).await.map(|r| r.found),
            None => crate::services::scan_all(&s, false).await,
        };
        if let Err(e) = r {
            crate::events::toast(&s, "error", format!("{e:#}"));
        }
    });
    Ok(())
}

// ───────────────────────────── metadatos y arte ─────────────────────────────

#[tauri::command]
pub async fn refresh_metadata(st: St<'_>, ids: Option<Vec<i64>>, all: Option<bool>) -> CmdResult<usize> {
    let s = st.inner().clone();
    let jobs: Vec<Job> = blocking(move || {
        s.db.with(|c| {
            let games: Vec<Game> = match ids {
                Some(ids) => ids.iter().filter_map(|id| repo::get_game(c, *id).ok()).collect(),
                None => {
                    let statuses: &[&str] = if all.unwrap_or(false) {
                        &["pending", "failed", "review", "matched", "manual"]
                    } else {
                        &["pending", "failed"]
                    };
                    repo::games_by_status(c, statuses)?
                }
            };
            Ok(games.iter().filter_map(refresh_job).collect())
        })
    })
    .await?;
    let n = jobs.len();
    for j in jobs {
        st.meta.push(j);
    }
    crate::events::meta_progress(&st);
    Ok(n)
}

/// Qué hacer al actualizar un juego: lo elegido a mano se vuelve a descargar
/// con la misma coincidencia (no se busca otra).
fn refresh_job(g: &Game) -> Option<Job> {
    if g.meta_status != "manual" {
        return Some(Job::Game(g.id));
    }
    match (g.steam_appid, g.igdb_id) {
        (Some(a), _) => Some(Job::Forced(g.id, "steam".into(), a)),
        (None, Some(i)) => Some(Job::Forced(g.id, "igdb".into(), i)),
        // Todo a mano (sin proveedor): no hay nada que descargar.
        (None, None) => None,
    }
}

#[tauri::command]
pub async fn search_metadata(st: St<'_>, term: String) -> CmdResult<Vec<Candidate>> {
    Ok(metadata::search_all(&st, &term).await)
}

#[tauri::command]
pub async fn apply_match(st: St<'_>, game_id: i64, provider: String, id: i64) -> CmdResult<()> {
    if !matches!(provider.as_str(), "steam" | "igdb") {
        return Err(CmdError::Msg("proveedor no válido".into()));
    }
    if provider == "steam" {
        let s = st.inner().clone();
        blocking(move || {
            s.db.with(|c| c.execute("UPDATE games SET steam_appid = ?2 WHERE id = ?1", rusqlite::params![game_id, id]).map(|_| ()))
        })
        .await?;
    }
    st.meta.push(Job::Forced(game_id, provider, id));
    Ok(())
}

#[tauri::command]
pub async fn art_options(st: St<'_>, game_id: i64, kind: String) -> CmdResult<Vec<ArtItem>> {
    Ok(metadata::art_options(&st, game_id, &kind).await?)
}

/// Elegir arte por URL (de SteamGridDB u otra fuente): queda como elección del usuario.
#[tauri::command]
pub async fn set_art_url(st: St<'_>, game_id: i64, kind: String, url: String) -> CmdResult<()> {
    if !url.starts_with("https://") {
        return Err(CmdError::Msg("URL no válida".into()));
    }
    let s = st.inner().clone();
    let (k2, u2) = (kind.clone(), url.clone());
    let mid = blocking(move || s.db.with(|c| repo::insert_media(c, game_id, &k2, Some(&u2), "user", true, 0, None, None))).await?;
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::select_media(c, game_id, mid))).await?;
    crate::media::download::download_into(st.inner(), mid, &url, &kind).await?;
    crate::events::library_changed(&st, vec![game_id]);
    Ok(())
}

#[tauri::command]
pub async fn set_art_file(st: St<'_>, game_id: i64, kind: String, path: String) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || {
        let bytes = std::fs::read(&path)?;
        let stored = crate::media::store::store_image(&s.paths, &bytes, &kind)?;
        s.db.with(|c| {
            let mid = repo::insert_media(c, game_id, &kind, None, "user", true, 0, None, None)?;
            repo::set_media_file(c, mid, &stored.hash, &stored.ext, stored.thumb_hash.as_deref(), stored.w, stored.h)?;
            repo::select_media(c, game_id, mid)
        })
    })
    .await?;
    crate::events::library_changed(&st, vec![game_id]);
    Ok(())
}

#[tauri::command]
pub async fn select_media(st: St<'_>, game_id: i64, media_id: i64) -> CmdResult<()> {
    let s = st.inner().clone();
    let rec = blocking(move || {
        s.db.with(|c| {
            repo::select_media(c, game_id, media_id)?;
            repo::media_by_id(c, media_id)
        })
    })
    .await?;
    if let Some(r) = rec {
        if r.hash.is_none() {
            if let Some(url) = r.remote_url {
                let _ = crate::media::download::download_into(st.inner(), r.id, &url, &r.kind).await;
            }
        }
    }
    crate::events::library_changed(&st, vec![game_id]);
    Ok(())
}

#[tauri::command]
pub async fn meta_progress(st: St<'_>) -> CmdResult<(usize, usize)> {
    Ok(st.meta.progress())
}

// ───────────────────────────── jugar ─────────────────────────────

#[tauri::command]
pub async fn play(st: St<'_>, id: i64) -> CmdResult<()> {
    let pid = active(&st)?;
    Ok(crate::launcher::play(st.inner(), id, pid).await?)
}

#[tauri::command]
pub async fn stop_tracking(st: St<'_>, id: i64) -> CmdResult<()> {
    st.sessions.stop_tracking(id);
    Ok(())
}

#[tauri::command]
pub async fn running_games(st: St<'_>) -> CmdResult<Vec<RunningGame>> {
    Ok(st.sessions.list())
}

#[tauri::command]
pub async fn open_game_folder(app: tauri::AppHandle, st: St<'_>, id: i64) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let s = st.inner().clone();
    let g = blocking(move || s.db.with(|c| repo::get_game(c, id))).await?;
    let target = g.exe_path.clone().or(g.install_dir.clone()).ok_or_else(|| CmdError::Msg("Sin carpeta".into()))?;
    app.opener().reveal_item_in_dir(target).map_err(|e| CmdError::Msg(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn open_external(app: tauri::AppHandle, url: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("https://") {
        return Err(CmdError::Msg("URL no permitida".into()));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| CmdError::Msg(e.to_string()))?;
    Ok(())
}

// ───────────────────────────── estadísticas ─────────────────────────────

#[tauri::command]
pub async fn get_stats(st: St<'_>, days: Option<i64>) -> CmdResult<crate::stats::Stats> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| crate::stats::compute(c, pid, days.unwrap_or(90).clamp(7, 366)))).await
}

#[tauri::command]
pub async fn recent_sessions(st: St<'_>, limit: Option<i64>) -> CmdResult<Vec<Value>> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| crate::stats::recent_sessions(c, pid, limit.unwrap_or(30)))).await
}

// ───────────────────────────── colecciones ─────────────────────────────

#[tauri::command]
pub async fn list_collections(st: St<'_>) -> CmdResult<Vec<Collection>> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::list_collections(c, pid))).await
}

#[tauri::command]
pub async fn create_collection(st: St<'_>, name: String, kind: Option<String>, rules: Option<Value>) -> CmdResult<i64> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    let kind = kind.unwrap_or_else(|| "manual".into());
    let rules = rules.unwrap_or(Value::Object(Default::default()));
    let id = blocking(move || s.db.with(|c| repo::create_collection(c, pid, &name, &kind, &rules))).await?;
    crate::events::library_reset(&st);
    Ok(id)
}

#[tauri::command]
pub async fn update_collection(st: St<'_>, id: i64, name: Option<String>, rules: Option<Value>) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::update_collection(c, id, name.as_deref(), rules.as_ref()))).await?;
    crate::events::library_reset(&st);
    Ok(())
}

#[tauri::command]
pub async fn delete_collection(st: St<'_>, id: i64) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::delete_collection(c, id))).await?;
    crate::events::library_reset(&st);
    Ok(())
}

#[tauri::command]
pub async fn set_in_collection(st: St<'_>, collection_id: i64, game_id: i64, member: bool) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::set_in_collection(c, collection_id, game_id, member))).await?;
    crate::events::library_changed(&st, vec![game_id]);
    Ok(())
}

// ───────────────────────────── temas ─────────────────────────────

/// Recarga en vivo del tema del perfil activo (solo en modo desarrollador).
pub(crate) fn watch_active_theme(st: &Arc<AppState>) {
    if !st.settings.get().dev_mode {
        st.theme_dev.stop();
        return;
    }
    let Some(pid) = *st.profile.read() else { return };
    let Ok(p) = st.db.with(|c| repo::get_profile(c, pid)) else { return };
    if let Some(dir) = themes::dir_of(&st.paths, &p.theme_id) {
        let s = st.clone();
        st.theme_dev.watch(&p.theme_id, dir, move |id| crate::events::theme_changed(&s, &id));
    }
}

#[tauri::command]
pub async fn list_themes(st: St<'_>) -> CmdResult<Vec<ThemeInfo>> {
    let s = st.inner().clone();
    blocking(move || Ok(themes::list(&s.paths))).await
}

#[tauri::command]
pub async fn duplicate_theme(st: St<'_>, id: String) -> CmdResult<ThemeInfo> {
    let s = st.inner().clone();
    blocking(move || themes::duplicate(&s.paths, &id)).await
}

#[tauri::command]
pub async fn delete_theme(st: St<'_>, id: String) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || themes::delete(&s.paths, &id)).await
}

#[tauri::command]
pub async fn import_theme(st: St<'_>, path: String) -> CmdResult<ThemeInfo> {
    let s = st.inner().clone();
    blocking(move || themes::package::import(&s.paths, &PathBuf::from(path))).await
}

#[tauri::command]
pub async fn export_theme(st: St<'_>, id: String, dest: String) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || themes::package::export(&s.paths, &id, &PathBuf::from(dest))).await
}

#[tauri::command]
pub async fn open_theme_folder(app: tauri::AppHandle, st: St<'_>, id: Option<String>) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = match id {
        Some(id) => themes::dir_of(&st.paths, &id).ok_or_else(|| CmdError::Msg("tema no encontrado".into()))?,
        None => st.paths.user_themes.clone(),
    };
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| CmdError::Msg(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn theme_storage_get(st: St<'_>, theme_id: String) -> CmdResult<Value> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || s.db.with(|c| repo::theme_storage_get(c, pid, &theme_id))).await
}

#[tauri::command]
pub async fn theme_storage_set(st: St<'_>, theme_id: String, key: String, value: Value) -> CmdResult<()> {
    let pid = active(&st)?;
    if key.len() > 128 {
        return Err(CmdError::Msg("clave demasiado larga".into()));
    }
    let s = st.inner().clone();
    blocking(move || {
        s.db.with(|c| {
            // Lo que ocupe esta clave ahora no cuenta: se va a sustituir.
            let others = repo::theme_storage_size(c, pid, &theme_id, Some(&key))?;
            if others + (key.len() + value.to_string().len()) as i64 > 512 * 1024 {
                return Ok(Err(()));
            }
            repo::theme_storage_set(c, pid, &theme_id, &key, &value).map(Ok)
        })
    })
    .await?
    .map_err(|_| CmdError::Msg("Almacenamiento del tema lleno (512 KB)".into()))
}

// ───────────────────────────── ajustes ─────────────────────────────

#[tauri::command]
pub async fn get_settings(st: St<'_>) -> CmdResult<Settings> {
    Ok(st.settings.get())
}

#[tauri::command]
pub async fn update_settings(app: tauri::AppHandle, st: St<'_>, patch: Value) -> CmdResult<Settings> {
    let before = st.settings.get();
    let mut cur = serde_json::to_value(&before).map_err(|e| CmdError::Msg(e.to_string()))?;
    if let (Some(obj), Some(p)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            obj.insert(k.clone(), v.clone());
        }
    }
    let mut next: Settings = serde_json::from_value(cur).map_err(|e| CmdError::Msg(e.to_string()))?;
    for d in [&mut next.download_dir, &mut next.install_dir, &mut next.screenshot_dir] {
        if !d.trim().is_empty() {
            *d = crate::util::clean_dir(d);
        }
    }
    for k in [&next.overlay_hotkey, &next.screenshot_hotkey] {
        if !k.trim().is_empty() && crate::overlay::hotkey::parse(k).is_none() {
            return Err(CmdError::Msg(format!("Atajo no válido: {k}")));
        }
    }
    if !next.screenshot_hotkey.trim().is_empty()
        && crate::overlay::hotkey::parse(&next.screenshot_hotkey) == crate::overlay::hotkey::parse(&next.overlay_hotkey)
    {
        return Err(CmdError::Msg("El atajo de las capturas no puede ser el mismo que el del panel".into()));
    }
    if !crate::settings::OVERLAY_CORNERS.contains(&next.overlay_corner.as_str()) {
        return Err(CmdError::Msg("Posición de los avisos no válida".into()));
    }
    if !crate::settings::OVERLAY_STYLES.contains(&next.overlay_style.as_str()) {
        return Err(CmdError::Msg("Estilo de los avisos no válido".into()));
    }
    if !crate::settings::SEED_POLICIES.contains(&next.seed_policy.as_str()) {
        return Err(CmdError::Msg("Opción de compartir no válida".into()));
    }
    if !(0.1..=50.0).contains(&next.seed_ratio) {
        return Err(CmdError::Msg("El ratio debe estar entre 0,1 y 50".into()));
    }
    if !(1..=5).contains(&next.max_active_downloads) {
        return Err(CmdError::Msg("Descargas a la vez: de 1 a 5".into()));
    }
    let proxy = next.torrent_proxy.trim();
    if !proxy.is_empty() && !(proxy.starts_with("socks5://") && url::Url::parse(proxy).map(|u| u.port().is_some()).unwrap_or(false)) {
        return Err(CmdError::Msg("El proxy debe ser socks5://host:puerto".into()));
    }
    let saved = st.settings.update(|s| *s = next)?;
    if before.start_with_windows != saved.start_with_windows {
        use tauri_plugin_autostart::ManagerExt;
        let al = app.autolaunch();
        let _ = if saved.start_with_windows { al.enable() } else { al.disable() };
    }
    if before.dev_mode != saved.dev_mode {
        watch_active_theme(st.inner());
    }
    // Apagar Discord con una partida en marcha quita ya el «Jugando a…».
    if before.discord_enabled && !saved.discord_enabled {
        st.discord.clear();
    }
    {
        let (s2, b, a) = (st.inner().clone(), before.clone(), saved.clone());
        tauri::async_runtime::spawn(async move { crate::downloads::queue::settings_changed(&s2, &b, &a).await });
    }
    Ok(saved)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    media_mb: f64,
    trailers_mb: f64,
}

fn dir_mb(p: &std::path::Path) -> f64 {
    walkdir::WalkDir::new(p)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum::<u64>() as f64
        / 1_048_576.0
}

#[tauri::command]
pub async fn cache_info(st: St<'_>) -> CmdResult<CacheInfo> {
    let s = st.inner().clone();
    blocking(move || Ok(CacheInfo { media_mb: dir_mb(&s.paths.media), trailers_mb: dir_mb(&s.paths.trailers) })).await
}

#[tauri::command]
pub async fn clear_trailer_cache(st: St<'_>) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || {
        crate::media::trailers::prune(&s.paths.trailers, 0);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn open_data_dir(app: tauri::AppHandle, st: St<'_>) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(st.paths.root.to_string_lossy(), None::<&str>).map_err(|e| CmdError::Msg(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn quit(app: tauri::AppHandle) -> CmdResult<()> {
    app.exit(0);
    Ok(())
}

// ───────────────────────────── logros y overlay ─────────────────────────────

/// Logros de un juego (esquema + desbloqueos al día).
#[tauri::command]
pub async fn get_achievements(st: St<'_>, id: i64) -> CmdResult<crate::achievements::AchList> {
    let s = st.inner().clone();
    let profile = *s.profile.read();
    if let Err(e) = crate::achievements::refresh(&s, id, profile, std::time::Duration::from_secs(86400)).await {
        tracing::debug!("logros {id}: {e:#}");
    }
    blocking(move || s.db.with(|c| crate::achievements::list(c, id))).await
}

#[tauri::command]
pub async fn overlay_ready(st: St<'_>) -> CmdResult<crate::overlay::OverlayInit> {
    Ok(crate::overlay::on_ready(st.inner()))
}

#[tauri::command]
pub async fn overlay_idle(st: St<'_>) -> CmdResult<()> {
    crate::overlay::on_idle(st.inner());
    Ok(())
}

#[tauri::command]
pub async fn overlay_panel(st: St<'_>, open: bool, restore: Option<bool>) -> CmdResult<()> {
    if open {
        crate::overlay::open_panel(st.inner(), false);
    } else {
        crate::overlay::close_panel(st.inner(), restore.unwrap_or(true));
    }
    Ok(())
}

#[tauri::command]
pub async fn overlay_action(st: St<'_>, action: String) -> CmdResult<()> {
    let s = st.inner().clone();
    match action.as_str() {
        "launcher" => {
            crate::overlay::close_panel(&s, false);
            crate::lifecycle::show_main(&s);
        }
        "screenshot" => crate::overlay::screenshot(&s),
        "quit-game" => blocking(move || Ok(crate::overlay::quit_game(&s)?)).await?,
        // Seguir descargando mientras se juega (solo esta partida) o volver a pausar.
        "downloads-resume" | "downloads-pause" => {
            s.downloads.allow_while_playing.store(action == "downloads-resume", std::sync::atomic::Ordering::Relaxed);
            crate::downloads::queue::reconcile(&s).await;
        }
        "open-captures" => {
            let dir = blocking(move || {
                let title = s.sessions.list().first().map(|r| r.title.clone()).unwrap_or_default();
                let dir = if title.is_empty() { crate::overlay::capture::root(&s) } else { crate::overlay::capture::game_folder(&s, &title) };
                std::fs::create_dir_all(&dir)?;
                Ok(dir)
            })
            .await?;
            crate::overlay::close_panel(st.inner(), false);
            use tauri_plugin_opener::OpenerExt;
            st.app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| CmdError::Msg(e.to_string()))?;
        }
        _ => return Err(CmdError::Msg("acción no válida".into())),
    }
    Ok(())
}

/// Música del sistema: "toggle" | "next" | "prev".
#[tauri::command]
pub async fn overlay_media(cmd: String) -> CmdResult<()> {
    blocking(move || Ok(crate::overlay::live::media_command(&cmd)?)).await
}

/// Volumen (0..1) o silencio del juego ("game") o del sistema ("master").
#[tauri::command]
pub async fn overlay_volume(st: St<'_>, which: String, level: Option<f32>, muted: Option<bool>) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || Ok(crate::overlay::live::set_volume(&s, &which, level, muted)?)).await
}

/// Nota del juego en marcha (se guarda sola al escribir en el panel).
#[tauri::command]
pub async fn overlay_note(st: St<'_>, text: String) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || Ok(crate::overlay::set_live_note(&s, &text)?)).await
}

/// La página del overlay enseña un aviso: su sonido, a la vez.
#[tauri::command]
pub async fn overlay_chime(st: St<'_>, rare: bool) -> CmdResult<()> {
    crate::overlay::chime(st.inner(), rare);
    Ok(())
}

/// Aspecto de los avisos con los ajustes actuales (vista previa en Ajustes).
#[tauri::command]
pub async fn overlay_look(st: St<'_>) -> CmdResult<crate::overlay::Look> {
    let s = st.inner().clone();
    blocking(move || Ok(crate::overlay::look(&s))).await
}

#[tauri::command]
pub async fn overlay_test(st: St<'_>) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || {
        crate::overlay::test(&s);
        Ok(())
    })
    .await
}

/// Solo para el test de aislamiento del modo desarrollador: devuelve "pong".
#[tauri::command]
pub async fn ping() -> CmdResult<String> {
    Ok("pong".into())
}

// ───────────────────────────── explorar ─────────────────────────────

#[tauri::command]
pub async fn explore_home(st: St<'_>) -> CmdResult<crate::explore::Home> {
    Ok(crate::explore::home(st.inner()).await?)
}

#[tauri::command]
pub async fn explore_search(st: St<'_>, query: String, page: Option<u32>) -> CmdResult<crate::explore::SearchPage> {
    Ok(crate::explore::search(st.inner(), &query, page.unwrap_or(1)).await?)
}

/// Catálogo con filtros (géneros, orden, tamaño, los que ya tienes).
#[tauri::command]
pub async fn explore_browse(st: St<'_>, filters: crate::explore::Browse, page: Option<u32>) -> CmdResult<crate::explore::SearchPage> {
    Ok(crate::explore::browse(st.inner(), &filters, page.unwrap_or(1)).await?)
}

#[tauri::command]
pub async fn explore_genres() -> CmdResult<&'static [crate::explore::genres::Genre]> {
    Ok(crate::explore::genres::GENRES)
}

#[tauri::command]
pub async fn explore_details(st: St<'_>, slug: String) -> CmdResult<crate::explore::RepackDetails> {
    Ok(crate::explore::details(st.inner(), &slug).await?)
}

/// Lista de deseados del perfil (solo en este PC).
#[tauri::command]
pub async fn wishlist(st: St<'_>) -> CmdResult<Vec<crate::explore::wishlist::WishItem>> {
    Ok(crate::explore::wishlist::list(st.inner())?)
}

#[tauri::command]
pub async fn wishlist_add(st: St<'_>, slug: String) -> CmdResult<Vec<crate::explore::wishlist::WishItem>> {
    Ok(crate::explore::wishlist::add(st.inner(), &slug).await?)
}

#[tauri::command]
pub async fn wishlist_remove(st: St<'_>, slug: String) -> CmdResult<Vec<crate::explore::wishlist::WishItem>> {
    Ok(crate::explore::wishlist::remove(st.inner(), &slug)?)
}

// ───────────────────────────── guías de Steam ─────────────────────────────

#[tauri::command]
pub async fn guides_list(st: St<'_>, game_id: i64, query: Option<crate::guides::ListQuery>) -> CmdResult<crate::guides::GuideList> {
    Ok(crate::guides::list(st.inner(), game_id, query.unwrap_or_default()).await?)
}

#[tauri::command]
pub async fn guides_get(st: St<'_>, id: String) -> CmdResult<crate::guides::GuideView> {
    Ok(crate::guides::get(st.inner(), &id).await?)
}

#[tauri::command]
pub async fn guides_shelf(st: St<'_>, game_id: i64) -> CmdResult<crate::guides::Shelf> {
    let s = st.inner().clone();
    blocking(move || crate::guides::shelf(&s, game_id)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn guides_pin(st: St<'_>, game_id: i64, id: String, title: String, author: Option<String>, preview: Option<String>, value: bool) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || crate::guides::pin(&s, game_id, &id, &title, author.as_deref().unwrap_or(""), preview.as_deref(), value)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn guides_progress(
    st: St<'_>,
    game_id: i64,
    id: String,
    title: String,
    author: Option<String>,
    preview: Option<String>,
    section: u32,
    scroll: f64,
) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || crate::guides::set_progress(&s, game_id, &id, &title, author.as_deref().unwrap_or(""), preview.as_deref(), section, scroll)).await
}

// ───────────────────────────── trucos (trainers de FLiNG) ─────────────────────────────

#[tauri::command]
pub async fn trainer_info(st: St<'_>, game_id: i64) -> CmdResult<Option<crate::trainers::Installed>> {
    let s = st.inner().clone();
    blocking(move || Ok(crate::trainers::installed(&s, game_id))).await
}

#[tauri::command]
pub async fn trainer_find(st: St<'_>, game_id: i64, query: Option<String>) -> CmdResult<crate::trainers::Found> {
    Ok(crate::trainers::find(st.inner(), game_id, query).await?)
}

#[tauri::command]
pub async fn trainer_details(st: St<'_>, url: String) -> CmdResult<crate::trainers::fling::Page> {
    Ok(crate::trainers::details(st.inner(), &url).await?)
}

/// Solo desde la confirmación del host (o del overlay): los temas no lo llaman.
#[tauri::command]
pub async fn trainer_install(st: St<'_>, game_id: i64, page_url: String, download_url: String) -> CmdResult<crate::trainers::Installed> {
    Ok(crate::trainers::install(st.inner(), game_id, &page_url, &download_url).await?)
}

#[tauri::command]
pub async fn trainer_remove(st: St<'_>, game_id: i64) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || Ok(crate::trainers::remove(&s, game_id)?)).await
}

#[tauri::command]
pub async fn trainer_auto(st: St<'_>, game_id: i64, on: bool) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || Ok(crate::trainers::set_auto_start(&s, game_id, on)?)).await
}

#[tauri::command]
pub async fn trainer_status(st: St<'_>) -> CmdResult<crate::trainers::Live> {
    Ok(crate::trainers::run::status(st.inner()))
}

/// Abrirlo ya (desde el overlay). Si el juego va como administrador, Windows pide permiso.
#[tauri::command]
pub async fn trainer_start(st: St<'_>, game_id: i64) -> CmdResult<crate::trainers::Live> {
    let s = st.inner().clone();
    blocking(move || {
        crate::trainers::run::start(&s, game_id, true)?;
        Ok(crate::trainers::run::status(&s))
    })
    .await
}

#[tauri::command]
pub async fn trainer_trigger(st: St<'_>, keys: String) -> CmdResult<crate::trainers::Live> {
    let s = st.inner().clone();
    blocking(move || Ok(crate::trainers::run::trigger(&s, &keys)?)).await
}

#[tauri::command]
pub async fn trainer_show(st: St<'_>, visible: bool) -> CmdResult<crate::trainers::Live> {
    let s = st.inner().clone();
    blocking(move || Ok(crate::trainers::run::show(&s, visible)?)).await
}

#[tauri::command]
pub async fn trainer_reset(st: St<'_>) -> CmdResult<crate::trainers::Live> {
    Ok(crate::trainers::run::reset_toggles(st.inner()))
}

// ───────────────────────────── mapas (Map Genie) ─────────────────────────────

#[tauri::command]
pub async fn maps_for(st: St<'_>, game_id: i64) -> CmdResult<crate::maps::GameMaps> {
    Ok(crate::maps::for_game(st.inner(), game_id).await?)
}

#[tauri::command]
pub async fn maps_search(st: St<'_>, query: String) -> CmdResult<Vec<crate::maps::MapGame>> {
    Ok(crate::maps::search(st.inner(), &query).await?)
}

/// `slug`: juego de Map Genie; "" = sin mapa; null = emparejar solo.
#[tauri::command]
pub async fn maps_choose(st: St<'_>, game_id: i64, slug: Option<String>) -> CmdResult<crate::maps::GameMaps> {
    Ok(crate::maps::choose(st.inner(), game_id, slug).await?)
}

#[tauri::command]
pub async fn maps_last(st: St<'_>, game_id: i64, map: String) -> CmdResult<()> {
    let s = st.inner().clone();
    blocking(move || Ok(crate::maps::set_last(&s, game_id, &map)?)).await
}

/// Ancla un mapa encima del juego (o lo quita con `null`).
#[tauri::command]
pub async fn overlay_pin(st: St<'_>, url: Option<String>) -> CmdResult<()> {
    Ok(crate::overlay::pin_map(st.inner(), url)?)
}

// ───────────────────────────── perfil (página al estilo Steam) ─────────────────────────────

use crate::profile_page;

/// La página de perfil del perfil activo (nivel, insignias, vitrinas, juegos, actividad).
#[tauri::command]
pub async fn profile_page(st: St<'_>) -> CmdResult<Value> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || profile_page::view(&s, pid)).await
}

#[derive(Serialize)]
pub struct PageSaved {
    profile: Profile,
    page: Value,
}

/// Guarda cambios del perfil (solo los campos que llegan). Devuelve el perfil
/// local (nombre y avatar) y la página al día.
#[tauri::command]
pub async fn profile_page_update(st: St<'_>, patch: Value) -> CmdResult<PageSaved> {
    let pid = active(&st)?;
    let s = st.inner().clone();
    blocking(move || {
        profile_page::update(&s, pid, &patch)?;
        let profile = s.db.with(|c| repo::get_profile(c, pid))?;
        Ok(PageSaved { profile, page: profile_page::view(&s, pid)? })
    })
    .await
}

/// Guarda una imagen elegida por el usuario (avatar, fondo o captura para la
/// vitrina) y devuelve su URL.
#[tauri::command]
pub async fn profile_image(st: St<'_>, kind: String, path: String) -> CmdResult<String> {
    let s = st.inner().clone();
    blocking(move || profile_page::image(&s, &kind, &path)).await
}

// ───────────────────────────── descargas ─────────────────────────────

use crate::downloads;

#[tauri::command]
pub async fn downloads_list(st: St<'_>) -> CmdResult<Vec<downloads::DownloadItem>> {
    let s = st.inner().clone();
    blocking(move || downloads::list(&s)).await
}

#[tauri::command]
pub async fn downloads_defaults(st: St<'_>) -> CmdResult<downloads::Defaults> {
    let s = st.inner().clone();
    blocking(move || Ok(downloads::defaults(&s))).await
}

#[tauri::command]
pub async fn downloads_prepare(st: St<'_>, slug: String) -> CmdResult<downloads::PreparedDownload> {
    Ok(downloads::prepare(st.inner(), &slug).await?)
}

/// Solo en desarrollo (pruebas del motor con torrents legales).
#[tauri::command]
pub async fn downloads_prepare_magnet(st: St<'_>, magnet: String, title: String) -> CmdResult<downloads::PreparedDownload> {
    #[cfg(debug_assertions)]
    return Ok(downloads::prepare_magnet(st.inner(), &magnet, &title).await?);
    #[cfg(not(debug_assertions))]
    {
        let _ = (st, magnet, title);
        Err(CmdError::Msg("no disponible".into()))
    }
}

#[tauri::command]
pub async fn downloads_cancel_prepare(st: St<'_>, key: String) -> CmdResult<()> {
    downloads::cancel_prepare(st.inner(), &key);
    Ok(())
}

#[tauri::command]
pub async fn downloads_start(st: St<'_>, token: String, files: Vec<usize>, dir: Option<String>) -> CmdResult<downloads::DownloadItem> {
    Ok(downloads::start(st.inner(), &token, &files, dir).await?)
}

#[tauri::command]
pub async fn downloads_pause(st: St<'_>, id: Option<i64>) -> CmdResult<()> {
    Ok(downloads::pause(st.inner(), id).await?)
}

#[tauri::command]
pub async fn downloads_resume(st: St<'_>, id: Option<i64>) -> CmdResult<()> {
    Ok(downloads::resume(st.inner(), id).await?)
}

#[tauri::command]
pub async fn downloads_move(st: St<'_>, id: i64, pos: usize) -> CmdResult<()> {
    Ok(downloads::move_to(st.inner(), id, pos).await?)
}

#[tauri::command]
pub async fn downloads_remove(st: St<'_>, id: i64, delete_files: bool) -> CmdResult<()> {
    Ok(downloads::remove(st.inner(), id, delete_files).await?)
}

/// Borra los archivos de un repack (ya instalado) y conserva la entrada.
#[tauri::command]
pub async fn downloads_delete_files(st: St<'_>, id: i64) -> CmdResult<()> {
    Ok(downloads::delete_repack(st.inner(), id).await?)
}

#[tauri::command]
pub async fn downloads_install(st: St<'_>, id: i64) -> CmdResult<()> {
    Ok(downloads::install::install(st.inner(), id).await?)
}

#[tauri::command]
pub async fn downloads_finish_install(st: St<'_>, id: i64, dir: String) -> CmdResult<()> {
    Ok(downloads::install::finish_manual(st.inner(), id, &dir).await?)
}

#[tauri::command]
pub async fn downloads_open_folder(app: tauri::AppHandle, st: St<'_>, id: i64) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let s = st.inner().clone();
    let row = blocking(move || s.db.with(|c| repo::get_download(c, id))).await?.ok_or_else(|| CmdError::Msg("Esa descarga ya no existe".into()))?;
    let dir = [row.install_dir.as_deref().filter(|_| row.state == "installed"), Some(row.output_dir.as_str())]
        .into_iter()
        .flatten()
        .find(|d| std::path::Path::new(d).is_dir())
        .ok_or_else(|| CmdError::Msg("La carpeta ya no existe".into()))?
        .to_string();
    app.opener().open_path(dir, None::<&str>).map_err(|e| CmdError::Msg(e.to_string()))?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpace {
    free_bytes: Option<u64>,
}

#[tauri::command]
pub async fn disk_space(path: String) -> CmdResult<DiskSpace> {
    Ok(DiskSpace {
        free_bytes: downloads::win::disk_free(std::path::Path::new(&path)),
    })
}

// ───────────────────────────── actualizaciones ─────────────────────────────

/// Última versión de GitHub frente a la instalada. `force` se salta la caché
/// (el botón «Buscar ahora»); la comprobación al abrir reutiliza una reciente.
#[tauri::command]
pub async fn update_check(st: St<'_>, force: bool) -> CmdResult<crate::update::UpdateCheck> {
    let skipped = st.settings.get().update_skipped;
    Ok(st.updater.check(force, &skipped).await?)
}

#[tauri::command]
pub async fn update_download(st: St<'_>) -> CmdResult<crate::update::Downloaded> {
    Ok(st.updater.download(st.inner()).await?)
}

/// Abre el instalador descargado y cierra ejGames para que pueda sustituirlo
/// (al salir se guardan las partidas y el progreso de las descargas).
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, st: St<'_>, path: String) -> CmdResult<()> {
    if st.downloads.installing.lock().is_some() {
        return Err(CmdError::Msg("Espera a que termine la instalación del juego".into()));
    }
    crate::update::launch_installer(&path)?;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        app.exit(0);
    });
    Ok(())
}
