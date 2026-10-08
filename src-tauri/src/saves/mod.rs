//! Copias de las partidas guardadas de cada juego. Dónde guarda cada uno sale
//! del manifiesto de Ludusavi (por AppID de Steam o por nombre), de las carpetas
//! de los emuladores de Steam, de `userdata/<cuenta>/<appid>/remote` y de las
//! rutas que añade el usuario. Cada copia es un .zip en `<datos>/saves/<juego>/`.

pub mod manifest;

use crate::db::models::Game;
use crate::state::AppState;
use anyhow::Context;
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const MANIFEST_URL: &str = "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml";
const MANIFEST_TTL: Duration = Duration::from_secs(14 * 24 * 3600);
const INDEX_FILE: &str = "saves-manifest.json";
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_FILES: u64 = 30_000;
const LIST_FILE: &str = "ejg-saves.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePath {
    pub path: String,
    /// manifest | emulator | steam | manual
    pub source: String,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: i64,
    pub game_id: i64,
    pub at: i64,
    pub size: i64,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavesInfo {
    pub paths: Vec<SavePath>,
    pub snapshots: Vec<Snapshot>,
    /// Ludusavi conoce el juego.
    pub known: bool,
}

// ───────────────────────── manifiesto ─────────────────────────

/// Índice del manifiesto (se baja como mucho cada dos semanas; sin red vale el viejo).
pub async fn manifest_index(st: &Arc<AppState>) -> Option<manifest::Index> {
    let file = st.paths.root.join(INDEX_FILE);
    let age = std::fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok());
    let read = {
        let file = file.clone();
        move || std::fs::read(&file).ok().and_then(|b| serde_json::from_slice::<manifest::Index>(&b).ok())
    };
    if age.is_some_and(|a| a < MANIFEST_TTL) {
        if let Some(i) = tauri::async_runtime::spawn_blocking(read.clone()).await.ok().flatten() {
            return Some(i);
        }
    }
    let get = async {
        let r = st.http.get(MANIFEST_URL).timeout(Duration::from_secs(90)).send().await.ok()?;
        r.error_for_status().ok()?.text().await.ok()
    };
    let fresh = match get.await {
        Some(text) => tauri::async_runtime::spawn_blocking(move || {
            let idx = manifest::index(manifest::parse(&text));
            if idx.games.len() > 1000 {
                if let Ok(b) = serde_json::to_vec(&idx) {
                    let _ = std::fs::write(&file, b);
                }
                Some(idx)
            } else {
                None
            }
        })
        .await
        .ok()
        .flatten(),
        None => None,
    };
    match fresh {
        Some(i) => Some(i),
        None => tauri::async_runtime::spawn_blocking(read).await.ok().flatten(),
    }
}

// ───────────────────────── rutas ─────────────────────────

struct Ctx {
    base: Option<PathBuf>,
    appid: Option<i64>,
    steam_root: Option<PathBuf>,
}

fn env_dir(k: &str) -> Option<String> {
    std::env::var_os(k).map(|v| v.to_string_lossy().into_owned())
}

/// Sustituye los marcadores de Ludusavi; None si falta alguno que no sabemos resolver.
fn expand(path: &str, ctx: &Ctx) -> Option<String> {
    let mut out = path.to_string();
    let home = dirs::home_dir().map(|p| p.to_string_lossy().into_owned());
    let subs: Vec<(&str, Option<String>)> = vec![
        ("<home>", home.clone()),
        ("<winAppData>", env_dir("APPDATA")),
        ("<winLocalAppData>", env_dir("LOCALAPPDATA")),
        ("<winLocalAppDataLow>", home.clone().map(|h| format!("{h}\\AppData\\LocalLow"))),
        ("<winDocuments>", dirs::document_dir().map(|p| p.to_string_lossy().into_owned())),
        ("<winPublic>", env_dir("PUBLIC")),
        ("<winProgramData>", env_dir("PROGRAMDATA")),
        ("<winDir>", env_dir("WINDIR")),
        ("<osUserName>", env_dir("USERNAME")),
        ("<base>", ctx.base.as_ref().map(|p| p.to_string_lossy().into_owned())),
        ("<game>", ctx.base.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned())),
        ("<root>", ctx.steam_root.as_ref().map(|p| p.to_string_lossy().into_owned())),
        ("<storeUserId>", Some("*".into())),
        ("<storeGameId>", ctx.appid.map(|a| a.to_string())),
    ];
    for (k, v) in subs {
        if out.contains(k) {
            out = out.replace(k, &v?);
        }
    }
    if out.contains('<') && out.contains('>') {
        return None;
    }
    Some(out.replace('/', "\\"))
}

fn wild(pat: &str, name: &str) -> bool {
    let (p, n): (Vec<char>, Vec<char>) = (pat.to_lowercase().chars().collect(), name.to_lowercase().chars().collect());
    fn go(p: &[char], n: &[char]) -> bool {
        match p.first() {
            None => n.is_empty(),
            Some('*') => (0..=n.len()).any(|i| go(&p[1..], &n[i..])),
            Some('?') => !n.is_empty() && go(&p[1..], &n[1..]),
            Some(c) => n.first() == Some(c) && go(&p[1..], &n[1..]),
        }
    }
    go(&p, &n)
}

/// Rutas existentes que encajan con `path` (admite `*` y `?` en cualquier componente).
pub fn expand_glob(path: &str) -> Vec<PathBuf> {
    let mut parts = path.split('\\').filter(|s| !s.is_empty());
    let Some(first) = parts.next() else { return vec![] };
    // «C:» necesita su barra; una ruta UNC empieza por «\\».
    let mut cur: Vec<PathBuf> = vec![if path.starts_with("\\\\") { PathBuf::from(format!("\\\\{first}")) } else { PathBuf::from(format!("{first}\\")) }];
    for comp in parts {
        let mut next = vec![];
        for base in &cur {
            if comp.contains('*') || comp.contains('?') {
                if let Ok(rd) = std::fs::read_dir(base) {
                    next.extend(rd.filter_map(Result::ok).filter(|e| wild(comp, &e.file_name().to_string_lossy())).map(|e| e.path()));
                }
            } else {
                let p = base.join(comp);
                if p.exists() {
                    next.push(p);
                }
            }
        }
        cur = next;
        if cur.is_empty() {
            break;
        }
    }
    cur.retain(|p| p.exists());
    cur
}

/// Carpetas y archivos de un juego: lista de (ruta, origen).
pub async fn locate(st: &Arc<AppState>, game: &Game) -> (Vec<(PathBuf, &'static str)>, bool) {
    let mut found: Vec<(PathBuf, &'static str)> = vec![];
    let steam_root = crate::achievements::steam_local::steam_root();
    let appid = {
        let (s, g) = (st.clone(), game.clone());
        tauri::async_runtime::spawn_blocking(move || crate::achievements::appid_of(&s, &g)).await.ok().flatten().or(game.steam_appid)
    };
    let ctx = Ctx { base: game.install_dir.as_ref().map(PathBuf::from), appid, steam_root: steam_root.clone() };

    // Juegos de consola: lo que guarda su emulador (Ludusavi solo sabe de juegos de PC;
    // por nombre podría confundirlos con otro).
    let mut known = false;
    if let Some(pid) = game.platform.as_deref() {
        if let Some(cfg) = crate::emulation::resolve(&st.settings.get(), Some(&crate::emulation::install::emu_dir(st)), pid, false) {
            let g = game.clone();
            let found_emu = tauri::async_runtime::spawn_blocking(move || crate::emulation::saves::locate(&cfg, &g)).await.unwrap_or_default();
            known = !found_emu.is_empty();
            found.extend(found_emu.into_iter().map(|p| (p, "emulator")));
        }
    } else if let Some(idx) = manifest_index(st).await {
        // Ludusavi: por AppID y, si no, por nombre.
        let hit = appid
            .and_then(|a| idx.steam.get(&(a as u64)))
            .or_else(|| idx.names.get(&manifest::norm(&game.title)));
        if let Some(g) = hit.and_then(|i| idx.games.get(*i)) {
            known = true;
            for p in &g.paths {
                if let Some(e) = expand(p, &ctx) {
                    found.extend(expand_glob(&e).into_iter().map(|p| (p, "manifest")));
                }
            }
        }
    }
    if let Some(a) = appid {
        // Emuladores de Steam (Goldberg, GSE, CODEX…): la carpeta del appid entera.
        for r in crate::achievements::emu::roots(&st.settings.get().achievement_dirs) {
            let d = r.join(a.to_string());
            if d.is_dir() {
                found.push((d, "emulator"));
            }
        }
        // Steam Cloud local.
        if let Some(root) = &steam_root {
            if let Some((_, user)) = crate::achievements::steam_local::active_user(root) {
                let d = user.join(a.to_string()).join("remote");
                if d.is_dir() {
                    found.push((d, "steam"));
                }
            }
        }
    }
    // A mano.
    let id = game.id;
    let manual: Vec<String> = st
        .db
        .with(|c| {
            let mut q = c.prepare("SELECT path FROM save_paths WHERE game_id = ?1")?;
            let v = q.query_map([id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
        .unwrap_or_default();
    for m in manual {
        let p = PathBuf::from(&m);
        if p.exists() {
            found.push((p, "manual"));
        }
    }
    // Sin repetidos ni rutas dentro de otra ya incluida.
    found.sort_by(|a, b| a.0.cmp(&b.0));
    found.dedup_by(|a, b| a.0 == b.0);
    let all: Vec<PathBuf> = found.iter().map(|f| f.0.clone()).collect();
    found.retain(|(p, _)| !all.iter().any(|o| o != p && p.starts_with(o)));
    (found, known)
}

fn files_of(root: &Path) -> Vec<(PathBuf, String, u64, i64)> {
    // (ruta absoluta, ruta relativa, bytes, mtime)
    let mut out = vec![];
    let meta = |p: &Path| std::fs::metadata(p).ok().map(|m| (m.len(), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0)));
    if root.is_file() {
        if let Some((len, t)) = meta(root) {
            out.push((root.to_path_buf(), root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), len, t));
        }
        return out;
    }
    for e in walkdir::WalkDir::new(root).into_iter().filter_map(Result::ok) {
        if !e.file_type().is_file() {
            continue;
        }
        if let (Some((len, t)), Ok(rel)) = (meta(e.path()), e.path().strip_prefix(root)) {
            out.push((e.path().to_path_buf(), rel.to_string_lossy().replace('\\', "/"), len, t));
        }
    }
    out
}

// ───────────────────────── copias ─────────────────────────

fn saves_dir(st: &AppState, game_id: i64) -> PathBuf {
    st.paths.root.join("saves").join(game_id.to_string())
}

pub fn snapshots(st: &AppState, game_id: i64) -> Vec<Snapshot> {
    st.db
        .with(|c| {
            let mut q = c.prepare("SELECT id, game_id, at, size, note FROM save_snapshots WHERE game_id = ?1 ORDER BY at DESC, id DESC")?;
            let v = q
                .query_map([game_id], |r| Ok(Snapshot { id: r.get(0)?, game_id: r.get(1)?, at: r.get(2)?, size: r.get(3)?, note: r.get(4)? }))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
        .unwrap_or_default()
}

pub async fn info(st: &Arc<AppState>, game: &Game) -> SavesInfo {
    let (found, known) = locate(st, game).await;
    let paths = tauri::async_runtime::spawn_blocking(move || {
        found
            .into_iter()
            .map(|(p, source)| {
                let fs = files_of(&p);
                SavePath { path: p.to_string_lossy().into_owned(), source: source.into(), bytes: fs.iter().map(|f| f.2).sum(), files: fs.len() as u64 }
            })
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default();
    SavesInfo { paths, snapshots: snapshots(st, game.id), known }
}

/// Hace una copia ahora. `None` si no hay nada que copiar o no ha cambiado
/// desde la última (salvo `force`).
pub async fn backup(st: &Arc<AppState>, game: &Game, note: &str, force: bool) -> anyhow::Result<Option<Snapshot>> {
    let (found, _) = locate(st, game).await;
    if found.is_empty() {
        anyhow::bail!("{}", crate::i18n::t("No se han encontrado partidas guardadas de este juego"));
    }
    let (s, g, note) = (st.clone(), game.clone(), note.to_string());
    tauri::async_runtime::spawn_blocking(move || backup_blocking(&s, &g, &note, force, found)).await?
}

fn backup_blocking(st: &AppState, game: &Game, note: &str, force: bool, found: Vec<(PathBuf, &'static str)>) -> anyhow::Result<Option<Snapshot>> {
    let mut all: Vec<Vec<(PathBuf, String, u64, i64)>> = vec![];
    let (mut bytes, mut count) = (0u64, 0u64);
    let mut h = blake3::Hasher::new();
    for (p, _) in &found {
        let fs = files_of(p);
        for f in &fs {
            bytes += f.2;
            count += 1;
            h.update(f.1.as_bytes());
            h.update(&f.2.to_le_bytes());
            h.update(&f.3.to_le_bytes());
        }
        all.push(fs);
    }
    if count == 0 {
        return Ok(None);
    }
    if bytes > MAX_BYTES || count > MAX_FILES {
        anyhow::bail!("{}", crate::i18n::t("Las partidas guardadas son demasiado grandes para copiarlas (más de 1 GB)"));
    }
    let hash = h.finalize().to_hex().to_string();
    let last: Option<String> = st
        .db
        .with(|c| c.query_row("SELECT hash FROM save_snapshots WHERE game_id = ?1 ORDER BY at DESC, id DESC LIMIT 1", [game.id], |r| r.get(0)))
        .ok();
    if !force && last.as_deref() == Some(hash.as_str()) {
        return Ok(None);
    }
    let dir = saves_dir(st, game.id);
    std::fs::create_dir_all(&dir)?;
    let at = chrono::Utc::now().timestamp();
    let name = format!("{}.zip", chrono::Local::now().format("%Y-%m-%d_%H%M%S"));
    let file = dir.join(&name);
    let r = (|| -> anyhow::Result<()> {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&file)?);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let list: Vec<serde_json::Value> = found
            .iter()
            .enumerate()
            .map(|(i, (p, src))| serde_json::json!({ "i": i, "path": p.to_string_lossy(), "file": p.is_file(), "source": src }))
            .collect();
        zip.start_file(LIST_FILE, opts)?;
        zip.write_all(&serde_json::to_vec_pretty(&list)?)?;
        for (i, fs) in all.iter().enumerate() {
            for (abs, rel, ..) in fs {
                // Un archivo suelto o con otro programa escribiendo: se salta, no se pierde la copia.
                let Ok(mut f) = std::fs::File::open(abs) else { continue };
                zip.start_file(format!("p{i}/{rel}"), opts)?;
                std::io::copy(&mut f, &mut zip)?;
            }
        }
        zip.finish()?;
        Ok(())
    })();
    if let Err(e) = r {
        let _ = std::fs::remove_file(&file);
        return Err(e);
    }
    let size = std::fs::metadata(&file).map(|m| m.len() as i64).unwrap_or(0);
    let id = st.db.with(|c| {
        c.execute(
            "INSERT INTO save_snapshots (game_id, at, size, file, hash, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![game.id, at, size, name, hash, note],
        )?;
        Ok(c.last_insert_rowid())
    })?;
    prune(st, game.id);
    Ok(Some(Snapshot { id, game_id: game.id, at, size, note: note.into() }))
}

fn prune(st: &AppState, game_id: i64) {
    let keep = st.settings.get().saves_keep.max(1) as usize;
    let old: Vec<(i64, String)> = st
        .db
        .with(|c| {
            let mut q = c.prepare("SELECT id, file FROM save_snapshots WHERE game_id = ?1 ORDER BY at DESC, id DESC LIMIT -1 OFFSET ?2")?;
            let v = q.query_map(rusqlite::params![game_id, keep as i64], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(v)
        })
        .unwrap_or_default();
    for (id, file) in old {
        let _ = std::fs::remove_file(saves_dir(st, game_id).join(file));
        let _ = st.db.with(|c| c.execute("DELETE FROM save_snapshots WHERE id = ?1", [id]));
    }
}

/// Restaura una copia (antes guarda las partidas de ahora, por si acaso).
pub async fn restore(st: &Arc<AppState>, game: &Game, snapshot_id: i64) -> anyhow::Result<usize> {
    let file: String = st.db.with(|c| c.query_row("SELECT file FROM save_snapshots WHERE id = ?1 AND game_id = ?2", [snapshot_id, game.id], |r| r.get(0)))?;
    let path = saves_dir(st, game.id).join(file);
    if !path.exists() {
        anyhow::bail!("{}", crate::i18n::t("Esa copia ya no está en el disco"));
    }
    // Guardar lo de ahora si hay algo.
    let _ = backup(st, game, &crate::i18n::t("Antes de restaurar"), true).await;
    tauri::async_runtime::spawn_blocking(move || restore_zip(&path)).await?
}

fn restore_zip(zip_path: &Path) -> anyhow::Result<usize> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(zip_path)?)?;
    let mut s = String::new();
    z.by_name(LIST_FILE).context(crate::i18n::t("copia sin lista de rutas"))?.read_to_string(&mut s)?;
    let list: Vec<serde_json::Value> = serde_json::from_str(&s)?;
    let mut roots: std::collections::HashMap<usize, (PathBuf, bool)> = Default::default();
    for e in &list {
        if let (Some(i), Some(p)) = (e["i"].as_u64(), e["path"].as_str()) {
            roots.insert(i as usize, (PathBuf::from(p), e["file"].as_bool().unwrap_or(false)));
        }
    }
    let mut n = 0;
    for k in 0..z.len() {
        let mut f = z.by_index(k)?;
        let name = f.name().to_string();
        let Some((idx, rel)) = name.strip_prefix('p').and_then(|r| r.split_once('/')) else { continue };
        let Some((root, is_file)) = idx.parse::<usize>().ok().and_then(|i| roots.get(&i)) else { continue };
        let out = if *is_file { root.clone() } else { root.join(rel) };
        // Nada de salirse de la carpeta de origen con «..».
        if rel.split('/').any(|c| c == "..") {
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::io::copy(&mut f, &mut std::fs::File::create(&out)?)?;
        n += 1;
    }
    Ok(n)
}

/// Al cerrar el juego: copia automática si cambió algo.
pub async fn auto(st: &Arc<AppState>, game: &Game) {
    if !st.settings.get().saves_auto {
        return;
    }
    // Unos segundos para que el juego termine de escribir.
    tokio::time::sleep(Duration::from_secs(3)).await;
    match backup(st, game, "", false).await {
        Ok(Some(s)) => {
            tracing::info!("partidas de «{}» guardadas ({} KB)", game.title, s.size / 1024);
            crate::events::saves_changed(st, game.id);
        }
        Ok(None) => {}
        Err(e) => tracing::info!("partidas de «{}»: {e:#}", game.title),
    }
}

pub fn add_path(st: &AppState, game_id: i64, path: &str) -> anyhow::Result<()> {
    if !Path::new(path).exists() {
        anyhow::bail!("{}", crate::i18n::t("Esa ruta no existe"));
    }
    st.db.with(|c| c.execute("INSERT OR IGNORE INTO save_paths (game_id, path) VALUES (?1, ?2)", rusqlite::params![game_id, path]))?;
    Ok(())
}

pub fn remove_path(st: &AppState, game_id: i64, path: &str) -> anyhow::Result<()> {
    st.db.with(|c| c.execute("DELETE FROM save_paths WHERE game_id = ?1 AND path = ?2", rusqlite::params![game_id, path]))?;
    Ok(())
}

pub fn delete_snapshot(st: &AppState, game_id: i64, id: i64) -> anyhow::Result<()> {
    let file: Option<String> = st.db.with(|c| c.query_row("SELECT file FROM save_snapshots WHERE id = ?1 AND game_id = ?2", [id, game_id], |r| r.get(0))).ok();
    if let Some(f) = file {
        let _ = std::fs::remove_file(saves_dir(st, game_id).join(f));
        st.db.with(|c| c.execute("DELETE FROM save_snapshots WHERE id = ?1", [id]))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_matching() {
        assert!(wild("*.sav", "slot1.SAV"));
        assert!(wild("save?", "save1"));
        assert!(!wild("save?", "save10"));
        assert!(wild("*", "lo-que-sea"));
    }

    #[test]
    fn expands_markers() {
        let ctx = Ctx { base: Some(PathBuf::from(r"D:\Juegos\Hades")), appid: Some(1145360), steam_root: None };
        assert_eq!(expand("<base>/saves", &ctx).as_deref(), Some(r"D:\Juegos\Hades\saves"));
        assert_eq!(expand("<game>/x", &ctx).as_deref(), Some(r"Hades\x"));
        assert!(expand("<root>/userdata", &ctx).is_none());
        assert!(expand("<xdgData>/x", &ctx).is_none());
        assert!(expand("<winAppData>/Foo/<storeUserId>", &ctx).unwrap().ends_with(r"\Foo\*"));
    }

    #[test]
    fn glob_finds_files() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("Perfil1")).unwrap();
        std::fs::create_dir_all(d.path().join("Perfil2")).unwrap();
        std::fs::write(d.path().join("Perfil2").join("a.sav"), b"x").unwrap();
        let pat = format!("{}\\*\\*.sav", d.path().display());
        let r = expand_glob(&pat);
        assert_eq!(r.len(), 1);
        assert!(r[0].ends_with("a.sav"));
    }

    #[test]
    fn backup_and_restore_zip_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let save = d.path().join("save");
        std::fs::create_dir_all(save.join("sub")).unwrap();
        std::fs::write(save.join("a.sav"), b"uno").unwrap();
        std::fs::write(save.join("sub").join("b.sav"), b"dos").unwrap();
        // Zip como lo deja `backup_blocking`.
        let zp = d.path().join("c.zip");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&zp).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file(LIST_FILE, o).unwrap();
            z.write_all(serde_json::json!([{ "i": 0, "path": save.to_string_lossy(), "file": false }]).to_string().as_bytes()).unwrap();
            for (rel, body) in [("a.sav", "uno"), ("sub/b.sav", "dos"), ("../fuera.txt", "no")] {
                z.start_file(format!("p0/{rel}"), o).unwrap();
                z.write_all(body.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        std::fs::write(save.join("a.sav"), b"CAMBIADO").unwrap();
        std::fs::remove_file(save.join("sub").join("b.sav")).unwrap();
        assert_eq!(restore_zip(&zp).unwrap(), 2);
        assert_eq!(std::fs::read(save.join("a.sav")).unwrap(), b"uno");
        assert_eq!(std::fs::read(save.join("sub").join("b.sav")).unwrap(), b"dos");
        assert!(!d.path().join("fuera.txt").exists());
    }
}
