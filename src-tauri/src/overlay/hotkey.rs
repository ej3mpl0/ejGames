//! Atajos globales del overlay (el panel, p. ej. Mayús+Tab, y las capturas,
//! F12). Solo se registran mientras el juego (o el propio overlay) está en
//! primer plano: si se registraran siempre, Mayús+Tab dejaría de funcionar en
//! el resto de programas.
//!
//! Un hilo con su cola de mensajes: `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`
//! registra o quita los atajos al cambiar de ventana y `WM_HOTKEY` los dispara.
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

/// ¿Es el atajo de capturas de Steam (F12)?
pub fn is_steam_screenshot(spec: &str) -> bool {
    parse(spec) == Some((0, 0x7B))
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
pub type Action = std::sync::Arc<dyn Fn() + Send + Sync>;

/// Una combinación y lo que hace.
#[cfg_attr(not(windows), allow(dead_code))]
struct Binding {
    /// Id de RegisterHotKey (1, 2…).
    id: i32,
    name: &'static str,
    mods: u32,
    vk: u32,
    /// RegisterHotKey funcionó.
    registered: bool,
    /// Combinación pulsada en la última lectura (para detectar el flanco).
    combo_down: bool,
    last_fire: Option<std::time::Instant>,
    on_press: Action,
}

#[cfg_attr(not(windows), allow(dead_code))]
struct Ctx {
    is_target: TargetFn,
    bindings: Vec<Binding>,
    /// El juego (o el overlay) está en primer plano.
    active: bool,
    last_hwnd: isize,
}

thread_local! {
    static CTX: RefCell<Option<Ctx>> = const { RefCell::new(None) };
}

/// Evita el doble disparo cuando funcionan los dos métodos a la vez.
#[cfg(windows)]
fn should_fire(b: &mut Binding) -> bool {
    let now = std::time::Instant::now();
    if b.last_fire.map(|t| now.duration_since(t).as_millis() < 400).unwrap_or(false) {
        return false;
    }
    b.last_fire = Some(now);
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
        let pid = super::win::window_pid(hwnd);
        let want = hwnd != 0 && (ctx.is_target)(pid, hwnd);
        if want == ctx.active {
            return;
        }
        ctx.active = want;
        for b in ctx.bindings.iter_mut() {
            unsafe {
                if want {
                    // Aunque falle (otro programa lo tiene), la lectura de teclas sigue valiendo.
                    b.registered = RegisterHotKey(None, b.id, HOT_KEY_MODIFIERS(b.mods) | MOD_NOREPEAT, b.vk).is_ok();
                } else {
                    if b.registered {
                        let _ = UnregisterHotKey(None, b.id);
                    }
                    b.registered = false;
                    b.combo_down = false;
                }
            }
        }
        if want {
            // Con el juego como administrador no vale ninguno de los dos métodos (UIPI).
            let admin = crate::launcher::admin::above_us(pid);
            let list: Vec<String> = ctx.bindings.iter().map(|b| format!("{}: {}", b.name, b.registered)).collect();
            tracing::info!(
                "overlay: juego en primer plano, atajos registrados ({}){}",
                list.join(", "),
                if admin { " (el juego corre como administrador: Windows no deja leer el teclado)" } else { "" }
            );
        }
    });
}

/// Segundo método: leer el estado de las teclas. Algunos juegos (entrada raw
/// con RIDEV_NOHOTKEYS, ganchos de teclado) no dejan llegar WM_HOTKEY.
/// Devuelve los atajos que acaban de pulsarse.
#[cfg(windows)]
fn poll_keys() -> Vec<usize> {
    CTX.with(|c| {
        let mut c = c.borrow_mut();
        let Some(ctx) = c.as_mut() else { return vec![] };
        if !ctx.active {
            return vec![];
        }
        let mut fired = vec![];
        for (i, b) in ctx.bindings.iter_mut().enumerate() {
            let down = super::win::keys_down(b.mods, b.vk);
            let edge = down && !b.combo_down;
            b.combo_down = down;
            if edge && should_fire(b) {
                fired.push(i);
            }
        }
        fired
    })
}

#[cfg(windows)]
fn hotkey_message(id: i32) -> Option<usize> {
    CTX.with(|c| {
        let mut c = c.borrow_mut();
        let ctx = c.as_mut()?;
        let i = ctx.bindings.iter().position(|b| b.id == id)?;
        should_fire(&mut ctx.bindings[i]).then_some(i)
    })
}

/// Llama a la acción de un atajo, fuera del préstamo de CTX (si la acción
/// bombea mensajes, el gancho de primer plano puede volver a entrar).
#[cfg(windows)]
fn fire(i: usize, how: &str) {
    let found = CTX.with(|c| c.borrow().as_ref().and_then(|ctx| ctx.bindings.get(i).map(|b| (b.name, b.on_press.clone()))));
    if let Some((name, action)) = found {
        tracing::info!("overlay: atajo de {name} ({how})");
        action();
    }
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

/// Registra los atajos `(nombre, combinación, acción)` mientras el juego esté
/// delante. Las combinaciones que no se entienden se saltan; sin ninguna, None.
#[cfg(windows)]
pub fn start(keys: Vec<(&'static str, String, Action)>, is_target: TargetFn) -> Option<Guard> {
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent};
    use windows::Win32::UI::Input::KeyboardAndMouse::UnregisterHotKey;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetMessageW, KillTimer, PeekMessageW, SetTimer, EVENT_SYSTEM_FOREGROUND, MSG, PM_NOREMOVE,
        WINEVENT_OUTOFCONTEXT, WM_HOTKEY, WM_TIMER, WM_USER,
    };
    let bindings: Vec<Binding> = keys
        .into_iter()
        .filter_map(|(name, spec, on_press)| parse(&spec).map(|(mods, vk)| (name, mods, vk, on_press)))
        .enumerate()
        .map(|(i, (name, mods, vk, on_press))| Binding {
            id: i as i32 + 1,
            name,
            mods,
            vk,
            registered: false,
            combo_down: false,
            last_fire: None,
            on_press,
        })
        .collect();
    if bindings.is_empty() {
        return None;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("ejg-hotkey".into())
        .spawn(move || unsafe {
            let mut msg = MSG::default();
            // Crea la cola de mensajes del hilo antes de publicar su id.
            let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
            CTX.with(|c| *c.borrow_mut() = Some(Ctx { is_target, bindings, active: false, last_hwnd: -1 }));
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
                        if let Some(i) = hotkey_message(msg.wParam.0 as i32) {
                            fire(i, "WM_HOTKEY");
                        }
                    }
                    WM_TIMER => {
                        ticks = ticks.wrapping_add(1);
                        if ticks % 12 == 0 {
                            update(GetForegroundWindow().0 as isize);
                        }
                        for i in poll_keys() {
                            fire(i, "teclas");
                        }
                    }
                    _ => {}
                }
            }
            let _ = KillTimer(None, timer);
            if !hook.is_invalid() {
                let _ = UnhookWinEvent(hook);
            }
            if let Some(ctx) = CTX.with(|c| c.borrow_mut().take()) {
                for b in ctx.bindings.iter().filter(|b| b.registered) {
                    let _ = UnregisterHotKey(None, b.id);
                }
            }
        })
        .ok()?;
    let thread_id = rx.recv_timeout(std::time::Duration::from_secs(2)).ok()?;
    Some(Guard { thread_id })
}

#[cfg(not(windows))]
pub fn start(_keys: Vec<(&'static str, String, Action)>, _is_target: TargetFn) -> Option<Guard> {
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
        assert!(is_steam_screenshot("f12"));
        assert!(!is_steam_screenshot("Ctrl+F12"));
    }
}
