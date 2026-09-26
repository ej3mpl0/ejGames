//! Steam sin clave: storesearch (buscar appid) + IStoreBrowseService/GetItems
//! (arte con rutas con hash, tráilers, descripción, tags, reseñas) en lotes.

use super::ratelimit::{self, RateLimiter};
use super::{ArtItem, Candidate, Metadata};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

pub const ASSETS_CDN: &str = "https://shared.fastly.steamstatic.com/store_item_assets/";
pub const VIDEO_CDN: &str = "https://video.fastly.steamstatic.com/store_trailers/";
pub const COMMUNITY_CDN: &str = "https://shared.fastly.steamstatic.com/community_assets/images/apps/";

/// Tags de Steam que son géneros "de verdad".
const GENRE_TAGS: &[i64] = &[
    19, 21, 122, 9, 492, 599, 701, 699, 597, 128, 113, 1774, 1663, 3799, 1625, 1628, 1664, 1716, 3959, 3810, 1667, 1677, 4106,
];

pub struct Steam {
    pub search_limit: RateLimiter,
    pub items_limit: RateLimiter,
}

impl Default for Steam {
    fn default() -> Self {
        Steam {
            search_limit: RateLimiter::new(Duration::from_millis(400)),
            items_limit: RateLimiter::new(Duration::from_millis(350)),
        }
    }
}

impl Steam {
    pub async fn search(&self, http: &reqwest::Client, term: &str, lang: &str, cc: &str) -> anyhow::Result<Vec<Candidate>> {
        let url = "https://store.steampowered.com/api/storesearch/";
        let r = ratelimit::get(http, &self.search_limit, || {
            http.get(url).query(&[("term", term), ("l", lang), ("cc", cc)])
        })
        .await?;
        let v: Value = r.json().await?;
        let items = v.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
        Ok(items
            .iter()
            .filter(|i| i.get("type").and_then(Value::as_str).unwrap_or("app") == "app")
            .filter_map(|i| {
                Some(Candidate {
                    provider: "steam".into(),
                    id: i.get("id")?.as_i64()?,
                    name: i.get("name")?.as_str()?.to_string(),
                    image: i.get("tiny_image").and_then(Value::as_str).map(str::to_string),
                    year: None,
                })
            })
            .collect())
    }

    /// GetItems en lotes de hasta 50 appids.
    pub async fn get_items(
        &self,
        http: &reqwest::Client,
        appids: &[i64],
        lang: &str,
        cc: &str,
    ) -> anyhow::Result<HashMap<i64, Value>> {
        let mut out = HashMap::new();
        for chunk in appids.chunks(50) {
            let input = json!({
                "ids": chunk.iter().map(|a| json!({"appid": a})).collect::<Vec<_>>(),
                "context": {"language": lang, "country_code": cc},
                "data_request": {
                    "include_assets": true, "include_trailers": true, "include_basic_info": true,
                    "include_release": true, "include_screenshots": true, "include_tag_count": 20,
                    "include_reviews": true, "include_full_description": true
                }
            })
            .to_string();
            let r = ratelimit::get(http, &self.items_limit, || {
                http.get("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/")
                    .query(&[("input_json", input.as_str())])
            })
            .await?;
            let v: Value = r.json().await?;
            if let Some(items) = v.pointer("/response/store_items").and_then(Value::as_array) {
                for it in items {
                    if it.get("success").and_then(Value::as_i64) == Some(1) {
                        if let Some(id) = it.get("appid").and_then(Value::as_i64) {
                            out.insert(id, it.clone());
                        }
                    }
                }
            }
        }
        Ok(out)
    }

    /// Tipo (0 = juego, 4 = DLC…) y nombre de muchos appids, sin arte (rápido).
    pub async fn app_types(
        &self,
        http: &reqwest::Client,
        appids: &[i64],
        lang: &str,
        cc: &str,
    ) -> anyhow::Result<HashMap<i64, (i64, String)>> {
        let mut out = HashMap::new();
        for chunk in appids.chunks(100) {
            let input = json!({
                "ids": chunk.iter().map(|a| json!({"appid": a})).collect::<Vec<_>>(),
                "context": {"language": lang, "country_code": cc},
                "data_request": {}
            })
            .to_string();
            let r = ratelimit::get(http, &self.items_limit, || {
                http.get("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/")
                    .query(&[("input_json", input.as_str())])
            })
            .await?;
            let v: Value = r.json().await?;
            let items = v.pointer("/response/store_items").and_then(Value::as_array).cloned().unwrap_or_default();
            for it in items {
                let Some(id) = it.get("appid").and_then(Value::as_i64).or_else(|| it.get("id").and_then(Value::as_i64)) else {
                    continue;
                };
                let ok = it.get("success").and_then(Value::as_i64) == Some(1);
                let ty = if ok { it.get("type").and_then(Value::as_i64).unwrap_or(-1) } else { -1 };
                let name = it.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
                out.insert(id, (ty, name));
            }
            for id in chunk {
                out.entry(*id).or_insert((-1, String::new()));
            }
        }
        Ok(out)
    }

    pub async fn tag_names(&self, http: &reqwest::Client, lang: &str) -> anyhow::Result<HashMap<i64, String>> {
        let r = ratelimit::get(http, &self.items_limit, || {
            http.get("https://api.steampowered.com/IStoreService/GetTagList/v1/").query(&[("language", lang)])
        })
        .await?;
        let v: Value = r.json().await?;
        Ok(v.pointer("/response/tags")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|t| Some((t.get("tagid")?.as_i64()?, t.get("name")?.as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default())
    }
}

static BB_MEDIA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[(img|video|previewyoutube)[^\]]*\].*?\[/(img|video|previewyoutube)\]|\[(img|video)[^\]]*\]").unwrap());
static BB_HEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)\[h\d\](.*?)\[/h\d\]").unwrap());
static BB_ITEM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\[\*\]").unwrap());
static BB_ITEM_P: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\[\*\]\s*\[p\]").unwrap());
static BB_ITEM_P_END: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\[/p\]\s*\[/\*\]").unwrap());
static BB_BLOCK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\[/?(p|list|olist|table|tr|quote|code|hr)\b[^\]]*\]").unwrap());
static BB_ANY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[/?[a-zA-Z0-9_*]+(=[^\]]*)?[^\]]*\]").unwrap());
static HTML_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());

fn decode_entities(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

/// BBCode de Steam → texto "markdown-lite" (## títulos, - viñetas, párrafos).
pub fn bbcode_to_text(bb: &str) -> String {
    let s = bb.replace('\r', "");
    let s = BB_ITEM_P.replace_all(&s, "[*]");
    let s = BB_ITEM_P_END.replace_all(&s, "[/*]");
    let s = BB_MEDIA.replace_all(&s, "");
    let s = BB_HEAD.replace_all(&s, "\n\n## $1\n\n");
    let s = BB_ITEM.replace_all(&s, "\n- ");
    let s = BB_BLOCK.replace_all(&s, "\n");
    let s = BB_ANY.replace_all(&s, "");
    let s = HTML_TAG.replace_all(&s, "");
    let s = decode_entities(&s);
    let mut out: Vec<String> = vec![];
    let mut blank = 0;
    for line in s.lines() {
        let l = line.trim();
        if l.is_empty() || l == "-" || l == "##" {
            blank += 1;
            continue;
        }
        if !out.is_empty() && (blank > 0 || l.starts_with("## ")) && !(l.starts_with("- ") && out.last().map(|p| p.starts_with("- ")).unwrap_or(false)) {
            out.push(String::new());
        }
        blank = 0;
        out.push(l.to_string());
    }
    out.join("\n").trim().to_string()
}

fn asset_url(item: &Value, file: &str) -> Option<String> {
    let fmt = item.pointer("/assets/asset_url_format")?.as_str()?;
    Some(format!("{ASSETS_CDN}{}", fmt.replace("${FILENAME}", file)))
}

/// Convierte un store_item de GetItems en metadatos + arte.
pub fn to_metadata(item: &Value, tags: &HashMap<i64, String>) -> Metadata {
    let appid = item.get("appid").and_then(Value::as_i64);
    let s = |p: &str| item.pointer(p).and_then(Value::as_str).map(str::to_string);
    let names = |p: &str| -> Option<String> {
        let v: Vec<String> = item
            .pointer(p)?
            .as_array()?
            .iter()
            .filter_map(|x| x.get("name")?.as_str().map(str::to_string))
            .take(2)
            .collect();
        (!v.is_empty()).then(|| v.join(", "))
    };
    let mut m = Metadata {
        title: s("/name"),
        short_description: s("/basic_info/short_description").map(|d| decode_entities(&d.replace('\r', "")).trim().to_string()),
        description: s("/full_description_bbcode").map(|b| bbcode_to_text(&b)).filter(|d| !d.is_empty()),
        developer: names("/basic_info/developers"),
        publisher: names("/basic_info/publishers"),
        steam_appid: appid,
        rating: item.pointer("/reviews/summary_filtered/percent_positive").and_then(Value::as_i64),
        ..Default::default()
    };
    if m.description.is_none() {
        m.description = m.short_description.clone();
    }
    if let Some(ts) = item
        .pointer("/release/steam_release_date")
        .or_else(|| item.pointer("/release/original_release_date"))
        .and_then(Value::as_i64)
    {
        m.release_date = chrono::DateTime::from_timestamp(ts, 0).map(|d| d.format("%Y-%m-%d").to_string());
    }

    // Tags ordenados por peso → nombres; géneros = tags de la lista de géneros.
    let mut weighted: Vec<(i64, i64)> = item
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|t| Some((t.get("tagid")?.as_i64()?, t.get("weight")?.as_i64()?))).collect())
        .unwrap_or_default();
    weighted.sort_by_key(|w| std::cmp::Reverse(w.1));
    let ids: Vec<i64> = if weighted.is_empty() {
        item.get("tagids").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default()
    } else {
        weighted.iter().map(|w| w.0).collect()
    };
    m.tags = ids.iter().filter_map(|id| tags.get(id).cloned()).take(12).collect();
    m.genres = ids.iter().filter(|id| GENRE_TAGS.contains(id)).filter_map(|id| tags.get(id).cloned()).take(4).collect();
    if m.genres.is_empty() {
        m.genres = m.tags.iter().take(2).cloned().collect();
    }

    let Some(appid) = appid else { return m };
    let a = |k: &str| s(&format!("/assets/{k}"));

    // Portada 2:3.
    if let Some(f) = a("library_capsule_2x").or_else(|| a("library_capsule")) {
        if let Some(u) = asset_url(item, &f) {
            m.art.push(ArtItem::new("cover", u, "steam"));
        }
    }
    // Hero + logo (el logo vive junto al hero cuando las rutas llevan hash).
    if let Some(f) = a("library_hero") {
        if let Some(u) = asset_url(item, &f) {
            m.art.push(ArtItem::new("hero", u, "steam"));
        }
        let folder = f.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
        let mut logos = vec![format!("{folder}logo_2x.png"), format!("{folder}logo.png")];
        if !folder.is_empty() {
            logos.push("logo.png".into());
        }
        for l in logos {
            if let Some(u) = asset_url(item, &l) {
                m.logo_candidates.push(u);
            }
        }
    } else if let Some(u) = a("page_background").and_then(|f| asset_url(item, &f)) {
        m.art.push(ArtItem::new("hero", u, "steam"));
    }
    if let Some(u) = a("header").and_then(|f| asset_url(item, &f)) {
        m.art.push(ArtItem::new("header", u, "steam"));
    }
    if let Some(h) = a("community_icon") {
        m.art.push(ArtItem::new("icon", format!("{COMMUNITY_CDN}{appid}/{h}.jpg"), "steam"));
    }

    // Capturas (todas, ordenadas por ordinal).
    let mut shots: Vec<(i64, String)> = vec![];
    for key in ["all_ages_screenshots", "mature_content_screenshots"] {
        if let Some(arr) = item.pointer(&format!("/screenshots/{key}")).and_then(Value::as_array) {
            for sct in arr {
                if let (Some(f), Some(o)) = (sct.get("filename").and_then(Value::as_str), sct.get("ordinal").and_then(Value::as_i64)) {
                    shots.push((o, f.to_string()));
                }
            }
        }
    }
    shots.sort();
    for (pos, (_, f)) in shots.iter().enumerate() {
        let full = format!("{ASSETS_CDN}{f}");
        let thumb = full.replacen(".jpg", ".600x338.jpg", 1);
        let mut it = ArtItem::new("screenshot", full, "steam");
        it.position = pos as i64;
        it.extra = Some(json!({ "thumb": thumb }));
        m.art.push(it);
    }

    // Tráilers: HLS H.264 + microtrailer del primero.
    let mut pos = 0;
    for key in ["highlights", "other_trailers"] {
        let Some(arr) = item.pointer(&format!("/trailers/{key}")).and_then(Value::as_array) else { continue };
        for t in arr {
            let hls = t
                .get("adaptive_trailers")
                .and_then(Value::as_array)
                .and_then(|a| a.iter().find(|x| x.get("encoding").and_then(Value::as_str) == Some("hls_h264")))
                .and_then(|x| x.get("cdn_path").and_then(Value::as_str));
            let poster = t.get("screenshot_full").and_then(Value::as_str).map(|p| format!("{ASSETS_CDN}steam/apps/{p}"));
            let name = t.get("trailer_name").and_then(Value::as_str).map(str::to_string);
            if let Some(h) = hls {
                let mut it = ArtItem::new("trailer", format!("{VIDEO_CDN}{h}"), "steam");
                it.title = name.clone();
                it.position = pos;
                it.extra = poster.as_ref().map(|p| json!({ "poster": p }));
                m.art.push(it);
                pos += 1;
            }
            let has_micro = m.art.iter().any(|x| x.kind == "microtrailer");
            if !has_micro {
                if let Some(mp4) = t
                    .get("microtrailer")
                    .and_then(Value::as_array)
                    .and_then(|a| a.iter().find(|x| x.get("type").and_then(Value::as_str) == Some("video/mp4")))
                    .and_then(|x| x.get("filename").and_then(Value::as_str))
                {
                    m.art.push(ArtItem::new("microtrailer", format!("{VIDEO_CDN}{mp4}"), "steam"));
                }
            }
        }
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bbcode() {
        let bb = "[h2]Título[/h2][p]\r\nHola [b]mundo[/b].[/p][p][img src=\"{STEAM_APP_IMAGE}/x.avif\"][/img][/p][list][*][p]Uno[/p][/*][*][p]Dos[/p][/*][/list][p]Fin &quot;ok&quot;[/p]";
        let t = bbcode_to_text(bb);
        assert_eq!(t, "## Título\n\nHola mundo.\n\n- Uno\n- Dos\n\nFin \"ok\"");
    }

    #[test]
    fn items_to_metadata() {
        let item = json!({
            "appid": 1245620, "name": "ELDEN RING",
            "basic_info": {"short_description": "Juego", "developers": [{"name": "FromSoftware, Inc."}], "publishers": [{"name": "Bandai"}]},
            "release": {"steam_release_date": 1645744078},
            "tags": [{"tagid": 122, "weight": 10}, {"tagid": 29482, "weight": 20}],
            "reviews": {"summary_filtered": {"percent_positive": 93}},
            "assets": {"asset_url_format": "steam/apps/1245620/${FILENAME}?t=1", "library_capsule_2x": "library_600x900_2x.jpg",
                       "library_hero": "abc/library_hero.jpg", "header": "h/header.jpg", "community_icon": "ic"},
            "screenshots": {"all_ages_screenshots": [{"filename": "steam/apps/1245620/ss_1.jpg?t=1", "ordinal": 1}]},
            "trailers": {"highlights": [{"trailer_name": "Launch",
                "microtrailer": [{"filename": "1245620/1/h/1/microtrailer.mp4", "type": "video/mp4"}],
                "adaptive_trailers": [{"cdn_path": "1245620/1/h/1/hls_264_master.m3u8", "encoding": "hls_h264"}],
                "screenshot_full": "999/movie_full.jpg"}]}
        });
        let tags: HashMap<i64, String> = [(122, "Rol".to_string()), (29482, "Souls-like".to_string())].into();
        let m = to_metadata(&item, &tags);
        assert_eq!(m.tags, vec!["Souls-like", "Rol"]);
        assert_eq!(m.genres, vec!["Rol"]);
        assert_eq!(m.release_date.as_deref(), Some("2022-02-24"));
        assert_eq!(m.rating, Some(93));
        let cover = m.art.iter().find(|a| a.kind == "cover").unwrap();
        assert_eq!(cover.url, "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/library_600x900_2x.jpg?t=1");
        assert_eq!(m.logo_candidates[0], "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/abc/logo_2x.png?t=1");
        let tr = m.art.iter().find(|a| a.kind == "trailer").unwrap();
        assert_eq!(tr.url, "https://video.fastly.steamstatic.com/store_trailers/1245620/1/h/1/hls_264_master.m3u8");
        assert!(m.art.iter().any(|a| a.kind == "microtrailer" && a.url.ends_with("microtrailer.mp4")));
        let ss = m.art.iter().find(|a| a.kind == "screenshot").unwrap();
        assert_eq!(ss.extra.as_ref().unwrap()["thumb"], "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/ss_1.600x338.jpg?t=1");
    }
}
