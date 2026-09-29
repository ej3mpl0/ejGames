//! Cliente de la API de cuentas (`server/`): firma de la app como el relay,
//! token de sesión y errores que se pueden enseñar tal cual.

use crate::state::AppState;
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

/// Segundos que hay que sumar al reloj del PC para que el servidor acepte la firma.
static SKEW: AtomicI64 = AtomicI64::new(0);

fn env_or_build(name: &str, built: Option<&'static str>) -> Option<String> {
    // En depuración se puede apuntar a `wrangler dev` sin recompilar.
    #[cfg(debug_assertions)]
    if let Ok(v) = std::env::var(name) {
        if !v.trim().is_empty() {
            return Some(v.trim().to_string());
        }
    }
    let _ = name;
    built.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

pub fn base_url() -> Option<String> {
    env_or_build("EJG_API_URL", option_env!("EJG_API_URL")).map(|u| u.trim_end_matches('/').to_string())
}

fn app_key() -> Option<String> {
    env_or_build("EJG_APP_KEY", option_env!("EJG_APP_KEY"))
}

/// Esta compilación tiene servidor de cuentas.
pub fn enabled() -> bool {
    base_url().is_some()
}

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ApiError {}

impl ApiError {
    fn new(status: u16, code: &str, message: &str) -> Self {
        ApiError { status, code: code.into(), message: message.into() }
    }

    fn net(e: impl std::fmt::Display) -> Self {
        tracing::warn!("cuentas: {e}");
        Self::new(0, "offline", "No se pudo conectar con el servidor de ejGames. Revisa tu conexión.")
    }

    /// La sesión ya no vale (caducó, se cerró desde otro PC o se borró la cuenta).
    pub fn session_gone(&self) -> bool {
        self.status == 401 && self.code == "no_session"
    }

    pub fn offline(&self) -> bool {
        self.status == 0
    }
}

pub enum Body<'a> {
    None,
    Json(&'a Value),
    Bytes(Vec<u8>, &'static str),
}

fn sign(key: &str, time: i64, method: &str, path: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes()).expect("hmac");
    mac.update(format!("{time}\n{method}\n{path}").as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

/// Petición a la API (`path` con su consulta, p. ej. "/v1/sync?rev=3").
/// `Ok(None)`: 304, no ha cambiado nada.
pub async fn request(st: &AppState, method: reqwest::Method, path: &str, token: Option<&str>, body: Body<'_>) -> Result<Option<Value>, ApiError> {
    let base = base_url().ok_or_else(|| ApiError::new(0, "disabled", "Esta versión de ejGames no tiene cuentas."))?;
    for attempt in 0..2 {
        let mut rb = st.http.request(method.clone(), format!("{base}{path}")).timeout(Duration::from_secs(20));
        if let Some(key) = app_key() {
            let time = crate::util::now() + SKEW.load(Ordering::Relaxed);
            rb = rb.header("X-Ejg-Time", time.to_string()).header("X-Ejg-Sig", sign(&key, time, method.as_str(), path));
        }
        if let Some(t) = token {
            rb = rb.bearer_auth(t);
        }
        rb = match &body {
            Body::None => rb,
            Body::Json(v) => rb.json(v),
            Body::Bytes(b, mime) => rb.header(reqwest::header::CONTENT_TYPE, *mime).body(b.clone()),
        };
        let r = rb.send().await.map_err(ApiError::net)?;
        let status = r.status().as_u16();
        if status == 304 {
            return Ok(None);
        }
        // Reloj del PC desfasado: el servidor dice su hora; se corrige y se repite.
        if status == 401 && attempt == 0 {
            if let Some(server_now) = r.headers().get("X-Ejg-Now").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<i64>().ok()) {
                SKEW.store(server_now - crate::util::now(), Ordering::Relaxed);
                continue;
            }
        }
        let text = r.text().await.map_err(ApiError::net)?;
        let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if (200..300).contains(&status) {
            return Ok(Some(v));
        }
        let code = v["error"].as_str().unwrap_or("error");
        let message = v["message"].as_str().map(str::to_string).unwrap_or_else(|| format!("El servidor de ejGames respondió {status}."));
        tracing::info!("cuentas: {} {path} → {status} {code}", method);
        return Err(ApiError { status, code: code.into(), message });
    }
    Err(ApiError::new(401, "bad_signature", "El reloj del PC no va bien. Ponlo en hora y vuelve a intentarlo."))
}

/// Como `request`, pero un 304 es un error (para las rutas que nunca lo dan).
pub async fn json(st: &AppState, method: reqwest::Method, path: &str, token: Option<&str>, body: Body<'_>) -> Result<Value, ApiError> {
    request(st, method, path, token, body).await?.ok_or_else(|| ApiError::new(500, "empty", "Respuesta vacía del servidor."))
}

/// URL pública de una imagen subida (por su hash).
pub fn media_url(hash: &str) -> Option<String> {
    let ok = hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit());
    ok.then(|| base_url().map(|b| format!("{b}/v1/media/{hash}"))).flatten()
}

#[cfg(test)]
mod tests {
    #[test]
    fn signature_matches_the_server() {
        // Mismo cálculo que server/src/index.js: HMAC-SHA256("hora\nMÉTODO\nruta").
        let s = super::sign("clave", 1_700_000_000, "GET", "/v1/sync?rev=3");
        // El mismo valor que da Node (crypto.createHmac) con esa clave y ese mensaje.
        assert_eq!(s, "23d7d9c63884c94b71f0394b260c233d40d358af5eb1cc5a4d52b3591f426cfc");
        assert_ne!(s, super::sign("clave", 1_700_000_000, "PUT", "/v1/sync?rev=3"));
    }
}
