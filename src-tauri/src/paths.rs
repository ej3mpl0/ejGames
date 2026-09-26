//! Rutas de datos. Normal: %APPDATA%\ejGames. Portable: `portable.txt` junto al exe → `.\data`.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
    pub db: PathBuf,
    pub settings: PathBuf,
    pub media: PathBuf,
    pub trailers: PathBuf,
    pub user_themes: PathBuf,
    pub builtin_themes: PathBuf,
    pub sdk: PathBuf,
    pub logs: PathBuf,
    pub portable: bool,
}

/// Instancia aislada (EJGAMES_DATA_DIR): convive con la instalada, sin
/// instancia única y con su propia carpeta de WebView2.
pub fn isolated() -> bool {
    std::env::var_os("EJGAMES_DATA_DIR").map(|d| !d.is_empty()).unwrap_or(false)
}

/// Carpeta de WebView2 de una instancia aislada.
pub fn webview_dir() -> Option<PathBuf> {
    isolated().then(|| data_root().map(|(r, _)| r.join("webview"))).flatten()
}

/// Carpeta de datos: EJGAMES_DATA_DIR, `.\data` en modo portable o %APPDATA%\ejGames.
/// (carpeta, portable)
pub fn data_root() -> Option<(PathBuf, bool)> {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    let portable = exe_dir.as_ref().map(|d| d.join("portable.txt").exists()).unwrap_or(false);
    // EJGAMES_DATA_DIR: datos en otra carpeta (pruebas, instalaciones paralelas).
    if let Some(dir) = std::env::var_os("EJGAMES_DATA_DIR").filter(|d| !d.is_empty()) {
        return Some((PathBuf::from(dir), portable));
    }
    if portable {
        return Some((exe_dir?.join("data"), true));
    }
    Some((dirs::config_dir()?.join("ejGames"), false))
}

impl Paths {
    pub fn resolve(resource_dir: Option<PathBuf>) -> anyhow::Result<Self> {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf));
        let (root, portable) = data_root().ok_or_else(|| anyhow::anyhow!("no se encontró %APPDATA%"))?;

        // Temas y SDK de serie: en dev se leen del repo (hot reload sin copiar),
        // en release de los recursos empaquetados.
        let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let (builtin_themes, sdk) = if cfg!(debug_assertions) && dev_root.join("themes").exists() {
            (dev_root.join("themes"), dev_root.join("sdk"))
        } else {
            let res = resource_dir.unwrap_or_else(|| exe_dir.clone().unwrap_or_default());
            (res.join("themes"), res.join("sdk"))
        };

        let p = Paths {
            db: root.join("library.db"),
            settings: root.join("settings.json"),
            media: root.join("cache").join("media"),
            trailers: root.join("cache").join("trailers"),
            user_themes: root.join("themes"),
            logs: root.join("logs"),
            builtin_themes,
            sdk,
            portable,
            root,
        };
        for d in [&p.root, &p.media, &p.trailers, &p.user_themes, &p.logs] {
            std::fs::create_dir_all(d)?;
        }
        Ok(p)
    }

    /// Ruta de un fichero del almacén de medios direccionado por contenido.
    pub fn media_file(&self, hash: &str, ext: &str) -> PathBuf {
        let shard = &hash[..2.min(hash.len())];
        self.media.join(shard).join(format!("{hash}.{ext}"))
    }
}
