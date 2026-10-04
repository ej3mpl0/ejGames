//! HowLongToBeat: cuántas horas lleva pasarse un juego (historia, extras,
//! completarlo). La web no tiene API pública: se pide un token a
//! `/api/search/site/init` y con él se busca por nombre. Si cambia, falla y la
//! ficha simplemente no enseña el dato.

use crate::db::repo;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const TTL_OK: i64 = 30 * 24 * 3600;
const TTL_NONE: i64 = 7 * 24 * 3600;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hltb {
    pub id: i64,
    pub name: String,
    /// Horas (0 = sin dato).
    pub main: f32,
    pub extra: f32,
    pub complete: f32,
    pub url: String,
}

#[derive(Deserialize)]
struct Res {
    #[serde(default)]
    data: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    game_id: i64,
    game_name: String,
    #[serde(default)]
    comp_main: f64,
    #[serde(default)]
    comp_plus: f64,
    #[serde(default)]
    comp_100: f64,
    #[serde(default)]
    release_world: i64,
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).flat_map(char::to_lowercase).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// El resultado que mejor encaja con `title` (parecido del nombre, y el año si se sabe).
fn best(items: Vec<Item>, title: &str, year: Option<i64>) -> Option<Hltb> {
    let t = norm(title);
    items
        .into_iter()
        .filter(|i| i.comp_main > 0.0 || i.comp_plus > 0.0 || i.comp_100 > 0.0)
        .map(|i| {
            let mut score = strsim::jaro_winkler(&t, &norm(&i.game_name));
            if let Some(y) = year.filter(|y| *y > 0) {
                if i.release_world == y {
                    score += 0.03;
                } else if i.release_world > 0 && (i.release_world - y).abs() > 2 {
                    score -= 0.08;
                }
            }
            (score, i)
        })
        .filter(|(s, _)| *s >= 0.9)
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(_, i)| {
            let h = |s: f64| ((s / 3600.0) * 10.0).round() as f32 / 10.0;
            Hltb {
                id: i.game_id,
                name: i.game_name,
                main: h(i.comp_main),
                extra: h(i.comp_plus),
                complete: h(i.comp_100),
                url: format!("https://howlongtobeat.com/game/{}", i.game_id),
            }
        })
}

async fn search(http: &reqwest::Client, title: &str) -> anyhow::Result<Vec<Item>> {
    let init: serde_json::Value = http
        .get(format!("https://howlongtobeat.com/api/search/site/init?t={}", chrono::Utc::now().timestamp_millis()))
        .header("User-Agent", UA)
        .header("Referer", "https://howlongtobeat.com/")
        .timeout(Duration::from_secs(10))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let token = init["token"].as_str().ok_or_else(|| anyhow::anyhow!("HowLongToBeat no dio token"))?;
    let body = serde_json::json!({
        "searchType": "games",
        "searchTerms": title.split_whitespace().collect::<Vec<_>>(),
        "searchPage": 1,
        "size": 10,
        "searchOptions": {
            "games": {
                "userId": 0, "platform": "", "sortCategory": "popular", "rangeCategory": "main",
                "rangeTime": { "min": 0, "max": 0 },
                "gameplay": { "perspective": "", "flow": "", "genre": "", "difficulty": "" },
                "rangeYear": { "min": "", "max": "" }, "modifier": ""
            },
            "users": { "sortCategory": "postcount" },
            "lists": { "sortCategory": "follows" },
            "filter": "", "sort": 0, "randomizer": 0
        },
        "useCache": true
    });
    let res: Res = http
        .post("https://howlongtobeat.com/api/search/site")
        .header("User-Agent", UA)
        .header("Referer", "https://howlongtobeat.com/")
        .header("Origin", "https://howlongtobeat.com")
        .header("x-auth-token", token)
        .timeout(Duration::from_secs(12))
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(res.data)
}

/// Las horas de un juego (de la caché o de la web). `None` si no lo encuentra.
pub async fn lookup(st: &Arc<AppState>, title: &str, year: Option<i64>) -> anyhow::Result<Option<Hltb>> {
    let key = format!("{}:{}", norm(title), year.unwrap_or(0));
    let cached = |ttl: i64| st.db.with(|c| repo::cache_get(c, "hltb", &key, ttl)).ok().flatten();
    if let Some(j) = cached(TTL_OK) {
        if let Ok(v) = serde_json::from_str::<Option<Hltb>>(&j) {
            // Los «no encontrado» caducan antes.
            if v.is_some() || cached(TTL_NONE).is_some() {
                return Ok(v);
            }
        }
    }
    let found = best(search(&st.http, title).await?, title, year);
    if let Ok(j) = serde_json::to_string(&found) {
        let _ = st.db.with(|c| repo::cache_put(c, "hltb", &key, &j));
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: i64, name: &str, main: f64, year: i64) -> Item {
        Item { game_id: id, game_name: name.into(), comp_main: main, comp_plus: main * 2.0, comp_100: main * 4.0, release_world: year }
    }

    #[test]
    fn picks_the_closest_title_and_year() {
        let items = vec![item(1, "Hades II", 114980.0, 2025), item(2, "Hades", 84911.0, 2020), item(3, "Shades", 1000.0, 2010)];
        let h = best(items, "Hades", Some(2020)).unwrap();
        assert_eq!(h.id, 2);
        assert_eq!(h.main, 23.6);
        assert_eq!(h.url, "https://howlongtobeat.com/game/2");
    }

    #[test]
    fn rejects_weak_matches() {
        assert!(best(vec![item(9, "Una cosa distinta", 3600.0, 2019)], "Elden Ring", None).is_none());
        assert!(best(vec![item(9, "Elden Ring", 0.0, 2022)], "Elden Ring", None).is_none());
    }

    /// Con la web de verdad: `cargo test --lib hltb -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_search() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let http = reqwest::Client::new();
        let items = rt.block_on(search(&http, "Hades")).unwrap();
        let h = best(items, "Hades", Some(2020)).expect("encontrado");
        println!("{h:?}");
        assert!(h.main > 5.0 && h.main < 60.0);
    }
}
