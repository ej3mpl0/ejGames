//! Idioma de la interfaz (español o inglés) para los textos que salen del núcleo:
//! errores, avisos, la bandeja… La clave es el propio texto en español, así que
//! sin traducción se ve el original. Diccionario: `i18n/en.json`.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

static EN: AtomicBool = AtomicBool::new(false);

fn dict() -> &'static HashMap<String, String> {
    static D: OnceLock<HashMap<String, String>> = OnceLock::new();
    D.get_or_init(|| serde_json::from_str(include_str!("../i18n/en.json")).unwrap_or_default())
}

/// "es" | "en": el ajuste, o el idioma de Windows si es "" (automático).
pub fn resolve(setting: &str) -> &'static str {
    match setting {
        "es" => "es",
        "en" => "en",
        _ => {
            if system_locale().to_lowercase().starts_with("es") {
                "es"
            } else {
                "en"
            }
        }
    }
}

pub fn set(setting: &str) {
    EN.store(resolve(setting) == "en", Ordering::Relaxed);
}

pub fn lang() -> &'static str {
    if EN.load(Ordering::Relaxed) {
        "en"
    } else {
        "es"
    }
}

pub fn is_en() -> bool {
    EN.load(Ordering::Relaxed)
}

/// Texto traducido.
pub fn t(s: &str) -> Cow<'_, str> {
    if is_en() {
        if let Some(v) = dict().get(s) {
            return Cow::Owned(v.clone());
        }
    }
    Cow::Borrowed(s)
}

/// Nombre de la configuración regional del usuario ("es-ES", "en-US"…).
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
    fn dictionary_parses() {
        assert!(!dict().is_empty());
    }
}
