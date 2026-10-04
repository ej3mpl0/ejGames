//! Juegos de consola: carpetas de ROMs por sistema, lanzadas con RetroArch (un
//! núcleo por sistema), con un emulador independiente (PCSX2, Dolphin, PPSSPP,
//! DuckStation, Cemu, RPCS3) o con el que elija el usuario.
//!
//! Una carpeta de ROMs es una carpeta de la biblioteca con modo `roms:<sistema>`.
//! Cada ROM es un juego de origen `rom`; al jugar se resuelve el emulador del
//! sistema y se lanza con la ROM como argumento. Los emuladores se configuran en
//! Ajustes → Biblioteca → Emuladores (`settings.emulators`).

pub mod install;

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
}

pub const PLATFORMS: &[Platform] = &[
    Platform { id: "nes", name: "NES", exts: &["nes", "fds", "unf"], core: "nestopia_libretro", igdb: 18, presets: &[] },
    Platform { id: "snes", name: "Super Nintendo", exts: &["sfc", "smc", "fig", "swc"], core: "snes9x_libretro", igdb: 19, presets: &[] },
    Platform { id: "gb", name: "Game Boy", exts: &["gb"], core: "gambatte_libretro", igdb: 33, presets: &[] },
    Platform { id: "gbc", name: "Game Boy Color", exts: &["gbc"], core: "gambatte_libretro", igdb: 22, presets: &[] },
    Platform { id: "gba", name: "Game Boy Advance", exts: &["gba"], core: "mgba_libretro", igdb: 24, presets: &[] },
    Platform { id: "nds", name: "Nintendo DS", exts: &["nds"], core: "melonds_libretro", igdb: 20, presets: &[] },
    Platform { id: "n64", name: "Nintendo 64", exts: &["z64", "n64", "v64"], core: "mupen64plus_next_libretro", igdb: 4, presets: &[] },
    Platform { id: "gc", name: "GameCube", exts: &["iso", "gcm", "rvz", "ciso", "gcz"], core: "dolphin_libretro", igdb: 21, presets: &["dolphin"] },
    Platform { id: "wii", name: "Wii", exts: &["iso", "wbfs", "rvz", "wad"], core: "dolphin_libretro", igdb: 5, presets: &["dolphin"] },
    Platform { id: "wiiu", name: "Wii U", exts: &["wua", "wud", "wux", "rpx"], core: "", igdb: 41, presets: &["cemu"] },
    Platform { id: "switch", name: "Nintendo Switch", exts: &["nsp", "xci"], core: "", igdb: 130, presets: &["eden", "ryujinx"] },
    Platform { id: "sms", name: "Master System", exts: &["sms"], core: "genesis_plus_gx_libretro", igdb: 64, presets: &[] },
    Platform { id: "genesis", name: "Mega Drive / Genesis", exts: &["md", "gen", "smd"], core: "genesis_plus_gx_libretro", igdb: 29, presets: &[] },
    Platform { id: "gg", name: "Game Gear", exts: &["gg"], core: "genesis_plus_gx_libretro", igdb: 35, presets: &[] },
    Platform { id: "saturn", name: "Sega Saturn", exts: &["cue", "chd"], core: "mednafen_saturn_libretro", igdb: 32, presets: &[] },
    Platform { id: "dreamcast", name: "Dreamcast", exts: &["gdi", "cdi", "chd"], core: "flycast_libretro", igdb: 23, presets: &[] },
    Platform { id: "pce", name: "PC Engine", exts: &["pce", "chd"], core: "mednafen_pce_libretro", igdb: 86, presets: &[] },
    Platform { id: "psx", name: "PlayStation", exts: &["cue", "chd", "pbp", "m3u", "iso"], core: "swanstation_libretro", igdb: 7, presets: &["duckstation"] },
    Platform { id: "ps2", name: "PlayStation 2", exts: &["iso", "chd", "cso", "gz"], core: "pcsx2_libretro", igdb: 8, presets: &["pcsx2"] },
    Platform { id: "psp", name: "PSP", exts: &["iso", "cso", "pbp"], core: "ppsspp_libretro", igdb: 38, presets: &["ppsspp"] },
    Platform { id: "ps3", name: "PlayStation 3", exts: &["iso"], core: "", igdb: 9, presets: &["rpcs3"] },
    Platform { id: "arcade", name: "Arcade (MAME / FBNeo)", exts: &["zip", "7z"], core: "fbneo_libretro", igdb: 52, presets: &[] },
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
    let mut all: Vec<PathBuf> = walkdir::WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && has_ext(e.path(), pf.exts))
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

/// Un juego de consola suelto (un archivo), para añadirlo a mano.
pub fn rom_game(rom: &Path, pf: &Platform) -> NewGame {
    let stem = rom.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    NewGame {
        title: crate::library::names::clean_title(&stem),
        source: "rom".into(),
        source_id: norm_path(rom),
        install_dir: rom.parent().map(|p| p.to_string_lossy().into_owned()),
        platform: Some(pf.id.into()),
        rom_path: Some(rom.to_string_lossy().into_owned()),
        ..Default::default()
    }
}

pub fn scan_roms(db: &Db, folder: &LibraryFolder, platform_id: &str) -> anyhow::Result<ScanReport> {
    let pf = platform(platform_id).ok_or_else(|| anyhow::anyhow!("Sistema desconocido: {platform_id}"))?;
    let root = PathBuf::from(&folder.path);
    if !root.is_dir() {
        anyhow::bail!("La carpeta no existe: {}", folder.path);
    }
    let roms = find_roms(&root, pf);
    let mut report = ScanReport::default();
    let mut present = vec![];
    db.with_mut(|c| {
        let tx = c.transaction()?;
        for rom in &roms {
            let stem = rom.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let ng = NewGame {
                title: crate::library::names::clean_title(&stem),
                source: "rom".into(),
                source_id: norm_path(rom),
                folder_id: Some(folder.id),
                install_dir: rom.parent().map(|p| p.to_string_lossy().into_owned()),
                platform: Some(pf.id.into()),
                rom_path: Some(rom.to_string_lossy().into_owned()),
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

/// Argumentos finales: `{rom}` y `{core}` sustituidos.
pub fn expand_args(template: &str, rom: &str, core: &str) -> String {
    template.replace("{rom}", &quote_free(rom)).replace("{core}", &quote_free(core))
}

/// El juego tal como hay que lanzarlo: con el emulador de su sistema y la ROM
/// como argumento (el original no se toca).
pub fn prepare(settings: &Settings, g: &Game) -> anyhow::Result<Game> {
    let Some(pid) = g.platform.as_deref() else { return Ok(g.clone()) };
    let pf = platform(pid).ok_or_else(|| anyhow::anyhow!("Sistema desconocido: {pid}"))?;
    let rom = g.rom_path.clone().ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("El juego no tiene archivo de ROM")))?;
    if !Path::new(&rom).is_file() {
        anyhow::bail!("{} {rom}", crate::i18n::t("No existe la ROM:"));
    }
    let not_set = || anyhow::anyhow!("{} {}", crate::i18n::t("No hay emulador para este sistema. Elígelo en Ajustes → Biblioteca → Emuladores:"), pf.name);
    let cfg: &EmulatorCfg = settings.emulators.iter().find(|e| e.platform == pid).ok_or_else(not_set)?;
    if !Path::new(&cfg.exe).is_file() {
        anyhow::bail!("{} {}", crate::i18n::t("No existe el emulador:"), cfg.exe);
    }
    let exe_dir = Path::new(&cfg.exe).parent().map(|p| p.to_string_lossy().into_owned());
    let (template, core_path) = match cfg.kind.as_str() {
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
        _ => (if cfg.args.trim().is_empty() { "\"{rom}\"".into() } else { cfg.args.clone() }, String::new()),
    };
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
