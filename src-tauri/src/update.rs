//! Actualizaciones desde GitHub Releases (como en ejFlix): consulta la última
//! versión publicada, descarga su instalador `*_Setup.exe` (comprobando el
//! SHA-256 que publica GitHub) y lo abre en modo pasivo (`/P /R /UPDATE`), que
//! cierra ejGames, instala encima conservando los datos y lo vuelve a abrir.

use crate::state::AppState;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::sync::Mutex;

/// Repositorio con las versiones (`dueño/nombre`).
pub const REPO: &str = "ej3mpl0/ejGames";
pub const RELEASES_URL: &str = "https://github.com/ej3mpl0/ejGames/releases";
/// Una comprobación automática reutiliza una respuesta así de reciente.
const CACHE_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    pub latest: String,
    /// `latest` es más nueva que la instalada.
    pub available: bool,
    /// El usuario pidió saltarse `latest`.
    pub skipped: bool,
    /// Notas de la versión (markdown de GitHub).
    pub notes: String,
    pub url: String,
    pub asset_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
    #[serde(skip)]
    pub asset_sha256: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloaded {
    pub path: String,
    pub size: u64,
}

pub struct Updater {
    http: reqwest::Client,
    current: String,
    last: Mutex<Option<(Instant, UpdateCheck)>>,
    download_lock: Mutex<()>,
}

/// "v0.3.1", "0.3.1", "ejGames 0.3.1" o "0.3.1-beta.2" → (0, 3, 1).
pub fn parse_version(raw: &str) -> Option<(u64, u64, u64)> {
    let start = raw.find(|c: char| c.is_ascii_digit())?;
    let core = raw[start..].split(|c: char| c == '-' || c == '+' || c.is_whitespace()).next().unwrap_or("");
    let mut parts = core.split('.').map(|p| {
        let digits: String = p.chars().take_while(|c| c.is_ascii_digit()).collect();
        digits.parse::<u64>().ok()
    });
    let major = parts.next().flatten()?;
    let minor = parts.next().flatten().unwrap_or(0);
    let patch = parts.next().flatten().unwrap_or(0);
    Some((major, minor, patch))
}

fn is_prerelease(raw: &str) -> bool {
    raw.find(|c: char| c.is_ascii_digit())
        .map(|start| raw[start..].split(['+', ' ']).next().unwrap_or("").contains('-'))
        .unwrap_or(false)
}

/// `latest` es estrictamente más nueva que `current` (lo que no se entiende, nunca).
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c || (l == c && is_prerelease(current) && !is_prerelease(latest)),
        _ => false,
    }
}

/// El instalador de Windows entre los ficheros de la versión.
fn pick_asset(assets: &[serde_json::Value]) -> Option<(String, String, u64)> {
    let mut list: Vec<(String, String, u64)> = assets
        .iter()
        .filter_map(|a| {
            let name = a.get("name")?.as_str()?.to_string();
            let url = a.get("browser_download_url")?.as_str()?.to_string();
            let size = a.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
            let lower = name.to_ascii_lowercase();
            (lower.ends_with(".exe") && lower.contains("setup")).then_some((name, url, size))
        })
        .collect();
    list.sort_by_key(|(name, _, _)| !name.to_ascii_lowercase().contains("x64"));
    list.into_iter().next()
}

/// SHA-256 que GitHub publica del fichero `name` (`digest: "sha256:<hex>"`).
fn asset_digest(assets: &[serde_json::Value], name: &str) -> Option<String> {
    let a = assets.iter().find(|a| a.get("name").and_then(|n| n.as_str()) == Some(name))?;
    let hex = a.get("digest")?.as_str()?.strip_prefix("sha256:")?.to_ascii_lowercase();
    (hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit())).then_some(hex)
}

/// Repositorio a consultar. En desarrollo se puede cambiar con
/// `EJGAMES_UPDATE_REPO` para probar contra otro con versiones publicadas.
fn repo() -> String {
    #[cfg(debug_assertions)]
    if let Ok(r) = std::env::var("EJGAMES_UPDATE_REPO") {
        return r;
    }
    REPO.to_string()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn update_dir() -> PathBuf {
    std::env::temp_dir().join("ejgames-update")
}

impl Updater {
    pub fn new(current: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(format!("ejGames/{current} (+https://github.com/{REPO})"))
            .build()
            .expect("cliente http");
        Updater {
            http,
            current,
            last: Mutex::new(None),
            download_lock: Mutex::new(()),
        }
    }

    /// Última versión publicada. `force` se salta la caché de 30 minutos.
    pub async fn check(&self, force: bool, skipped: &str) -> anyhow::Result<UpdateCheck> {
        if !force {
            if let Some((at, cached)) = self.last.lock().await.as_ref() {
                if at.elapsed() < CACHE_TTL {
                    let mut out = cached.clone();
                    out.skipped = skipped == out.latest;
                    return Ok(out);
                }
            }
        }
        let resp = self
            .http
            .get(format!("https://api.github.com/repos/{}/releases/latest", repo()))
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    anyhow::anyhow!("GitHub no responde")
                } else if e.is_connect() {
                    anyhow::anyhow!("{}", crate::i18n::t("Sin conexión"))
                } else {
                    anyhow::anyhow!("{e}")
                }
            })?;
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            anyhow::bail!("{}", crate::i18n::t("Aún no hay versiones publicadas"));
        }
        if status == reqwest::StatusCode::FORBIDDEN || status.as_u16() == 429 {
            anyhow::bail!("{}", crate::i18n::t("GitHub ha limitado las consultas; prueba más tarde"));
        }
        if !status.is_success() {
            anyhow::bail!("{}", crate::i18n::tf("GitHub respondió {0}", &[&status.as_u16()]));
        }
        let body: serde_json::Value = resp.json().await?;
        let tag = body.get("tag_name").and_then(|v| v.as_str()).unwrap_or("");
        let latest = parse_version(tag)
            .map(|(a, b, c)| format!("{a}.{b}.{c}"))
            .ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::tf("Etiqueta de versión no reconocida: {0}", &[&tag])))?;
        let assets = body.get("assets").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let asset = pick_asset(&assets);
        let s = |k: &str| body.get(k).and_then(|v| v.as_str()).map(str::to_string);
        let check = UpdateCheck {
            current: self.current.clone(),
            available: is_newer(&latest, &self.current),
            skipped: skipped == latest,
            latest,
            notes: s("body").unwrap_or_default(),
            url: s("html_url").unwrap_or_else(|| RELEASES_URL.into()),
            asset_url: asset.as_ref().map(|a| a.1.clone()),
            asset_name: asset.as_ref().map(|a| a.0.clone()),
            asset_size: asset.as_ref().map(|a| a.2).filter(|s| *s > 0),
            asset_sha256: asset.as_ref().and_then(|a| asset_digest(&assets, &a.0)),
            published_at: s("published_at"),
        };
        *self.last.lock().await = Some((Instant::now(), check.clone()));
        Ok(check)
    }

    /// Descarga el instalador de la última versión comprobada (progreso en
    /// `update:progress`). Devuelve la ruta local.
    pub async fn download(&self, st: &AppState) -> anyhow::Result<Downloaded> {
        let _guard = self.download_lock.lock().await;
        let check = self
            .last
            .lock()
            .await
            .as_ref()
            .map(|(_, c)| c.clone())
            .ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("Comprueba primero si hay actualizaciones")))?;
        if !check.available {
            anyhow::bail!("{}", crate::i18n::t("Ya tienes la última versión"));
        }
        let (Some(url), Some(name)) = (check.asset_url.clone(), check.asset_name.clone()) else {
            anyhow::bail!("{}", crate::i18n::t("Esta versión no trae instalador"));
        };
        if !url.starts_with("https://github.com/") && !url.starts_with("https://objects.githubusercontent.com/") {
            anyhow::bail!("{}", crate::i18n::t("Origen del instalador no permitido"));
        }
        self.fetch_installer(st, &url, &name, check.asset_size, check.asset_sha256.clone()).await
    }

    /// Descarga un instalador (progreso en `update:progress`) y comprueba su huella.
    async fn fetch_installer(&self, st: &AppState, url: &str, name: &str, size: Option<u64>, sha256: Option<String>) -> anyhow::Result<Downloaded> {
        // Solo el nombre del fichero: viene de la red.
        let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')).collect();
        let path = update_dir().join(if safe.is_empty() { "ejGames-setup.exe".to_string() } else { safe });
        std::fs::create_dir_all(update_dir())?;
        let emit = |received: u64, total: u64| {
            let _ = st.app.emit("update:progress", serde_json::json!({ "received": received, "total": total }));
        };
        // Ya descargado y entero: se reutiliza.
        if let (Ok(meta), Some(size)) = (std::fs::metadata(&path), size) {
            let intact = match &sha256 {
                Some(expected) => std::fs::read(&path).map(|b| &hex(&Sha256::digest(&b)) == expected).unwrap_or(false),
                None => true,
            };
            if meta.len() == size && intact {
                emit(size, size);
                return Ok(Downloaded { path: path.to_string_lossy().into_owned(), size });
            }
        }
        let partial = path.with_extension("part");
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(900))
            .connect_timeout(Duration::from_secs(15))
            .user_agent(format!("ejGames/{}", self.current))
            .build()?;
        let mut resp = client.get(url).send().await?.error_for_status()?;
        let total = resp.content_length().or(size).unwrap_or(0);
        let mut file = std::fs::File::create(&partial)?;
        let mut received = 0u64;
        let mut hasher = Sha256::new();
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        while let Some(chunk) = resp.chunk().await? {
            file.write_all(&chunk)?;
            hasher.update(&chunk);
            received += chunk.len() as u64;
            if last_emit.elapsed() >= Duration::from_millis(150) {
                last_emit = Instant::now();
                emit(received, total);
            }
        }
        file.flush()?;
        drop(file);
        if let Some(size) = size {
            if received != size {
                let _ = std::fs::remove_file(&partial);
                anyhow::bail!("{}", crate::i18n::tf("Descarga incompleta ({0} de {1} bytes)", &[&received, &size]));
            }
        }
        if let Some(expected) = &sha256 {
            if &hex(&hasher.finalize()) != expected {
                let _ = std::fs::remove_file(&partial);
                anyhow::bail!("{}", crate::i18n::t("El instalador descargado no coincide con el publicado"));
            }
        }
        std::fs::rename(&partial, &path)?;
        emit(received, received);
        Ok(Downloaded { path: path.to_string_lossy().into_owned(), size: received })
    }
}

/// Una versión publicada (para volver a una anterior).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseEntry {
    pub version: String,
    pub published_at: Option<String>,
    pub url: String,
    pub asset_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
    pub asset_sha256: Option<String>,
}

fn release_entry(r: &serde_json::Value) -> Option<ReleaseEntry> {
    if r.get("draft").and_then(|v| v.as_bool()) == Some(true) || r.get("prerelease").and_then(|v| v.as_bool()) == Some(true) {
        return None;
    }
    let tag = r.get("tag_name")?.as_str()?;
    let (a, b, c) = parse_version(tag)?;
    let assets = r.get("assets").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let asset = pick_asset(&assets)?;
    let s = |k: &str| r.get(k).and_then(|v| v.as_str()).map(str::to_string);
    Some(ReleaseEntry {
        version: format!("{a}.{b}.{c}"),
        published_at: s("published_at"),
        url: s("html_url").unwrap_or_else(|| RELEASES_URL.into()),
        asset_sha256: asset_digest(&assets, &asset.0),
        asset_url: Some(asset.1),
        asset_name: Some(asset.0),
        asset_size: Some(asset.2).filter(|n| *n > 0),
    })
}

impl Updater {
    /// Últimas versiones publicadas con instalador (la actual incluida).
    pub async fn releases(&self) -> anyhow::Result<Vec<ReleaseEntry>> {
        let resp = self
            .http
            .get(format!("https://api.github.com/repos/{}/releases?per_page=20", repo()))
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
            .send()
            .await
            .map_err(|e| if e.is_connect() { anyhow::anyhow!("{}", crate::i18n::t("Sin conexión")) } else { anyhow::anyhow!("{e}") })?;
        let status = resp.status();
        if status == reqwest::StatusCode::FORBIDDEN || status.as_u16() == 429 {
            anyhow::bail!("{}", crate::i18n::t("GitHub ha limitado las consultas; prueba más tarde"));
        }
        if !status.is_success() {
            anyhow::bail!("{}", crate::i18n::tf("GitHub respondió {0}", &[&status.as_u16()]));
        }
        let list: Vec<serde_json::Value> = resp.json().await?;
        Ok(list.iter().filter_map(release_entry).collect())
    }

    /// Descarga el instalador de una versión concreta (para volver a ella).
    pub async fn download_version(&self, st: &AppState, version: &str) -> anyhow::Result<Downloaded> {
        let _guard = self.download_lock.lock().await;
        let entry = self
            .releases()
            .await?
            .into_iter()
            .find(|r| r.version == version)
            .ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("Esa versión ya no está publicada")))?;
        let (Some(url), Some(name)) = (entry.asset_url.clone(), entry.asset_name.clone()) else {
            anyhow::bail!("{}", crate::i18n::t("Esta versión no trae instalador"));
        };
        if !url.starts_with("https://github.com/") && !url.starts_with("https://objects.githubusercontent.com/") {
            anyhow::bail!("{}", crate::i18n::t("Origen del instalador no permitido"));
        }
        self.fetch_installer(st, &url, &name, entry.asset_size, entry.asset_sha256.clone()).await
    }
}

/// Abre el instalador descargado en modo pasivo. Quien llama cierra ejGames.
pub fn launch_installer(path: &str) -> anyhow::Result<()> {
    let file = PathBuf::from(path);
    let inside = file
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .zip(update_dir().canonicalize().ok())
        .map(|(a, b)| a == b)
        .unwrap_or(false);
    if !inside || !file.is_file() {
        anyhow::bail!("Instalador no encontrado");
    }
    // /P pasivo (solo la barra), /R reabrir al terminar, /UPDATE sin tocar los datos.
    std::process::Command::new(&file)
        .args(["/P", "/R", "/UPDATE"])
        .spawn()
        .map_err(|e| anyhow::anyhow!("{}", crate::i18n::tf("No se pudo abrir el instalador: {0}", &[&e])))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert_eq!(parse_version("v0.3.1"), Some((0, 3, 1)));
        assert_eq!(parse_version("ejGames 1.2"), Some((1, 2, 0)));
        assert_eq!(parse_version("latest"), None);
        assert!(is_newer("0.3.0", "0.2.2"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(!is_newer("0.2.2", "0.2.2"));
        assert!(!is_newer("0.2.1", "0.2.2"));
        assert!(is_newer("0.4.0", "0.4.0-beta.1"));
        assert!(!is_newer("nada", "0.2.2"));
    }

    #[test]
    fn release_list_skips_drafts_and_unsigned_assets() {
        let r = |tag: &str, draft: bool, with_asset: bool| {
            serde_json::json!({
                "tag_name": tag, "draft": draft, "prerelease": false, "html_url": "https://github.com/x",
                "assets": if with_asset { serde_json::json!([{ "name": "ejGames_1.0.0_Setup.exe", "browser_download_url": "https://github.com/a", "size": 5 }]) } else { serde_json::json!([]) }
            })
        };
        assert_eq!(release_entry(&r("v0.9.4", false, true)).unwrap().version, "0.9.4");
        assert!(release_entry(&r("v0.9.3", true, true)).is_none());
        assert!(release_entry(&r("v0.9.2", false, false)).is_none());
        assert!(release_entry(&r("nada", false, true)).is_none());
    }

    #[test]
    fn picks_the_installer() {
        let assets = serde_json::json!([
            { "name": "notas.txt", "browser_download_url": "https://github.com/a", "size": 1 },
            { "name": "ejGames_0.3.0_x64-setup.exe", "browser_download_url": "https://github.com/b", "size": 9,
              "digest": "sha256:AC178A4F7E8BD2EDD3281111465D6806BA9A2CE6A0B60FBDB2833311B436130B" }
        ]);
        let list = assets.as_array().unwrap();
        let (name, url, size) = pick_asset(list).unwrap();
        assert_eq!((name.as_str(), url.as_str(), size), ("ejGames_0.3.0_x64-setup.exe", "https://github.com/b", 9));
        assert_eq!(asset_digest(list, &name).unwrap(), "ac178a4f7e8bd2edd3281111465d6806ba9a2ce6a0b60fbdb2833311b436130b");
        // El que se publica desde la 0.3.0: el instalador propio (installer-app/).
        let own = serde_json::json!([{ "name": "ejGames_0.3.1_Setup.exe", "browser_download_url": "https://github.com/c", "size": 5 }]);
        assert_eq!(pick_asset(own.as_array().unwrap()).unwrap().0, "ejGames_0.3.1_Setup.exe");
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Con GitHub de verdad: `cargo test --lib live_releases -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_releases() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let list = rt.block_on(Updater::new("0.12.0".into()).releases()).unwrap();
        for r in list.iter().take(4) {
            println!("{} {:?} {:?}", r.version, r.asset_name, r.asset_size);
        }
        assert!(list.iter().any(|r| r.version == "0.9.4") && list.iter().all(|r| r.asset_url.is_some()));
    }
}
