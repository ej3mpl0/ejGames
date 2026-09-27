use serde::{Deserialize, Deserializer, Serialize};

/// Campo que distingue "no viene" (None) de "viene a null" (Some(None) = borrar).
/// Con `#[serde(default)]` en el struct, solo se llama si el campo está.
fn some_or_null<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

pub const MEDIA_ORIGIN: &str = "http://ejg-media.localhost";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
    pub id: i64,
    pub path: String,
    pub mode: String,
    pub enabled: bool,
    pub last_scan: Option<i64>,
    pub game_count: i64,
}

/// Juego detectado por el escáner o un importador de tiendas.
#[derive(Debug, Clone, Default)]
pub struct NewGame {
    pub title: String,
    pub source: String,
    pub source_id: String,
    pub folder_id: Option<i64>,
    pub install_dir: Option<String>,
    pub exe_path: Option<String>,
    pub args: String,
    pub working_dir: Option<String>,
    pub launch_uri: Option<String>,
    pub process_hints: Vec<String>,
    pub engine: Option<String>,
    pub steam_appid: Option<i64>,
    pub exe_candidates: Vec<(String, f32)>,
    /// Horas importadas de la tienda (segundos), si las hay.
    pub imported_playtime: Option<i64>,
    pub imported_last_played: Option<i64>,
    /// Lo tienes en la tienda pero no está instalado.
    pub owned_only: bool,
    /// URI para instalarlo desde su tienda.
    pub install_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: i64,
    pub title: String,
    pub sort_title: String,
    pub source: String,
    pub source_id: String,
    pub folder_id: Option<i64>,
    pub install_dir: Option<String>,
    pub exe_path: Option<String>,
    pub args: String,
    pub working_dir: Option<String>,
    pub launch_uri: Option<String>,
    pub run_as_admin: bool,
    pub process_hints: Vec<String>,
    pub engine: Option<String>,
    pub steam_appid: Option<i64>,
    pub sgdb_id: Option<i64>,
    pub igdb_id: Option<i64>,
    pub description: Option<String>,
    pub short_description: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub release_date: Option<String>,
    pub genres: Vec<String>,
    pub tags: Vec<String>,
    pub rating: Option<i64>,
    pub meta_status: String,
    pub match_confidence: Option<f64>,
    pub meta_locked: Vec<String>,
    pub discord_enabled: bool,
    pub missing: bool,
    pub added_at: i64,
    pub updated_at: i64,
    pub installed: bool,
    pub install_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaUrls {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_thumb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero_thumb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub microtrailer: Option<String>,
}

/// Juego tal y como lo ven los temas y la UI (con datos del perfil activo).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibGame {
    pub id: i64,
    pub title: String,
    pub sort_title: String,
    pub source: String,
    pub engine: Option<String>,
    pub short_description: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub release_date: Option<String>,
    pub genres: Vec<String>,
    pub tags: Vec<String>,
    pub rating: Option<i64>,
    pub meta_status: String,
    pub missing: bool,
    pub installed: bool,
    pub added_at: i64,
    pub favorite: bool,
    pub hidden: bool,
    pub last_played: Option<i64>,
    pub playtime: i64,
    pub launch_count: i64,
    pub user_rating: Option<i64>,
    pub collections: Vec<i64>,
    pub media: MediaUrls,
    pub running: bool,
    /// Logros desbloqueados / totales (si el juego tiene).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub achievements: Option<crate::achievements::AchSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: i64,
    pub kind: String,
    pub url: String,
    pub thumb: Option<String>,
    pub remote_url: Option<String>,
    pub source: String,
    pub selected: bool,
    pub title: Option<String>,
    pub w: Option<i64>,
    pub h: Option<i64>,
    pub poster: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDetails {
    #[serde(flatten)]
    pub lib: LibGame,
    pub description: Option<String>,
    pub install_dir: Option<String>,
    pub screenshots: Vec<MediaItem>,
    pub trailers: Vec<MediaItem>,
    pub recent_sessions: Vec<Session>,
    pub steam_appid: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: i64,
    pub game_id: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub avatar: Option<String>,
    pub color: String,
    pub theme_id: String,
    pub theme_settings: serde_json::Value,
    pub custom_css: serde_json::Value,
    pub has_pin: bool,
    pub discord_enabled: bool,
    pub discord_hide_names: bool,
    pub launch_behavior: String,
    pub sounds_volume: f64,
    pub created_at: i64,
    pub last_used: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfilePatch {
    pub name: Option<String>,
    #[serde(deserialize_with = "some_or_null")]
    pub avatar: Option<Option<String>>,
    pub color: Option<String>,
    pub theme_id: Option<String>,
    pub discord_enabled: Option<bool>,
    pub discord_hide_names: Option<bool>,
    pub launch_behavior: Option<String>,
    pub sounds_volume: Option<f64>,
    /// Nuevo PIN ("" = quitar).
    pub pin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: i64,
    pub profile_id: i64,
    pub name: String,
    pub kind: String,
    pub rules: serde_json::Value,
    pub position: i64,
    pub game_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GamePatch {
    pub title: Option<String>,
    pub exe_path: Option<String>,
    pub args: Option<String>,
    #[serde(deserialize_with = "some_or_null")]
    pub working_dir: Option<Option<String>>,
    #[serde(deserialize_with = "some_or_null")]
    pub launch_uri: Option<Option<String>>,
    pub run_as_admin: Option<bool>,
    pub description: Option<String>,
    pub short_description: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub release_date: Option<String>,
    pub genres: Option<Vec<String>>,
    pub discord_enabled: Option<bool>,
    pub process_hints: Option<Vec<String>>,
}

pub fn media_url(hash: &str, ext: &str) -> String {
    format!("{MEDIA_ORIGIN}/m/{hash}.{ext}")
}

pub fn remote_media_url(id: i64) -> String {
    format!("{MEDIA_ORIGIN}/r/{id}")
}

pub fn trailer_url(id: i64, file: &str) -> String {
    format!("{MEDIA_ORIGIN}/t/{id}/{file}")
}

/// Descarga de Explorar tal y como está en la BD (sin el .torrent).
#[derive(Debug, Clone, Default)]
pub struct DownloadRow {
    pub id: i64,
    pub source: String,
    pub source_id: String,
    pub slug: Option<String>,
    pub title: String,
    pub version: Option<String>,
    pub page_url: Option<String>,
    pub cover_url: Option<String>,
    pub hero_url: Option<String>,
    pub magnet: String,
    pub info_hash: String,
    pub torrent_name: String,
    pub output_dir: String,
    pub selected_files: Vec<usize>,
    pub file_count: i64,
    pub total_bytes: i64,
    pub done_bytes: i64,
    pub uploaded_bytes: i64,
    pub state: String,
    pub pause_reason: Option<String>,
    pub queue_pos: i64,
    pub error: Option<String>,
    pub install_size: Option<String>,
    pub install_dir: Option<String>,
    pub game_id: Option<i64>,
    pub added_at: i64,
    pub completed_at: Option<i64>,
    pub installed_at: Option<i64>,
    pub files_deleted: bool,
}

/// Descarga nueva (al confirmar los archivos).
#[derive(Debug, Clone, Default)]
pub struct NewDownload {
    pub source: String,
    pub source_id: String,
    pub slug: Option<String>,
    pub title: String,
    pub version: Option<String>,
    pub page_url: Option<String>,
    pub cover_url: Option<String>,
    pub hero_url: Option<String>,
    pub magnet: String,
    pub info_hash: String,
    pub torrent: Vec<u8>,
    pub torrent_name: String,
    pub output_dir: String,
    pub selected_files: Vec<usize>,
    pub file_count: i64,
    pub total_bytes: i64,
    pub install_size: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_null_clears() {
        let p: GamePatch = serde_json::from_str(r#"{"launchUri": null}"#).unwrap();
        assert_eq!(p.launch_uri, Some(None));
        let p: GamePatch = serde_json::from_str(r#"{"title": "x"}"#).unwrap();
        assert_eq!(p.launch_uri, None);
        let p: GamePatch = serde_json::from_str(r#"{"launchUri": "steam://x"}"#).unwrap();
        assert_eq!(p.launch_uri, Some(Some("steam://x".into())));
        let p: ProfilePatch = serde_json::from_str(r#"{"avatar": null}"#).unwrap();
        assert_eq!(p.avatar, Some(None));
    }
}
