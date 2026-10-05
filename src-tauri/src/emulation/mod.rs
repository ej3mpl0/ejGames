//! Juegos de consola: carpetas de ROMs por sistema, lanzadas con RetroArch (un
//! núcleo por sistema), con un emulador independiente (PCSX2, Dolphin, PPSSPP,
//! DuckStation, Cemu, RPCS3) o con el que elija el usuario.
//!
//! Una carpeta de ROMs es una carpeta de la biblioteca con modo `roms:<sistema>`.
//! Cada ROM es un juego de origen `rom`; al jugar se resuelve el emulador del
//! sistema y se lanza con la ROM como argumento. Los emuladores se configuran en
//! Ajustes → Biblioteca → Emuladores (`settings.emulators`).

pub mod custom;
pub mod install;
pub mod roms;
pub mod rominfo;
pub mod saves;

use crate::db::models::{Game, LibraryFolder, NewGame};
use crate::db::{repo, Db};
use crate::library::scanner::ScanReport;
use crate::settings::{EmulatorCfg, Settings};
use crate::util::norm_path;
use serde::Serialize;
use std::path::{Path, PathBuf};

pub struct Platform {
    pub id: &'static str,
    pub name: &'static str,
    pub exts: &'static [&'static str],
    /// Núcleo de RetroArch por defecto (sin `.dll`).
    pub core: &'static str,
    /// Id de la plataforma en IGDB (para buscar el juego en su sistema).
    pub igdb: i64,
    /// Emuladores independientes que sirven para este sistema.
    pub presets: &'static [&'static str],
    /// Nombre del sistema en libretro-thumbnails (carátulas sin clave); vacío si no tiene.
    pub libretro: &'static str,
}

pub const PLATFORMS: &[Platform] = &[
    Platform { id: "nes", name: "NES", exts: &["nes", "fds", "unf"], core: "nestopia_libretro", igdb: 18, presets: &[], libretro: "Nintendo - Nintendo Entertainment System" },
    Platform { id: "snes", name: "Super Nintendo", exts: &["sfc", "smc", "fig", "swc"], core: "snes9x_libretro", igdb: 19, presets: &[], libretro: "Nintendo - Super Nintendo Entertainment System" },
    Platform { id: "gb", name: "Game Boy", exts: &["gb"], core: "gambatte_libretro", igdb: 33, presets: &[], libretro: "Nintendo - Game Boy" },
    Platform { id: "gbc", name: "Game Boy Color", exts: &["gbc"], core: "gambatte_libretro", igdb: 22, presets: &[], libretro: "Nintendo - Game Boy Color" },
    Platform { id: "gba", name: "Game Boy Advance", exts: &["gba"], core: "mgba_libretro", igdb: 24, presets: &[], libretro: "Nintendo - Game Boy Advance" },
    Platform { id: "nds", name: "Nintendo DS", exts: &["nds"], core: "melonds_libretro", igdb: 20, presets: &[], libretro: "Nintendo - Nintendo DS" },
    Platform { id: "3ds", name: "Nintendo 3DS", exts: &["3ds", "cci", "cia", "cxi", "3dsx"], core: "", igdb: 37, presets: &["azahar"], libretro: "Nintendo - Nintendo 3DS" },
    Platform { id: "n64", name: "Nintendo 64", exts: &["z64", "n64", "v64"], core: "mupen64plus_next_libretro", igdb: 4, presets: &[], libretro: "Nintendo - Nintendo 64" },
    Platform { id: "gc", name: "GameCube", exts: &["iso", "gcm", "rvz", "ciso", "gcz"], core: "dolphin_libretro", igdb: 21, presets: &["dolphin"], libretro: "Nintendo - GameCube" },
    Platform { id: "wii", name: "Wii", exts: &["iso", "wbfs", "rvz", "wad"], core: "dolphin_libretro", igdb: 5, presets: &["dolphin"], libretro: "Nintendo - Wii" },
    Platform { id: "wiiu", name: "Wii U", exts: &["wua", "wud", "wux", "rpx"], core: "", igdb: 41, presets: &["cemu"], libretro: "Nintendo - Wii U" },
    Platform { id: "switch", name: "Nintendo Switch", exts: &["nsp", "xci", "nca", "nro"], core: "", igdb: 130, presets: &["eden", "ryujinx"], libretro: "" },
    Platform { id: "sms", name: "Master System", exts: &["sms"], core: "genesis_plus_gx_libretro", igdb: 64, presets: &[], libretro: "Sega - Master System - Mark III" },
    Platform { id: "genesis", name: "Mega Drive / Genesis", exts: &["md", "gen", "smd"], core: "genesis_plus_gx_libretro", igdb: 29, presets: &[], libretro: "Sega - Mega Drive - Genesis" },
    Platform { id: "gg", name: "Game Gear", exts: &["gg"], core: "genesis_plus_gx_libretro", igdb: 35, presets: &[], libretro: "Sega - Game Gear" },
    Platform { id: "saturn", name: "Sega Saturn", exts: &["cue", "chd"], core: "mednafen_saturn_libretro", igdb: 32, presets: &[], libretro: "Sega - Saturn" },
    Platform { id: "dreamcast", name: "Dreamcast", exts: &["gdi", "cdi", "chd"], core: "flycast_libretro", igdb: 23, presets: &[], libretro: "Sega - Dreamcast" },
    Platform { id: "pce", name: "PC Engine", exts: &["pce", "chd"], core: "mednafen_pce_libretro", igdb: 86, presets: &[], libretro: "NEC - PC Engine - TurboGrafx 16" },
    Platform { id: "psx", name: "PlayStation", exts: &["cue", "chd", "pbp", "m3u", "iso"], core: "swanstation_libretro", igdb: 7, presets: &["duckstation"], libretro: "Sony - PlayStation" },
    Platform { id: "ps2", name: "PlayStation 2", exts: &["iso", "chd", "cso", "gz"], core: "pcsx2_libretro", igdb: 8, presets: &["pcsx2"], libretro: "Sony - PlayStation 2" },
    Platform { id: "psp", name: "PSP", exts: &["iso", "cso", "pbp"], core: "ppsspp_libretro", igdb: 38, presets: &["ppsspp"], libretro: "Sony - PlayStation Portable" },
    Platform { id: "vita", name: "PS Vita", exts: &["vpk"], core: "", igdb: 46, presets: &["vita3k"], libretro: "Sony - PlayStation Vita" },
    Platform { id: "ps3", name: "PlayStation 3", exts: &["iso"], core: "", igdb: 9, presets: &["rpcs3"], libretro: "Sony - PlayStation 3" },
    Platform { id: "arcade", name: "Arcade (MAME / FBNeo)", exts: &["zip", "7z"], core: "fbneo_libretro", igdb: 52, presets: &[], libretro: "FBNeo - Arcade Games" },
    Platform { id: "wonderswan", name: "WonderSwan", exts: &["ws", "wsc"], core: "mednafen_wswan_libretro", igdb: 57, presets: &[], libretro: "Bandai - WonderSwan" },
    Platform { id: "xbox", name: "Xbox", exts: &["iso", "xiso"], core: "", igdb: 11, presets: &["xemu"], libretro: "Microsoft - Xbox" },
    Platform { id: "xbox360", name: "Xbox 360", exts: &["iso", "xex", "zar"], core: "", igdb: 12, presets: &["xenia"], libretro: "Microsoft - Xbox 360" },
];

pub fn platform(id: &str) -> Option<&'static Platform> {
    PLATFORMS.iter().find(|p| p.id == id)
}

pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    /// Nombres del ejecutable, el preferido primero.
    pub exes: &'static [&'static str],
    /// `{rom}` se sustituye por la ruta de la ROM.
    pub args: &'static str,
}

pub const PRESETS: &[Preset] = &[
    Preset { id: "retroarch", name: "RetroArch", exes: &["retroarch.exe"], args: "-f -L \"{core}\" \"{rom}\"" },
    Preset { id: "pcsx2", name: "PCSX2", exes: &["pcsx2-qt.exe", "pcsx2.exe"], args: "-batch -fullscreen -- \"{rom}\"" },
    Preset { id: "dolphin", name: "Dolphin", exes: &["Dolphin.exe"], args: "-b -e \"{rom}\"" },
    Preset { id: "ppsspp", name: "PPSSPP", exes: &["PPSSPPWindows64.exe", "PPSSPPWindows.exe"], args: "\"{rom}\"" },
    Preset { id: "duckstation", name: "DuckStation", exes: &["duckstation-qt-x64-ReleaseLTCG.exe", "duckstation-nogui-x64-ReleaseLTCG.exe"], args: "-batch -fullscreen -- \"{rom}\"" },
    Preset { id: "cemu", name: "Cemu", exes: &["Cemu.exe"], args: "-g \"{rom}\" -f" },
    Preset { id: "rpcs3", name: "RPCS3", exes: &["rpcs3.exe"], args: "--no-gui \"{rom}\"" },
    Preset { id: "eden", name: "Eden", exes: &["eden.exe"], args: "-f -g \"{rom}\"" },
    Preset { id: "ryujinx", name: "Ryujinx", exes: &["Ryujinx.exe"], args: "\"{rom}\"" },
    Preset { id: "vita3k", name: "Vita3K", exes: &["Vita3K.exe"], args: "-F \"{rom}\"" },
    Preset { id: "azahar", name: "Azahar", exes: &["azahar.exe", "azahar-qt.exe"], args: "-f \"{rom}\"" },
    Preset { id: "xemu", name: "xemu", exes: &["xemu.exe"], args: "-full-screen -dvd_path \"{rom}\"" },
    Preset { id: "xenia", name: "Xenia", exes: &["xenia_canary.exe", "xenia.exe"], args: "--fullscreen \"{rom}\"" },
];

pub fn preset(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| p.id == id)
}

// ───────────────────────── detección ─────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub preset: String,
    pub name: String,
    pub exe: String,
    /// Núcleos de RetroArch instalados (sin `.dll`).
    pub cores: Vec<String>,
}

fn candidate_dirs(name: &str) -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let mut roots: Vec<PathBuf> = vec![];
    for k in ["ProgramFiles", "ProgramFiles(x86)"] {
        roots.extend(env(k));
    }
    if let Some(l) = dirs::data_local_dir() {
        roots.push(l.join("Programs"));
        roots.push(l);
    }
    if let Some(a) = dirs::config_dir() {
        roots.push(a);
    }
    if let Some(h) = dirs::home_dir() {
        roots.push(h.join("Emulators"));
        roots.push(h.join("Games").join("Emulators"));
    }
    for drive in ['C', 'D', 'E', 'F'] {
        roots.push(PathBuf::from(format!("{drive}:\\Emulators")));
        roots.push(PathBuf::from(format!("{drive}:\\")));
    }
    let mut out = vec![];
    for r in roots {
        out.push(r.join(name));
        // Carpetas con versión o arquitectura: «RetroArch-Win64», «Dolphin-x64»…
        if let Ok(rd) = std::fs::read_dir(&r) {
            for e in rd.filter_map(Result::ok).take(400) {
                let n = e.file_name().to_string_lossy().to_lowercase();
                if n.starts_with(&name.to_lowercase()) && e.path().is_dir() {
                    out.push(e.path());
                }
            }
        }
    }
    out
}

/// Busca en los sitios habituales los emuladores que ejGames conoce.
pub fn detect() -> Vec<Found> {
    let mut out = vec![];
    for p in PRESETS {
        let mut hit: Option<PathBuf> = None;
        'search: for dir in candidate_dirs(p.name) {
            for sub in [dir.clone(), dir.join("bin"), dir.join("x64")] {
                for exe in p.exes {
                    let f = sub.join(exe);
                    if f.is_file() {
                        hit = Some(f);
                        break 'search;
                    }
                }
            }
        }
        if let Some(f) = hit {
            let cores = if p.id == "retroarch" { installed_cores(&f) } else { vec![] };
            out.push(Found { preset: p.id.into(), name: p.name.into(), exe: f.to_string_lossy().into_owned(), cores });
        }
    }
    out
}

/// Núcleos (`*_libretro.dll`) junto a RetroArch.
pub fn installed_cores(retroarch_exe: &Path) -> Vec<String> {
    let Some(dir) = retroarch_exe.parent().map(|d| d.join("cores")) else { return vec![] };
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|e| e.file_name().to_string_lossy().strip_suffix(".dll").map(str::to_string))
        .filter(|n| n.ends_with("_libretro"))
        .collect();
    v.sort();
    v
}

// ───────────────────────── escaneo de ROMs ─────────────────────────

fn has_ext(p: &Path, exts: &[&str]) -> bool {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).is_some_and(|e| exts.contains(&e.as_str()))
}

/// ROMs de una carpeta (hasta 4 niveles). De un `.cue` y su `.bin`, solo el `.cue`;
/// de varios discos de un `.m3u`, solo el `.m3u`.
pub fn find_roms(root: &Path, pf: &Platform) -> Vec<PathBuf> {
    let extra = custom::extra_exts(pf.id);
    let extra: Vec<&str> = extra.iter().map(String::as_str).collect();
    let mut all: Vec<PathBuf> = walkdir::WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        // Las partidas que ejGames deja junto a las ROMs descargadas no son juegos.
        .filter_entry(|e| e.depth() == 0 || !(e.file_name().to_string_lossy().starts_with('.') || (e.file_type().is_dir() && e.file_name().eq_ignore_ascii_case("saves"))))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && (has_ext(e.path(), pf.exts) || has_ext(e.path(), &extra)))
        .map(|e| e.into_path())
        .collect();
    if pf.exts.contains(&"m3u") {
        let listed: std::collections::HashSet<String> = all
            .iter()
            .filter(|p| has_ext(p, &["m3u"]))
            .filter_map(|m3u| std::fs::read_to_string(m3u).ok().map(|t| (m3u.parent().map(Path::to_path_buf), t)))
            .flat_map(|(dir, t)| {
                t.lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty() && !l.starts_with('#'))
                    .filter_map(|l| dir.as_ref().map(|d| norm_path(&d.join(l))))
                    .collect::<Vec<_>>()
            })
            .collect();
        all.retain(|p| !listed.contains(&norm_path(p)));
    }
    all.sort();
    all
}

/// Sistemas a los que puede pertenecer un archivo (por su extensión). Si varios lo admiten
/// (un .iso), primero los que ya tienen emulador puesto; si solo uno lo tiene, solo ese.
pub fn platforms_for(path: &Path, settings: &Settings) -> Vec<&'static Platform> {
    let all: Vec<&Platform> = PLATFORMS.iter().filter(|p| has_ext(path, p.exts)).collect();
    let ready: Vec<&Platform> = all
        .iter()
        .copied()
        .filter(|p| settings.emulators.iter().any(|e| e.platform == p.id && Path::new(&e.exe).is_file()))
        .collect();
    if ready.len() == 1 {
        return ready;
    }
    let mut out = ready.clone();
    out.extend(all.into_iter().filter(|p| !ready.iter().any(|r| r.id == p.id)));
    out
}

/// Título de una ROM: el que trae dentro el homebrew y los paquetes de Vita (sus
/// archivos suelen llamarse «eboot.vpk» o «app.nro»); si no, el del archivo.
pub fn title_of(rom: &Path, info: &rominfo::RomInfo) -> String {
    let ext = rom.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if matches!(ext.as_str(), "vpk" | "nro" | "3dsx") {
        if let Some(t) = info.title.as_deref().filter(|t| !t.trim().is_empty()) {
            return t.trim().to_string();
        }
    }
    let stem = rom.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    crate::library::names::clean_title(&stem)
}

fn meta_json(info: &rominfo::RomInfo) -> Option<String> {
    (!info.is_empty()).then(|| serde_json::to_string(info).ok()).flatten()
}

/// Un juego de consola suelto (un archivo), para añadirlo a mano.
pub fn rom_game(rom: &Path, pf: &Platform) -> NewGame {
    let info = rominfo::read(rom, pf.id);
    NewGame {
        title: title_of(rom, &info),
        source: "rom".into(),
        source_id: norm_path(rom),
        install_dir: rom.parent().map(|p| p.to_string_lossy().into_owned()),
        platform: Some(pf.id.into()),
        rom_path: Some(rom.to_string_lossy().into_owned()),
        rom_meta: meta_json(&info),
        ..Default::default()
    }
}

/// Guarda una actualización o un DLC enganchado a su juego base (por TitleID).
pub fn save_extra(c: &rusqlite::Connection, platform: &str, rom: &Path, info: &rominfo::RomInfo) -> rusqlite::Result<()> {
    let (Some(base), Some(tid), Some(kind)) = (&info.base_title_id, &info.title_id, &info.kind) else { return Ok(()) };
    c.execute(
        "INSERT INTO rom_extras (platform, base_title_id, title_id, kind, version, path, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%s','now'))
         ON CONFLICT(path) DO UPDATE SET base_title_id = excluded.base_title_id, title_id = excluded.title_id,
           kind = excluded.kind, version = excluded.version",
        rusqlite::params![platform, base, tid, kind, info.version, rom.to_string_lossy()],
    )?;
    Ok(())
}

/// Actualizaciones y DLC de todos los juegos (plataforma, TitleID base) → lista.
pub fn extras_by_base(c: &rusqlite::Connection) -> rusqlite::Result<std::collections::HashMap<(String, String), Vec<serde_json::Value>>> {
    let mut q = c.prepare("SELECT platform, base_title_id, title_id, kind, version, path FROM rom_extras ORDER BY kind, title_id, version")?;
    let rows = q.query_map([], |r| {
        Ok((
            (r.get::<_, String>(0)?, r.get::<_, String>(1)?),
            serde_json::json!({ "titleId": r.get::<_, String>(2)?, "kind": r.get::<_, String>(3)?, "version": r.get::<_, Option<String>>(4)?, "path": r.get::<_, String>(5)? }),
        ))
    })?;
    let mut out: std::collections::HashMap<(String, String), Vec<serde_json::Value>> = Default::default();
    for r in rows {
        let (k, v) = r?;
        // Solo los que siguen en su sitio.
        if v["path"].as_str().is_some_and(|p| Path::new(p).is_file()) {
            out.entry(k).or_default().push(v);
        }
    }
    Ok(out)
}

pub fn scan_roms(db: &Db, folder: &LibraryFolder, platform_id: &str) -> anyhow::Result<ScanReport> {
    let pf = platform(platform_id).ok_or_else(|| anyhow::anyhow!("Sistema desconocido: {platform_id}"))?;
    let root = PathBuf::from(&folder.path);
    if !root.is_dir() {
        anyhow::bail!("La carpeta no existe: {}", folder.path);
    }
    let roms = find_roms(&root, pf);
    // Lo ya leído no se vuelve a abrir: solo las ROMs nuevas (o de antes de 1.3.0).
    let (read_before, extras_before): (std::collections::HashSet<String>, std::collections::HashSet<String>) = db.with(|c| {
        let mut q = c.prepare("SELECT source_id FROM games WHERE source = 'rom' AND folder_id = ?1 AND rom_meta IS NOT NULL")?;
        let a = q.query_map([folder.id], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<_>>()?;
        let mut q = c.prepare("SELECT path FROM rom_extras WHERE platform = ?1")?;
        let b = q.query_map([pf.id], |r| r.get::<_, String>(0))?.map(|p| p.map(|p| norm_path(Path::new(&p)))).collect::<rusqlite::Result<_>>()?;
        Ok((a, b))
    })?;
    let infos: Vec<Option<rominfo::RomInfo>> = roms
        .iter()
        .map(|rom| {
            let key = norm_path(rom);
            (!read_before.contains(&key) && !extras_before.contains(&key)).then(|| rominfo::read(rom, pf.id))
        })
        .collect();
    let mut report = ScanReport::default();
    let mut present = vec![];
    db.with_mut(|c| {
        let tx = c.transaction()?;
        for (rom, info) in roms.iter().zip(infos) {
            if extras_before.contains(&norm_path(rom)) {
                continue;
            }
            if let Some(i) = info.as_ref().filter(|i| i.is_extra()) {
                save_extra(&tx, pf.id, rom, i)?;
                continue;
            }
            let ng = NewGame {
                title: match &info {
                    Some(i) => title_of(rom, i),
                    None => crate::library::names::clean_title(&rom.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()),
                },
                source: "rom".into(),
                source_id: norm_path(rom),
                folder_id: Some(folder.id),
                install_dir: rom.parent().map(|p| p.to_string_lossy().into_owned()),
                platform: Some(pf.id.into()),
                rom_path: Some(rom.to_string_lossy().into_owned()),
                rom_meta: info.as_ref().and_then(meta_json),
                ..Default::default()
            };
            if let Some((id, is_new)) = repo::upsert_game(&tx, &ng)? {
                present.push(id);
                if is_new {
                    report.new_games.push((id, None));
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

// ───────────────────────── lanzar ─────────────────────────

fn quote_free(s: &str) -> String {
    s.replace('"', "")
}

/// Argumentos finales: `{rom}` (o `{romPath}`), `{romDir}`, `{romName}` y `{core}` sustituidos.
pub fn expand_args(template: &str, rom: &str, core: &str) -> String {
    let p = Path::new(rom);
    let dir = p.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    let name = p.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    template
        .replace("{romPath}", &quote_free(rom))
        .replace("{rom}", &quote_free(rom))
        .replace("{romDir}", &quote_free(&dir))
        .replace("{romName}", &quote_free(&name))
        .replace("{core}", &quote_free(core))
        .replace("{fullscreen}", "")
}

/// Nombre del emulador de una configuración.
pub fn cfg_name(cfg: &EmulatorCfg) -> String {
    match cfg.kind.as_str() {
        "retroarch" => "RetroArch".into(),
        "preset" => preset(&cfg.preset).map(|p| p.name.to_string()).unwrap_or_else(|| cfg.preset.clone()),
        _ if cfg.preset.starts_with("json:") => custom::name_of(&cfg.preset).unwrap_or_else(|| cfg.preset[5..].to_string()),
        _ => Path::new(&cfg.exe).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
    }
}

/// El emulador con que se abre un sistema: el elegido en Ajustes si sigue ahí; si no,
/// el preferido de `emulators.json`, uno de los suyos instalado desde Tienda → Homebrew
/// (Switch: Eden o Ryujinx, el que haya), para los sistemas con núcleo RetroArch, y los
/// de `emulators.json` que se encuentren. Con `deep`, además se buscan en los sitios
/// habituales del disco (más lento: solo al jugar).
pub fn resolve(settings: &Settings, emu_dir: Option<&Path>, platform_id: &str, deep: bool) -> Option<EmulatorCfg> {
    let pf = platform(platform_id)?;
    if let Some(c) = settings.emulators.iter().find(|e| e.platform == pf.id && Path::new(&e.exe).is_file()) {
        return Some(c.clone());
    }
    let mk = |kind: &str, preset: &str, exe: String| EmulatorCfg { platform: pf.id.into(), kind: kind.into(), preset: preset.into(), exe, core: String::new(), args: String::new() };
    // El preferido del archivo: uno suyo o uno de los que ejGames conoce.
    if let Some(pref) = custom::preferred(pf.id) {
        if let Some(d) = custom::def(&pref) {
            if let Some(exe) = custom::locate(&d.id, emu_dir, deep) {
                return Some(custom::cfg(&d, pf.id, &exe, true));
            }
        } else if let Some(i) = emu_dir.and_then(|dir| install::installed(dir, &pref)) {
            return Some(mk(if pref == "retroarch" { "retroarch" } else { "preset" }, &pref, i.exe));
        }
    }
    if let Some(dir) = emu_dir {
        for p in pf.presets {
            if let Some(i) = install::installed(dir, p) {
                return Some(mk("preset", p, i.exe));
            }
        }
        if !pf.core.is_empty() {
            if let Some(i) = install::installed(dir, "retroarch") {
                return Some(mk("retroarch", "retroarch", i.exe));
            }
        }
    }
    if let Some(c) = custom::available(pf.id, emu_dir, deep).into_iter().next() {
        return Some(c);
    }
    if deep {
        let found = detect();
        for p in pf.presets {
            if let Some(f) = found.iter().find(|f| f.preset == *p) {
                return Some(mk("preset", p, f.exe.clone()));
            }
        }
        if !pf.core.is_empty() {
            if let Some(f) = found.iter().find(|f| f.preset == "retroarch" && f.cores.iter().any(|c| c == pf.core)) {
                return Some(mk("retroarch", "retroarch", f.exe.clone()));
            }
        }
    }
    None
}

/// Vita3K: el TitleID ya instalado en su ux0 (entonces se arranca con `-r`, sin reinstalar).
fn vita3k_installed(exe: &Path, title_id: &str) -> bool {
    if title_id.len() != 9 || !title_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    let mut roots: Vec<PathBuf> = exe.parent().map(|d| vec![d.to_path_buf()]).unwrap_or_default();
    // Su config.yml puede llevar la carpeta de datos a otro sitio («pref-path»).
    if let Some(cfg) = exe.parent().and_then(|d| std::fs::read_to_string(d.join("config.yml")).ok()) {
        if let Some(p) = cfg.lines().find_map(|l| l.trim().strip_prefix("pref-path:").map(|v| v.trim().trim_matches(['\'', '"']).to_string())).filter(|p| !p.is_empty()) {
            roots.push(PathBuf::from(p));
        }
    }
    if let Some(a) = dirs::config_dir() {
        roots.push(a.join("Vita3K").join("Vita3K"));
    }
    roots.iter().any(|r| r.join("ux0").join("app").join(title_id).join("eboot.bin").is_file())
}

/// El juego tal como hay que lanzarlo: con el emulador de su sistema y la ROM
/// como argumento (el original no se toca).
#[cfg(test)]
pub fn prepare(settings: &Settings, g: &Game) -> anyhow::Result<Game> {
    prepare_in(settings, None, false, g)
}

/// Como `prepare`, buscando también entre los emuladores instalados desde ejGames
/// (`emu_dir`) y, con `deep`, en el disco si el del sistema no está puesto.
pub fn prepare_in(settings: &Settings, emu_dir: Option<&Path>, deep: bool, g: &Game) -> anyhow::Result<Game> {
    let Some(pid) = g.platform.as_deref() else { return Ok(g.clone()) };
    let pf = platform(pid).ok_or_else(|| anyhow::anyhow!("Sistema desconocido: {pid}"))?;
    let rom = g.rom_path.clone().ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("El juego no tiene archivo de ROM")))?;
    if !Path::new(&rom).is_file() {
        anyhow::bail!("{} {rom}", crate::i18n::t("No existe la ROM:"));
    }
    let configured = settings.emulators.iter().find(|e| e.platform == pid);
    let cfg = match resolve(settings, emu_dir, pid, deep) {
        Some(c) => c,
        None => match configured {
            Some(c) => anyhow::bail!("{} {}", crate::i18n::t("No existe el emulador:"), c.exe),
            None => anyhow::bail!("{} {}", crate::i18n::t("No hay emulador para este sistema. Instálalo en Tienda → Homebrew o elígelo en Ajustes → Biblioteca → Emuladores:"), pf.name),
        },
    };
    let rom_ext = Path::new(&rom).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if pid == "3ds" && rom_ext == "cia" {
        anyhow::bail!("{}", crate::i18n::t("Los .cia se instalan en el emulador (Azahar → Archivo → Instalar CIA) y se juegan desde su lista. Para jugar desde ejGames, usa el .3ds o el .cci."));
    }
    let exe_dir = Path::new(&cfg.exe).parent().map(|p| p.to_string_lossy().into_owned());
    let (mut template, core_path) = match cfg.kind.as_str() {
        "retroarch" => {
            let core = if cfg.core.is_empty() { pf.core } else { cfg.core.as_str() };
            let dll = Path::new(&cfg.exe).parent().map(|d| d.join("cores").join(format!("{core}.dll"))).unwrap_or_default();
            if core.is_empty() || !dll.is_file() {
                anyhow::bail!("{} {core}", crate::i18n::t("Falta el núcleo de RetroArch (instálalo en RetroArch → Cargar núcleo → Descargar un núcleo):"));
            }
            (PRESETS[0].args.to_string(), dll.to_string_lossy().into_owned())
        }
        "preset" => (
            preset(&cfg.preset).map(|p| p.args.to_string()).filter(|_| cfg.args.trim().is_empty()).unwrap_or_else(|| cfg.args.clone()),
            String::new(),
        ),
        _ => {
            // Un emulador de `emulators.json` con núcleo de RetroArch: la DLL va en `{core}`.
            let core = if cfg.core.trim().is_empty() {
                String::new()
            } else {
                let dll = Path::new(&cfg.exe).parent().map(|d| d.join("cores").join(format!("{}.dll", cfg.core.trim_end_matches(".dll")))).unwrap_or_default();
                if !dll.is_file() {
                    anyhow::bail!("{} {}", crate::i18n::t("Falta el núcleo de RetroArch (instálalo en RetroArch → Cargar núcleo → Descargar un núcleo):"), cfg.core);
                }
                dll.to_string_lossy().into_owned()
            };
            (if cfg.args.trim().is_empty() { "\"{rom}\"".into() } else { cfg.args.clone() }, core)
        }
    };
    // Vita3K instala el .vpk la primera vez; después se arranca por su TitleID.
    if cfg.kind == "preset" && cfg.preset == "vita3k" && cfg.args.trim().is_empty() {
        let tid = g.rom_meta.as_deref().and_then(|m| serde_json::from_str::<rominfo::RomInfo>(m).ok()).and_then(|i| i.title_id);
        if let Some(t) = tid.filter(|t| vita3k_installed(Path::new(&cfg.exe), t)) {
            template = format!("-F -r {t}");
        }
    }
    let mut out = g.clone();
    out.exe_path = Some(cfg.exe.clone());
    out.args = expand_args(&template, &rom, &core_path);
    out.working_dir = exe_dir;
    out.launch_uri = None;
    out.install_dir = None;
    out.run_as_admin = false;
    out.process_hints = Path::new(&cfg.exe).file_name().map(|n| vec![n.to_string_lossy().to_lowercase()]).unwrap_or_default();
    Ok(out)
}

/// Lo que ven la biblioteca y los temas: con qué emulador se abrirá cada juego de
/// consola ("" si ninguno) y su DLC y actualizaciones junto a lo leído de la ROM.
pub fn decorate(st: &crate::state::AppState, games: &mut [crate::db::models::LibGame]) {
    if !games.iter().any(|g| g.platform.is_some()) {
        return;
    }
    let settings = st.settings.get();
    let dir = install::emu_dir(st);
    let mut names: std::collections::HashMap<String, String> = Default::default();
    let extras = st.db.with(extras_by_base).unwrap_or_default();
    for g in games.iter_mut() {
        let Some(pid) = g.platform.clone() else { continue };
        let name = names.entry(pid.clone()).or_insert_with(|| resolve(&settings, Some(&dir), &pid, false).map(|c| cfg_name(&c)).unwrap_or_default());
        g.emulator = Some(name.clone());
        let tid = g.rom.as_ref().and_then(|r| r.get("titleId")).and_then(|t| t.as_str()).map(str::to_string);
        // Las extras de juegos sin TitleID (bajadas de un catálogo) van por el id del juego.
        let list = tid.and_then(|t| extras.get(&(pid.clone(), t))).or_else(|| extras.get(&(pid.clone(), format!("game:{}", g.id))));
        if let Some(list) = list {
            let rom = g.rom.get_or_insert_with(|| serde_json::json!({}));
            rom["extras"] = serde_json::Value::Array(list.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(platform: &str, rom: &str) -> Game {
        Game { id: 1, title: "Mario".into(), source: "rom".into(), platform: Some(platform.into()), rom_path: Some(rom.into()), ..Default::default() }
    }

    #[test]
    fn a_loose_rom_knows_its_system() {
        let mut s = Settings::default();
        assert_eq!(platforms_for(Path::new("C:/j/Zelda.nsp"), &s).iter().map(|p| p.id).collect::<Vec<_>>(), ["switch"]);
        assert!(platforms_for(Path::new("C:/j/juego.txt"), &s).is_empty());
        // Un .iso vale para varios; con un solo emulador puesto, es de ese.
        assert!(platforms_for(Path::new("C:/j/God of War.iso"), &s).len() > 2);
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        s.emulators.push(EmulatorCfg { platform: "ps2".into(), kind: "preset".into(), preset: "pcsx2".into(), exe, core: String::new(), args: String::new() });
        assert_eq!(platforms_for(Path::new("C:/j/God of War.iso"), &s).iter().map(|p| p.id).collect::<Vec<_>>(), ["ps2"]);
        let g = rom_game(Path::new("C:/j/Zelda.nsp"), platform("switch").unwrap());
        assert_eq!((g.source.as_str(), g.platform.as_deref(), g.title.as_str()), ("rom", Some("switch"), "Zelda"));
    }

    #[test]
    fn a_folder_of_roms_is_detected() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("Zelda.nsp"), b"x").unwrap();
        std::fs::write(d.path().join("Mario.xci"), b"x").unwrap();
        std::fs::write(d.path().join("extra.zip"), b"x").unwrap();
        let i = crate::library::scanner::inspect(d.path());
        assert_eq!(i.suggested_mode, "roms:switch");
        assert_eq!(i.preview.len(), 2);
    }

    #[test]
    fn platforms_are_consistent() {
        let mut ids = std::collections::HashSet::new();
        for p in PLATFORMS {
            assert!(ids.insert(p.id), "id repetido {}", p.id);
            assert!(!p.exts.is_empty());
            assert!(p.presets.iter().all(|x| preset(x).is_some()), "{}", p.id);
            assert!(p.igdb > 0);
        }
        assert!(PRESETS.iter().all(|p| p.args.contains("{rom}")));
    }

    #[test]
    fn finds_roms_and_skips_bins_and_listed_discs() {
        let d = tempfile::tempdir().unwrap();
        let sub = d.path().join("rpg");
        std::fs::create_dir_all(&sub).unwrap();
        for f in ["a.cue", "a.bin", "disc1.chd", "disc2.chd", "b.chd", "nota.txt"] {
            std::fs::write(sub.join(f), b"x").unwrap();
        }
        std::fs::write(sub.join("rpg.m3u"), "disc1.chd\ndisc2.chd\n").unwrap();
        let roms = find_roms(d.path(), platform("psx").unwrap());
        let names: Vec<String> = roms.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["a.cue", "b.chd", "rpg.m3u"]);
    }

    #[test]
    fn scan_adds_one_game_per_rom_and_marks_missing() {
        let db = Db::memory().unwrap();
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("Super Mario World (USA).sfc"), b"x").unwrap();
        std::fs::write(d.path().join("Zelda.smc"), b"x").unwrap();
        let fid = db.with(|c| {
            c.execute("INSERT INTO library_folders (path, mode) VALUES (?1, 'roms:snes')", [d.path().to_string_lossy()])?;
            Ok(c.last_insert_rowid())
        }).unwrap();
        let folder = LibraryFolder { id: fid, path: d.path().to_string_lossy().into(), mode: "roms:snes".into(), enabled: true, last_scan: None, game_count: 0 };
        let r = scan_roms(&db, &folder, "snes").unwrap();
        assert_eq!((r.found, r.new_games.len(), r.missing), (2, 2, 0));
        let g = db.with(|c| repo::get_game(c, r.new_games[0].0)).unwrap();
        assert_eq!(g.source, "rom");
        assert_eq!(g.platform.as_deref(), Some("snes"));
        assert!(g.rom_path.unwrap().ends_with("sfc") || g.title.contains("Zelda"));
        std::fs::remove_file(d.path().join("Zelda.smc")).unwrap();
        let r2 = scan_roms(&db, &folder, "snes").unwrap();
        assert_eq!((r2.found, r2.new_games.len(), r2.missing), (1, 0, 1));
    }

    #[test]
    fn builds_the_command_for_each_kind() {
        let d = tempfile::tempdir().unwrap();
        let rom = d.path().join("juego.iso");
        let exe = d.path().join("Dolphin.exe");
        std::fs::write(&rom, b"x").unwrap();
        std::fs::write(&exe, b"x").unwrap();
        let mut s = Settings::default();
        // Sin emulador configurado.
        assert!(prepare(&s, &game("gc", &rom.to_string_lossy())).is_err());
        s.emulators.push(EmulatorCfg { platform: "gc".into(), kind: "preset".into(), preset: "dolphin".into(), exe: exe.to_string_lossy().into(), core: String::new(), args: String::new() });
        let g = prepare(&s, &game("gc", &rom.to_string_lossy())).unwrap();
        assert_eq!(g.exe_path.as_deref(), Some(exe.to_str().unwrap()));
        assert_eq!(g.args, format!("-b -e \"{}\"", rom.display()));
        assert_eq!(g.process_hints, vec!["dolphin.exe"]);
        // Propio, con argumentos del usuario.
        s.emulators[0] = EmulatorCfg { platform: "gc".into(), kind: "custom".into(), preset: String::new(), exe: exe.to_string_lossy().into(), core: String::new(), args: "--fullscreen \"{rom}\"".into() };
        assert_eq!(prepare(&s, &game("gc", &rom.to_string_lossy())).unwrap().args, format!("--fullscreen \"{}\"", rom.display()));
        // RetroArch: sin el núcleo falla con un mensaje claro; con él, usa -L.
        let ra = d.path().join("retroarch.exe");
        std::fs::write(&ra, b"x").unwrap();
        s.emulators[0] = EmulatorCfg { platform: "gc".into(), kind: "retroarch".into(), preset: String::new(), exe: ra.to_string_lossy().into(), core: String::new(), args: String::new() };
        assert!(prepare(&s, &game("gc", &rom.to_string_lossy())).is_err());
        std::fs::create_dir_all(d.path().join("cores")).unwrap();
        std::fs::write(d.path().join("cores").join("dolphin_libretro.dll"), b"x").unwrap();
        let g = prepare(&s, &game("gc", &rom.to_string_lossy())).unwrap();
        assert!(g.args.starts_with("-f -L \"") && g.args.contains("dolphin_libretro.dll") && g.args.ends_with(&format!("\"{}\"", rom.display())));
        assert_eq!(installed_cores(&ra), vec!["dolphin_libretro"]);
    }

    #[test]
    fn pc_games_pass_through_untouched() {
        let g = Game { id: 3, title: "PC".into(), exe_path: Some("x.exe".into()), ..Default::default() };
        let out = prepare(&Settings::default(), &g).unwrap();
        assert_eq!(out.exe_path, g.exe_path);
    }
}

#[cfg(test)]
mod collection_tests {
    use super::*;

    #[test]
    fn platform_collection_is_created_once() {
        let db = Db::memory().unwrap();
        db.with(|c| {
            c.execute("INSERT INTO profiles (id, name, color, theme_id, created_at) VALUES (1, 'Ana', '#fff', 'steam', 1)", [])?;
            repo::ensure_platform_collection(c, 1, "Super Nintendo", "snes")?;
            repo::ensure_platform_collection(c, 1, "Super Nintendo", "snes")?;
            repo::ensure_platform_collection(c, 1, "NES", "nes")?;
            let n: i64 = c.query_row("SELECT COUNT(*) FROM collections WHERE profile_id = 1", [], |r| r.get(0))?;
            assert_eq!(n, 2);
            Ok(())
        })
        .unwrap();
    }
}

#[cfg(all(test, windows))]
mod launch_tests {
    use super::*;

    /// Lanza de verdad con un «emulador» (cmd.exe) que anota la ROM que recibe.
    #[test]
    fn rom_is_passed_to_the_emulator_process() {
        let d = tempfile::tempdir().unwrap();
        let rom = d.path().join("Juego (Europe).smc");
        let out = d.path().join("recibido.txt");
        std::fs::write(&rom, b"x").unwrap();
        let mut s = Settings::default();
        s.emulators.push(EmulatorCfg {
            platform: "snes".into(),
            kind: "custom".into(),
            preset: String::new(),
            exe: r"C:\Windows\System32\cmd.exe".into(),
            core: String::new(),
            args: format!("/c echo {{rom}}> \"{}\"", out.display()),
        });
        let g = Game { id: 1, title: "Juego".into(), source: "rom".into(), platform: Some("snes".into()), rom_path: Some(rom.to_string_lossy().into()), ..Default::default() };
        let prepared = prepare(&s, &g).unwrap();
        crate::launcher::launch::launch(&prepared).unwrap();
        for _ in 0..50 {
            if out.exists() && std::fs::metadata(&out).map(|m| m.len() > 0).unwrap_or(false) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let got = std::fs::read_to_string(&out).expect("el emulador no escribió nada");
        assert_eq!(got.trim(), rom.to_string_lossy());
    }
}
