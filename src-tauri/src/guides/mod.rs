//! Guías de la comunidad de Steam para los juegos de la biblioteca (por el
//! appid del juego: el de su emulador o el de sus metadatos). Se leen del HTML
//! público de steamcommunity.com, porque la API sin clave no las da, y se
//! entregan como bloques (`parse::Block`), nunca como HTML. Las imágenes pasan
//! por ejg-media como las de Explorar.
//!
//! Steam no filtra las guías por idioma sin sesión: se adivina por el texto y,
//! salvo que se pidan todas, solo quedan las de español e inglés.

pub mod parse;

use crate::db::repo;
use crate::explore::images;
use crate::state::AppState;
use parse::{Block, Guide, Item, ListPage};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const TTL_LIST: i64 = 6 * 3600;
const TTL_GUIDE: i64 = 7 * 86400;
/// Sin red vale cualquier copia guardada de estos dos meses.
const TTL_STALE: i64 = 60 * 86400;
/// Las guías guardadas no caducan (se leen sin conexión).
const TTL_PINNED: i64 = 10 * 365 * 86400;

pub const SORTS: [&str; 3] = ["toprated", "trend", "mostrecent"];

/// Categorías de guía de Steam (el valor que entiende su filtro).
pub const CATEGORIES: [&str; 17] = [
    "Achievements",
    "Characters",
    "Classes",
    "Co-op",
    "Crafting",
    "Game Modes",
    "Gameplay Basics",
    "Loot",
    "Maps or Levels",
    "Modding or Configuration",
    "Multiplayer",
    "Secrets",
    "Story or Lore",
    "Trading",
    "Walkthroughs",
    "Weapons",
    "Workshop",
];

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ListQuery {
    pub page: u32,
    /// toprated | trend | mostrecent
    pub sort: String,
    pub query: String,
    /// Una de `CATEGORIES` ("" = todas).
    pub category: String,
    /// Todas las guías, no solo las de español e inglés.
    pub all_languages: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GuideList {
    /// Sin appid no hay guías (el juego no se ha identificado en Steam).
    pub appid: Option<i64>,
    pub items: Vec<Item>,
    /// Última página de Steam leída (con el filtro de idioma pueden ser varias).
    pub page: u32,
    pub pages: u32,
    pub total: u32,
    /// Página que pedir para seguir.
    pub next: Option<u32>,
    /// Filtradas por idioma: `total` cuenta todas.
    pub filtered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub section: u32,
    /// 0..1 dentro de la sección.
    pub scroll: f64,
    pub read_at: i64,
}

/// Una guía con lo que es del perfil (guardada, por dónde iba).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideView {
    #[serde(flatten)]
    pub guide: Guide,
    pub url: String,
    pub pinned: bool,
    pub progress: Option<Progress>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub id: String,
    pub title: String,
    pub author: String,
    pub preview: Option<String>,
    pub pinned: bool,
    pub progress: Option<Progress>,
}

/// Guías guardadas y leídas hace poco de un juego (para el overlay y la ficha).
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub pinned: Vec<ShelfItem>,
    pub recent: Vec<ShelfItem>,
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit())
}

pub fn page_url(id: &str) -> String {
    format!("https://steamcommunity.com/sharedfiles/filedetails/?id={id}")
}

fn language(st: &AppState) -> String {
    let l = st.settings.get().language;
    if l.chars().all(|c| c.is_ascii_lowercase()) && !l.is_empty() { l } else { "spanish".into() }
}

async fn fetch(st: &AppState, url: &str) -> anyhow::Result<String> {
    let r = st
        .http
        .get(url)
        .header(reqwest::header::USER_AGENT, UA)
        .header(reqwest::header::ACCEPT_LANGUAGE, "es-ES,es;q=0.9,en;q=0.8")
        .send()
        .await?;
    if !r.status().is_success() {
        anyhow::bail!("Steam respondió {}", r.status());
    }
    Ok(r.text().await?)
}

fn cache_read<T: for<'de> Deserialize<'de>>(st: &AppState, provider: &str, key: &str, ttl: i64) -> Option<T> {
    st.db.with(|c| repo::cache_get(c, provider, key, ttl)).ok().flatten().and_then(|j| serde_json::from_str(&j).ok())
}

fn cache_write<T: Serialize>(st: &AppState, provider: &str, key: &str, v: &T) {
    if let Ok(j) = serde_json::to_string(v) {
        let _ = st.db.with(|c| repo::cache_put(c, provider, key, &j));
    }
}

/// Mensaje de error de red entendible.
fn net_error(e: anyhow::Error) -> anyhow::Error {
    let text = format!("{e:#}");
    tracing::warn!("guías: {text}");
    if text.contains("dns") || text.contains("connect") || text.contains("timed out") || text.contains("operation timed out") {
        anyhow::anyhow!("No se pudo conectar con la comunidad de Steam. Revisa tu conexión.")
    } else {
        anyhow::anyhow!("No se pudieron cargar las guías de Steam ({text})")
    }
}

async fn list_page(st: &AppState, appid: i64, sort: &str, q: &ListQuery, page: u32) -> anyhow::Result<ListPage> {
    let mut url = url::Url::parse(&format!("https://steamcommunity.com/app/{appid}/guides/"))?;
    {
        let mut qp = url.query_pairs_mut();
        qp.append_pair("browsefilter", sort);
        if sort == "trend" {
            qp.append_pair("days", "90");
        }
        qp.append_pair("l", &language(st));
        qp.append_pair("p", &page.to_string());
        if !q.query.trim().is_empty() {
            qp.append_pair("searchText", q.query.trim());
        }
        if CATEGORIES.contains(&q.category.as_str()) {
            qp.append_pair("requiredtags[]", &q.category);
        }
    }
    let key = url.to_string();
    if let Some(p) = cache_read(st, "guides_list", &key, TTL_LIST) {
        return Ok(p);
    }
    match fetch(st, url.as_str()).await {
        Ok(html) => {
            let p = tauri::async_runtime::spawn_blocking(move || parse::list(&html)).await?;
            cache_write(st, "guides_list", &key, &p);
            Ok(p)
        }
        Err(e) => cache_read(st, "guides_list", &key, TTL_STALE).ok_or_else(|| net_error(e)),
    }
}

/// Idioma que se enseña sin pedir todos: español, inglés y los que no se sabe.
fn common_lang(lang: &str) -> bool {
    matches!(lang, "es" | "en" | "")
}

/// Appid de Steam de un juego de la biblioteca.
pub async fn appid_for(st: &Arc<AppState>, game_id: i64) -> anyhow::Result<Option<i64>> {
    let st2 = st.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let g = st2.db.with(|c| repo::get_game(c, game_id)).ok()?;
        crate::achievements::appid_of(&st2, &g)
    })
    .await?)
}

pub async fn list(st: &Arc<AppState>, game_id: i64, q: ListQuery) -> anyhow::Result<GuideList> {
    let Some(appid) = appid_for(st, game_id).await? else { return Ok(GuideList::default()) };
    let sort = SORTS.iter().find(|s| **s == q.sort).copied().unwrap_or("toprated");
    let mut page = q.page.max(1);
    let (mut items, mut pages, mut total) = (vec![], 1, 0);
    // Con el filtro de idioma, una página de Steam puede quedarse corta: se
    // leen hasta tres seguidas para llegar a una docena.
    for n in 0..3 {
        let lp = match list_page(st, appid, sort, &q, page).await {
            Ok(p) => p,
            Err(e) if n == 0 => return Err(e),
            Err(_) => break,
        };
        pages = lp.pages;
        total = lp.total;
        items.extend(lp.items.into_iter().filter(|i| q.all_languages || common_lang(&i.lang)));
        if q.all_languages || items.len() >= 12 || page >= pages {
            break;
        }
        page += 1;
    }
    for i in &mut items {
        i.preview = i.preview.as_deref().map(|u| sized(u, 320)).and_then(|u| images::proxy(&u));
    }
    Ok(GuideList { appid: Some(appid), items, page, pages, total, next: (page < pages).then_some(page + 1), filtered: !q.all_languages })
}

/// Las imágenes de Steam se piden ya reducidas (algunas guías traen fotos 4K).
fn sized(url: &str, width: u32) -> String {
    let Ok(mut u) = url::Url::parse(url) else { return url.to_string() };
    if u.host_str() != Some("images.steamusercontent.com") {
        return url.to_string();
    }
    u.set_query(Some(&format!("imw={width}&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=false")));
    u.to_string()
}

/// Cambia las URL de las imágenes por las de ejg-media (y quita las que no se pueden servir).
fn proxy_blocks(blocks: &mut Vec<Block>) {
    blocks.retain_mut(|b| match b {
        Block::Image { src, thumb } => match images::proxy(&sized(src, if *thumb { 480 } else { 1280 })) {
            Some(p) => {
                *src = p;
                true
            }
            None => false,
        },
        Block::Video { thumb, .. } => {
            *thumb = images::proxy(thumb).unwrap_or_default();
            true
        }
        _ => true,
    });
}

fn profile(st: &AppState) -> Option<i64> {
    *st.profile.read()
}

fn progress_of(st: &AppState, profile: i64, id: &str) -> Option<Progress> {
    st.db
        .with(|c| {
            c.query_row(
                "SELECT section, scroll, read_at FROM guide_progress WHERE profile_id = ?1 AND guide_id = ?2",
                params![profile, id],
                |r| Ok(Progress { section: r.get(0)?, scroll: r.get(1)?, read_at: r.get(2)? }),
            )
            .optional()
        })
        .ok()
        .flatten()
}

fn is_pinned(st: &AppState, profile: Option<i64>, id: &str) -> bool {
    let Some(p) = profile else { return false };
    st.db
        .with(|c| c.query_row("SELECT 1 FROM guide_pins WHERE profile_id = ?1 AND guide_id = ?2", params![p, id], |_| Ok(())).optional())
        .ok()
        .flatten()
        .is_some()
}

pub async fn get(st: &Arc<AppState>, id: &str) -> anyhow::Result<GuideView> {
    if !valid_id(id) {
        anyhow::bail!("guía no válida");
    }
    let prof = profile(st);
    let pinned = is_pinned(st, prof, id);
    let ttl = if pinned { TTL_PINNED } else { TTL_GUIDE };
    let cached: Option<Guide> = cache_read(st, "guide", id, ttl);
    let mut guide = match cached {
        Some(g) => g,
        None => {
            let url = format!("{}&l={}", page_url(id), language(st));
            match fetch(st, &url).await {
                Ok(html) => {
                    let id2 = id.to_string();
                    let g = tauri::async_runtime::spawn_blocking(move || parse::guide(&id2, &html))
                        .await?
                        .ok_or_else(|| anyhow::anyhow!("Esa guía ya no existe o Steam no la enseña sin iniciar sesión."))?;
                    cache_write(st, "guide", id, &g);
                    g
                }
                Err(e) => cache_read(st, "guide", id, TTL_PINNED).ok_or_else(|| net_error(e))?,
            }
        }
    };
    guide.preview = guide.preview.as_deref().map(|u| sized(u, 640)).and_then(|u| images::proxy(&u));
    proxy_blocks(&mut guide.intro);
    for s in &mut guide.sections {
        proxy_blocks(&mut s.blocks);
    }
    Ok(GuideView {
        url: page_url(id),
        pinned,
        progress: prof.and_then(|p| progress_of(st, p, id)),
        guide,
    })
}

/// Guardar (o dejar de guardar) una guía. Título, autor y miniatura se toman
/// de la guía ya leída o de la lista (lo que haya en caché).
pub fn pin(st: &AppState, game_id: i64, id: &str, title: &str, author: &str, preview: Option<&str>, value: bool) -> anyhow::Result<()> {
    if !valid_id(id) {
        anyhow::bail!("guía no válida");
    }
    let prof = profile(st).ok_or_else(|| anyhow::anyhow!("No hay perfil activo"))?;
    let preview = media_preview(preview);
    st.db.with(|c| {
        if value {
            c.execute(
                "INSERT INTO guide_pins (profile_id, game_id, guide_id, title, author, preview, pinned_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT (profile_id, guide_id) DO UPDATE SET game_id = excluded.game_id, title = excluded.title,
                   author = excluded.author, preview = COALESCE(excluded.preview, preview)",
                params![prof, game_id, id, title.chars().take(200).collect::<String>(), author.chars().take(80).collect::<String>(), preview, crate::util::now()],
            )?;
        } else {
            c.execute("DELETE FROM guide_pins WHERE profile_id = ?1 AND guide_id = ?2", params![prof, id])?;
        }
        Ok(())
    })
}

/// Solo miniaturas servidas por ejg-media.
fn media_preview(p: Option<&str>) -> Option<&str> {
    p.filter(|p| p.starts_with("http://ejg-media.localhost/x/") && p.len() < 120)
}

/// Por dónde va el perfil en una guía.
#[allow(clippy::too_many_arguments)]
pub fn set_progress(st: &AppState, game_id: i64, id: &str, title: &str, author: &str, preview: Option<&str>, section: u32, scroll: f64) -> anyhow::Result<()> {
    if !valid_id(id) {
        anyhow::bail!("guía no válida");
    }
    let prof = profile(st).ok_or_else(|| anyhow::anyhow!("No hay perfil activo"))?;
    st.db.with(|c| {
        c.execute(
            "INSERT INTO guide_progress (profile_id, game_id, guide_id, title, author, preview, section, scroll, read_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT (profile_id, guide_id) DO UPDATE SET game_id = excluded.game_id, title = excluded.title, author = excluded.author,
               preview = COALESCE(excluded.preview, preview), section = excluded.section, scroll = excluded.scroll, read_at = excluded.read_at",
            params![
                prof,
                game_id,
                id,
                title.chars().take(200).collect::<String>(),
                author.chars().take(80).collect::<String>(),
                media_preview(preview),
                section.min(10_000),
                scroll.clamp(0.0, 1.0),
                crate::util::now()
            ],
        )?;
        Ok(())
    })
}

pub fn shelf(st: &AppState, game_id: i64) -> anyhow::Result<Shelf> {
    let Some(prof) = profile(st) else { return Ok(Shelf::default()) };
    st.db.with(|c| {
        let mut q = c.prepare(
            "SELECT p.guide_id, p.title, COALESCE(p.author, ''), p.preview, g.section, g.scroll, g.read_at
               FROM guide_pins p LEFT JOIN guide_progress g ON g.profile_id = p.profile_id AND g.guide_id = p.guide_id
              WHERE p.profile_id = ?1 AND p.game_id = ?2 ORDER BY p.pinned_at DESC",
        )?;
        let pinned: Vec<ShelfItem> = q
            .query_map(params![prof, game_id], |r| {
                let read_at: Option<i64> = r.get(6)?;
                Ok(ShelfItem {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    author: r.get(2)?,
                    preview: r.get(3)?,
                    pinned: true,
                    progress: read_at.map(|t| Progress { section: r.get(4).unwrap_or(0), scroll: r.get(5).unwrap_or(0.0), read_at: t }),
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut q = c.prepare(
            "SELECT guide_id, title, author, preview, section, scroll, read_at FROM guide_progress
              WHERE profile_id = ?1 AND game_id = ?2
                AND guide_id NOT IN (SELECT guide_id FROM guide_pins WHERE profile_id = ?1)
              ORDER BY read_at DESC LIMIT 5",
        )?;
        let recent = q
            .query_map(params![prof, game_id], |r| {
                Ok(ShelfItem {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    author: r.get(2)?,
                    preview: r.get(3)?,
                    pinned: false,
                    progress: Some(Progress { section: r.get(4)?, scroll: r.get(5)?, read_at: r.get(6)? }),
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(Shelf { pinned, recent })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resizes_steam_images_only() {
        assert_eq!(
            sized("https://images.steamusercontent.com/ugc/1/A/", 640),
            "https://images.steamusercontent.com/ugc/1/A/?imw=640&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=false"
        );
        assert_eq!(sized("https://i.ytimg.com/vi/x/hqdefault.jpg", 640), "https://i.ytimg.com/vi/x/hqdefault.jpg");
    }

    #[test]
    fn ids() {
        assert!(valid_id("2785187510"));
        assert!(!valid_id(""));
        assert!(!valid_id("12a"));
        assert!(!valid_id("1&x=2"));
    }

    #[test]
    fn pins_and_progress() {
        let db = crate::db::Db::memory().unwrap();
        db.with(|c| {
            let pid = repo::create_profile(c, "Yo", "#fff", "steam")?;
            c.execute("INSERT INTO games (title, sort_title, source, source_id, added_at, updated_at) VALUES ('x','x','folder','1',0,0)", [])?;
            let gid = c.last_insert_rowid();
            c.execute(
                "INSERT INTO guide_pins (profile_id, game_id, guide_id, title, author, preview, pinned_at) VALUES (?1, ?2, '5', 'Guía', 'Pepa', NULL, 1)",
                params![pid, gid],
            )?;
            c.execute(
                "INSERT INTO guide_progress (profile_id, game_id, guide_id, title, author, section, scroll, read_at) VALUES (?1, ?2, '6', 'Otra', 'Juan', 2, 0.5, 9)",
                params![pid, gid],
            )?;
            // Borrar el juego borra sus guías guardadas y el progreso.
            c.execute("DELETE FROM games WHERE id = ?1", [gid])?;
            let n: i64 = c.query_row("SELECT (SELECT COUNT(*) FROM guide_pins) + (SELECT COUNT(*) FROM guide_progress)", [], |r| r.get(0))?;
            assert_eq!(n, 0);
            Ok(())
        })
        .unwrap();
    }
}
