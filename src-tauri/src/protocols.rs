//! Esquemas propios (asíncronos, fuera del hilo principal):
//! - ejg-media: arte y vídeo cacheados (Range en trozos de 2 MB).
//! - ejg-theme: ficheros de temas + SDK, con CSP estricta y `sandbox` propio.
//!
//! Los temas corren en iframes con origen `null`, así que ambos esquemas
//! responden CORS abierto (los datos son públicos: arte y ficheros del tema).

use crate::db::repo;
use crate::media::{download, trailers};
use crate::state::AppState;
use crate::themes;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, UriSchemeContext, UriSchemeResponder, Wry};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

const CHUNK: u64 = 2 * 1024 * 1024;

/// CSP de los temas. `{T}` es el origen del propio esquema (ejg-theme o ejg-safe).
const THEME_CSP_TEMPLATE: &str = "sandbox allow-scripts; default-src 'none'; \
script-src {T} 'unsafe-inline'; \
style-src {T} 'unsafe-inline'; \
img-src http://ejg-media.localhost {T} data: blob:; \
media-src http://ejg-media.localhost {T} blob:; \
font-src {T} data:; \
connect-src http://ejg-media.localhost; \
worker-src blob: {T}; \
base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";

pub fn theme_csp(origin: &str) -> String {
    THEME_CSP_TEMPLATE.replace("{T}", origin)
}

type Resp = Response<Vec<u8>>;

fn base(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        .header("Access-Control-Allow-Headers", "Range, Content-Type")
        .header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("X-Content-Type-Options", "nosniff")
}

fn text(status: StatusCode, msg: &str) -> Resp {
    base(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

fn preflight() -> Resp {
    base(StatusCode::NO_CONTENT).header("Access-Control-Max-Age", "86400").body(vec![]).unwrap()
}

fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (len.saturating_sub(n), len - 1)
    } else {
        let s: u64 = a.parse().ok()?;
        let e: u64 = if b.is_empty() { len - 1 } else { b.parse().ok()? };
        (s, e.min(len - 1))
    };
    (start <= end && start < len).then_some((start, end))
}

async fn serve_file(path: &Path, mime: &str, range: Option<&str>, immutable: bool, extra_csp: Option<&str>) -> Resp {
    let Ok(mut f) = tokio::fs::File::open(path).await else {
        return text(StatusCode::NOT_FOUND, "no encontrado");
    };
    let len = f.metadata().await.map(|m| m.len()).unwrap_or(0);
    let cache = if immutable { "public, max-age=31536000, immutable" } else { "no-cache" };
    let mut b = base(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, cache);
    if let Some(csp) = extra_csp {
        b = b.header("Content-Security-Policy", csp);
    }
    if let Some((start, end)) = range.and_then(|r| parse_range(r, len)) {
        let end = end.min(start + CHUNK - 1);
        let n = (end - start + 1) as usize;
        let mut buf = vec![0u8; n];
        if f.seek(std::io::SeekFrom::Start(start)).await.is_err() || f.read_exact(&mut buf).await.is_err() {
            return text(StatusCode::INTERNAL_SERVER_ERROR, "lectura");
        }
        return b
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(header::CONTENT_LENGTH, n.to_string())
            .body(buf)
            .unwrap();
    }
    let mut buf = Vec::with_capacity(len as usize);
    if f.read_to_end(&mut buf).await.is_err() {
        return text(StatusCode::INTERNAL_SERVER_ERROR, "lectura");
    }
    b.header(header::CONTENT_LENGTH, buf.len().to_string()).body(buf).unwrap()
}

fn mime_of(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("js" | "mjs") => "text/javascript; charset=utf-8".into(),
        Some("css") => "text/css; charset=utf-8".into(),
        Some("html" | "htm") => "text/html; charset=utf-8".into(),
        Some("json") => "application/json; charset=utf-8".into(),
        Some("svg") => "image/svg+xml".into(),
        Some("woff2") => "font/woff2".into(),
        Some("woff") => "font/woff".into(),
        Some("ttf") => "font/ttf".into(),
        Some("otf") => "font/otf".into(),
        Some("wav") => "audio/wav".into(),
        Some("ogg") => "audio/ogg".into(),
        Some("mp3") => "audio/mpeg".into(),
        _ => mime_guess::from_path(path).first_or_octet_stream().to_string(),
    }
}

fn state(ctx: &UriSchemeContext<'_, Wry>) -> Arc<AppState> {
    ctx.app_handle().state::<Arc<AppState>>().inner().clone()
}

// ───────────────────────────── ejg-media ─────────────────────────────

pub fn media_handler(ctx: UriSchemeContext<'_, Wry>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let st = state(&ctx);
    tauri::async_runtime::spawn(async move {
        let resp = if req.method() == "OPTIONS" { preflight() } else { media(&st, &req).await };
        responder.respond(resp);
    });
}

async fn media(st: &Arc<AppState>, req: &Request<Vec<u8>>) -> Resp {
    let path = req.uri().path().trim_start_matches('/').to_string();
    let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let parts: Vec<&str> = path.splitn(3, '/').collect();
    match parts.as_slice() {
        ["m", file] => {
            let Some((hash, ext)) = file.split_once('.') else { return text(StatusCode::BAD_REQUEST, "ruta") };
            if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.len() < 8 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
                return text(StatusCode::BAD_REQUEST, "ruta");
            }
            let p = st.paths.media_file(hash, ext);
            serve_file(&p, &mime_of(&p), range.as_deref(), true, None).await
        }
        ["r", id, rest @ ..] => {
            let Ok(id) = id.parse::<i64>() else { return text(StatusCode::BAD_REQUEST, "id") };
            let variant = rest.first().copied().unwrap_or("");
            match remote(st, id, variant).await {
                Ok((p, immutable)) => serve_file(&p, &mime_of(&p), range.as_deref(), immutable, None).await,
                Err(e) => text(StatusCode::NOT_FOUND, &e.to_string()),
            }
        }
        // Iconos de logros de Steam (caché en disco).
        ["a", appid, file] => {
            let Ok(appid) = appid.parse::<i64>() else { return text(StatusCode::BAD_REQUEST, "appid") };
            if !crate::achievements::valid_icon_name(file) {
                return text(StatusCode::BAD_REQUEST, "ruta");
            }
            match download::cached_remote(st, &crate::achievements::icon_remote(appid, file)).await {
                Ok(p) => serve_file(&p, &mime_of(&p), None, true, None).await,
                Err(e) => text(StatusCode::BAD_GATEWAY, &e.to_string()),
            }
        }
        // Capturas de pantalla del overlay (y su miniatura: /s/<id>/t).
        ["s", id, rest @ ..] => {
            let Ok(id) = id.parse::<i64>() else { return text(StatusCode::BAD_REQUEST, "id") };
            let thumb = rest.first() == Some(&"t");
            match crate::overlay::capture::file(st, id, thumb) {
                Some(p) => serve_file(&p, &mime_of(&p), range.as_deref(), false, None).await,
                None => text(StatusCode::NOT_FOUND, "captura no encontrada"),
            }
        }
        // Portadas y capturas de Explorar (id opaco, ver explore::images).
        ["x", id] => match crate::explore::images::serve(st, id).await {
            Ok(p) => serve_file(&p, &mime_of(&p), None, true, None).await,
            Err(e) => text(StatusCode::NOT_FOUND, &e.to_string()),
        },
        ["t", id, rel] => {
            let Ok(id) = id.parse::<i64>() else { return text(StatusCode::BAD_REQUEST, "id") };
            match trailers::get(st, id, rel).await {
                Ok(p) => {
                    let mime = trailers::mime(rel);
                    if rel.ends_with(".m3u8") {
                        // El master se filtra por calidad máxima.
                        let body = tokio::fs::read_to_string(&p).await.unwrap_or_default();
                        let body = trailers::filter_master(&body, st.settings.get().trailer_max_height);
                        base(StatusCode::OK)
                            .header(header::CONTENT_TYPE, mime)
                            .header(header::CACHE_CONTROL, "no-cache")
                            .body(body.into_bytes())
                            .unwrap()
                    } else {
                        serve_file(&p, mime, range.as_deref(), true, None).await
                    }
                }
                Err(e) => text(StatusCode::BAD_GATEWAY, &e.to_string()),
            }
        }
        _ => text(StatusCode::NOT_FOUND, "no encontrado"),
    }
}

/// Media remota perezosa: se descarga al primer uso y se sirve desde disco.
async fn remote(st: &Arc<AppState>, id: i64, variant: &str) -> anyhow::Result<(PathBuf, bool)> {
    let rec = st.db.with(|c| repo::media_by_id(c, id))?.ok_or_else(|| anyhow::anyhow!("media desconocida"))?;
    let is_art = matches!(rec.kind.as_str(), "cover" | "hero" | "logo" | "icon" | "header");
    // Arte principal: se guarda en el almacén (con miniatura) la primera vez que se pide.
    if is_art && (variant.is_empty() || variant == "t") {
        if rec.hash.is_none() {
            // La misma imagen pedida dos veces a la vez: una sola descarga.
            let _guard = download::key_lock(&format!("media:{id}")).await;
            let fresh = st.db.with(|c| repo::media_by_id(c, id))?.ok_or_else(|| anyhow::anyhow!("media desconocida"))?;
            if fresh.hash.is_none() {
                download::download_record(st, &fresh).await?;
            }
        }
        let rec = st.db.with(|c| repo::media_by_id(c, id))?.ok_or_else(|| anyhow::anyhow!("media desconocida"))?;
        if variant == "t" {
            let thumb: Option<String> = st
                .db
                .with(|c| c.query_row("SELECT thumb_hash FROM media WHERE id = ?1", [id], |r| r.get(0)))
                .ok()
                .flatten();
            if let Some(t) = thumb {
                return Ok((st.paths.media_file(&t, "jpg"), true));
            }
        }
        if let (Some(h), Some(e)) = (rec.hash, rec.ext) {
            return Ok((st.paths.media_file(&h, &e), true));
        }
        anyhow::bail!("{}", crate::i18n::t("no se pudo descargar"));
    }
    let url = match variant {
        "thumb" => rec.extra.get("thumb").and_then(|v| v.as_str()).map(str::to_string),
        "poster" => rec.extra.get("poster").and_then(|v| v.as_str()).map(str::to_string),
        _ => {
            if let (Some(h), Some(e)) = (&rec.hash, &rec.ext) {
                return Ok((st.paths.media_file(h, e), true));
            }
            rec.remote_url.clone()
        }
    }
    .ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("sin URL")))?;
    if !url.starts_with("https://") {
        anyhow::bail!("URL no permitida");
    }
    Ok((download::cached_remote(st, &url).await?, true))
}

// ───────────────────────────── ejg-theme ─────────────────────────────

pub fn theme_handler(ctx: UriSchemeContext<'_, Wry>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let st = state(&ctx);
    tauri::async_runtime::spawn(async move {
        let resp = if req.method() == "OPTIONS" { preflight() } else { theme(&st, &req, false).await };
        responder.respond(resp);
    });
}

/// Esquema de rescate: solo temas de serie, en otro origen (y por tanto en otro
/// proceso de renderizado) para recuperarse de un tema colgado sin reiniciar.
pub fn safe_theme_handler(ctx: UriSchemeContext<'_, Wry>, req: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let st = state(&ctx);
    tauri::async_runtime::spawn(async move {
        let resp = if req.method() == "OPTIONS" { preflight() } else { theme(&st, &req, true).await };
        responder.respond(resp);
    });
}

fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = percent_encoding::percent_decode_str(rel).decode_utf8().ok()?;
    let mut p = root.to_path_buf();
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." || seg.contains('\\') || seg.contains(':') {
            return None;
        }
        p.push(seg);
    }
    Some(p)
}

async fn theme(st: &Arc<AppState>, req: &Request<Vec<u8>>, safe: bool) -> Resp {
    let csp = theme_csp(if safe { themes::SAFE_ORIGIN } else { themes::THEME_ORIGIN });
    let path = req.uri().path().trim_start_matches('/').to_string();
    let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let (first, rest) = path.split_once('/').unwrap_or((path.as_str(), ""));

    let root = if first == "_sdk" {
        Some(st.paths.sdk.clone())
    } else if safe {
        let d = st.paths.builtin_themes.join(first);
        let valid = first.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        (valid && d.join("theme.json").exists()).then_some(d)
    } else {
        themes::dir_of(&st.paths, first)
    };
    let Some(root) = root else { return text(StatusCode::NOT_FOUND, "tema no encontrado") };
    let rest = if rest.is_empty() && first != "_sdk" { "index.html" } else { rest };
    let Some(file) = safe_join(&root, rest) else { return text(StatusCode::FORBIDDEN, "ruta") };
    let file = if file.is_dir() { file.join("index.html") } else { file };

    let is_html = file.extension().map(|e| e == "html" || e == "htm").unwrap_or(false);
    if is_html && first != "_sdk" {
        // Inyecta el SDK antes que cualquier script del tema.
        let Ok(html) = tokio::fs::read_to_string(&file).await else {
            return text(StatusCode::NOT_FOUND, "no encontrado");
        };
        let tag = "<script src=\"/_sdk/ejg.js\"></script>";
        let html = match html.find("<head>").or_else(|| html.find("<HEAD>")) {
            Some(i) => format!("{}{}{}", &html[..i + 6], tag, &html[i + 6..]),
            None => format!("{tag}{html}"),
        };
        return base(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-cache")
            .header("Content-Security-Policy", csp.as_str())
            .body(html.into_bytes())
            .unwrap();
    }
    serve_file(&file, &mime_of(&file), range.as_deref(), false, Some(&csp)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=200-", 100), None);
    }

    #[test]
    fn traversal() {
        let root = Path::new("C:\\t\\steam");
        assert!(safe_join(root, "../ps5/x.js").is_none());
        assert!(safe_join(root, "%2e%2e/x").is_none());
        assert!(safe_join(root, "a\\..\\b").is_none());
        assert_eq!(safe_join(root, "js/main.js").unwrap(), root.join("js").join("main.js"));
    }

    #[test]
    fn csp_blocks_network() {
        let csp = theme_csp(themes::THEME_ORIGIN);
        assert!(csp.starts_with("sandbox allow-scripts"));
        assert!(!csp.contains("allow-same-origin"));
        assert!(csp.contains("connect-src http://ejg-media.localhost;"));
        assert!(csp.contains("script-src http://ejg-theme.localhost 'unsafe-inline'"));
        assert!(theme_csp(themes::SAFE_ORIGIN).contains("script-src http://ejg-safe.localhost"));
    }
}
