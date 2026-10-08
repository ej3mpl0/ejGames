//! Adapter genérico: pide las páginas de una fuente (directo o por el relay, con su
//! límite por minuto y caché) y saca las entradas con los selectores CSS de la
//! fuente (`scrape`) o con las rutas de sus campos JSON (`api`).

use super::config::{CatalogSource, Selectors};
use super::platforms;
use super::{CatalogDetail, CatalogEntry, DownloadLink};
use parking_lot::Mutex;
use scraper::{ElementRef, Html, Selector};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant, SystemTime};

// ───────────────────────── red ─────────────────────────

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(40))
        .connect_timeout(Duration::from_secs(15))
        .cookie_store(true)
        .user_agent(format!("ejGames/{} (+https://github.com/ej3mpl0/ejGames)", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("cliente http")
});

/// Siguiente hueco de cada fuente (límite por minuto independiente).
static NEXT_SLOT: LazyLock<tokio::sync::Mutex<HashMap<String, Instant>>> = LazyLock::new(Default::default);

async fn wait_turn(src: &CatalogSource) {
    let gap = Duration::from_millis(60_000 / src.rate_limit_per_minute.max(1) as u64);
    let wait = {
        let mut m = NEXT_SLOT.lock().await;
        let now = Instant::now();
        let slot = m.get(&src.id).copied().filter(|t| *t > now).unwrap_or(now);
        m.insert(src.id.clone(), slot + gap);
        slot.saturating_duration_since(now)
    };
    if !wait.is_zero() {
        tokio::time::sleep(wait).await;
    }
}

fn cache_file(root: &std::path::Path, url: &str) -> PathBuf {
    root.join("cache").join("catalogs").join(format!("{}.txt", &blake3::hash(url.as_bytes()).to_hex()[..32]))
}

fn fresh(p: &std::path::Path, minutes: u32) -> bool {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < Duration::from_secs(minutes as u64 * 60))
}

/// ¿Se puede pedir esta URL a nombre de la fuente? Solo su sitio (y sus subdominios).
pub fn same_site(src: &CatalogSource, url: &str) -> bool {
    let (Ok(a), Ok(b)) = (url::Url::parse(&src.base_url), url::Url::parse(url)) else { return false };
    let (Some(ha), Some(hb)) = (a.host_str(), b.host_str()) else { return false };
    let base = ha.trim_start_matches("www.").to_ascii_lowercase();
    let h = hb.to_ascii_lowercase();
    matches!(b.scheme(), "http" | "https") && (h == base || h.ends_with(&format!(".{base}")))
}

async fn direct(src: &CatalogSource, url: &str) -> anyhow::Result<String> {
    let mut req = CLIENT.get(url);
    for (k, v) in &src.headers {
        req = req.header(k.as_str(), v.as_str());
    }
    let r = req.send().await?;
    let status = r.status();
    if !status.is_success() {
        anyhow::bail!("HTTP {status}");
    }
    not_a_bot_wall(r.text().await?)
}

/// Las webs con comprobación anti-bots (Anubis, Cloudflare) contestan 200 con esa
/// página en vez del catálogo: es un error (y no se guarda en la caché).
fn not_a_bot_wall(body: String) -> anyhow::Result<String> {
    let head = body.get(..4096).unwrap_or(&body);
    if ["Making sure you&#39;re not a bot", "/.within.website/", "<title>Just a moment...</title>", "cf-chl-"].iter().any(|m| head.contains(m)) {
        anyhow::bail!("{}", crate::i18n::t("La web pide una comprobación anti-bots que la app no puede pasar"));
    }
    Ok(body)
}

/// Por el relay de ejGames (`/catalog/<fuente>/<ruta>`): solo reenvía las fuentes que
/// su dueño haya dado de alta en el Worker, con la misma firma que el resto.
async fn relayed(src: &CatalogSource, url: &str) -> anyhow::Result<String> {
    use crate::explore::fitgirl::{relay, relay_signature, unix_now};
    let (base, key) = relay().ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("sin relay")))?;
    let rest = url.strip_prefix(&src.base_url).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::tf("el relay solo admite rutas de {0}", &[&src.base_url])))?;
    let rest = if rest.starts_with('/') || rest.is_empty() { rest.to_string() } else { format!("/{rest}") };
    let full = reqwest::Url::parse(&format!("{base}/catalog/{}{rest}", src.id))?;
    let signed = full[url::Position::BeforePath..].to_string();
    let mut time = unix_now();
    for _ in 0..2 {
        let r = CLIENT.get(full.clone()).header("X-Ejg-Time", time.to_string()).header("X-Ejg-Sig", relay_signature(key, time, &signed)).send().await?;
        if r.status() == reqwest::StatusCode::UNAUTHORIZED {
            if let Some(now) = r.headers().get("X-Ejg-Now").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<i64>().ok()) {
                time = now;
                continue;
            }
        }
        if r.status() == reqwest::StatusCode::NOT_FOUND {
            // El 404 del propio relay es texto («relay: …», o «Not Found» en los de antes
            // de la 1.3.2); cualquier otro viene de la web: esa dirección no existe.
            let body = r.text().await.unwrap_or_default();
            if body.starts_with("relay:") || body.trim() == "Not Found" {
                anyhow::bail!("{}", crate::i18n::tf("el relay no tiene dada de alta la fuente «{0}»", &[&src.id]));
            }
            anyhow::bail!("HTTP 404 Not Found");
        }
        return not_a_bot_wall(r.error_for_status()?.text().await?);
    }
    anyhow::bail!("{}", crate::i18n::t("el relay no acepta la firma"))
}

/// Una página de la fuente: de la caché si es reciente; si no, de la red (con su turno);
/// sin red, la última guardada aunque sea vieja.
pub async fn fetch(root: &std::path::Path, src: &CatalogSource, url: &str, force: bool) -> anyhow::Result<String> {
    if !same_site(src, url) {
        anyhow::bail!("{} {url}", crate::i18n::t("La dirección no es de la fuente:"));
    }
    let file = cache_file(root, url);
    if !force && fresh(&file, src.cache_minutes.max(1)) {
        if let Ok(t) = std::fs::read_to_string(&file) {
            return Ok(t);
        }
    }
    wait_turn(src).await;
    let got = match src.relay.as_str() {
        "always" => relayed(src, url).await,
        "never" => direct(src, url).await,
        _ => match direct(src, url).await {
            Ok(t) => Ok(t),
            Err(e) => {
                tracing::info!("catálogo {}: directo no ({e:#}); se prueba el relay", src.id);
                relayed(src, url).await.map_err(|r| anyhow::anyhow!("{e:#} · relay: {r:#}"))
            }
        },
    };
    match got {
        Ok(t) => {
            if let Some(d) = file.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = std::fs::write(&file, &t);
            Ok(t)
        }
        Err(e) => match std::fs::read_to_string(&file) {
            Ok(old) => {
                tracing::warn!("catálogo {}: {e:#} (se usa la copia guardada)", src.id);
                Ok(old)
            }
            Err(_) => Err(e),
        },
    }
}

// ───────────────────────── direcciones ─────────────────────────

fn enc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

/// El tramo de URL de una plataforma: el de `platformPaths`; si no, la clave del mapa
/// de la fuente que lleva a ella; si no, su id.
pub fn platform_path(src: &CatalogSource, platform: &str) -> String {
    if let Some(p) = src.platform_paths.get(platform) {
        return p.clone();
    }
    let mut keys: Vec<&String> = src.platform_mapping.iter().filter(|(_, v)| platforms::external(v) == Some(platform)).map(|(k, _)| k).collect();
    keys.sort();
    keys.first().map(|k| enc(k)).unwrap_or_else(|| platform.to_string())
}

/// Rellena una plantilla y la hace absoluta.
pub fn expand(src: &CatalogSource, template: &str, query: &str, page: usize, platform: Option<&str>, id: &str) -> String {
    let p = platform.unwrap_or("");
    let t = template
        .replace("{query}", &enc(query))
        .replace("{page}", &page.to_string())
        .replace("{page0}", &page.saturating_sub(1).to_string())
        .replace("{platformPath}", &if p.is_empty() { String::new() } else { platform_path(src, p) })
        .replace("{platform}", p)
        .replace("{id}", id.trim_start_matches('/'));
    absolute(&src.base_url, &t)
}

pub fn absolute(base: &str, href: &str) -> String {
    let href = href.trim();
    if href.starts_with("http://") || href.starts_with("https://") || href.starts_with("magnet:") {
        return href.to_string();
    }
    match url::Url::parse(&format!("{}/", base.trim_end_matches('/'))).and_then(|b| b.join(href)) {
        Ok(u) => u.to_string(),
        Err(_) => format!("{}/{}", base.trim_end_matches('/'), href.trim_start_matches('/')),
    }
}

/// Id de una ficha: su ruta dentro de la web (o la URL entera si es de un subdominio).
pub fn id_for(src: &CatalogSource, url: &str) -> String {
    url.strip_prefix(&src.base_url).filter(|r| r.starts_with('/')).map(str::to_string).unwrap_or_else(|| url.to_string())
}

/// URL de una ficha a partir de su id.
pub fn detail_url(src: &CatalogSource, id: &str) -> String {
    if let Some(t) = src.endpoints.detail.as_deref().filter(|t| !t.trim().is_empty()) {
        // Con plantilla: el id es lo que va en `{id}` (o, si es una ruta, la ruta).
        if id.starts_with('/') || id.starts_with("http") {
            return absolute(&src.base_url, id);
        }
        return expand(src, t, "", 1, None, id);
    }
    absolute(&src.base_url, id)
}

// ───────────────────────── selectores ─────────────────────────

/// «img.cover@src, .x img@data-src» → [(selector, atributo)]. Sin selector («@href»)
/// es el propio elemento.
pub fn parse_spec(spec: &str) -> Vec<(Option<Selector>, Option<String>)> {
    let mut parts = vec![];
    let (mut depth, mut quote, mut cur) = (0i32, None::<char>, String::new());
    for c in spec.chars() {
        match (c, quote) {
            ('"' | '\'', None) => quote = Some(c),
            (q, Some(open)) if q == open => quote = None,
            ('[' | '(', None) => depth += 1,
            (']' | ')', None) => depth -= 1,
            (',', None) if depth == 0 => {
                parts.push(std::mem::take(&mut cur));
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    parts.push(cur);
    parts
        .into_iter()
        .filter_map(|p| {
            let p = p.trim();
            if p.is_empty() {
                return None;
            }
            // El @ del atributo va al final, fuera de corchetes.
            let (sel, attr) = match p.rfind('@').filter(|i| !p[*i..].contains(']')) {
                Some(i) => (p[..i].trim(), Some(p[i + 1..].trim().to_string()).filter(|a| !a.is_empty())),
                None => (p, None),
            };
            if sel.is_empty() {
                return Some((None, attr));
            }
            Selector::parse(sel).ok().map(|s| (Some(s), attr))
        })
        .collect()
}

fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn value_of(el: ElementRef, attr: Option<&str>) -> Option<String> {
    let v = match attr {
        Some(a) => {
            let v = el.value().attr(a).map(str::to_string);
            // Imágenes perezosas: la URL buena suele ir en data-src.
            if a == "src" && v.as_deref().is_none_or(|x| x.trim().is_empty() || x.starts_with("data:")) {
                ["data-src", "data-lazy-src", "data-original"].iter().find_map(|k| el.value().attr(k).map(str::to_string)).or(v)
            } else {
                v
            }
        }
        None => Some(clean(&el.text().collect::<String>())),
    };
    v.map(|x| x.trim().to_string()).filter(|x| !x.is_empty())
}

/// El primer valor que encuentre algún selector de la lista.
fn first(scope: ElementRef, spec: Option<&str>) -> Option<String> {
    let spec = spec?;
    for (sel, attr) in parse_spec(spec) {
        let hit = match &sel {
            None => Some(scope),
            Some(sel) => scope.select(sel).next(),
        };
        if let Some(v) = hit.and_then(|el| value_of(el, attr.as_deref())) {
            return Some(v);
        }
    }
    None
}

/// Todos los valores (en orden y sin repetir) con su texto.
fn all(scope: ElementRef, spec: Option<&str>) -> Vec<(String, String)> {
    let Some(spec) = spec else { return vec![] };
    let mut out: Vec<(String, String)> = vec![];
    for (sel, attr) in parse_spec(spec) {
        let hits: Vec<ElementRef> = match &sel {
            None => vec![scope],
            Some(sel) => scope.select(sel).collect(),
        };
        for el in hits {
            if let Some(v) = value_of(el, attr.as_deref()) {
                if !out.iter().any(|(x, _)| *x == v) {
                    out.push((v, label_of(el)));
                }
            }
        }
    }
    out
}

/// El texto de un enlace; si solo dice «Download» o similar, el resto de su párrafo
/// («<strong>1Fichier</strong><br><a>Download</a>» → «1Fichier»).
fn label_of(el: ElementRef) -> String {
    let own = clean(&el.text().collect::<String>());
    let bare: String = own.chars().filter(|c| c.is_alphanumeric() || *c == ' ').collect::<String>().trim().to_lowercase();
    if !["", "download", "descargar", "link", "enlace", "here", "aquí", "click here"].contains(&bare.as_str()) {
        return own;
    }
    el.parent()
        .and_then(ElementRef::wrap)
        .map(|p| clean(&p.text().collect::<String>()).replacen(&own, "", 1).trim().to_string())
        .filter(|t| !t.is_empty() && t.chars().count() <= 80)
        .unwrap_or(own)
}

// ───────────────────────── deducciones ─────────────────────────

/// game | dlc | update | homebrew | emulator, por una etiqueta o por el título.
pub fn category_of(label: Option<&str>, title: &str) -> String {
    let t = format!(" {} ", label.unwrap_or(title).to_lowercase().replace(['[', ']', '(', ')', '_', '-'], " "));
    let has = |w: &[&str]| w.iter().any(|x| t.contains(&format!(" {x} ")));
    if has(&["dlc", "dlcs", "add on", "addon", "season pass", "expansion"]) {
        "dlc"
    } else if has(&["update", "updates", "upd", "patch", "actualización", "actualizacion"]) {
        "update"
    } else if has(&["homebrew"]) {
        "homebrew"
    } else if has(&["emulator", "emulador", "emulators"]) {
        "emulator"
    } else if label.is_some() && !title.is_empty() {
        // La etiqueta no dice nada: se mira el título.
        return category_of(None, title);
    } else {
        "game"
    }
    .to_string()
}

const REGIONS: &[(&str, &str)] = &[
    ("usa", "USA"),
    ("us", "USA"),
    ("ntsc u", "USA"),
    ("america", "USA"),
    ("europe", "Europe"),
    ("eur", "Europe"),
    ("eu", "Europe"),
    ("pal", "Europe"),
    ("japan", "Japan"),
    ("jpn", "Japan"),
    ("jp", "Japan"),
    ("ntsc j", "Japan"),
    ("world", "World"),
    ("spain", "Spain"),
    ("españa", "Spain"),
    ("esp", "Spain"),
    ("france", "France"),
    ("germany", "Germany"),
    ("italy", "Italy"),
    ("korea", "Korea"),
    ("asia", "Asia"),
    ("australia", "Australia"),
    ("brazil", "Brazil"),
    ("china", "China"),
];

const LANGS: &[&str] = &["en", "es", "fr", "de", "it", "pt", "nl", "sv", "no", "da", "fi", "ru", "pl", "ja", "ko", "zh", "ca", "eu", "gl"];

/// Región y lenguas de las etiquetas del título al estilo No-Intro/Redump:
/// «Juego (USA, Europe) (En,Fr,De)», «[EUR]», «(PAL)».
pub fn tags_of(title: &str) -> (Option<String>, Option<String>) {
    let mut regions: Vec<&str> = vec![];
    let mut langs: Vec<String> = vec![];
    let mut cur = String::new();
    let mut inside = false;
    let mut groups = vec![];
    for c in title.chars() {
        match c {
            '(' | '[' => {
                inside = true;
                cur.clear();
            }
            ')' | ']' if inside => {
                inside = false;
                groups.push(std::mem::take(&mut cur));
            }
            _ if inside => cur.push(c),
            _ => {}
        }
    }
    for g in groups {
        let parts: Vec<String> = g.split([',', '+', '/']).map(|p| p.trim().to_lowercase().replace('-', " ")).filter(|p| !p.is_empty()).collect();
        if !parts.is_empty() && parts.iter().all(|p| LANGS.contains(&p.as_str())) && parts.iter().any(|p| p != "us" && p != "eu") {
            for p in parts {
                let l = p.to_string();
                if !langs.contains(&l) {
                    langs.push(l);
                }
            }
            continue;
        }
        for p in &parts {
            if let Some((_, r)) = REGIONS.iter().find(|(k, _)| k == p) {
                if !regions.contains(r) {
                    regions.push(r);
                }
            }
        }
    }
    let region = (!regions.is_empty()).then(|| regions.join(", "));
    let lang = (!langs.is_empty()).then(|| langs.iter().map(|l| l.to_uppercase()).collect::<Vec<_>>().join(", "));
    (region, lang)
}

/// «1,5 GB», «700 MB», «12.4 GiB» → bytes.
pub fn size_bytes(s: &str) -> Option<u64> {
    let lower = s.to_lowercase().replace(',', ".");
    let re = regex::Regex::new(r"(\d+(?:\.\d+)?)\s*(t|g|m|k)?i?b\b").ok()?;
    let c = re.captures(&lower)?;
    let n: f64 = c.get(1)?.as_str().parse().ok()?;
    let mul = match c.get(2).map(|m| m.as_str()) {
        Some("t") => 1u64 << 40,
        Some("g") => 1 << 30,
        Some("m") => 1 << 20,
        Some("k") => 1 << 10,
        _ => 1,
    };
    Some((n * mul as f64) as u64)
}

/// La plataforma de una entrada: el texto de su selector, la URL de la ficha, la de la
/// página (si era de una plataforma) o la única de la fuente.
pub fn platform_of(src: &CatalogSource, text: Option<&str>, entry_url: &str, page_platform: Option<&str>) -> Option<String> {
    text.and_then(|t| platforms::detect(t, &src.platform_mapping))
        .or_else(|| platforms::from_url(entry_url, &src.platform_mapping))
        .or(page_platform.and_then(platforms::external))
        .or_else(|| (src.platforms.len() == 1).then(|| platforms::external(&src.platforms[0])).flatten())
        .map(str::to_string)
}

fn proxied_cover(url: Option<String>) -> String {
    url.as_deref().and_then(crate::explore::images::proxy).unwrap_or_default()
}

// ───────────────────────── scrape ─────────────────────────

pub struct ListResult {
    pub entries: Vec<CatalogEntry>,
    pub next: Option<String>,
}

/// Las entradas de una página de lista.
pub fn scrape_list(src: &CatalogSource, html: &str, page_url: &str, page_platform: Option<&str>) -> ListResult {
    let doc = Html::parse_document(html);
    let root = doc.root_element();
    let s: &Selectors = &src.selectors;
    let mut entries = vec![];
    let items = s.game_list.as_deref().map(parse_spec).unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    for (sel, _) in &items {
        let Some(sel) = sel else { continue };
        for el in root.select(sel) {
            let Some(title) = first(el, s.title.as_deref()).or_else(|| first(el, Some("a"))) else { continue };
            let link = first(el, s.detail_link.as_deref()).or_else(|| first(el, Some("a@href"))).map(|h| absolute(page_url, &h));
            let original = link.clone().unwrap_or_else(|| page_url.to_string());
            let id = match &link {
                Some(l) if same_site(src, l) => id_for(src, l),
                _ => format!("#{}", &blake3::hash(format!("{page_url}\n{title}").as_bytes()).to_hex()[..16]),
            };
            if !seen.insert(id.clone()) {
                continue;
            }
            let ptext = first(el, s.platform.as_deref());
            let cover = first(el, s.cover_image.as_deref()).map(|c| absolute(page_url, &c));
            let (tag_region, tag_lang) = tags_of(&title);
            let size = first(el, s.size.as_deref());
            entries.push(CatalogEntry {
                id,
                source_id: src.id.clone(),
                platform: platform_of(src, ptext.as_deref(), &original, page_platform),
                category: category_of(first(el, s.category.as_deref()).as_deref(), &title),
                description: first(el, s.description.as_deref()),
                region: first(el, s.region.as_deref()).or(tag_region),
                language: first(el, s.language.as_deref()).or(tag_lang),
                size_bytes: size.as_deref().and_then(size_bytes),
                size,
                version: first(el, s.version.as_deref()),
                cover_url: proxied_cover(cover.clone()),
                cover_original: cover,
                original_url: original,
                title,
                installed_game_id: None,
                emulator: None,
            });
        }
        if !entries.is_empty() {
            break;
        }
    }
    let next = first(root, s.next_page.as_deref())
        .map(|h| if h.starts_with("http") || h.starts_with('/') || h.starts_with('?') { absolute(page_url, &h) } else { h })
        .filter(|u| u.starts_with("http") && u != page_url);
    ListResult { entries, next }
}

pub fn link_kind(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    let path = lower.split(['?', '#']).next().unwrap_or(&lower);
    if lower.starts_with("magnet:") {
        "magnet"
    } else if path.ends_with(".torrent") {
        "torrent"
    } else if super::pipeline::is_known_file(path) {
        "direct"
    } else {
        "page"
    }
}

fn link(url: String, label: String, size: Option<String>) -> DownloadLink {
    let host = url::Url::parse(&url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
    let kind = link_kind(&url).to_string();
    DownloadLink { url, label, kind, host, size }
}

/// La ficha de un juego.
pub fn scrape_detail(src: &CatalogSource, html: &str, page_url: &str, id: &str) -> CatalogDetail {
    let doc = Html::parse_document(html);
    let root = doc.root_element();
    let s = &src.selectors;
    let title = first(root, s.title.as_deref()).or_else(|| first(root, Some("h1, title"))).unwrap_or_default();
    let ptext = first(root, s.platform.as_deref()).or_else(|| first(root, s.breadcrumbs.as_deref()));
    // En las migas se mira cada tramo, del más concreto al más general.
    let crumb_platform = all(root, s.breadcrumbs.as_deref()).iter().rev().find_map(|(v, _)| platforms::detect(v, &src.platform_mapping)).map(str::to_string);
    let cover = first(root, s.cover_image.as_deref()).map(|c| absolute(page_url, &c));
    let size = first(root, s.size.as_deref());
    let (tag_region, tag_lang) = tags_of(&title);
    // Con descarga firmada, el selector da el id que va en su dirección.
    let signed = src.signed_download.as_ref().map(|d| d.url.trim()).filter(|u| !u.is_empty());
    let links: Vec<DownloadLink> = all(root, s.download_link.as_deref())
        .into_iter()
        .map(|(v, text)| match signed {
            Some(t) => (absolute(&src.base_url, &t.replace("{id}", &enc(&v))), text),
            None => (absolute(page_url, &v), text),
        })
        .filter(|(u, _)| u.starts_with("http://") || u.starts_with("https://") || u.starts_with("magnet:"))
        .map(|(u, text)| {
            let l = link(u, text, None);
            if signed.is_some() { DownloadLink { kind: "direct".into(), ..l } } else { l }
        })
        .collect();
    let screenshots = all(root, s.screenshots.as_deref()).into_iter().filter_map(|(u, _)| crate::explore::images::proxy(&absolute(page_url, &u))).take(12).collect();
    let entry = CatalogEntry {
        id: id.to_string(),
        source_id: src.id.clone(),
        platform: ptext.as_deref().and_then(|t| platforms::detect(t, &src.platform_mapping)).map(str::to_string).or(crumb_platform).or_else(|| platform_of(src, None, page_url, None)),
        category: category_of(first(root, s.category.as_deref()).as_deref(), &title),
        description: first(root, s.description.as_deref()),
        region: first(root, s.region.as_deref()).or(tag_region),
        language: first(root, s.language.as_deref()).or(tag_lang),
        size_bytes: size.as_deref().and_then(size_bytes),
        size,
        version: first(root, s.version.as_deref()),
        cover_url: proxied_cover(cover.clone()),
        cover_original: cover,
        original_url: page_url.to_string(),
        title,
        installed_game_id: None,
        emulator: None,
    };
    CatalogDetail { entry, links, screenshots }
}

// ───────────────────────── api ─────────────────────────

/// Valor en una ruta «a.b.0.c» de un JSON.
pub fn at<'a>(v: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut cur = v;
    for k in path.split('.').filter(|k| !k.is_empty()) {
        cur = match cur {
            serde_json::Value::Array(a) => a.get(k.parse::<usize>().ok()?)?,
            serde_json::Value::Object(o) => o.get(k)?,
            _ => return None,
        };
    }
    Some(cur)
}

fn text_at(v: &serde_json::Value, path: Option<&str>) -> Option<String> {
    match at(v, path?)? {
        serde_json::Value::String(s) => Some(s.trim().to_string()).filter(|s| !s.is_empty()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Array(a) => Some(a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", ")).filter(|s| !s.is_empty()),
        _ => None,
    }
}

fn api_entry(src: &CatalogSource, v: &serde_json::Value, page_platform: Option<&str>) -> Option<CatalogEntry> {
    let f = &src.api_fields;
    let title = text_at(v, f.title.as_deref().or(Some("title"))).or_else(|| text_at(v, Some("name")))?;
    let id = text_at(v, f.id.as_deref().or(Some("id")))?;
    let original = text_at(v, f.url.as_deref()).map(|u| absolute(&src.base_url, &u)).unwrap_or_else(|| detail_url(src, &id));
    let cover = text_at(v, f.cover.as_deref()).map(|c| absolute(&src.base_url, &c));
    let size = text_at(v, f.size.as_deref());
    let (tag_region, tag_lang) = tags_of(&title);
    let size_n = size.as_deref().and_then(|s| s.parse::<u64>().ok().or_else(|| size_bytes(s)));
    Some(CatalogEntry {
        id,
        source_id: src.id.clone(),
        platform: platform_of(src, text_at(v, f.platform.as_deref()).as_deref(), &original, page_platform),
        category: category_of(text_at(v, f.category.as_deref()).as_deref(), &title),
        description: text_at(v, f.description.as_deref()),
        region: text_at(v, f.region.as_deref()).or(tag_region),
        language: text_at(v, f.language.as_deref()).or(tag_lang),
        size: size.map(|s| if s.chars().all(|c| c.is_ascii_digit()) { crate::downloads::human(s.parse().unwrap_or(0)) } else { s }),
        size_bytes: size_n,
        version: text_at(v, f.version.as_deref()),
        cover_url: proxied_cover(cover.clone()),
        cover_original: cover,
        original_url: original,
        title,
        installed_game_id: None,
        emulator: None,
    })
}

pub fn api_list(src: &CatalogSource, body: &str, page_platform: Option<&str>, page: usize) -> anyhow::Result<(Vec<CatalogEntry>, bool)> {
    let v: serde_json::Value = serde_json::from_str(body)?;
    let list = match src.api_fields.items.as_deref() {
        Some(p) => at(&v, p),
        None => Some(&v),
    }
    .and_then(|x| x.as_array())
    .ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("La respuesta no trae la lista (revisa apiFields.items)")))?;
    let entries: Vec<CatalogEntry> = list.iter().filter_map(|x| api_entry(src, x, page_platform)).collect();
    let more = match text_at(&v, src.api_fields.total_pages.as_deref()).and_then(|t| t.parse::<usize>().ok()) {
        Some(total) => page < total,
        None => !entries.is_empty(),
    };
    Ok((entries, more))
}

pub fn api_detail(src: &CatalogSource, body: &str, id: &str) -> anyhow::Result<CatalogDetail> {
    let v: serde_json::Value = serde_json::from_str(body)?;
    let f = &src.api_fields;
    let obj = match f.detail.as_deref() {
        Some(p) => at(&v, p).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("La respuesta no trae la ficha (revisa apiFields.detail)")))?,
        None => &v,
    };
    let mut entry = api_entry(src, obj, None).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("La ficha no tiene título o id (revisa apiFields)")))?;
    entry.id = id.to_string();
    let mut links = vec![];
    if let Some(list) = f.downloads.as_deref().and_then(|p| at(obj, p)) {
        let items: Vec<&serde_json::Value> = match list {
            serde_json::Value::Array(a) => a.iter().collect(),
            other => vec![other],
        };
        for it in items {
            let (url, label, size) = match it {
                serde_json::Value::String(s) => (Some(s.clone()), String::new(), None),
                o => (
                    text_at(o, f.download_url.as_deref().or(Some("url"))),
                    text_at(o, f.download_label.as_deref().or(Some("name"))).unwrap_or_default(),
                    text_at(o, Some("size")),
                ),
            };
            if let Some(u) = url.map(|u| absolute(&src.base_url, &u)).filter(|u| u.starts_with("http://") || u.starts_with("https://") || u.starts_with("magnet:")) {
                links.push(link(u, label, size));
            }
        }
    }
    let screenshots = match f.screenshots.as_deref().and_then(|p| at(obj, p)) {
        Some(serde_json::Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).filter_map(|u| crate::explore::images::proxy(&absolute(&src.base_url, u))).take(12).collect(),
        _ => vec![],
    };
    Ok(CatalogDetail { entry, links, screenshots })
}

// ───────────────────────── paginación por «siguiente» ─────────────────────────

/// URLs de cada página de una lista que solo se recorre con el enlace «siguiente».
static PAGES: LazyLock<Mutex<HashMap<String, Vec<String>>>> = LazyLock::new(Default::default);

pub fn remember_page(key: &str, page: usize, url: &str) {
    let mut m = PAGES.lock();
    if m.len() > 500 {
        m.clear();
    }
    let v = m.entry(key.to_string()).or_default();
    if v.len() < page {
        v.resize(page, String::new());
    }
    v[page - 1] = url.to_string();
}

pub fn known_page(key: &str, page: usize) -> Option<String> {
    PAGES.lock().get(key).and_then(|v| v.get(page - 1)).filter(|u| !u.is_empty()).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src() -> CatalogSource {
        let mut s = CatalogSource { id: "t".into(), base_url: "https://cat.test".into(), platforms: vec!["switch".into(), "ps2".into(), "wii".into(), "wii-u".into()], ..Default::default() };
        s.selectors = Selectors {
            game_list: Some(".game-item, .rom-item".into()),
            title: Some("h2.title, h3".into()),
            cover_image: Some("img.cover@src".into()),
            download_link: Some("a.download@href, .download-btn@href".into()),
            platform: Some(".platform-badge".into()),
            size: Some(".size".into()),
            next_page: Some("a.next@href".into()),
            breadcrumbs: Some(".crumbs a".into()),
            screenshots: Some(".shots img@src".into()),
            ..Default::default()
        };
        s.platform_mapping.insert("Nintendo Switch".into(), "switch".into());
        s.platform_mapping.insert("Wii U".into(), "wii-u".into());
        s
    }

    const LIST: &str = r#"<html><body>
      <div class="game-item"><a href="/switch-games/zelda-botw/"><img class="cover" data-src="/img/zelda.jpg" src="data:x"></a>
        <h2 class="title">Zelda: Breath of the Wild (Europe) (En,Fr,Es)</h2><span class="platform-badge">Nintendo Switch</span><span class="size">13,4 GB</span></div>
      <div class="game-item"><a href="/ps2/gow/">God of War</a><h2 class="title">God of War [PAL]</h2><span class="size">4.2 GB</span></div>
      <div class="game-item"><a href="/x/mk8-dlc/">Mario Kart 8 DLC</a><h2 class="title">Mario Kart 8 Deluxe DLC Booster</h2><span class="platform-badge">Wii U</span></div>
      <a class="next" href="/lista/page/2/">Siguiente</a>
    </body></html>"#;

    #[test]
    fn scrapes_a_list() {
        let s = src();
        let r = scrape_list(&s, LIST, "https://cat.test/lista/", None);
        assert_eq!(r.entries.len(), 3);
        let z = &r.entries[0];
        assert_eq!(z.id, "/switch-games/zelda-botw/");
        assert_eq!(z.platform.as_deref(), Some("switch"));
        assert_eq!(z.cover_original.as_deref(), Some("https://cat.test/img/zelda.jpg"));
        assert_eq!((z.region.as_deref(), z.language.as_deref()), (Some("Europe"), Some("EN, FR, ES")));
        assert_eq!(z.size_bytes, Some((13.4 * (1u64 << 30) as f64) as u64));
        let g = &r.entries[1];
        assert_eq!((g.platform.as_deref(), g.region.as_deref()), (Some("ps2"), Some("Europe")));
        let d = &r.entries[2];
        assert_eq!((d.platform.as_deref(), d.category.as_str()), (Some("wii-u"), "dlc"));
        assert_eq!(r.next.as_deref(), Some("https://cat.test/lista/page/2/"));
    }

    #[test]
    fn scrapes_a_detail_page() {
        let s = src();
        let html = r#"<html><head><title>x</title></head><body><div class="crumbs"><a href="/">Inicio</a><a href="/c/wii/">Wii</a></div>
          <h2 class="title">Super Mario Galaxy (USA)</h2><img class="cover" src="https://cdn.other/sm.jpg">
          <a class="download" href="/dl/smg.rvz">Servidor 1</a><a class="download" href="magnet:?xt=urn:btih:abc">Torrent</a>
          <a class="download-btn" href="https://files.host/f/123">Mirror</a><a class="download" href="javascript:alert(1)">x</a></body></html>"#;
        let d = scrape_detail(&s, html, "https://cat.test/g/smg/", "/g/smg/");
        assert_eq!(d.entry.title, "Super Mario Galaxy (USA)");
        assert_eq!(d.entry.platform.as_deref(), Some("wii"));
        let kinds: Vec<(&str, &str)> = d.links.iter().map(|l| (l.kind.as_str(), l.url.as_str())).collect();
        assert_eq!(kinds, vec![("direct", "https://cat.test/dl/smg.rvz"), ("magnet", "magnet:?xt=urn:btih:abc"), ("page", "https://files.host/f/123")]);
    }

    #[test]
    fn romshq_default_source() {
        let s = super::super::config::defaults().into_iter().find(|s| s.id == "romshq").unwrap();
        assert_eq!(expand(&s, s.endpoints.by_platform.as_deref().unwrap(), "", 2, Some("ps5"), ""), "https://romshq.com/roms/playstation-5?page=2");
        assert_eq!(expand(&s, s.endpoints.search.as_deref().unwrap(), "super mario", 1, None, ""), "https://romshq.com/search/super%20mario?page=1");
        let card = |slug: &str, title: &str, platform: &str| {
            format!(
                r#"<div class="relative group/item" x-data="{{}}"><div class="overflow-hidden"><a href="https://romshq.com/game/{slug}" class="aspect-[16/9] relative block">
                <picture><img src="data:image/gif;base64,R0lGOD" data-src="https://romshq.com/uploads/poster/{slug}.png" alt="{title}"></picture><h3 class="text-lg">{title}</h3></a></div>
                <div x-ref="hoverWindow"><h4>{title}</h4><div><span class="text-sm font-medium text-emerald-400 truncate"> {platform} </span></div></div></div>"#
            )
        };
        let list = format!(
            r#"<html><body><div class="grid">{}{}{}{}</div><a href="https://romshq.com/trending?page=2" rel="next">›</a></body></html>"#,
            card("juego-uno", "Juego Uno", "Switch"),
            card("juego-dos", "Juego Dos", "PS5"),
            card("ryujinx-emulator", "Ryujinx Emulator", "Switch"),
            card("juego-pc", "Juego PC", "PC")
        );
        let r = scrape_list(&s, &list, "https://romshq.com/trending?page=1", None);
        assert_eq!(r.next.as_deref(), Some("https://romshq.com/trending?page=2"));
        let e = &r.entries[0];
        assert_eq!((e.id.as_str(), e.title.as_str(), e.platform.as_deref()), ("/game/juego-uno", "Juego Uno", Some("switch")));
        assert_eq!(e.cover_original.as_deref(), Some("https://romshq.com/uploads/poster/juego-uno.png"));
        let shown: Vec<&str> = r.entries.iter().filter(|e| super::super::shown(&s, e)).map(|e| e.title.as_str()).collect();
        assert_eq!(shown, vec!["Juego Uno", "Juego Dos"]);
        let detail = r#"<html><head><meta name="csrf-token" content="t"></head><body><header><a href="https://romshq.com/roms/playstation-5">PlayStation 5</a></header>
          <img src="https://romshq.com/uploads/poster/juego-uno-featured.webp" alt="Juego Uno cover"><h1 class="text-4xl"> Juego Uno </h1>
          <div class="flex"><span class="flex items-center"> 09 Apr, 2025 </span><span class="flex items-center"> Switch </span></div>
          <p class="text-gray-600 leading-relaxed">Un juego.</p>
          <section id="download-section"><div><div class="flex flex-col"><div><h3>Download Here</h3></div>
            <a href="https://datanodes.to/abc/JUEGO-UNO.nsp.rar" data-romshq-download data-video-id="14764"><span>↓</span><span data-romshq-download-label>Download</span></a></div>
            <div class="flex flex-col"><div><h3>Update</h3></div><a href="https://buzzheavier.com/x" data-romshq-download data-video-id="14765"><span>↓</span><span>Download</span></a></div></div></section></body></html>"#;
        let d = scrape_detail(&s, detail, "https://romshq.com/game/juego-uno", "/game/juego-uno");
        assert_eq!((d.entry.title.as_str(), d.entry.platform.as_deref()), ("Juego Uno", Some("switch")));
        assert_eq!(d.entry.cover_original.as_deref(), Some("https://romshq.com/uploads/poster/juego-uno-featured.webp"));
        assert_eq!(d.entry.description.as_deref(), Some("Un juego."));
        let links: Vec<(&str, &str, &str)> = d.links.iter().map(|l| (l.label.as_str(), l.kind.as_str(), l.url.as_str())).collect();
        assert_eq!(links, vec![("Download Here", "direct", "https://romshq.com/api/download/sign/14764"), ("Update", "direct", "https://romshq.com/api/download/sign/14765")]);
        assert!(not_a_bot_wall(detail.into()).is_ok());
        assert!(not_a_bot_wall("<html><head><title>Making sure you&#39;re not a bot!</title>".into()).is_err());
    }

    #[test]
    fn specs_and_templates() {
        let spec = "img.cover@src,a[href*='x,y']@href,h3";
        let p = parse_spec(spec);
        assert_eq!(p.len(), 3);
        assert_eq!(p[0].1.as_deref(), Some("src"));
        assert_eq!(p[1].1.as_deref(), Some("href"));
        assert!(p[2].1.is_none());
        let mut s = src();
        s.platform_paths.insert("ps2".into(), "sony-ps2".into());
        assert_eq!(expand(&s, "/search?q={query}&p={page}&s={platformPath}", "god of war", 2, Some("ps2"), ""), "https://cat.test/search?q=god%20of%20war&p=2&s=sony-ps2");
        assert_eq!(expand(&s, "/c/{platformPath}/", "", 1, Some("wii-u"), ""), "https://cat.test/c/Wii%20U/");
        assert!(same_site(&s, "https://www.cat.test/a"));
        assert!(same_site(&s, "https://img.cat.test/a"));
        assert!(!same_site(&s, "https://evil.test/a"));
    }

    #[test]
    fn categories_regions_and_sizes() {
        assert_eq!(category_of(None, "Zelda TOTK Update v1.2.1"), "update");
        assert_eq!(category_of(None, "Smash [DLC] Pack"), "dlc");
        assert_eq!(category_of(Some("Juegos"), "Zelda"), "game");
        assert_eq!(category_of(Some("Updates"), "Zelda"), "update");
        assert_eq!(tags_of("Juego (USA, Europe) (En,Fr,De)"), (Some("USA, Europe".into()), Some("EN, FR, DE".into())));
        assert_eq!(tags_of("Juego [EUR] [ESP]").0.as_deref(), Some("Europe, Spain"));
        assert_eq!(size_bytes("700 MB"), Some(700 << 20));
        assert_eq!(size_bytes("1,5 GiB"), Some((1.5 * (1u64 << 30) as f64) as u64));
    }

    #[test]
    fn api_lists_and_details() {
        let mut s = src();
        s.kind = "api".into();
        s.api_fields = super::super::config::ApiFields {
            items: Some("data.results".into()),
            title: Some("name".into()),
            platform: Some("system".into()),
            cover: Some("images.cover".into()),
            size: Some("bytes".into()),
            downloads: Some("files".into()),
            total_pages: Some("data.pages".into()),
            ..Default::default()
        };
        let body = r#"{"data":{"pages":3,"results":[{"id":7,"name":"Metroid (USA)","system":"Nintendo Switch","images":{"cover":"/c/7.png"},"bytes":"1048576"}]}}"#;
        let (l, more) = api_list(&s, body, None, 1).unwrap();
        assert!(more);
        assert_eq!((l[0].id.as_str(), l[0].platform.as_deref(), l[0].size_bytes), ("7", Some("switch"), Some(1 << 20)));
        let d = api_detail(&s, r#"{"id":7,"name":"Metroid","files":[{"url":"/f/7.nsp","name":"Base"},"magnet:?xt=urn:btih:ff"]}"#, "7").unwrap();
        assert_eq!(d.links.len(), 2);
        assert_eq!((d.links[0].kind.as_str(), d.links[0].label.as_str()), ("direct", "Base"));
    }
}
