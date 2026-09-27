//! Arte de la tienda de Steam para las fichas de Explorar: la cápsula
//! horizontal («header», 460×215), la grande del carrusel (616×353) y la
//! vertical de la biblioteca (600×900). El juego se busca por nombre en Steam
//! (storesearch) y sus imágenes se piden con GetItems (las rutas llevan hash).
//! Todo queda en caché un mes: solo la primera vez hay que esperar, y mientras
//! tanto la tienda enseña la portada de la ficha. Al terminar se avisa al host
//! (`explore:art`) para que el tema vuelva a pedir la portada.

use super::images;
use crate::db::repo;
use crate::library::names;
use crate::metadata::ratelimit::{self, RateLimiter};
use crate::metadata::steam::ASSETS_CDN;
use crate::state::AppState;
use futures::StreamExt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tauri::Emitter;

const CACHE: &str = "explore";
const TTL: i64 = 30 * 24 * 3600;
/// Parecido mínimo entre el título del repack y el nombre en Steam.
const MIN_SIMILARITY: f64 = 0.9;

/// URLs originales (sin pasar por ejg-media). Vacío = no está en Steam.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Art {
    pub header: Option<String>,
    pub main: Option<String>,
    pub library: Option<String>,
}

static PENDING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
/// Lo ya leído de la caché, en memoria (las descargas lo piden en cada tic).
static MEM: LazyLock<Mutex<HashMap<String, Art>>> = LazyLock::new(Default::default);
static SEARCH: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(Duration::from_millis(150)));
static ITEMS: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(Duration::from_millis(300)));

fn key(title: &str) -> String {
    format!("steamart:{}", names::normalize(title))
}

/// El arte ya conocido de un título (None si todavía no se ha buscado).
pub fn cached(st: &AppState, title: &str) -> Option<Art> {
    let k = key(title);
    if let Some(a) = MEM.lock().get(&k) {
        return Some(a.clone());
    }
    let json = st.db.with(|c| repo::cache_get(c, CACHE, &k, TTL)).ok().flatten()?;
    let art: Art = serde_json::from_str(&json).ok()?;
    let mut m = MEM.lock();
    if m.len() > 5000 {
        m.clear();
    }
    m.insert(k, art.clone());
    Some(art)
}

/// La cápsula horizontal (460×215) ya conocida de un título, como URL de ejg-media.
pub fn capsule(st: &AppState, title: &str) -> Option<String> {
    cached(st, title).and_then(|a| a.header).and_then(|u| images::proxy(&u))
}

/// Las tres imágenes como URLs de ejg-media.
pub fn proxied(art: &Art) -> (Option<String>, Option<String>, Option<String>) {
    let p = |u: &Option<String>| u.as_deref().and_then(images::proxy);
    (p(&art.header), p(&art.main), p(&art.library))
}

/// Título para buscar en Steam: sin nombres alternativos, ediciones, extras ni DLCs.
pub fn search_term(title: &str) -> String {
    static CUT: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"(?i)\s*(?:[–—-]|\+|:)\s*(?:(?:[\w'’]+\s+){0,3}edition\b.*|(?:the\s+)?(?:digital\s+)?(?:deluxe|ultimate|complete|definitive|gold|goty|game of the year|premium|enhanced|special|collector'?s?|anniversary|director'?s\s+cut)\b.*|\d+\s+dlcs?\b.*|bonus\b.*|soundtrack\b.*|all\s+dlcs?\b.*)$").unwrap()
    });
    let t = title.split(" / ").next().unwrap_or(title);
    let t = CUT.replace(t.trim(), "");
    let t = t.trim();
    if t.len() >= 2 { t.to_string() } else { title.trim().to_string() }
}

/// Bandas sonoras, DLCs y demos no son el juego.
fn bad_name(n: &str) -> bool {
    let l = n.to_lowercase();
    ["soundtrack", " ost", "artbook", "demo", "dlc", "season pass", "contenido de", "content pack"].iter().any(|w| l.contains(w))
}

/// El resultado de storesearch que es este juego: el mismo nombre, uno que lo
/// empieza (con dos palabras o más: «Grand Theft Auto V» → «… V Enhanced») o
/// uno casi igual.
fn pick(title: &str, items: &[(i64, String)]) -> Option<i64> {
    let term = names::normalize(&search_term(title));
    let words = term.split_whitespace().count();
    items
        .iter()
        .filter(|(_, n)| !bad_name(n))
        .map(|(id, n)| {
            let n = names::normalize(n);
            let s = if n == term {
                1.0
            } else if words >= 2 && (n.starts_with(&format!("{term} ")) || term.starts_with(&format!("{n} "))) {
                0.92
            } else {
                names::similarity(&term, &n)
            };
            (*id, s)
        })
        .filter(|(_, s)| *s >= MIN_SIMILARITY)
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(id, _)| id)
}

async fn search(st: &AppState, title: &str) -> anyhow::Result<Option<i64>> {
    let term = search_term(title);
    let r = ratelimit::get(&st.http, &SEARCH, || {
        st.http.get("https://store.steampowered.com/api/storesearch/").query(&[("term", term.as_str()), ("l", "english"), ("cc", "US")])
    })
    .await?;
    let v: Value = r.json().await?;
    let items: Vec<(i64, String)> = v
        .get("items")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|i| i.get("type").and_then(Value::as_str).unwrap_or("app") == "app")
                .filter_map(|i| Some((i.get("id")?.as_i64()?, i.get("name")?.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default();
    Ok(pick(title, &items))
}

fn asset(item: &Value, name: &str) -> Option<String> {
    let file = item.pointer(&format!("/assets/{name}"))?.as_str()?;
    let fmt = item.pointer("/assets/asset_url_format")?.as_str()?;
    Some(format!("{ASSETS_CDN}{}", fmt.replace("${FILENAME}", file)))
}

/// Imágenes de muchos appids (GetItems solo con los assets, en lotes de 50).
async fn assets(st: &AppState, appids: &[i64]) -> anyhow::Result<HashMap<i64, Art>> {
    let mut out = HashMap::new();
    for chunk in appids.chunks(50) {
        let input = json!({
            "ids": chunk.iter().map(|a| json!({"appid": a})).collect::<Vec<_>>(),
            "context": {"language": "spanish", "country_code": "ES"},
            "data_request": {"include_assets": true}
        })
        .to_string();
        let r = ratelimit::get(&st.http, &ITEMS, || {
            st.http.get("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/").query(&[("input_json", input.as_str())])
        })
        .await?;
        let v: Value = r.json().await?;
        for it in v.pointer("/response/store_items").and_then(Value::as_array).into_iter().flatten() {
            let Some(id) = it.get("appid").and_then(Value::as_i64) else { continue };
            out.insert(
                id,
                Art {
                    header: asset(it, "header"),
                    main: asset(it, "main_capsule"),
                    library: asset(it, "library_capsule_2x").or_else(|| asset(it, "library_capsule")),
                },
            );
        }
    }
    Ok(out)
}

/// Busca en segundo plano el arte de los títulos que aún no se conocen.
pub fn resolve_later(st: &Arc<AppState>, titles: Vec<String>) {
    let missing: Vec<String> = {
        let mut pending = PENDING.lock();
        let mut seen = HashSet::new();
        titles
            .into_iter()
            .filter(|t| seen.insert(names::normalize(t)))
            .filter(|t| cached(st, t).is_none() && pending.insert(key(t)))
            .collect()
    };
    if missing.is_empty() {
        return;
    }
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        // 1) appid de cada título (4 a la vez; el limitador marca el ritmo).
        let found: Vec<(String, Option<i64>)> = futures::stream::iter(missing.clone())
            .map(|t| {
                let st = st.clone();
                async move {
                    let id = search(&st, &t).await.unwrap_or_else(|e| {
                        tracing::debug!("steamart: {t}: {e:#}");
                        None
                    });
                    (t, id)
                }
            })
            .buffer_unordered(4)
            .collect()
            .await;
        // 2) sus imágenes.
        let ids: Vec<i64> = found.iter().filter_map(|(_, id)| *id).collect::<HashSet<_>>().into_iter().collect();
        let arts = if ids.is_empty() { HashMap::new() } else { assets(&st, &ids).await.unwrap_or_default() };
        let mut any = false;
        for (t, id) in &found {
            let art = id.and_then(|id| arts.get(&id).cloned()).unwrap_or_default();
            any |= art.header.is_some();
            if let Ok(j) = serde_json::to_string(&art) {
                let _ = st.db.with(|c| repo::cache_put(c, CACHE, &key(t), &j));
            }
            MEM.lock().insert(key(t), art);
        }
        {
            let mut pending = PENDING.lock();
            for t in &missing {
                pending.remove(&key(t));
            }
        }
        tracing::info!("steamart: {} títulos, {} con arte de Steam", found.len(), found.iter().filter(|(_, id)| id.is_some()).count());
        if any {
            let _ = st.app.emit("explore:art", ());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_terms() {
        assert_eq!(search_term("The Blood of Dawnwalker: Eclipse Edition"), "The Blood of Dawnwalker");
        assert_eq!(search_term("Grand Theft Auto V / GTA 5"), "Grand Theft Auto V");
        assert_eq!(search_term("SILENT HILL: Townfall – Deluxe Edition"), "SILENT HILL: Townfall");
        assert_eq!(search_term("Assassin's Creed: Black Flag Resynced – Deluxe Edition"), "Assassin's Creed: Black Flag Resynced");
        assert_eq!(search_term("Onimusha: Way of the Sword – Premium Deluxe Edition"), "Onimusha: Way of the Sword");
        assert_eq!(search_term("Hollowbody + Soundtrack Bundle"), "Hollowbody");
        assert_eq!(search_term("Cyberpunk 2077: Ultimate Edition"), "Cyberpunk 2077");
        assert_eq!(search_term("Portal 2"), "Portal 2");
    }

    #[test]
    fn picks_the_game_not_the_dlc() {
        let items = vec![
            (4417550, "Contenido de The Blood of Dawnwalker - Eclipse Edition".to_string()),
            (3751260, "The Blood of Dawnwalker".to_string()),
        ];
        assert_eq!(pick("The Blood of Dawnwalker: Eclipse Edition", &items), Some(3751260));
        let items = vec![(1030300, "Hollow Knight: Silksong".to_string()), (3928720, "Hollow Knight: Silksong - Official Soundtrack".to_string())];
        assert_eq!(pick("Hollow Knight: Silksong", &items), Some(1030300));
        assert_eq!(pick("Hollow Knight: Silksong", &[(9, "Something Else".to_string())]), None);
        // Parecido no basta: «Hollow Cocoon» no es «Hollow Knight».
        assert_eq!(pick("Hollow Cocoon", &[(367520, "Hollow Knight".to_string())]), None);
        assert_eq!(pick("Grand Theft Auto V / GTA 5", &[(3240220, "Grand Theft Auto V Enhanced".to_string())]), Some(3240220));
    }
}
