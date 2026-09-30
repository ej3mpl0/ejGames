//! Ajustes globales (no por perfil) en settings.json.

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Aplicación "ejGames" del Developer Portal de Discord (siempre esta).
pub const DISCORD_CLIENT_ID: &str = "1553143273869287435";

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
    /// Discord Rich Presence («Jugando a…»). Además se puede quitar por perfil y
    /// por juego.
    pub discord_enabled: bool,
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
    /// Overlay dentro del juego (avisos de logros + panel).
    pub overlay_enabled: bool,
    /// Atajo del panel del overlay ("Shift+Tab").
    pub overlay_hotkey: String,
    /// Dónde salen los avisos: auto (la del estilo) | top-left | top-center |
    /// top-right | bottom-left | bottom-center | bottom-right.
    pub overlay_corner: String,
    /// Aspecto de los avisos: auto (el del tema) | steam | playstation | xbox |
    /// switch | cinema | retro | ejgames.
    pub overlay_style: String,
    pub overlay_sound: bool,
    /// Aviso al empezar la partida con el atajo del overlay.
    pub overlay_start_hint: bool,
    /// Atajo de las capturas de pantalla ("F12"; "" = sin atajo).
    pub screenshot_hotkey: String,
    /// Carpeta de las capturas ("" = Imágenes\ejGames). Una subcarpeta por juego.
    pub screenshot_dir: String,
    /// Carpetas extra donde buscar `<appid>chievements.*` de emuladores.
    pub achievement_dirs: Vec<String>,
    pub first_run_done: bool,

    // ── Explorar y descargas ──
    pub explore_enabled: bool,
    pub explore_hide_adult: bool,
    /// Carpeta de descargas ("" = la primera carpeta de la biblioteca).
    pub download_dir: String,
    /// Dónde se instalan los juegos ("" = la primera carpeta de la biblioteca).
    pub install_dir: String,
    /// Límites en KB/s (0 = sin límite).
    pub max_download_kbps: u32,
    pub max_upload_kbps: u32,
    pub max_active_downloads: u32,
    pub pause_while_playing: bool,
    /// never | until-install | ratio
    pub seed_policy: String,
    pub seed_ratio: f64,
    /// Abrir el instalador en cuanto termine la descarga.
    pub auto_install: bool,
    pub delete_repack_after_install: bool,
    /// Que el PC no se suspenda mientras descarga.
    pub prevent_sleep: bool,
    /// Puerto de entrada del torrent (0 = elegir uno la primera vez).
    pub listen_port: u16,
    pub upnp: bool,
    pub utp: bool,
    /// Añadir trackers públicos a cada descarga.
    pub extra_trackers: bool,
    /// Conexiones por descarga (0 = automático).
    pub peer_limit: u32,
    /// Proxy SOCKS5 para el torrent ("socks5://usuario:clave@host:puerto").
    pub torrent_proxy: String,

    // ── Actualizaciones ──
    /// Buscar una versión nueva al abrir.
    pub update_auto: bool,
    /// Versión que el usuario pidió no volver a ofrecer.
    pub update_skipped: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: "spanish".into(),
            country: "ES".into(),
            sgdb_key: String::new(),
            igdb_client_id: String::new(),
            igdb_client_secret: String::new(),
            discord_enabled: true,
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
            overlay_enabled: true,
            overlay_hotkey: "Shift+Tab".into(),
            overlay_corner: "auto".into(),
            overlay_style: "auto".into(),
            overlay_sound: true,
            overlay_start_hint: true,
            screenshot_hotkey: "F12".into(),
            screenshot_dir: String::new(),
            achievement_dirs: vec![],
            first_run_done: false,
            explore_enabled: true,
            explore_hide_adult: true,
            download_dir: String::new(),
            install_dir: String::new(),
            max_download_kbps: 0,
            max_upload_kbps: 0,
            max_active_downloads: 1,
            pause_while_playing: true,
            seed_policy: "until-install".into(),
            seed_ratio: 1.0,
            auto_install: false,
            delete_repack_after_install: true,
            prevent_sleep: true,
            listen_port: 0,
            upnp: true,
            utp: false,
            extra_trackers: true,
            peer_limit: 0,
            torrent_proxy: String::new(),
            update_auto: true,
            update_skipped: String::new(),
        }
    }
}

pub const OVERLAY_CORNERS: [&str; 7] = ["auto", "top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];
pub const SEED_POLICIES: [&str; 3] = ["never", "until-install", "ratio"];

pub const OVERLAY_STYLES: [&str; 8] = ["auto", "steam", "playstation", "xbox", "switch", "cinema", "retro", "ejgames"];

/// Ajustes de versiones anteriores: hasta 0.2.1 la esquina "bottom-right" era la
/// de serie (se guardaba siempre); ahora la de serie es la del estilo del aviso.
fn migrate(v: &mut serde_json::Value) {
    let Some(o) = v.as_object_mut() else { return };
    if !o.contains_key("overlayStyle") && o.get("overlayCorner").and_then(|c| c.as_str()) == Some("bottom-right") {
        o.insert("overlayCorner".into(), "auto".into());
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
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|mut v| {
                migrate(&mut v);
                serde_json::from_value::<Settings>(v).ok()
            })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_default_corner_follows_the_style() {
        let mut old = serde_json::json!({ "overlayCorner": "bottom-right" });
        migrate(&mut old);
        assert_eq!(serde_json::from_value::<Settings>(old).unwrap().overlay_corner, "auto");
        let mut chosen = serde_json::json!({ "overlayCorner": "top-left" });
        migrate(&mut chosen);
        assert_eq!(serde_json::from_value::<Settings>(chosen).unwrap().overlay_corner, "top-left");
        let mut new = serde_json::json!({ "overlayCorner": "bottom-right", "overlayStyle": "auto" });
        migrate(&mut new);
        assert_eq!(serde_json::from_value::<Settings>(new).unwrap().overlay_corner, "bottom-right");
    }
}
