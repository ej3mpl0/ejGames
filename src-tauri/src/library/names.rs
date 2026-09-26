//! Limpieza y normalización de nombres de juegos (títulos de carpeta, exes y
//! búsqueda de metadatos).

use regex::Regex;
use std::sync::LazyLock;

static BRACKETS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\[\(\{][^\]\)\}]*[\]\)\}]").unwrap());
static VERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(v|ver|version|build)\.?\s?\d+([._]\d+)*[a-z]?\b|\b\d+\.\d+(\.\d+)+\b|\b\d+\.\d{2,}\b").unwrap()
});
static RELEASE_TAGS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(repack|fitgirl|dodi|elamigos|codex|plaza|skidrow|empress|reloaded|cpy|flt|tenoke|rune|razor1911|gog|steamrip|portable|multi\d*|x64|x86|win64|win32|windows|pc|dlcs?|update|incl|proper|rip|p2p|64 ?bits?|32 ?bits?)\b",
    )
    .unwrap()
});
/// Versión al final de un nombre de carpeta: "juego-1.6", "juego_v2.0.1".
static TRAILING_VER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)[-_ .]v?\d+(?:[._]\d+)+[a-z]?$").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static NON_ALNUM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}]+").unwrap());
static EDITION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(game of the year|goty|definitive|remastered|remaster|deluxe|complete|ultimate|enhanced|directors cut|director s cut|gold|premium|anniversary|digital|special|collectors|legendary|standard|edition|bundle|collection|pack)\b",
    )
    .unwrap()
});
static CAMEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([a-z])([A-Z])").unwrap());

/// Nombre de carpeta → título presentable ("Hollow.Knight.v1.5-GOG" → "Hollow Knight").
pub fn clean_title(raw: &str) -> String {
    // Versiones antes de tocar los puntos ("v1.5.78" se reconoce entero).
    let s = BRACKETS.replace_all(raw, " ");
    let s = TRAILING_VER.replace(s.trim(), "");
    let s = VERSION.replace_all(&s, " ");
    let mut s = s.replace('_', " ");
    if !raw.contains(' ') {
        s = s.replace('.', " ");
        // "fnaf-world-refreshed": nombre con guiones como separadores (pero
        // "Half-Life" se queda como está).
        if s.matches('-').count() >= 2 {
            s = s.replace('-', " ");
        }
    }
    let s = RELEASE_TAGS.replace_all(&s, " ");
    let s = SPACES.replace_all(&s, " ");
    let s = s.trim().trim_matches(|c: char| c == '-' || c == '.' || c == ' ' || c == '+');
    if s.is_empty() {
        return raw.trim().to_string();
    }
    // Todo en minúsculas ("funkin"): mayúscula inicial en cada palabra.
    if !s.chars().any(|c| c.is_uppercase()) {
        return s
            .split(' ')
            .map(|w| {
                let mut ch = w.chars();
                ch.next().map(|f| f.to_uppercase().chain(ch).collect::<String>()).unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" ");
    }
    s.to_string()
}

/// Separa CamelCase ("HollowKnight" → "Hollow Knight"), útil para stems de exe.
pub fn split_camel(s: &str) -> String {
    CAMEL.replace_all(s, "$1 $2").to_string()
}

fn roman_to_arabic(w: &str) -> Option<&'static str> {
    Some(match w {
        "ii" => "2",
        "iii" => "3",
        "iv" => "4",
        "v" => "5",
        "vi" => "6",
        "vii" => "7",
        "viii" => "8",
        "ix" => "9",
        "x" => "10",
        "xi" => "11",
        "xii" => "12",
        "xiii" => "13",
        "xiv" => "14",
        "xv" => "15",
        "xvi" => "16",
        _ => return None,
    })
}

/// Forma canónica para comparar títulos.
pub fn normalize(s: &str) -> String {
    let s = s
        .replace(['™', '®', '©'], "")
        .replace('&', " and ")
        .replace(['\'', '’'], "");
    let s = split_camel(&s).to_lowercase();
    let s = NON_ALNUM.replace_all(&s, " ");
    let s = EDITION.replace_all(&s, " ");
    let words: Vec<String> = s
        .split_whitespace()
        .map(|w| roman_to_arabic(w).map(str::to_string).unwrap_or_else(|| w.to_string()))
        .collect();
    let mut out = words.join(" ");
    if let Some(rest) = out.strip_prefix("the ") {
        out = rest.to_string();
    }
    out
}

/// Similitud [0,1] entre dos títulos ya normalizados o no.
pub fn similarity(a: &str, b: &str) -> f64 {
    let (a, b) = (normalize(a), normalize(b));
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    let compact = |s: &str| s.replace(' ', "");
    if compact(&a) == compact(&b) {
        return 0.98;
    }
    let jw = strsim::jaro_winkler(&a, &b);
    // Penaliza que uno sea una secuela del otro ("dark souls" vs "dark souls 3").
    let digits = |s: &str| s.split_whitespace().filter(|w| w.chars().all(|c| c.is_ascii_digit())).collect::<Vec<_>>().join(" ");
    if digits(&a) != digits(&b) {
        return jw * 0.85;
    }
    jw
}

/// Nombres de producto que no dicen nada del juego.
pub fn is_generic_name(s: &str) -> bool {
    let n = s.trim().to_lowercase();
    const GENERIC: &[&str] = &[
        "", "unity", "unity player", "unreal", "unreal engine", "ue4", "ue5", "ue4 game", "ue5 game",
        "unrealgame", "bootstrappackagedgame", "bootstrap", "game", "launcher", "godot", "godot engine",
        "gamemaker", "game maker", "rpg maker", "rpgmaker", "nw.js", "nwjs", "electron", "renpy",
        "ren'py", "love", "love2d", "shipping", "windows", "application", "app", "setup", "installer",
        "microsoft", "directx", "java", "javaw", "python", "mono", "win64", "x64", "main", "start",
        "play", "client", "project", "mygame", "my project", "new unity project", "template",
    ];
    GENERIC.contains(&n.as_str()) || n.len() > 70
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_titles() {
        assert_eq!(clean_title("Hollow.Knight.v1.5.78-GOG"), "Hollow Knight");
        assert_eq!(clean_title("Celeste [FitGirl Repack]"), "Celeste");
        assert_eq!(clean_title("Hades II (v0.95)"), "Hades II");
        assert_eq!(clean_title("Stardew_Valley"), "Stardew Valley");
        assert_eq!(clean_title("S.T.A.L.K.E.R. 2"), "S.T.A.L.K.E.R. 2");
        assert_eq!(clean_title("fnaf-world-refreshed-1.6"), "Fnaf World Refreshed");
        assert_eq!(clean_title("funkin-windows-64bit"), "Funkin");
        assert_eq!(clean_title("Half-Life"), "Half-Life");
        assert_eq!(clean_title("SILENT HILL - Townfall"), "SILENT HILL - Townfall");
    }

    #[test]
    fn normalize_titles() {
        assert_eq!(normalize("DOOM Eternal™ Deluxe Edition"), "doom eternal");
        assert_eq!(normalize("Final Fantasy VII"), normalize("Final Fantasy 7"));
        assert_eq!(normalize("The Witcher 3: Wild Hunt - Game of the Year Edition"), "witcher 3 wild hunt");
        assert_eq!(normalize("HollowKnight"), "hollow knight");
        assert_eq!(normalize("Baldur's Gate 3"), "baldurs gate 3");
    }

    #[test]
    fn similarity_prefers_exact_sequel() {
        assert!(similarity("Dark Souls III", "DARK SOULS™ III") > 0.99);
        assert!(similarity("Dark Souls III", "Dark Souls II") < 0.9);
        assert!(similarity("hollow_knight", "Hollow Knight") > 0.95);
    }
}
