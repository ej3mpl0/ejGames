//! Plataformas de los catálogos. Los catálogos (y `catalog-sources.json`) usan
//! nombres legibles («ps1», «gamecube», «ps-vita»…); el resto de ejGames usa los de
//! `emulation::PLATFORMS` («psx», «gc», «vita»…). Aquí se traduce de uno a otro y se
//! reconoce la plataforma en los textos y las URLs de una web.

use std::collections::HashMap;

/// (id del catálogo, id de ejGames si se puede emular, nombre).
pub const ALL: &[(&str, Option<&str>, &str)] = &[
    ("switch", Some("switch"), "Nintendo Switch"),
    ("wii-u", Some("wiiu"), "Wii U"),
    ("wii", Some("wii"), "Wii"),
    ("gamecube", Some("gc"), "GameCube"),
    ("n64", Some("n64"), "Nintendo 64"),
    ("snes", Some("snes"), "Super Nintendo"),
    ("nes", Some("nes"), "NES"),
    ("gba", Some("gba"), "Game Boy Advance"),
    ("gbc", Some("gbc"), "Game Boy Color"),
    ("gb", Some("gb"), "Game Boy"),
    ("ds", Some("nds"), "Nintendo DS"),
    ("3ds", Some("3ds"), "Nintendo 3DS"),
    ("ps1", Some("psx"), "PlayStation"),
    ("ps2", Some("ps2"), "PlayStation 2"),
    ("ps3", Some("ps3"), "PlayStation 3"),
    ("ps4", None, "PlayStation 4"),
    ("ps5", None, "PlayStation 5"),
    ("psp", Some("psp"), "PSP"),
    ("ps-vita", Some("vita"), "PS Vita"),
    ("xbox", Some("xbox"), "Xbox"),
    ("xbox-360", Some("xbox360"), "Xbox 360"),
    ("xbox-one", None, "Xbox One"),
    ("genesis", Some("genesis"), "Mega Drive / Genesis"),
    ("saturn", Some("saturn"), "Sega Saturn"),
    ("dreamcast", Some("dreamcast"), "Dreamcast"),
    ("master-system", Some("sms"), "Master System"),
    ("game-gear", Some("gg"), "Game Gear"),
    ("neo-geo", Some("arcade"), "Neo Geo"),
    ("arcade", Some("arcade"), "Arcade"),
    ("mame", Some("arcade"), "MAME"),
    ("pc-engine", Some("pce"), "PC Engine"),
    ("turbografx", Some("pce"), "TurboGrafx-16"),
    ("wonderswan", Some("wonderswan"), "WonderSwan"),
    ("pc", None, "PC"),
    ("dos", None, "MS-DOS"),
    ("windows", None, "Windows"),
];

/// Otros nombres con que las webs llaman a cada plataforma (en minúsculas, sin signos).
const NAMES: &[(&str, &str)] = &[
    ("nintendo switch", "switch"),
    ("switch", "switch"),
    ("nsw", "switch"),
    ("wii u", "wii-u"),
    ("wiiu", "wii-u"),
    ("nintendo wii", "wii"),
    ("wii", "wii"),
    ("gamecube", "gamecube"),
    ("game cube", "gamecube"),
    ("ngc", "gamecube"),
    ("nintendo 64", "n64"),
    ("n64", "n64"),
    ("super nintendo", "snes"),
    ("super famicom", "snes"),
    ("snes", "snes"),
    ("sfc", "snes"),
    ("nintendo entertainment system", "nes"),
    ("famicom", "nes"),
    ("nes", "nes"),
    ("game boy advance", "gba"),
    ("gameboy advance", "gba"),
    ("gba", "gba"),
    ("game boy color", "gbc"),
    ("gameboy color", "gbc"),
    ("gbc", "gbc"),
    ("game boy", "gb"),
    ("gameboy", "gb"),
    ("gb", "gb"),
    ("nintendo ds", "ds"),
    ("nds", "ds"),
    ("ds", "ds"),
    ("nintendo 3ds", "3ds"),
    ("3ds", "3ds"),
    ("playstation 1", "ps1"),
    ("playstation one", "ps1"),
    ("playstation", "ps1"),
    ("psx", "ps1"),
    ("ps1", "ps1"),
    ("psone", "ps1"),
    ("playstation 2", "ps2"),
    ("ps2", "ps2"),
    ("playstation 3", "ps3"),
    ("ps3", "ps3"),
    ("playstation 4", "ps4"),
    ("ps4", "ps4"),
    ("playstation 5", "ps5"),
    ("ps5", "ps5"),
    ("playstation portable", "psp"),
    ("psp", "psp"),
    ("playstation vita", "ps-vita"),
    ("ps vita", "ps-vita"),
    ("psvita", "ps-vita"),
    ("vita", "ps-vita"),
    ("psv", "ps-vita"),
    ("xbox 360", "xbox-360"),
    ("xbox360", "xbox-360"),
    ("x360", "xbox-360"),
    ("xbox one", "xbox-one"),
    ("xbox", "xbox"),
    ("sega genesis", "genesis"),
    ("mega drive", "genesis"),
    ("megadrive", "genesis"),
    ("genesis", "genesis"),
    ("sega saturn", "saturn"),
    ("saturn", "saturn"),
    ("sega dreamcast", "dreamcast"),
    ("dreamcast", "dreamcast"),
    ("master system", "master-system"),
    ("sms", "master-system"),
    ("game gear", "game-gear"),
    ("gamegear", "game-gear"),
    ("neo geo", "neo-geo"),
    ("neogeo", "neo-geo"),
    ("arcade", "arcade"),
    ("mame", "mame"),
    ("fbneo", "arcade"),
    ("pc engine", "pc-engine"),
    ("pcengine", "pc-engine"),
    ("turbografx 16", "turbografx"),
    ("turbografx", "turbografx"),
    ("tg16", "turbografx"),
    ("wonderswan color", "wonderswan"),
    ("wonderswan", "wonderswan"),
    ("ms dos", "dos"),
    ("msdos", "dos"),
    ("dos", "dos"),
    ("windows", "windows"),
    ("pc", "pc"),
];

/// Palabras que acompañan a la plataforma en una URL («/switch-games/», «/roms/ps2/»).
const URL_NOISE: &[&str] = &["games", "game", "roms", "rom", "isos", "iso", "juegos", "juego", "downloads", "download", "list", "all", "category", "console", "consoles"];

/// El id de ejGames de una plataforma (acepta los dos nombres). None si no se emula.
pub fn internal(id: &str) -> Option<&'static str> {
    let id = id.trim().to_ascii_lowercase();
    ALL.iter().find(|(e, i, _)| *e == id || i.is_some_and(|i| i == id)).and_then(|(_, i, _)| *i)
}

/// El id de catálogo de una plataforma (acepta los dos nombres).
pub fn external(id: &str) -> Option<&'static str> {
    let id = id.trim().to_ascii_lowercase();
    ALL.iter().find(|(e, i, _)| *e == id || i.is_some_and(|i| i == id)).map(|(e, _, _)| *e)
}

pub fn name(external_id: &str) -> &'static str {
    ALL.iter().find(|(e, _, _)| *e == external_id).map(|(_, _, n)| *n).unwrap_or("")
}

/// Texto en minúsculas con los signos convertidos en espacios («PS-Vita» → «ps vita»).
fn words(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = true;
    for c in s.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
            space = false;
        } else if !space {
            out.push(' ');
            space = true;
        }
    }
    out.trim_end().to_string()
}

fn contains_words(hay: &str, needle: &str) -> bool {
    let (h, n) = ([" ", hay, " "].concat(), [" ", needle, " "].concat());
    h.contains(&n)
}

/// La plataforma de un texto de la web («Nintendo Switch», «PS2 ISO»…): primero el mapa
/// de la fuente (exacto y después contenido, de la clave más larga a la más corta),
/// después los nombres conocidos.
pub fn detect(text: &str, mapping: &HashMap<String, String>) -> Option<&'static str> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let w = words(t);
    for (k, v) in mapping {
        if k.trim().eq_ignore_ascii_case(t) || words(k) == w {
            if let Some(e) = external(v) {
                return Some(e);
            }
        }
    }
    let mut keys: Vec<(&String, &String)> = mapping.iter().collect();
    keys.sort_by_key(|(k, _)| std::cmp::Reverse(k.len()));
    for (k, v) in keys {
        let kw = words(k);
        if !kw.is_empty() && contains_words(&w, &kw) {
            if let Some(e) = external(v) {
                return Some(e);
            }
        }
    }
    if let Some(e) = external(&w.replace(' ', "-")) {
        return Some(e);
    }
    let mut names: Vec<&(&str, &str)> = NAMES.iter().collect();
    names.sort_by_key(|(n, _)| std::cmp::Reverse(n.len()));
    names.into_iter().find(|(n, _)| contains_words(&w, n)).map(|(_, e)| *e)
}

/// La plataforma por la URL: cada tramo de la ruta, sin las palabras de relleno.
pub fn from_url(url: &str, mapping: &HashMap<String, String>) -> Option<&'static str> {
    let path = url::Url::parse(url).map(|u| u.path().to_string()).unwrap_or_else(|_| url.to_string());
    for seg in path.split('/').filter(|s| !s.is_empty()) {
        let seg = percent_encoding::percent_decode_str(seg).decode_utf8_lossy();
        let w: Vec<String> = words(&seg).split(' ').filter(|x| !x.is_empty() && !URL_NOISE.contains(x)).map(str::to_string).collect();
        if w.is_empty() || w.len() > 4 {
            continue;
        }
        let joined = w.join(" ");
        // Un tramo entero que es una plataforma (no un título que la menciona).
        if let Some(e) = mapping.iter().find(|(k, _)| words(k) == joined).and_then(|(_, v)| external(v)) {
            return Some(e);
        }
        if let Some(e) = external(&w.join("-")) {
            return Some(e);
        }
        if let Some((_, e)) = NAMES.iter().find(|(n, _)| *n == joined) {
            return Some(e);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_both_ways() {
        assert_eq!(internal("ps1"), Some("psx"));
        assert_eq!(internal("psx"), Some("psx"));
        assert_eq!(internal("ps-vita"), Some("vita"));
        assert_eq!(internal("ps4"), None);
        assert_eq!(external("gc"), Some("gamecube"));
        assert_eq!(external("wiiu"), Some("wii-u"));
        for (_, i, _) in ALL {
            if let Some(i) = i {
                assert!(crate::emulation::platform(i).is_some(), "{i}");
            }
        }
    }

    #[test]
    fn detects_in_text_with_the_source_map_first() {
        let mut m = HashMap::new();
        m.insert("Wii".to_string(), "wii".to_string());
        m.insert("Wii U".to_string(), "wii-u".to_string());
        m.insert("PlayStation".to_string(), "ps1".to_string());
        m.insert("Consola X".to_string(), "dreamcast".to_string());
        assert_eq!(detect("Wii U", &m), Some("wii-u"));
        assert_eq!(detect("  wii  ", &m), Some("wii"));
        assert_eq!(detect("Juegos de Wii U (EUR)", &m), Some("wii-u"));
        assert_eq!(detect("consola-x", &m), Some("dreamcast"));
        let none = HashMap::new();
        assert_eq!(detect("Sony PlayStation 2", &none), Some("ps2"));
        assert_eq!(detect("PS Vita", &none), Some("ps-vita"));
        assert_eq!(detect("Nintendo Switch", &none), Some("switch"));
        assert_eq!(detect("Xbox 360", &none), Some("xbox-360"));
        assert_eq!(detect("Algo sin plataforma", &none), None);
    }

    #[test]
    fn detects_in_urls() {
        let none = HashMap::new();
        assert_eq!(from_url("https://x.org/switch-games/zelda/", &none), Some("switch"));
        assert_eq!(from_url("https://x.org/roms/playstation-2/page/2", &none), Some("ps2"));
        assert_eq!(from_url("https://x.org/category/ps-vita/", &none), Some("ps-vita"));
        assert_eq!(from_url("https://x.org/game/super-mario-world", &none), None);
    }
}
