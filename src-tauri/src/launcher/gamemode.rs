//! Modo juego: mientras hay un juego en marcha, plan de energía de alto
//! rendimiento y las notificaciones de Windows en silencio. Al acabar (o al
//! cerrar ejGames, o en el siguiente arranque si ejGames se cayó) todo vuelve a
//! como estaba. Cada parte se activa por separado en Ajustes → Sistema.

use crate::state::AppState;
use parking_lot::Mutex;

/// GUID del plan «Alto rendimiento» de Windows.
const HIGH_PERFORMANCE: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";

/// Lo que había antes de entrar en el modo (para volver).
#[derive(Debug, Clone, Default)]
struct Saved {
    scheme: Option<String>,
    toasts: Option<u32>,
}

static ACTIVE: Mutex<Option<Saved>> = Mutex::new(None);

/// GUID del plan activo en la salida de `powercfg /getactivescheme`
/// («Power Scheme GUID: 381b4222-…  (Equilibrado)»).
pub fn parse_scheme(out: &str) -> Option<String> {
    out.split_whitespace()
        .find(|w| w.len() == 36 && w.chars().filter(|c| *c == '-').count() == 4 && w.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
        .map(str::to_ascii_lowercase)
}

#[cfg(windows)]
fn powercfg(args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("powercfg").args(args).creation_flags(CREATE_NO_WINDOW).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}
#[cfg(not(windows))]
fn powercfg(_: &[&str]) -> Option<String> {
    None
}

fn active_scheme() -> Option<String> {
    parse_scheme(&powercfg(&["/getactivescheme"])?)
}

fn set_scheme(guid: &str) -> bool {
    powercfg(&["/setactive", guid]).is_some()
}

#[cfg(windows)]
const TOASTS_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\PushNotifications";

#[cfg(windows)]
fn toasts() -> Option<u32> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let k = RegKey::predef(HKEY_CURRENT_USER).open_subkey(TOASTS_KEY).ok()?;
    // Sin el valor, las notificaciones están activadas.
    Some(k.get_value::<u32, _>("ToastEnabled").unwrap_or(1))
}
#[cfg(windows)]
fn set_toasts(v: u32) -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(TOASTS_KEY)
        .and_then(|(k, _)| k.set_value("ToastEnabled", &v))
        .is_ok()
}
#[cfg(not(windows))]
fn toasts() -> Option<u32> {
    None
}
#[cfg(not(windows))]
fn set_toasts(_: u32) -> bool {
    false
}

/// Entra en el modo (una vez, aunque haya varios juegos a la vez).
pub fn enter(st: &AppState) {
    let s = st.settings.get();
    if !(s.game_mode_power || s.game_mode_dnd) {
        return;
    }
    let mut active = ACTIVE.lock();
    if active.is_some() {
        return;
    }
    let mut saved = Saved::default();
    if s.game_mode_power {
        if let Some(cur) = active_scheme() {
            if cur != HIGH_PERFORMANCE && set_scheme(HIGH_PERFORMANCE) {
                saved.scheme = Some(cur);
            }
        }
    }
    if s.game_mode_dnd {
        if let Some(cur) = toasts() {
            if cur != 0 && set_toasts(0) {
                saved.toasts = Some(cur);
            }
        }
    }
    if saved.scheme.is_none() && saved.toasts.is_none() {
        return;
    }
    // Por si ejGames se cae con el modo puesto: el siguiente arranque lo deshace.
    let (sch, ts) = (saved.scheme.clone().unwrap_or_default(), saved.toasts.map(|t| t as i64).unwrap_or(-1));
    let _ = st.settings.update(|x| {
        x.game_mode_saved_scheme = sch;
        x.game_mode_saved_toasts = ts;
    });
    tracing::info!("modo juego: activado");
    *active = Some(saved);
}

/// Vuelve a como estaba (si no queda ningún juego en marcha, salvo `force`).
pub fn exit(st: &AppState, force: bool) {
    if !force && st.sessions.any() {
        return;
    }
    let Some(saved) = ACTIVE.lock().take() else { return };
    restore(&saved);
    let _ = st.settings.update(|x| {
        x.game_mode_saved_scheme.clear();
        x.game_mode_saved_toasts = -1;
    });
    tracing::info!("modo juego: desactivado");
}

fn restore(saved: &Saved) {
    if let Some(s) = &saved.scheme {
        set_scheme(s);
    }
    if let Some(t) = saved.toasts {
        set_toasts(t);
    }
}

/// Al arrancar: si ejGames se cerró de golpe con el modo puesto, deshacerlo.
pub fn recover(st: &AppState) {
    let s = st.settings.get();
    if s.game_mode_saved_scheme.is_empty() && s.game_mode_saved_toasts < 0 {
        return;
    }
    let saved = Saved {
        scheme: (!s.game_mode_saved_scheme.is_empty()).then(|| s.game_mode_saved_scheme.clone()),
        toasts: (s.game_mode_saved_toasts >= 0).then_some(s.game_mode_saved_toasts as u32),
    };
    restore(&saved);
    let _ = st.settings.update(|x| {
        x.game_mode_saved_scheme.clear();
        x.game_mode_saved_toasts = -1;
    });
    tracing::info!("modo juego: restaurado tras un cierre inesperado");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_active_scheme_in_any_language() {
        assert_eq!(
            parse_scheme("Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)").as_deref(),
            Some("381b4222-f694-41f0-9685-ff5bb260df2e")
        );
        assert_eq!(
            parse_scheme("GUID del plan de energía: 8C5E7FDA-E8BF-4A96-9A85-A6E23A8C635C  (Alto rendimiento)").as_deref(),
            Some("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c")
        );
        assert_eq!(parse_scheme("sin guid"), None);
    }

    /// Cambia de verdad el plan de energía de este PC y lo devuelve:
    /// `cargo test --lib gamemode -- --ignored`.
    #[test]
    #[ignore]
    fn power_plan_roundtrip() {
        let before = active_scheme().expect("powercfg");
        if before != HIGH_PERFORMANCE {
            assert!(set_scheme(HIGH_PERFORMANCE));
            assert_eq!(active_scheme().as_deref(), Some(HIGH_PERFORMANCE));
            assert!(set_scheme(&before));
        }
        assert_eq!(active_scheme(), Some(before));
    }
}
