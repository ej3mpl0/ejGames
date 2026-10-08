//! Import/export de temas como .ejtheme (zip con theme.json en la raíz o en una
//! única carpeta de primer nivel).

use super::{read_manifest, ThemeInfo};
use crate::paths::Paths;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_TOTAL: u64 = 200 * 1024 * 1024;

pub fn export(paths: &Paths, id: &str, dest: &Path) -> anyhow::Result<()> {
    let dir = super::dir_of(paths, id).ok_or_else(|| anyhow::anyhow!("tema no encontrado"))?;
    let file = std::fs::File::create(dest)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for e in walkdir::WalkDir::new(&dir).into_iter().filter_map(Result::ok) {
        let rel = e.path().strip_prefix(&dir)?.to_string_lossy().replace('\\', "/");
        if rel.is_empty() {
            continue;
        }
        if e.file_type().is_dir() {
            zip.add_directory(format!("{rel}/"), opts)?;
        } else {
            zip.start_file(rel, opts)?;
            zip.write_all(&std::fs::read(e.path())?)?;
        }
    }
    zip.finish()?;
    Ok(())
}

pub fn import(paths: &Paths, file: &Path) -> anyhow::Result<ThemeInfo> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(file)?)?;
    // ¿theme.json en la raíz o dentro de una carpeta?
    let mut prefix: Option<String> = None;
    for i in 0..zip.len() {
        let name = zip.by_index(i)?.name().replace('\\', "/");
        if name == "theme.json" {
            prefix = Some(String::new());
            break;
        }
        if let Some(p) = name.strip_suffix("/theme.json") {
            if !p.contains('/') {
                prefix = Some(format!("{p}/"));
            }
        }
    }
    let prefix = prefix.ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("El paquete no contiene theme.json")))?;

    let tmp = paths.user_themes.join(format!(".import-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;
    let mut total = 0u64;
    let res: anyhow::Result<()> = (|| {
        for i in 0..zip.len() {
            let mut f = zip.by_index(i)?;
            let Some(enclosed) = f.enclosed_name() else { continue }; // anti zip-slip
            let rel = enclosed.to_string_lossy().replace('\\', "/");
            let Some(rel) = rel.strip_prefix(&prefix) else { continue };
            if rel.is_empty() {
                continue;
            }
            let out: PathBuf = tmp.join(rel);
            if f.is_dir() {
                std::fs::create_dir_all(&out)?;
                continue;
            }
            total += f.size();
            if total > MAX_TOTAL {
                anyhow::bail!("Paquete demasiado grande");
            }
            std::fs::create_dir_all(out.parent().unwrap())?;
            let mut buf = Vec::with_capacity(f.size() as usize);
            f.read_to_end(&mut buf)?;
            std::fs::write(out, buf)?;
        }
        Ok(())
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    let m = match read_manifest(&tmp) {
        Ok(m) => m,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(e);
        }
    };
    let builtin_clash = paths.builtin_themes.join(&m.id).join("theme.json").exists();
    if builtin_clash {
        let _ = std::fs::remove_dir_all(&tmp);
        anyhow::bail!("{}", crate::i18n::tf("El id «{0}» es de un tema de serie; cámbialo en theme.json", &[&m.id]));
    }
    let dst = paths.user_themes.join(&m.id);
    let _ = std::fs::remove_dir_all(&dst);
    std::fs::rename(&tmp, &dst)?;
    super::find(paths, &m.id).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("no se pudo instalar")))
}
