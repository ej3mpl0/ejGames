//! Ajustes globales (no por perfil) en settings.json.

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Aplicación "ejGames" del Developer Portal de Discord. Se usa si el usuario
/// no pone la suya.
pub const DEFAULT_DISCORD_CLIENT_ID: &str = "1553143273869287435";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub language: String,
    pub country: String,
    /// Clave de SteamGridDB (opcional).
    pub sgdb_key: String,
    /// Client ID / secret de Twitch para IGDB (opcional).
    pub igdb_client_id: String,
    pub igdb_client_secret: String,
    /// Application ID de Discord (Developer Portal).
    pub discord_client_id: String,
    /// Tamaño máximo de la caché de tráilers en MB.
    pub trailer_cache_mb: u64,
    /// Calidad máxima de tráiler (alto en píxeles).
    pub trailer_max_height: u32,
    pub start_with_windows: bool,
    pub start_minimized: bool,
    pub start_big_picture: bool,
    /// Botón Guía/PS del mando abre el launcher durante la partida.
    pub gamepad_home_button: bool,
    pub last_profile: Option<i64>,
    pub auto_login: bool,
    pub close_to_tray: bool,
    pub dev_mode: bool,
    pub import_steam: bool,
    pub import_epic: bool,
    pub import_gog: bool,
    pub import_ubisoft: bool,
    pub import_ea: bool,
    /// Traer también los juegos comprados que no están instalados.
    pub import_uninstalled: bool,
    /// Overlay dentro del juego (avisos de logros + panel).
    pub overlay_enabled: bool,
    /// Atajo del panel del overlay ("Shift+Tab"; en juegos de Steam no se
    /// registra si coincide con el de Steam).
    pub overlay_hotkey: String,
    /// Esquina de los avisos: top-left | top-right | bottom-left | bottom-right.
    pub overlay_corner: String,
    pub overlay_sound: bool,
    /// Aviso al empezar la partida con el atajo del overlay.
    pub overlay_start_hint: bool,
    /// Avisar también de logros de Steam (Steam ya los muestra en su overlay).
    pub overlay_steam_notify: bool,
    /// Carpetas extra donde buscar `<appid>chievements.*` de emuladores.
    pub achievement_dirs: Vec<String>,
    pub first_run_done: bool,
}

impl Settings {
    /// Application ID de Discord efectivo (el del usuario o el de serie).
    pub fn discord_id(&self) -> String {
        let id = self.discord_client_id.trim();
        if id.is_empty() { DEFAULT_DISCORD_CLIENT_ID.to_string() } else { id.to_string() }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: "spanish".into(),
            country: "ES".into(),
            sgdb_key: String::new(),
            igdb_client_id: String::new(),
            igdb_client_secret: String::new(),
            discord_client_id: String::new(),
            trailer_cache_mb: 2048,
            trailer_max_height: 720,
            start_with_windows: false,
            start_minimized: false,
            start_big_picture: false,
            gamepad_home_button: true,
            last_profile: None,
            auto_login: true,
            close_to_tray: true,
            dev_mode: false,
            import_steam: true,
            import_epic: true,
            import_gog: true,
            import_ubisoft: true,
            import_ea: true,
            import_uninstalled: true,
            overlay_enabled: true,
            overlay_hotkey: "Shift+Tab".into(),
            overlay_corner: "bottom-right".into(),
            overlay_sound: true,
            overlay_start_hint: true,
            overlay_steam_notify: false,
            achievement_dirs: vec![],
            first_run_done: false,
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    inner: RwLock<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let inner = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
            .unwrap_or_default();
        SettingsStore {
            path,
            inner: RwLock::new(inner),
        }
    }

    pub fn get(&self) -> Settings {
        self.inner.read().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut Settings)) -> anyhow::Result<Settings> {
        let mut g = self.inner.write();
        f(&mut g);
        let snapshot = g.clone();
        drop(g);
        self.save(&snapshot)?;
        Ok(snapshot)
    }

    fn save(&self, s: &Settings) -> anyhow::Result<()> {
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(s)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}
