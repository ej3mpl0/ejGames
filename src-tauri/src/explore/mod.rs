//! Explorar: buscar repacks y ver sus fichas. De momento una sola fuente
//! (FitGirl); lo que depende de ella vive en `fitgirl.rs` y `parse.rs`.
//!
//! Lo que se cachea es lo ya leído, con las URLs originales; al devolverlo se
//! cambian por las de ejg-media (`images::proxy`) y se añade el estado de cada
//! juego (en tu biblioteca, descargando…).

pub mod fitgirl;
pub mod genres;
pub mod homebrew;
pub mod images;
pub mod parse;
pub mod steamart;
pub mod updates;
pub mod wishlist;

use crate::db::repo;
use crate::library::names;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

const CACHE: &str = "explore";
const TTL_SEARCH: i64 = 30 * 60;
const TTL_HOME: i64 = 60 * 60;
const TTL_POST: i64 = 7 * 24 * 3600;
/// Si la web falla, vale cualquier copia guardada de este último mes.
const TTL_STALE: i64 = 30 * 24 * 3600;
const PER_PAGE: u32 = 24;

#[derive(Default)]
pub struct Explore {
    pub fitgirl: fitgirl::FitGirl,
}

/// Estado de un repack respecto a ti.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepackStatus {
    /// none | library | queued | downloading | paused | seeding | completed |
    /// installing | installed | error
    pub state: String,
    pub download_id: Option<i64>,
    pub game_id: Option<i64>,
    /// 0..1 (descargas).
    pub progress: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repack {
    pub source: String,
    pub id: i64,
    pub slug: String,
    /// Nombre del juego, sin la versión.
    pub title: String,
    pub version: Option<String>,
    pub full_title: String,
    pub url: String,
    pub date: String,
    pub number: Option<u32>,
    /// Miniatura de la portada (vertical).
    pub cover: Option<String>,
    pub cover_full: Option<String>,
    /// Primera captura en grande (para fondos y cabeceras).
    pub hero: Option<String>,
    pub genres: Vec<String>,
    pub companies: Option<String>,
    pub languages: Option<String>,
    pub original_size: Option<String>,
    pub repack_size: Option<String>,
    pub repack_bytes: Option<u64>,
    pub selective: bool,
    pub adult: bool,
    /// Crack de hipervisor (HV): para jugar hay que apagar un rato la
    /// seguridad de Windows basada en virtualización (ver `parse::Post`).
    #[serde(default)]
    pub hypervisor: bool,
    /// Arte de la tienda de Steam, si el juego está allí (ver `steamart`):
    /// cápsula horizontal 460×215, la grande 616×353 y la vertical 600×900.
    #[serde(default)]
    pub capsule: Option<String>,
    #[serde(default)]
    pub capsule_big: Option<String>,
    #[serde(default)]
    pub library: Option<String>,
    /// Etiquetas de la web (ids; los géneros conocidos están en `genres`).
    #[serde(default)]
    pub tags: Vec<u32>,
    #[serde(default)]
    pub status: RepackStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub thumb: String,
    pub full: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepackDetails {
    #[serde(flatten)]
    pub repack: Repack,
    pub screenshots: Vec<Shot>,
    pub features: Vec<String>,
    /// "up to 26.7 GB".
    pub install_size: Option<String>,
    pub description: Option<String>,
    pub magnet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub title: String,
    pub items: Vec<Repack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Home {
    pub sections: Vec<Section>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub query: String,
    pub items: Vec<Repack>,
    pub page: u32,
    pub pages: u32,
    pub total: u32,
    /// Filtrado aquí (tamaño, los que ya tienes): `total` es aproximado y una
    /// página puede traer menos juegos que otra.
    #[serde(default)]
    pub filtered: bool,
}

/// Filtros del catálogo (Explorar → todos los juegos).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Browse {
    /// Texto en el título.
    pub query: String,
    /// Géneros (ids de `genres`); salen los que tienen todos.
    pub genres: Vec<u32>,
    /// date (novedades) | modified (actualizados hace poco) | title (A-Z)
    pub sort: String,
    /// Tamaño máximo de la descarga, en GB.
    pub max_gb: Option<f64>,
    /// Quitar los que ya están en tu biblioteca o descargándose.
    pub hide_owned: bool,
}

fn shot_urls(base: &str) -> Shot {
    Shot {
        thumb: format!("{base}.240p.jpg"),
        // 720p: ligera y, si no existe (capturas pequeñas), images::serve cae al original.
        full: format!("{base}.720p.jpg"),
    }
}

fn to_details(raw: &fitgirl::RawPost) -> RepackDetails {
    let p = parse::parse_post(&raw.content, &raw.title);
    let adult = parse::is_adult(&raw.title, &p.genres);
    let screenshots: Vec<Shot> = p.screenshots.iter().map(|b| shot_urls(b)).collect();
    RepackDetails {
        repack: Repack {
            source: fitgirl::ID.into(),
            id: raw.id,
            slug: raw.slug.clone(),
            title: p.name.clone(),
            version: p.version.clone(),
            full_title: raw.title.clone(),
            url: raw.link.clone(),
            date: raw.date.clone(),
            number: p.number,
            cover: p.cover.as_deref().map(images::thumb),
            cover_full: p.cover.as_deref().map(images::large),
            hero: screenshots.first().map(|s| s.full.clone()),
            genres: p.genres.clone(),
            companies: p.companies.clone(),
            languages: p.languages.clone(),
            original_size: p.original_size.clone(),
            repack_size: p.repack_size.clone(),
            repack_bytes: p.repack_bytes,
            selective: p.selective,
            adult,
            hypervisor: p.hypervisor,
            capsule: None,
            capsule_big: None,
            library: None,
            tags: raw.tags.clone(),
            status: RepackStatus::default(),
        },
        screenshots,
        features: p.features,
        install_size: p.install_size,
        description: p.description,
        magnet: p.magnet,
    }
}

/// Las fichas sin torrent (p. ej. solo enlaces directos) no sirven aquí.
fn usable(d: &RepackDetails) -> bool {
    d.magnet.is_some()
}

// ───────────────────────────── caché ─────────────────────────────

fn cache_read<T: for<'de> Deserialize<'de>>(st: &AppState, key: &str, ttl: i64) -> Option<T> {
    st.db
        .with(|c| repo::cache_get(c, CACHE, key, ttl))
        .ok()
        .flatten()
        .and_then(|j| serde_json::from_str(&j).ok())
}

fn cache_write<T: Serialize>(st: &AppState, key: &str, v: &T) {
    if let Ok(j) = serde_json::to_string(v) {
        let _ = st.db.with(|c| repo::cache_put(c, CACHE, key, &j));
    }
}

fn store_posts(st: &AppState, list: &[RepackDetails]) {
    for d in list {
        cache_write(st, &format!("fg:post:{}", d.repack.slug), d);
    }
}

/// Pide a la web o, si falla, devuelve la última copia guardada.
async fn cached<T, F, Fut>(st: &AppState, key: &str, ttl: i64, fetch: F) -> anyhow::Result<T>
where
    T: Serialize + for<'de> Deserialize<'de>,
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<T>>,
{
    if let Some(v) = cache_read(st, key, ttl) {
        return Ok(v);
    }
    match fetch().await {
        Ok(v) => {
            cache_write(st, key, &v);
            Ok(v)
        }
        Err(e) => {
            tracing::warn!("explorar ({key}): {e:#}");
            cache_read(st, key, TTL_STALE).ok_or(e)
        }
    }
}

// ───────────────────────────── estado ─────────────────────────────

struct StatusIndex {
    downloads: HashMap<String, RepackStatus>,
    installed: HashMap<String, i64>,
    titles: HashMap<String, i64>,
}

fn status_index(st: &AppState) -> StatusIndex {
    let mut idx = StatusIndex {
        downloads: HashMap::new(),
        installed: HashMap::new(),
        titles: HashMap::new(),
    };
    if let Ok(rows) = st.db.with(repo::list_downloads) {
        for d in rows {
            let progress = (d.total_bytes > 0).then(|| (d.done_bytes as f64 / d.total_bytes as f64).min(1.0));
            // Si hay varias (se volvió a bajar), manda la más reciente.
            idx.downloads.insert(
                d.source_id.clone(),
                RepackStatus {
                    state: d.state.clone(),
                    download_id: Some(d.id),
                    game_id: d.game_id,
                    progress,
                },
            );
        }
    }
    if let Ok(games) = st.db.with(repo::library_titles) {
        for (id, title, source, source_id) in games {
            if source == "repack" {
                idx.installed.insert(source_id, id);
            }
            idx.titles.entry(names::normalize(&title)).or_insert(id);
        }
    }
    idx
}

impl StatusIndex {
    fn of(&self, r: &Repack) -> RepackStatus {
        let key = format!("{}:{}", r.source, r.id);
        if let Some(gid) = self.installed.get(&key) {
            return RepackStatus {
                state: "installed".into(),
                game_id: Some(*gid),
                download_id: self.downloads.get(&key).and_then(|d| d.download_id),
                progress: None,
            };
        }
        if let Some(d) = self.downloads.get(&key) {
            if d.state != "installed" {
                return d.clone();
            }
        }
        if let Some(gid) = self.titles.get(&names::normalize(&r.title)) {
            return RepackStatus {
                state: "library".into(),
                game_id: Some(*gid),
                ..Default::default()
            };
        }
        RepackStatus {
            state: "none".into(),
            ..Default::default()
        }
    }
}

// ───────────────────────────── salida ─────────────────────────────

fn publish(st: &AppState, r: &mut Repack, idx: &StatusIndex) -> bool {
    r.cover = r.cover.as_deref().and_then(images::proxy);
    r.cover_full = r.cover_full.as_deref().and_then(images::proxy);
    r.hero = r.hero.as_deref().and_then(images::proxy);
    r.status = idx.of(r);
    match steamart::cached(st, &r.title) {
        Some(art) => {
            (r.capsule, r.capsule_big, r.library) = steamart::proxied(&art);
            true
        }
        None => false,
    }
}

/// Publica una lista y busca en segundo plano el arte de Steam que falte.
fn publish_list(st: &Arc<AppState>, idx: &StatusIndex, items: Vec<Repack>) -> Vec<Repack> {
    let hide_adult = st.settings.get().explore_hide_adult;
    let mut missing = Vec::new();
    let out = items
        .into_iter()
        .filter(|r| !(hide_adult && r.adult))
        .map(|mut r| {
            if !publish(st, &mut r, idx) {
                missing.push(r.title.clone());
            }
            r
        })
        .collect();
    steamart::resolve_later(st, missing);
    out
}

/// Portada de la tienda: populares del mes y de la semana, y novedades.
pub async fn home(st: &Arc<AppState>) -> anyhow::Result<Home> {
    let fg = &st.explore.fitgirl;
    let home: Home = cached(st, "fg:home", TTL_HOME, || async {
        let popular = fg.popular().await?;
        let slugs: Vec<String> = {
            let mut seen = std::collections::HashSet::new();
            popular.iter().flat_map(|(_, items)| items.iter().map(|i| i.slug.clone())).filter(|s| seen.insert(s.clone())).collect()
        };
        let posts: Vec<RepackDetails> = fg.by_slugs(&slugs).await?.iter().map(to_details).filter(usable).collect();
        store_posts(st, &posts);
        let by_slug: HashMap<&str, &RepackDetails> = posts.iter().map(|p| (p.repack.slug.as_str(), p)).collect();
        let mut sections = Vec::new();
        for (title, items) in &popular {
            let (id, name) = if title.contains("Today") {
                ("today", "Populares hoy")
            } else if title.contains("Week") {
                ("week", "Populares de la semana")
            } else if title.contains("Month") {
                ("month", "Populares del mes")
            } else {
                continue;
            };
            let list: Vec<Repack> = items.iter().filter_map(|i| by_slug.get(i.slug.as_str()).map(|p| p.repack.clone())).collect();
            if !list.is_empty() {
                sections.push(Section {
                    id: id.into(),
                    title: name.into(),
                    items: list,
                });
            }
        }
        let order = ["today", "week", "month"];
        sections.sort_by_key(|s| order.iter().position(|o| *o == s.id).unwrap_or(9));
        let latest: Vec<RepackDetails> = fg.latest(1, PER_PAGE).await?.posts.iter().map(to_details).filter(usable).collect();
        store_posts(st, &latest);
        sections.push(Section {
            id: "latest".into(),
            title: "Novedades".into(),
            items: latest.into_iter().map(|d| d.repack).collect(),
        });
        Ok(Home { sections })
    })
    .await?;
    let idx = status_index(st);
    Ok(Home {
        sections: home
            .sections
            .into_iter()
            .map(|s| Section {
                items: publish_list(st, &idx, s.items),
                ..s
            })
            .collect(),
    })
}

/// Búsqueda por título. Sin texto: las novedades, paginadas.
pub async fn search(st: &Arc<AppState>, query: &str, page: u32) -> anyhow::Result<SearchPage> {
    let q: String = query.trim().chars().take(100).collect();
    let page = page.clamp(1, 500);
    let key = format!("fg:search:{}:{page}", q.to_lowercase());
    let fg = &st.explore.fitgirl;
    let res: SearchPage = cached(st, &key, TTL_SEARCH, || async {
        let raw = if q.is_empty() { fg.latest(page, PER_PAGE).await? } else { fg.search(&q, page, PER_PAGE).await? };
        let posts: Vec<RepackDetails> = raw.posts.iter().map(to_details).filter(usable).collect();
        store_posts(st, &posts);
        Ok(SearchPage {
            query: q.clone(),
            items: posts.into_iter().map(|d| d.repack).collect(),
            page,
            pages: raw.pages.max(1),
            total: raw.total,
            filtered: false,
        })
    })
    .await?;
    let idx = status_index(st);
    let before = res.items.len();
    let items = publish_list(st, &idx, res.items);
    // Los ocultos (adultos) no cuentan; con una sola página se sabe el total exacto.
    let hidden = (before - items.len()) as u32;
    let total = if res.pages <= 1 { items.len() as u32 } else { res.total.saturating_sub(hidden) };
    Ok(SearchPage { items, total, ..res })
}

/// Juegos por página del catálogo con filtros de aquí: se piden más páginas a
/// la web hasta tener al menos estos (o `MAX_FETCH` páginas).
const MIN_FILTERED: usize = 12;
const MAX_FETCH: u32 = 4;

/// Catálogo con filtros. `page` es la página de la web por la que seguir: la
/// respuesta dice la última que se leyó (con filtros de aquí pueden ser varias).
pub async fn browse(st: &Arc<AppState>, f: &Browse, page: u32) -> anyhow::Result<SearchPage> {
    let text: String = f.query.trim().chars().take(100).collect();
    let mut tags: Vec<u32> = f.genres.iter().copied().filter(|g| genres::known(*g)).take(4).collect();
    tags.sort_unstable();
    tags.dedup();
    let sort = match f.sort.as_str() {
        "title" | "modified" => f.sort.as_str(),
        _ => "date",
    };
    let hide_adult = st.settings.get().explore_hide_adult;
    let exclude: Vec<u32> = if hide_adult { vec![fitgirl::ADULT_TAG] } else { vec![] };
    let max_bytes = f.max_gb.filter(|g| *g > 0.0).map(|g| (g * 1024f64.powi(3)) as u64);
    let local = max_bytes.is_some() || f.hide_owned;
    let tag_key = tags.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(",");
    let idx = status_index(st);

    let mut page = page.clamp(1, 1000);
    let start = page;
    let mut out: Vec<Repack> = vec![];
    let mut last: Option<SearchPage> = None;
    // Vistos y que pasan los filtros de aquí (para estimar el total).
    let mut seen = 0usize;
    for fetched in 0..if local { MAX_FETCH } else { 1 } {
        let key = format!("fg:browse:{}:{tag_key}:{}:{sort}:{page}", text.to_lowercase(), exclude.len());
        let fg = &st.explore.fitgirl;
        let q = fitgirl::Query { text: &text, tags: &tags, exclude: &exclude, sort };
        let res: SearchPage = cached(st, &key, TTL_SEARCH, || async {
            let raw = fg.browse(&q, page, PER_PAGE).await?;
            let posts: Vec<RepackDetails> = raw.posts.iter().map(to_details).filter(usable).collect();
            store_posts(st, &posts);
            Ok(SearchPage {
                query: text.clone(),
                items: posts.into_iter().map(|d| d.repack).collect(),
                page,
                pages: raw.pages,
                total: raw.total,
                filtered: false,
            })
        })
        .await?;
        let items = publish_list(st, &idx, res.items.clone());
        seen += items.len();
        out.extend(items.into_iter().filter(|r| {
            let fits = match (max_bytes, r.repack_bytes) {
                (Some(max), Some(b)) => b <= max,
                (Some(_), None) => false,
                _ => true,
            };
            let owned = matches!(r.status.state.as_str(), "library" | "installed") || r.status.download_id.is_some();
            fits && !(f.hide_owned && owned)
        }));
        let more = page < res.pages;
        last = Some(res);
        if !more || out.len() >= MIN_FILTERED || fetched + 1 == MAX_FETCH {
            break;
        }
        page += 1;
    }
    let res = last.expect("al menos una página");
    let total = if local {
        // La web no sabe de tamaños ni de lo que tienes: se estima con la
        // proporción de lo que pasó el filtro en las páginas leídas.
        if (start == 1 && page >= res.pages) || seen == 0 {
            out.len() as u32
        } else {
            ((res.total as f64) * (out.len() as f64 / seen as f64)).round() as u32
        }
    } else if res.pages > 1 {
        res.total
    } else {
        out.len() as u32
    };
    Ok(SearchPage { query: text, items: out, page, pages: res.pages, total, filtered: local })
}

/// Ficha sin publicar (URLs originales). `fresh`: pedirla a la web aunque esté
/// en caché (antes de descargar: el magnet cambia si el repack se actualiza).
pub async fn details_raw(st: &Arc<AppState>, slug: &str, fresh: bool) -> anyhow::Result<RepackDetails> {
    if !fitgirl::valid_slug(slug) {
        anyhow::bail!("Ficha no válida");
    }
    let key = format!("fg:post:{slug}");
    let ttl = if fresh { 3600 } else { TTL_POST };
    cached(st, &key, ttl, || async {
        let posts = st.explore.fitgirl.by_slugs(&[slug.to_string()]).await?;
        let raw = posts.first().ok_or_else(|| anyhow::anyhow!("Esa ficha ya no existe en FitGirl"))?;
        Ok(to_details(raw))
    })
    .await
}

pub async fn details(st: &Arc<AppState>, slug: &str) -> anyhow::Result<RepackDetails> {
    let mut d = details_raw(st, slug, false).await?;
    let idx = status_index(st);
    if !publish(st, &mut d.repack, &idx) {
        steamart::resolve_later(st, vec![d.repack.title.clone()]);
    }
    d.screenshots = d
        .screenshots
        .iter()
        .filter_map(|s| Some(Shot { thumb: images::proxy(&s.thumb)?, full: images::proxy(&s.full)? }))
        .collect();
    Ok(d)
}

/// URL de ejg-media para mostrar una portada guardada (descargas).
pub fn proxied(url: Option<&str>) -> Option<String> {
    url.and_then(images::proxy)
}
