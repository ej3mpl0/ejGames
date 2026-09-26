//! Detección del ejecutable principal de un juego dentro de su carpeta.
//!
//! Un solo recorrido (profundidad ≤ 4) recoge los `.exe` y los marcadores
//! (steam_appid.txt, goggame-*.info, .egstore, motores). Cada exe recibe una
//! puntuación; el mejor es el principal y el resto quedan como alternativas.

use super::names::{clean_title, is_generic_name, normalize, similarity, split_camel};
use super::pe_info::{self, PeInfo};
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use walkdir::WalkDir;

const MAX_DEPTH: usize = 4;
const MAX_ENTRIES: usize = 25_000;

static EXE_BLACKLIST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?ix)^(
          unins\d* | uninst.* | uninstall.* | .*setup.* | install.* | .*installer.* | .*redist.* |
          vc_?redist.* | dxsetup | dxwebsetup | directx.* | dotnet.* | ndp\d.* | oalinst | physx.* |
          .*crash.?handler.* | .*crash.?report.* | .*crashpad.* | crashsender.* | .*bugsplat.* |
          ue\d?prereqsetup.* | ueprereqsetup.* | prereq.* |
          easyanticheat_(eos_)?setup | eac_?setup | beservice.* | battleye_?launcher_?setup.* |
          cefsharp\.browsersubprocess | .*browsersubprocess.* | notification_helper | qtwebengineprocess |
          python\w* | pythonw | ffmpeg | ffprobe | 7za? | 7zg | .*\.vshost | dxdiag | touchup | cleanup |
          activation.* | register.* | .*updater.* | updater | .*patcher | errorreporter | .*bugreport.* |
          steamerrorreporter.* | gameoverlayui | steamcmd | zfgamebrowser | elevate | handle64? |
          vulkaninfo.* | vkcube | nvngx.* | dotnetfx.* | windowsdesktop-runtime.* | vcruntime.* |
          unitycrashhandler(32|64)? | crs-.* | crashreportclient | epicwebhelper | epicgameslauncher.* |
          upc | uplaywebcore | ubisoftconnect.* | origin.* | eadesktop | eabackgroundservice | link2ea |
          galaxyclient.* | goggalaxy.* | unitycrashhandler.* | createdump | dxwebsetup | ucrt.*
        )$",
    )
    .unwrap()
});

/// Carpetas que nunca contienen el juego (redistribuibles, instaladores…).
fn excluded_dir(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "_commonredist" | "commonredist" | "redist" | "redistributables" | "redistributable"
            | "__installer" | "installer" | "installers" | "directx" | "dxsetup" | "vcredist"
            | "support" | "dotnet" | "physx" | "prereqs" | "prerequisites" | "easyanticheat"
            | "battleye" | "$pluginsdir" | "__macosx" | "_redist" | "redistrib" | "3rdparty"
            | "thirdparty" | "third_party" | "crashreporter" | "crashpad" | "logs" | "saves"
            | "screenshots" | "cache" | ".git" | "node_modules" | "mono" | "monobleedingedge"
            | "d3dcompiler" | "vc" | "msvc" | "prereq" | "tools" | "sdk" | "extras"
    )
}

/// Carpetas raíz de tiendas/sistema que nunca son un juego en sí (se importan aparte).
pub fn is_store_or_system_dir(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "steamapps" | "steamlibrary" | "steam" | "epic games" | "epicgames" | "gog galaxy"
            | "origin games" | "ea games" | "ea app" | "ubisoft" | "ubisoft game launcher"
            | "xboxgames" | "windowsapps" | "$recycle.bin" | "system volume information"
            | "msocache" | "program files" | "program files (x86)" | "windows" | "programdata"
            | "config.msi" | "recovery" | "$windows.~bt" | "$windows.~ws" | "amazon games"
    )
}

#[derive(Debug, Clone, Default)]
pub struct GogInfo {
    #[allow(dead_code)]
    pub id: String,
    pub name: Option<String>,
    pub primary_exe: Option<PathBuf>,
    pub args: Option<String>,
    pub working_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct Markers {
    pub steam_appid: Option<i64>,
    pub epic: bool,
    pub gog: Option<GogInfo>,
    pub engine: Option<&'static str>,
}

#[derive(Debug, Clone)]
pub struct ExeCandidate {
    pub path: PathBuf,
    #[allow(dead_code)]
    pub depth: usize,
    pub score: f32,
    pub info: Option<PeInfo>,
}

#[derive(Debug, Clone)]
pub struct DirAnalysis {
    pub dir: PathBuf,
    pub title: String,
    pub exes: Vec<ExeCandidate>,
    pub markers: Markers,
    pub process_hints: Vec<String>,
    pub working_dir: Option<PathBuf>,
    pub args: Option<String>,
}

impl DirAnalysis {
    pub fn best(&self) -> Option<&ExeCandidate> {
        self.exes.first()
    }
}

struct Walk {
    exes: Vec<(PathBuf, usize, u64)>,
    dirs_lower: Vec<String>,
    markers: Markers,
}

fn walk(dir: &Path) -> Walk {
    let mut w = Walk {
        exes: vec![],
        dirs_lower: vec![],
        markers: Markers::default(),
    };
    let it = WalkDir::new(dir)
        .max_depth(MAX_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0 || !e.file_type().is_dir() || !excluded_dir(&e.file_name().to_string_lossy())
        });
    for (n, entry) in it.filter_map(Result::ok).enumerate() {
        if n > MAX_ENTRIES {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_ascii_lowercase();
        let depth = entry.depth();
        if entry.file_type().is_dir() {
            if depth > 0 {
                w.dirs_lower.push(
                    entry
                        .path()
                        .strip_prefix(dir)
                        .unwrap_or(entry.path())
                        .to_string_lossy()
                        .to_ascii_lowercase(),
                );
            }
            if depth == 1 && lower == ".egstore" {
                w.markers.epic = true;
            }
            if lower.ends_with("_data") && entry.path().join("Managed").is_dir()
                || lower.ends_with("_data") && entry.path().join("il2cpp_data").is_dir()
            {
                w.markers.engine.get_or_insert("unity");
            }
            if lower == "renpy" && depth <= 2 {
                w.markers.engine.get_or_insert("renpy");
            }
            continue;
        }
        if lower.ends_with(".exe") {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            w.exes.push((entry.path().to_path_buf(), depth - 1, size));
        } else if lower == "steam_appid.txt" && depth <= 4 && w.markers.steam_appid.is_none() {
            if let Ok(s) = std::fs::read_to_string(entry.path()) {
                w.markers.steam_appid = s.trim().parse().ok().filter(|v: &i64| *v > 0);
            }
        } else if depth == 1 && lower.starts_with("goggame-") && lower.ends_with(".info") {
            w.markers.gog = parse_gog_info(entry.path(), dir);
        } else if lower.ends_with(".pck") && depth <= 2 {
            w.markers.engine.get_or_insert("godot");
        } else if lower == "data.win" && depth <= 2 {
            w.markers.engine.get_or_insert("gamemaker");
        } else if (lower == "rpg_core.js" || lower == "rmmz_core.js" || lower.ends_with(".rgss3a") || lower.ends_with(".rgssad"))
            && depth <= 3
        {
            w.markers.engine.get_or_insert("rpgmaker");
        }
    }
    if w.markers.engine.is_none() && w.exes.iter().any(|(p, ..)| {
        p.file_name()
            .map(|f| f.to_string_lossy().to_ascii_lowercase().contains("-shipping"))
            .unwrap_or(false)
    }) {
        w.markers.engine = Some("unreal");
    }
    w
}

pub fn parse_gog_info(path: &Path, root: &Path) -> Option<GogInfo> {
    let txt = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(txt.trim_start_matches('\u{feff}')).ok()?;
    let id = v.get("gameId").and_then(|x| x.as_str()).unwrap_or_default().to_string();
    let name = v.get("name").and_then(|x| x.as_str()).map(str::to_string);
    let mut info = GogInfo { id, name, ..Default::default() };
    if let Some(tasks) = v.get("playTasks").and_then(|t| t.as_array()) {
        let primary = tasks
            .iter()
            .find(|t| t.get("isPrimary").and_then(|b| b.as_bool()) == Some(true))
            .or_else(|| tasks.iter().find(|t| t.get("category").and_then(|c| c.as_str()) == Some("game")));
        if let Some(t) = primary {
            if t.get("type").and_then(|x| x.as_str()) == Some("FileTask") {
                if let Some(p) = t.get("path").and_then(|x| x.as_str()) {
                    info.primary_exe = Some(root.join(p));
                }
                info.args = t.get("arguments").and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty());
                info.working_dir = t
                    .get("workingDir")
                    .and_then(|x| x.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|w| root.join(w));
            }
        }
    }
    Some(info)
}

fn stem_of(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

fn penalty_words(stem_lower: &str) -> f32 {
    const HEAVY: &[&str] = &[
        "config", "settings", "setup", "editor", "server", "dedicated", "benchmark", "tool", "sdk",
        "modkit", "mod_tools", "modtools", "devkit", "uploader", "helper", "reporter", "console",
        "cli", "debug", "test", "diagnostic", "repair", "verify", "workshop", "compiler", "converter",
        "unpack", "packer", "worldeditor", "crash", "report", "splash",
    ];
    let mut p = 0.0;
    for w in HEAVY {
        if stem_lower.contains(w) {
            p -= 25.0;
            break;
        }
    }
    if stem_lower.contains("launcher") {
        p -= 6.0;
    }
    p
}

/// Analiza la carpeta de un juego. `None` si no hay ningún exe jugable.
pub fn analyze(dir: &Path) -> Option<DirAnalysis> {
    let folder_name = dir.file_name()?.to_string_lossy().to_string();
    let folder_title = clean_title(&folder_name);
    let folder_norm = normalize(&folder_title);
    let w = walk(dir);

    let exes: Vec<&(PathBuf, usize, u64)> = w
        .exes
        .iter()
        .filter(|(p, ..)| !EXE_BLACKLIST.is_match(&stem_of(p)))
        .filter(|(p, ..)| {
            // Nada bajo carpetas "Engine/…" de Unreal, salvo que sea lo único.
            let rel = p.strip_prefix(dir).unwrap_or(p).to_string_lossy().to_ascii_lowercase();
            !rel.starts_with("engine\\")
        })
        .collect();
    if exes.is_empty() {
        return None;
    }

    let stems_lower: Vec<String> = exes.iter().map(|(p, ..)| stem_of(p).to_ascii_lowercase()).collect();
    let gog_primary = w.markers.gog.as_ref().and_then(|g| g.primary_exe.clone());
    let mut hints: Vec<String> = vec![];

    let mut cands: Vec<ExeCandidate> = exes
        .iter()
        .enumerate()
        .map(|(i, (path, depth, size))| {
            let stem = stem_of(path);
            let lower = &stems_lower[i];
            let parent = path.parent().unwrap_or(dir);
            let info = pe_info::read(path);
            let mut score = 0.0f32;

            // Parecido con el nombre de la carpeta.
            let stem_sim = similarity(&split_camel(&stem), &folder_title) as f32;
            score += stem_sim * 40.0;

            match &info {
                Some(i) => {
                    score += if i.gui { 10.0 } else { -15.0 };
                    if i.x64 {
                        score += 5.0;
                    }
                    if i.has_icon {
                        score += 6.0;
                    }
                    if let Some(pn) = i.product_name.as_deref().filter(|n| !is_generic_name(n)) {
                        score += similarity(pn, &folder_title) as f32 * 25.0;
                    }
                    let desc = i.file_description.as_deref().unwrap_or("").to_ascii_lowercase();
                    if ["setup", "install", "crash", "report", "update", "redistributable", "uninstall"]
                        .iter()
                        .any(|k| desc.contains(k))
                    {
                        score -= 25.0;
                    }
                }
                None => score -= 40.0,
            }

            // Tamaño (los juegos suelen ser el exe gordo), con techo.
            let mb = *size as f32 / 1_048_576.0;
            score += (1.0 + mb).log2().min(8.0) * 2.5;

            // Motores.
            if parent.join(format!("{stem}_Data")).is_dir() {
                score += 50.0;
            }
            if lower.ends_with("-shipping") {
                // Unreal: el Shipping es el proceso real; si hay bootstrap en la raíz, se lanza ese.
                let base = lower.split('-').next().unwrap_or("");
                let has_bootstrap = stems_lower.iter().zip(exes.iter()).any(|(s, (_, d, _))| *d == 0 && s == base);
                score += if has_bootstrap { -5.0 } else { 20.0 };
            }
            // Bootstrap de Unreal en la raíz: existe <Proyecto>\Binaries\Win64\<stem>*.exe.
            if *depth == 0
                && exes.iter().any(|(p, d, _)| {
                    *d >= 2
                        && p.to_string_lossy().to_ascii_lowercase().contains("\\binaries\\win64\\")
                        && stem_of(p).to_ascii_lowercase().starts_with(lower.as_str())
                })
            {
                score += 35.0;
            }
            if parent.join(format!("{stem}.pck")).exists() {
                score += 40.0;
            }
            if parent.join("data.win").exists() {
                score += 30.0;
            }
            if lower == "game" && (parent.join("www").is_dir() || parent.join("js").join("rmmz_core.js").exists()) {
                score += 30.0;
            }
            if parent.join("renpy").is_dir() && parent.join(format!("{stem}.py")).exists() {
                score += 30.0;
            }
            if lower.ends_with("-32") || lower.ends_with("_x86") || lower.ends_with("32") && !lower.ends_with("win32") {
                score -= 8.0;
            }
            let rel_lower = path.strip_prefix(dir).unwrap_or(path).to_string_lossy().to_ascii_lowercase();
            if rel_lower.contains("\\x86\\") || rel_lower.contains("\\win32\\") || rel_lower.contains("\\bin32\\") {
                score -= 10.0;
            }
            // Anticheats: el lanzador protegido es el objetivo correcto.
            if lower == "start_protected_game" {
                score += 35.0;
            }
            if lower.ends_with("_be") {
                score += 30.0;
            }

            score += penalty_words(lower);
            score -= *depth as f32 * 8.0;

            if let Some(gp) = &gog_primary {
                if crate::util::norm_path(gp) == crate::util::norm_path(path) {
                    score += 100.0;
                }
            }

            ExeCandidate {
                path: path.clone(),
                depth: *depth,
                score,
                info,
            }
        })
        .collect();

    cands.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Pistas para el tracker: el proceso real puede no ser el que lanzamos.
    if let Some(best) = cands.first() {
        let best_lower = stem_of(&best.path).to_ascii_lowercase();
        for c in &cands {
            let s = stem_of(&c.path).to_ascii_lowercase();
            if s.ends_with("-shipping") && s.starts_with(best_lower.trim_end_matches("_be")) && s != best_lower {
                hints.push(format!("{s}.exe"));
            }
        }
        if best_lower == "start_protected_game" || best_lower.ends_with("_be") {
            for c in cands.iter().skip(1).take(3) {
                if c.info.as_ref().map(|i| i.gui).unwrap_or(false) {
                    hints.push(format!("{}.exe", stem_of(&c.path).to_ascii_lowercase()));
                }
            }
        }
    }

    // Título: GOG > carpeta limpia (si no es genérica) > ProductName > stem.
    let best_info = cands.first().and_then(|c| c.info.clone());
    let product = best_info
        .as_ref()
        .and_then(|i| i.product_name.clone())
        .filter(|n| !is_generic_name(n));
    let best_stem = cands.first().map(|c| split_camel(&stem_of(&c.path))).unwrap_or_default();
    let generic_folder = folder_norm.is_empty()
        || is_generic_name(&folder_title)
        || matches!(folder_norm.as_str(), "bin" | "x64" | "win64" | "binaries" | "game" | "games");
    let title = w
        .markers
        .gog
        .as_ref()
        .and_then(|g| g.name.clone())
        .or_else(|| (!generic_folder).then(|| folder_title.clone()))
        .or_else(|| product.clone())
        .unwrap_or_else(|| clean_title(&best_stem));

    let gog = w.markers.gog.clone();
    Some(DirAnalysis {
        dir: dir.to_path_buf(),
        title,
        exes: cands,
        process_hints: hints,
        working_dir: gog.as_ref().and_then(|g| g.working_dir.clone()),
        args: gog.and_then(|g| g.args),
        markers: w.markers,
    })
}

/// ¿Parece la carpeta de un único juego? (exe jugable en la raíz o marcadores).
pub fn looks_like_game_dir(dir: &Path) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else { return false };
    for e in rd.filter_map(Result::ok) {
        let name = e.file_name().to_string_lossy().to_ascii_lowercase();
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir && name.ends_with(".exe") && !EXE_BLACKLIST.is_match(name.trim_end_matches(".exe")) {
            return true;
        }
        if name == "steam_appid.txt" || (name.starts_with("goggame-") && name.ends_with(".info")) || name == ".egstore" {
            return true;
        }
        if is_dir && name.ends_with("_data") && e.path().join("Managed").is_dir() {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Crea un "exe" falso. No es PE válido, así que puntúa por nombre/estructura
    /// (la penalización por PE inválido es igual para todos).
    fn touch(p: &Path, size: usize) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![0u8; size]).unwrap();
    }

    fn best_name(a: &DirAnalysis) -> String {
        a.best().unwrap().path.file_name().unwrap().to_string_lossy().to_string()
    }

    #[test]
    fn unity_game() {
        let t = tempfile::tempdir().unwrap();
        let g = t.path().join("Hollow Knight");
        touch(&g.join("hollow_knight.exe"), 700_000);
        fs::create_dir_all(g.join("hollow_knight_Data").join("Managed")).unwrap();
        touch(&g.join("UnityCrashHandler64.exe"), 1_500_000);
        touch(&g.join("_CommonRedist").join("vcredist_x64.exe"), 9_000_000);
        let a = analyze(&g).unwrap();
        assert_eq!(best_name(&a), "hollow_knight.exe");
        assert_eq!(a.markers.engine, Some("unity"));
        assert_eq!(a.exes.len(), 1);
        assert_eq!(a.title, "Hollow Knight");
    }

    #[test]
    fn unreal_bootstrap_and_hint() {
        let t = tempfile::tempdir().unwrap();
        let g = t.path().join("Hogwarts Legacy");
        touch(&g.join("HogwartsLegacy.exe"), 300_000);
        touch(&g.join("Phoenix").join("Binaries").join("Win64").join("HogwartsLegacy.exe"), 90_000_000);
        touch(&g.join("Engine").join("Binaries").join("Win64").join("CrashReportClient.exe"), 20_000_000);
        let a = analyze(&g).unwrap();
        assert_eq!(a.best().unwrap().depth, 0, "{:?}", a.exes);

        let g2 = t.path().join("Satisfactory");
        touch(&g2.join("FactoryGame.exe"), 300_000);
        fs::create_dir_all(g2.join("FactoryGame").join("Binaries")).unwrap();
        touch(&g2.join("FactoryGame").join("Binaries").join("Win64").join("FactoryGame-Win64-Shipping.exe"), 90_000_000);
        let a2 = analyze(&g2).unwrap();
        assert_eq!(best_name(&a2), "FactoryGame.exe");
        assert!(a2.process_hints.contains(&"factorygame-win64-shipping.exe".to_string()));
        assert_eq!(a2.markers.engine, Some("unreal"));
    }

    #[test]
    fn eac_protected_launcher_wins() {
        let t = tempfile::tempdir().unwrap();
        let g = t.path().join("Elden Ring").join("Game");
        touch(&g.join("eldenring.exe"), 80_000_000);
        touch(&g.join("start_protected_game.exe"), 3_000_000);
        touch(&g.join("EasyAntiCheat").join("EasyAntiCheat_EOS_Setup.exe"), 3_000_000);
        let a = analyze(&g).unwrap();
        assert_eq!(best_name(&a), "start_protected_game.exe");
    }

    #[test]
    fn prefers_x64_and_folder_name() {
        let t = tempfile::tempdir().unwrap();
        let g = t.path().join("Terraria");
        touch(&g.join("Terraria.exe"), 10_000_000);
        touch(&g.join("TerrariaServer.exe"), 10_000_000);
        touch(&g.join("unins000.exe"), 1_000_000);
        let a = analyze(&g).unwrap();
        assert_eq!(best_name(&a), "Terraria.exe");
        assert_eq!(a.exes.len(), 2);
    }

    #[test]
    fn gog_primary_task() {
        let t = tempfile::tempdir().unwrap();
        let g = t.path().join("The Witcher 3 Wild Hunt GOTY");
        touch(&g.join("bin").join("x64").join("witcher3.exe"), 50_000_000);
        touch(&g.join("REDprelauncher.exe"), 5_000_000);
        fs::write(
            g.join("goggame-1207664663.info"),
            r#"{"gameId":"1207664663","name":"The Witcher 3: Wild Hunt - Game of the Year Edition",
               "playTasks":[{"category":"game","isPrimary":true,"path":"bin\\x64\\witcher3.exe","type":"FileTask"}]}"#,
        )
        .unwrap();
        let a = analyze(&g).unwrap();
        assert_eq!(best_name(&a), "witcher3.exe");
        assert_eq!(a.title, "The Witcher 3: Wild Hunt - Game of the Year Edition");
        assert_eq!(a.markers.gog.unwrap().id, "1207664663");
    }

    #[test]
    fn steam_appid_marker_and_no_exe() {
        let t = tempfile::tempdir().unwrap();
        let g = t.path().join("Celeste");
        touch(&g.join("Celeste.exe"), 2_000_000);
        fs::write(g.join("steam_appid.txt"), "504230\n").unwrap();
        assert_eq!(analyze(&g).unwrap().markers.steam_appid, Some(504230));

        let empty = t.path().join("Docs");
        fs::create_dir_all(&empty).unwrap();
        fs::write(empty.join("readme.txt"), "x").unwrap();
        assert!(analyze(&empty).is_none());
        assert!(looks_like_game_dir(&g));
        assert!(!looks_like_game_dir(t.path()));
    }
}
