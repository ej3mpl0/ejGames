//! Almacén de medios direccionado por contenido: cache/media/ab/abcd….ext.
//! Las URLs llevan el hash, así que se pueden cachear como inmutables.

use crate::paths::Paths;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageFormat};
use std::io::Cursor;

pub fn hash_bytes(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex()[..32].to_string()
}

pub fn ext_for(bytes: &[u8], fallback: &str) -> String {
    match image::guess_format(bytes) {
        Ok(ImageFormat::Png) => "png".into(),
        Ok(ImageFormat::Jpeg) => "jpg".into(),
        Ok(ImageFormat::WebP) => "webp".into(),
        Ok(ImageFormat::Gif) => "gif".into(),
        Ok(ImageFormat::Bmp) => "bmp".into(),
        Ok(ImageFormat::Ico) => "ico".into(),
        Ok(ImageFormat::Avif) => "avif".into(),
        _ => fallback.to_string(),
    }
}

/// Guarda bytes en el almacén (idempotente). Devuelve el hash.
pub fn put(paths: &Paths, bytes: &[u8], ext: &str) -> anyhow::Result<String> {
    let hash = hash_bytes(bytes);
    let file = paths.media_file(&hash, ext);
    if !file.exists() {
        std::fs::create_dir_all(file.parent().unwrap())?;
        // Temporal con nombre único: dos escrituras a la vez no se pisan.
        let tmp = crate::util::temp_path(&file);
        std::fs::write(&tmp, bytes)?;
        if let Err(e) = std::fs::rename(&tmp, &file) {
            let _ = std::fs::remove_file(&tmp);
            // Otro ya guardó el mismo contenido: vale.
            if !file.exists() {
                return Err(e.into());
            }
        }
    }
    Ok(hash)
}

/// Tamaño máximo de la miniatura según el tipo de imagen.
pub fn thumb_size(kind: &str) -> Option<(u32, u32)> {
    match kind {
        "cover" => Some((300, 450)),
        "hero" => Some((800, 450)),
        "screenshot" => Some((640, 360)),
        "header" => Some((460, 215)),
        _ => None,
    }
}

pub struct Stored {
    pub hash: String,
    pub ext: String,
    pub thumb_hash: Option<String>,
    pub w: Option<u32>,
    pub h: Option<u32>,
}

/// Guarda la imagen original y genera su miniatura JPEG (si procede).
pub fn store_image(paths: &Paths, bytes: &[u8], kind: &str) -> anyhow::Result<Stored> {
    let ext = ext_for(bytes, "jpg");
    let hash = put(paths, bytes, &ext)?;
    let mut out = Stored { hash, ext, thumb_hash: None, w: None, h: None };
    let decoded = image::load_from_memory(bytes).ok();
    if let Some(img) = &decoded {
        let (w, h) = img.dimensions();
        out.w = Some(w);
        out.h = Some(h);
        if let Some((tw, th)) = thumb_size(kind) {
            if w > tw || h > th {
                if let Some(jpg) = encode_thumb(img, tw, th) {
                    out.thumb_hash = Some(put(paths, &jpg, "jpg")?);
                }
            }
        }
    }
    Ok(out)
}

fn encode_thumb(img: &DynamicImage, max_w: u32, max_h: u32) -> Option<Vec<u8>> {
    let small = img.resize(max_w, max_h, image::imageops::FilterType::Triangle);
    let rgb = small.to_rgb8();
    let mut buf = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut buf, 84).encode_image(&rgb).ok()?;
    Some(buf.into_inner())
}
