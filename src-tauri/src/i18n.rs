//! Idioma de la interfaz. La clave es el texto en español; sin traducción se ve
//! el original. Diccionarios: `i18n/<lang>.json`.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::OnceLock;

/// Códigos que se pueden guardar, además de "" (el de Windows).
pub const CODES: [&str; 7] = ["es", "en", "de", "fr", "zh", "ja", "pt"];

static IDX: AtomicU8 = AtomicU8::new(0);

fn parse(json: &str) -> HashMap<String, String> {
    serde_json::from_str(json).unwrap_or_default()
}

fn dict_en() -> &'static HashMap<String, String> {
    static D: OnceLock<HashMap<String, String>> = OnceLock::new();
    D.get_or_init(|| parse(include_str!("../i18n/en.json")))
}
fn dict_de() -> &'static HashMap<String, String> {
    static D: OnceLock<HashMap<String, String>> = OnceLock::new();
    D.get_or_init(|| parse(include_str!("../i18n/de.json")))
}
fn dict_fr() -> &'static HashMap<String, String> {
    static D: OnceLock<HashMap<String, String>> = OnceLock::new();
    D.get_or_init(|| parse(include_str!("../i18n/fr.json")))
}
fn dict_zh() -> &'static HashMap<String, String> {
    static D: OnceLock<HashMap<String, String>> = OnceLock::new();
    D.get_or_init(|| parse(include_str!("../i18n/zh.json")))
}
fn dict_ja() -> &'static HashMap<String, String> {
    static D: OnceLock<HashMap<String, String>> = OnceLock::new();
    D.get_or_init(|| parse(include_str!("../i18n/ja.json")))
}
fn dict_pt() -> &'static HashMap<String, String> {
    static D: OnceLock<HashMap<String, String>> = OnceLock::new();
    D.get_or_init(|| parse(include_str!("../i18n/pt.json")))
}

fn dict_for(lang: &str) -> Option<&'static HashMap<String, String>> {
    match lang {
        "en" => Some(dict_en()),
        "de" => Some(dict_de()),
        "fr" => Some(dict_fr()),
        "zh" => Some(dict_zh()),
        "ja" => Some(dict_ja()),
        "pt" => Some(dict_pt()),
        _ => None,
    }
}

/// Código resuelto: el ajuste, o el de Windows si es "" u otro valor.
pub fn resolve(setting: &str) -> &'static str {
    match setting {
        "es" => "es",
        "en" => "en",
        "de" => "de",
        "fr" => "fr",
        "zh" => "zh",
        "ja" => "ja",
        "pt" => "pt",
        _ => from_system(),
    }
}

fn from_system() -> &'static str {
    let loc = system_locale().to_lowercase().replace('_', "-");
    match loc.split('-').next().unwrap_or("") {
        "es" => "es",
        "en" => "en",
        "de" => "de",
        "fr" => "fr",
        "zh" => "zh",
        "ja" => "ja",
        "pt" => "pt",
        _ => "en",
    }
}

pub fn set(setting: &str) {
    let code = resolve(setting);
    let idx = CODES.iter().position(|c| *c == code).unwrap_or(1) as u8;
    IDX.store(idx, Ordering::Relaxed);
}

pub fn lang() -> &'static str {
    CODES.get(IDX.load(Ordering::Relaxed) as usize).copied().unwrap_or("es")
}

/// Idioma de Steam que sigue a la interfaz.
pub fn steam_language(ui: &str) -> Option<&'static str> {
    match resolve(ui) {
        "es" => Some("spanish"),
        "en" => Some("english"),
        "de" => Some("german"),
        "fr" => Some("french"),
        "zh" => Some("schinese"),
        "ja" => Some("japanese"),
        "pt" => Some("brazilian"),
        _ => None,
    }
}

/// Descripciones que siguen solas al idioma de la interfaz (no un idioma elegido a mano, como el italiano).
pub fn steam_follows_ui(language: &str) -> bool {
    matches!(
        language,
        "spanish" | "english" | "german" | "french" | "brazilian" | "schinese" | "japanese"
    )
}

/// Texto traducido.
pub fn t(s: &str) -> Cow<'_, str> {
    if let Some(d) = dict_for(lang()) {
        if let Some(v) = d.get(s) {
            return Cow::Owned(v.clone());
        }
    }
    Cow::Borrowed(s)
}

/// Texto traducido con los huecos {0}, {1}… sustituidos por `args`.
pub fn tf(s: &str, args: &[&dyn std::fmt::Display]) -> String {
    let mut out = t(s).into_owned();
    for (i, a) in args.iter().enumerate() {
        out = out.replace(&format!("{{{i}}}"), &a.to_string());
    }
    out
}

/// Nombre de la configuración regional del usuario ("es-ES", "pt-BR"…).
pub fn system_locale() -> String {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Globalization::GetUserDefaultLocaleName;
        let mut buf = [0u16; 85];
        let n = GetUserDefaultLocaleName(&mut buf);
        if n > 1 {
            return String::from_utf16_lossy(&buf[..(n as usize - 1)]);
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dictionaries_match_english_keys() {
        let en = dict_for("en").unwrap();
        assert!(!en.is_empty());
        for code in ["de", "fr", "zh", "ja", "pt"] {
            let d = dict_for(code).unwrap_or_else(|| panic!("sin diccionario {code}"));
            assert_eq!(d.len(), en.len(), "{code}");
            for k in en.keys() {
                assert!(d.contains_key(k), "{code} sin {k}");
            }
        }
        assert_ne!(
            dict_for("de").unwrap().get("Abrir ejGames").map(String::as_str),
            Some("Open ejGames")
        );
    }

    #[test]
    fn resolve_keeps_explicit_codes() {
        for c in CODES {
            assert_eq!(resolve(c), c);
        }
    }
}
