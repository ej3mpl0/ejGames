//! Importar ROMs propias (volcados de tu consola, homebrew, demos): por archivo o por
//! carpeta, descomprimiendo los .zip y .7z, con el sistema detectado por la extensión
//! y, si hace falta, por la cabecera. Se copian a `<datos>\roms\<sistema>\` (una
//! carpeta de la biblioteca por sistema, que se vuelve a escanear sola) o se dejan
//! donde están, a elección del usuario.

use super::{platform, rominfo, Platform, PLATFORMS};
use crate::db::repo;
use crate::settings::Settings;
use crate::state::AppState;
use crate::util::norm_path;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Emitter;

/// Hasta dónde se mira dentro de una carpeta (archivos).
const MAX_FILES: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RomEntry {
    /// Archivo en disco (el .zip/.7z si viene comprimido).
    pub path: String,
    /// Dentro de un comprimido: la ruta de la ROM en él.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner: Option<String>,
    pub name: String,
    pub size: u64,
    /// Sistema detectado (None si la extensión vale para varios y la cabecera no lo aclara).
    pub platform: Option<String>,
    /// Sistemas posibles por la extensión.
    pub options: Vec<String>,
    pub info: rominfo::RomInfo,
    /// Ya está en la biblioteca.
    pub known: bool,
}

fn ext(p: &str) -> String {
    Path::new(p).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Sistemas por extensión (sin .zip/.7z, que son comprimidos salvo en arcade).
fn owners(e: &str) -> Vec<&'static Platform> {
    PLATFORMS.iter().filter(|p| p.id != "arcade" && p.exts.contains(&e)).collect()
}

fn is_archive(e: &str) -> bool {
    matches!(e, "zip" | "7z")
}

/// Pistas de un .cue, discos de un .m3u o pistas de un .gdi: van con él.
pub fn companions(path: &Path) -> Vec<PathBuf> {
    let Some(dir) = path.parent() else { return vec![] };
    let Ok(text) = std::fs::read_to_string(path) else { return vec![] };
    let names: Vec<String> = match ext(&path.to_string_lossy()).as_str() {
        "cue" => text.lines().filter(|l| l.trim_start().to_ascii_uppercase().starts_with("FILE")).filter_map(|l| l.split('"').nth(1).map(str::to_string)).collect(),
        "m3u" => text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(str::to_string).collect(),
        "gdi" => text.lines().skip(1).filter_map(|l| l.split_whitespace().nth(4).map(|n| n.trim_matches('"').to_string())).collect(),
        _ => vec![],
    };
    let mut out = vec![];
    for n in names {
        let p = dir.join(&n);
        if p.is_file() && p.starts_with(dir) {
            // Un .m3u apunta a .cue que a su vez tienen pistas.
            out.extend(companions(&p));
            out.push(p);
        }
    }
    out
}

/// Lo que hay para importar en un archivo o una carpeta (sin tocar nada).
pub fn scan(path: &Path, settings: &Settings, known: &HashSet<String>) -> Vec<RomEntry> {
    let files: Vec<PathBuf> = if path.is_dir() {
        walkdir::WalkDir::new(path)
            .max_depth(6)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .take(MAX_FILES)
            .map(|e| e.into_path())
            .collect()
    } else {
        vec![path.to_path_buf()]
    };
    // Las pistas de un .cue/.m3u/.gdi no se ofrecen sueltas.
    let mut tracks: HashSet<String> = HashSet::new();
    for f in &files {
        if matches!(ext(&f.to_string_lossy()).as_str(), "cue" | "m3u" | "gdi") {
            tracks.extend(companions(f).iter().filter(|c| !matches!(ext(&c.to_string_lossy()).as_str(), "cue")).map(|c| norm_path(c)));
        }
    }
    let mut out = vec![];
    for f in files {
        let s = f.to_string_lossy().into_owned();
        let e = ext(&s);
        if tracks.contains(&norm_path(&f)) {
            continue;
        }
        if is_archive(&e) {
            out.extend(scan_archive(&f, settings));
            continue;
        }
        let opts = owners(&e);
        if opts.is_empty() {
            continue;
        }
        let pf = detect(&f, &opts, settings);
        let info = pf.map(|p| rominfo::read(&f, p.id)).unwrap_or_default();
        out.push(RomEntry {
            name: f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            size: std::fs::metadata(&f).map(|m| m.len()).unwrap_or(0),
            platform: pf.map(|p| p.id.to_string()),
            options: opts.iter().map(|p| p.id.to_string()).collect(),
            known: known.contains(&norm_path(&f)),
            info,
            path: s,
            inner: None,
        });
    }
    out.sort_by(|a, b| a.platform.cmp(&b.platform).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

/// El sistema de un archivo: el único que admite su extensión; si hay varios, el que
/// diga su cabecera; si no, el único con emulador puesto.
fn detect(f: &Path, opts: &[&'static Platform], settings: &Settings) -> Option<&'static Platform> {
    if let [one] = opts {
        return Some(one);
    }
    if let Some(id) = rominfo::sniff(f) {
        if let Some(p) = opts.iter().find(|p| p.id == id) {
            return Some(p);
        }
    }
    match super::platforms_for(f, settings).as_slice() {
        [one] if opts.iter().any(|o| o.id == one.id) => Some(one),
        _ => None,
    }
}

/// ROMs dentro de un .zip o .7z (por la extensión; la cabecera se lee al importar).
fn scan_archive(f: &Path, settings: &Settings) -> Vec<RomEntry> {
    let entries: Vec<(String, u64)> = match ext(&f.to_string_lossy()).as_str() {
        "zip" => std::fs::File::open(f)
            .ok()
            .and_then(|file| zip::ZipArchive::new(file).ok())
            .map(|mut z| (0..z.len()).filter_map(|i| z.by_index(i).ok().filter(|e| e.is_file()).map(|e| (e.name().to_string(), e.size()))).collect())
            .unwrap_or_default(),
        "7z" => sevenz_rust2::Archive::open(f).map(|a| a.files.iter().filter(|e| !e.is_directory()).map(|e| (e.name().to_string(), e.size())).collect()).unwrap_or_default(),
        _ => vec![],
    };
    let roms: Vec<_> = entries.into_iter().filter(|(n, _)| !owners(&ext(n)).is_empty()).collect();
    // Un .zip sin nada reconocible dentro puede ser una ROM de arcade: eso se añade como carpeta de arcade.
    roms.into_iter()
        .filter(|(n, _)| !matches!(ext(n).as_str(), "bin" | "img" | "sub" | "ccd"))
        .map(|(n, size)| {
            let opts = owners(&ext(&n));
            // Varios posibles (un .iso): se mira al importar o lo elige el usuario; con un solo emulador puesto, ese.
            let one = if opts.len() == 1 {
                Some(opts[0])
            } else {
                match super::platforms_for(Path::new(&n), settings).as_slice() {
                    [only] => Some(*only),
                    _ => None,
                }
            };
            RomEntry {
                path: f.to_string_lossy().into_owned(),
                name: Path::new(&n).file_name().map(|x| x.to_string_lossy().into_owned()).unwrap_or_else(|| n.clone()),
                inner: Some(n),
                size,
                platform: one.map(|p| p.id.to_string()),
                options: opts.iter().map(|p| p.id.to_string()).collect(),
                info: rominfo::RomInfo::default(),
                known: false,
            }
        })
        .collect()
}

// ───────────────────────── importar ─────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub path: String,
    #[serde(default)]
    pub inner: Option<String>,
    pub platform: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub added: usize,
    /// Actualizaciones y DLC enganchados a su juego.
    pub extras: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub game_ids: Vec<i64>,
}

pub fn roms_dir(st: &AppState) -> PathBuf {
    st.paths.root.join("roms")
}

fn progress(st: &AppState, done: usize, total: usize, name: &str) {
    let _ = st.app.emit("rom:import", serde_json::json!({ "done": done, "total": total, "name": name }));
}

/// Copia sin pisar otra distinta: si ya hay un archivo igual (mismo tamaño) se reutiliza.
fn place(src: &Path, dir: &Path, mv: bool) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let name = src.file_name().ok_or_else(|| anyhow::anyhow!("archivo sin nombre"))?;
    let dest = dir.join(name);
    if dest.is_file() {
        let same = std::fs::metadata(&dest)?.len() == std::fs::metadata(src)?.len();
        if same {
            if mv {
                let _ = std::fs::remove_file(src);
            }
            return Ok(dest);
        }
        anyhow::bail!("{} {}", crate::i18n::t("Ya hay otro archivo con ese nombre:"), dest.display());
    }
    if mv && std::fs::rename(src, &dest).is_ok() {
        return Ok(dest);
    }
    std::fs::copy(src, &dest)?;
    if mv {
        let _ = std::fs::remove_file(src);
    }
    Ok(dest)
}

/// Saca de un comprimido la ROM pedida (y sus pistas, si es un .cue) a `tmp`.
fn unpack(archive: &Path, inner: &str, tmp: &Path) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(tmp)?;
    if ext(&archive.to_string_lossy()) == "zip" {
        let mut z = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
        let parent = Path::new(inner).parent().map(Path::to_path_buf).unwrap_or_default();
        // La ROM y lo que esté en su misma carpeta del zip (pistas de un .cue).
        for i in 0..z.len() {
            let mut e = z.by_index(i)?;
            let Some(rel) = e.enclosed_name() else { continue };
            if !e.is_file() || rel.parent().map(Path::to_path_buf).unwrap_or_default() != parent {
                continue;
            }
            let out = tmp.join(rel.file_name().unwrap_or_default());
            let mut w = std::fs::File::create(&out)?;
            std::io::copy(&mut e, &mut w)?;
        }
    } else {
        super::install::extract(archive, tmp)?;
    }
    let want = Path::new(inner).file_name().unwrap_or_default();
    walkdir::WalkDir::new(tmp)
        .into_iter()
        .filter_map(Result::ok)
        .find(|e| e.file_type().is_file() && e.file_name() == want)
        .map(|e| e.into_path())
        .ok_or_else(|| anyhow::anyhow!("{} {inner}", crate::i18n::t("No está dentro del comprimido:")))
}

/// Importa. Con `copy`, cada ROM va a `<datos>\roms\<sistema>\`; sin él, se añade
/// donde está (lo comprimido siempre se descomprime a la carpeta de ejGames).
pub async fn import(st: &Arc<AppState>, items: Vec<ImportItem>, copy: bool) -> anyhow::Result<ImportReport> {
    let count_extras = || st.db.with(|c| c.query_row("SELECT COUNT(*) FROM rom_extras", [], |r| r.get::<_, i64>(0))).unwrap_or(0);
    let before = count_extras();
    let st2 = st.clone();
    let (mut report, systems) = tauri::async_runtime::spawn_blocking(move || import_blocking(&st2, items, copy)).await??;
    // Los añadidos donde estaban; los copiados los registra (y los procesa) el escaneo de su carpeta.
    let loose: Vec<(i64, Option<String>)> = report.game_ids.iter().map(|id| (*id, None)).collect();
    // Una carpeta de la biblioteca por sistema (las copias): se escanea como cualquier otra.
    for (pid, folder_id) in systems {
        match crate::services::scan_folder(st, folder_id, false).await {
            Ok(r) => {
                report.added += r.new_games.len();
                report.game_ids.extend(r.new_games.iter().map(|n| n.0));
            }
            Err(e) => report.errors.push(format!("{pid}: {e:#}")),
        }
    }
    if let Some(pid) = *st.profile.read() {
        let systems: HashSet<String> = st
            .db
            .with(|c| {
                let mut q = c.prepare("SELECT DISTINCT platform FROM games WHERE platform IS NOT NULL")?;
                let v = q.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<_>>()?;
                Ok(v)
            })
            .unwrap_or_default();
        for s in systems.iter().filter_map(|s| platform(s)) {
            let _ = st.db.with(|c| repo::ensure_platform_collection(c, pid, s.name, s.id));
        }
    }
    crate::services::after_new_games(st, loose).await;
    report.extras = (count_extras() - before).max(0) as usize;
    crate::events::library_reset(st);
    progress(st, 1, 1, "");
    Ok(report)
}

fn import_blocking(st: &AppState, items: Vec<ImportItem>, copy: bool) -> anyhow::Result<(ImportReport, Vec<(String, i64)>)> {
    let root = roms_dir(st);
    let tmp_root = root.join(".importando");
    let _ = std::fs::remove_dir_all(&tmp_root);
    let mut report = ImportReport::default();
    let mut systems: Vec<(String, i64)> = vec![];
    let total = items.len();
    for (n, it) in items.into_iter().enumerate() {
        let Some(pf) = platform(&it.platform) else {
            report.errors.push(format!("{}: {}", it.path, crate::i18n::t("sistema desconocido")));
            continue;
        };
        let src = PathBuf::from(&it.path);
        progress(st, n, total, &it.inner.clone().unwrap_or_else(|| src.file_name().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default()));
        let r = (|| -> anyhow::Result<Option<PathBuf>> {
            let dir = root.join(pf.id);
            // Comprimido: se saca a una carpeta temporal y de ahí a la de su sistema.
            if let Some(inner) = &it.inner {
                let tmp = tmp_root.join(n.to_string());
                let rom = unpack(&src, inner, &tmp)?;
                let mut set = companions(&rom);
                set.push(rom.clone());
                let mut placed = None;
                for f in set {
                    let d = place(&f, &dir, true)?;
                    if f == rom {
                        placed = Some(d);
                    }
                }
                let _ = std::fs::remove_dir_all(&tmp);
                return Ok(placed);
            }
            if !src.is_file() {
                anyhow::bail!("{} {}", crate::i18n::t("No existe el fichero:"), src.display());
            }
            if !copy {
                return Ok(None);
            }
            for c in companions(&src) {
                place(&c, &dir, false)?;
            }
            Ok(Some(place(&src, &dir, false)?))
        })();
        match r {
            // Copiada a la carpeta de su sistema: la registra el escaneo de esa carpeta.
            Ok(Some(_)) => {
                if !systems.iter().any(|(p, _)| p == pf.id) {
                    let dir = root.join(pf.id);
                    let fid = st.db.with(|c| repo::add_folder(c, &dir.to_string_lossy(), &format!("roms:{}", pf.id)))?;
                    systems.push((pf.id.to_string(), fid));
                }
            }
            // En su sitio: un juego suelto (o un extra de otro).
            Ok(None) => {
                let info = rominfo::read(&src, pf.id);
                if info.is_extra() {
                    st.db.with(|c| super::save_extra(c, pf.id, &src, &info))?;
                    continue;
                }
                let g = super::rom_game(&src, pf);
                match st.db.with(|c| repo::upsert_game(c, &g))? {
                    Some((id, true)) => {
                        report.added += 1;
                        report.game_ids.push(id);
                    }
                    _ => report.skipped += 1,
                }
            }
            Err(e) => report.errors.push(format!("{}: {e:#}", it.inner.as_deref().unwrap_or(&it.path))),
        }
    }
    let _ = std::fs::remove_dir_all(&tmp_root);
    Ok((report, systems))
}

/// Juegos de consola ya en la biblioteca (por ruta), para marcar los repetidos.
pub fn known_paths(st: &AppState) -> HashSet<String> {
    st.db
        .with(|c| {
            let mut q = c.prepare("SELECT source_id FROM games WHERE source IN ('rom', 'homebrew') UNION SELECT path FROM rom_extras")?;
            let v = q.query_map([], |r| r.get::<_, String>(0))?.map(|p| p.map(|p| norm_path(Path::new(&p)))).collect::<rusqlite::Result<_>>()?;
            Ok(v)
        })
        .unwrap_or_default()
}

/// Lee los primeros bytes de un archivo (para tests).
#[cfg(test)]
fn head(p: &Path, n: usize) -> Vec<u8> {
    use std::io::Read;
    let mut b = vec![0; n];
    let k = std::fs::File::open(p).and_then(|mut f| f.read(&mut b)).unwrap_or(0);
    b.truncate(k);
    b
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn scans_files_archives_and_skips_tracks() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        std::fs::write(p.join("Zelda [0100ABCD00010000][v0].nsp"), b"x").unwrap();
        std::fs::write(p.join("Zelda [0100ABCD00010800][v65536].nsp"), b"x").unwrap();
        std::fs::write(p.join("Mario.sfc"), b"x").unwrap();
        std::fs::write(p.join("juego.cue"), "FILE \"juego (Track 1).bin\" BINARY\n").unwrap();
        std::fs::write(p.join("juego (Track 1).bin"), b"x").unwrap();
        std::fs::write(p.join("notas.txt"), b"x").unwrap();
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(p.join("pack.zip")).unwrap());
            w.start_file("carpeta/Metroid.gba", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"gba").unwrap();
            w.start_file("leeme.txt", zip::write::SimpleFileOptions::default()).unwrap();
            w.finish().unwrap();
        }
        let list = scan(p, &Settings::default(), &HashSet::new());
        let names: Vec<(&str, Option<&str>)> = list.iter().map(|e| (e.name.as_str(), e.platform.as_deref())).collect();
        assert!(names.contains(&("Mario.sfc", Some("snes"))));
        assert!(names.contains(&("Metroid.gba", Some("gba"))));
        assert!(names.iter().any(|(n, p)| n.starts_with("Zelda [0100ABCD00010800]") && *p == Some("switch")));
        // El .cue sale (Saturn o PS1: sin cabecera, sin decidir); su pista no.
        assert!(names.iter().any(|(n, _)| *n == "juego.cue"));
        assert!(!names.iter().any(|(n, _)| n.ends_with(".bin") || n.ends_with(".txt")));
        let upd = list.iter().find(|e| e.name.contains("0800")).unwrap();
        assert_eq!(upd.info.kind.as_deref(), Some("update"));
        let gba = list.iter().find(|e| e.name == "Metroid.gba").unwrap();
        assert_eq!(gba.inner.as_deref(), Some("carpeta/Metroid.gba"));
    }

    #[test]
    fn unpack_and_place_without_clobbering() {
        let d = tempfile::tempdir().unwrap();
        let z = d.path().join("a.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&z).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            w.start_file("rpg/rpg.cue", o).unwrap();
            w.write_all(b"FILE \"rpg.bin\" BINARY\n").unwrap();
            w.start_file("rpg/rpg.bin", o).unwrap();
            w.write_all(b"datos").unwrap();
            w.finish().unwrap();
        }
        let rom = unpack(&z, "rpg/rpg.cue", &d.path().join("tmp")).unwrap();
        let tracks = companions(&rom);
        assert_eq!(tracks.len(), 1);
        let dest = d.path().join("roms").join("psx");
        let placed = place(&rom, &dest, true).unwrap();
        place(&tracks[0], &dest, true).unwrap();
        assert!(placed.is_file() && !rom.exists() && dest.join("rpg.bin").is_file());
        // Mismo nombre y mismo tamaño: se reutiliza; distinto: no se pisa.
        let other = d.path().join("rpg.cue");
        std::fs::write(&other, b"FILE \"rpg.bin\" BINARY\n").unwrap();
        assert_eq!(place(&other, &dest, false).unwrap(), placed);
        std::fs::write(&other, b"otra cosa distinta").unwrap();
        assert!(place(&other, &dest, false).is_err());
        assert_eq!(head(&placed, 4), b"FILE");
    }
}
