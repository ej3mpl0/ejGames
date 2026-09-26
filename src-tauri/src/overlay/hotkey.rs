//! Atajo global del overlay (p. ej. Mayús+Tab). Solo se registra mientras el
//! juego (o el propio overlay) está en primer plano: si se registrara siempre,
//! Mayús+Tab dejaría de funcionar en el resto de programas.
//!
//! Un hilo con su cola de mensajes: `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`
//! registra o quita el atajo al cambiar de ventana y `WM_HOTKEY` lo dispara.
//! Windows no siempre avisa del cambio (p. ej. al cerrarse la ventana que
//! estaba delante), así que un temporizador lo comprueba cada 500 ms. Con el
//! juego delante, además, se lee el estado de las teclas cada 40 ms por si el
//! juego no deja pasar los atajos globales.

use std::cell::RefCell;

/// (modificadores MOD_*, tecla virtual).
pub fn parse(spec: &str) -> Option<(u32, u32)> {
    let mut mods = 0u32;
    let mut vk = None;
    for part in spec.split('+').map(|p| p.trim().to_ascii_lowercase()).filter(|p| !p.is_empty()) {
        match part.as_str() {
            "ctrl" | "control" => mods |= 0x2,
            "alt" => mods |= 0x1,
            "shift" | "mayús" | "mayus" => mods |= 0x4,
            "win" | "super" | "meta" => mods |= 0x8,
            k => vk = Some(key_code(k)?),
        }
    }
    Some((mods, vk?))
}

fn key_code(k: &str) -> Option<u32> {
    Some(match k {
        "tab" => 0x09,
        "space" | "espacio" => 0x20,
        "pageup" | "repág" => 0x21,
        "pagedown" | "avpág" => 0x22,
        "end" | "fin" => 0x23,
        "home" | "inicio" => 0x24,
        "insert" | "ins" => 0x2D,
        "delete" | "supr" => 0x2E,
        "`" | "º" | "backquote" => 0xC0,
        k if k.len() == 1 && k.chars().all(|c| c.is_ascii_alphanumeric()) => k.to_ascii_uppercase().chars().next()? as u32,
        k if k.starts_with('f') => {
            let n: u32 = k[1..].parse().ok()?;
            if !(1..=24).contains(&n) {
                return None;
            }
            0x70 + n - 1
        }
        _ => return None,
    })
}

/// ¿Es el atajo del overlay de Steam? (en juegos de Steam no se registra).
pub fn is_steam_default(spec: &str) -> bool {
    parse(spec) == Some((0x4, 0x09))
}

pub struct Guard {
    thread_id: u32,
}

#[cfg(windows)]
impl Drop for Guard {
    fn drop(&mut self) {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
        unsafe {
            let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}

type TargetFn = Box<dyn Fn(u32, isize) -> bool + Send>;

struct Ctx {
    is_target: TargetFn,
    mods: u32,
    vk: u32,
    /// El juego (o el overlay) está en primer plano.
    active: bool,
    /// RegisterHotKey funcionó.
    registered: bool,
    last_hwnd: isize,
    /// Combinación pulsada en la última lectura (para detectar el flanco).
    combo_down: bool,
    last_fire: Option<std::time::Instant>,
}

thread_local! {
    static CTX: RefCell<Option<Ctx>> = const { RefCell::new(None) };
}

/// Evita el doble disparo cuando funcionan los dos métodos a la vez.
fn should_fire(ctx: &mut Ctx) -> bool {
    let now = std::time::Instant::now();
    if ctx.last_fire.map(|t| now.duration_since(t).as_millis() < 400).unwrap_or(false) {
        return false;
    }
    ctx.last_fire = Some(now);
    true
}

#[cfg(windows)]
fn update(hwnd: isize) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_NOREPEAT};
    CTX.with(|c| {
        let mut c = c.borrow_mut();
        let Some(ctx) = c.as_mut() else { return };
        if hwnd == ctx.last_hwnd {
            return;
        }
        ctx.last_hwnd = hwnd;
        let want = hwnd != 0 && (ctx.is_target)(super::win::window_pid(hwnd), hwnd);
        if want == ctx.active {
            return;
        }
        ctx.active = want;
        unsafe {
            if want {
                ctx.registered = RegisterHotKey(None, 1, HOT_KEY_MODIFIERS(ctx.mods) | MOD_NOREPEAT, ctx.vk).is_ok();
                // Aunque falle (otro programa lo tiene), la lectura de teclas sigue valiendo.
                tracing::info!("overlay: juego en primer plano, atajo registrado: {}", ctx.registered);
            } else {
                if ctx.registered {
                    let _ = UnregisterHotKey(None, 1);
                }
                ctx.registered = false;
                ctx.combo_down = false;
            }
        }
    });
}

/// Segundo método: leer el estado de las teclas. Algunos juegos (entrada raw
/// con RIDEV_NOHOTKEYS, ganchos de teclado) no dejan llegar WM_HOTKEY.
#[cfg(windows)]
fn poll_keys() -> bool {
    CTX.with(|c| {
        let mut c = c.borrow_mut();
        let Some(ctx) = c.as_mut() else { return false };
        if !ctx.active {
            return false;
        }
        let down = super::win::keys_down(ctx.mods, ctx.vk);
        let edge = down && !ctx.combo_down;
        ctx.combo_down = down;
        edge && should_fire(ctx)
    })
}

#[cfg(windows)]
fn hotkey_message() -> bool {
    CTX.with(|c| c.borrow_mut().as_mut().map(should_fire).unwrap_or(false))
}

#[cfg(windows)]
unsafe extern "system" fn on_foreground(
    _hook: windows::Win32::UI::Accessibility::HWINEVENTHOOK,
    _event: u32,
    hwnd: windows::Win32::Foundation::HWND,
    _obj: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    update(hwnd.0 as isize);
}

#[cfg(windows)]
pub fn start(spec: &str, is_target: TargetFn, on_press: Box<dyn Fn() + Send>) -> Option<Guard> {
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent};
    use windows::Win32::UI::Input::KeyboardAndMouse::UnregisterHotKey;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetMessageW, KillTimer, PeekMessageW, SetTimer, EVENT_SYSTEM_FOREGROUND, MSG, PM_NOREMOVE,
        WINEVENT_OUTOFCONTEXT, WM_HOTKEY, WM_TIMER, WM_USER,
    };
    let (mods, vk) = parse(spec)?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("ejg-hotkey".into())
        .spawn(move || unsafe {
            let mut msg = MSG::default();
            // Crea la cola de mensajes del hilo antes de publicar su id.
            let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
            CTX.with(|c| {
                *c.borrow_mut() = Some(Ctx {
                    is_target,
                    mods,
                    vk,
                    active: false,
                    registered: false,
                    last_hwnd: -1,
                    combo_down: false,
                    last_fire: None,
                })
            });
            let hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_foreground), 0, 0, WINEVENT_OUTOFCONTEXT);
            // 40 ms: lectura de teclas; cada 500 ms, además, la ventana en primer
            // plano (Windows no siempre avisa del cambio).
            let timer = SetTimer(None, 0, 40, None);
            let _ = tx.send(GetCurrentThreadId());
            update(GetForegroundWindow().0 as isize);
            let mut ticks = 0u32;
            loop {
                let r = GetMessageW(&mut msg, None, 0, 0);
                if r.0 <= 0 {
                    break; // WM_QUIT o error
                }
                match msg.message {
                    WM_HOTKEY => {
                        if hotkey_message() {
                            tracing::info!("overlay: atajo (WM_HOTKEY)");
                            on_press();
                        }
                    }
                    WM_TIMER => {
                        ticks = ticks.wrapping_add(1);
                        if ticks % 12 == 0 {
                            update(GetForegroundWindow().0 as isize);
                        }
                        if poll_keys() {
                            tracing::info!("overlay: atajo (teclas)");
                            on_press();
                        }
                    }
                    _ => {}
                }
            }
            let _ = KillTimer(None, timer);
            if !hook.is_invalid() {
                let _ = UnhookWinEvent(hook);
            }
            let _ = UnregisterHotKey(None, 1);
            CTX.with(|c| *c.borrow_mut() = None);
        })
        .ok()?;
    let thread_id = rx.recv_timeout(std::time::Duration::from_secs(2)).ok()?;
    Some(Guard { thread_id })
}

#[cfg(not(windows))]
pub fn start(_spec: &str, _is_target: TargetFn, _on_press: Box<dyn Fn() + Send>) -> Option<Guard> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses() {
        assert_eq!(parse("Shift+Tab"), Some((0x4, 0x09)));
        assert_eq!(parse("ctrl + shift + o"), Some((0x6, 'O' as u32)));
        assert_eq!(parse("F12"), Some((0, 0x7B)));
        assert_eq!(parse("Alt+`"), Some((0x1, 0xC0)));
        assert_eq!(parse("Ctrl+"), None);
        assert_eq!(parse("Ctrl+Foo"), None);
        assert!(is_steam_default("shift+tab"));
        assert!(!is_steam_default("Ctrl+Tab"));
    }
}
