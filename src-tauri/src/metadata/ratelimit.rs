//! Limitador por proveedor: intervalo mínimo entre peticiones + backoff tras 429/5xx.

use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub struct RateLimiter {
    min_interval: Duration,
    next: Mutex<Instant>,
}

impl RateLimiter {
    pub fn new(min_interval: Duration) -> Self {
        RateLimiter {
            min_interval,
            next: Mutex::new(Instant::now()),
        }
    }

    /// Espera turno. El lock solo se mantiene para reservar el hueco.
    pub async fn acquire(&self) {
        let wait = {
            let mut next = self.next.lock().await;
            let now = Instant::now();
            let slot = (*next).max(now);
            *next = slot + self.min_interval;
            slot.saturating_duration_since(now)
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }

    pub async fn backoff(&self, d: Duration) {
        let mut next = self.next.lock().await;
        let until = Instant::now() + d;
        if until > *next {
            *next = until;
        }
    }
}

/// GET con limitador y reintentos ante 429/5xx.
pub async fn get(
    http: &reqwest::Client,
    limiter: &RateLimiter,
    req: impl Fn() -> reqwest::RequestBuilder,
) -> anyhow::Result<reqwest::Response> {
    let _ = http;
    let mut delay = Duration::from_secs(5);
    for attempt in 0..4 {
        limiter.acquire().await;
        match req().send().await {
            Ok(r) if r.status().as_u16() == 429 || r.status().is_server_error() => {
                tracing::warn!("rate limit/5xx ({}) intento {attempt}", r.status());
                limiter.backoff(delay).await;
                delay *= 3;
            }
            Ok(r) => return Ok(r),
            Err(e) if attempt < 3 && (e.is_timeout() || e.is_connect()) => {
                limiter.backoff(Duration::from_secs(2)).await;
            }
            Err(e) => return Err(e.into()),
        }
    }
    anyhow::bail!("demasiados reintentos")
}
