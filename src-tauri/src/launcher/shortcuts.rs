//! Lanzar un juego desde fuera de ejGames: acceso directo en el escritorio y
//! entrada en Steam («Añadir un juego que no es de Steam»). Los dos abren
//! `ejgames.exe --play <id>`, así que las horas, el overlay y Discord funcionan
//! igual que desde la biblioteca.

use crate::db::models::Game;
use anyhow::Context;
use std::path::{Path, PathBuf};

/// `--play <id>` o `--play=<id>` en los argumentos del proceso.
pub fn play_arg(args: impl IntoIterator<Item = String>) -> Option<i64> {
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        if let Some(v) = a.strip_prefix("--play=") {
            return v.parse().ok();
        }
        if a == "--play" {
            return it.next().and_then(|v| v.parse().ok());
        }
    }
    None
}

fn safe_file_name(title: &str) -> String {
    let s: String = title.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { ' ' } else { c }).collect();
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = s.trim_matches(|c| c == '.' || c == ' ');
    if s.is_empty() { crate::i18n::t("Juego").into() } else { s.chars().take(80).collect() }
}

// ───────────────────────── acceso directo (.lnk) ─────────────────────────

/// Crea «<título>.lnk» en `dir` (el escritorio): abre ejGames con `--play`.
#[cfg(windows)]
pub fn create_shortcut(game: &Game, ejgames_exe: &Path, dir: &Path) -> anyhow::Result<PathBuf> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    std::fs::create_dir_all(dir)?;
    let lnk = dir.join(format!("{}.lnk", safe_file_name(&game.title)));
    let exe = ejgames_exe.to_string_lossy().to_string();
    let icon = game.exe_path.clone().filter(|p| Path::new(p).exists()).unwrap_or_else(|| exe.clone());
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let r = (|| -> anyhow::Result<()> {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&HSTRING::from(exe.as_str()))?;
            link.SetArguments(&HSTRING::from(format!("--play {}", game.id)))?;
            link.SetIconLocation(&HSTRING::from(icon.as_str()), 0)?;
            link.SetDescription(&HSTRING::from(format!("{} (ejGames)", game.title)))?;
            if let Some(d) = ejgames_exe.parent() {
                link.SetWorkingDirectory(&HSTRING::from(d.to_string_lossy().as_ref()))?;
            }
            link.cast::<IPersistFile>()?.Save(&HSTRING::from(lnk.to_string_lossy().as_ref()), true)?;
            Ok(())
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        r.context(crate::i18n::t("no se pudo crear el acceso directo"))?;
    }
    Ok(lnk)
}
#[cfg(not(windows))]
pub fn create_shortcut(_: &Game, _: &Path, _: &Path) -> anyhow::Result<PathBuf> {
    anyhow::bail!("Solo en Windows")
}

// ───────────────────────── Steam: shortcuts.vdf ─────────────────────────

/// VDF binario (el de `userdata/<id>/config/shortcuts.vdf`).
#[derive(Debug, Clone, PartialEq)]
pub enum Vdf {
    Obj(Vec<(String, Vdf)>),
    Str(String),
    Int(u32),
}

fn read_cstr(b: &[u8], i: &mut usize) -> Option<String> {
    let start = *i;
    while *b.get(*i)? != 0 {
        *i += 1;
    }
    let s = String::from_utf8_lossy(&b[start..*i]).into_owned();
    *i += 1;
    Some(s)
}

fn read_obj(b: &[u8], i: &mut usize) -> Option<Vec<(String, Vdf)>> {
    let mut out = vec![];
    loop {
        let t = *b.get(*i)?;
        *i += 1;
        match t {
            0x08 => return Some(out),
            0x00 => {
                let k = read_cstr(b, i)?;
                out.push((k, Vdf::Obj(read_obj(b, i)?)));
            }
            0x01 => {
                let k = read_cstr(b, i)?;
                let v = read_cstr(b, i)?;
                out.push((k, Vdf::Str(v)));
            }
            0x02 => {
                let k = read_cstr(b, i)?;
                let v = u32::from_le_bytes(b.get(*i..*i + 4)?.try_into().ok()?);
                *i += 4;
                out.push((k, Vdf::Int(v)));
            }
            _ => return None,
        }
    }
}

pub fn vdf_parse(b: &[u8]) -> Option<Vec<(String, Vdf)>> {
    let mut i = 0;
    let top = read_obj(b, &mut i)?;
    Some(top)
}

fn write_obj(o: &[(String, Vdf)], out: &mut Vec<u8>) {
    for (k, v) in o {
        match v {
            Vdf::Obj(c) => {
                out.push(0x00);
                out.extend(k.as_bytes());
                out.push(0);
                write_obj(c, out);
            }
            Vdf::Str(s) => {
                out.push(0x01);
                out.extend(k.as_bytes());
                out.push(0);
                out.extend(s.as_bytes());
                out.push(0);
            }
            Vdf::Int(n) => {
                out.push(0x02);
                out.extend(k.as_bytes());
                out.push(0);
                out.extend(n.to_le_bytes());
            }
        }
    }
    out.push(0x08);
}

pub fn vdf_write(top: &[(String, Vdf)]) -> Vec<u8> {
    let mut out = vec![];
    write_obj(top, &mut out);
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

/// Identificador que Steam da a un acceso directo que no es de Steam: lo usa en
/// los nombres de las imágenes de `config/grid`.
pub fn shortcut_id(exe_quoted: &str, name: &str) -> u32 {
    crc32(format!("{exe_quoted}{name}").as_bytes()) | 0x8000_0000
}

fn entry(name: &str, exe: &str, start_dir: &str, icon: &str, opts: &str, id: u32) -> Vdf {
    Vdf::Obj(vec![
        ("appid".into(), Vdf::Int(id)),
        ("AppName".into(), Vdf::Str(name.into())),
        ("Exe".into(), Vdf::Str(exe.into())),
        ("StartDir".into(), Vdf::Str(start_dir.into())),
        ("icon".into(), Vdf::Str(icon.into())),
        ("ShortcutPath".into(), Vdf::Str(String::new())),
        ("LaunchOptions".into(), Vdf::Str(opts.into())),
        ("IsHidden".into(), Vdf::Int(0)),
        ("AllowDesktopConfig".into(), Vdf::Int(1)),
        ("AllowOverlay".into(), Vdf::Int(1)),
        ("OpenVR".into(), Vdf::Int(0)),
        ("Devkit".into(), Vdf::Int(0)),
        ("DevkitGameID".into(), Vdf::Str(String::new())),
        ("LastPlayTime".into(), Vdf::Int(0)),
        ("tags".into(), Vdf::Obj(vec![])),
    ])
}

/// Añade (o actualiza) el juego en el `shortcuts.vdf` de `config_dir`; devuelve
/// el id del acceso directo. Guarda una copia del original la primera vez.
pub fn add_to_shortcuts(config_dir: &Path, game: &Game, ejgames_exe: &Path) -> anyhow::Result<u32> {
    let file = config_dir.join("shortcuts.vdf");
    let mut top = match std::fs::read(&file) {
        Ok(b) => vdf_parse(&b).context(crate::i18n::t("shortcuts.vdf no se puede leer"))?,
        Err(_) => vec![("shortcuts".to_string(), Vdf::Obj(vec![]))],
    };
    if file.exists() {
        let bak = config_dir.join("shortcuts.vdf.ejgames-backup");
        if !bak.exists() {
            let _ = std::fs::copy(&file, bak);
        }
    }
    let exe = format!("\"{}\"", ejgames_exe.to_string_lossy());
    let dir = format!("\"{}\"", ejgames_exe.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default());
    let icon = game.exe_path.clone().unwrap_or_default();
    let opts = format!("--play {}", game.id);
    let id = shortcut_id(&exe, &game.title);
    let new = entry(&game.title, &exe, &dir, &icon, &opts, id);

    let Some((_, Vdf::Obj(list))) = top.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case("shortcuts")) else {
        anyhow::bail!("{}", crate::i18n::t("shortcuts.vdf no tiene el formato esperado"));
    };
    // Ya estaba (mismo --play): se actualiza en su sitio.
    let existing = list.iter().position(|(_, v)| match v {
        Vdf::Obj(f) => f.iter().any(|(k, v)| k.eq_ignore_ascii_case("LaunchOptions") && *v == Vdf::Str(opts.clone())),
        _ => false,
    });
    match existing {
        Some(i) => list[i].1 = new,
        None => {
            let next = list.iter().filter_map(|(k, _)| k.parse::<usize>().ok()).max().map(|m| m + 1).unwrap_or(0);
            list.push((next.to_string(), new));
        }
    }
    std::fs::create_dir_all(config_dir)?;
    std::fs::write(&file, vdf_write(&top))?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game() -> Game {
        Game { id: 7, title: "Mi Juego: Edición".into(), exe_path: Some(r"C:\Juegos\mi\juego.exe".into()), ..Default::default() }
    }

    #[test]
    fn play_arg_forms() {
        let a = |v: &[&str]| play_arg(v.iter().map(|s| s.to_string()));
        assert_eq!(a(&["ejgames.exe", "--play", "12"]), Some(12));
        assert_eq!(a(&["ejgames.exe", "--play=5", "--minimized"]), Some(5));
        assert_eq!(a(&["ejgames.exe", "--minimized"]), None);
        assert_eq!(a(&["ejgames.exe", "--play", "abc"]), None);
    }

    #[test]
    fn file_names_are_safe() {
        assert_eq!(safe_file_name("Mi Juego: Edición"), "Mi Juego Edición");
        assert_eq!(safe_file_name("???"), "Juego");
    }

    #[test]
    fn crc32_known_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn vdf_roundtrip_and_add() {
        let dir = tempfile::tempdir().unwrap();
        let exe = Path::new(r"C:\Program Files\ejGames\ejgames.exe");
        let id = add_to_shortcuts(dir.path(), &game(), exe).unwrap();
        assert!(id & 0x8000_0000 != 0);
        let bytes = std::fs::read(dir.path().join("shortcuts.vdf")).unwrap();
        let parsed = vdf_parse(&bytes).unwrap();
        assert_eq!(vdf_write(&parsed), bytes);
        // Otro juego: entrada «1»; el mismo juego otra vez: se actualiza, no se duplica.
        let other = Game { id: 8, title: "Otro".into(), ..Default::default() };
        add_to_shortcuts(dir.path(), &other, exe).unwrap();
        add_to_shortcuts(dir.path(), &game(), exe).unwrap();
        let parsed = vdf_parse(&std::fs::read(dir.path().join("shortcuts.vdf")).unwrap()).unwrap();
        let Vdf::Obj(list) = &parsed[0].1 else { panic!() };
        assert_eq!(list.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), vec!["0", "1"]);
    }

    #[test]
    fn existing_steam_entries_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let theirs = Vdf::Obj(vec![("shortcuts".into(), Vdf::Obj(vec![("0".into(), entry("Suyo", "\"C:\\x.exe\"", "\"C:\\\"", "", "", 1))]))]);
        let Vdf::Obj(top) = theirs else { panic!() };
        std::fs::write(dir.path().join("shortcuts.vdf"), vdf_write(&top)).unwrap();
        add_to_shortcuts(dir.path(), &game(), Path::new(r"C:\e\ejgames.exe")).unwrap();
        assert!(dir.path().join("shortcuts.vdf.ejgames-backup").exists());
        let parsed = vdf_parse(&std::fs::read(dir.path().join("shortcuts.vdf")).unwrap()).unwrap();
        let Vdf::Obj(list) = &parsed[0].1 else { panic!() };
        assert_eq!(list.len(), 2);
    }

    #[test]
    #[cfg(windows)]
    fn lnk_is_created() {
        let dir = tempfile::tempdir().unwrap();
        let p = create_shortcut(&game(), Path::new(r"C:\Windows\notepad.exe"), dir.path()).unwrap();
        assert!(p.exists() && p.extension().unwrap() == "lnk");
    }
}
