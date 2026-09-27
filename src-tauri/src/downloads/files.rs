//! Archivos de un repack: cuáles hacen falta siempre y cuáles se pueden dejar
//! sin bajar (idiomas y extras de la «descarga selectiva» de FitGirl).

use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

static CORE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(fg|setup-fitgirl)-\d+\.bin$").unwrap());
static SELECTIVE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(?:fg|setup-fitgirl)-selective-(.+)\.bin$").unwrap());
static OPTIONAL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(?:fg|setup-fitgirl)-optional-(.+)\.bin$").unwrap());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFile {
    pub index: usize,
    /// Ruta dentro del torrent ("MD5\\QuickSFV.exe").
    pub path: String,
    pub size: u64,
    /// setup | core | selective | optional | extra
    pub kind: &'static str,
    /// Nombre para mostrar ("Spanish", "Bonus content", "setup.exe").
    pub label: String,
    pub required: bool,
    pub selected: bool,
}

fn pretty(s: &str) -> String {
    let s = s.replace(['-', '_'], " ");
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

pub fn classify(index: usize, path: &str, size: u64) -> TorrentFile {
    let name = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let at_root = !path.contains(['\\', '/']);
    let (kind, label, required) = if at_root && name.eq_ignore_ascii_case("setup.exe") {
        ("setup", "setup.exe".to_string(), true)
    } else if let Some(c) = SELECTIVE.captures(name) {
        ("selective", pretty(&c[1]), false)
    } else if let Some(c) = OPTIONAL.captures(name) {
        ("optional", pretty(&c[1]), false)
    } else if CORE.is_match(name) {
        ("core", name.to_string(), true)
    } else {
        ("extra", name.to_string(), false)
    };
    TorrentFile {
        index,
        path: path.to_string(),
        size,
        kind,
        label,
        required,
        selected: kind != "optional" && kind != "selective",
    }
}

/// Selección inicial: todo lo necesario, los idiomas inglés y el del usuario,
/// y sin extras opcionales. Si no hay ninguno de esos idiomas, todos.
pub fn default_selection(files: &mut [TorrentFile], language: &str) {
    let lang = language.to_lowercase();
    let mut any_lang = false;
    for f in files.iter_mut().filter(|f| f.kind == "selective") {
        let l = f.label.to_lowercase();
        f.selected = l.contains("english") || (!lang.is_empty() && l.contains(&lang));
        any_lang |= f.selected;
    }
    if !any_lang {
        for f in files.iter_mut().filter(|f| f.kind == "selective") {
            f.selected = true;
        }
    }
}

/// Comprueba una selección: índices válidos, lo imprescindible dentro y al
/// menos un idioma si el repack los separa.
pub fn validate(files: &[TorrentFile], selected: &[usize]) -> anyhow::Result<Vec<usize>> {
    let mut sel: Vec<usize> = selected.iter().copied().filter(|i| *i < files.len()).collect();
    sel.sort_unstable();
    sel.dedup();
    for f in files.iter().filter(|f| f.required) {
        if !sel.contains(&f.index) {
            anyhow::bail!("Falta un archivo imprescindible: {}", f.label);
        }
    }
    let langs: Vec<&TorrentFile> = files.iter().filter(|f| f.kind == "selective").collect();
    if !langs.is_empty() && !langs.iter().any(|f| sel.contains(&f.index)) {
        anyhow::bail!("Elige al menos un idioma");
    }
    if sel.is_empty() {
        anyhow::bail!("No hay nada que descargar");
    }
    Ok(sel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list() -> Vec<TorrentFile> {
        [
            "setup.exe",
            "fg-01.bin",
            "fg-02.bin",
            "fg-selective-english.bin",
            "fg-selective-spanish.bin",
            "fg-selective-japanese.bin",
            "fg-optional-bonus-content.bin",
            "MD5\\QuickSFV.exe",
            "Verify BIN files before installation.bat",
        ]
        .iter()
        .enumerate()
        .map(|(i, p)| classify(i, p, 100))
        .collect()
    }

    #[test]
    fn kinds_and_defaults() {
        let mut f = list();
        default_selection(&mut f, "spanish");
        let kinds: Vec<&str> = f.iter().map(|x| x.kind).collect();
        assert_eq!(kinds, ["setup", "core", "core", "selective", "selective", "selective", "optional", "extra", "extra"]);
        assert_eq!(f[4].label, "Spanish");
        assert_eq!(f[6].label, "Bonus content");
        let sel: Vec<usize> = f.iter().filter(|x| x.selected).map(|x| x.index).collect();
        assert_eq!(sel, [0, 1, 2, 3, 4, 7, 8]);
        assert!(validate(&f, &sel).is_ok());
        assert!(validate(&f, &[1, 2, 3]).is_err(), "sin setup.exe");
        assert!(validate(&f, &[0, 1, 2]).is_err(), "sin idioma");
        // Un setup.exe dentro de una carpeta no es el instalador.
        assert_eq!(classify(0, "Redist\\setup.exe", 1).kind, "extra");
        assert_eq!(classify(0, "setup-fitgirl-selective-french.bin", 1).kind, "selective");
    }
}
