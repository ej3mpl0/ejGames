//! Lectura de cabeceras PE (mmap, sin copiar el exe a memoria): VersionInfo,
//! subsistema, arquitectura e icono.

use pelite::{FileMap, PeFile, Wrap};
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct PeInfo {
    pub product_name: Option<String>,
    pub file_description: Option<String>,
    pub company: Option<String>,
    pub gui: bool,
    pub x64: bool,
    pub has_icon: bool,
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().trim_matches('\0').trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn read(path: &Path) -> Option<PeInfo> {
    let map = FileMap::open(path).ok()?;
    let pe = PeFile::from_bytes(&map).ok()?;
    let x64 = pe.file_header().Machine == 0x8664 || pe.file_header().Machine == 0xAA64;
    let subsystem = match pe.optional_header() {
        Wrap::T32(h) => h.Subsystem,
        Wrap::T64(h) => h.Subsystem,
    };
    let mut info = PeInfo {
        gui: subsystem == 2,
        x64,
        ..Default::default()
    };
    if let Ok(res) = pe.resources() {
        info.has_icon = res.icons().next().is_some();
        if let Ok(vi) = res.version_info() {
            // Primer idioma declarado; si no hay, inglés US/Unicode.
            let langs = vi.translation();
            let lang = langs.first().copied().unwrap_or(pelite::resources::version_info::Language {
                lang_id: 0x0409,
                charset_id: 0x04B0,
            });
            info.product_name = clean(vi.value(lang, "ProductName"));
            info.file_description = clean(vi.value(lang, "FileDescription"));
            info.company = clean(vi.value(lang, "CompanyName"));
        }
    }
    Some(info)
}

/// Extrae el icono principal del exe como PNG (máx. 256 px).
pub fn extract_icon_png(path: &Path) -> Option<Vec<u8>> {
    let map = FileMap::open(path).ok()?;
    let pe = PeFile::from_bytes(&map).ok()?;
    let res = pe.resources().ok()?;
    let (_, group) = res.icons().filter_map(Result::ok).next()?;
    let mut ico = Vec::new();
    group.write(&mut ico).ok()?;
    let img = image::load_from_memory_with_format(&ico, image::ImageFormat::Ico).ok()?;
    let img = if img.width() > 256 {
        img.resize(256, 256, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    // Iconos diminutos (16/32 px) no merecen la pena como arte.
    if img.width() < 32 {
        return None;
    }
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}
