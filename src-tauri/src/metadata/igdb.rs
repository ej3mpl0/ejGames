//! IGDB (Twitch client credentials, gratis): metadatos de juegos fuera de Steam.

use super::ratelimit::{self, RateLimiter};
use super::{ArtItem, Candidate, Metadata};
use serde_json::Value;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const IMG: &str = "https://images.igdb.com/igdb/image/upload";
const FIELDS: &str = "fields name,summary,storyline,first_release_date,genres.name,themes.name,\
involved_companies.company.name,involved_companies.developer,involved_companies.publisher,\
cover.image_id,artworks.image_id,screenshots.image_id,total_rating,external_games.category,external_games.uid;";

pub struct Igdb {
    pub limit: RateLimiter,
    token: Mutex<Option<(String, Instant)>>,
}

impl Default for Igdb {
    fn default() -> Self {
        Igdb {
            limit: RateLimiter::new(Duration::from_millis(300)),
            token: Mutex::new(None),
        }
    }
}

impl Igdb {
    async fn token(&self, http: &reqwest::Client, id: &str, secret: &str) -> anyhow::Result<String> {
        let mut t = self.token.lock().await;
        if let Some((tok, exp)) = t.as_ref() {
            if Instant::now() < *exp {
                return Ok(tok.clone());
            }
        }
        let r: Value = http
            .post("https://id.twitch.tv/oauth2/token")
            .query(&[("client_id", id), ("client_secret", secret), ("grant_type", "client_credentials")])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let tok = r.get("access_token").and_then(Value::as_str).ok_or_else(|| anyhow::anyhow!("IGDB: sin token"))?.to_string();
        let secs = r.get("expires_in").and_then(Value::as_u64).unwrap_or(3600).saturating_sub(120);
        *t = Some((tok.clone(), Instant::now() + Duration::from_secs(secs)));
        Ok(tok)
    }

    async fn query(&self, http: &reqwest::Client, id: &str, secret: &str, body: String) -> anyhow::Result<Vec<Value>> {
        let tok = self.token(http, id, secret).await?;
        let r = ratelimit::get(http, &self.limit, || {
            http.post("https://api.igdb.com/v4/games")
                .header("Client-ID", id)
                .bearer_auth(&tok)
                .body(body.clone())
        })
        .await?
        .error_for_status()?;
        Ok(r.json::<Vec<Value>>().await?)
    }

    pub async fn search(&self, http: &reqwest::Client, id: &str, secret: &str, term: &str) -> anyhow::Result<Vec<Candidate>> {
        self.search_on(http, id, secret, term, None).await
    }

    /// Búsqueda limitada a una plataforma de IGDB (juegos de consola).
    pub async fn search_on(&self, http: &reqwest::Client, id: &str, secret: &str, term: &str, platform: Option<i64>) -> anyhow::Result<Vec<Candidate>> {
        let term = term.replace('"', "");
        let filter = platform.map(|p| format!("where platforms = ({p}); ")).unwrap_or_default();
        let rows = self.query(http, id, secret, format!("search \"{term}\"; {FIELDS} {filter}limit 10;")).await?;
        Ok(rows
            .iter()
            .filter_map(|g| {
                Some(Candidate {
                    provider: "igdb".into(),
                    id: g.get("id")?.as_i64()?,
                    name: g.get("name")?.as_str()?.to_string(),
                    image: g.pointer("/cover/image_id").and_then(Value::as_str).map(|i| format!("{IMG}/t_cover_small/{i}.jpg")),
                    year: g
                        .get("first_release_date")
                        .and_then(Value::as_i64)
                        .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                        .map(|d| d.format("%Y").to_string()),
                })
            })
            .collect())
    }

    pub async fn details(&self, http: &reqwest::Client, id: &str, secret: &str, game: i64) -> anyhow::Result<Option<Metadata>> {
        let rows = self.query(http, id, secret, format!("{FIELDS} where id = {game};")).await?;
        Ok(rows.first().map(to_metadata))
    }
}

pub fn to_metadata(g: &Value) -> Metadata {
    let names = |p: &str| -> Vec<String> {
        g.get(p)
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|x| x.get("name")?.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    let company = |role: &str| -> Option<String> {
        let v: Vec<String> = g
            .get("involved_companies")?
            .as_array()?
            .iter()
            .filter(|c| c.get(role).and_then(Value::as_bool) == Some(true))
            .filter_map(|c| c.pointer("/company/name")?.as_str().map(str::to_string))
            .take(2)
            .collect();
        (!v.is_empty()).then(|| v.join(", "))
    };
    let steam_appid = g.get("external_games").and_then(Value::as_array).and_then(|a| {
        a.iter()
            .find(|e| e.get("category").and_then(Value::as_i64) == Some(1))
            .and_then(|e| e.get("uid")?.as_str()?.parse().ok())
    });
    let mut m = Metadata {
        title: g.get("name").and_then(Value::as_str).map(str::to_string),
        description: g
            .get("summary")
            .and_then(Value::as_str)
            .map(|s| {
                let story = g.get("storyline").and_then(Value::as_str).unwrap_or("");
                if story.is_empty() { s.to_string() } else { format!("{s}\n\n{story}") }
            }),
        short_description: g.get("summary").and_then(Value::as_str).map(|s| s.chars().take(300).collect()),
        developer: company("developer"),
        publisher: company("publisher"),
        release_date: g
            .get("first_release_date")
            .and_then(Value::as_i64)
            .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
            .map(|d| d.format("%Y-%m-%d").to_string()),
        genres: names("genres"),
        tags: names("themes"),
        rating: g.get("total_rating").and_then(Value::as_f64).map(|r| r.round() as i64),
        igdb_id: g.get("id").and_then(Value::as_i64),
        steam_appid,
        ..Default::default()
    };
    if let Some(c) = g.pointer("/cover/image_id").and_then(Value::as_str) {
        m.art.push(ArtItem::new("cover", format!("{IMG}/t_cover_big_2x/{c}.jpg"), "igdb"));
    }
    if let Some(a) = g.pointer("/artworks/0/image_id").and_then(Value::as_str) {
        m.art.push(ArtItem::new("hero", format!("{IMG}/t_1080p/{a}.jpg"), "igdb"));
    }
    if let Some(arr) = g.get("screenshots").and_then(Value::as_array) {
        for (i, s) in arr.iter().enumerate() {
            if let Some(id) = s.get("image_id").and_then(Value::as_str) {
                let mut it = ArtItem::new("screenshot", format!("{IMG}/t_1080p/{id}.jpg"), "igdb");
                it.position = i as i64;
                it.extra = Some(serde_json::json!({ "thumb": format!("{IMG}/t_screenshot_med/{id}.jpg") }));
                m.art.push(it);
            }
        }
        if !m.art.iter().any(|a| a.kind == "hero") {
            if let Some(id) = arr.first().and_then(|s| s.get("image_id")).and_then(Value::as_str) {
                m.art.push(ArtItem::new("hero", format!("{IMG}/t_1080p/{id}.jpg"), "igdb"));
            }
        }
    }
    m
}
