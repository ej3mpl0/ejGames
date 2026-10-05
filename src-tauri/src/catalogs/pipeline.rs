//! Cadena de descarga de los catálogos: bajar (HTTP aquí; los torrents van por el
//! motor de Descargas y vuelven a `from_torrent`), descomprimir (.zip y .7z, con las
//! contraseñas de la fuente y las generales), reconocer las ROMs por extensión y
//! cabecera, ordenarlas en `<roms>\<plataforma>\<juego>\` (con `dlc\` y `updates\`),
//! buscar carátula y meterlas en la biblioteca con su emulador. El DLC y las
//! actualizaciones se enganchan a su juego base (por TitleID o por nombre).

use super::{config::CatalogSource, platforms, InstalledRec};
use crate::db::{models::DownloadRow, repo};
use crate::emulation::{self, custom, rominfo, roms, Platform};
use crate::state::AppState;
use crate::util::norm_path;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Lo que hace falta para bajar e instalar una entrada (lo manda la interfaz).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct InstallRequest {
    pub source_id: String,
    /// Id de la entrada en su catálogo.
    pub game_id: String,
    pub title: String,
    /// Id de catálogo de la plataforma; vacío = adivinarla por los archivos.
    pub platform: Option<String>,
    /// game | dlc | update | homebrew | emulator
    pub category: String,
    pub cover: Option<String>,
    pub description: Option<String>,
    pub region: Option<String>,
    pub version: Option<String>,
    /// DLC o actualización: la entrada del juego base en el mismo catálogo.
    pub base_game_id: Option<String>,
    /// El enlace elegido.
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub game_ids: Vec<i64>,
    pub extras: usize,
    pub dir: String,
    /// Plataforma sin emulador en ejGames: los archivos se dejaron en `dir`.
    pub not_emulated: bool,
}

fn emit(st: &AppState, job: &str, phase: &str, received: u64, total: u64, message: Option<&str>) {
    let _ = st.app.emit("catalog:progress", serde_json::json!({ "id": job, "phase": phase, "received": received, "total": total, "message": message }));
}

static BUSY: Mutex<Option<HashSet<String>>> = Mutex::new(None);

// ───────────────────────── tipos de archivo ─────────────────────────

const ARCHIVES: &[&str] = &["zip", "7z", "rar"];
const COVER_NAMES: &[&str] = &["folder", "cover", "boxart", "box", "front", "poster"];

fn ext(p: &str) -> String {
    Path::new(p).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// ¿Es un archivo que la cadena sabe tratar (ROM o comprimido)? Para clasificar enlaces.
pub fn is_known_file(path: &str) -> bool {
    let e = ext(path);
    !e.is_empty() && (ARCHIVES.contains(&e.as_str()) || emulation::PLATFORMS.iter().any(|p| p.exts.contains(&e.as_str())) || matches!(e.as_str(), "bin" | "img" | "nca"))
}

fn exts_of(pf: &Platform) -> Vec<String> {
    let mut v: Vec<String> = pf.exts.iter().map(|x| x.to_string()).collect();
    v.extend(custom::extra_exts(pf.id));
    // Arcade: el .zip es la ROM; en el resto, lo comprimido se abre antes.
    if pf.id != "arcade" {
        v.retain(|x| x != "zip" && x != "7z");
    }
    v
}

/// Sistema de un archivo suelto cuando el catálogo no lo dice: por su extensión y, si
/// vale para varios, por su cabecera.
fn guess_platform(f: &Path) -> Option<&'static Platform> {
    let e = ext(&f.to_string_lossy());
    let opts: Vec<&Platform> = emulation::PLATFORMS.iter().filter(|p| p.id != "arcade" && p.exts.contains(&e.as_str())).collect();
    match opts.as_slice() {
        [] => None,
        [one] => Some(one),
        _ => rominfo::sniff(f).and_then(|id| opts.iter().copied().find(|p| p.id == id)),
    }
}

// ───────────────────────── descomprimir ─────────────────────────

fn zip_extract(archive: &Path, dest: &Path, passwords: &[String]) -> anyhow::Result<()> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
    let mut good: Option<Option<String>> = None;
    for i in 0..z.len() {
        let (rel, is_dir) = {
            let f = z.by_index_raw(i)?;
            (f.enclosed_name(), f.is_dir())
        };
        let Some(rel) = rel else { continue };
        let out = dest.join(rel);
        if is_dir {
            std::fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        // La contraseña que valió para el primero se prueba primero en los demás.
        let mut tries: Vec<Option<String>> = vec![];
        if let Some(g) = &good {
            tries.push(g.clone());
        }
        tries.push(None);
        tries.extend(passwords.iter().cloned().map(Some));
        let mut done = false;
        for pw in tries {
            let ok = (|| -> anyhow::Result<()> {
                let mut f = match &pw {
                    None => z.by_index(i)?,
                    Some(p) => z.by_index_decrypt(i, p.as_bytes())?,
                };
                let mut w = std::fs::File::create(&out)?;
                std::io::copy(&mut f, &mut w)?;
                Ok(())
            })();
            if ok.is_ok() {
                good = Some(pw);
                done = true;
                break;
            }
        }
        if !done {
            let _ = std::fs::remove_file(&out);
            anyhow::bail!("{} {}", crate::i18n::t("Comprimido con contraseña desconocida (añádela en extractPasswords):"), archive.display());
        }
    }
    Ok(())
}

fn sevenz_extract(archive: &Path, dest: &Path, passwords: &[String]) -> anyhow::Result<()> {
    let mut last = match sevenz_rust2::decompress_file(archive, dest) {
        Ok(()) => return Ok(()),
        Err(e) => e.to_string(),
    };
    for pw in passwords {
        let _ = std::fs::remove_dir_all(dest);
        std::fs::create_dir_all(dest)?;
        match sevenz_rust2::decompress_file_with_password(archive, dest, sevenz_rust2::Password::from(pw.as_str())) {
            Ok(()) => return Ok(()),
            Err(e) => last = e.to_string(),
        }
    }
    let _ = std::fs::remove_dir_all(dest);
    if passwords.is_empty() || last.to_lowercase().contains("password") {
        anyhow::bail!("{} {} ({last})", crate::i18n::t("Comprimido con contraseña desconocida (añádela en extractPasswords):"), archive.display());
    }
    anyhow::bail!("7z: {last}")
}

/// Saca un comprimido en `dest`, probando sin contraseña y con cada una de la lista.
pub fn extract_with(archive: &Path, dest: &Path, passwords: &[String]) -> anyhow::Result<()> {
    std::fs::create_dir_all(dest)?;
    match ext(&archive.to_string_lossy()).as_str() {
        "zip" => zip_extract(archive, dest, passwords)?,
        "7z" => sevenz_extract(archive, dest, passwords)?,
        "rar" => anyhow::bail!("{} {}", crate::i18n::t("Los .rar no se pueden abrir desde ejGames: descomprímelo con 7-Zip y usa Importar ROMs."), archive.display()),
        other => anyhow::bail!("Formato no admitido: {other}"),
    }
    // Nada fuera de la carpeta (por si una ruta traía «..»).
    let root = dest.canonicalize()?;
    for e in walkdir::WalkDir::new(dest).into_iter().filter_map(Result::ok) {
        if !e.path().canonicalize().map(|p| p.starts_with(&root)).unwrap_or(false) {
            anyhow::bail!("El archivo trae rutas fuera de su carpeta");
        }
    }
    Ok(())
}

/// Abre los comprimidos que haya en `dir` (y los que vengan dentro, hasta 3 niveles).
/// En arcade, los .zip/.7z son las ROMs y no se tocan.
fn expand_archives(dir: &Path, passwords: &[String], arcade: bool) -> anyhow::Result<Vec<String>> {
    let mut warnings = vec![];
    for _ in 0..3 {
        let archives: Vec<PathBuf> = walkdir::WalkDir::new(dir)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .map(|e| e.into_path())
            .filter(|p| {
                let e = ext(&p.to_string_lossy());
                ARCHIVES.contains(&e.as_str()) && !(arcade && e != "rar")
            })
            // Partes de un comprimido por volúmenes: solo la primera.
            .filter(|p| !p.to_string_lossy().to_lowercase().contains(".part") || p.to_string_lossy().to_lowercase().contains(".part1."))
            .collect();
        if archives.is_empty() {
            break;
        }
        for a in archives {
            let out = a.with_extension(format!("{}.x", ext(&a.to_string_lossy())));
            match extract_with(&a, &out, passwords) {
                Ok(()) => {
                    let _ = std::fs::remove_file(&a);
                }
                Err(e) => {
                    // Se aparta para no volver a probarlo y se sigue con lo demás.
                    let _ = std::fs::rename(&a, a.with_extension(format!("{}.no", ext(&a.to_string_lossy()))));
                    warnings.push(format!("{e:#}"));
                }
            }
        }
    }
    Ok(warnings)
}

// ───────────────────────── ordenar ─────────────────────────

fn rom_root(st: &AppState) -> PathBuf {
    let ds = super::file().download_settings;
    let raw = custom::expand_env(&ds.default_rom_path);
    if raw.trim().is_empty() {
        roms::roms_dir(st)
    } else {
        PathBuf::from(raw)
    }
}

/// Nombre de carpeta de un juego («Zelda (Europe) (En,Fr)» → «Zelda»).
fn folder_name(title: &str) -> String {
    let t = crate::library::names::clean_title(title);
    let s = crate::downloads::sanitize(if t.trim().is_empty() { title } else { &t });
    if s.trim().is_empty() {
        "Juego".into()
    } else {
        s
    }
}

/// Mueve sin pisar otro distinto; si ya hay uno igual (mismo tamaño), se reutiliza.
fn move_into(src: &Path, dir: &Path) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let name = src.file_name().ok_or_else(|| anyhow::anyhow!("archivo sin nombre"))?;
    let mut dest = dir.join(name);
    if dest.is_file() {
        if std::fs::metadata(&dest)?.len() == std::fs::metadata(src)?.len() {
            let _ = std::fs::remove_file(src);
            return Ok(dest);
        }
        let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let e = ext(&name.to_string_lossy());
        let mut n = 2;
        while dest.exists() {
            dest = dir.join(format!("{stem} ({n}).{e}"));
            n += 1;
        }
    }
    if std::fs::rename(src, &dest).is_err() {
        std::fs::copy(src, &dest)?;
        let _ = std::fs::remove_file(src);
    }
    Ok(dest)
}

/// Una carátula entre lo bajado: folder/cover/boxart.* o con el nombre de la ROM.
fn find_cover(dir: &Path, rom_stems: &[String], platform: &str) -> Option<PathBuf> {
    let exts = custom::cover_exts(platform);
    let files: Vec<PathBuf> = walkdir::WalkDir::new(dir).max_depth(4).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()).map(|e| e.into_path()).collect();
    let is_img = |p: &Path| exts.contains(&ext(&p.to_string_lossy()));
    let stem = |p: &Path| p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    files
        .iter()
        .find(|p| is_img(p) && COVER_NAMES.contains(&stem(p).as_str()))
        .or_else(|| files.iter().find(|p| is_img(p) && rom_stems.iter().any(|r| r.to_lowercase() == stem(p))))
        .cloned()
}

struct Organized {
    platform: Option<&'static Platform>,
    dir: PathBuf,
    /// ROMs de juegos (lo primero que se registra).
    games: Vec<PathBuf>,
    /// DLC/actualizaciones que no se reconocen por la cabecera: (ruta, dlc|update).
    extras: Vec<(PathBuf, String)>,
    cover: Option<PathBuf>,
    warnings: Vec<String>,
}

/// El juego base de un DLC/actualización: la entrada del catálogo ya bajada o, si no, uno
/// de la biblioteca del mismo sistema con el mismo nombre.
fn base_game(st: &AppState, req: &InstallRequest, system: &str) -> Option<crate::db::models::Game> {
    let by_index = req.base_game_id.as_deref().and_then(|b| super::index(st).get(&super::key(&req.source_id, b)).and_then(|r| r.game_ids.first().copied()));
    let id = by_index.or_else(|| {
        let want = norm_title(&req.title);
        st.db
            .with(|c| {
                let mut q = c.prepare("SELECT id, title FROM games WHERE platform = ?1 AND source = 'rom'")?;
                let rows: Vec<(i64, String)> = q.query_map([system], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
                Ok(rows)
            })
            .ok()?
            .into_iter()
            .filter(|(_, t)| {
                let t = norm_title(t);
                !t.is_empty() && (want == t || want.starts_with(&format!("{t} ")))
            })
            .max_by_key(|(_, t)| t.len())
            .map(|(id, _)| id)
    })?;
    st.db.with(|c| repo::get_game(c, id)).ok()
}

/// Título para comparar: sin etiquetas ni palabras de DLC/actualización.
fn norm_title(t: &str) -> String {
    let clean = crate::library::names::clean_title(t).to_lowercase();
    clean
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !matches!(*w, "dlc" | "update" | "upd" | "patch" | "pack" | "actualizacion" | "actualización"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn organize(st: &AppState, req: &InstallRequest, src: Option<&CatalogSource>, work: &Path) -> anyhow::Result<Organized> {
    let ds = super::file().download_settings;
    let external = req.platform.as_deref().and_then(platforms::external);
    let mut passwords: Vec<String> = src.map(|s| s.extract_passwords.clone()).unwrap_or_default();
    passwords.extend(ds.extract_passwords.iter().cloned());
    let pf_hint = external.and_then(platforms::internal).and_then(emulation::platform);
    let mut warnings = if ds.auto_extract { expand_archives(work, &passwords, pf_hint.is_some_and(|p| p.id == "arcade"))? } else { vec![] };

    let files: Vec<PathBuf> = walkdir::WalkDir::new(work)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .collect();

    // Plataforma: la del catálogo; si no, la que más archivos reconozca.
    let pf: Option<&'static Platform> = match (external, pf_hint) {
        (Some(_), Some(p)) => Some(p),
        (Some(_), None) => None,
        (None, _) => {
            let mut count: std::collections::HashMap<&'static str, usize> = Default::default();
            for f in &files {
                if let Some(p) = guess_platform(f) {
                    *count.entry(p.id).or_default() += 1;
                }
            }
            count.into_iter().max_by_key(|(_, n)| *n).and_then(|(id, _)| emulation::platform(id))
        }
    };

    let root = rom_root(st);
    let Some(pf) = pf else {
        // Sin emulador (PS4, PC…) o sin nada reconocible: se guarda tal cual.
        let dir = root.join(external.unwrap_or("otros")).join(folder_name(&req.title));
        for f in &files {
            let rel = f.strip_prefix(work).unwrap_or(f);
            move_into(f, &dir.join(rel.parent().unwrap_or(Path::new(""))))?;
        }
        return Ok(Organized { platform: None, dir, games: vec![], extras: vec![], cover: None, warnings });
    };

    let exts = exts_of(pf);
    let is_rom = |p: &Path| exts.contains(&ext(&p.to_string_lossy()));
    // Pistas de .cue/.gdi/.m3u: van con su índice, no sueltas.
    let mut tracks: HashSet<String> = HashSet::new();
    for f in files.iter().filter(|f| matches!(ext(&f.to_string_lossy()).as_str(), "cue" | "gdi" | "m3u")) {
        tracks.extend(roms::companions(f).iter().filter(|c| ext(&c.to_string_lossy()) != "cue").map(|c| norm_path(c)));
    }
    let mut found: Vec<PathBuf> = files.iter().filter(|f| is_rom(f) && !tracks.contains(&norm_path(f))).cloned().collect();
    // Un .m3u ya agrupa sus discos.
    let listed: HashSet<String> = found.iter().filter(|f| ext(&f.to_string_lossy()) == "m3u").flat_map(|m| roms::companions(m)).map(|c| norm_path(&c)).collect();
    found.retain(|f| !listed.contains(&norm_path(f)));
    if found.is_empty() {
        let mut why = crate::i18n::t("No hay ninguna ROM de {system} en lo descargado").replace("{system}", pf.name);
        if !warnings.is_empty() {
            why = format!("{why}: {}", warnings.join(" · "));
        }
        anyhow::bail!("{why}");
    }
    let stems: Vec<String> = found.iter().filter_map(|f| f.file_stem().map(|s| s.to_string_lossy().into_owned())).collect();
    let cover_src = find_cover(work, &stems, pf.id);

    let is_extra_cat = matches!(req.category.as_str(), "dlc" | "update");
    let sub = if req.category == "dlc" { "dlc" } else { "updates" };
    let base = is_extra_cat.then(|| base_game(st, req, pf.id)).flatten();
    let plat_root = if ds.organize_by_platform { custom::rom_folder(pf.id).unwrap_or_else(|| root.join(pf.id)) } else { root.clone() };
    let game_dir = match &base {
        Some(g) => g.rom_path.as_deref().and_then(|r| Path::new(r).parent().map(Path::to_path_buf)).unwrap_or_else(|| plat_root.join(folder_name(&g.title))),
        None => plat_root.join(folder_name(&req.title)),
    };
    let dest = if is_extra_cat { game_dir.join(sub) } else { game_dir.clone() };

    let mut games = vec![];
    let mut extras = vec![];
    for f in &found {
        for c in roms::companions(f) {
            move_into(&c, &dest)?;
        }
        let placed = move_into(f, &dest)?;
        let info = rominfo::read(&placed, pf.id);
        if info.is_extra() || (is_extra_cat && base.is_some()) {
            extras.push((placed, if info.is_extra() { String::new() } else { req.category.clone() }));
        } else {
            games.push(placed);
        }
    }
    // Varios discos de PlayStation sin .m3u: se crea uno para cambiar de disco en el emulador.
    if pf.id == "psx" && games.len() > 1 && games.iter().all(|g| matches!(ext(&g.to_string_lossy()).as_str(), "cue" | "chd" | "pbp")) {
        let mut sorted = games.clone();
        sorted.sort();
        let m3u = dest.join(format!("{}.m3u", folder_name(&req.title)));
        let body: String = sorted.iter().filter_map(|g| g.file_name().map(|n| format!("{}\n", n.to_string_lossy()))).collect();
        if std::fs::write(&m3u, body).is_ok() {
            games = vec![m3u];
        }
    }
    let cover = match cover_src {
        Some(c) => {
            let to = game_dir.join(format!("cover.{}", ext(&c.to_string_lossy())));
            std::fs::create_dir_all(&game_dir)?;
            std::fs::copy(&c, &to).ok().map(|_| to)
        }
        None => None,
    };
    if is_extra_cat && base.is_none() {
        warnings.push(crate::i18n::t("No se encontró el juego base en la biblioteca: se añade como juego aparte").into_owned());
    }
    Ok(Organized { platform: Some(pf), dir: game_dir, games, extras, cover, warnings })
}

// ───────────────────────── registrar ─────────────────────────

async fn register(st: &Arc<AppState>, req: &InstallRequest, o: Organized) -> anyhow::Result<InstallOutcome> {
    let Some(pf) = o.platform else {
        return Ok(InstallOutcome { game_ids: vec![], extras: 0, dir: o.dir.to_string_lossy().into_owned(), not_emulated: true });
    };
    let base = if matches!(req.category.as_str(), "dlc" | "update") { base_game(st, req, pf.id) } else { None };
    let mut out = InstallOutcome { dir: o.dir.to_string_lossy().into_owned(), ..Default::default() };
    let mut new_ids = vec![];
    for (path, kind) in &o.extras {
        let mut info = rominfo::read(path, pf.id);
        if !info.is_extra() {
            // Sin TitleID en la cabecera: se engancha por el juego base de la biblioteca.
            let Some(b) = &base else { continue };
            let base_tid = b.rom_meta.as_deref().and_then(|m| serde_json::from_str::<rominfo::RomInfo>(m).ok()).and_then(|i| i.title_id).unwrap_or_else(|| format!("game:{}", b.id));
            info.title_id = Some(path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());
            info.base_title_id = Some(base_tid);
            info.kind = Some(if kind == "dlc" { "dlc".into() } else { "update".into() });
            if info.version.is_none() {
                info.version = req.version.clone();
            }
        }
        st.db.with(|c| emulation::save_extra(c, pf.id, path, &info))?;
        out.extras += 1;
    }
    for rom in &o.games {
        let mut g = emulation::rom_game(rom, pf);
        // El nombre del catálogo es mejor que el del archivo («eboot», «game»…) salvo con varias ROMs.
        if o.games.len() == 1 && !req.title.trim().is_empty() {
            g.title = crate::library::names::clean_title(&req.title);
        }
        if let Some(r) = req.region.as_deref().filter(|r| !r.is_empty()) {
            let mut info: rominfo::RomInfo = g.rom_meta.as_deref().and_then(|m| serde_json::from_str(m).ok()).unwrap_or_default();
            if info.region.is_none() {
                info.region = Some(r.to_string());
                g.rom_meta = serde_json::to_string(&info).ok();
            }
        }
        if let Some((id, is_new)) = st.db.with(|c| repo::upsert_game(c, &g))? {
            out.game_ids.push(id);
            if is_new {
                new_ids.push(id);
            }
        }
    }
    // Las extras sin juego base van como juegos sueltos (para no perderlas).
    if base.is_none() && o.games.is_empty() {
        for (path, kind) in &o.extras {
            if kind.is_empty() {
                continue;
            }
            let g = emulation::rom_game(path, pf);
            if let Some((id, is_new)) = st.db.with(|c| repo::upsert_game(c, &g))? {
                out.game_ids.push(id);
                if is_new {
                    new_ids.push(id);
                }
            }
        }
    }
    if let Some(b) = &base {
        if out.game_ids.is_empty() {
            out.game_ids.push(b.id);
        }
    }
    if let Some(pid) = *st.profile.read() {
        let _ = st.db.with(|c| repo::ensure_platform_collection(c, pid, pf.name, pf.id));
    }
    // Metadatos (IGDB, libretro-thumbnails…) como cualquier juego nuevo.
    crate::services::after_new_games(st, new_ids.iter().map(|id| (*id, None)).collect()).await;
    // Carátula: la que venía en la descarga; si no, la de la ficha del catálogo.
    if let Some(gid) = new_ids.first().copied() {
        if let Some(c) = &o.cover {
            let (s2, c2) = (st.clone(), c.clone());
            let r = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
                let bytes = std::fs::read(&c2)?;
                let stored = crate::media::store::store_image(&s2.paths, &bytes, "cover")?;
                s2.db.with(|c| {
                    let mid = repo::insert_media(c, gid, "cover", None, "user", true, 0, None, None)?;
                    repo::set_media_file(c, mid, &stored.hash, &stored.ext, stored.thumb_hash.as_deref(), stored.w, stored.h)?;
                    repo::select_media(c, gid, mid)
                })?;
                Ok(())
            })
            .await;
            if let Ok(Err(e)) | Err(e) = r.map_err(anyhow::Error::from) {
                tracing::debug!("catálogo: carátula local: {e:#}");
            }
        } else if let Some(url) = req.cover.as_deref().filter(|u| u.starts_with("https://") || u.starts_with("http://")) {
            let u = url.to_string();
            match st.db.with(|c| repo::insert_media(c, gid, "cover", Some(&u), "user", true, 0, None, None)) {
                Ok(mid) => {
                    let _ = st.db.with(|c| repo::select_media(c, gid, mid));
                    if let Err(e) = crate::media::download::download_into(st, mid, &u, "cover").await {
                        tracing::debug!("catálogo: carátula {u}: {e:#}");
                    }
                }
                Err(e) => tracing::debug!("catálogo: carátula: {e:#}"),
            }
        }
    }
    crate::events::library_reset(st);
    Ok(out)
}

// ───────────────────────── HTTP ─────────────────────────

fn content_disposition_name(v: &str) -> Option<String> {
    let lower = v.to_lowercase();
    if let Some(i) = lower.find("filename*=") {
        let raw = v[i + 10..].split(';').next()?.trim();
        let raw = raw.split("''").last()?.trim_matches('"');
        return Some(percent_encoding::percent_decode_str(raw).decode_utf8_lossy().into_owned());
    }
    let i = lower.find("filename=")?;
    Some(v[i + 9..].split(';').next()?.trim().trim_matches('"').to_string())
}

fn safe_file(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c }).collect();
    s.trim().trim_matches('.').to_string()
}

async fn download(st: &AppState, job: &str, req: &InstallRequest, src: Option<&CatalogSource>, dir: &Path) -> anyhow::Result<PathBuf> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(120))
        .cookie_store(true)
        .user_agent(format!("ejGames/{} (+https://github.com/ej3mpl0/ejGames)", env!("CARGO_PKG_VERSION")))
        .build()?;
    let mut rq = http.get(&req.url);
    // Las cabeceras de la fuente solo van a su propio sitio.
    if let Some(s) = src.filter(|s| super::adapter::same_site(s, &req.url)) {
        for (k, v) in &s.headers {
            rq = rq.header(k.as_str(), v.as_str());
        }
        rq = rq.header("Referer", s.base_url.as_str());
    }
    let mut resp = rq.send().await?.error_for_status()?;
    if !matches!(resp.url().scheme(), "https" | "http") {
        anyhow::bail!("{}", crate::i18n::t("Origen de la descarga no permitido"));
    }
    let ctype = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    if ctype.starts_with("text/html") {
        anyhow::bail!("{}", crate::i18n::t("El enlace lleva a una página web, no a un archivo: ábrelo en el navegador."));
    }
    let name = resp
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(content_disposition_name)
        .or_else(|| resp.url().path_segments().and_then(|mut s| s.next_back()).map(|n| percent_encoding::percent_decode_str(n).decode_utf8_lossy().into_owned()))
        .map(|n| safe_file(&n))
        .filter(|n| n.contains('.'))
        .unwrap_or_else(|| format!("{}.bin", folder_name(&req.title)));
    let total = resp.content_length().unwrap_or(0);
    if let Some(free) = crate::downloads::win::disk_free(dir) {
        if total > 0 && free < total * 2 + (256 << 20) {
            anyhow::bail!("{} {}", crate::i18n::t("No hay espacio suficiente en el disco:"), dir.display());
        }
    }
    std::fs::create_dir_all(dir)?;
    let dest = dir.join(&name);
    let part = dir.join(format!("{name}.part"));
    let mut file = std::fs::File::create(&part)?;
    let (mut got, mut last) = (0u64, Instant::now() - Duration::from_secs(1));
    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk)?;
        got += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(200) {
            last = Instant::now();
            emit(st, job, "download", got, total, None);
            if cancelled(job) {
                drop(file);
                let _ = std::fs::remove_file(&part);
                anyhow::bail!("{}", crate::i18n::t("Cancelado"));
            }
        }
    }
    file.flush()?;
    drop(file);
    std::fs::rename(&part, &dest)?;
    emit(st, job, "download", got, got.max(total), None);
    Ok(dest)
}

static CANCEL: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn cancelled(job: &str) -> bool {
    CANCEL.lock().as_ref().is_some_and(|s| s.contains(job))
}

pub fn cancel(job: &str) {
    CANCEL.lock().get_or_insert_with(HashSet::new).insert(job.to_string());
}

/// Baja un enlace directo y lo instala. Devuelve los juegos que quedan en la biblioteca.
pub async fn install_http(st: &Arc<AppState>, req: InstallRequest) -> anyhow::Result<InstallOutcome> {
    let job = super::key(&req.source_id, &req.game_id);
    if !(req.url.starts_with("https://") || req.url.starts_with("http://")) {
        anyhow::bail!("{}", crate::i18n::t("Ese enlace no es una descarga directa"));
    }
    if !BUSY.lock().get_or_insert_with(HashSet::new).insert(job.clone()) {
        anyhow::bail!("{}", crate::i18n::t("Ya se está descargando"));
    }
    CANCEL.lock().get_or_insert_with(HashSet::new).remove(&job);
    let src = super::source(&req.source_id).ok();
    let work = rom_root(st).join(".descargas").join(crate::downloads::sanitize(&job.replace(['|', '/', '\\'], "_")));
    let _ = std::fs::remove_dir_all(&work);
    let res = async {
        download(st, &job, &req, src.as_ref(), &work).await?;
        emit(st, &job, "extract", 0, 0, None);
        process(st, &job, &req, src.as_ref(), &work).await
    }
    .await;
    let _ = std::fs::remove_dir_all(&work);
    BUSY.lock().get_or_insert_with(HashSet::new).remove(&job);
    match &res {
        Ok(_) => emit(st, &job, "done", 0, 0, None),
        Err(e) => emit(st, &job, "error", 0, 0, Some(&format!("{e:#}"))),
    }
    res
}

/// Ordena y registra lo que hay en `work` (bajado por HTTP o por torrent).
async fn process(st: &Arc<AppState>, job: &str, req: &InstallRequest, src: Option<&CatalogSource>, work: &Path) -> anyhow::Result<InstallOutcome> {
    let (s2, r2, src2, w2) = (st.clone(), req.clone(), src.cloned(), work.to_path_buf());
    let org = tauri::async_runtime::spawn_blocking(move || organize(&s2, &r2, src2.as_ref(), &w2)).await??;
    emit(st, job, "organize", 0, 0, None);
    for w in &org.warnings {
        tracing::warn!("catálogo {job}: {w}");
    }
    let warnings = org.warnings.clone();
    let platform = org.platform.map(|p| p.id.to_string()).unwrap_or_default();
    let out = register(st, req, org).await?;
    super::remember(
        st,
        &req.source_id,
        &req.game_id,
        InstalledRec { game_ids: out.game_ids.clone(), dir: out.dir.clone(), platform, category: req.category.clone(), title: req.title.clone(), at: crate::explore::fitgirl::unix_now() },
    );
    if !warnings.is_empty() {
        crate::events::toast(st, "info", warnings.join(" · "));
    }
    Ok(out)
}

// ───────────────────────── torrents ─────────────────────────

fn torrents_path(st: &AppState) -> PathBuf {
    st.paths.root.join("catalogs").join("torrents.json")
}

fn torrent_ctx(st: &AppState) -> std::collections::HashMap<String, InstallRequest> {
    std::fs::read(torrents_path(st)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// De un .torrent (bytes) al magnet equivalente, con sus trackers.
pub fn magnet_from_torrent(bytes: &[u8], name: &str) -> anyhow::Result<String> {
    let t = librqbit_core::torrent_metainfo::torrent_from_bytes(bytes).map_err(|e| anyhow::anyhow!("{} {e}", crate::i18n::t("El .torrent no es válido:")))?;
    let mut m = format!("magnet:?xt=urn:btih:{}&dn={}", t.info_hash.as_string(), percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC));
    let mut trackers: Vec<String> = t.announce.iter().map(|a| String::from_utf8_lossy(a.as_ref()).into_owned()).collect();
    for tier in &t.announce_list {
        trackers.extend(tier.iter().map(|a| String::from_utf8_lossy(a.as_ref()).into_owned()));
    }
    trackers.dedup();
    for tr in trackers.iter().take(20) {
        m.push_str("&tr=");
        m.push_str(&percent_encoding::utf8_percent_encode(tr, percent_encoding::NON_ALPHANUMERIC).to_string());
    }
    Ok(m)
}

/// Prepara un torrent de una entrada (magnet o .torrent) en el motor de Descargas.
/// Al terminar, «Instalar» en Descargas lo pasa por esta misma cadena (`from_torrent`).
pub async fn prepare_torrent(st: &Arc<AppState>, req: InstallRequest) -> anyhow::Result<crate::downloads::PreparedDownload> {
    let magnet = if req.url.starts_with("magnet:") {
        req.url.clone()
    } else {
        let src = super::source(&req.source_id).ok();
        let mut rq = reqwest::Client::builder().timeout(Duration::from_secs(40)).build()?.get(&req.url);
        if let Some(s) = src.as_ref().filter(|s| super::adapter::same_site(s, &req.url)) {
            for (k, v) in &s.headers {
                rq = rq.header(k.as_str(), v.as_str());
            }
        }
        let bytes = rq.send().await?.error_for_status()?.bytes().await?;
        if bytes.len() > 20 << 20 {
            anyhow::bail!("torrent demasiado grande");
        }
        magnet_from_torrent(&bytes, &req.title)?
    };
    let prep = crate::downloads::prepare_catalog(st, &magnet, &req.title, req.cover.clone()).await?;
    let mut m = torrent_ctx(st);
    m.insert(prep.slug.clone(), req);
    let p = torrents_path(st);
    if let Some(d) = p.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(p, serde_json::to_vec_pretty(&m).unwrap_or_default());
    Ok(prep)
}

/// «Instalar» de una descarga de catálogo por torrent: ordena lo bajado y lo registra.
pub async fn from_torrent(st: &Arc<AppState>, row: &DownloadRow) -> anyhow::Result<InstallOutcome> {
    let ctx = row.slug.as_deref().and_then(|s| torrent_ctx(st).remove(s));
    // Sin contexto (se borró catalogs	orrents.json): se adivina la plataforma por los archivos.
    let req = ctx.unwrap_or_else(|| InstallRequest {
        game_id: row.slug.clone().unwrap_or_default(),
        title: row.title.clone(),
        category: "game".into(),
        ..Default::default()
    });
    let src = super::source(&req.source_id).ok();
    let job = super::key(&req.source_id, &req.game_id);
    process(st, &job, &req, src.as_ref(), Path::new(&row.output_dir)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_with_password_and_nested_archives() {
        let d = tempfile::tempdir().unwrap();
        let inner = d.path().join("inner.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&inner).unwrap());
            w.start_file("Juego (Europe).sfc", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"rom").unwrap();
            w.finish().unwrap();
        }
        let outer = d.path().join("descarga").join("pack.zip");
        std::fs::create_dir_all(outer.parent().unwrap()).unwrap();
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&outer).unwrap());
            let o = zip::write::SimpleFileOptions::default().with_aes_encryption(zip::AesMode::Aes256, "secreta");
            w.start_file("dentro/inner.zip", o).unwrap();
            w.write_all(&std::fs::read(&inner).unwrap()).unwrap();
            w.start_file("folder.jpg", o).unwrap();
            w.write_all(b"jpg").unwrap();
            w.finish().unwrap();
        }
        let work = outer.parent().unwrap();
        // Sin la contraseña: se aparta y avisa.
        let warn = expand_archives(work, &[], false).unwrap();
        assert_eq!(warn.len(), 1);
        std::fs::rename(work.join("pack.zip.no"), &outer).unwrap();
        let warn = expand_archives(work, &["otra".into(), "secreta".into()], false).unwrap();
        assert!(warn.is_empty(), "{warn:?}");
        let files: Vec<String> = walkdir::WalkDir::new(work).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(files.contains(&"Juego (Europe).sfc".to_string()), "{files:?}");
        assert!(files.contains(&"folder.jpg".to_string()));
        assert!(!files.iter().any(|f| f.ends_with(".zip")));
        assert!(find_cover(work, &[], "snes").is_some());
    }

    #[test]
    fn names_and_known_files() {
        assert_eq!(folder_name("Zelda: Breath of the Wild (Europe) (En,Fr)"), crate::downloads::sanitize("Zelda: Breath of the Wild"));
        assert!(is_known_file("/dl/juego.nsp"));
        assert!(is_known_file("/dl/juego.7z"));
        assert!(!is_known_file("/file/123"));
        assert_eq!(content_disposition_name("attachment; filename=\"Juego (USA).zip\"").as_deref(), Some("Juego (USA).zip"));
        assert_eq!(content_disposition_name("attachment; filename*=UTF-8''Juego%20%C3%91.7z").as_deref(), Some("Juego Ñ.7z"));
        assert_eq!(norm_title("Mario Kart 8 Deluxe [DLC] Booster Pack"), "mario kart 8 deluxe booster");
    }

    #[test]
    fn magnet_from_a_torrent_file() {
        // .torrent mínimo: un archivo de 3 bytes y un tracker.
        let info = b"d6:lengthi3e4:name5:a.sfc12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
        let mut t = b"d8:announce20:udp://tracker.test:14:info".to_vec();
        t.extend_from_slice(info);
        t.push(b'e');
        let m = magnet_from_torrent(&t, "Juego").unwrap();
        assert!(m.starts_with("magnet:?xt=urn:btih:") && m.contains("&dn=Juego") && m.contains("&tr=udp%3A%2F%2Ftracker%2Etest%3A1"), "{m}");
    }
}
