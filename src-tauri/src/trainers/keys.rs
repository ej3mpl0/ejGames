//! Pulsar las teclas de una opción del trainer ("Ctrl+Num 1") con SendInput.
//! Los atajos de FLiNG son globales: llegan aunque delante esté el panel del
//! overlay y no el juego.

/// Una combinación: modificadores + tecla (códigos de tecla virtual).
#[derive(Debug, Clone, PartialEq)]
pub struct Combo {
    pub mods: Vec<u16>,
    pub key: u16,
    /// Tecla extendida (Inicio, Fin, flechas, «/» del teclado numérico…).
    pub extended: bool,
}

const VK_LSHIFT: u16 = 0xA0;
const VK_LCONTROL: u16 = 0xA2;
const VK_LMENU: u16 = 0xA4;

fn key_code(k: &str) -> Option<(u16, bool)> {
    if let Some(n) = k.strip_prefix("Num ") {
        return Some(match n {
            d if d.len() == 1 && d.as_bytes()[0].is_ascii_digit() => (0x60 + (d.as_bytes()[0] - b'0') as u16, false),
            "." | "Del" => (0x6E, false),
            "+" => (0x6B, false),
            "-" => (0x6D, false),
            "*" => (0x6A, false),
            "/" => (0x6F, true),
            "Enter" => (0x0D, true),
            _ => return None,
        });
    }
    if let Some(n) = k.strip_prefix('F').and_then(|n| n.parse::<u16>().ok()) {
        return (1..=12).contains(&n).then_some((0x6F + n, false));
    }
    Some(match k {
        "Home" => (0x24, true),
        "End" => (0x23, true),
        "Insert" => (0x2D, true),
        "Delete" => (0x2E, true),
        "Page Up" => (0x21, true),
        "Page Down" => (0x22, true),
        "Space" => (0x20, false),
        "Tab" => (0x09, false),
        c if c.len() == 1 && c.as_bytes()[0].is_ascii_alphanumeric() => (c.as_bytes()[0].to_ascii_uppercase() as u16, false),
        _ => return None,
    })
}

/// "Ctrl+Alt+Num 1" (ya normalizado por `fling::canon_hotkey`).
pub fn parse(keys: &str) -> Option<Combo> {
    let parts: Vec<&str> = keys.split('+').collect();
    // «Num +»: el último «+» es la tecla, no un separador.
    let (mods, key) = if keys.ends_with("Num +") {
        (&parts[..parts.len() - 2], "Num +")
    } else {
        (&parts[..parts.len() - 1], *parts.last()?)
    };
    let mut out = vec![];
    for m in mods {
        out.push(match *m {
            "Ctrl" => VK_LCONTROL,
            "Alt" => VK_LMENU,
            "Shift" => VK_LSHIFT,
            _ => return None,
        });
    }
    let (key, extended) = key_code(key)?;
    Some(Combo { mods: out, key, extended })
}

#[cfg(windows)]
fn send(vk: u16, up: bool, extended: bool) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
        MAPVK_VK_TO_VSC, VIRTUAL_KEY,
    };
    let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
    let mut flags = KEYBD_EVENT_FLAGS(0);
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    if extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    };
    unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) == 1 }
}

/// Pulsa la combinación: modificadores, tecla (un momento, para los trainers
/// que miran el teclado cada pocos ms) y se sueltan en orden inverso.
#[cfg(windows)]
pub fn press(c: &Combo) -> anyhow::Result<()> {
    use std::thread::sleep;
    use std::time::Duration;
    let mut ok = true;
    for m in &c.mods {
        ok &= send(*m, false, false);
        sleep(Duration::from_millis(15));
    }
    ok &= send(c.key, false, c.extended);
    sleep(Duration::from_millis(90));
    ok &= send(c.key, true, c.extended);
    for m in c.mods.iter().rev() {
        sleep(Duration::from_millis(15));
        ok &= send(*m, true, false);
    }
    if !ok {
        anyhow::bail!("Windows no dejó pulsar las teclas del trainer");
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn press(_c: &Combo) -> anyhow::Result<()> {
    anyhow::bail!("Solo en Windows")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fling_hotkeys() {
        assert_eq!(parse("Num 1"), Some(Combo { mods: vec![], key: 0x61, extended: false }));
        assert_eq!(parse("Ctrl+Num 0"), Some(Combo { mods: vec![VK_LCONTROL], key: 0x60, extended: false }));
        assert_eq!(parse("Alt+Shift+Num +"), Some(Combo { mods: vec![VK_LMENU, VK_LSHIFT], key: 0x6B, extended: false }));
        assert_eq!(parse("Num +"), Some(Combo { mods: vec![], key: 0x6B, extended: false }));
        assert_eq!(parse("Num /"), Some(Combo { mods: vec![], key: 0x6F, extended: true }));
        assert_eq!(parse("Num ."), Some(Combo { mods: vec![], key: 0x6E, extended: false }));
        assert_eq!(parse("F12"), Some(Combo { mods: vec![], key: 0x7B, extended: false }));
        assert_eq!(parse("Ctrl+Page Up"), Some(Combo { mods: vec![VK_LCONTROL], key: 0x21, extended: true }));
        assert_eq!(parse("Alt+F"), Some(Combo { mods: vec![VK_LMENU], key: b'F' as u16, extended: false }));
        assert_eq!(parse("Win+Num 1"), None);
        assert_eq!(parse("F13"), None);
        assert_eq!(parse("Num x"), None);
    }
}
