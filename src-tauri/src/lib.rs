mod achievements;
mod commands;
mod db;
mod discord;
mod events;
mod import;
mod launcher;
mod library;
mod lifecycle;
mod media;
mod metadata;
mod overlay;
mod paths;
mod protocols;
mod services;
mod settings;
mod state;
mod stats;
mod themes;
mod util;

use state::AppState;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;

#[cfg(windows)]
fn shift_held() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
    unsafe { (GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0 }
}
#[cfg(not(windows))]
fn shift_held() -> bool {
    false
}

/// Log en `logs/ejgames.log` (además de la consola) para poder diagnosticar
/// en el PC del usuario. Se vacía al arrancar si pasa de 2 MB.
fn init_logging() {
    use tracing_subscriber::fmt::writer::MakeWriterExt;
    let filter = || tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "ejgames_lib=info,warn".into());
    let file = paths::data_root().and_then(|(root, _)| {
        let dir = root.join("logs");
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join("ejgames.log");
        let big = std::fs::metadata(&path).map(|m| m.len() > 2 * 1024 * 1024).unwrap_or(false);
        std::fs::OpenOptions::new().create(true).append(!big).write(true).truncate(big).open(path).ok()
    });
    let base = tracing_subscriber::fmt().with_env_filter(filter()).with_ansi(false);
    let _ = match file {
        Some(f) => base.with_writer(std::io::stdout.and(std::sync::Mutex::new(f))).try_init(),
        None => base.try_init(),
    };
}

pub fn run() {
    init_logging();
    tracing::info!("ejGames {} arrancando", env!("CARGO_PKG_VERSION"));

    let safe_mode = shift_held();
    let started_hidden = std::env::args().any(|a| a == "--minimized");

    let mut builder = tauri::Builder::default();
    // Primero: una segunda instancia solo enfoca la existente. Las instancias
    // aisladas (EJGAMES_DATA_DIR, pruebas) conviven con la instalada.
    if !paths::isolated() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(st) = app.try_state::<Arc<AppState>>() {
                lifecycle::show_main(st.inner());
            }
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[overlay::LABEL])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(f) = event {
                if window.label() != lifecycle::MAIN {
                    return;
                }
                if let Some(w) = window.app_handle().get_webview_window(window.label()) {
                    lifecycle::on_focus_changed(&w, *f);
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol("ejg-media", protocols::media_handler)
        .register_asynchronous_uri_scheme_protocol("ejg-theme", protocols::theme_handler)
        .register_asynchronous_uri_scheme_protocol("ejg-safe", protocols::safe_theme_handler)
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::app_ready,
            commands::window_action,
            commands::window_state,
            commands::list_profiles,
            commands::create_profile,
            commands::update_profile,
            commands::delete_profile,
            commands::login,
            commands::logout,
            commands::set_avatar,
            commands::import_image,
            commands::set_theme_settings,
            commands::set_custom_css,
            commands::get_library,
            commands::get_games,
            commands::get_game_details,
            commands::get_game_full,
            commands::update_game,
            commands::delete_game,
            commands::purge_missing,
            commands::set_favorite,
            commands::set_hidden,
            commands::set_user_rating,
            commands::add_manual_game,
            commands::inspect_folder,
            commands::list_folders,
            commands::add_folder,
            commands::remove_folder,
            commands::rescan,
            commands::store_summary,
            commands::import_stores,
            commands::refresh_metadata,
            commands::search_metadata,
            commands::apply_match,
            commands::art_options,
            commands::set_art_url,
            commands::set_art_file,
            commands::select_media,
            commands::meta_progress,
            commands::play,
            commands::stop_tracking,
            commands::running_games,
            commands::open_game_folder,
            commands::open_external,
            commands::get_stats,
            commands::recent_sessions,
            commands::list_collections,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::set_in_collection,
            commands::list_themes,
            commands::duplicate_theme,
            commands::delete_theme,
            commands::import_theme,
            commands::export_theme,
            commands::open_theme_folder,
            commands::theme_storage_get,
            commands::theme_storage_set,
            commands::get_settings,
            commands::update_settings,
            commands::cache_info,
            commands::clear_trailer_cache,
            commands::open_data_dir,
            commands::quit,
            commands::get_achievements,
            commands::overlay_ready,
            commands::overlay_idle,
            commands::overlay_panel,
            commands::overlay_action,
            commands::overlay_test,
            commands::ping,
        ])
        .setup(move |app| {
            let paths = paths::Paths::resolve(app.path().resource_dir().ok())?;
            let db = db::Db::open(&paths.db)?;
            let settings = settings::SettingsStore::load(paths.settings.clone());
            let http = reqwest::Client::builder()
                .user_agent("ejGames/0.1 (game launcher)")
                .timeout(Duration::from_secs(25))
                .connect_timeout(Duration::from_secs(8))
                .pool_idle_timeout(Duration::from_secs(30))
                .gzip(true)
                .build()?;
            let (meta, rx) = metadata::queue::MetaQueue::new();
            let st = Arc::new(AppState {
                app: app.handle().clone(),
                paths,
                db,
                settings,
                http,
                providers: Default::default(),
                meta,
                sessions: Default::default(),
                discord: discord::Discord::start(),
                watcher: Default::default(),
                theme_dev: Default::default(),
                profile: Default::default(),
                safe_mode,
                saver_active: Default::default(),
                scan_lock: Default::default(),
                overlay: Default::default(),
            });
            app.manage(st.clone());

            let st_w = st.clone();
            let _ = st.watcher.set(library::watcher::FolderWatcher::start(move |folder_id| {
                let s = st_w.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = services::scan_folder(&s, folder_id, true).await {
                        tracing::warn!("reescaneo automático: {e:#}");
                    }
                });
            }));
            services::sync_watcher(&st);
            metadata::queue::start_worker(st.clone(), rx);
            lifecycle::setup_tray(app.handle())?;

            // Entrar solo si hay perfil recordado sin PIN.
            let s = st.settings.get();
            if s.auto_login {
                if let Some(pid) = s.last_profile {
                    if let Ok(p) = st.db.with(|c| db::repo::get_profile(c, pid)) {
                        if !p.has_pin {
                            *st.profile.write() = Some(pid);
                            commands::watch_active_theme(&st);
                        }
                    }
                }
            }

            if !(started_hidden || s.start_minimized) {
                lifecycle::create_main(app.handle())?;
            }

            // Mantenimiento en segundo plano, sin estorbar al arranque.
            let st_bg = st.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(4)).await;
                let first_run_done = st_bg.settings.get().first_run_done;
                if first_run_done {
                    let _ = services::import_stores(&st_bg, None).await;
                    let _ = services::scan_all(&st_bg, true).await;
                }
                if let Ok(pending) = st_bg.db.with(|c| db::repo::games_by_status(c, &["pending"])) {
                    st_bg.meta.push_many(pending.into_iter().map(|g| g.id));
                }
                achievements::refresh_library(&st_bg).await;
                let st3 = st_bg.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    media::trailers::prune(&st3.paths.trailers, st3.settings.get().trailer_cache_mb)
                })
                .await;
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error al iniciar ejGames");

    app.run(|app, event| {
        // Saliendo (menú, bandeja, apagado): guardar las partidas en curso.
        if let tauri::RunEvent::Exit = event {
            if let Some(st) = app.try_state::<Arc<AppState>>() {
                launcher::finish_all(st.inner());
            }
            return;
        }
        if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
            // code == None: se cerró la última ventana (no una salida explícita).
            if code.is_none() {
                if let Some(st) = app.try_state::<Arc<AppState>>() {
                    let keep = st.settings.get().close_to_tray
                        || st.sessions.any()
                        || st.saver_active.load(Ordering::Relaxed);
                    if keep {
                        api.prevent_exit();
                    }
                }
            }
        }
    });
}
