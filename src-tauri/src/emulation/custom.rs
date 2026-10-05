//! Emuladores definidos por el usuario en `<datos>\config\emulators.json` (ejemplo
//! en `config/emulators.example.json`): cualquier programa que reciba la ROM por la
//! línea de órdenes, para uno o varios sistemas, con sus argumentos, sus
//! extensiones de ROM, su carpeta de ROMs y su emulador preferido por sistema.
//!
//! Se suman a los que ejGames ya conoce (`PRESETS`): al jugar, el orden es el
//! emulador elegido en Ajustes, el preferido de este archivo, los instalados desde
//! Tienda → Homebrew, los de este archivo que estén en el disco y, por último, los
//! conocidos que aparezcan en los sitios habituales.

use crate::settings::EmulatorCfg;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const FILE: &str = "emulators.json";
pub const EXAMPLE: &str = include_str!("../../../config/emulators.example.json");

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EmulatorDef {
    pub id: String,
    pub name: String,
    /// Sistemas, con los nombres de los catálogos («ps1», «gamecube»…) o los de ejGames («psx», «gc»…).
    pub platforms: Vec<String>,
    pub executable_name: String,
    /// Carpeta o ejecutable; vacío = buscarlo (carpeta de emuladores de ejGames y sitios habituales).
    pub install_path: Option<String>,
    /// Extensiones de ROM que acepta además de las que ejGames conoce («.nsp»).
    pub rom_extensions: Vec<String>,
    /// Dónde dejar las ROMs descargadas de sus sistemas (`{platform}` = el sistema).
    pub rom_folder: Option<String>,
    /// Argumentos: `{romPath}` (o `{rom}`), `{romDir}`, `{romName}`, `{core}`, `{fullscreen}`.
    pub launch_args: Vec<String>,
    /// Lo que se pone en `{fullscreen}`.
    pub fullscreen_args: Vec<String>,
    /// RetroArch: el núcleo (sin `.dll`), que va en `{core}`.
    pub core: Option<String>,
    /// Carátulas junto a la ROM con el mismo nombre (`.png`, `.jpg`).
    pub cover_extensions: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EmulatorsFile {
    pub emulators: Vec<EmulatorDef>,
    /// Sistema → id del emulador preferido (de este archivo o uno de ejGames: «duckstation»).
    pub preferred: HashMap<String, String>,
}

struct Loaded {
    file: EmulatorsFile,
    error: Option<String>,
    /// id → ejecutable encontrado (None: buscado y no está).
    found: HashMap<String, Option<PathBuf>>,
}

static STATE: RwLock<Option<Loaded>> = RwLock::new(None);

pub fn config_dir(root: &Path) -> PathBuf {
    root.join("config")
}

pub fn path(root: &Path) -> PathBuf {
    config_dir(root).join(FILE)
}

/// `%APPDATA%`, `%LOCALAPPDATA%`… (y `~`) en una ruta del archivo.
pub fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s.trim();
    if let Some(r) = rest.strip_prefix('~') {
        if let Some(h) = dirs::home_dir() {
            out.push_str(&h.to_string_lossy());
            rest = r;
        }
    }
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) => {
                let key = &after[..j];
                match std::env::var(key) {
                    Ok(v) if !key.is_empty() => out.push_str(&v),
                    _ => {
                        out.push('%');
                        out.push_str(key);
                        out.push('%');
                    }
                }
                rest = &after[j + 1..];
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Lee (o vuelve a leer) el archivo. Sin archivo no hay error: simplemente no hay ninguno.
pub fn load(root: &Path) {
    let p = path(root);
    let (file, error) = match std::fs::read(&p) {
        Err(_) => (EmulatorsFile::default(), None),
        Ok(b) => match serde_json::from_slice::<EmulatorsFile>(strip_bom(&b)) {
            Ok(mut f) => {
                f.emulators.retain(|e| !e.id.trim().is_empty() && !e.executable_name.trim().is_empty());
                for e in &mut f.emulators {
                    e.platforms = e.platforms.iter().filter_map(|x| crate::catalogs::platforms::internal(x).map(str::to_string)).collect();
                }
                f.preferred = f.preferred.into_iter().filter_map(|(k, v)| crate::catalogs::platforms::internal(&k).map(|k| (k.to_string(), v))).collect();
                (f, None)
            }
            Err(e) => {
                tracing::warn!("{}: {e}", p.display());
                (EmulatorsFile::default(), Some(format!("{FILE}: {e}")))
            }
        },
    };
    *STATE.write() = Some(Loaded { file, error, found: HashMap::new() });
}

pub fn strip_bom(b: &[u8]) -> &[u8] {
    b.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(b)
}

pub fn error() -> Option<String> {
    STATE.read().as_ref().and_then(|l| l.error.clone())
}

pub fn def(id: &str) -> Option<EmulatorDef> {
    STATE.read().as_ref()?.file.emulators.iter().find(|e| e.id == id).cloned()
}

pub fn for_platform(platform: &str) -> Vec<EmulatorDef> {
    STATE.read().as_ref().map(|l| l.file.emulators.iter().filter(|e| e.platforms.iter().any(|p| p == platform)).cloned().collect()).unwrap_or_default()
}

pub fn preferred(platform: &str) -> Option<String> {
    STATE.read().as_ref()?.file.preferred.get(platform).cloned()
}

/// Extensiones extra (sin punto, en minúsculas) de los emuladores de un sistema.
pub fn extra_exts(platform: &str) -> Vec<String> {
    for_platform(platform).iter().flat_map(|e| e.rom_extensions.iter().map(|x| x.trim().trim_start_matches('.').to_lowercase())).filter(|x| !x.is_empty()).collect()
}

/// Carátulas sueltas que acepta un sistema (sin punto).
pub fn cover_exts(platform: &str) -> Vec<String> {
    let mut v: Vec<String> = for_platform(platform).iter().flat_map(|e| e.cover_extensions.iter().map(|x| x.trim().trim_start_matches('.').to_lowercase())).filter(|x| !x.is_empty()).collect();
    if v.is_empty() {
        v = vec!["png".into(), "jpg".into(), "jpeg".into(), "webp".into()];
    }
    v
}

/// Carpeta de ROMs de un sistema según su emulador (el preferido, si no el primero que la diga).
pub fn rom_folder(platform: &str) -> Option<PathBuf> {
    let list = for_platform(platform);
    let pref = preferred(platform);
    let pick = list.iter().find(|e| Some(&e.id) == pref.as_ref() && e.rom_folder.is_some()).or_else(|| list.iter().find(|e| e.rom_folder.is_some()))?;
    let raw = pick.rom_folder.as_deref()?.replace("{platform}", platform);
    let p = PathBuf::from(expand_env(&raw));
    (!p.as_os_str().is_empty()).then_some(p)
}

fn search(def: &EmulatorDef, emu_dir: Option<&Path>) -> Option<PathBuf> {
    let exe = def.executable_name.trim();
    if let Some(ip) = def.install_path.as_deref().map(expand_env).filter(|s| !s.trim().is_empty()) {
        let p = PathBuf::from(ip);
        if p.is_file() {
            return Some(p);
        }
        if p.is_dir() {
            return super::install::find_exe(&p, &[exe]);
        }
        // Ruta dada y que no existe: no se adivina otra.
        return None;
    }
    if let Some(d) = emu_dir {
        if let Some(f) = super::install::find_exe(d, &[exe]) {
            return Some(f);
        }
    }
    for dir in super::candidate_dirs(&def.name) {
        for sub in [dir.clone(), dir.join("bin"), dir.join("x64")] {
            let f = sub.join(exe);
            if f.is_file() {
                return Some(f);
            }
        }
    }
    None
}

/// El ejecutable de un emulador del archivo (se busca una vez; `deep` permite buscar ahora).
pub fn locate(id: &str, emu_dir: Option<&Path>, deep: bool) -> Option<PathBuf> {
    if let Some(hit) = STATE.read().as_ref().and_then(|l| l.found.get(id).cloned()) {
        return hit.filter(|p| p.is_file());
    }
    let d = def(id)?;
    // Con ruta dada se mira siempre (es barato); sin ella, solo si se puede buscar.
    if d.install_path.as_deref().is_none_or(|s| s.trim().is_empty()) && !deep {
        return None;
    }
    let hit = search(&d, emu_dir);
    if let Some(l) = STATE.write().as_mut() {
        l.found.insert(id.to_string(), hit.clone());
    }
    hit
}

/// La configuración con que se lanza un emulador del archivo para un sistema.
pub fn cfg(def: &EmulatorDef, platform: &str, exe: &Path, fullscreen: bool) -> EmulatorCfg {
    let fs = if fullscreen { def.fullscreen_args.join(" ") } else { String::new() };
    let args: Vec<String> = def
        .launch_args
        .iter()
        .map(|a| a.replace("{fullscreen}", &fs))
        .filter(|a| !a.trim().is_empty())
        .collect();
    let args = if args.is_empty() { "\"{romPath}\"".to_string() } else { args.join(" ") };
    EmulatorCfg {
        platform: platform.into(),
        kind: "custom".into(),
        preset: format!("json:{}", def.id),
        exe: exe.to_string_lossy().into_owned(),
        core: def.core.clone().unwrap_or_default(),
        args,
    }
}

/// Emuladores del archivo para un sistema que están en el disco.
pub fn available(platform: &str, emu_dir: Option<&Path>, deep: bool) -> Vec<EmulatorCfg> {
    let pref = preferred(platform);
    let mut list = for_platform(platform);
    // El preferido primero.
    list.sort_by_key(|e| Some(&e.id) != pref.as_ref());
    list.iter().filter_map(|d| locate(&d.id, emu_dir, deep).map(|exe| cfg(d, platform, &exe, true))).collect()
}

/// Nombre de un emulador del archivo (`json:<id>`).
pub fn name_of(preset: &str) -> Option<String> {
    let id = preset.strip_prefix("json:")?;
    def(id).map(|d| if d.name.is_empty() { d.id } else { d.name })
}

/// Escribe el ejemplo si no hay archivo (para empezar a editarlo).
pub fn ensure_file(root: &Path) -> anyhow::Result<PathBuf> {
    let p = path(root);
    if !p.is_file() {
        std::fs::create_dir_all(config_dir(root))?;
        std::fs::write(&p, EXAMPLE)?;
        load(root);
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_parses_and_uses_known_systems() {
        let f: EmulatorsFile = serde_json::from_str(EXAMPLE).unwrap();
        assert!(f.emulators.len() >= 10);
        for e in &f.emulators {
            assert!(!e.executable_name.is_empty(), "{}", e.id);
            for p in &e.platforms {
                assert!(crate::catalogs::platforms::internal(p).is_some(), "{} → {p}", e.id);
            }
            assert!(e.launch_args.iter().any(|a| a.contains("{romPath}") || a.contains("{romName}")), "{}", e.id);
        }
    }

    #[test]
    fn env_and_args_expand() {
        std::env::set_var("EJG_TEST_VAR", "C:\\X");
        assert_eq!(expand_env("%EJG_TEST_VAR%\\roms\\%NO_EXISTE_EJG%"), "C:\\X\\roms\\%NO_EXISTE_EJG%");
        let d = EmulatorDef {
            id: "r".into(),
            name: "R".into(),
            launch_args: vec!["\"{romPath}\"".into(), "{fullscreen}".into()],
            fullscreen_args: vec!["--fullscreen".into()],
            ..Default::default()
        };
        let c = cfg(&d, "switch", Path::new("C:\\R\\R.exe"), true);
        assert_eq!((c.kind.as_str(), c.args.as_str(), c.preset.as_str()), ("custom", "\"{romPath}\" --fullscreen", "json:r"));
        assert_eq!(cfg(&d, "switch", Path::new("C:\\R\\R.exe"), false).args, "\"{romPath}\"");
    }
}
