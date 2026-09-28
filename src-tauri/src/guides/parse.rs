//! Lectura del HTML de las guías de la comunidad de Steam: la lista de un juego
//! y cada guía. El contenido (BBCode ya convertido por Steam) se pasa a bloques
//! propios (`Block`/`Span`): ningún tema recibe HTML de terceros.

use scraper::{ElementRef, Html, Node, Selector};
use serde::{Deserialize, Serialize};

/// Tope de bloques por guía (las más largas rondan los 4000).
const MAX_BLOCKS: usize = 8000;

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("selector válido")
}

fn text_of(e: ElementRef) -> String {
    squash(&e.text().collect::<String>())
}

/// Espacios seguidos → uno, sin los de los extremos.
fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// "1,963" / "1.963" → 1963.
fn number(s: &str) -> Option<u32> {
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// Estrellas de la imagen de valoración (`…/5-star.png`); None si aún no tiene.
fn stars_of(src: &str) -> Option<u8> {
    let i = src.find("-star")?;
    src[..i].chars().last()?.to_digit(10).map(|d| d as u8)
}

// ───────────────────────────── lista ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub title: String,
    pub desc: String,
    pub author: String,
    pub stars: Option<u8>,
    /// URL original de la miniatura (el módulo la pasa por ejg-media).
    pub preview: Option<String>,
    /// Idioma aproximado (ver `guess_lang`).
    pub lang: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListPage {
    pub items: Vec<Item>,
    pub total: u32,
    pub pages: u32,
}

pub fn list(html: &str) -> ListPage {
    let doc = Html::parse_document(html);
    let card = sel("a.workshopItemCollection");
    let (title, desc, author, preview, rating) = (
        sel(".workshopItemTitle"),
        sel(".workshopItemShortDesc"),
        sel(".workshopItemAuthorName"),
        sel("img.workshopItemPreviewImage"),
        sel("img.fileRating"),
    );
    let mut items = vec![];
    for a in doc.select(&card) {
        let Some(id) = a.value().attr("data-publishedfileid").filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())) else {
            continue;
        };
        let t = a.select(&title).next().map(text_of).unwrap_or_default();
        if t.is_empty() {
            continue;
        }
        let d = a.select(&desc).next().map(text_of).unwrap_or_default();
        let lang = guess_lang(&format!("{t} {d}")).to_string();
        items.push(Item {
            id: id.to_string(),
            title: t,
            desc: d,
            author: a.select(&author).next().map(text_of).unwrap_or_default(),
            stars: a.select(&rating).next().and_then(|i| i.value().attr("src")).and_then(stars_of),
            preview: a.select(&preview).next().and_then(|i| i.value().attr("src")).map(str::to_string),
            lang,
        });
    }
    // "Mostrando 1-30 de 1,963 aportaciones" / "Showing 1-30 of 1,963 entries".
    let info = sel(".workshopBrowsePagingInfo");
    let total = doc
        .select(&info)
        .next()
        .map(text_of)
        .and_then(|t| t.split_whitespace().filter_map(number).last())
        .unwrap_or(items.len() as u32);
    ListPage { pages: total.div_ceil(30).max(1), total, items }
}

// ───────────────────────────── idioma ─────────────────────────────

/// Idioma aproximado de un texto: por su escritura (cirílico, chino…) y, en
/// alfabeto latino, por etiquetas como «[ES]» y palabras frecuentes. "" si no se sabe.
pub fn guess_lang(text: &str) -> &'static str {
    let (mut latin, mut cyr, mut han, mut kana, mut hangul, mut thai, mut other) = (0, 0, 0, 0, 0, 0, 0);
    for c in text.chars() {
        match c as u32 {
            0x41..=0x5A | 0x61..=0x7A | 0xC0..=0x24F => latin += 1,
            0x400..=0x4FF => cyr += 1,
            0x3040..=0x30FF => kana += 1,
            0x4E00..=0x9FFF | 0x3400..=0x4DBF => han += 1,
            0xAC00..=0xD7AF | 0x1100..=0x11FF => hangul += 1,
            0xE00..=0xE7F => thai += 1,
            0x600..=0x6FF | 0x590..=0x5FF | 0x370..=0x3FF => other += 1,
            _ => {}
        }
    }
    let script = [(kana, "ja"), (hangul, "ko"), (han, "zh"), (cyr, "ru"), (thai, "th"), (other, "xx")]
        .into_iter()
        .max_by_key(|(n, _)| *n)
        .filter(|(n, _)| *n > 0 && (*n * 3 >= latin || *n >= 6));
    if let Some((_, lang)) = script {
        // El japonés mezcla kanji y kana: con algo de kana ya es japonés.
        if lang == "zh" && kana > 0 {
            return "ja";
        }
        // Letras que solo tiene el ucraniano.
        if lang == "ru" && text.contains(['і', 'ї', 'є', 'ґ', 'І', 'Ї', 'Є', 'Ґ']) {
            return "uk";
        }
        return lang;
    }
    let lower = text.to_lowercase();
    for (tag, lang) in [("[es]", "es"), ("(es)", "es"), ("[esp]", "es"), ("[pt", "pt"), ("(pt", "pt"), ("[en]", "en"), ("[eng]", "en"), ("[fr]", "fr"), ("[de]", "de"), ("[it]", "it"), ("[pl]", "pl"), ("[tr]", "tr")] {
        if lower.contains(tag) {
            return lang;
        }
    }
    const WORDS: &[(&str, &[&str])] = &[
        ("es", &["guía", "guia", "cómo", "como", "para", "los", "las", "del", "todos", "logros", "que", "una", "con", "trucos", "consejos", "juego"]),
        ("en", &["the", "guide", "how", "and", "to", "for", "all", "achievements", "your", "with", "tips", "you", "of", "get"]),
        ("pt", &["guia", "como", "para", "todas", "conquistas", "você", "dicas", "jogo", "não", "com", "uma", "os"]),
        ("fr", &["le", "la", "les", "des", "pour", "tous", "succès", "comment", "et", "une", "astuces"]),
        ("de", &["der", "die", "das", "und", "für", "alle", "errungenschaften", "wie", "mit", "ein", "tipps"]),
        ("it", &["il", "gli", "per", "tutti", "trofei", "obiettivi", "come", "della", "una", "consigli"]),
        ("pl", &["jak", "wszystkie", "osiągnięcia", "poradnik", "dla", "się", "gry"]),
        ("tr", &["için", "rehber", "nasıl", "tüm", "başarımlar", "ve", "bir"]),
    ];
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let mut best: (&str, usize) = ("", 0);
    for (lang, list) in WORDS {
        let n = words.iter().filter(|w| list.contains(w)).count();
        if n > best.1 {
            best = (lang, n);
        }
    }
    // «ñ», «¿», «¡» solo los usa el español.
    if lower.contains(['ñ', '¿', '¡']) {
        return "es";
    }
    best.0
}

// ───────────────────────────── guía ─────────────────────────────

/// Trozo de texto con su estilo.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub text: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub b: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub i: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub u: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub s: bool,
    /// Texto oculto hasta que se pulsa (spoiler).
    #[serde(default, skip_serializing_if = "is_false")]
    pub spoiler: bool,
    /// Enlace a una web (solo https).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    /// Enlace a otra guía de Steam: se abre dentro de ejGames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guide: Option<String>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

impl Span {
    fn same_style(&self, o: &Span) -> bool {
        self.b == o.b && self.i == o.i && self.u == o.u && self.s == o.s && self.spoiler == o.spoiler && self.href == o.href && self.guide == o.guide
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListItem {
    /// 0 = primer nivel; las listas dentro de listas, 1, 2…
    pub depth: u8,
    pub spans: Vec<Span>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Block {
    /// Título dentro de una sección (1 = el más grande).
    #[serde(rename = "h")]
    Heading { level: u8, spans: Vec<Span> },
    /// Párrafo. Los saltos de línea van como "\n" dentro del texto.
    #[serde(rename = "p")]
    Para { spans: Vec<Span> },
    #[serde(rename = "list")]
    List { ordered: bool, items: Vec<ListItem> },
    #[serde(rename = "quote")]
    Quote { spans: Vec<Span> },
    #[serde(rename = "code")]
    Code { text: String },
    /// `thumb`: el autor la puso pequeña (a un lado del texto).
    #[serde(rename = "img")]
    Image {
        src: String,
        #[serde(default, skip_serializing_if = "is_false")]
        thumb: bool,
    },
    /// Primera fila de cabecera si `head`.
    #[serde(rename = "table")]
    Table { head: bool, rows: Vec<Vec<Vec<Span>>> },
    /// Vídeo de YouTube: se abre en el navegador.
    #[serde(rename = "video")]
    Video { id: String, url: String, thumb: String },
    #[serde(rename = "hr")]
    Rule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub title: String,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    pub id: String,
    pub appid: Option<i64>,
    pub title: String,
    pub authors: Vec<String>,
    pub stars: Option<u8>,
    pub ratings: Option<u32>,
    /// Fechas tal y como las enseña Steam ("22 FEB 2022 a las 7:21").
    pub published: Option<String>,
    pub updated: Option<String>,
    pub preview: Option<String>,
    pub intro: Vec<Block>,
    pub sections: Vec<Section>,
    pub lang: String,
}

/// Destino real de un enlace de Steam (`linkfilter/?u=…` o `?url=…`). Solo https;
/// los http se suben a https.
pub fn real_href(href: &str) -> Option<String> {
    let href = href.trim();
    let url = url::Url::parse(href).ok()?;
    let target = if url.host_str() == Some("steamcommunity.com") && url.path().starts_with("/linkfilter") {
        url.query_pairs().find(|(k, _)| k == "u" || k == "url").map(|(_, v)| v.into_owned())?
    } else {
        href.to_string()
    };
    let target = match target.strip_prefix("http://") {
        Some(rest) => format!("https://{rest}"),
        None => target,
    };
    let parsed = url::Url::parse(&target).ok()?;
    (parsed.scheme() == "https" && parsed.host_str().is_some()).then(|| parsed.to_string())
}

/// Id de otra guía si el enlace apunta a una.
pub fn guide_link(href: &str) -> Option<String> {
    let url = url::Url::parse(href).ok()?;
    let host = url.host_str()?;
    if !(host == "steamcommunity.com" || host.ends_with(".steamcommunity.com")) || !url.path().starts_with("/sharedfiles/filedetails") {
        return None;
    }
    url.query_pairs().find(|(k, _)| k == "id").map(|(_, v)| v.into_owned()).filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
}

#[derive(Clone, Default)]
struct Style {
    b: bool,
    i: bool,
    u: bool,
    s: bool,
    spoiler: bool,
    href: Option<String>,
    guide: Option<String>,
}

/// Construye bloques a partir de los nodos de una sección.
#[derive(Default)]
struct Builder {
    blocks: Vec<Block>,
    inline: Vec<Span>,
    /// `<br>` seguidos (dos = párrafo nuevo).
    breaks: u8,
}

fn has_class(e: &scraper::node::Element, c: &str) -> bool {
    e.classes().any(|x| x == c)
}

impl Builder {
    fn push_text(&mut self, text: &str, st: &Style) {
        if text.is_empty() {
            return;
        }
        // Espacios del HTML: seguidos cuentan como uno.
        let mut t = String::with_capacity(text.len());
        let mut last_space = self.inline.last().map(|s| s.text.ends_with([' ', '\n'])).unwrap_or(true);
        for c in text.chars() {
            if c.is_whitespace() {
                if !last_space {
                    t.push(' ');
                    last_space = true;
                }
            } else {
                t.push(c);
                last_space = false;
            }
        }
        if t.is_empty() {
            return;
        }
        if self.breaks > 0 {
            self.push_raw("\n", st);
            self.breaks = 0;
        }
        self.push_raw(&t, st);
    }

    fn push_raw(&mut self, t: &str, st: &Style) {
        let span = Span {
            text: t.to_string(),
            b: st.b,
            i: st.i,
            u: st.u,
            s: st.s,
            spoiler: st.spoiler,
            href: st.href.clone(),
            guide: st.guide.clone(),
        };
        match self.inline.last_mut() {
            Some(last) if last.same_style(&span) => last.text.push_str(t),
            _ => self.inline.push(span),
        }
    }

    fn line_break(&mut self) {
        self.breaks += 1;
        if self.breaks >= 2 {
            self.flush();
        }
    }

    /// Cierra el párrafo en curso.
    fn flush(&mut self) {
        self.breaks = 0;
        let spans = trim_spans(std::mem::take(&mut self.inline));
        if !spans.is_empty() {
            self.push_block(Block::Para { spans });
        }
    }

    fn push_block(&mut self, b: Block) {
        if self.blocks.len() < MAX_BLOCKS {
            self.blocks.push(b);
        }
    }

    fn walk_children(&mut self, e: ElementRef, st: &Style) {
        for child in e.children() {
            self.walk(child, st);
        }
    }

    fn walk(&mut self, node: ego_tree::NodeRef<Node>, st: &Style) {
        match node.value() {
            Node::Text(t) => self.push_text(t, st),
            Node::Element(el) => {
                let Some(e) = ElementRef::wrap(node) else { return };
                let name = el.name();
                match name {
                    "script" | "style" | "noscript" | "input" | "form" => {}
                    "br" => self.line_break(),
                    "b" | "strong" => self.walk_children(e, &Style { b: true, ..st.clone() }),
                    "i" | "em" => self.walk_children(e, &Style { i: true, ..st.clone() }),
                    "u" => self.walk_children(e, &Style { u: true, ..st.clone() }),
                    "s" | "strike" | "del" => self.walk_children(e, &Style { s: true, ..st.clone() }),
                    "hr" => {
                        self.flush();
                        self.push_block(Block::Rule);
                    }
                    "img" => {
                        if let Some(src) = el.attr("src").filter(|s| s.starts_with("https://")) {
                            self.flush();
                            let thumb = has_class(el, "sizeThumb");
                            self.push_block(Block::Image { src: src.to_string(), thumb });
                        }
                    }
                    // Imágenes con su versión grande: basta con la imagen.
                    "a" if has_class(el, "modalContentLink") => self.walk_children(e, st),
                    "a" => {
                        let href = el.attr("href").and_then(real_href);
                        let guide = href.as_deref().and_then(guide_link);
                        let style = Style { href: if guide.is_some() { None } else { href }, guide, ..st.clone() };
                        self.walk_children(e, &style);
                    }
                    "span" if has_class(el, "bb_strike") => self.walk_children(e, &Style { s: true, ..st.clone() }),
                    "span" if has_class(el, "bb_spoiler") => self.walk_children(e, &Style { spoiler: true, ..st.clone() }),
                    // «[www.web.com]» que Steam añade tras cada enlace.
                    "span" if has_class(el, "bb_link_host") => {}
                    "ul" | "ol" => {
                        self.flush();
                        let mut items = vec![];
                        list_items(e, 0, st, &mut items);
                        if !items.is_empty() {
                            self.push_block(Block::List { ordered: name == "ol", items });
                        }
                    }
                    "blockquote" => {
                        self.flush();
                        let spans = inline_of(e, st);
                        if !spans.is_empty() {
                            self.push_block(Block::Quote { spans });
                        }
                    }
                    "div" | "p" | "center" | "section" | "picture" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        let level = match name {
                            "h1" => Some(1),
                            "h2" => Some(2),
                            "h3" | "h4" | "h5" | "h6" => Some(3),
                            _ if has_class(el, "bb_h1") => Some(1),
                            _ if has_class(el, "bb_h2") => Some(2),
                            _ if has_class(el, "bb_h3") => Some(3),
                            _ => None,
                        };
                        if let Some(level) = level {
                            self.flush();
                            let spans = inline_of(e, st);
                            if !spans.is_empty() {
                                self.push_block(Block::Heading { level, spans });
                            }
                        } else if has_class(el, "bb_table") {
                            self.flush();
                            if let Some(t) = table_of(e, st) {
                                self.push_block(t);
                            }
                        } else if has_class(el, "sharedFilePreviewYouTubeVideo") {
                            self.flush();
                            if let Some(id) = el.attr("id").filter(|id| id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) {
                                self.push_block(Block::Video {
                                    id: id.to_string(),
                                    url: format!("https://www.youtube.com/watch?v={id}"),
                                    thumb: format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"),
                                });
                            }
                        } else if has_class(el, "bb_code") && !e.descendants().any(|d| d.value().as_element().is_some_and(|x| x.name() == "img")) {
                            // [code] de verdad (algunos autores lo usan como marco de imágenes).
                            self.flush();
                            let text: String = code_text(e);
                            if !text.trim().is_empty() {
                                self.push_block(Block::Code { text: text.trim_matches('\n').to_string() });
                            }
                        } else {
                            // Cualquier otro bloque: corta el párrafo antes y después.
                            self.flush();
                            self.walk_children(e, st);
                            self.flush();
                        }
                    }
                    _ => self.walk_children(e, st),
                }
            }
            _ => {}
        }
    }
}

/// Texto de un bloque de código con sus saltos de línea.
fn code_text(e: ElementRef) -> String {
    let mut out = String::new();
    for n in e.descendants() {
        match n.value() {
            Node::Text(t) => out.push_str(t),
            Node::Element(el) if el.name() == "br" => out.push('\n'),
            _ => {}
        }
    }
    out
}

/// Quita espacios y saltos de los extremos de una línea de spans.
fn trim_spans(mut spans: Vec<Span>) -> Vec<Span> {
    while let Some(first) = spans.first_mut() {
        let t = first.text.trim_start().to_string();
        if t.is_empty() {
            spans.remove(0);
        } else {
            first.text = t;
            break;
        }
    }
    while let Some(last) = spans.last_mut() {
        let t = last.text.trim_end().to_string();
        if t.is_empty() {
            spans.pop();
        } else {
            last.text = t;
            break;
        }
    }
    spans
}

/// Texto con estilo de un elemento (títulos, celdas, citas).
fn inline_of(e: ElementRef, st: &Style) -> Vec<Span> {
    let mut b = Builder::default();
    b.walk_children(e, st);
    let mut out = std::mem::take(&mut b.inline);
    // Si dentro había bloques (raro en un título), su texto también cuenta.
    for blk in b.blocks {
        if let Block::Para { spans } | Block::Heading { spans, .. } | Block::Quote { spans } = blk {
            if !out.is_empty() {
                out.push(Span { text: "\n".into(), ..Default::default() });
            }
            out.extend(spans);
        }
    }
    trim_spans(out)
}

fn list_items(list: ElementRef, depth: u8, st: &Style, out: &mut Vec<ListItem>) {
    for li in list.children().filter_map(ElementRef::wrap).filter(|c| c.value().name() == "li") {
        // El texto del elemento, sin sus sublistas (que van detrás, un nivel más adentro).
        let mut b = Builder::default();
        let mut subs = vec![];
        for child in li.children() {
            match ElementRef::wrap(child) {
                Some(c) if matches!(c.value().name(), "ul" | "ol") => subs.push(c),
                _ => b.walk(child, st),
            }
        }
        b.flush();
        let mut spans: Vec<Span> = vec![];
        for blk in b.blocks {
            if let Block::Para { spans: s } | Block::Heading { spans: s, .. } = blk {
                if !spans.is_empty() {
                    spans.push(Span { text: "\n".into(), ..Default::default() });
                }
                spans.extend(s);
            }
        }
        let spans = trim_spans(spans);
        if !spans.is_empty() && out.len() < 2000 {
            out.push(ListItem { depth, spans });
        }
        for s in subs {
            list_items(s, depth.saturating_add(1).min(4), st, out);
        }
    }
}

fn table_of(t: ElementRef, st: &Style) -> Option<Block> {
    let mut rows: Vec<Vec<Vec<Span>>> = vec![];
    let mut head = false;
    for (i, tr) in t.children().filter_map(ElementRef::wrap).filter(|c| has_class(c.value(), "bb_table_tr")).enumerate() {
        let mut cells = vec![];
        let mut all_th = true;
        for cell in tr.children().filter_map(ElementRef::wrap) {
            let el = cell.value();
            let th = has_class(el, "bb_table_th");
            if !(th || has_class(el, "bb_table_td")) {
                continue;
            }
            all_th &= th;
            cells.push(inline_of(cell, st));
        }
        if i == 0 && all_th && !cells.is_empty() {
            head = true;
        }
        if !cells.is_empty() {
            rows.push(cells);
        }
        if rows.len() >= 500 {
            break;
        }
    }
    (!rows.is_empty()).then_some(Block::Table { head, rows })
}

/// Bloques de un fragmento (la descripción de una sección o la de arriba).
fn blocks_of(e: ElementRef) -> Vec<Block> {
    let mut b = Builder::default();
    b.walk_children(e, &Style::default());
    b.flush();
    b.blocks
}

pub fn guide(id: &str, html: &str) -> Option<Guide> {
    let doc = Html::parse_document(html);
    let title = doc.select(&sel(".workshopItemTitle")).next().map(text_of).filter(|t| !t.is_empty())?;
    let sections_sel = sel(".guide.subSections .subSection");
    let (stitle, sdesc) = (sel(".subSectionTitle"), sel(".subSectionDesc"));
    let mut sections = vec![];
    for s in doc.select(&sections_sel) {
        let desc = s.select(&sdesc).next();
        sections.push(Section {
            id: s.value().attr("id").unwrap_or_default().to_string(),
            title: s.select(&stitle).next().map(text_of).unwrap_or_default(),
            blocks: desc.map(blocks_of).unwrap_or_default(),
        });
    }
    let intro = doc.select(&sel(".guideTopDescription")).next().map(blocks_of).unwrap_or_default();
    // «Por Fulano, Mengano» / «By …»: sin la primera palabra ni el «y 2
    // colaboradores» del final.
    let authors = doc
        .select(&sel(".guideAuthors"))
        .next()
        .map(text_of)
        .map(|t| {
            let rest = t.split_once(' ').map(|(_, r)| r).unwrap_or("");
            let words: Vec<&str> = rest.split(' ').collect();
            let n = words.len();
            let rest = if n >= 3 && matches!(words[n - 3], "y" | "and") && words[n - 2].bytes().all(|b| b.is_ascii_digit()) {
                words[..n - 3].join(" ")
            } else {
                rest.to_string()
            };
            rest.split(',').map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect()
        })
        .unwrap_or_default();
    let stars = doc.select(&sel(".fileRatingDetails img")).next().and_then(|i| i.value().attr("src")).and_then(stars_of);
    let ratings = doc.select(&sel(".numRatings")).next().map(text_of).and_then(|t| number(&t));
    let dates: Vec<String> = doc.select(&sel(".detailsStatsContainerRight .detailsStatRight")).map(text_of).collect();
    // Tamaño, publicado y (si se actualizó) actualizado.
    let (published, updated) = match dates.len() {
        n if n >= 3 => (Some(dates[1].clone()), Some(dates[2].clone())),
        2 => (Some(dates[1].clone()), None),
        _ => (None, None),
    };
    let preview = doc.select(&sel(".guidePreviewImage img")).next().and_then(|i| i.value().attr("src")).map(str::to_string);
    let appid = doc
        .select(&sel("a.workshopItemCollection, [data-appid]"))
        .next()
        .and_then(|e| e.value().attr("data-appid"))
        .and_then(|a| a.parse().ok());
    let sample: String = std::iter::once(title.clone())
        .chain(sections.iter().take(3).map(|s| s.title.clone()))
        .chain(sections.iter().flat_map(|s| &s.blocks).take(12).filter_map(|b| match b {
            Block::Para { spans } | Block::Heading { spans, .. } => Some(spans.iter().map(|s| s.text.as_str()).collect::<String>()),
            _ => None,
        }))
        .collect::<Vec<_>>()
        .join(" ");
    Some(Guide {
        id: id.to_string(),
        appid,
        lang: guess_lang(&sample).to_string(),
        title,
        authors,
        stars,
        ratings,
        published,
        updated,
        preview,
        intro,
        sections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"<html><body>
      <div class="workshopBrowsePagingInfo">Mostrando 1-30 de 1,963 aportaciones</div>
      <div class="workshopItemCollectionContainer">
        <a class="workshopItemCollection ugc" href="https://steamcommunity.com/sharedfiles/filedetails/?id=111" data-appid="10" data-publishedfileid="111">
          <div class="workshopItem"><div class="workshopItemPreviewHolder"><img class="workshopItemPreviewImage" src="https://images.steamusercontent.com/ugc/1/A/?imw=200"></div></div>
          <div class="workshopItemDetails">
            <img class="fileRating" src="https://community.fastly.steamstatic.com/public/images/sharedfiles/4-star.png?v=2" />
            <div class="workshopItemTitle">
              Guía de logros al 100 %   </div>
            <div class="workshopItemAuthorLine">por&nbsp;<span class="workshopItemAuthorName">Pepa</span></div>
            <div class="workshopItemShortDesc">Todos los logros, paso a paso.</div>
          </div>
        </a>
      </div>
      <a class="workshopItemCollection ugc" data-publishedfileid="222"><div class="workshopItemTitle">Все квесты</div>
        <img class="fileRating" src="https://x/not-yet.png"></a>
      <a class="workshopItemCollection ugc" data-publishedfileid="javascript:1"><div class="workshopItemTitle">x</div></a>
    </body></html>"#;

    #[test]
    fn parses_the_list() {
        let p = list(LIST);
        assert_eq!((p.total, p.pages), (1963, 66));
        assert_eq!(p.items.len(), 2);
        let a = &p.items[0];
        assert_eq!((a.id.as_str(), a.title.as_str(), a.author.as_str(), a.stars), ("111", "Guía de logros al 100 %", "Pepa", Some(4)));
        assert_eq!(a.desc, "Todos los logros, paso a paso.");
        assert_eq!(a.lang, "es");
        assert!(a.preview.as_deref().unwrap().starts_with("https://images.steamusercontent.com/"));
        assert_eq!((p.items[1].stars, p.items[1].lang.as_str()), (None, "ru"));
    }

    #[test]
    fn guesses_languages() {
        assert_eq!(guess_lang("Elden Ring 100% Achievement Guide"), "en");
        assert_eq!(guess_lang("[ES] Guía de Logros 100% / Regalos para NPC"), "es");
        assert_eq!(guess_lang("ID de todos os items 1.6 [PT-BR]"), "pt");
        assert_eq!(guess_lang("一篇指南，星露谷尽在掌握！"), "zh");
        assert_eq!(guess_lang("エルデンリング 攻略"), "ja");
        assert_eq!(guess_lang("Все квесты (+DLC)"), "ru");
        assert_eq!(guess_lang("Українська локалізація Hollow Knight"), "uk");
        assert_eq!(guess_lang("¿Dónde está el herrero?"), "es");
        assert_eq!(guess_lang("12345"), "");
    }

    #[test]
    fn unwraps_links() {
        assert_eq!(real_href("https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fsmapi.io%2F").as_deref(), Some("https://smapi.io/"));
        assert_eq!(real_href("https://steamcommunity.com/linkfilter/?u=http%3A%2F%2Fdiscord.gg%2F2AEr8sH").as_deref(), Some("https://discord.gg/2AEr8sH"));
        assert_eq!(real_href("javascript:alert(1)"), None);
        assert_eq!(real_href("https://steamcommunity.com/linkfilter/?u=javascript%3Aalert(1)"), None);
        assert_eq!(guide_link("https://steamcommunity.com/sharedfiles/filedetails/?id=2785187510").as_deref(), Some("2785187510"));
        assert_eq!(guide_link("https://evil.com/sharedfiles/filedetails/?id=1"), None);
    }

    const GUIDE: &str = r#"<html><body>
      <div class="workshopItemTitle">Guía completa</div>
      <div class="guideAuthors">Por Pepa, Juan y 2 colaboradores</div>
      <div class="ratingSection"><div class="fileRatingDetails"><img src="https://x/5-star_large.png?v=2" /></div><div class="numRatings">1,511 valoraciones</div></div>
      <div class="guideTopDescription">Resumen <b>corto</b>.</div>
      <div class="detailsStatsContainerRight"><div class="detailsStatRight">1.2 MB</div><div class="detailsStatRight">22 FEB 2022 a las 7:21</div><div class="detailsStatRight">1 MAR 2023 a las 9:00</div></div>
      <div class="guide subSections">
        <div class="subSection detailBox" id="5277033">
          <div class="subSectionTitle">  Introducción  </div>
          <div class="subSectionDesc">
            <div class="bb_h1">Resumen</div>Primera línea<br>segunda <b>en negrita</b> y <i>cursiva</i><br><br>Otro párrafo con
            <a class="bb_link" href="https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fexample.com%2F" target="_blank">un enlace</a><span class="bb_link_host">[example.com]</span>
            y <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=42">otra guía</a>.
            <ul class="bb_ul"><li>Uno<ul class="bb_ul"><li>Uno.a</li></ul></li><li><span class="bb_spoiler"><span>Secreto</span></span></li></ul>
            <a href="https://images.steamusercontent.com/ugc/1/B/" class="modalContentLink"><img src="https://images.steamusercontent.com/ugc/1/B/" class="sharedFilePreviewImage sizeThumb floatLeft"></a>
            <div class="bb_table"><div class="bb_table_tr"><div class="bb_table_th">#</div><div class="bb_table_th">Arma</div></div>
              <div class="bb_table_tr"><div class="bb_table_td">1</div><div class="bb_table_td"><b>Espadón</b></div></div></div>
            <div class="bb_code">let x = 1;<br>x += 1;</div>
            <div class="sharedFilePreviewYouTubeVideo sizeFull" id="cELyn3Y0rzE"></div>
            <hr>
            <img src="javascript:alert(1)" onerror="alert(1)"><script>alert(1)</script>
          </div>
        </div>
        <div class="subSection detailBox" id="2"><div class="subSectionTitle">Vacía</div><div class="subSectionDesc"></div></div>
      </div>
    </body></html>"#;

    /// Guías reales guardadas en una carpeta (no van al repo):
    /// `EJG_GUIDE_SAMPLES=<carpeta> cargo test real_guides -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_guides() {
        let Ok(dir) = std::env::var("EJG_GUIDE_SAMPLES") else { return };
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let html = std::fs::read_to_string(e.path()).unwrap();
            if name.starts_with("list_") {
                let p = list(&html);
                println!("{name}: {} guías de {} ({} págs.) {:?}", p.items.len(), p.total, p.pages, p.items.iter().take(6).map(|i| (&i.lang, &i.title)).collect::<Vec<_>>());
            } else if name.starts_with("g_") {
                let t = std::time::Instant::now();
                let g = guide("1", &html).expect(&name);
                let blocks: usize = g.sections.iter().map(|s| s.blocks.len()).sum();
                let imgs = g.sections.iter().flat_map(|s| &s.blocks).filter(|b| matches!(b, Block::Image { .. })).count();
                let tables = g.sections.iter().flat_map(|s| &s.blocks).filter(|b| matches!(b, Block::Table { .. })).count();
                let json = serde_json::to_string(&g).unwrap().len();
                println!(
                    "{name}: «{}» [{}] de {:?}, {}★ {:?} val., {} secciones, {blocks} bloques, {imgs} imágenes, {tables} tablas, {} KB JSON, {:?}",
                    g.title, g.lang, g.authors, g.stars.unwrap_or(0), g.ratings, g.sections.len(), json / 1024, t.elapsed()
                );
                assert!(!g.sections.is_empty());
            }
        }
    }

    #[test]
    fn parses_a_guide() {
        let g = guide("9", GUIDE).unwrap();
        assert_eq!(g.title, "Guía completa");
        assert_eq!(g.authors, vec!["Pepa", "Juan"]);
        assert_eq!((g.stars, g.ratings), (Some(5), Some(1511)));
        assert_eq!(g.published.as_deref(), Some("22 FEB 2022 a las 7:21"));
        assert_eq!(g.updated.as_deref(), Some("1 MAR 2023 a las 9:00"));
        assert_eq!(g.lang, "es");
        assert_eq!(g.sections.len(), 2);
        let s = &g.sections[0];
        assert_eq!((s.id.as_str(), s.title.as_str()), ("5277033", "Introducción"));
        let b = &s.blocks;
        assert!(matches!(&b[0], Block::Heading { level: 1, spans } if spans[0].text == "Resumen"));
        let Block::Para { spans } = &b[1] else { panic!("{:?}", b[1]) };
        let text: String = spans.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(text, "Primera línea\nsegunda en negrita y cursiva");
        assert!(spans.iter().any(|s| s.b && s.text == "en negrita"));
        let Block::Para { spans } = &b[2] else { panic!("{:?}", b[2]) };
        assert!(spans.iter().any(|s| s.href.as_deref() == Some("https://example.com/") && s.text == "un enlace"));
        assert!(spans.iter().any(|s| s.guide.as_deref() == Some("42")));
        assert!(!spans.iter().any(|s| s.text.contains("[example.com]")));
        let Block::List { ordered: false, items } = &b[3] else { panic!("{:?}", b[3]) };
        assert_eq!(items.iter().map(|i| (i.depth, i.spans[0].text.as_str())).collect::<Vec<_>>(), vec![(0, "Uno"), (1, "Uno.a"), (0, "Secreto")]);
        assert!(items[2].spans[0].spoiler);
        assert!(matches!(&b[4], Block::Image { thumb: true, src } if src == "https://images.steamusercontent.com/ugc/1/B/"));
        let Block::Table { head: true, rows } = &b[5] else { panic!("{:?}", b[5]) };
        assert_eq!(rows.len(), 2);
        assert!(rows[1][1][0].b);
        assert!(matches!(&b[6], Block::Code { text } if text == "let x = 1;\nx += 1;"));
        assert!(matches!(&b[7], Block::Video { id, .. } if id == "cELyn3Y0rzE"));
        assert_eq!(b[8], Block::Rule);
        // Nada de javascript: ni imágenes que no sean https ni scripts.
        assert_eq!(b.len(), 9, "{:?}", &b[9..]);
        assert!(g.sections[1].blocks.is_empty());
        assert!(matches!(&g.intro[0], Block::Para { spans } if spans.iter().any(|s| s.b && s.text == "corto")));
    }
}
