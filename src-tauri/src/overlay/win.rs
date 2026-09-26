//! Win32 para el overlay: pantalla completa exclusiva, monitor del juego,
//! foco y sonido.

use std::collections::HashMap;
use std::sync::OnceLock;
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId,
    IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow, SetWindowPos, ShowWindow, GWL_EXSTYLE, GW_OWNER, HWND_TOPMOST,
    SWP_NOACTIVATE, SW_RESTORE, WS_EX_TOOLWINDOW,
};

fn h(v: isize) -> HWND {
    HWND(v as _)
}

/// Un juego en pantalla completa exclusiva (D3D): una ventana encima lo
/// minimizaría o no se vería.
pub fn exclusive_fullscreen() -> bool {
    unsafe { SHQueryUserNotificationState().map(|s| s == QUNS_RUNNING_D3D_FULL_SCREEN).unwrap_or(false) }
}

pub fn foreground() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

pub fn window_pid(hwnd: isize) -> u32 {
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(h(hwnd), Some(&mut pid));
    }
    pid
}

pub fn is_window(hwnd: isize) -> bool {
    hwnd != 0 && unsafe { IsWindow(Some(h(hwnd))).as_bool() }
}

/// Rectángulo (x, y, ancho, alto) en píxeles físicos.
pub type Rect = (i32, i32, i32, i32);

#[derive(Debug, Clone, Copy)]
pub struct Monitor {
    /// Monitor completo (los juegos tapan la barra de tareas).
    pub full: Rect,
    /// Sin la barra de tareas.
    pub work: Rect,
    pub scale: f64,
}

fn rect(r: RECT) -> Rect {
    (r.left, r.top, r.right - r.left, r.bottom - r.top)
}

/// Monitor donde está la ventana (el más cercano si está fuera de pantalla).
pub fn monitor_of(hwnd: isize) -> Option<Monitor> {
    unsafe {
        let mon = MonitorFromWindow(h(hwnd), MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(mon, &mut info).as_bool() {
            return None;
        }
        let (mut dx, mut dy) = (96u32, 96u32);
        let _ = GetDpiForMonitor(mon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        Some(Monitor { full: rect(info.rcMonitor), work: rect(info.rcWork), scale: dx.max(96) as f64 / 96.0 })
    }
}

/// Coloca la ventana (px físicos) encima de todo, sin activarla, en una sola
/// llamada (mover y luego redimensionar puede cruzar de monitor y cambiar de DPI).
pub fn set_rect(hwnd: isize, r: Rect) {
    unsafe {
        let _ = SetWindowPos(h(hwnd), Some(HWND_TOPMOST), r.0, r.1, r.2, r.3, SWP_NOACTIVATE);
    }
}

struct FindCtx<'a> {
    matches: &'a dyn Fn(u32) -> bool,
    cache: HashMap<u32, bool>,
    best: Option<(isize, i64)>,
}

unsafe extern "system" fn enum_cb(hwnd: HWND, lp: LPARAM) -> BOOL {
    let ctx = &mut *(lp.0 as *mut FindCtx);
    if !IsWindowVisible(hwnd).as_bool() || GetWindow(hwnd, GW_OWNER).map(|o| !o.is_invalid()).unwrap_or(false) {
        return BOOL(1);
    }
    if GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
        return BOOL(1);
    }
    let mut r = RECT::default();
    if GetWindowRect(hwnd, &mut r).is_err() {
        return BOOL(1);
    }
    let area = (r.right - r.left) as i64 * (r.bottom - r.top) as i64;
    if r.right - r.left < 200 || r.bottom - r.top < 150 {
        return BOOL(1);
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let ok = *ctx.cache.entry(pid).or_insert_with(|| (ctx.matches)(pid));
    if ok && ctx.best.map(|(_, a)| area > a).unwrap_or(true) {
        ctx.best = Some((hwnd.0 as isize, area));
    }
    BOOL(1)
}

/// Ventana principal del juego: la visible más grande de sus procesos.
pub fn find_window(matches: &dyn Fn(u32) -> bool) -> Option<isize> {
    let mut ctx = FindCtx { matches, cache: HashMap::new(), best: None };
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut ctx as *mut FindCtx as isize));
    }
    ctx.best.map(|(h, _)| h)
}

pub fn is_visible(hwnd: isize) -> bool {
    is_window(hwnd) && unsafe { IsWindowVisible(h(hwnd)).as_bool() }
}

/// ¿Están pulsadas ahora mismo todas estas teclas? (MOD_* + tecla virtual)
pub fn keys_down(mods: u32, vk: u32) -> bool {
    let down = |k: i32| unsafe { (GetAsyncKeyState(k) as u16 & 0x8000) != 0 };
    let checks = [(0x1, 0x12), (0x2, 0x11), (0x4, 0x10), (0x8, 0x5B)]; // Alt, Ctrl, Shift, Win
    for (m, key) in checks {
        let want = mods & m != 0;
        let is = if m == 0x8 { down(0x5B) || down(0x5C) } else { down(key) };
        if want != is {
            return false;
        }
    }
    down(vk as i32)
}

/// Devuelve el foco a una ventana (el juego al cerrar el panel). Windows solo
/// deja cambiar el primer plano al proceso que lo tiene: se engancha la cola
/// de entrada del hilo en primer plano mientras tanto.
pub fn force_foreground(hwnd: isize) {
    if !is_window(hwnd) {
        return;
    }
    unsafe {
        let target = h(hwnd);
        if IsIconic(target).as_bool() {
            let _ = ShowWindow(target, SW_RESTORE);
        }
        let fg = GetForegroundWindow();
        let fg_thread = GetWindowThreadProcessId(fg, None);
        let me = GetCurrentThreadId();
        let attached = fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, true).as_bool();
        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);
        if attached {
            let _ = AttachThreadInput(me, fg_thread, false);
        }
    }
}

/// Campanita del logro: dos notas sintetizadas (WAV en memoria, sin ficheros).
fn chime() -> &'static [u8] {
    static WAV: OnceLock<Vec<u8>> = OnceLock::new();
    WAV.get_or_init(|| {
        const RATE: u32 = 44_100;
        let len = (RATE as f32 * 0.9) as usize;
        let notes = [(0.0f32, 987.77f32), (0.085, 1479.98)]; // Si5 → Fa#6
        let mut samples = vec![0f32; len];
        for (start, freq) in notes {
            let s0 = (start * RATE as f32) as usize;
            for (i, out) in samples.iter_mut().enumerate().skip(s0) {
                let t = (i - s0) as f32 / RATE as f32;
                let attack = (t / 0.006).min(1.0);
                let env = attack * (-t / 0.22).exp();
                let w = std::f32::consts::TAU * freq * t;
                *out += env * (w.sin() + 0.28 * (2.0 * w).sin() + 0.08 * (3.0 * w).sin());
            }
        }
        let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs())).max(1e-6);
        let gain = 0.32 / peak;
        let data: Vec<u8> = samples
            .iter()
            .flat_map(|s| (((s * gain).clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes())
            .collect();
        let mut wav = Vec::with_capacity(44 + data.len());
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&1u16.to_le_bytes()); // mono
        wav.extend_from_slice(&RATE.to_le_bytes());
        wav.extend_from_slice(&(RATE * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
        wav.extend_from_slice(&data);
        wav
    })
}

pub fn play_chime() {
    let wav = chime();
    unsafe {
        let _ = PlaySoundW(PCWSTR(wav.as_ptr() as *const u16), None, SND_MEMORY | SND_ASYNC | SND_NODEFAULT);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn chime_is_valid_wav() {
        let w = super::chime();
        assert_eq!(&w[..4], b"RIFF");
        assert_eq!(&w[8..12], b"WAVE");
        assert!(w.len() > 44 + 44_100);
    }
}
