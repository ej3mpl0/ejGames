//! Cliente de fitgirl-repacks.site: la API REST de WordPress (búsqueda y fichas
//! completas en JSON) y la página de populares. La web está detrás de
//! DDoS-Guard: UA de navegador, cookies y un ritmo tranquilo.

use super::parse::{self, PopularItem};
use crate::metadata::ratelimit::RateLimiter;
use serde::Deserialize;
use std::time::Duration;

pub const ID: &str = "fitgirl";
const BASE: &str = "https://fitgirl-repacks.site";
/// Categoría «Lossless Repack» (deja fuera los resúmenes de actualizaciones).
const CATEGORY: u32 = 5;
const FIELDS: &str = "id,slug,link,date,title,content";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

#[derive(Debug, Clone)]
pub struct RawPost {
    pub id: i64,
    pub slug: String,
    pub link: String,
    pub date: String,
    pub title: String,
    pub content: String,
}

#[derive(Deserialize)]
struct WpPost {
    id: i64,
    slug: String,
    link: String,
    date: String,
    title: WpText,
    content: WpText,
}

#[derive(Deserialize)]
struct WpText {
    rendered: String,
}

impl From<WpPost> for RawPost {
    fn from(p: WpPost) -> Self {
        RawPost {
            id: p.id,
            slug: p.slug,
            link: p.link,
            date: p.date,
            title: parse::decode_entities(&p.title.rendered),
            content: p.content.rendered,
        }
    }
}

pub struct Page {
    pub posts: Vec<RawPost>,
    pub total: u32,
    pub pages: u32,
}

pub struct FitGirl {
    http: reqwest::Client,
    limiter: RateLimiter,
}

impl Default for FitGirl {
    fn default() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .cookie_store(true)
            .gzip(true)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .pool_idle_timeout(Duration::from_secs(30))
            .build()
            .expect("cliente http");
        FitGirl {
            http,
            limiter: RateLimiter::new(Duration::from_millis(700)),
        }
    }
}

/// Mensaje claro cuando la web no responde como debe.
fn site_error(status: reqwest::StatusCode, body: &str) -> anyhow::Error {
    if body.contains("ddos-guard") || body.contains("DDoS-Guard") || status.as_u16() == 403 {
        anyhow::anyhow!("La web de FitGirl está comprobando las visitas (protección anti-DDoS). Prueba dentro de unos minutos.")
    } else {
        anyhow::anyhow!("La web de FitGirl respondió con un error ({status}).")
    }
}

impl FitGirl {
    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// GET con turno y un reintento rápido (quien espera es el usuario, no una cola).
    async fn get(&self, url: &str, accept: &str) -> anyhow::Result<reqwest::Response> {
        let mut last = None;
        for attempt in 0..2 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(1500)).await;
            }
            self.limiter.acquire().await;
            match self.http.get(url).header("Accept", accept).send().await {
                Ok(r) if r.status().is_server_error() || r.status().as_u16() == 429 => last = Some(Ok(r)),
                Ok(r) => return self.check(r).await,
                Err(e) if e.is_timeout() || e.is_connect() => last = Some(Err(e)),
                Err(e) => return Err(anyhow::anyhow!("No se pudo conectar con FitGirl: {e}")),
            }
        }
        match last {
            Some(Ok(r)) => self.check(r).await,
            Some(Err(e)) => Err(anyhow::anyhow!("No se pudo conectar con FitGirl: {e}")),
            None => unreachable!(),
        }
    }

    async fn check(&self, r: reqwest::Response) -> anyhow::Result<reqwest::Response> {
        if !r.status().is_success() {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            return Err(site_error(status, &body));
        }
        Ok(r)
    }

    async fn posts(&self, url: &str) -> anyhow::Result<Page> {
        let r = self.get(url, "application/json").await?;
        let header = |name: &str| r.headers().get(name).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
        let (total, pages) = (header("x-wp-total"), header("x-wp-totalpages"));
        let body = r.text().await?;
        let posts: Vec<WpPost> = serde_json::from_str(&body).map_err(|_| site_error(reqwest::StatusCode::OK, &body))?;
        Ok(Page {
            posts: posts.into_iter().map(RawPost::from).collect(),
            total,
            pages,
        })
    }

    /// Búsqueda por título (la búsqueda normal de WordPress mira también el
    /// texto y llena la lista de resúmenes de actualizaciones).
    pub async fn search(&self, query: &str, page: u32, per_page: u32) -> anyhow::Result<Page> {
        let q = percent_encoding::utf8_percent_encode(query, percent_encoding::NON_ALPHANUMERIC);
        self.posts(&format!(
            "{BASE}/wp-json/wp/v2/posts?search={q}&search_columns=post_title&categories={CATEGORY}&per_page={per_page}&page={page}&_fields={FIELDS}"
        ))
        .await
    }

    /// Últimos repacks publicados.
    pub async fn latest(&self, page: u32, per_page: u32) -> anyhow::Result<Page> {
        self.posts(&format!("{BASE}/wp-json/wp/v2/posts?categories={CATEGORY}&per_page={per_page}&page={page}&_fields={FIELDS}"))
            .await
    }

    /// Varias entradas por slug, en el orden pedido.
    pub async fn by_slugs(&self, slugs: &[String]) -> anyhow::Result<Vec<RawPost>> {
        let valid: Vec<&String> = slugs.iter().filter(|s| valid_slug(s)).collect();
        if valid.is_empty() {
            return Ok(vec![]);
        }
        let mut out = Vec::new();
        for chunk in valid.chunks(50) {
            let list = chunk.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(",");
            let page = self
                .posts(&format!("{BASE}/wp-json/wp/v2/posts?slug={list}&per_page=100&_fields={FIELDS}"))
                .await?;
            out.extend(page.posts);
        }
        out.sort_by_key(|p| slugs.iter().position(|s| *s == p.slug).unwrap_or(usize::MAX));
        Ok(out)
    }

    /// Listas de populares (mes y semana).
    pub async fn popular(&self) -> anyhow::Result<Vec<(String, Vec<PopularItem>)>> {
        let html = self.get(&format!("{BASE}/popular-repacks/"), "text/html").await?.text().await?;
        let sections = parse::parse_popular(&html);
        if sections.is_empty() {
            return Err(site_error(reqwest::StatusCode::OK, &html));
        }
        Ok(sections)
    }
}

pub fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 200 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
