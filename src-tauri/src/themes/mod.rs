//! Temas: carpetas con theme.json + HTML/CSS/JS. Los de usuario (en %APPDATA%)
//! tienen prioridad sobre los de serie si comparten id.

pub mod devwatch;
pub mod package;

use crate::paths::Paths;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const SDK_VERSION: u32 = 1;

fn default_entry() -> String {
    "index.html".into()
}
fn default_sdk() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_sdk")]
    pub sdk: u32,
    #[serde(default = "default_entry")]
    pub entry: String,
    #[serde(default)]
    pub preview: Option<String>,
    #[serde(default)]
    pub modes: Vec<String>,
    /// Esquema del editor visual: [{key, type, label, default, …}].
    #[serde(default)]
    pub settings: Vec<Value>,
    /// {"preset": "soft"} o {"move": "sounds/move.wav", …}.
    #[serde(default)]
    pub sounds: Value,
    /// Colores de muestra para la galería si no hay preview.
    #[serde(default)]
    pub palette: Vec<String>,
    /// Estilo de los overlays del host: {accent, surface, text, radius, font, dark}.
    #[serde(default)]
    pub host: Value,
    /// "host" (botones de ventana del host) o "theme" (el tema los pinta).
    #[serde(default)]
    pub window_controls: Option<String>,
    /// Avisos del overlay dentro del juego: {"style": "xbox"}.
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub overlay: Value,
    /// Vistas que pinta el propio tema: {"explore": true} (Explorar y
    /// Descargas). Sin ellas, el host abre las suyas.
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub features: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
    #[serde(flatten)]
    pub manifest: ThemeManifest,
    pub builtin: bool,
    pub dir: String,
    pub preview_url: Option<String>,
    pub compatible: bool,
}

pub const THEME_ORIGIN: &str = "http://ejg-theme.localhost";
pub const SAFE_ORIGIN: &str = "http://ejg-safe.localhost";

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn read_manifest(dir: &Path) -> anyhow::Result<ThemeManifest> {
    let txt = std::fs::read_to_string(dir.join("theme.json"))?;
    let m: ThemeManifest = serde_json::from_str(txt.trim_start_matches('\u{feff}'))?;
    if !valid_id(&m.id) {
        anyhow::bail!("id de tema no válido: {}", m.id);
    }
    Ok(m)
}

fn scan(root: &Path, builtin: bool, out: &mut Vec<ThemeInfo>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.filter_map(Result::ok) {
        let dir = e.path();
        if !dir.is_dir() {
            continue;
        }
        match read_manifest(&dir) {
            Ok(m) => {
                if out.iter().any(|t| t.manifest.id == m.id) {
                    continue; // el de usuario ya ganó
                }
                let preview_url = m.preview.as_ref().map(|p| format!("{THEME_ORIGIN}/{}/{}", m.id, p));
                out.push(ThemeInfo {
                    compatible: m.sdk <= SDK_VERSION,
                    manifest: m,
                    builtin,
                    dir: dir.to_string_lossy().to_string(),
                    preview_url,
                });
            }
            Err(err) => tracing::warn!("tema {}: {err:#}", dir.display()),
        }
    }
}

pub fn list(paths: &Paths) -> Vec<ThemeInfo> {
    let mut out = vec![];
    scan(&paths.user_themes, false, &mut out);
    scan(&paths.builtin_themes, true, &mut out);
    let order = ["steam", "ps5", "xbox", "switch", "cinema", "retro"];
    out.sort_by_key(|t| {
        (
            !t.builtin,
            order.iter().position(|o| *o == t.manifest.id).unwrap_or(99),
            t.manifest.name.to_lowercase(),
        )
    });
    out
}

pub fn find(paths: &Paths, id: &str) -> Option<ThemeInfo> {
    if !valid_id(id) {
        return None;
    }
    list(paths).into_iter().find(|t| t.manifest.id == id)
}

pub fn dir_of(paths: &Paths, id: &str) -> Option<PathBuf> {
    if !valid_id(id) {
        return None;
    }
    let user = paths.user_themes.join(id);
    if user.join("theme.json").exists() {
        return Some(user);
    }
    // Los de serie viven en una carpeta con su id: sin releer todos los temas.
    let builtin = paths.builtin_themes.join(id);
    if builtin.join("theme.json").exists() {
        return Some(builtin);
    }
    // Carpetas de usuario/serie cuyo nombre no coincide con el id.
    find(paths, id).map(|t| PathBuf::from(t.dir))
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for e in std::fs::read_dir(src)? {
        let e = e?;
        let to = dst.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &to)?;
        } else {
            std::fs::copy(e.path(), to)?;
        }
    }
    Ok(())
}

/// Copia un tema a la carpeta de usuario con un id nuevo para editarlo.
pub fn duplicate(paths: &Paths, id: &str) -> anyhow::Result<ThemeInfo> {
    let src = dir_of(paths, id).ok_or_else(|| anyhow::anyhow!("tema no encontrado"))?;
    let mut m = read_manifest(&src)?;
    let base = format!("{}-custom", m.id.trim_end_matches("-custom"));
    let mut new_id = base.clone();
    let mut n = 2;
    while paths.user_themes.join(&new_id).exists() || find(paths, &new_id).is_some() {
        new_id = format!("{base}{n}");
        n += 1;
    }
    let dst = paths.user_themes.join(&new_id);
    copy_dir(&src, &dst)?;
    m.id = new_id.clone();
    m.name = format!("{} (mío)", m.name);
    m.author = if m.author.is_empty() { "yo".into() } else { format!("{} + yo", m.author) };
    std::fs::write(dst.join("theme.json"), serde_json::to_vec_pretty(&m)?)?;
    find(paths, &new_id).ok_or_else(|| anyhow::anyhow!("no se pudo duplicar"))
}

pub fn delete(paths: &Paths, id: &str) -> anyhow::Result<()> {
    if !valid_id(id) {
        anyhow::bail!("id no válido");
    }
    let dir = paths.user_themes.join(id);
    if !dir.join("theme.json").exists() {
        anyhow::bail!("Solo se pueden borrar temas de usuario");
    }
    std::fs::remove_dir_all(dir)?;
    Ok(())
}
