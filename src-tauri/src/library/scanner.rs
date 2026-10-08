//! Escaneo de carpetas de biblioteca (en paralelo con rayon).

use super::exe_detect::{self, is_store_or_system_dir, looks_like_game_dir, DirAnalysis};
use crate::db::models::{LibraryFolder, NewGame};
use crate::db::{repo, Db};
use crate::util::norm_path;
use rayon::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInspection {
    pub path: String,
    pub suggested_mode: String,
    pub preview: Vec<String>,
    pub exists: bool,
}

#[derive(Debug, Default)]
pub struct ScanReport {
    pub found: usize,
    pub new_games: Vec<(i64, Option<String>)>,
    pub missing: usize,
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.') || name.starts_with('$')
}

/// Carpetas que no se escanean por ahora (un juego instalándose).
static IGNORED: std::sync::LazyLock<parking_lot::Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(Default::default);

pub fn set_ignored(dir: &Path, ignored: bool) {
    let key = norm_path(dir);
    let mut g = IGNORED.lock();
    if ignored {
        g.insert(key);
    } else {
        g.remove(&key);
    }
}

fn is_ignored(dir: &Path) -> bool {
    let g = IGNORED.lock();
    !g.is_empty() && g.contains(&norm_path(dir))
}

fn child_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            !is_hidden(&n) && !is_store_or_system_dir(&n)
        })
        .map(|e| e.path())
        // Repacks sin instalar e instalaciones en curso.
        .filter(|p| !exe_detect::is_repack_dir(p) && !is_ignored(p))
        .collect()
}

/// Carpetas candidatas a juego. Una subcarpeta sin exe en su raíz pero con
/// varias subcarpetas-juego se trata como contenedor ("Indies\…") y se expande.
pub fn game_dirs(folder: &Path, mode: &str) -> Vec<PathBuf> {
    if mode == "single" {
        return vec![folder.to_path_buf()];
    }
    let mut out = vec![];
    for child in child_dirs(folder) {
        if looks_like_game_dir(&child) {
            out.push(child);
            continue;
        }
        let grand = child_dirs(&child);
        let game_like = grand.iter().filter(|g| looks_like_game_dir(g)).count();
        if game_like >= 2 {
            out.extend(grand.into_iter().filter(|g| looks_like_game_dir(g)));
        } else {
            out.push(child);
        }
    }
    out
}

pub fn inspect(path: &Path) -> FolderInspection {
    let exists = path.is_dir();
    let single = exists && looks_like_game_dir(path);
    let preview = if !exists {
        vec![]
    } else if single {
        vec![path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()]
    } else {
        game_dirs(path, "subfolders")
            .iter()
            .take(40)
            .filter_map(|d| d.file_name().map(|n| super::names::clean_title(&n.to_string_lossy())))
            .collect()
    };
    if exists && !single {
        if let Some((pf, roms)) = rom_folder(path) {
            return FolderInspection {
                path: path.to_string_lossy().to_string(),
                suggested_mode: format!("roms:{}", pf.id),
                preview: roms.iter().take(40).filter_map(|r| r.file_stem().map(|n| super::names::clean_title(&n.to_string_lossy()))).collect(),
                exists,
            };
        }
    }
    FolderInspection {
        path: path.to_string_lossy().to_string(),
        suggested_mode: if single { "single".into() } else { "subfolders".into() },
        preview,
        exists,
    }
}

/// Carpeta de juegos de consola: el sistema con más ROMs inconfundibles (extensión de un solo sistema;
/// ni .zip ni .7z, que salen en cualquier carpeta de descargas).
fn rom_folder(path: &Path) -> Option<(&'static crate::emulation::Platform, Vec<PathBuf>)> {
    let mut count: std::collections::HashMap<&str, usize> = Default::default();
    for e in walkdir::WalkDir::new(path).max_depth(3).into_iter().filter_map(Result::ok).take(5000) {
        let Some(ext) = e.path().extension().map(|x| x.to_string_lossy().to_lowercase()) else { continue };
        if !e.file_type().is_file() || matches!(ext.as_str(), "zip" | "7z" | "gz") {
            continue;
        }
        let owners: Vec<_> = crate::emulation::PLATFORMS.iter().filter(|p| p.exts.contains(&ext.as_str())).collect();
        if let [one] = owners.as_slice() {
            *count.entry(one.id).or_default() += 1;
        }
    }
    let (id, _) = count.into_iter().max_by_key(|(_, n)| *n)?;
    let pf = crate::emulation::platform(id)?;
    let roms = crate::emulation::find_roms(path, pf);
    (!roms.is_empty()).then_some((pf, roms))
}

pub fn to_new_game(a: &DirAnalysis, folder_id: Option<i64>) -> Option<NewGame> {
    let best = a.best()?;
    Some(NewGame {
        title: a.title.clone(),
        source: "folder".into(),
        source_id: norm_path(&a.dir),
        folder_id,
        install_dir: Some(a.dir.to_string_lossy().to_string()),
        exe_path: Some(best.path.to_string_lossy().to_string()),
        args: a.args.clone().unwrap_or_default(),
        working_dir: a.working_dir.as_ref().map(|w| w.to_string_lossy().to_string()),
        launch_uri: None,
        process_hints: a.process_hints.clone(),
        engine: a.markers.engine.map(str::to_string),
        steam_appid: a.markers.steam_appid,
        exe_candidates: a
            .exes
            .iter()
            .map(|c| (c.path.to_string_lossy().to_string(), c.score))
            .collect(),
        rom_meta: None,
        platform: None,
        rom_path: None,
    })
}

/// Segundos Unix de la última modificación de una carpeta.
fn mtime(p: &Path) -> Option<i64> {
    let t = std::fs::metadata(p).ok()?.modified().ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64)
}

/// `incremental`: las carpetas de juegos ya conocidos que no han cambiado desde
/// el último escaneo no se vuelven a analizar (el arranque no relee todo).
pub fn scan_folder(
    db: &Db,
    folder: &LibraryFolder,
    incremental: bool,
    on_progress: &(dyn Fn(usize, usize, &str) + Sync),
) -> anyhow::Result<ScanReport> {
    if let Some(platform) = folder.mode.strip_prefix("roms:") {
        return crate::emulation::scan_roms(db, folder, platform);
    }
    let root = PathBuf::from(&folder.path);
    if !root.is_dir() {
        anyhow::bail!("{}", crate::i18n::tf("La carpeta no existe: {0}", &[&folder.path]));
    }
    let mut dirs = game_dirs(&root, &folder.mode);
    let mut unchanged: Vec<i64> = vec![];
    if let (true, Some(since)) = (incremental, folder.last_scan) {
        let known: std::collections::HashMap<String, (i64, Option<String>)> = db.with(|c| {
            let mut q = c.prepare("SELECT source_id, id, exe_path FROM games WHERE folder_id = ?1 AND source = 'folder' AND missing = 0")?;
            let rows = q.query_map([folder.id], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?;
            rows.collect()
        })?;
        dirs.retain(|d| {
            let Some((id, exe)) = known.get(&norm_path(d)) else { return true };
            let same = mtime(d).map(|t| t <= since).unwrap_or(false)
                && exe.as_deref().map(|e| Path::new(e).is_file()).unwrap_or(false);
            if same {
                unchanged.push(*id);
            }
            !same
        });
    }
    let total = dirs.len();
    let done = std::sync::atomic::AtomicUsize::new(0);
    let analyses: Vec<DirAnalysis> = dirs
        .par_iter()
        .filter_map(|d| {
            let r = exe_detect::analyze(d);
            let n = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            on_progress(n, total, &d.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default());
            r
        })
        .collect();

    let mut report = ScanReport::default();
    let mut present = unchanged;
    db.with_mut(|c| {
        let tx = c.transaction()?;
        for a in &analyses {
            let Some(ng) = to_new_game(a, Some(folder.id)) else { continue };
            if let Some((id, is_new)) = repo::upsert_game(&tx, &ng)? {
                repo::replace_exe_candidates(&tx, id, &ng.exe_candidates)?;
                present.push(id);
                if is_new {
                    report.new_games.push((id, ng.exe_path.clone()));
                }
            }
        }
        report.found = present.len();
        report.missing = repo::mark_missing(&tx, folder.id, &present)?;
        repo::set_folder_scanned(&tx, folder.id)?;
        tx.commit()
    })?;
    Ok(report)
}
