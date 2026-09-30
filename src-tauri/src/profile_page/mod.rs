//! El perfil al estilo Steam de cada perfil local: resumen, marco, fondo, tema,
//! vitrinas e insignia destacada (tabla `profile_page`), con el nombre y el
//! avatar del perfil local. Todo se queda en el PC: el nivel, las insignias y
//! la actividad salen de la biblioteca y del historial (`activity`).

pub mod summary;

use crate::db::models::{media_url, ProfilePatch, MEDIA_ORIGIN};
use crate::db::repo;
use crate::state::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};

const SHOWCASE_TYPES: [&str; 8] = ["featured", "favorite", "achievements", "stats", "recent", "text", "screenshots", "badges"];

#[derive(Debug, Clone, PartialEq)]
struct Page {
    real_name: String,
    country: String,
    bio: String,
    background_img: Option<String>,
    frame: String,
    background: String,
    color: String,
    showcases: Value,
    featured_badge: String,
}

impl Default for Page {
    fn default() -> Self {
        Page {
            real_name: String::new(),
            country: String::new(),
            bio: String::new(),
            background_img: None,
            frame: String::new(),
            background: String::new(),
            color: String::new(),
            showcases: json!([]),
            featured_badge: String::new(),
        }
    }
}

fn load(c: &Connection, profile_id: i64) -> rusqlite::Result<Page> {
    let page = c
        .query_row(
            "SELECT real_name, country, bio, background_img, frame, background, color, showcases, featured_badge FROM profile_page WHERE profile_id = ?1",
            [profile_id],
            |r| {
                Ok(Page {
                    real_name: r.get(0)?,
                    country: r.get(1)?,
                    bio: r.get(2)?,
                    background_img: r.get(3)?,
                    frame: r.get(4)?,
                    background: r.get(5)?,
                    color: r.get(6)?,
                    showcases: serde_json::from_str(&r.get::<_, String>(7)?).unwrap_or_else(|_| json!([])),
                    featured_badge: r.get(8)?,
                })
            },
        )
        .optional()?;
    let mut page = page.unwrap_or_default();
    // Lo que venga de antes (p. ej. capturas que estaban en el servidor) se limpia al leer.
    page.showcases = clean_showcases(&page.showcases);
    page.background_img = page.background_img.filter(|u| own_image(u));
    Ok(page)
}

fn save(c: &Connection, profile_id: i64, p: &Page) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO profile_page (profile_id, real_name, country, bio, background_img, frame, background, color, showcases, featured_badge, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT (profile_id) DO UPDATE SET real_name = excluded.real_name, country = excluded.country, bio = excluded.bio,
           background_img = excluded.background_img, frame = excluded.frame, background = excluded.background, color = excluded.color,
           showcases = excluded.showcases, featured_badge = excluded.featured_badge, updated_at = excluded.updated_at",
        params![
            profile_id,
            p.real_name,
            p.country,
            p.bio,
            p.background_img,
            p.frame,
            p.background,
            p.color,
            p.showcases.to_string(),
            p.featured_badge,
            crate::util::now()
        ],
    )?;
    Ok(())
}

/// Una imagen del almacén de medios de ejGames (las que guarda `image`).
fn own_image(url: &str) -> bool {
    url.len() < 200 && url.strip_prefix(MEDIA_ORIGIN).is_some_and(|rest| rest.starts_with("/m/"))
}

fn text(v: &Value, max: usize) -> String {
    v.as_str().unwrap_or_default().trim().chars().take(max).collect()
}

fn clean_showcases(list: &Value) -> Value {
    let mut out = vec![];
    for s in list.as_array().into_iter().flatten() {
        let Some(kind) = s["type"].as_str().filter(|t| SHOWCASE_TYPES.contains(t)) else { continue };
        // Una de cada tipo, como mucho seis.
        if out.len() >= 6 || out.iter().any(|x: &Value| x["type"] == kind) {
            continue;
        }
        let mut c = json!({ "type": kind });
        match kind {
            "text" => {
                c["title"] = json!(text(&s["title"], 60));
                c["text"] = json!(text(&s["text"], 2000));
            }
            "featured" | "favorite" => c["game"] = json!(text(&s["game"], 120)),
            "screenshots" => {
                let items: Vec<&str> = s["items"].as_array().into_iter().flatten().filter_map(|u| u.as_str()).filter(|u| own_image(u)).take(4).collect();
                c["items"] = json!(items);
            }
            _ => {}
        }
        out.push(c);
    }
    Value::Array(out)
}

/// La página de perfil del perfil local, tal como la pinta el kit
/// (`sdk/kit/profile.js`): nombre, avatar, nivel, insignias, vitrinas, juegos,
/// actividad y, si está jugando, a qué.
pub fn view(st: &AppState, profile_id: i64) -> anyhow::Result<Value> {
    let (prof, page, summary, activity) = st.db.with(|c| {
        let prof = repo::get_profile(c, profile_id)?;
        let page = load(c, profile_id)?;
        let summary = summary::build(c, profile_id, prof.created_at)?;
        let activity = crate::activity::recent(c, profile_id, 40)?;
        Ok((prof, page, summary, activity))
    })?;
    let playing = st.sessions.list().into_iter().find(|r| r.profile_id == profile_id);
    let presence = playing.map(|r| json!({ "status": "online", "game": r.title, "since": r.started_at }));
    Ok(json!({
        "id": profile_id,
        "name": prof.name,
        "memberSince": prof.created_at,
        "level": summary["level"],
        "xp": summary["xp"],
        "badges": summary["badges"],
        "profile": {
            "name": prof.name,
            "avatarUrl": prof.avatar,
            "realName": page.real_name,
            "country": page.country,
            "bio": page.bio,
            "backgroundImageUrl": page.background_img,
            "frame": page.frame,
            "background": page.background,
            "color": page.color,
            "showcases": page.showcases,
            "featuredBadge": page.featured_badge,
        },
        "summary": { "games": summary["games"], "stats": summary["stats"] },
        "activity": activity,
        "presence": presence,
    }))
}

/// Guarda los campos que llegan (los demás se quedan como estaban). `name` y
/// `avatarUrl` van al perfil local; el resto, a su página.
pub fn update(st: &AppState, profile_id: i64, patch: &Value) -> anyhow::Result<()> {
    let empty = Map::new();
    let p = patch.as_object().unwrap_or(&empty);
    let mut local = ProfilePatch::default();
    if let Some(v) = p.get("name") {
        let name = text(v, 32);
        if name.is_empty() {
            anyhow::bail!("El nombre no puede estar vacío.");
        }
        local.name = Some(name);
    }
    if let Some(v) = p.get("avatarUrl") {
        local.avatar = Some(match v.as_str() {
            Some(u) if own_image(u) => Some(u.to_string()),
            None => None,
            Some(_) => anyhow::bail!("Imagen no válida."),
        });
    }
    st.db.with(|c| {
        let mut page = load(c, profile_id)?;
        let before = page.clone();
        let field = |key: &str, max: usize, cur: &mut String| {
            if let Some(v) = p.get(key) {
                *cur = text(v, max);
            }
        };
        field("realName", 60, &mut page.real_name);
        field("bio", 1000, &mut page.bio);
        field("frame", 32, &mut page.frame);
        field("background", 32, &mut page.background);
        field("color", 32, &mut page.color);
        field("featuredBadge", 40, &mut page.featured_badge);
        if let Some(v) = p.get("country") {
            let cc = text(v, 2).to_ascii_uppercase();
            page.country = if cc.len() == 2 && cc.bytes().all(|b| b.is_ascii_uppercase()) { cc } else { String::new() };
        }
        if let Some(v) = p.get("backgroundImageUrl") {
            page.background_img = v.as_str().filter(|u| own_image(u)).map(str::to_string);
        }
        if let Some(v) = p.get("showcases") {
            page.showcases = clean_showcases(v);
        }
        repo::update_profile(c, profile_id, &local)?;
        if page != before {
            save(c, profile_id, &page)?;
        }
        Ok(())
    })
}

/// Tamaño de cada tipo de imagen: (ancho, alto, recortar para llenar).
fn image_spec(kind: &str) -> Option<(u32, u32, bool)> {
    match kind {
        "avatar" => Some((256, 256, true)),
        "background" => Some((1920, 1080, true)),
        "shot" => Some((1280, 720, false)),
        _ => None,
    }
}

/// Guarda una imagen del disco (avatar, fondo o captura para la vitrina) en
/// el almacén de medios y devuelve su URL ejg-media.
pub fn image(st: &AppState, kind: &str, path: &str) -> anyhow::Result<String> {
    let (w, h, fill) = image_spec(kind).ok_or_else(|| anyhow::anyhow!("Tipo de imagen no válido."))?;
    let img = image::ImageReader::open(path)?.with_guessed_format()?.decode().map_err(|e| anyhow::anyhow!("No se pudo leer la imagen: {e}"))?;
    let img = if fill { img.resize_to_fill(w, h, image::imageops::FilterType::Lanczos3) } else { img.resize(w, h, image::imageops::FilterType::Lanczos3) };
    let mut out = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 88).encode_image(&img.to_rgb8())?;
    let hash = crate::media::store::put(&st.paths, out.get_ref(), "jpg")?;
    Ok(media_url(&hash, "jpg"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn showcases_are_cleaned() {
        let img = format!("{MEDIA_ORIGIN}/m/abc.jpg");
        let v = clean_showcases(&json!([
            { "type": "text", "title": "  Hola ", "text": "x".repeat(3000) },
            { "type": "text", "title": "Otra" },
            { "type": "nope" },
            { "type": "screenshots", "items": [img, "ab".repeat(32), "https://example.com/a.jpg"] },
            { "type": "featured", "game": "Hades", "appid": 1 },
        ]));
        let list = v.as_array().unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0]["title"], "Hola");
        assert_eq!(list[0]["text"].as_str().unwrap().len(), 2000);
        assert_eq!(list[1]["items"], json!([img]));
        assert_eq!(list[2], json!({ "type": "featured", "game": "Hades" }));
    }

    #[test]
    fn page_round_trip() {
        let db = crate::db::Db::memory().unwrap();
        db.with(|c| {
            let pid = repo::create_profile(c, "Ana", "#fff", "steam")?;
            assert_eq!(load(c, pid)?, Page::default());
            let page = Page { bio: "Hola".into(), frame: "neon".into(), showcases: json!([{ "type": "stats" }]), ..Default::default() };
            save(c, pid, &page)?;
            assert_eq!(load(c, pid)?, page);
            Ok(())
        })
        .unwrap();
    }
}
