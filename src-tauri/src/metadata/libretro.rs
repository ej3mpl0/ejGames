//! Carátulas de libretro-thumbnails para los juegos de consola: sin clave y por el
//! nombre del archivo (el de No-Intro/Redump, que es como suelen llamarse las ROMs).

use crate::db::models::Game;
use super::{ArtItem, Metadata};
use std::path::Path;

const BASE: &str = "https://thumbnails.libretro.com";

/// Nombre tal como lo guarda libretro: `&*/:`<>?\|"` pasan a `_`.
pub fn thumb_name(name: &str) -> String {
    name.chars().map(|c| if "&*/:`<>?\\|\"".contains(c) { '_' } else { c }).collect()
}

fn url(system: &str, kind: &str, name: &str) -> String {
    let enc = |s: &str| percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string();
    format!("{BASE}/{}/{kind}/{}.png", enc(system), enc(&thumb_name(name)))
}

/// Nombres a probar: el del archivo y, si no lleva región, con las habituales.
pub fn candidates(stem: &str) -> Vec<String> {
    let mut v = vec![stem.to_string()];
    if !stem.contains('(') {
        for r in ["USA", "Europe", "World", "Japan", "USA, Europe"] {
            v.push(format!("{stem} ({r})"));
        }
    }
    v
}

async fn exists(http: &reqwest::Client, u: &str) -> bool {
    http.head(u).timeout(std::time::Duration::from_secs(10)).send().await.is_ok_and(|r| r.status().is_success())
}

/// Añade portada (y una captura) si libretro las tiene. Devuelve si encontró la portada.
pub async fn fill(http: &reqwest::Client, g: &Game, m: &mut Metadata) -> bool {
    let Some(pf) = g.platform.as_deref().and_then(crate::emulation::platform).filter(|p| !p.libretro.is_empty()) else { return false };
    let Some(stem) = g.rom_path.as_deref().and_then(|r| Path::new(r).file_stem()).map(|s| s.to_string_lossy().into_owned()) else { return false };
    for name in candidates(&stem).iter().take(6) {
        let cover = url(pf.libretro, "Named_Boxarts", name);
        if exists(http, &cover).await {
            m.art.push(ArtItem::new("cover", cover, "libretro"));
            let snap = url(pf.libretro, "Named_Snaps", name);
            if exists(http, &snap).await {
                m.art.push(ArtItem::new("screenshot", snap.clone(), "libretro"));
                if !m.art.iter().any(|a| a.kind == "hero") {
                    m.art.push(ArtItem::new("hero", snap, "libretro"));
                }
            }
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_urls() {
        assert_eq!(thumb_name("Sonic & Knuckles: Edición?"), "Sonic _ Knuckles_ Edición_");
        assert_eq!(url("Nintendo - Super Nintendo Entertainment System", "Named_Boxarts", "Super Mario World (USA)"),
            "https://thumbnails.libretro.com/Nintendo%20%2D%20Super%20Nintendo%20Entertainment%20System/Named_Boxarts/Super%20Mario%20World%20%28USA%29.png");
        assert_eq!(candidates("Zelda (USA)").len(), 1);
        assert!(candidates("Zelda").contains(&"Zelda (Europe)".to_string()));
    }

    /// `cargo test --lib live_libretro -- --ignored`
    #[test]
    #[ignore]
    fn live_libretro() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let g = Game { platform: Some("snes".into()), rom_path: Some(r"D:\Super Mario World (USA).sfc".into()), ..Default::default() };
        let mut m = Metadata::default();
        assert!(rt.block_on(fill(&reqwest::Client::new(), &g, &mut m)));
        println!("{:?}", m.art.iter().map(|a| &a.url).collect::<Vec<_>>());
    }
}
