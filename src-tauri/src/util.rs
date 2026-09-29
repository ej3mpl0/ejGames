use std::path::Path;

pub fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Normaliza una ruta para comparar (Windows no distingue mayúsculas).
pub fn norm_path(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    s.trim_end_matches('\\').to_lowercase()
}

/// Ruta de carpeta tal y como se guarda: barras de Windows y sin la barra final,
/// salvo en la raíz de una unidad ("E:" sería relativa al directorio actual de E:).
pub fn clean_dir(p: &str) -> String {
    let s = p.trim().replace('/', "\\");
    let t = s.trim_end_matches('\\');
    if t.len() == 2 && t.ends_with(':') {
        format!("{t}\\")
    } else {
        t.to_string()
    }
}

/// Ruta temporal única junto a `p` (para escribir y luego renombrar).
pub fn temp_path(p: &Path) -> std::path::PathBuf {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    p.with_file_name(format!("{name}.{}-{n}.part", std::process::id()))
}

pub fn is_under(child: &Path, parent: &Path) -> bool {
    let c = norm_path(child);
    let p = norm_path(parent);
    c == p || c.starts_with(&(p + "\\"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn clean_dirs() {
        assert_eq!(super::clean_dir("E:\\"), "E:\\");
        assert_eq!(super::clean_dir("E:"), "E:\\");
        assert_eq!(super::clean_dir("E:/Juegos/"), "E:\\Juegos");
        assert_eq!(super::clean_dir("C:\\Games\\X\\"), "C:\\Games\\X");
        assert!(super::is_under(std::path::Path::new("E:\\Juegos\\X"), std::path::Path::new("E:\\")));
    }
}

/// Error serializable para comandos Tauri.
#[derive(Debug, thiserror::Error)]
pub enum CmdError {
    #[error("{0}")]
    Msg(String),
}

impl serde::Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<anyhow::Error> for CmdError {
    fn from(e: anyhow::Error) -> Self {
        CmdError::Msg(format!("{e:#}"))
    }
}
impl From<rusqlite::Error> for CmdError {
    fn from(e: rusqlite::Error) -> Self {
        CmdError::Msg(e.to_string())
    }
}
impl From<std::io::Error> for CmdError {
    fn from(e: std::io::Error) -> Self {
        CmdError::Msg(e.to_string())
    }
}
impl From<tauri::Error> for CmdError {
    fn from(e: tauri::Error) -> Self {
        CmdError::Msg(e.to_string())
    }
}
impl From<crate::online::api::ApiError> for CmdError {
    fn from(e: crate::online::api::ApiError) -> Self {
        CmdError::Msg(e.message)
    }
}
impl From<tokio::task::JoinError> for CmdError {
    fn from(e: tokio::task::JoinError) -> Self {
        CmdError::Msg(e.to_string())
    }
}

pub type CmdResult<T> = Result<T, CmdError>;

/// Ejecuta trabajo bloqueante (BD, disco) fuera del hilo principal / runtime async.
pub async fn blocking<T, F>(f: F) -> CmdResult<T>
where
    F: FnOnce() -> anyhow::Result<T> + Send + 'static,
    T: Send + 'static,
{
    Ok(tauri::async_runtime::spawn_blocking(f).await??)
}
