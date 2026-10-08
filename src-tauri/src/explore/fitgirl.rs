//! Cliente de fitgirl-repacks.site: la API REST de WordPress (búsqueda y fichas
//! completas en JSON) y la página de populares. La web está detrás de
//! DDoS-Guard: UA de navegador, cookies y un ritmo tranquilo.
//!
//! Si la web no responde directa (lo normal: el proveedor de internet la
//! bloquea), se pide al relay de ejGames (`relay/worker.js`), que la reenvía
//! desde Cloudflare. La vía que funcionó se recuerda hasta cerrar la app.

use super::parse::{self, PopularItem};
use crate::metadata::ratelimit::RateLimiter;
use serde::Deserialize;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;
use tokio::task::JoinHandle;

pub const ID: &str = "fitgirl";
const HOST: &str = "fitgirl-repacks.site";
const BASE: &str = "https://fitgirl-repacks.site";
/// URL del relay (el Worker de `relay/`) y la clave con que se firman las
/// peticiones. Vienen de `relay/.dev.vars`, fuera de git (ver build.rs): sin
/// ellos no hay relay.
const RELAY_URL: Option<&str> = option_env!("EJG_RELAY_URL");
const RELAY_KEY: Option<&str> = option_env!("EJG_RELAY_KEY");
/// Categoría «Lossless Repack» (deja fuera los resúmenes de actualizaciones).
const CATEGORY: u32 = 5;
const FIELDS: &str = "id,slug,link,date,title,content,tags";
/// Etiqueta «Adult» de la web (fuera del catálogo si se ocultan los de adultos).
pub const ADULT_TAG: u32 = 141;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

#[derive(Debug, Clone)]
pub struct RawPost {
    pub id: i64,
    pub slug: String,
    pub link: String,
    pub date: String,
    pub title: String,
    pub content: String,
    /// Etiquetas de la web (géneros, perspectiva…).
    pub tags: Vec<u32>,
}

#[derive(Deserialize)]
struct WpPost {
    id: i64,
    slug: String,
    link: String,
    date: String,
    title: WpText,
    content: WpText,
    #[serde(default)]
    tags: Vec<u32>,
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
            tags: p.tags,
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
    /// La última vez solo se llegó por el relay: se prueba primero.
    via_relay: AtomicBool,
    /// Segundos que hay que sumar al reloj del PC para que el relay acepte la
    /// firma (si va mal, lo dice el relay).
    relay_skew: AtomicI64,
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
            via_relay: AtomicBool::new(false),
            relay_skew: AtomicI64::new(0),
        }
    }
}

/// Mensaje claro cuando la web no responde como debe.
fn site_error(status: reqwest::StatusCode, body: &str) -> anyhow::Error {
    if body.contains("ddos-guard") || body.contains("DDoS-Guard") || status.as_u16() == 403 {
        anyhow::anyhow!(crate::i18n::t("La web de FitGirl está comprobando las visitas (protección anti-DDoS). Prueba dentro de unos minutos."))
    } else if status.is_success() {
        let head: String = body.chars().take(200).collect();
        tracing::warn!("fitgirl: respuesta inesperada: {head:?}");
        anyhow::anyhow!(crate::i18n::t("La web de FitGirl respondió con una página inesperada. Prueba dentro de un rato."))
    } else {
        anyhow::anyhow!(crate::i18n::tf("La web de FitGirl respondió con un error ({0}).", &[&status]))
    }
}

/// Mensaje claro cuando no se llega a la web. El de reqwest («error sending
/// request for url …») esconde la causa en la cadena de `source()`: va al log.
/// `dns`: la consulta ya lanzada en paralelo con el reintento, si la hay.
async fn net_error(e: &reqwest::Error, dns: Option<JoinHandle<Dns>>) -> anyhow::Error {
    let detail = chain(e);
    tracing::warn!("fitgirl: {detail}");
    let low = detail.to_lowercase();
    let msg = if e.is_body() || e.is_decode() {
        crate::i18n::t("La conexión con la web de FitGirl se cortó a mitad. Prueba otra vez.")
    } else if low.contains("not valid for name") || low.contains("notvalidforname") {
        // Contesta otro servidor en su lugar: el DNS la manda a una página de bloqueo.
        crate::i18n::t("Tu red no te deja entrar en la web de FitGirl (lo normal es que tu proveedor de internet la bloquee), así que la tienda no puede cargar.")
    } else if low.contains("unknownissuer") {
        crate::i18n::t("Un antivirus o un proxy está interceptando la conexión segura con la web de FitGirl y la app no se fía de él.")
    } else {
        let dns = match dns {
            Some(task) => task.await.unwrap_or(Dns::Unknown),
            None => lookup().await,
        };
        match dns {
            Dns::Sinkhole => crate::i18n::t("Tu red no te deja entrar en la web de FitGirl (lo normal es que tu proveedor de internet la bloquee), así que la tienda no puede cargar."),
            Dns::Missing if resolves("store.steampowered.com").await => {
                crate::i18n::t("Tu red no encuentra la web de FitGirl: o tu proveedor de internet la bloquea o la web está caída.")
            }
            Dns::Missing => crate::i18n::t("Parece que no hay conexión a internet."),
            _ if e.is_timeout() => crate::i18n::t("La web de FitGirl no responde a tiempo. Prueba dentro de un rato."),
            // WSAECONNRESET / WSAECONNABORTED (el texto de Windows va traducido).
            _ if low.contains("os error 10054") || low.contains("os error 10053") => {
                crate::i18n::t("La conexión con la web de FitGirl se corta nada más empezar: puede que tu red la bloquee.")
            }
            _ => return anyhow::anyhow!("{}", crate::i18n::tf("No se pudo conectar con la web de FitGirl ({0}).", &[&root_cause(e)])),
        }
    };
    anyhow::anyhow!(msg)
}

/// Lo que falló por la vía directa, aún sin explicar: el diagnóstico de red
/// puede tardar y no hace falta si el relay llega.
enum Failed {
    Site(anyhow::Error),
    Net(reqwest::Error, Option<JoinHandle<Dns>>),
}

impl Failed {
    async fn explain(self) -> anyhow::Error {
        match self {
            Failed::Site(e) => e,
            Failed::Net(e, dns) => net_error(&e, dns).await,
        }
    }
}

/// (URL sin barra final, clave).
pub(crate) fn relay() -> Option<(&'static str, &'static str)> {
    let url = RELAY_URL?.trim_end_matches('/');
    let key = RELAY_KEY?;
    (!url.is_empty() && !key.is_empty()).then_some((url, key))
}

/// Firma de una petición al relay: HMAC-SHA256 en hex de «hora\nruta?consulta».
pub(crate) fn relay_signature(key: &str, time: i64, path_and_query: &str) -> String {
    use hmac::Mac;
    let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(key.as_bytes()).expect("HMAC admite claves de cualquier largo");
    mac.update(format!("{time}\n{path_and_query}").as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
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

    /// GET de una ruta de la web (`/wp-json/…`): directa o por el relay,
    /// empezando por la que funcionó la última vez.
    async fn get(&self, path: &str, accept: &str) -> anyhow::Result<reqwest::Response> {
        let Some(relay) = relay() else {
            return match self.direct(path, accept, true).await {
                Ok(r) => Ok(r),
                Err(f) => Err(f.explain().await),
            };
        };
        if self.via_relay.load(Ordering::Relaxed) {
            let relay_err = match self.relayed(relay, path, accept).await {
                Ok(r) => return Ok(r),
                Err(e) => e,
            };
            match self.direct(path, accept, true).await {
                Ok(r) => {
                    self.via_relay.store(false, Ordering::Relaxed);
                    Ok(r)
                }
                Err(f) => Err(anyhow::anyhow!("{} {relay_err}", f.explain().await)),
            }
        } else {
            // Sin reintento: el relay ya es el segundo intento.
            let failed = match self.direct(path, accept, false).await {
                Ok(r) => return Ok(r),
                Err(f) => f,
            };
            match self.relayed(relay, path, accept).await {
                Ok(r) => {
                    tracing::info!("fitgirl: la web no responde directa; la tienda va por el relay");
                    self.via_relay.store(true, Ordering::Relaxed);
                    Ok(r)
                }
                Err(relay_err) => Err(anyhow::anyhow!("{} {relay_err}", failed.explain().await)),
            }
        }
    }

    /// GET directo con turno y, si `retry`, un reintento rápido (quien espera
    /// es el usuario, no una cola).
    async fn direct(&self, path: &str, accept: &str, retry: bool) -> Result<reqwest::Response, Failed> {
        let url = format!("{BASE}{path}");
        let mut last = None;
        let mut dns = None;
        for attempt in 0..if retry { 2 } else { 1 } {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(1500)).await;
            }
            self.limiter.acquire().await;
            match self.http.get(&url).header("Accept", accept).send().await {
                Ok(r) if r.status().is_server_error() || r.status().as_u16() == 429 => last = Some(Ok(r)),
                Ok(r) => return self.check(r).await.map_err(Failed::Site),
                Err(e) if e.is_timeout() || e.is_connect() => {
                    // Por si vuelve a fallar: el diagnóstico va a la par que el reintento.
                    dns.get_or_insert_with(|| tokio::spawn(lookup()));
                    last = Some(Err(e));
                }
                Err(e) => return Err(Failed::Net(e, None)),
            }
        }
        match last {
            Some(Ok(r)) => self.check(r).await.map_err(Failed::Site),
            Some(Err(e)) => Err(Failed::Net(e, dns)),
            None => unreachable!(),
        }
    }

    /// GET firmado por el relay: un intento, más otro si el relay dice que el
    /// reloj del PC va mal. El error completa el de la vía directa.
    async fn relayed(&self, (base, key): (&str, &str), path: &str, accept: &str) -> anyhow::Result<reqwest::Response> {
        let url = reqwest::Url::parse(&format!("{base}{path}"))?;
        // Lo que firma, tal cual lo verá el Worker (`pathname + search`).
        let signed = &url[url::Position::BeforePath..];
        let mut clock_fixed = false;
        let why = loop {
            self.limiter.acquire().await;
            let time = unix_now() + self.relay_skew.load(Ordering::Relaxed);
            let req = self
                .http
                .get(url.clone())
                .header("Accept", accept)
                .header("X-Ejg-Time", time)
                .header("X-Ejg-Sig", relay_signature(key, time, signed));
            match req.send().await {
                Ok(r) if r.status().is_success() => return Ok(r),
                Ok(r) => {
                    let relay_now = r.headers().get("X-Ejg-Now").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<i64>().ok());
                    match relay_now {
                        Some(now) if r.status().as_u16() == 401 && !clock_fixed && (now - time).abs() > 60 => {
                            tracing::info!("fitgirl (relay): el reloj del PC va {} s desfasado; se corrige", time - now);
                            self.relay_skew.store(now - unix_now(), Ordering::Relaxed);
                            clock_fixed = true;
                        }
                        _ => {
                            tracing::warn!("fitgirl (relay): {}", r.status());
                            break format!("error {}", r.status().as_u16());
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("fitgirl (relay): {}", chain(&e));
                    break if e.is_timeout() { "no responde a tiempo".into() } else { root_cause(&e) };
                }
            }
        };
        Err(anyhow::anyhow!(crate::i18n::tf("Tampoco se pudo por el servidor de respaldo de ejGames ({0}).", &[&why])))
    }

    async fn check(&self, r: reqwest::Response) -> anyhow::Result<reqwest::Response> {
        if !r.status().is_success() {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            return Err(site_error(status, &body));
        }
        Ok(r)
    }

    async fn posts(&self, path: &str) -> anyhow::Result<Page> {
        let r = self.get(path, "application/json").await?;
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
            "/wp-json/wp/v2/posts?search={q}&search_columns=post_title&categories={CATEGORY}&per_page={per_page}&page={page}&_fields={FIELDS}"
        ))
        .await
    }

    /// Catálogo con filtros: texto en el título, etiquetas (todas a la vez),
    /// etiquetas fuera y orden ("date" | "modified" | "title").
    pub async fn browse(&self, q: &Query<'_>, page: u32, per_page: u32) -> anyhow::Result<Page> {
        let mut path = format!("/wp-json/wp/v2/posts?categories={CATEGORY}&per_page={per_page}&page={page}&_fields={FIELDS}");
        if !q.text.is_empty() {
            let t = percent_encoding::utf8_percent_encode(q.text, percent_encoding::NON_ALPHANUMERIC);
            path.push_str(&format!("&search={t}&search_columns=post_title"));
        }
        if !q.tags.is_empty() {
            let list = q.tags.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(",");
            // Con `operator=AND` salen los que tienen todas (sin él, cualquiera).
            path.push_str(&format!("&tags%5Bterms%5D={list}&tags%5Boperator%5D=AND"));
        }
        if !q.exclude.is_empty() {
            let list = q.exclude.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(",");
            path.push_str(&format!("&tags_exclude={list}"));
        }
        match q.sort {
            "title" => path.push_str("&orderby=title&order=asc"),
            "modified" => path.push_str("&orderby=modified&order=desc"),
            _ => {}
        }
        self.posts(&path).await
    }

    /// Últimos repacks publicados.
    pub async fn latest(&self, page: u32, per_page: u32) -> anyhow::Result<Page> {
        self.posts(&format!("/wp-json/wp/v2/posts?categories={CATEGORY}&per_page={per_page}&page={page}&_fields={FIELDS}"))
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
                .posts(&format!("/wp-json/wp/v2/posts?slug={list}&per_page=100&_fields={FIELDS}"))
                .await?;
            out.extend(page.posts);
        }
        out.sort_by_key(|p| slugs.iter().position(|s| *s == p.slug).unwrap_or(usize::MAX));
        Ok(out)
    }

    /// Listas de populares (mes y semana).
    pub async fn popular(&self) -> anyhow::Result<Vec<(String, Vec<PopularItem>)>> {
        let html = match self.get("/popular-repacks/", "text/html").await?.text().await {
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

/// Filtros del catálogo que entiende la web.
pub struct Query<'a> {
    pub text: &'a str,
    pub tags: &'a [u32],
    pub exclude: &'a [u32],
    pub sort: &'a str,
}

pub fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 200 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La misma que calcula el Worker (hecha con el crypto de Node).
    #[test]
    fn relay_signature_matches_the_worker() {
        let url = reqwest::Url::parse("https://relay.example/wp-json/wp/v2/posts?slug=a,b&_fields=id,slug").unwrap();
        assert_eq!(
            relay_signature("clave-de-prueba", 1_790_000_000, &url[url::Position::BeforePath..]),
            "1222ffbd68f67b302beaf5b050a306cfbeaacd4bfde2ed401e19d077990b716c"
        );
    }

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
