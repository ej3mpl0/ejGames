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

/// Una nota del sintetizador de avisos.
#[derive(Clone, Copy)]
struct Voice {
    /// Inicio y duración en segundos.
    at: f32,
    dur: f32,
    /// Frecuencia inicial y final (deslizamiento en `glide` segundos).
    f0: f32,
    f1: f32,
    glide: f32,
    wave: Wave,
    gain: f32,
    attack: f32,
    /// Constante de caída exponencial.
    decay: f32,
}

#[derive(Clone, Copy)]
enum Wave {
    /// Senoidal con armónicos suaves.
    Soft,
    /// Campana: parciales inarmónicos.
    Bell,
    Triangle,
    Square,
}

const fn v(at: f32, dur: f32, f0: f32, wave: Wave, gain: f32, decay: f32) -> Voice {
    Voice { at, dur, f0, f1: f0, glide: 0.0, wave, gain, attack: 0.006, decay }
}

/// Sonido de cada estilo de aviso. No copia los de las consolas: se queda con
/// su carácter (campana, "bwoop", clic, 8 bits…).
fn voices(style: &str, rare: bool) -> Vec<Voice> {
    use Wave::*;
    let mut out = match style {
        // Dos notas limpias y cortas, sin adornos.
        "steam" => vec![v(0.0, 0.5, 880.0, Soft, 0.8, 0.14), v(0.075, 0.7, 1318.5, Soft, 0.9, 0.22)],
        // Un "ding" metálico brillante.
        "playstation" => vec![v(0.0, 1.2, 1108.7, Bell, 1.0, 0.45), v(0.0, 0.6, 2217.5, Soft, 0.12, 0.2)],
        // Un "bwoop" grave que sube y una nota que se abre.
        "xbox" => vec![
            Voice { f1: 523.3, glide: 0.07, attack: 0.012, ..v(0.0, 0.3, 261.6, Triangle, 1.0, 0.12) },
            Voice { f1: 784.0, glide: 0.05, attack: 0.01, ..v(0.09, 0.6, 587.3, Soft, 0.8, 0.2) },
            v(0.0, 0.25, 130.8, Soft, 0.5, 0.1),
        ],
        // Clic seco y un "pop" que sube.
        "switch" => vec![
            v(0.0, 0.012, 2200.0, Square, 0.25, 0.01),
            Voice { f1: 1568.0, glide: 0.06, ..v(0.035, 0.25, 1046.5, Soft, 0.8, 0.08) },
        ],
        // Golpe grave de sala de cine y un brillo encima.
        "cinema" => vec![
            Voice { attack: 0.03, ..v(0.0, 1.4, 98.0, Soft, 1.0, 0.45) },
            Voice { attack: 0.03, ..v(0.0, 1.2, 196.0, Soft, 0.45, 0.4) },
            v(0.14, 1.0, 1318.5, Bell, 0.22, 0.35),
        ],
        // Arpegio de 8 bits.
        "retro" => [1046.5, 1318.5, 1568.0, 2093.0]
            .iter()
            .enumerate()
            .map(|(i, f)| Voice { attack: 0.002, ..v(i as f32 * 0.055, 0.09, *f, Square, 0.5, 0.2) })
            .collect(),
        _ => vec![v(0.0, 0.9, 987.77, Soft, 1.0, 0.22), v(0.085, 0.9, 1479.98, Soft, 1.0, 0.22)],
    };
    // Raro: una coda que sube una octava.
    if rare {
        let last = out.iter().map(|x| x.at).fold(0.0, f32::max);
        let top = out.iter().map(|x| x.f1.max(x.f0)).fold(0.0, f32::max).min(1800.0);
        let wave = if style == "retro" { Wave::Square } else { Wave::Bell };
        let gain = if style == "retro" { 0.4 } else { 0.35 };
        out.push(v(last + 0.14, 1.0, top * 1.5, wave, gain, 0.3));
        out.push(v(last + 0.24, 1.2, top * 2.0, wave, gain * 0.8, 0.4));
    }
    out
}

const RATE: u32 = 44_100;

fn render(voices: &[Voice]) -> Vec<f32> {
    let end = voices.iter().map(|x| x.at + x.dur).fold(0.0, f32::max);
    let mut samples = vec![0f32; (end * RATE as f32) as usize + 1];
    for x in voices {
        let s0 = (x.at * RATE as f32) as usize;
        let n = (x.dur * RATE as f32) as usize;
        let mut phase = 0f32;
        for i in 0..n.min(samples.len().saturating_sub(s0)) {
            let t = i as f32 / RATE as f32;
            let f = if x.glide > 0.0 && t < x.glide { x.f0 * (x.f1 / x.f0).powf(t / x.glide) } else { x.f1 };
            phase += std::f32::consts::TAU * f / RATE as f32;
            let env = (t / x.attack).min(1.0) * (-t / x.decay).exp() * ((x.dur - t) / 0.01).min(1.0);
            let w = match x.wave {
                Wave::Soft => phase.sin() + 0.28 * (2.0 * phase).sin() + 0.08 * (3.0 * phase).sin(),
                Wave::Bell => {
                    phase.sin()
                        + 0.45 * (2.76 * phase).sin() * (-t / 0.25).exp()
                        + 0.22 * (5.4 * phase).sin() * (-t / 0.12).exp()
                        + 0.1 * (8.93 * phase).sin() * (-t / 0.06).exp()
                }
                Wave::Triangle => std::f32::consts::FRAC_2_PI * phase.sin().asin(),
                Wave::Square => {
                    if phase.sin() >= 0.0 {
                        0.6
                    } else {
                        -0.6
                    }
                }
            };
            samples[s0 + i] += x.gain * env * w;
        }
    }
    samples
}

fn wav(samples: &[f32]) -> Vec<u8> {
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
}

/// WAV en memoria del aviso (se genera una vez por estilo; PlaySound necesita
/// que siga vivo mientras suena).
fn chime(style: &str, rare: bool) -> &'static [u8] {
    static CACHE: OnceLock<parking_lot::Mutex<HashMap<(String, bool), &'static [u8]>>> = OnceLock::new();
    let mut cache = CACHE.get_or_init(Default::default).lock();
    cache.entry((style.to_string(), rare)).or_insert_with(|| Box::leak(wav(&render(&voices(style, rare))).into_boxed_slice()))
}

pub fn play_chime(style: &str, rare: bool) {
    let wav = chime(style, rare);
    unsafe {
        let _ = PlaySoundW(PCWSTR(wav.as_ptr() as *const u16), None, SND_MEMORY | SND_ASYNC | SND_NODEFAULT);
    }
}

/// ¿La ventana tapa el monitor entero? (pantalla completa o sin bordes)
pub fn covers(hwnd: isize, r: Rect) -> bool {
    let mut w = RECT::default();
    let ok = unsafe { GetWindowRect(h(hwnd), &mut w).is_ok() };
    ok && w.left <= r.0
        && w.top <= r.1
        && w.right >= r.0 + r.2
        && w.bottom >= r.1 + r.3
}

#[cfg(test)]
mod tests {
    #[test]
    fn chimes_are_valid_wavs() {
        for style in ["steam", "playstation", "xbox", "switch", "cinema", "retro", "ejgames"] {
            for rare in [false, true] {
                let w = super::chime(style, rare);
                assert_eq!(&w[..4], b"RIFF", "{style}");
                assert_eq!(&w[8..12], b"WAVE");
                assert!(w.len() > 44 + 44_100 / 10, "{style} demasiado corto");
                assert!(w.len() < 44 + 44_100 * 2 * 3, "{style} demasiado largo");
            }
        }
    }
}
