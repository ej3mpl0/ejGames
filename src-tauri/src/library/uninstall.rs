//! Desinstalar un juego a petición del usuario (siempre desde el diálogo del
//! host, nunca directamente desde un tema). Por orden:
//! 1. su desinstalador: el de su entrada en Windows o un `unins000.exe`
//!    (`uninstall.exe`…) en su carpeta;
//! 2. si no tiene, su carpeta a la papelera de reciclaje.
//!
//! Cuando el juego desaparece del disco, se quita de la biblioteca. Los juegos de
//! consola se borran: sus archivos (con su DLC y actualizaciones) a la papelera.

use crate::db::{models::Game, repo};
use crate::state::AppState;
use anyhow::{bail, Context};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub game_id: i64,
    pub title: String,
    /// `uninstaller` | `folder`
    pub method: String,
    pub dir: Option<String>,
    /// El programa que se abrirá (para enseñarlo en el diálogo).
    pub program: Option<String>,
    pub size_bytes: Option<u64>,
}

enum Action {
    Run { file: String, args: String },
    Recycle(PathBuf),
    /// Juego de consola: sus archivos a la papelera y fuera de la biblioteca (con los
    /// juegos que vinieron en la misma descarga).
    Console { files: Vec<PathBuf>, ids: Vec<i64> },
}

fn norm(p: &str) -> String {
    p.trim().trim_matches('"').replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// `inner` es `outer` o está dentro.
fn within(inner: &str, outer: &str) -> bool {
    inner == outer || inner.starts_with(&format!("{outer}\\"))
}

fn game_dir(g: &Game) -> Option<PathBuf> {
    g.install_dir
        .as_deref()
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| g.exe_path.as_deref().and_then(|e| Path::new(e).parent().map(Path::to_path_buf)))
}

/// Separa un `UninstallString` en programa y argumentos.
pub fn split_command(cmd: &str) -> Option<(String, String)> {
    let cmd = cmd.trim();
    if cmd.is_empty() {
        return None;
    }
    if let Some(rest) = cmd.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some((rest[..end].to_string(), rest[end + 1..].trim().to_string()));
    }
    // Sin comillas: hasta el primer ".exe" (las rutas con espacios suelen venir así).
    let lower = cmd.to_lowercase();
    if let Some(i) = lower.find(".exe") {
        let end = i + 4;
        return Some((cmd[..end].to_string(), cmd[end..].trim().to_string()));
    }
    Some((cmd.to_string(), String::new()))
}

/// Una entrada de «Aplicaciones instaladas».
#[derive(Debug, Clone)]
pub struct Entry {
    pub location: String,
    pub uninstall: String,
}

fn registry_entries() -> Vec<Entry> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
        use winreg::RegKey;
        const PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
        let roots = [
            (RegKey::predef(HKEY_CURRENT_USER), KEY_READ),
            (RegKey::predef(HKEY_LOCAL_MACHINE), KEY_READ | KEY_WOW64_64KEY),
            (RegKey::predef(HKEY_LOCAL_MACHINE), KEY_READ | KEY_WOW64_32KEY),
        ];
        for (root, flags) in roots {
            let Ok(key) = root.open_subkey_with_flags(PATH, flags) else { continue };
            for name in key.enum_keys().flatten() {
                let Ok(sub) = key.open_subkey_with_flags(&name, flags) else { continue };
                let uninstall: String = sub.get_value("UninstallString").unwrap_or_default();
                if uninstall.trim().is_empty() {
                    continue;
                }
                let location: String = sub
                    .get_value("InstallLocation")
                    .or_else(|_| sub.get_value("Inno Setup: App Path"))
                    .unwrap_or_default();
                out.push(Entry { location, uninstall });
            }
        }
    }
    out
}

/// El desinstalador registrado de la carpeta `dir`: una entrada con esa misma
/// carpeta o cuyo desinstalador está dentro de ella.
pub fn registered(dir: &str, entries: &[Entry]) -> Option<(String, String)> {
    let d = norm(dir);
    let exact = entries.iter().find(|e| !e.location.trim().is_empty() && norm(&e.location) == d);
    let inside = || {
        entries.iter().find(|e| {
            split_command(&e.uninstall)
                .map(|(f, _)| norm(&f).starts_with(&format!("{d}\\")))
                .unwrap_or(false)
        })
    };
    exact.or_else(inside).and_then(|e| split_command(&e.uninstall))
}

/// `unins000.exe`, `uninstall.exe`… en la raíz de la carpeta del juego.
pub fn local_uninstaller(dir: &Path) -> Option<PathBuf> {
    let mut found: Vec<(u8, PathBuf)> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            let rank = if name.len() == 12 && name.starts_with("unins") && name.ends_with(".exe") && name[5..8].bytes().all(|b| b.is_ascii_digit()) {
                0
            } else {
                match name.as_str() {
                    "uninstall.exe" | "uninst.exe" => 1,
                    "uninstaller.exe" | "uninstall game.exe" => 2,
                    _ => return None,
                }
            };
            Some((rank, e.path()))
        })
        .collect();
    found.sort();
    found.into_iter().next().map(|(_, p)| p)
}

/// Solo se manda a la papelera la carpeta de un juego: nunca una unidad, una
/// carpeta de la biblioteca, de descargas o del sistema, ni una que tenga dentro
/// otros juegos.
pub fn check_folder(dir: &str, protected: &[String], others: &[String]) -> Result<(), String> {
    let d = norm(dir);
    let p = Path::new(dir);
    if !p.is_absolute() || p.parent().is_none() || d.len() <= 3 {
        return Err(crate::i18n::t("Esa carpeta no se puede borrar.").into());
    }
    for x in protected.iter().map(|x| norm(x)).filter(|x| !x.is_empty()) {
        if within(&x, &d) {
            return Err(crate::i18n::t("La carpeta del juego es también una carpeta de tu biblioteca o del sistema: no se borra.").into());
        }
    }
    for o in others.iter().map(|o| norm(o)).filter(|o| !o.is_empty()) {
        if within(&o, &d) {
            return Err(crate::i18n::t("En la carpeta del juego hay otros juegos de tu biblioteca: no se borra.").into());
        }
    }
    Ok(())
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            match e.file_type() {
                Ok(t) if t.is_dir() => stack.push(e.path()),
                Ok(t) if t.is_file() => total += e.metadata().map(|m| m.len()).unwrap_or(0),
                _ => {}
            }
        }
    }
    total
}

/// Carpetas que nunca se mandan a la papelera.
fn protected(st: &AppState) -> Vec<String> {
    let mut out: Vec<String> = st
        .db
        .with(repo::list_folders)
        .map(|l| l.into_iter().map(|f| f.path).collect())
        .unwrap_or_default();
    let s = st.settings.get();
    out.push(s.download_dir);
    out.push(s.install_dir);
    out.push(st.paths.root.to_string_lossy().into_owned());
    if let Some(d) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        out.push(d.to_string_lossy().into_owned());
    }
    for var in ["WINDIR", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PUBLIC"] {
        if let Ok(v) = std::env::var(var) {
            out.push(v);
        }
    }
    for d in [dirs::desktop_dir(), dirs::document_dir(), dirs::download_dir(), dirs::home_dir()].into_iter().flatten() {
        out.push(d.to_string_lossy().into_owned());
    }
    out
}

/// Carpetas del resto de juegos de la biblioteca (sin los de `ids`).
fn other_dirs(st: &AppState, ids: &[i64]) -> Vec<String> {
    st.db
        .with(|c| {
            let mut q = c.prepare("SELECT id, install_dir, exe_path FROM games")?;
            let rows = q.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?)))?;
            Ok(rows
                .flatten()
                .filter(|(id, _, _)| !ids.contains(id))
                .filter_map(|(_, d, e)| d.filter(|d| !d.trim().is_empty()).or_else(|| e.and_then(|e| Path::new(&e).parent().map(|p| p.to_string_lossy().into_owned()))))
                .collect())
        })
        .unwrap_or_default()
}

fn file_size(p: &Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

/// Lo que se borra de un juego de consola: si se bajó de un catálogo, la carpeta que
/// hizo ejGames (`roms\<sistema>\<juego>`, con su DLC y actualizaciones, y los juegos que
/// vinieron en ella); si no, su ROM con las actualizaciones y DLC enganchados a ella.
fn console_files(st: &AppState, g: &Game) -> anyhow::Result<(Vec<PathBuf>, Vec<i64>)> {
    let rec = crate::catalogs::index(st).into_values().find(|r| r.game_ids.contains(&g.id) && Path::new(&r.dir).is_dir());
    let others = rec.as_ref().map(|r| other_dirs(st, &r.game_ids)).unwrap_or_default();
    let base = g.rom_meta.as_deref().and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok()).and_then(|v| v["titleId"].as_str().map(str::to_string));
    let extras: Vec<String> = match (&rec, g.platform.as_deref(), base) {
        (None, Some(pf), Some(base)) => st
            .db
            .with(|c| {
                let mut q = c.prepare("SELECT path FROM rom_extras WHERE platform = ?1 AND base_title_id = ?2")?;
                let rows = q.query_map([pf, base.as_str()], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap_or_default(),
        _ => vec![],
    };
    console_targets(g, rec, extras, &protected(st), &others)
}

/// La decisión de `console_files`, sin tocar la base de datos.
fn console_targets(g: &Game, rec: Option<crate::catalogs::InstalledRec>, extras: Vec<String>, protected: &[String], others: &[String]) -> anyhow::Result<(Vec<PathBuf>, Vec<i64>)> {
    if let Some(rec) = rec {
        check_folder(&rec.dir, protected, others).map_err(anyhow::Error::msg)?;
        return Ok((vec![PathBuf::from(&rec.dir)], rec.game_ids));
    }
    let rom = g
        .rom_path
        .as_deref()
        .or(g.exe_path.as_deref())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && p.is_file())
        .context(crate::i18n::t("El archivo de este juego ya no está. Puedes quitarlo de la biblioteca en Editar."))?;
    let mut files = vec![rom];
    files.extend(extras.into_iter().map(PathBuf::from).filter(|p| p.is_absolute() && p.is_file()));
    Ok((files, vec![g.id]))
}

fn resolve(st: &AppState, id: i64) -> anyhow::Result<(Game, Plan, Action)> {
    let g = st.db.with(|c| repo::get_game(c, id)).map_err(|_| anyhow::anyhow!("{}", crate::i18n::t("Ese juego ya no está en la biblioteca")))?;
    if st.sessions.is_running(id) {
        bail!("{}", crate::i18n::t("Cierra el juego antes de desinstalarlo."));
    }
    let mut plan = Plan { game_id: id, title: g.title.clone(), method: String::new(), dir: None, program: None, size_bytes: None };
    if g.platform.is_some() {
        let (files, ids) = console_files(st, &g)?;
        plan.method = "console".into();
        plan.dir = files.first().map(|p| p.to_string_lossy().into_owned());
        plan.size_bytes = Some(files.iter().map(|p| if p.is_dir() { dir_size(p) } else { file_size(p) }).sum());
        return Ok((g, plan, Action::Console { files, ids }));
    }
    let dir = game_dir(&g).context(crate::i18n::t("No se sabe en qué carpeta está este juego"))?;
    if !dir.is_dir() {
        bail!("{}", crate::i18n::t("La carpeta del juego ya no existe. Puedes quitarlo de la biblioteca en Editar."));
    }
    let dir_s = dir.to_string_lossy().into_owned();
    plan.dir = Some(dir_s.clone());
    plan.size_bytes = Some(dir_size(&dir));
    if let Some((file, args)) = registered(&dir_s, &registry_entries()) {
        plan.method = "uninstaller".into();
        plan.program = Path::new(&file).file_name().map(|n| n.to_string_lossy().into_owned());
        return Ok((g, plan, Action::Run { file, args }));
    }
    if let Some(u) = local_uninstaller(&dir) {
        plan.method = "uninstaller".into();
        plan.program = u.file_name().map(|n| n.to_string_lossy().into_owned());
        return Ok((g, plan, Action::Run { file: u.to_string_lossy().into_owned(), args: String::new() }));
    }
    check_folder(&dir_s, &protected(st), &other_dirs(st, &[id])).map_err(anyhow::Error::msg)?;
    plan.method = "folder".into();
    Ok((g, plan, Action::Recycle(dir)))
}

/// Qué pasará al desinstalar (para el diálogo de confirmación).
pub fn plan(st: &AppState, id: i64) -> anyhow::Result<Plan> {
    resolve(st, id).map(|(_, p, _)| p)
}

/// Desinstala. Devuelve `started` si abrió un desinstalador (el juego se quitará
/// al desaparecer del disco) o `removed` si ya está fuera.
pub fn run(st: Arc<AppState>, id: i64) -> anyhow::Result<&'static str> {
    let (g, _, action) = resolve(&st, id)?;
    match action {
        Action::Run { file, args } => {
            let dir = Path::new(&file).parent().map(|p| p.to_string_lossy().into_owned());
            #[cfg(windows)]
            {
                use crate::launcher::launch::{start_installer, InstallerError};
                match start_installer("open", &file, &args, dir.as_deref()) {
                    Ok(_) => {}
                    Err(InstallerError::Cancelled) => bail!("{}", crate::i18n::t("Has cancelado el permiso de administrador.")),
                    Err(InstallerError::Other(e)) => return Err(e.context(crate::i18n::t("No se pudo abrir el desinstalador"))),
                }
            }
            #[cfg(not(windows))]
            let _ = (dir, args);
            let st2 = st.clone();
            std::thread::spawn(move || watch(st2, g));
            Ok("started")
        }
        Action::Recycle(dir) => {
            recycle(&dir)?;
            if dir.exists() {
                bail!("{}", crate::i18n::t("No se pudo mandar la carpeta a la papelera."));
            }
            forget(&st, &g);
            Ok("removed")
        }
        Action::Console { files, ids } => {
            for f in &files {
                recycle(f)?;
                if f.exists() {
                    bail!("{}", crate::i18n::tf("No se pudo mandar a la papelera: {0}", &[&f.display()]));
                }
            }
            let paths: Vec<String> = files.iter().map(|p| p.to_string_lossy().into_owned()).collect();
            let _ = st.db.with(|c| {
                for p in &paths {
                    c.execute("DELETE FROM rom_extras WHERE path = ?1", [p])?;
                }
                for id in ids.iter().filter(|i| **i != g.id) {
                    repo::delete_game(c, *id)?;
                }
                Ok(())
            });
            crate::catalogs::forget_installed(&st, &ids);
            if st.db.with(|c| repo::delete_game(c, g.id)).is_ok() {
                crate::events::library_reset(&st);
                crate::events::toast(&st, "ok", format!("«{}» borrado", g.title));
                tracing::info!("juego de consola borrado: {} ({})", g.title, g.id);
            }
            Ok("removed")
        }
    }
}

/// Espera a que el desinstalador quite el juego (los de Inno Setup se copian a
/// %TEMP% y el proceso que se abrió termina enseguida: se mira el disco).
fn watch(st: Arc<AppState>, g: Game) {
    let exe = g.exe_path.clone().map(PathBuf::from);
    let dir = game_dir(&g);
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(3600) {
        std::thread::sleep(Duration::from_secs(2));
        let gone = exe.as_ref().map(|e| !e.exists()).unwrap_or(false) || dir.as_ref().map(|d| !d.exists()).unwrap_or(false);
        if gone {
            // Da tiempo a que termine de borrar antes de avisar.
            std::thread::sleep(Duration::from_secs(1));
            forget(&st, &g);
            return;
        }
        if st.db.with(|c| repo::get_game(c, g.id)).is_err() {
            return;
        }
    }
}

fn forget(st: &AppState, g: &Game) {
    if st.db.with(|c| repo::delete_game(c, g.id)).is_ok() {
        crate::events::library_reset(st);
        crate::events::toast(st, "ok", format!("«{}» desinstalado", g.title));
        tracing::info!("juego desinstalado: {} ({})", g.title, g.id);
    }
}

/// A la papelera (Windows avisa si no cabe y habría que borrarlo del todo).
#[cfg(windows)]
fn recycle(dir: &Path) -> anyhow::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW};
    let mut from: Vec<u16> = dir.as_os_str().encode_wide().collect();
    from.extend([0, 0]);
    let mut op = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        fFlags: (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_WANTNUKEWARNING.0) as u16,
        ..Default::default()
    };
    let r = unsafe { SHFileOperationW(&mut op) };
    if r != 0 || op.fAnyOperationsAborted.as_bool() {
        bail!("{}", crate::i18n::tf("No se pudo mandar la carpeta a la papelera (código {0}).", &[&r]));
    }
    Ok(())
}

#[cfg(not(windows))]
fn recycle(_dir: &Path) -> anyhow::Result<()> {
    bail!("Solo en Windows")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_uninstall_strings() {
        assert_eq!(split_command(r#""C:\Games\X\unins000.exe""#).unwrap(), (r"C:\Games\X\unins000.exe".into(), "".into()));
        assert_eq!(split_command(r#""C:\Games\X\unins000.exe" /SILENT"#).unwrap(), (r"C:\Games\X\unins000.exe".into(), "/SILENT".into()));
        assert_eq!(split_command(r"C:\Program Files\Y Game\uninstall.exe /x").unwrap(), (r"C:\Program Files\Y Game\uninstall.exe".into(), "/x".into()));
        assert_eq!(split_command("MsiExec.exe /X{1234}").unwrap(), ("MsiExec.exe".into(), "/X{1234}".into()));
        assert!(split_command("  ").is_none());
    }

    #[test]
    fn matches_registered_uninstallers() {
        let entries = vec![
            Entry { location: r"E:\Games".into(), uninstall: r#""E:\Games\launcher\uninstall.exe""#.into() },
            Entry { location: r"E:\Games\Hollow".into(), uninstall: r#""E:\Games\Hollow\unins000.exe""#.into() },
            Entry { location: "".into(), uninstall: r#""E:\Games\Celeste\uninst.exe" /S"#.into() },
        ];
        assert_eq!(registered(r"E:\Games\Hollow\", &entries).unwrap().0, r"E:\Games\Hollow\unins000.exe");
        assert_eq!(registered(r"e:\games\celeste", &entries).unwrap(), (r"E:\Games\Celeste\uninst.exe".into(), "/S".into()));
        // La entrada de E:\Games no vale para un juego que está dentro.
        assert!(registered(r"E:\Games\Other", &entries).is_none());
        // Ni una carpeta que empieza igual.
        assert!(registered(r"E:\Games\Hollow Knight", &entries).is_none());
    }

    #[test]
    fn console_games_take_their_files() {
        let d = tempfile::tempdir().unwrap();
        let rom = d.path().join("Juego.nsp");
        let upd = d.path().join("Juego [UPD].nsp");
        std::fs::write(&rom, b"rom").unwrap();
        std::fs::write(&upd, b"upd").unwrap();
        let g = Game { id: 7, platform: Some("switch".into()), rom_path: Some(rom.to_string_lossy().into()), ..Default::default() };
        // Suelta: su ROM y sus extras que sigan ahí.
        let gone = d.path().join("borrado.nsp").to_string_lossy().into_owned();
        let (files, ids) = console_targets(&g, None, vec![upd.to_string_lossy().into(), gone], &[], &[]).unwrap();
        assert_eq!((files, ids), (vec![rom.clone(), upd.clone()], vec![7]));
        // Bajada de un catálogo: su carpeta entera y los juegos que vinieron con ella.
        let dir = d.path().join("roms").join("switch").join("Juego");
        std::fs::create_dir_all(&dir).unwrap();
        let rec = crate::catalogs::InstalledRec { game_ids: vec![7, 8], dir: dir.to_string_lossy().into(), ..Default::default() };
        let (files, ids) = console_targets(&g, Some(rec.clone()), vec![], &[], &[]).unwrap();
        assert_eq!((files, ids), (vec![dir.clone()], vec![7, 8]));
        // Nunca si dentro hay otro juego de la biblioteca.
        let other = dir.join("otro").to_string_lossy().into_owned();
        assert!(console_targets(&g, Some(rec), vec![], &[], &[other]).is_err());
        // Ni si el archivo ya no está.
        let lost = Game { id: 9, platform: Some("snes".into()), rom_path: Some(d.path().join("no.sfc").to_string_lossy().into()), ..Default::default() };
        assert!(console_targets(&lost, None, vec![], &[], &[]).is_err());
    }

    #[test]
    fn protects_folders() {
        let protected = vec![r"E:\Games".to_string(), r"C:\Windows".to_string(), r"D:\Descargas\".to_string()];
        let others = vec![r"E:\Games\Pack\Juego B".to_string()];
        assert!(check_folder(r"E:\Games\Juego A", &protected, &others).is_ok());
        assert!(check_folder(r"E:\Games", &protected, &others).is_err());
        assert!(check_folder(r"E:\", &protected, &others).is_err());
        assert!(check_folder(r"C:\Windows", &protected, &others).is_err());
        assert!(check_folder(r"D:\", &protected, &others).is_err());
        assert!(check_folder(r"D:\Descargas", &protected, &others).is_err());
        assert!(check_folder(r"E:\Games\Pack", &protected, &others).is_err());
        assert!(check_folder(r"E:\Games\Pack\Juego B", &protected, &[]).is_ok());
        assert!(check_folder(r"relativa\x", &protected, &others).is_err());
    }

    #[test]
    fn finds_local_uninstallers() {
        let dir = std::env::temp_dir().join(format!("ejg-unins-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("game.exe"), b"MZ").unwrap();
        assert!(local_uninstaller(&dir).is_none());
        std::fs::write(dir.join("Uninstall.exe"), b"MZ").unwrap();
        std::fs::write(dir.join("unins000.exe"), b"MZ").unwrap();
        assert_eq!(local_uninstaller(&dir).unwrap().file_name().unwrap(), "unins000.exe");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
