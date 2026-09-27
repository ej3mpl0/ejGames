//! Lectura de las entradas de FitGirl (HTML de WordPress) con expresiones
//! regulares: el marcado de sus fichas es muy estable y no compensa un parser
//! de HTML completo.

use regex::Regex;
use std::sync::LazyLock;

static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<[^>]*>").unwrap());
static ENTITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t\u{a0}]+").unwrap());
static BLANK_LINES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n\s*\n+").unwrap());

static FIRST_H3: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<h3[^>]*>(.*?)</h3>").unwrap());
static NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"#(\d{1,6})").unwrap());
static STRONG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<strong>(.*)</strong>").unwrap());
static GREY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<span[^>]*>(.*?)</span>").unwrap());
static IMG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<img[^>]*?\ssrc="([^"]+)""#).unwrap());
static GENRES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)Genres/Tags:\s*(.*?)<br").unwrap());
static COMPANIES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)Compan(?:y|ies):\s*<strong>(.*?)</strong>").unwrap());
static LANGUAGES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)Languages:\s*<strong>(.*?)</strong>").unwrap());
static ORIGINAL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)Original Size:\s*<strong>(.*?)</strong>").unwrap());
static REPACK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)Repack Size:\s*<strong>(.*?)</strong>").unwrap());
static MAGNET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"href="(magnet:\?[^"]+)""#).unwrap());
static SHOT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"src="https?://([a-z0-9.]*riotpixels\.net/[^"]+?\.(?:jpe?g|png))\.240p\.jpg""#).unwrap());
static FEATURES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)Repack Features</h3>.*?<ul>(.*?)</ul>").unwrap());
static HDD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)HDD space after installation:\s*(.+)").unwrap());
static DESCRIPTION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?s)Game Description</div>\s*<div class="su-spoiler-content[^"]*">(.*?)</div>\s*</div>"#).unwrap());
static SIZE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)([\d]+(?:[.,]\d+)?)\s*(KB|MB|GB|TB)").unwrap());
/// Donde empieza la versión en el título ("…, v1.03 + 5 DLCs", "… – Build 123").
static TITLE_SPLIT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:,\s+|\s+[–—-]\s+|\s+\+\s+)(?:v\s?\d|build\s|r\d|update\s|\d+\s+dlc|\+|bonus|\d+(?:\.\d+)+)").unwrap());
static ADULT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(adult|nudity|hentai|erotic|sexual content|nsfw|porn\w*)\b|18\+").unwrap());

/// Decodifica entidades HTML (numéricas y las nombradas que usa WordPress).
pub fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    ENTITY
        .replace_all(s, |c: &regex::Captures| {
            let e = &c[1];
            let ch = if let Some(hex) = e.strip_prefix("#x").or_else(|| e.strip_prefix("#X")) {
                u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
            } else if let Some(dec) = e.strip_prefix('#') {
                dec.parse::<u32>().ok().and_then(char::from_u32)
            } else {
                match e {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    "nbsp" => Some(' '),
                    "ndash" => Some('–'),
                    "mdash" => Some('—'),
                    "hellip" => Some('…'),
                    "lsquo" => Some('‘'),
                    "rsquo" => Some('’'),
                    "ldquo" => Some('“'),
                    "rdquo" => Some('”'),
                    "laquo" => Some('«'),
                    "raquo" => Some('»'),
                    "times" => Some('×'),
                    "copy" => Some('©'),
                    "reg" => Some('®'),
                    "trade" => Some('™'),
                    _ => None,
                }
            };
            ch.map(String::from).unwrap_or_else(|| c[0].to_string())
        })
        .into_owned()
}

/// Texto plano de un trozo de HTML (una línea).
pub fn text(html: &str) -> String {
    let s = TAG.replace_all(html, " ");
    let s = decode_entities(&s);
    SPACES.replace_all(&s, " ").trim().to_string()
}

/// Texto con saltos de línea: párrafos y elementos de lista en líneas propias.
fn multiline(html: &str) -> String {
    // En HTML los saltos de línea son espacios; los de verdad son <br> y <p>.
    let s = html
        .replace(['\r', '\n'], " ")
        .replace("<br />", "\n")
        .replace("<br>", "\n")
        .replace("</p>", "\n\n")
        .replace("<p>", "\n")
        .replace("<li>", "\n• ");
    let s = TAG.replace_all(&s, "");
    let s = decode_entities(&s);
    let lines: Vec<String> = s.lines().map(|l| SPACES.replace_all(l, " ").trim().to_string()).collect();
    let s = lines.join("\n");
    BLANK_LINES.replace_all(s.trim(), "\n\n").to_string()
}

/// "from 18 GB", "26.1 GB", "1,5 GB" → bytes (el primer tamaño que aparezca).
pub fn size_bytes(s: &str) -> Option<u64> {
    let c = SIZE.captures(s)?;
    let n: f64 = c[1].replace(',', ".").parse().ok()?;
    let mult = match c[2].to_ascii_uppercase().as_str() {
        "KB" => 1024f64,
        "MB" => 1024f64.powi(2),
        "GB" => 1024f64.powi(3),
        _ => 1024f64.powi(4),
    };
    Some((n * mult) as u64)
}

/// Nombre y versión a partir del título de la entrada ("X: Deluxe, v1.2 + 3 DLCs").
pub fn split_title(title: &str) -> (String, Option<String>) {
    match TITLE_SPLIT.find(title) {
        Some(m) if m.start() > 0 => {
            let name = title[..m.start()].trim().to_string();
            let rest = title[m.start()..].trim_start_matches([',', ' ', '–', '—', '-']).trim().to_string();
            (name, (!rest.is_empty()).then_some(rest))
        }
        _ => (title.trim().to_string(), None),
    }
}

/// Título limpio para buscar metadatos y nombrar la carpeta de instalación.
pub fn clean_repack_title(title: &str) -> String {
    let (name, _) = split_title(&decode_entities(title));
    let name = name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], " ");
    SPACES.replace_all(&name, " ").trim().trim_end_matches('.').to_string()
}

pub fn is_adult(title: &str, genres: &[String]) -> bool {
    ADULT.is_match(title) || genres.iter().any(|g| ADULT.is_match(g))
}

#[derive(Debug, Default, Clone)]
pub struct Post {
    pub name: String,
    pub version: Option<String>,
    pub number: Option<u32>,
    pub cover: Option<String>,
    pub genres: Vec<String>,
    pub companies: Option<String>,
    pub languages: Option<String>,
    pub original_size: Option<String>,
    pub repack_size: Option<String>,
    pub repack_bytes: Option<u64>,
    pub magnet: Option<String>,
    /// URLs base de las capturas (sin el sufijo de tamaño de riotpixels).
    pub screenshots: Vec<String>,
    pub features: Vec<String>,
    pub install_size: Option<String>,
    pub description: Option<String>,
    pub selective: bool,
}

fn capture(re: &Regex, s: &str) -> Option<String> {
    re.captures(s).map(|c| text(&c[1])).filter(|t| !t.is_empty())
}

/// Lee una entrada de repack (`content.rendered`) con su título ya decodificado.
pub fn parse_post(content: &str, title: &str) -> Post {
    let mut p = Post::default();

    // Cabecera: "#5716 Updated <strong>Nombre <span>v1.03 + 5 DLCs</span></strong>".
    let (mut name, mut version) = split_title(title);
    if let Some(h3) = FIRST_H3.captures(content).map(|c| c[1].to_string()) {
        p.number = NUMBER.captures(&text(&h3)).and_then(|c| c[1].parse().ok());
        if let Some(strong) = STRONG.captures(&h3).map(|c| c[1].to_string()) {
            let grey = GREY.captures(&strong).map(|c| text(&c[1])).filter(|v| !v.is_empty());
            let n = text(&GREY.replace_all(&strong, ""));
            if !n.is_empty() {
                name = n.trim_end_matches([',', ' ', '–', '-']).to_string();
                if grey.is_some() {
                    version = grey;
                }
            }
        }
    }
    p.name = name;
    p.version = version;

    p.cover = IMG.captures(content).map(|c| decode_entities(&c[1]));
    p.genres = GENRES
        .captures(content)
        .map(|c| text(&c[1]).split(',').map(|g| g.trim().to_string()).filter(|g| !g.is_empty()).collect())
        .unwrap_or_default();
    p.companies = capture(&COMPANIES, content);
    p.languages = capture(&LANGUAGES, content);
    p.original_size = capture(&ORIGINAL, content);
    p.repack_size = capture(&REPACK, content);
    p.repack_bytes = p.repack_size.as_deref().and_then(size_bytes);
    p.selective = content.contains("Selective Download");

    // El primer magnet tras «Download Mirrors (Torrent)»; los siguientes suelen
    // ser el mismo en otro tracker o versiones antiguas.
    let torrents = content.find("Download Mirrors (Torrent)").map(|i| &content[i..]).unwrap_or(content);
    p.magnet = MAGNET.captures(torrents).or_else(|| MAGNET.captures(content)).map(|c| decode_entities(&c[1]));

    let mut seen = std::collections::HashSet::new();
    p.screenshots = SHOT
        .captures_iter(content)
        .map(|c| format!("https://{}", &c[1]))
        .filter(|u| seen.insert(u.clone()))
        .take(12)
        .collect();

    if let Some(ul) = FEATURES.captures(content).map(|c| c[1].to_string()) {
        // Los <li> de FitGirl no se cierran: cada uno llega hasta el siguiente.
        p.features = ul
            .split("<li>")
            .skip(1)
            .map(|chunk| text(chunk.split("</li>").next().unwrap_or(chunk)))
            .filter(|t| !t.is_empty())
            .collect();
    }
    p.install_size = p.features.iter().find_map(|f| HDD.captures(f).map(|c| c[1].trim().trim_end_matches('.').to_string()));
    p.description = DESCRIPTION.captures(content).map(|c| multiline(&c[1])).filter(|d| !d.is_empty());
    p
}

/// Un juego de las listas de populares (`/popular-repacks/`).
#[derive(Debug, Clone, PartialEq)]
pub struct PopularItem {
    pub slug: String,
    pub title: String,
    pub cover: Option<String>,
}

static WIDGET_TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<h2 class="widgettitle">(.*?)</h2>"#).unwrap());
static GRID_ITEM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"widget-grid-view-image"><a href="https://fitgirl-repacks\.site/([a-z0-9-]+)/" title="([^"]*)"[^>]*>(?:<img[^>]*?\ssrc="([^"]+)")?"#)
        .unwrap()
});

/// Secciones de la página de populares: (título de la sección, juegos).
pub fn parse_popular(html: &str) -> Vec<(String, Vec<PopularItem>)> {
    let heads: Vec<(usize, String)> = WIDGET_TITLE.captures_iter(html).map(|c| (c.get(0).unwrap().start(), text(&c[1]))).collect();
    let mut out = Vec::new();
    for (i, (start, title)) in heads.iter().enumerate() {
        let end = heads.get(i + 1).map(|h| h.0).unwrap_or(html.len());
        let items: Vec<PopularItem> = GRID_ITEM
            .captures_iter(&html[*start..end])
            .map(|c| PopularItem {
                slug: c[1].to_string(),
                title: decode_entities(&c[2]),
                cover: c.get(3).map(|m| decode_entities(m.as_str())),
            })
            .collect();
        if !items.is_empty() {
            out.push((title.clone(), items));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const POST: &str = r##"<h3><span style="color: #339966;">#5716 Updated</span> <strong>ELDEN RING NIGHTREIGN: Deluxe Edition <span style="color: #808080;">v1.03/v1.03.1 + 5 DLCs/Bonuses</span></strong></h3>
<p style="height: 200px; display: block;"><a target="_blank" href="https://en.riotpixels.com/games/x/" rel="noopener"><img decoding="async" class="alignleft" width="150" src="https://i5.imageban.ru/out/2025/05/30/c2e3.jpg" /></a><br />
Genres/Tags: <a href="https://fitgirl-repacks.site/tag/action/">Action</a>, <a href="https://fitgirl-repacks.site/tag/survival/">Survival</a><br />
Companies: <strong>From Software, Bandai Namco Entertainment</strong><br />
Languages: <strong>RUS/ENG/MULTI15</strong><br />
Original Size: <strong>26.1 GB</strong><br />
Repack Size: <strong>from 18 GB</strong> [Selective Download]
<h3>Download Mirrors (Direct Links)</h3>
<ul><li><a href="https://paste.example/?a">Filehoster</a> <span style="color: red">(Speed &#038; Usability)</span></li></ul>
<h3>Download Mirrors (Torrent)</h3>
<ul>
<li><a href="https://1337x.to/torrent/1/">1337x</a> | [<a href="magnet:?xt=urn:btih:DDC2E96C8654141A9C9161DF7EA0AB77125F0F93&#038;dn=ELDEN+RING&#038;tr=udp%3A%2F%2Fopentor.net%3A6969%2Fannounce">magnet</a>]</li>
<li><a href="https://rutor.info/torrent/1">RuTor</a> [<a href="magnet:?xt=urn:btih:ffff&#038;dn=old">magnet</a>]</li>
</ul>
<h3>Screenshots (Click to enlarge)</h3>
<p><a href="https://en.riotpixels.com/x"><img width="178" src="http://s01.riotpixels.net/data/d3/55/d355.jpg.240p.jpg"></a><a href="#"><img src="http://s01.riotpixels.net/data/e8/e5/e8e5.jpg.240p.jpg"></a></p>
<h3>Repack Features</h3>
<p><b>Repack Features</b></p>
<ul>
<li>Based on ELDEN.RING-RUNE ISO release
<li>100% Lossless &#038; MD5 Perfect
<li>HDD space after installation: up to 26.7 GB
</ul>
<div class="su-spoiler"><div class="su-spoiler-title">Game Description</div><div class="su-spoiler-content su-u-clearfix su-u-trim">
ELDEN RING NIGHTREIGN is a standalone adventure.</p>
<p>BECOME A HERO<br />
Take command.</p>
<ul>
<li>Bonus Gesture
<li>Digital Artbook &#038; Mini Soundtrack
</ul>
</div></div>"##;

    #[test]
    fn reads_a_post() {
        let p = parse_post(POST, "ELDEN RING NIGHTREIGN: Deluxe Edition, v1.03/v1.03.1 + 5 DLCs/Bonuses");
        assert_eq!(p.number, Some(5716));
        assert_eq!(p.name, "ELDEN RING NIGHTREIGN: Deluxe Edition");
        assert_eq!(p.version.as_deref(), Some("v1.03/v1.03.1 + 5 DLCs/Bonuses"));
        assert_eq!(p.cover.as_deref(), Some("https://i5.imageban.ru/out/2025/05/30/c2e3.jpg"));
        assert_eq!(p.genres, vec!["Action", "Survival"]);
        assert_eq!(p.companies.as_deref(), Some("From Software, Bandai Namco Entertainment"));
        assert_eq!(p.languages.as_deref(), Some("RUS/ENG/MULTI15"));
        assert_eq!(p.original_size.as_deref(), Some("26.1 GB"));
        assert_eq!(p.repack_size.as_deref(), Some("from 18 GB"));
        assert_eq!(p.repack_bytes, Some(18 * 1024 * 1024 * 1024));
        assert!(p.selective);
        let m = p.magnet.unwrap();
        assert!(m.starts_with("magnet:?xt=urn:btih:DDC2E96C"), "{m}");
        assert!(m.contains("&dn=ELDEN+RING&tr="), "entidades sin decodificar: {m}");
        assert_eq!(
            p.screenshots,
            vec!["https://s01.riotpixels.net/data/d3/55/d355.jpg", "https://s01.riotpixels.net/data/e8/e5/e8e5.jpg"]
        );
        assert_eq!(p.features.len(), 3);
        assert_eq!(p.features[1], "100% Lossless & MD5 Perfect");
        assert_eq!(p.install_size.as_deref(), Some("up to 26.7 GB"));
        let d = p.description.unwrap();
        assert!(d.starts_with("ELDEN RING NIGHTREIGN is a standalone adventure."), "{d}");
        assert!(d.contains("BECOME A HERO\nTake command."), "{d}");
        assert!(d.contains("• Digital Artbook & Mini Soundtrack"), "{d}");
    }

    #[test]
    fn titles() {
        assert_eq!(
            split_title("Returning to Mia – v1.2.3"),
            ("Returning to Mia".to_string(), Some("v1.2.3".to_string()))
        );
        assert_eq!(
            split_title("Grand Theft Auto V / GTA 5 (Legacy) – v1.0.3725.0/1.72 + Bonus Content").0,
            "Grand Theft Auto V / GTA 5 (Legacy)"
        );
        assert_eq!(split_title("Half-Life 2").0, "Half-Life 2");
        assert_eq!(split_title("Cyberpunk 2077: Ultimate Edition, v2.3 + 3 DLCs").0, "Cyberpunk 2077: Ultimate Edition");
        assert_eq!(split_title("Hades II, Build 20542312").1.as_deref(), Some("Build 20542312"));
        assert_eq!(split_title("Frostpunk 2 + 2 DLCs").0, "Frostpunk 2");
        assert_eq!(
            clean_repack_title("ELDEN RING NIGHTREIGN: Deluxe Edition, v1.03/v1.03.1 + 5 DLCs/Bonuses"),
            "ELDEN RING NIGHTREIGN Deluxe Edition"
        );
        assert_eq!(decode_entities("Assassin&#039;s Creed &#8211; A &amp; B &#x2014;"), "Assassin's Creed – A & B —");
        assert_eq!(size_bytes("1,5 GB"), Some((1.5 * 1024f64.powi(3)) as u64));
        assert!(is_adult("SEXNATURAL, Build 1 + Wallpapers 18+", &[]));
        assert!(!is_adult("Hades", &["Action".into(), "Roguelike".into()]));
    }

    #[test]
    fn popular() {
        let html = r##"<h2 class="widgettitle">Most Popular Repacks of the Month</h2><div class="widget-grid-view-image"><a href="https://fitgirl-repacks.site/grand-theft-auto-v/" title="GTA V &#8211; v1" class="bump-view"><img width="150" src="https://i0.wp.com/i3.imageban.ru/a.jpg?resize=150%2C200&#038;ssl=1" /></a></div>
<h2 class="widgettitle">Most Popular Repacks of the Week</h2><div class="widget-grid-view-image"><a href="https://fitgirl-repacks.site/hades-ii/" title="Hades II"><img src="https://i0.wp.com/b.jpg"></a></div><h2 class="widgettitle">Today&#8217;s</h2><ol><li>nada</li></ol>"##;
        let s = parse_popular(html);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].0, "Most Popular Repacks of the Month");
        assert_eq!(
            s[0].1[0],
            PopularItem {
                slug: "grand-theft-auto-v".into(),
                title: "GTA V – v1".into(),
                cover: Some("https://i0.wp.com/i3.imageban.ru/a.jpg?resize=150%2C200&ssl=1".into())
            }
        );
        assert_eq!(s[1].1[0].slug, "hades-ii");
    }
}
