//! Juegos instalados de Steam: registro → libraryfolders.vdf → appmanifest_*.acf.

use super::vdf::{self, Vdf};
use crate::db::models::NewGame;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Herramientas y runtimes que no son juegos.
const SKIP_APPIDS: &[i64] = &[
    228980, 1070560, 1391110, 1628350, 1493710, 2180100, 1826330, 1887720, 2348590, 250820, 323910,
];

pub fn steam_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let from_hkcu = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Valve\\Steam")
            .and_then(|k| k.get_value::<String, _>("SteamPath"))
            .ok();
        let from_hklm = || {
            RegKey::predef(HKEY_LOCAL_MACHINE)
                .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
                .and_then(|k| k.get_value::<String, _>("InstallPath"))
                .ok()
        };
        let p = from_hkcu.or_else(from_hklm).map(|s| PathBuf::from(s.replace('/', "\\")));
        if let Some(p) = p.filter(|p| p.is_dir()) {
            return Some(p);
        }
    }
    let fallback = PathBuf::from("C:\\Program Files (x86)\\Steam");
    fallback.is_dir().then_some(fallback)
}

fn library_paths(root: &Path) -> Vec<PathBuf> {
    let mut out = vec![root.to_path_buf()];
    let file = root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(t) = std::fs::read_to_string(file) {
        let v = vdf::parse(&t);
        if let Some(lf) = v.get("libraryfolders") {
            for (_, e) in lf.entries() {
                let p = match e {
                    Vdf::Obj(_) => e.str("path").map(PathBuf::from),
                    Vdf::Str(s) => Some(PathBuf::from(s)), // formato antiguo "1" "D:\\Lib"
                };
                if let Some(p) = p {
                    if p.is_dir() && !out.iter().any(|o| crate::util::norm_path(o) == crate::util::norm_path(&p)) {
                        out.push(p);
                    }
                }
            }
        }
    }
    out
}

/// Usuario de Steam más reciente (el de `localconfig.vdf` modificado más tarde):
/// (account id, carpeta `userdata/<id>`).
pub fn active_user(root: &Path) -> Option<(u32, PathBuf)> {
    let mut best: Option<(std::time::SystemTime, u32, PathBuf)> = None;
    for e in std::fs::read_dir(root.join("userdata")).ok()?.filter_map(Result::ok) {
        let Some(id) = e.file_name().to_str().and_then(|n| n.parse::<u32>().ok()).filter(|id| *id > 0) else { continue };
        let f = e.path().join("config").join("localconfig.vdf");
        if let Ok(m) = std::fs::metadata(&f).and_then(|m| m.modified()) {
            if best.as_ref().map(|(t, ..)| m > *t).unwrap_or(true) {
                best = Some((m, id, e.path()));
            }
        }
    }
    best.map(|(_, id, p)| (id, p))
}

/// (segundos jugados, última partida) por appid del usuario de Steam más reciente.
fn playtimes(root: &Path) -> HashMap<i64, (i64, Option<i64>)> {
    let mut out = HashMap::new();
    let Some((_, user)) = active_user(root) else { return out };
    let Ok(t) = std::fs::read_to_string(user.join("config").join("localconfig.vdf")) else { return out };
    let v = vdf::parse(&t);
    let apps = v
        .path(&["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"])
        .or_else(|| v.path(&["UserLocalConfigStore", "Software", "valve", "Steam", "Apps"]));
    if let Some(apps) = apps {
        for (id, a) in apps.entries() {
            let Ok(id) = id.parse::<i64>() else { continue };
            let pt = a.str("Playtime").and_then(|p| p.parse::<i64>().ok()).unwrap_or(0);
            let last = a.str("LastPlayed").and_then(|p| p.parse::<i64>().ok()).filter(|t| *t > 0);
            if pt > 0 || last.is_some() {
                out.insert(id, (pt * 60, last));
            }
        }
    }
    out
}

/// Appids que probablemente tienes en la biblioteca de Steam (instalados o no):
/// la caché de arte de la biblioteca + las apps con horas del usuario. Incluye
/// DLC y bandas sonoras: hay que quedarse solo con juegos (tipo 0 en GetItems).
pub fn owned_candidates() -> Vec<i64> {
    let Some(root) = steam_root() else { return vec![] };
    let mut set = std::collections::BTreeSet::new();
    if let Ok(rd) = std::fs::read_dir(root.join("appcache").join("librarycache")) {
        for e in rd.filter_map(Result::ok) {
            // Formato nuevo: carpeta "<appid>". Antiguo: "<appid>_library_600x900.jpg".
            let name = e.file_name().to_string_lossy().to_string();
            if let Some(id) = name.split(['_', '.']).next().and_then(|s| s.parse::<i64>().ok()) {
                set.insert(id);
            }
        }
    }
    set.extend(playtimes(&root).keys().copied());
    set.retain(|id| *id > 0 && !SKIP_APPIDS.contains(id));
    set.into_iter().collect()
}

/// Horas por appid del usuario de Steam (una lectura para toda la importación).
pub fn all_playtimes() -> HashMap<i64, (i64, Option<i64>)> {
    steam_root().map(|r| playtimes(&r)).unwrap_or_default()
}

/// Juego de Steam comprado y sin instalar.
pub fn owned_game(appid: i64, name: &str, times: &HashMap<i64, (i64, Option<i64>)>) -> NewGame {
    NewGame {
        title: name.to_string(),
        source: "steam".into(),
        source_id: appid.to_string(),
        steam_appid: Some(appid),
        owned_only: true,
        install_uri: Some(format!("steam://install/{appid}")),
        imported_playtime: times.get(&appid).map(|t| t.0),
        imported_last_played: times.get(&appid).and_then(|t| t.1),
        ..Default::default()
    }
}

pub fn installed() -> anyhow::Result<Vec<NewGame>> {
    let Some(root) = steam_root() else { return Ok(vec![]) };
    let times = playtimes(&root);
    let mut out = vec![];
    for lib in library_paths(&root) {
        let apps = lib.join("steamapps");
        let Ok(rd) = std::fs::read_dir(&apps) else { continue };
        for e in rd.filter_map(Result::ok) {
            let name = e.file_name().to_string_lossy().to_string();
            if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                continue;
            }
            let Ok(t) = std::fs::read_to_string(e.path()) else { continue };
            let v = vdf::parse(&t);
            let Some(st) = v.get("AppState") else { continue };
            let Some(appid) = st.str("appid").and_then(|s| s.parse::<i64>().ok()) else { continue };
            let flags: i64 = st.str("StateFlags").and_then(|s| s.parse().ok()).unwrap_or(0);
            let title = st.str("name").unwrap_or_default().to_string();
            let lower = title.to_lowercase();
            if flags & 4 == 0
                || SKIP_APPIDS.contains(&appid)
                || lower.starts_with("proton")
                || lower.contains("steam linux runtime")
                || lower.contains("steamworks common")
                || lower.contains("redistributable")
                || lower.ends_with("dedicated server")
            {
                continue;
            }
            let installdir = st.str("installdir").unwrap_or_default();
            let dir = apps.join("common").join(installdir);
            if installdir.is_empty() || !dir.is_dir() {
                continue;
            }
            out.push(NewGame {
                title,
                source: "steam".into(),
                source_id: appid.to_string(),
                install_dir: Some(dir.to_string_lossy().to_string()),
                launch_uri: Some(format!("steam://rungameid/{appid}")),
                install_uri: Some(format!("steam://install/{appid}")),
                steam_appid: Some(appid),
                imported_playtime: times.get(&appid).map(|t| t.0),
                imported_last_played: times.get(&appid).and_then(|t| t.1),
                ..Default::default()
            });
        }
    }
    Ok(out)
}
