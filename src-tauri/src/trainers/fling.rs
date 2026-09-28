//! flingtrainer.com: buscar el trainer de un juego (la API de WordPress de la
//! web) y leer su ficha (opciones con sus teclas, versión del juego, avisos y
//! descargas). La ficha es HTML: se pasa a líneas de texto y se reconocen las
//! líneas «Num 1 – Infinite HP».

use regex::Regex;
use scraper::{ElementRef, Html, Node, Selector};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

pub const SITE: &str = "https://flingtrainer.com";
/// Categoría «Trainers» de la web (las demás son noticias y archivo).
const TRAINERS_CATEGORY: u32 = 5;

/// Un resultado de la búsqueda.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// Nombre del juego según FLiNG (sin « Trainer»).
    pub title: String,
    pub url: String,
    /// Última actualización del trainer (AAAA-MM-DD).
    pub updated: String,
    /// Parecido con el título del juego de la biblioteca (0..1).
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrainerOption {
    /// Las teclas, normalizadas ("Ctrl+Num 1"): identifican la opción.
    pub keys: String,
    pub label: String,
    /// Grupo de la ficha ("Edit Player Stats"), si lo hay.
    pub group: Option<String>,
    /// toggle (se activa y desactiva) | action (una vez) | value (necesita un
    /// valor en la ventana del trainer)
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    /// "Elden.Ring.v1.02-v1.16.1.Plus.35.Trainer-FLiNG"
    pub name: String,
    pub url: String,
    pub date: String,
    pub size: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub title: String,
    pub url: String,
    /// "v1.02-v1.16.*+"
    pub game_version: Option<String>,
    /// "2026.01.02"
    pub updated: Option<String>,
    pub options: Vec<TrainerOption>,
    /// Notas del autor (cómo usarlo, versiones, avisos).
    pub notes: Vec<String>,
    /// El juego tiene antitrampas ("EasyAntiCheat", "BattlEye"…).
    pub anticheat: Option<String>,
    /// La más reciente primero.
    pub downloads: Vec<Download>,
}

// ───────────────────────────── búsqueda ─────────────────────────────

#[derive(Deserialize)]
struct WpPost {
    link: String,
    modified: String,
    title: WpTitle,
}

#[derive(Deserialize)]
struct WpTitle {
    rendered: String,
}

pub fn search_url(query: &str) -> String {
    let mut u = url::Url::parse(&format!("{SITE}/wp-json/wp/v2/posts")).unwrap();
    u.query_pairs_mut()
        .append_pair("search", query)
        .append_pair("categories", &TRAINERS_CATEGORY.to_string())
        .append_pair("per_page", "20")
        .append_pair("_fields", "id,slug,title,link,modified");
    u.to_string()
}

/// Texto de un fragmento HTML (los títulos de WordPress vienen con entidades).
pub fn html_text(s: &str) -> String {
    let frag = Html::parse_fragment(s);
    let t: String = frag.root_element().text().collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// "Elden Ring Trainer" → "Elden Ring".
pub fn game_name(title: &str) -> String {
    let t = title.trim();
    let t = t.strip_suffix(" Trainer").or_else(|| t.strip_suffix(" trainer")).unwrap_or(t);
    t.trim().to_string()
}

/// Solo fichas de trainer de la propia web.
pub fn valid_page(url: &str) -> bool {
    url::Url::parse(url)
        .map(|u| u.scheme() == "https" && u.host_str() == Some("flingtrainer.com") && u.path().starts_with("/trainer/") && u.path().len() > 9)
        .unwrap_or(false)
}

pub fn parse_search(json: &str, game_title: &str) -> anyhow::Result<Vec<Candidate>> {
    let posts: Vec<WpPost> = serde_json::from_str(json)?;
    let mut out: Vec<Candidate> = posts
        .into_iter()
        .filter(|p| valid_page(&p.link))
        .map(|p| {
            let title = game_name(&html_text(&p.title.rendered));
            let score = crate::library::names::similarity(game_title, &title);
            Candidate { updated: p.modified.chars().take(10).collect(), url: p.link, title, score }
        })
        .collect();
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

// ───────────────────────────── ficha ─────────────────────────────

static HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bOptions?\b.*?Game Version:\s*(.*?)\s*(?:[·•|]\s*)?Last Updated:\s*([0-9][0-9./-]*)").unwrap()
});
static HOTKEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^((?:(?:Ctrl|Alt|Shift)\s*\+\s*)*)(Num\s*(?:[0-9]|\.|\+|-|\*|/|Del|Enter)|F(?:1[0-2]|[1-9])|Home|End|Insert|Ins|Delete|Del|Page\s*Up|Page\s*Down|PgUp|PgDn|Space|Tab|[A-Z0-9])\s*[–—-]\s*(\S.*)$",
    )
    .unwrap()
});
static NOTES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(special\s+)?notes?\s*:?$").unwrap());
static STOP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(downloads?|download links?|related( trainers)?|comments?|share)\s*:?$").unwrap());

/// Tecla con su nombre de siempre: "num 1" → "Num 1", "page up" → "Page Up".
fn canon_key(k: &str) -> String {
    let k = k.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = k.to_lowercase();
    if let Some(rest) = lower.strip_prefix("num") {
        let rest = rest.trim();
        let rest = match rest {
            "del" => "Del",
            "enter" => "Enter",
            r => r,
        };
        return format!("Num {rest}");
    }
    match lower.replace(' ', "").as_str() {
        "home" => "Home".into(),
        "end" => "End".into(),
        "insert" | "ins" => "Insert".into(),
        "delete" | "del" => "Delete".into(),
        "pageup" | "pgup" => "Page Up".into(),
        "pagedown" | "pgdn" => "Page Down".into(),
        "space" => "Space".into(),
        "tab" => "Tab".into(),
        _ => k.to_uppercase(),
    }
}

/// "ctrl + num 1" → "Ctrl+Num 1" (modificadores siempre en el mismo orden).
pub fn canon_hotkey(mods: &str, key: &str) -> String {
    let m = mods.to_lowercase();
    let mut parts: Vec<String> = vec![];
    for (name, label) in [("ctrl", "Ctrl"), ("alt", "Alt"), ("shift", "Shift")] {
        if m.contains(name) {
            parts.push(label.into());
        }
    }
    parts.push(canon_key(key));
    parts.join("+")
}

/// ¿Qué hace la opción? Las de «Edit/Set/Multiplier» piden un valor en la
/// ventana del trainer; las de «+1 hora», «Teleport»… se pulsan una vez.
pub fn option_kind(label: &str) -> &'static str {
    static VALUE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(edit|set|custom)\b|\bmultiplier\b").unwrap());
    static ACTION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"(?i)[+-]\s?\d+\b|\b(add|reset|refill|restore|teleport|save (position|location)|load position|fly (up|down)|kill all|complete|spawn|clear|heal|respawn|skip|undo|increase|decrease)\b",
        )
        .unwrap()
    });
    if VALUE.is_match(label) {
        "value"
    } else if ACTION.is_match(label) {
        "action"
    } else {
        "toggle"
    }
}

fn is_block(tag: &str) -> bool {
    matches!(
        tag,
        "p" | "div" | "br" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "ul" | "ol" | "tr" | "table" | "section" | "blockquote" | "hr"
    )
}

fn is_skipped(tag: &str) -> bool {
    matches!(tag, "script" | "style" | "svg" | "ins" | "noscript" | "iframe" | "form" | "button" | "select" | "textarea")
}

/// El texto del artículo en líneas, hasta la tabla de descargas.
fn lines_of(root: ElementRef) -> Vec<String> {
    use ego_tree::iter::Edge;
    let mut lines = vec![];
    let mut cur = String::new();
    let mut skip: Option<ego_tree::NodeId> = None;
    let flush = |cur: &mut String, lines: &mut Vec<String>| {
        let l = cur.split_whitespace().collect::<Vec<_>>().join(" ");
        if !l.is_empty() {
            lines.push(l);
        }
        cur.clear();
    };
    for edge in root.traverse() {
        match edge {
            Edge::Open(node) => {
                if skip.is_some() {
                    continue;
                }
                match node.value() {
                    Node::Text(t) => cur.push_str(t),
                    Node::Element(e) => {
                        let tag = e.name();
                        if tag == "table" && e.classes().any(|c| c.contains("attachments")) {
                            break;
                        }
                        if is_skipped(tag) {
                            skip = Some(node.id());
                        } else if is_block(tag) {
                            flush(&mut cur, &mut lines);
                        }
                    }
                    _ => {}
                }
            }
            Edge::Close(node) => {
                if skip == Some(node.id()) {
                    skip = None;
                    continue;
                }
                if skip.is_none() {
                    if let Node::Element(e) = node.value() {
                        if is_block(e.name()) {
                            flush(&mut cur, &mut lines);
                        }
                    }
                }
            }
        }
    }
    flush(&mut cur, &mut lines);
    lines
}

fn sel(s: &str) -> Selector {
    Selector::parse(s).unwrap()
}

fn text_of(e: ElementRef) -> String {
    e.text().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn parse_page(html: &str, url: &str) -> Page {
    let doc = Html::parse_document(html);
    let title = doc
        .select(&sel("article h1, h1.post-title, h1.entry-title"))
        .map(text_of)
        .find(|t| !t.is_empty())
        .or_else(|| {
            doc.select(&sel(r#"meta[property="og:title"]"#))
                .next()
                .and_then(|m| m.value().attr("content"))
                .map(|t| t.split(" - ").next().unwrap_or(t).to_string())
        })
        .map(|t| game_name(&t))
        .unwrap_or_default();
    let root = doc.select(&sel("article")).next().or_else(|| doc.select(&sel("body")).next()).unwrap_or(doc.root_element());
    let lines = lines_of(root);

    let mut page = Page { title, url: url.to_string(), ..Default::default() };
    let start = match lines.iter().position(|l| HEADER.is_match(l)) {
        Some(i) => {
            let c = HEADER.captures(&lines[i]).unwrap();
            page.game_version = Some(c[1].trim().trim_end_matches(['·', '•', '|']).trim().to_string()).filter(|v| !v.is_empty());
            page.updated = Some(c[2].trim_end_matches('.').to_string());
            i + 1
        }
        None => lines.iter().position(|l| l.eq_ignore_ascii_case("options")).map(|i| i + 1).unwrap_or(0),
    };

    let mut group: Option<String> = None;
    let mut in_notes = false;
    for l in &lines[start.min(lines.len())..] {
        if STOP.is_match(l) {
            break;
        }
        if NOTES.is_match(l) {
            in_notes = true;
            continue;
        }
        if in_notes {
            if page.notes.len() < 12 {
                page.notes.push(l.chars().take(600).collect());
            }
            continue;
        }
        if l.eq_ignore_ascii_case("options") {
            continue;
        }
        if let Some(c) = HOTKEY.captures(l) {
            let (mods, key) = (c.get(1).map(|m| m.as_str()).unwrap_or(""), &c[2]);
            // Una letra o número suelto solo si lleva modificador ("1 – …" es una lista).
            if key.chars().count() == 1 && mods.trim().is_empty() {
                continue;
            }
            let keys = canon_hotkey(mods, key);
            if page.options.iter().any(|o| o.keys == keys) {
                continue;
            }
            let label = c[3].trim().to_string();
            page.options.push(TrainerOption { kind: option_kind(&label).into(), keys, label, group: group.clone() });
        } else if !page.options.is_empty() && l.chars().count() <= 48 && !l.ends_with(['.', ':']) {
            // Un título entre opciones ("Edit Player Stats").
            group = Some(l.clone());
        }
    }

    let all = lines.join("\n").to_lowercase();
    page.anticheat = if all.contains("easyanticheat") || all.contains("easy anti-cheat") || all.contains("(eac)") {
        Some("EasyAntiCheat".into())
    } else if all.contains("battleye") {
        Some("BattlEye".into())
    } else if all.contains("anti-cheat") || all.contains("anticheat") {
        Some("antitrampas".into())
    } else {
        None
    };

    let row = sel("table.da-attachments-table tr, table[class*=attachments] tr");
    let (link, date, size) = (sel("a.attachment-link"), sel(".attachment-date"), sel(".attachment-size"));
    for r in doc.select(&row) {
        let Some(a) = r.select(&link).next() else { continue };
        let Some(href) = a.value().attr("href").filter(|h| valid_download(h)) else { continue };
        let name = a.value().attr("title").map(str::to_string).unwrap_or_else(|| text_of(a));
        if page.downloads.iter().any(|d| d.url == href) {
            continue;
        }
        page.downloads.push(Download {
            name,
            url: href.to_string(),
            date: r.select(&date).next().map(text_of).unwrap_or_default(),
            size: r.select(&size).next().map(text_of).unwrap_or_default(),
        });
    }
    page.downloads.sort_by(|a, b| b.date.cmp(&a.date));
    page
}

/// Enlaces de descarga de la propia web ("/downloads/<token>,,").
pub fn valid_download(url: &str) -> bool {
    url::Url::parse(url)
        .map(|u| u.scheme() == "https" && u.host_str() == Some("flingtrainer.com") && u.path().starts_with("/downloads/"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = r#"<html><head><meta property="og:title" content="Space Crab Trainer - FLiNG Trainer - PC Game Cheats and Mods" /></head>
<body><header><h1 class="site">FLiNG</h1></header>
<article><h1 class="entry-title">Space Crab Trainer</h1>
<div class="entry"><div class="ads"><ins>ad</ins><script>var x = "Num 9 – Nope";</script></div>
12 Options · Game Version: <svg><title>Steam</title></svg> v1.0-v1.4+ · Last Updated: 2026.03.01
<p><img src="x.png" /></p>
<h6>Options</h6>
<p style="padding-left: 40px;">Num 1 &#8211; Infinite Health<br />
Num 2 &#8211; Infinite Shells <span class='tooltipsall'><img src="/tooltip-icon.png" /></span><br />
Num . &#8211; Damage Multiplier<br />
Num / &#8211; Daytime +1 Hour</p>
<p style="padding-left: 40px;">Ctrl+Num 1 &#8211; Edit Money<br />
Ctrl + Num 2 &#8211; Teleport To Waypoint</p>
<p>Edit Crab Stats</p>
<p>Alt+Num 1 &#8211; Edit Claws<br />Alt+Shift+F5 &#8211; Freeze Tide<br />Num 1 &#8211; Duplicate</p>
<h6>Special Notes</h6>
<p>This game uses EasyAntiCheat (EAC) protection, please follow these instructions to disable EAC:</p>
<p>1 &#8211; Click the button.</p>
<table class="da-attachments-table"><tbody>
<tr class="zip"><td class="attachment-title"><a href="https://flingtrainer.com/downloads/OLD,," title="Space.Crab.v1.0.Plus.10.Trainer-FLiNG" class="attachment-link">x</a></td><td class="attachment-date">2025-01-02 10:00</td><td class="attachment-size">800 KB</td></tr>
<tr class="zip"><td class="attachment-title"><a href="https://flingtrainer.com/downloads/NEW,," title="Space.Crab.v1.0-v1.4.Plus.12.Trainer-FLiNG" class="attachment-link">x</a></td><td class="attachment-date">2026-03-01 12:00</td><td class="attachment-size">1.00 MB</td></tr>
<tr><td><a href="https://evil.example/downloads/x" class="attachment-link">x</a></td></tr>
</tbody></table>
<p>Num 8 &#8211; After the table</p>
</div></article></body></html>"#;

    #[test]
    fn reads_a_trainer_page() {
        let p = parse_page(PAGE, "https://flingtrainer.com/trainer/space-crab-trainer/");
        assert_eq!(p.title, "Space Crab");
        assert_eq!(p.game_version.as_deref(), Some("v1.0-v1.4+"));
        assert_eq!(p.updated.as_deref(), Some("2026.03.01"));
        let keys: Vec<_> = p.options.iter().map(|o| (o.keys.as_str(), o.label.as_str(), o.kind.as_str())).collect();
        assert_eq!(
            keys,
            vec![
                ("Num 1", "Infinite Health", "toggle"),
                ("Num 2", "Infinite Shells", "toggle"),
                ("Num .", "Damage Multiplier", "value"),
                ("Num /", "Daytime +1 Hour", "action"),
                ("Ctrl+Num 1", "Edit Money", "value"),
                ("Ctrl+Num 2", "Teleport To Waypoint", "action"),
                ("Alt+Num 1", "Edit Claws", "value"),
                ("Alt+Shift+F5", "Freeze Tide", "toggle"),
            ]
        );
        assert_eq!(p.options[0].group, None);
        assert_eq!(p.options[6].group.as_deref(), Some("Edit Crab Stats"));
        assert_eq!(p.anticheat.as_deref(), Some("EasyAntiCheat"));
        assert_eq!(p.notes.len(), 2);
        assert!(p.notes[0].starts_with("This game uses EasyAntiCheat"));
        assert_eq!(p.downloads.len(), 2);
        assert_eq!(p.downloads[0].name, "Space.Crab.v1.0-v1.4.Plus.12.Trainer-FLiNG");
        assert_eq!(p.downloads[0].size, "1.00 MB");
        assert!(p.options.iter().all(|o| o.label != "After the table" && o.label != "Nope"));
    }

    #[test]
    fn search_results() {
        let json = r#"[
          {"id":1,"slug":"space-crab-2-trainer","link":"https://flingtrainer.com/trainer/space-crab-2-trainer/","modified":"2026-01-01T10:00:00","title":{"rendered":"Space Crab 2 Trainer"}},
          {"id":2,"slug":"space-crab-trainer","link":"https://flingtrainer.com/trainer/space-crab-trainer/","modified":"2025-05-05T10:00:00","title":{"rendered":"Space Crab&#8217;s Trainer"}},
          {"id":3,"slug":"x","link":"https://flingtrainer.com/uncategorized/archive/","modified":"2019-01-01T00:00:00","title":{"rendered":"Archive"}}
        ]"#;
        let r = parse_search(json, "Space Crabs").unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].title, "Space Crab’s");
        assert_eq!(r[0].updated, "2025-05-05");
        assert!(r[0].score > r[1].score);
    }

    #[test]
    fn hotkeys_and_links() {
        assert_eq!(canon_hotkey("shift+ctrl+", "num 0"), "Ctrl+Shift+Num 0");
        assert_eq!(canon_hotkey("", "page up"), "Page Up");
        assert_eq!(canon_hotkey("Alt+", "f"), "Alt+F");
        assert!(valid_page("https://flingtrainer.com/trainer/elden-ring-trainer/"));
        assert!(!valid_page("http://flingtrainer.com/trainer/elden-ring-trainer/"));
        assert!(!valid_page("https://flingtrainer.com.evil.io/trainer/x/"));
        assert!(!valid_page("https://flingtrainer.com/trainer/"));
        assert!(valid_download("https://flingtrainer.com/downloads/abc,,"));
        assert!(!valid_download("https://flingtrainer.com/wp-admin/x"));
        assert_eq!(option_kind("Set Game Speed"), "value");
        assert_eq!(option_kind("Infinite Stamina"), "toggle");
        assert_eq!(option_kind("Fly Up"), "action");
        assert_eq!(option_kind("Infinite Health"), "toggle");
        assert_eq!(option_kind("Heal Player"), "action");
        assert_eq!(option_kind("Add 10 Skill Points"), "action");
        assert_eq!(option_kind("Rosary Multiplier"), "value");
    }

    /// Fichas reales guardadas en local (no van al repo):
    /// `EJG_FLING_SAMPLES=carpeta cargo test real_pages -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_pages() {
        let dir = std::env::var("EJG_FLING_SAMPLES").expect("EJG_FLING_SAMPLES");
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            if e.path().extension().and_then(|x| x.to_str()) != Some("html") {
                continue;
            }
            let html = std::fs::read_to_string(e.path()).unwrap();
            let p = parse_page(&html, "https://flingtrainer.com/trainer/x/");
            println!("── {} → «{}» {:?} {:?} · {} opciones · {} descargas · {:?}", e.path().display(), p.title, p.game_version, p.updated, p.options.len(), p.downloads.len(), p.anticheat);
            for o in &p.options {
                println!("   {:<14} {:<7} {} {}", o.keys, o.kind, o.label, o.group.as_deref().map(|g| format!("[{g}]")).unwrap_or_default());
            }
            for n in &p.notes {
                println!("   nota: {}", n.chars().take(90).collect::<String>());
            }
            assert!(!p.options.is_empty());
            assert!(!p.downloads.is_empty());
        }
    }
}
