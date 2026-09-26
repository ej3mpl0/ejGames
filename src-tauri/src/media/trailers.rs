//! Proxy + caché de tráilers de Steam (HLS/microtrailer). Solo sirve rutas bajo
//! la URL base de una fila de media conocida: no es un proxy abierto.

use crate::db::repo;
use crate::state::AppState;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

static IN_FLIGHT: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(Default::default);
static LAST_PRUNE: AtomicI64 = AtomicI64::new(0);

fn valid_rel(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.starts_with('/')
        && !rel.contains("..")
        && rel.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/'))
}

pub fn mime(rel: &str) -> &'static str {
    match rel.rsplit('.').next().unwrap_or("") {
        "m3u8" => "application/vnd.apple.mpegurl",
        "m4s" => "video/iso.segment",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mpd" => "application/dash+xml",
        "ts" => "video/mp2t",
        "m4a" => "audio/mp4",
        _ => "application/octet-stream",
    }
}

/// Devuelve la ruta local del fichero pedido, descargándolo si hace falta.
pub async fn get(st: &Arc<AppState>, media_id: i64, rel: &str) -> anyhow::Result<PathBuf> {
    if !valid_rel(rel) {
        anyhow::bail!("ruta no válida");
    }
    let rec = st
        .db
        .with(|c| repo::media_by_id(c, media_id))?
        .filter(|m| matches!(m.kind.as_str(), "trailer" | "microtrailer"))
        .ok_or_else(|| anyhow::anyhow!("media desconocida"))?;
    let remote = rec.remote_url.ok_or_else(|| anyhow::anyhow!("sin URL"))?;
    let base = remote.split('?').next().unwrap_or(&remote);
    let base = &base[..=base.rfind('/').unwrap_or(0)];
    let dir = st.paths.trailers.join(media_id.to_string());
    let local = dir.join(rel.replace('/', "\\"));

    // Marca de último uso para el LRU (una escritura por reproducción).
    if rel.ends_with(".m3u8") || rel.ends_with(".mp4") {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join(".last"), crate::util::now().to_string());
    }

    loop {
        if local.exists() {
            return Ok(local);
        }
        let mine = IN_FLIGHT.lock().insert(local.clone());
        if mine {
            break;
        }
        tokio::time::sleep(Duration::from_millis(60)).await;
    }
    let res = async {
        let bytes = st.http.get(format!("{base}{rel}")).send().await?.error_for_status()?.bytes().await?;
        tokio::fs::create_dir_all(local.parent().unwrap()).await?;
        let tmp = local.with_extension(format!("part{}", std::process::id()));
        tokio::fs::write(&tmp, &bytes).await?;
        tokio::fs::rename(&tmp, &local).await?;
        anyhow::Ok(())
    }
    .await;
    IN_FLIGHT.lock().remove(&local);
    res?;

    let now = crate::util::now();
    if now - LAST_PRUNE.load(Ordering::Relaxed) > 120 {
        LAST_PRUNE.store(now, Ordering::Relaxed);
        let st2 = st.clone();
        tauri::async_runtime::spawn_blocking(move || prune(&st2.paths.trailers, st2.settings.get().trailer_cache_mb));
    }
    Ok(local)
}

/// Filtra las variantes del master HLS por altura máxima (ahorra ancho de banda).
pub fn filter_master(text: &str, max_h: u32) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let mut variants: Vec<(u32, usize)> = vec![]; // (altura, índice de la línea STREAM-INF)
    for (i, l) in lines.iter().enumerate() {
        if l.starts_with("#EXT-X-STREAM-INF") {
            let h = l
                .split("RESOLUTION=")
                .nth(1)
                .and_then(|r| r.split([',', '\n']).next())
                .and_then(|r| r.split('x').nth(1))
                .and_then(|h| h.parse().ok())
                .unwrap_or(0);
            variants.push((h, i));
        }
    }
    if variants.is_empty() {
        return text.to_string();
    }
    let keep_any = variants.iter().any(|(h, _)| *h <= max_h);
    let min_h = variants.iter().map(|v| v.0).min().unwrap_or(0);
    let drop: HashSet<usize> = variants
        .iter()
        .filter(|(h, _)| if keep_any { *h > max_h } else { *h != min_h })
        .flat_map(|(_, i)| [*i, i + 1])
        .collect();
    lines
        .iter()
        .enumerate()
        .filter(|(i, _)| !drop.contains(i))
        .map(|(_, l)| *l)
        .collect::<Vec<_>>()
        .join("\n")
}

fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

/// LRU por tráiler: borra los menos usados hasta caber en `max_mb`.
pub fn prune(root: &Path, max_mb: u64) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    let mut dirs: Vec<(i64, u64, PathBuf)> = rd
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| {
            let last = std::fs::read_to_string(e.path().join(".last"))
                .ok()
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);
            (last, dir_size(&e.path()), e.path())
        })
        .collect();
    let mut total: u64 = dirs.iter().map(|d| d.1).sum();
    let max = max_mb * 1024 * 1024;
    dirs.sort_by_key(|d| d.0);
    for (_, size, path) in dirs {
        if total <= max {
            break;
        }
        if std::fs::remove_dir_all(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn master_filter() {
        let m = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"a.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=5800000,RESOLUTION=1920x1080,AUDIO=\"audio\"\nv0.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2600000,RESOLUTION=1280x720,AUDIO=\"audio\"\nv1.m3u8";
        let f = super::filter_master(m, 720);
        assert!(!f.contains("v0.m3u8"));
        assert!(f.contains("v1.m3u8"));
        assert!(f.contains("a.m3u8"));
        let f2 = super::filter_master(m, 360);
        assert!(f2.contains("v1.m3u8") && !f2.contains("v0.m3u8"));
    }
}
