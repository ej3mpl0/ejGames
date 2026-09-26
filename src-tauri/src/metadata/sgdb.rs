//! SteamGridDB (clave gratuita): arte alternativo y arte para juegos sin Steam.

use super::ratelimit::{self, RateLimiter};
use super::{ArtItem, Candidate};
use serde_json::{json, Value};
use std::time::Duration;

const API: &str = "https://www.steamgriddb.com/api/v2";

pub struct Sgdb {
    pub limit: RateLimiter,
}

impl Default for Sgdb {
    fn default() -> Self {
        Sgdb { limit: RateLimiter::new(Duration::from_millis(250)) }
    }
}

impl Sgdb {
    async fn get(&self, http: &reqwest::Client, key: &str, path: &str) -> anyhow::Result<Value> {
        let url = format!("{API}{path}");
        let r = ratelimit::get(http, &self.limit, || http.get(&url).bearer_auth(key)).await?;
        if r.status().as_u16() == 404 {
            return Ok(json!({ "success": false }));
        }
        if !r.status().is_success() {
            anyhow::bail!("SteamGridDB {}: {}", r.status(), path);
        }
        Ok(r.json().await?)
    }

    pub async fn game_by_steam(&self, http: &reqwest::Client, key: &str, appid: i64) -> anyhow::Result<Option<i64>> {
        let v = self.get(http, key, &format!("/games/steam/{appid}")).await?;
        Ok(v.pointer("/data/id").and_then(Value::as_i64))
    }

    pub async fn search(&self, http: &reqwest::Client, key: &str, term: &str) -> anyhow::Result<Vec<Candidate>> {
        let enc = percent_encoding::utf8_percent_encode(term, percent_encoding::NON_ALPHANUMERIC).to_string();
        let v = self.get(http, key, &format!("/search/autocomplete/{enc}")).await?;
        Ok(v.get("data")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|g| {
                        Some(Candidate {
                            provider: "sgdb".into(),
                            id: g.get("id")?.as_i64()?,
                            name: g.get("name")?.as_str()?.to_string(),
                            image: None,
                            year: g
                                .get("release_date")
                                .and_then(Value::as_i64)
                                .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                                .map(|d| d.format("%Y").to_string()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Arte de un tipo: cover (grids 2:3), hero, logo, icon.
    pub async fn art(&self, http: &reqwest::Client, key: &str, game: i64, kind: &str) -> anyhow::Result<Vec<ArtItem>> {
        let path = match kind {
            "cover" => format!("/grids/game/{game}?dimensions=600x900,342x482,660x930&types=static&nsfw=false"),
            "header" => format!("/grids/game/{game}?dimensions=460x215,920x430&types=static&nsfw=false"),
            "hero" => format!("/heroes/game/{game}?types=static&nsfw=false"),
            "logo" => format!("/logos/game/{game}?types=static&nsfw=false"),
            "icon" => format!("/icons/game/{game}?types=static&nsfw=false"),
            _ => return Ok(vec![]),
        };
        let v = self.get(http, key, &path).await?;
        Ok(v.get("data")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .take(40)
                    .filter_map(|x| {
                        let mut it = ArtItem::new(kind, x.get("url")?.as_str()?.to_string(), "sgdb");
                        it.extra = x.get("thumb").and_then(Value::as_str).map(|t| json!({ "thumb": t }));
                        it.title = x.pointer("/author/name").and_then(Value::as_str).map(str::to_string);
                        Some(it)
                    })
                    .collect()
            })
            .unwrap_or_default())
    }
}
