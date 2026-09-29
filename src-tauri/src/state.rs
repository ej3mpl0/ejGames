use crate::db::Db;
use crate::discord::Discord;
use crate::launcher::Sessions;
use crate::library::watcher::FolderWatcher;
use crate::metadata::queue::MetaQueue;
use crate::metadata::{igdb::Igdb, sgdb::Sgdb, steam::Steam};
use crate::paths::Paths;
use crate::settings::SettingsStore;
use crate::themes::devwatch::DevWatch;
use parking_lot::RwLock;
use std::sync::atomic::AtomicBool;
use std::sync::OnceLock;
use tauri::AppHandle;

#[derive(Default)]
pub struct Providers {
    pub steam: Steam,
    pub sgdb: Sgdb,
    pub igdb: Igdb,
}

pub struct AppState {
    pub app: AppHandle,
    pub paths: Paths,
    pub db: Db,
    pub settings: SettingsStore,
    pub http: reqwest::Client,
    pub providers: Providers,
    pub meta: MetaQueue,
    pub sessions: Sessions,
    pub discord: Discord,
    pub watcher: OnceLock<FolderWatcher>,
    pub theme_dev: DevWatch,
    /// Perfil con la sesión iniciada.
    pub profile: RwLock<Option<i64>>,
    /// Arranque con Shift pulsado: tema de serie.
    pub safe_mode: bool,
    /// Ventana destruida para ahorrar memoria mientras se juega.
    pub saver_active: AtomicBool,
    pub scan_lock: tokio::sync::Mutex<()>,
    pub overlay: crate::overlay::Overlay,
    pub explore: crate::explore::Explore,
    pub downloads: crate::downloads::Downloads,
    pub updater: crate::update::Updater,
    pub trainers: crate::trainers::Trainers,
    pub online: crate::online::Online,
}
