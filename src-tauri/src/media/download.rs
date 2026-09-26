//! Descargas HTTP de arte y medios remotos.

use crate::db::repo;
use crate::state::AppState;
use futures::StreamExt;
use std::path::PathBuf;
use std::sync::Arc;

const MAX_IMAGE: usize = 40 * 1024 * 1024;

pub async fn fetch_bytes(http: &reqwest::Client, url: &str) -> anyhow::Result<Vec<u8>> {
    let r = http.get(url).send().await?;
    if !r.status().is_success() {
        anyhow::bail!("HTTP {} {url}", r.status());
    }
    let mut out = Vec::with_capacity(r.content_length().unwrap_or(0).min(MAX_IMAGE as u64) as usize);
    let mut stream = r.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if out.len() + chunk.len() > MAX_IMAGE {
            anyhow::bail!("demasiado grande: {url}");
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// Descarga una imagen, la guarda en el almacén y actualiza su fila de media.
pub async fn download_into(st: &Arc<AppState>, media_id: i64, url: &str, kind: &str) -> anyhow::Result<()> {
    let bytes = fetch_bytes(&st.http, url).await?;
    let st2 = st.clone();
    let kind = kind.to_string();
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
        let s = super::store::store_image(&st2.paths, &bytes, &kind)?;
        st2.db.with(|c| repo::set_media_file(c, media_id, &s.hash, &s.ext, s.thumb_hash.as_deref(), s.w, s.h))
    })
    .await??;
    Ok(())
}

/// Descarga la media de una fila probando su URL y, si falla, sus alternativas
/// (`extra.alts`). La URL que funcione queda como `remote_url`.
pub async fn download_record(st: &Arc<AppState>, rec: &repo::MediaRecord) -> anyhow::Result<()> {
    let mut urls: Vec<String> = rec.remote_url.clone().into_iter().collect();
    if let Some(alts) = rec.extra.get("alts").and_then(|a| a.as_array()) {
        urls.extend(alts.iter().filter_map(|u| u.as_str().map(str::to_string)));
    }
    let mut last = anyhow::anyhow!("sin URL");
    for (i, url) in urls.iter().enumerate() {
        match download_into(st, rec.id, url, &rec.kind).await {
            Ok(()) => {
                if i > 0 {
                    let id = rec.id;
                    let _ = st.db.with(|c| c.execute("UPDATE media SET remote_url = ?2 WHERE id = ?1", rusqlite::params![id, url]).map(|_| ()));
                }
                return Ok(());
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// Caché de ficheros remotos indexada por URL (capturas, pósters, miniaturas).
pub fn url_cache_path(st: &AppState, url: &str) -> PathBuf {
    let h = blake3::hash(url.as_bytes()).to_hex()[..32].to_string();
    let ext = url
        .split('?')
        .next()
        .and_then(|u| u.rsplit('.').next())
        .filter(|e| e.len() <= 4 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("bin")
        .to_ascii_lowercase();
    st.paths.media.join("url").join(&h[..2]).join(format!("{h}.{ext}"))
}

pub async fn cached_remote(st: &Arc<AppState>, url: &str) -> anyhow::Result<PathBuf> {
    let path = url_cache_path(st, url);
    if path.exists() {
        return Ok(path);
    }
    // Una sola descarga por URL aunque la pidan varias vistas a la vez.
    let _guard = key_lock(&format!("url:{url}")).await;
    if path.exists() {
        return Ok(path);
    }
    let bytes = fetch_bytes(&st.http, url).await?;
    tokio::fs::create_dir_all(path.parent().unwrap()).await?;
    let tmp = crate::util::temp_path(&path);
    tokio::fs::write(&tmp, &bytes).await?;
    if tokio::fs::rename(&tmp, &path).await.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
        if !path.exists() {
            anyhow::bail!("no se pudo guardar {}", path.display());
        }
    }
    Ok(path)
}

/// Candado asíncrono por clave: quien llega segundo espera al primero y luego
/// encuentra el trabajo hecho.
pub async fn key_lock(key: &str) -> tokio::sync::OwnedMutexGuard<()> {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Weak};
    static LOCKS: LazyLock<parking_lot::Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>> = LazyLock::new(Default::default);
    let m = {
        let mut g = LOCKS.lock();
        if g.len() > 256 {
            g.retain(|_, w| w.strong_count() > 0);
        }
        match g.get(key).and_then(Weak::upgrade) {
            Some(m) => m,
            None => {
                let m = Arc::new(tokio::sync::Mutex::new(()));
                g.insert(key.to_string(), Arc::downgrade(&m));
                m
            }
        }
    };
    m.lock_owned().await
}
