//! Cliente de fitgirl-repacks.site: la API REST de WordPress (búsqueda y fichas
//! completas en JSON) y la página de populares. La web está detrás de
//! DDoS-Guard: UA de navegador, cookies y un ritmo tranquilo.

use super::parse::{self, PopularItem};
use crate::metadata::ratelimit::RateLimiter;
use serde::Deserialize;
use std::net::IpAddr;
use std::time::Duration;
use tokio::task::JoinHandle;

pub const ID: &str = "fitgirl";
const HOST: &str = "fitgirl-repacks.site";
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
    } else if status.is_success() {
        let head: String = body.chars().take(200).collect();
        tracing::warn!("fitgirl: respuesta inesperada: {head:?}");
        anyhow::anyhow!("La web de FitGirl respondió con una página inesperada. Prueba dentro de un rato.")
    } else {
        anyhow::anyhow!("La web de FitGirl respondió con un error ({status}).")
    }
}

const BLOCKED: &str = "Tu red no te deja entrar en la web de FitGirl (lo normal es que tu proveedor de internet la bloquee), así que la tienda no puede cargar.";

/// Mensaje claro cuando no se llega a la web. El de reqwest («error sending
/// request for url …») esconde la causa en la cadena de `source()`: va al log.
/// `dns`: la consulta ya lanzada en paralelo con el reintento, si la hay.
async fn net_error(e: &reqwest::Error, dns: Option<JoinHandle<Dns>>) -> anyhow::Error {
    let detail = chain(e);
    tracing::warn!("fitgirl: {detail}");
    let low = detail.to_lowercase();
    let msg = if e.is_body() || e.is_decode() {
        "La conexión con la web de FitGirl se cortó a mitad. Prueba otra vez."
    } else if low.contains("not valid for name") || low.contains("notvalidforname") {
        // Contesta otro servidor en su lugar: el DNS la manda a una página de bloqueo.
        BLOCKED
    } else if low.contains("unknownissuer") {
        "Un antivirus o un proxy está interceptando la conexión segura con la web de FitGirl y la app no se fía de él."
    } else {
        let dns = match dns {
            Some(task) => task.await.unwrap_or(Dns::Unknown),
            None => lookup().await,
        };
        match dns {
            Dns::Sinkhole => BLOCKED,
            Dns::Missing if resolves("store.steampowered.com").await => {
                "Tu red no encuentra la web de FitGirl: o tu proveedor de internet la bloquea o la web está caída."
            }
            Dns::Missing => "Parece que no hay conexión a internet.",
            _ if e.is_timeout() => "La web de FitGirl no responde a tiempo. Prueba dentro de un rato.",
            // WSAECONNRESET / WSAECONNABORTED (el texto de Windows va traducido).
            _ if low.contains("os error 10054") || low.contains("os error 10053") => {
                "La conexión con la web de FitGirl se corta nada más empezar: puede que tu red la bloquee."
            }
            _ => return anyhow::anyhow!("No se pudo conectar con la web de FitGirl ({}).", root_cause(e)),
        }
    };
    anyhow::anyhow!(msg)
}

/// Todos los mensajes de la cadena de un error, sin repetir.
fn chain(e: &(dyn std::error::Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        let text = s.to_string();
        if !out.contains(&text) {
            out.push_str(": ");
            out.push_str(&text);
        }
        cur = s.source();
    }
    out
}

fn root_cause(e: &(dyn std::error::Error + 'static)) -> String {
    let mut cur = e;
    while let Some(s) = cur.source() {
        cur = s;
    }
    cur.to_string()
}

/// Lo que dice el DNS del sistema de la web.
#[derive(Clone, Copy)]
enum Dns {
    Public,
    /// No existe (bloqueo o web caída).
    Missing,
    /// Da una dirección que no es de internet (0.0.0.0, 127.x, red local): otra
    /// forma habitual de bloquear una web.
    Sinkhole,
    Unknown,
}

/// Un nombre que no existe puede tardar más de 10 s en fallar en Windows.
const DNS_WAIT: Duration = Duration::from_secs(15);

async fn lookup() -> Dns {
    match tokio::time::timeout(DNS_WAIT, tokio::net::lookup_host((HOST, 443))).await {
        Err(_) => Dns::Unknown,
        Ok(Err(_)) => Dns::Missing,
        Ok(Ok(addrs)) => {
            let ips: Vec<IpAddr> = addrs.map(|a| a.ip()).collect();
            if !ips.is_empty() && ips.iter().all(|ip| !is_public(*ip)) {
                Dns::Sinkhole
            } else {
                Dns::Public
            }
        }
    }
}

async fn resolves(host: &str) -> bool {
    match tokio::time::timeout(DNS_WAIT, tokio::net::lookup_host((host, 443))).await {
        Ok(Ok(mut a)) => a.next().is_some(),
        _ => false,
    }
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => !(v.is_unspecified() || v.is_loopback() || v.is_private() || v.is_link_local() || v.is_broadcast()),
        IpAddr::V6(v) => {
            let first = v.segments()[0];
            !(v.is_unspecified() || v.is_loopback() || first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80)
        }
    }
}

impl FitGirl {
    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// GET con turno y un reintento rápido (quien espera es el usuario, no una cola).
    async fn get(&self, url: &str, accept: &str) -> anyhow::Result<reqwest::Response> {
        let mut last = None;
        let mut dns = None;
        for attempt in 0..2 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(1500)).await;
            }
            self.limiter.acquire().await;
            match self.http.get(url).header("Accept", accept).send().await {
                Ok(r) if r.status().is_server_error() || r.status().as_u16() == 429 => last = Some(Ok(r)),
                Ok(r) => return self.check(r).await,
                Err(e) if e.is_timeout() || e.is_connect() => {
                    // Por si vuelve a fallar: el diagnóstico va a la par que el reintento.
                    dns.get_or_insert_with(|| tokio::spawn(lookup()));
                    last = Some(Err(e));
                }
                Err(e) => return Err(net_error(&e, None).await),
            }
        }
        match last {
            Some(Ok(r)) => self.check(r).await,
            Some(Err(e)) => Err(net_error(&e, dns).await),
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
        let body = match r.text().await {
            Ok(b) => b,
            Err(e) => return Err(net_error(&e, None).await),
        };
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
        let html = match self.get(&format!("{BASE}/popular-repacks/"), "text/html").await?.text().await {
            Ok(h) => h,
            Err(e) => return Err(net_error(&e, None).await),
        };
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sinkhole_addresses() {
        for ip in ["0.0.0.0", "127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.0.1", "::", "::1", "fd00::1", "fe80::1"] {
            assert!(!is_public(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["190.115.31.179", "8.8.8.8", "2606:4700::1"] {
            assert!(is_public(ip.parse().unwrap()), "{ip}");
        }
    }
}
