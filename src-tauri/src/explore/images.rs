//! Portadas y capturas de Explorar (y las imágenes de las guías) servidas por ejg-media (`/x/<id>`), con
//! caché en disco. El id es opaco: solo se sirven imágenes cuya URL ha devuelto
//! antes Rust en una búsqueda o ficha, así un tema (que puede pedir cualquier
//! ruta de ejg-media) no la puede usar como proxy a internet.

use crate::state::AppState;
use futures::StreamExt;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

const MAX_IMAGE: usize = 10 * 1024 * 1024;
const EXTS: [&str; 4] = ["jpg", "png", "webp", "gif"];
/// Hosts de los que salen las imágenes de las fichas, el arte de Steam y las
/// guías de la comunidad (con las miniaturas de sus vídeos).
const HOSTS: [&str; 9] = [
    "imageban.ru",
    "riotpixels.net",
    "riotpixels.com",
    "wp.com",
    "fitgirl-repacks.site",
    "steamstatic.com",
    "steamusercontent.com",
    "steamuserimages-a.akamaihd.net",
    "i.ytimg.com",
];

static MAP: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Default::default);
/// Hosts de los catálogos que configura el usuario (`catalog-sources.json`) y de sus imágenes.
static EXTRA_HOSTS: parking_lot::RwLock<Vec<String>> = parking_lot::RwLock::new(Vec::new());

/// Cambia los hosts de imágenes de los catálogos del usuario.
pub fn set_extra_hosts(hosts: Vec<String>) {
    *EXTRA_HOSTS.write() = hosts.into_iter().map(|h| h.trim().trim_start_matches("*.").to_ascii_lowercase()).filter(|h| h.contains('.')).collect();
}

/// URL https normalizada si el host está permitido.
fn allowed(url: &str) -> Option<String> {
    let url = url.trim();
    let url = match url.strip_prefix("http://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    };
    let parsed = url::Url::parse(&url).ok()?;
    if parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?.to_ascii_lowercase();
    if host == "wp.com" || (host.ends_with(".wp.com") && !host.starts_with('i')) {
        return None;
    }
    let extra = EXTRA_HOSTS.read();
    HOSTS.iter().copied().chain(extra.iter().map(String::as_str)).any(|h| host == h || host.ends_with(&format!(".{h}"))).then_some(url)
}

fn id_of(url: &str) -> String {
    blake3::hash(url.as_bytes()).to_hex()[..32].to_string()
}

/// URL de ejg-media para una imagen remota (None si no está permitida).
pub fn proxy(url: &str) -> Option<String> {
    let url = allowed(url)?;
    let id = id_of(&url);
    let mut m = MAP.lock();
    if m.len() > 20_000 {
        m.clear();
    }
    m.insert(id.clone(), url);
    Some(format!("http://ejg-media.localhost/x/{id}"))
}

/// URL original de una portada (las de populares vienen por el CDN de wp.com).
pub fn original(url: &str) -> String {
    let url = url.trim();
    for p in ["https://i0.wp.com/", "https://i1.wp.com/", "https://i2.wp.com/", "https://i3.wp.com/"] {
        if let Some(rest) = url.strip_prefix(p) {
            return format!("https://{}", rest.split('?').next().unwrap_or(rest));
        }
    }
    url.to_string()
}

/// Portada por el CDN de wp.com con un ancho máximo: pesa menos y responde
/// aunque imageban rechace la petición directa (pasa con algunas).
fn photon(url: &str, w: u32) -> String {
    let orig = original(url);
    match orig.strip_prefix("https://") {
        Some(rest) if rest.contains("imageban.ru/") => format!("https://i0.wp.com/{rest}?w={w}"),
        _ => orig,
    }
}

/// Miniatura de una portada (~40 KB en vez de ~100).
pub fn thumb(url: &str) -> String {
    photon(url, 320)
}

/// Portada grande.
pub fn large(url: &str) -> String {
    photon(url, 800)
}

pub fn cache_dir(st: &AppState) -> PathBuf {
    st.paths.root.join("cache").join("explore")
}

fn cached(dir: &Path, id: &str) -> Option<PathBuf> {
    let sub = dir.join(&id[..2]);
    EXTS.iter().map(|e| sub.join(format!("{id}.{e}"))).find(|p| p.exists())
}

fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if b.starts_with(b"\x89PNG") {
        Some("png")
    } else if b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("webp")
    } else if b.starts_with(b"GIF8") {
        Some("gif")
    } else {
        None
    }
}

/// Ruta en disco de `/x/<id>` (la descarga si hace falta).
pub async fn serve(st: &Arc<AppState>, id: &str) -> anyhow::Result<PathBuf> {
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        anyhow::bail!("id no válido");
    }
    let dir = cache_dir(st);
    if let Some(p) = cached(&dir, id) {
        return Ok(p);
    }
    let _guard = crate::media::download::key_lock(&format!("explore:{id}")).await;
    if let Some(p) = cached(&dir, id) {
        return Ok(p);
    }
    let url = MAP.lock().get(id).cloned().ok_or_else(|| anyhow::anyhow!("imagen desconocida"))?;
    let http = st.explore.fitgirl.http();
    let mut r = http.get(&url).send().await?;
    // Las variantes reducidas de riotpixels (".720p.jpg") no existen si la
    // captura original es más pequeña: entonces, la original.
    if r.status() == reqwest::StatusCode::NOT_FOUND {
        if let Some(base) = sized_base(&url) {
            r = http.get(base).send().await?;
        }
    }
    // Webs que rechazan lo que no es un navegador (nxbrew): por el CDN de wp.com.
    if r.status() == reqwest::StatusCode::FORBIDDEN {
        if let Some(rest) = url.strip_prefix("https://").filter(|r| !r.contains("wp.com/")) {
            r = http.get(format!("https://i0.wp.com/{rest}")).send().await?;
        }
    }
    if !r.status().is_success() {
        anyhow::bail!("HTTP {}", r.status());
    }
    let is_image = r
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|t| t.starts_with("image/"))
        .unwrap_or(false);
    if !is_image {
        anyhow::bail!("no es una imagen");
    }
    let mut bytes = Vec::new();
    let mut stream = r.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if bytes.len() + chunk.len() > MAX_IMAGE {
            anyhow::bail!("imagen demasiado grande");
        }
        bytes.extend_from_slice(&chunk);
    }
    let ext = sniff(&bytes).ok_or_else(|| anyhow::anyhow!("formato de imagen no reconocido"))?;
    let path = dir.join(&id[..2]).join(format!("{id}.{ext}"));
    tokio::fs::create_dir_all(path.parent().unwrap()).await?;
    let tmp = crate::util::temp_path(&path);
    tokio::fs::write(&tmp, &bytes).await?;
    if tokio::fs::rename(&tmp, &path).await.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    Ok(path)
}

/// "…/x.jpg.720p.jpg" → "…/x.jpg".
fn sized_base(url: &str) -> Option<&str> {
    let (base, suffix) = url.rsplit_once(".jpg.")?;
    let ok = suffix.ends_with("p.jpg") && suffix[..suffix.len() - 5].bytes().all(|b| b.is_ascii_digit());
    ok.then(|| &url[..base.len() + 4])
}

/// Borra las imágenes más antiguas si la caché pasa de `max_mb`.
pub fn prune(dir: &Path, max_mb: u64) {
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = walkdir::WalkDir::new(dir)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((m.modified().ok()?, m.len(), e.into_path()))
        })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    let max = max_mb * 1024 * 1024;
    if total <= max {
        return;
    }
    files.sort_by_key(|f| f.0);
    for (_, len, path) in files {
        if total <= max * 8 / 10 {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_hosts() {
        assert!(proxy("https://i5.imageban.ru/out/a.jpg").is_some());
        assert!(proxy("http://s01.riotpixels.net/data/a.jpg.240p.jpg").is_some());
        assert!(proxy("https://i0.wp.com/i3.imageban.ru/a.jpg?w=320").is_some());
        assert!(proxy("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/h/header.jpg").is_some());
        assert!(proxy("https://images.steamusercontent.com/ugc/1/A/?imw=640").is_some());
        assert!(proxy("https://i.ytimg.com/vi/abc/hqdefault.jpg").is_some());
        assert!(proxy("https://other.akamaihd.net/a.jpg").is_none());
        assert!(proxy("https://evil.com/a.jpg").is_none());
        assert!(proxy("https://imageban.ru.evil.com/a.jpg").is_none());
        assert!(proxy("https://public-api.wordpress.wp.com/x").is_none());
        assert!(proxy("file:///C:/a.jpg").is_none());
    }

    #[test]
    fn covers() {
        assert_eq!(
            original("https://i0.wp.com/i3.imageban.ru/out/2021/a.jpg?resize=150%2C200&ssl=1"),
            "https://i3.imageban.ru/out/2021/a.jpg"
        );
        assert_eq!(thumb("https://i5.imageban.ru/out/a.jpg"), "https://i0.wp.com/i5.imageban.ru/out/a.jpg?w=320");
        assert_eq!(sized_base("https://s01.riotpixels.net/data/a/b.jpg.720p.jpg"), Some("https://s01.riotpixels.net/data/a/b.jpg"));
        assert_eq!(sized_base("https://s01.riotpixels.net/data/a/b.jpg"), None);
    }
}
