//! Dónde guarda cada emulador las partidas de un juego, para las copias de
//! «Partidas guardadas» (las mismas que los juegos de PC: al cerrar el juego y a
//! mano). Ludusavi no sabe de ROMs: aquí va lo propio de cada emulador.
//!
//! Cada emulador guarda en su carpeta si va «portable» (como los que instala ejGames)
//! o en la del usuario; se miran las dos.

use super::rominfo::RomInfo;
use crate::db::models::Game;
use crate::settings::EmulatorCfg;
use std::path::{Path, PathBuf};

fn env(k: &str) -> Option<PathBuf> {
    std::env::var_os(k).map(PathBuf::from)
}

/// Carpetas de datos posibles: junto al .exe (portable) y las del usuario.
fn roots(exe_dir: &Path, portable: &[&str], user: &[Option<PathBuf>]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = portable.iter().map(|p| if p.is_empty() { exe_dir.to_path_buf() } else { exe_dir.join(p) }).collect();
    out.extend(user.iter().flatten().cloned());
    out
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Patrones (con `*`) de lo que guarda el emulador de `cfg` para el juego `g`.
pub fn globs(cfg: &EmulatorCfg, g: &Game) -> Vec<String> {
    let Some(exe_dir) = Path::new(&cfg.exe).parent() else { return vec![] };
    let info: RomInfo = g.rom_meta.as_deref().and_then(|m| serde_json::from_str(m).ok()).unwrap_or_default();
    let stem = g.rom_path.as_deref().and_then(|r| Path::new(r).file_stem()).map(|x| x.to_string_lossy().into_owned()).unwrap_or_default();
    let serial = info.serial.clone().unwrap_or_default();
    let compact: String = serial.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let tid = info.title_id.clone().unwrap_or_default();
    let docs = dirs::document_dir();
    let appdata = dirs::config_dir();
    let mut out: Vec<String> = vec![];
    let id = if cfg.kind == "retroarch" { "retroarch" } else { cfg.preset.as_str() };
    match id {
        "retroarch" if !stem.is_empty() => {
            for r in roots(exe_dir, &[""], &[appdata.as_ref().map(|a| a.join("RetroArch"))]) {
                for d in ["saves", "states"] {
                    out.push(format!("{}\\{d}\\{stem}.*", s(&r)));
                    // Con «ordenar por núcleo» activado, una subcarpeta por núcleo.
                    out.push(format!("{}\\{d}\\*\\{stem}.*", s(&r)));
                }
            }
        }
        "pcsx2" => {
            for r in roots(exe_dir, &[""], &[docs.as_ref().map(|d| d.join("PCSX2"))]) {
                if !serial.is_empty() {
                    out.push(format!("{}\\sstates\\{serial}*", s(&r)));
                }
                // Las tarjetas de memoria son de todos los juegos: van enteras.
                out.push(format!("{}\\memcards", s(&r)));
            }
        }
        "duckstation" => {
            for r in roots(exe_dir, &[""], &[docs.as_ref().map(|d| d.join("DuckStation")), env("LOCALAPPDATA").map(|d| d.join("DuckStation"))]) {
                if !serial.is_empty() {
                    out.push(format!("{}\\savestates\\{serial}*", s(&r)));
                }
                out.push(format!("{}\\memcards", s(&r)));
            }
        }
        "ppsspp" if !compact.is_empty() => {
            for r in roots(exe_dir, &["memstick"], &[docs.as_ref().map(|d| d.join("PPSSPP"))]) {
                out.push(format!("{}\\PSP\\SAVEDATA\\{compact}*", s(&r)));
                out.push(format!("{}\\PSP\\PPSSPP_STATE\\{compact}*", s(&r)));
            }
        }
        "eden" if tid.len() == 16 => {
            for r in roots(exe_dir, &["user"], &[appdata.as_ref().map(|a| a.join("eden"))]) {
                out.push(format!("{}\\nand\\user\\save\\0000000000000000\\*\\{tid}", s(&r)));
            }
        }
        "ryujinx" => {
            // Ryujinx numera las partidas (sin TitleID en la ruta): la carpeta entera.
            for r in roots(exe_dir, &["portable"], &[appdata.as_ref().map(|a| a.join("Ryujinx"))]) {
                out.push(format!("{}\\bis\\user\\save", s(&r)));
            }
        }
        "vita3k" if tid.len() == 9 => {
            for r in roots(exe_dir, &[""], &[appdata.as_ref().map(|a| a.join("Vita3K").join("Vita3K"))]) {
                out.push(format!("{}\\ux0\\user\\00\\savedata\\{tid}", s(&r)));
            }
        }
        "azahar" if tid.len() == 16 => {
            let low = tid[8..].to_lowercase();
            let high = tid[..8].to_lowercase();
            for r in roots(exe_dir, &["user"], &[appdata.as_ref().map(|a| a.join("Azahar")), appdata.as_ref().map(|a| a.join("Citra"))]) {
                out.push(format!("{}\\sdmc\\Nintendo 3DS\\*\\*\\title\\{high}\\{low}\\data", s(&r)));
            }
        }
        "rpcs3" if !compact.is_empty() => {
            out.push(format!("{}\\dev_hdd0\\home\\00000001\\savedata\\{compact}*", s(exe_dir)));
        }
        "cemu" => {
            out.push(format!("{}\\mlc01\\usr\\save", s(exe_dir)));
        }
        "dolphin" => {
            for r in roots(exe_dir, &["User"], &[docs.as_ref().map(|d| d.join("Dolphin Emulator"))]) {
                out.push(format!("{}\\GC", s(&r)));
                if let Some(id) = info.title_id.as_deref().filter(|t| t.len() == 6) {
                    out.push(format!("{}\\StateSaves\\{id}*", s(&r)));
                }
            }
        }
        _ => {}
    }
    out
}

/// Rutas que existen ahora mismo.
pub fn locate(cfg: &EmulatorCfg, g: &Game) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = globs(cfg, g).iter().flat_map(|p| crate::saves::expand_glob(p)).collect();
    v.sort();
    v.dedup();
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_saves_of_portable_emulators() {
        let d = tempfile::tempdir().unwrap();
        let exe = d.path().join("eden.exe");
        std::fs::write(&exe, b"x").unwrap();
        let save = d.path().join("user").join("nand").join("user").join("save").join("0000000000000000").join("ABCDEF").join("0100ABCD00010000");
        std::fs::create_dir_all(&save).unwrap();
        let cfg = EmulatorCfg { platform: "switch".into(), kind: "preset".into(), preset: "eden".into(), exe: exe.to_string_lossy().into(), ..Default::default() };
        let g = Game { platform: Some("switch".into()), rom_meta: Some(r#"{"titleId":"0100ABCD00010000"}"#.into()), ..Default::default() };
        assert_eq!(locate(&cfg, &g), vec![save]);

        let ra = d.path().join("retroarch.exe");
        std::fs::create_dir_all(d.path().join("saves")).unwrap();
        std::fs::write(d.path().join("saves").join("Zelda (USA).srm"), b"x").unwrap();
        std::fs::write(d.path().join("saves").join("Otro.srm"), b"x").unwrap();
        let cfg = EmulatorCfg { platform: "snes".into(), kind: "retroarch".into(), exe: ra.to_string_lossy().into(), ..Default::default() };
        let g = Game { platform: Some("snes".into()), rom_path: Some("D:\\roms\\Zelda (USA).sfc".into()), ..Default::default() };
        assert_eq!(locate(&cfg, &g), vec![d.path().join("saves").join("Zelda (USA).srm")]);
    }
}
