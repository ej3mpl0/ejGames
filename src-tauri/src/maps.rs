//! Mapas interactivos de Map Genie (mapgenie.io) con sus puntos de interés,
//! para el overlay y la ficha. El catálogo (juego → mapas) sale de su sitemap;
//! el juego de la biblioteca se empareja por título y, si no acierta, lo elige
//! el usuario. El mapa se abre tal cual en un iframe, sin sesión de Map Genie.

use crate::db::repo;
use crate::state::AppState;
use parking_lot::Mutex;
use regex::Regex;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, LazyLock};

pub const SITE: &str = "https://mapgenie.io";
const TTL_CATALOG: i64 = 7 * 86400;
const TTL_STALE: i64 = 180 * 86400;
/// Parecido mínimo para emparejar solo un juego con Map Genie.
const MATCH: f64 = 0.93;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapRef {
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapGame {
    pub slug: String,
    pub name: String,
    pub maps: Vec<MapRef>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameMaps {
    pub game: Option<MapGame>,
    /// Elegido a mano (si no, emparejado por el título).
    pub manual: bool,
    /// El usuario dijo que este juego no tiene mapa.
    pub none: bool,
    /// Último mapa abierto de este juego.
    pub last_map: Option<String>,
}

static LOC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<loc>\s*https://mapgenie\.io/([a-z0-9-]+)/maps/([a-z0-9-]+)\s*</loc>").unwrap());
static SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9]+(-[a-z0-9]+)*$").unwrap());

/// Catálogo en memoria (se pide mucho: cada ficha y cada panel).
static CATALOG: Mutex<Option<(i64, Arc<Vec<MapGame>>)>> = Mutex::new(None);

pub fn valid_slug(s: &str) -> bool {
    s.len() <= 80 && SLUG.is_match(s)
}

/// "the-lands-between" → "The Lands Between"; "witcher-3" → "Witcher 3".
pub fn pretty(slug: &str) -> String {
    const SMALL: [&str; 9] = ["of", "the", "and", "in", "on", "a", "an", "to", "for"];
    const ROMAN: [&str; 8] = ["ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi"];
    slug.split('-')
        .enumerate()
        .map(|(i, w)| {
            if ROMAN.contains(&w) {
                w.to_uppercase()
            } else if i > 0 && SMALL.contains(&w) {
                w.to_string()
            } else {
                let mut c = w.chars();
                c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn parse_sitemap(xml: &str) -> Vec<MapGame> {
    let mut games: Vec<MapGame> = vec![];
    for c in LOC.captures_iter(xml) {
        let (game, map) = (&c[1], &c[2]);
        let entry = match games.iter_mut().position(|g| g.slug == game) {
            Some(i) => &mut games[i],
            None => {
                games.push(MapGame { slug: game.into(), name: pretty(game), maps: vec![] });
                games.last_mut().unwrap()
            }
        };
        if !entry.maps.iter().any(|m| m.slug == map) {
            entry.maps.push(MapRef { slug: map.into(), name: pretty(map) });
        }
    }
    games.sort_by(|a, b| a.name.cmp(&b.name));
    games
}

pub async fn catalog(st: &AppState) -> anyhow::Result<Arc<Vec<MapGame>>> {
    let now = crate::util::now();
    if let Some((at, c)) = CATALOG.lock().as_ref() {
        if now - at < TTL_CATALOG {
            return Ok(c.clone());
        }
    }
    let cached = |ttl| {
        st.db
            .with(|c| repo::cache_get(c, "mapgenie", "catalog", ttl))
            .ok()
            .flatten()
            .and_then(|j| serde_json::from_str::<Vec<MapGame>>(&j).ok())
    };
    let list = match cached(TTL_CATALOG) {
        Some(l) => l,
        None => {
            let fetched = async {
                let r = st.http.get(format!("{SITE}/sitemap.xml")).send().await?;
                if !r.status().is_success() {
                    anyhow::bail!("{}", crate::i18n::tf("Map Genie respondió {0}", &[&r.status()]));
                }
                Ok(parse_sitemap(&r.text().await?))
            }
            .await;
            match fetched {
                Ok(l) if !l.is_empty() => {
                    if let Ok(j) = serde_json::to_string(&l) {
                        let _ = st.db.with(|c| repo::cache_put(c, "mapgenie", "catalog", &j));
                    }
                    l
                }
                other => {
                    let why = other.err().map(|e| format!("{e:#}")).unwrap_or_else(|| "sitemap vacío".into());
                    tracing::warn!("mapas: {why}");
                    cached(TTL_STALE).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("No se pudo leer la lista de mapas de Map Genie. Revisa tu conexión.")))?
                }
            }
        }
    };
    let arc = Arc::new(list);
    *CATALOG.lock() = Some((now, arc.clone()));
    Ok(arc)
}

/// El juego de Map Genie que más se parece al título (si se parece de verdad).
pub fn best_match<'a>(catalog: &'a [MapGame], title: &str) -> Option<&'a MapGame> {
    catalog
        .iter()
        .map(|g| (g, crate::library::names::similarity(title, &g.name)))
        .filter(|(_, s)| *s >= MATCH)
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(g, _)| g)
}

fn saved(st: &AppState, game_id: i64) -> (Option<String>, Option<String>) {
    st.db
        .with(|c| {
            c.query_row("SELECT slug, map FROM game_maps WHERE game_id = ?1", [game_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()
        })
        .ok()
        .flatten()
        .unwrap_or((None, None))
}

pub async fn for_game(st: &Arc<AppState>, game_id: i64) -> anyhow::Result<GameMaps> {
    let game = st.db.with(|c| repo::get_game(c, game_id))?;
    let (slug, last_map) = saved(st, game_id);
    if slug.as_deref() == Some("") {
        return Ok(GameMaps { none: true, manual: true, last_map, ..Default::default() });
    }
    let cat = catalog(st).await?;
    let (found, manual) = match slug {
        Some(s) => (cat.iter().find(|g| g.slug == s).cloned(), true),
        None => (best_match(&cat, &game.title).cloned(), false),
    };
    let last_map = last_map.filter(|m| found.as_ref().map(|g| g.maps.iter().any(|x| &x.slug == m)).unwrap_or(false));
    Ok(GameMaps { game: found, manual, none: false, last_map })
}

/// Juegos de Map Genie para elegir a mano.
pub async fn search(st: &Arc<AppState>, query: &str) -> anyhow::Result<Vec<MapGame>> {
    let cat = catalog(st).await?;
    let q = crate::library::names::normalize(query);
    if q.is_empty() {
        return Ok(vec![]);
    }
    let mut scored: Vec<(f64, &MapGame)> = cat
        .iter()
        .map(|g| {
            let n = crate::library::names::normalize(&g.name);
            let contains = if n.contains(&q) { 1.0 } else { 0.0 };
            (contains + crate::library::names::similarity(query, &g.name), g)
        })
        .filter(|(s, _)| *s >= 0.75)
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    Ok(scored.into_iter().take(12).map(|(_, g)| g.clone()).collect())
}

/// Elegir a mano: `Some(slug)` ese juego, `Some("")` sin mapa, `None` volver
/// a emparejarlo solo.
pub async fn choose(st: &Arc<AppState>, game_id: i64, slug: Option<String>) -> anyhow::Result<GameMaps> {
    match slug.as_deref() {
        None => {
            st.db.with(|c| c.execute("UPDATE game_maps SET slug = NULL WHERE game_id = ?1", [game_id]).map(|_| ()))?;
        }
        Some(s) => {
            if !s.is_empty() && !catalog(st).await?.iter().any(|g| g.slug == s) {
                anyhow::bail!("{}", crate::i18n::t("Ese juego no está en Map Genie"));
            }
            st.db.with(|c| {
                c.execute(
                    "INSERT INTO game_maps (game_id, slug, map, updated_at) VALUES (?1, ?2, NULL, ?3)
                     ON CONFLICT (game_id) DO UPDATE SET slug = excluded.slug, map = NULL, updated_at = excluded.updated_at",
                    params![game_id, s, crate::util::now()],
                )
                .map(|_| ())
            })?;
        }
    }
    for_game(st, game_id).await
}

/// Recuerda el último mapa abierto del juego.
pub fn set_last(st: &AppState, game_id: i64, map: &str) -> anyhow::Result<()> {
    if !valid_slug(map) {
        anyhow::bail!("{}", crate::i18n::t("Mapa no válido"));
    }
    st.db.with(|c| {
        c.execute(
            "INSERT INTO game_maps (game_id, slug, map, updated_at) VALUES (?1, NULL, ?2, ?3)
             ON CONFLICT (game_id) DO UPDATE SET map = excluded.map, updated_at = excluded.updated_at",
            params![game_id, map, crate::util::now()],
        )
        .map(|_| ())
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const XML: &str = r#"<?xml version="1.0"?><urlset>
      <url><loc>https://mapgenie.io/elden-ring</loc></url>
      <url><loc>https://mapgenie.io/elden-ring/maps/the-lands-between</loc></url>
      <url><loc>https://mapgenie.io/elden-ring/guides/bosses</loc></url>
      <url><loc>https://mapgenie.io/elden-ring/maps/the-shadow-realm</loc></url>
      <url><loc>https://mapgenie.io/elden-ring-nightreign/maps/limveld</loc></url>
      <url><loc>https://mapgenie.io/hollow-knight/maps/hallownest</loc></url>
      <url><loc>https://mapgenie.io/witcher-3/maps/white-orchard</loc></url>
      <url><loc>https://mapgenie.io/Bad Slug/maps/x</loc></url>
    </urlset>"#;

    #[test]
    fn reads_the_catalog() {
        let c = parse_sitemap(XML);
        let names: Vec<_> = c.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, vec!["Elden Ring", "Elden Ring Nightreign", "Hollow Knight", "Witcher 3"]);
        assert_eq!(c[0].maps, vec![MapRef { slug: "the-lands-between".into(), name: "The Lands Between".into() }, MapRef { slug: "the-shadow-realm".into(), name: "The Shadow Realm".into() }]);
    }

    #[test]
    fn matches_titles() {
        let c = parse_sitemap(XML);
        assert_eq!(best_match(&c, "ELDEN RING").map(|g| g.slug.as_str()), Some("elden-ring"));
        assert_eq!(best_match(&c, "Elden Ring Nightreign").map(|g| g.slug.as_str()), Some("elden-ring-nightreign"));
        assert_eq!(best_match(&c, "The Witcher 3").map(|g| g.slug.as_str()), Some("witcher-3"));
        assert_eq!(best_match(&c, "Hollow Knight: Silksong"), None);
        assert_eq!(best_match(&c, "Stardew Valley"), None);
    }

    #[test]
    fn slugs_and_urls() {
        assert!(valid_slug("the-lands-between"));
        assert!(!valid_slug("../x"));
        assert!(!valid_slug("a--b"));
        assert!(!valid_slug("x/../y"));
        assert_eq!(pretty("final-fantasy-vii-rebirth"), "Final Fantasy VII Rebirth");
        assert_eq!(pretty("lord-of-the-rings"), "Lord of the Rings");
    }
}
