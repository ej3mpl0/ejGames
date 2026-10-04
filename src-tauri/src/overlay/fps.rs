//! FPS del juego sin inyectar nada: se escuchan los eventos «Present» que
//! Windows ya emite (ETW, como PresentMon) y se cuentan por proceso.
//!
//! Cubre los juegos que presentan por DXGI (Direct3D 10/11/12) y Direct3D 9.
//! Vulkan y OpenGL no pasan por ahí: sin datos, el panel lo dice.
//!
//! Escuchar ETW pide ser administrador o estar en el grupo «Usuarios del
//! registro de rendimiento»; `grant_access` mete al usuario en ese grupo una vez
//! (con el aviso de permisos de Windows) y desde el siguiente inicio de sesión
//! funciona sin administrador.

use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FpsStats {
    /// Fotogramas por segundo (último segundo).
    pub fps: f32,
    /// Media de los fotogramas más lentos (el 1 %), en FPS.
    pub low1: f32,
    /// Tiempo medio por fotograma, en ms.
    pub frametime: f32,
}

const SEC: i64 = 10_000_000; // 100 ns

/// FPS, 1 % bajo y tiempo de fotograma a partir de las marcas de tiempo (100 ns)
/// de cada Present, ordenadas. `now` es la hora actual en las mismas unidades.
/// Sin fotogramas en los últimos 3 s (juego en pausa o cargando) no hay datos.
pub fn stats(ts: &[i64], now: i64) -> Option<FpsStats> {
    let newest = *ts.last()?;
    if now - newest > 3 * SEC {
        return None;
    }
    let in_last = |from: i64| ts.iter().filter(|t| **t > newest - from).count();
    let fps = in_last(SEC) as f32;
    // Duraciones de los últimos 10 s, sin las pausas largas.
    let from = newest - 10 * SEC;
    let diffs: Vec<i64> = ts.windows(2).filter(|w| w[1] > from).map(|w| w[1] - w[0]).filter(|d| *d > 0 && *d < SEC).collect();
    if diffs.len() < 2 {
        return None;
    }
    let last_sec: Vec<i64> = ts.windows(2).filter(|w| w[1] > newest - SEC).map(|w| w[1] - w[0]).filter(|d| *d > 0 && *d < SEC).collect();
    let avg_ms = |v: &[i64]| v.iter().sum::<i64>() as f32 / v.len().max(1) as f32 / 10_000.0;
    let frametime = if last_sec.is_empty() { avg_ms(&diffs) } else { avg_ms(&last_sec) };
    let mut worst = diffs.clone();
    worst.sort_unstable_by(|a, b| b.cmp(a));
    let n = (worst.len() / 100).max(1);
    let low1 = 1000.0 / avg_ms(&worst[..n]).max(0.001);
    Some(FpsStats { fps, low1: low1.min(fps), frametime })
}

/// De varios procesos del juego (lanzador, ayudantes…), el que más presenta.
fn best(frames: &HashMap<u32, VecDeque<i64>>, now: i64) -> Option<FpsStats> {
    frames
        .values()
        .filter_map(|q| stats(&q.iter().copied().collect::<Vec<_>>(), now))
        .max_by(|a, b| a.fps.partial_cmp(&b.fps).unwrap_or(std::cmp::Ordering::Equal))
}

#[cfg(windows)]
pub use win::{grant_access, snapshot, start, status, stop};

#[cfg(not(windows))]
pub fn snapshot() -> Option<FpsStats> {
    None
}

#[allow(dead_code)]
type Pids = HashSet<u32>;

#[cfg(windows)]
mod win {
    use super::*;
    use crate::launcher::tracker::{self, Target};
    use parking_lot::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use windows::core::{GUID, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, ERROR_SUCCESS};
    use windows::Win32::System::Diagnostics::Etw::*;
    use windows::Win32::System::SystemInformation::GetSystemTimeAsFileTime;

    // Microsoft-Windows-DXGI y Microsoft-Windows-D3D9.
    const DXGI: GUID = GUID::from_u128(0xCA11C036_0102_4A2D_A6AD_F03CFED5D3C9);
    const D3D9: GUID = GUID::from_u128(0x783ACA0A_790E_4D7F_8451_AA850511C6B9);
    const DXGI_PRESENT_START: u16 = 42;
    const D3D9_PRESENT_START: u16 = 1;

    const OFF: u8 = 0;
    const ON: u8 = 1;
    const DENIED: u8 = 2;
    const FAILED: u8 = 3;

    static STATE: AtomicU8 = AtomicU8::new(OFF);
    static PIDS: Mutex<Option<Pids>> = Mutex::new(None);
    static FRAMES: Mutex<Option<HashMap<u32, VecDeque<i64>>>> = Mutex::new(None);
    static SESSION: Mutex<Option<Session>> = Mutex::new(None);
    static HANDLE: AtomicU64 = AtomicU64::new(0);

    struct Session {
        stop: Arc<AtomicBool>,
        name: Vec<u16>,
    }

    #[repr(C)]
    struct Props {
        p: EVENT_TRACE_PROPERTIES,
        name: [u16; 64],
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn props(name: &[u16]) -> Box<Props> {
        // SAFETY: EVENT_TRACE_PROPERTIES es una estructura de números; todo a cero es válido.
        let mut b: Box<Props> = Box::new(unsafe { std::mem::zeroed() });
        b.p.Wnode.BufferSize = std::mem::size_of::<Props>() as u32;
        b.p.Wnode.Flags = WNODE_FLAG_TRACED_GUID;
        b.p.Wnode.ClientContext = 1; // QPC
        b.p.BufferSize = 64;
        b.p.MinimumBuffers = 2;
        b.p.MaximumBuffers = 8;
        b.p.LogFileMode = EVENT_TRACE_REAL_TIME_MODE;
        b.p.FlushTimer = 1;
        b.p.LoggerNameOffset = std::mem::size_of::<EVENT_TRACE_PROPERTIES>() as u32;
        for (i, c) in name.iter().take(63).enumerate() {
            b.name[i] = *c;
        }
        b
    }

    unsafe extern "system" fn on_event(rec: *mut EVENT_RECORD) {
        let r = &*rec;
        let id = r.EventHeader.EventDescriptor.Id;
        let prov = r.EventHeader.ProviderId;
        let present = (prov == DXGI && id == DXGI_PRESENT_START) || (prov == D3D9 && id == D3D9_PRESENT_START);
        if !present {
            return;
        }
        let pid = r.EventHeader.ProcessId;
        if !PIDS.lock().as_ref().is_some_and(|p| p.contains(&pid)) {
            return;
        }
        let ts = r.EventHeader.TimeStamp;
        let mut g = FRAMES.lock();
        let q = g.get_or_insert_with(HashMap::new).entry(pid).or_default();
        q.push_back(ts);
        while q.front().is_some_and(|t| ts - *t > 12 * SEC) {
            q.pop_front();
        }
    }

    fn now_ft() -> i64 {
        let ft = unsafe { GetSystemTimeAsFileTime() };
        ((ft.dwHighDateTime as i64) << 32) | ft.dwLowDateTime as i64
    }

    /// 0 = apagado · 1 = midiendo · 2 = sin permiso · 3 = error.
    pub fn status() -> &'static str {
        match STATE.load(Ordering::Relaxed) {
            ON => "on",
            DENIED => "denied",
            FAILED => "error",
            _ => "off",
        }
    }

    pub fn snapshot() -> Option<FpsStats> {
        best(FRAMES.lock().as_ref()?, now_ft())
    }

    /// Empieza a medir los procesos de `target`.
    pub fn start(target: Target) {
        stop();
        let name = wide(&format!("ejGames-FPS-{}", std::process::id()));
        let stop_flag = Arc::new(AtomicBool::new(false));
        *PIDS.lock() = Some(HashSet::new());
        *FRAMES.lock() = Some(HashMap::new());
        let (tx, rx) = std::sync::mpsc::channel::<u8>();
        let (n2, flag2) = (name.clone(), stop_flag.clone());
        let _ = std::thread::Builder::new().name("ejg-fps".into()).spawn(move || run(n2, flag2, tx));
        // El resultado del arranque (permisos…) llega en milisegundos.
        let state = rx.recv_timeout(Duration::from_secs(3)).unwrap_or(FAILED);
        STATE.store(state, Ordering::Relaxed);
        if state != ON {
            stop_flag.store(true, Ordering::Relaxed);
            return;
        }
        // Qué procesos son del juego: se vuelve a mirar cada pocos segundos.
        let flag3 = stop_flag.clone();
        let _ = std::thread::Builder::new().name("ejg-fps-pids".into()).spawn(move || {
            let mut cache = HashMap::new();
            while !flag3.load(Ordering::Relaxed) {
                let pids: Pids = tracker::find_pids(&target, &mut cache).into_iter().collect();
                *PIDS.lock() = Some(pids);
                for _ in 0..6 {
                    if flag3.load(Ordering::Relaxed) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        });
        *SESSION.lock() = Some(Session { stop: stop_flag, name });
    }

    fn run(name: Vec<u16>, stop_flag: Arc<AtomicBool>, tx: std::sync::mpsc::Sender<u8>) {
        unsafe {
            let mut handle = CONTROLTRACE_HANDLE::default();
            let mut p = props(&name);
            let mut err = StartTraceW(&mut handle, PCWSTR(name.as_ptr()), &mut p.p);
            if err == ERROR_ALREADY_EXISTS {
                // Una sesión vieja con el mismo nombre (ejGames se cayó): se cierra y se reintenta.
                let mut old = props(&name);
                let _ = ControlTraceW(CONTROLTRACE_HANDLE::default(), PCWSTR(name.as_ptr()), &mut old.p, EVENT_TRACE_CONTROL_STOP);
                p = props(&name);
                err = StartTraceW(&mut handle, PCWSTR(name.as_ptr()), &mut p.p);
            }
            if err != ERROR_SUCCESS {
                tracing::info!("fps: no se pudo abrir la sesión de eventos ({})", err.0);
                let _ = tx.send(if err == ERROR_ACCESS_DENIED { DENIED } else { FAILED });
                return;
            }
            HANDLE.store(handle.Value, Ordering::SeqCst);
            for g in [&DXGI, &D3D9] {
                let e = EnableTraceEx2(handle, g, EVENT_CONTROL_CODE_ENABLE_PROVIDER.0, TRACE_LEVEL_VERBOSE as u8, 0, 0, 0, None);
                if e != ERROR_SUCCESS {
                    tracing::info!("fps: no se pudo activar un proveedor ({})", e.0);
                }
            }
            let mut log: EVENT_TRACE_LOGFILEW = std::mem::zeroed();
            let mut logger = name.clone();
            log.LoggerName = PWSTR(logger.as_mut_ptr());
            log.Anonymous1.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
            log.Anonymous2.EventRecordCallback = Some(on_event);
            let trace = OpenTraceW(&mut log);
            if trace.Value == u64::MAX {
                tracing::info!("fps: no se pudo abrir el consumidor de eventos");
                let _ = ControlTraceW(handle, PCWSTR(name.as_ptr()), &mut p.p, EVENT_TRACE_CONTROL_STOP);
                let _ = tx.send(FAILED);
                return;
            }
            let _ = tx.send(ON);
            tracing::info!("fps: midiendo");
            // Bloquea hasta que `stop` cierra la sesión.
            let _ = ProcessTrace(&[trace], None, None);
            let _ = CloseTrace(trace);
            let mut q = props(&name);
            let _ = ControlTraceW(CONTROLTRACE_HANDLE { Value: handle.Value }, PCWSTR(name.as_ptr()), &mut q.p, EVENT_TRACE_CONTROL_STOP);
            let _ = stop_flag;
        }
    }

    pub fn stop() {
        let Some(s) = SESSION.lock().take() else {
            STATE.store(OFF, Ordering::Relaxed);
            return;
        };
        s.stop.store(true, Ordering::Relaxed);
        unsafe {
            let mut q = props(&s.name);
            let h = CONTROLTRACE_HANDLE { Value: HANDLE.swap(0, Ordering::SeqCst) };
            let _ = ControlTraceW(h, PCWSTR(s.name.as_ptr()), &mut q.p, EVENT_TRACE_CONTROL_STOP);
        }
        STATE.store(OFF, Ordering::Relaxed);
        *FRAMES.lock() = None;
        *PIDS.lock() = None;
    }

    /// Mete al usuario en «Usuarios del registro de rendimiento» (por SID, valga
    /// el idioma de Windows). Pide permisos una vez; surte efecto al volver a
    /// iniciar sesión.
    pub fn grant_access() -> anyhow::Result<()> {
        use crate::launcher::launch::{start_installer, InstallerError};
        let user = format!("{}\\{}", std::env::var("USERDOMAIN").unwrap_or_default(), std::env::var("USERNAME").unwrap_or_default());
        let args = format!(
            "-NoProfile -WindowStyle Hidden -Command \"Add-LocalGroupMember -SID S-1-5-32-559 -Member '{}'\"",
            user.replace('\'', "''")
        );
        match start_installer("runas", "powershell.exe", &args, None) {
            Ok(Some(p)) => {
                p.wait(30_000);
                Ok(())
            }
            Ok(None) => Ok(()),
            Err(InstallerError::Cancelled) => anyhow::bail!("{}", crate::i18n::t("Has cancelado el permiso de Windows")),
            Err(InstallerError::Other(e)) => Err(e),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// Con permisos (administrador o el grupo), la sesión arranca y se cierra.
        /// Sin ellos, falla con «denied»; las dos cosas son válidas aquí.
        #[test]
        fn session_starts_or_is_denied() {
            start(Target { install_dir: None, exe_names: vec!["msedge.exe".into()], launched_pid: None });
            let s = status();
            println!("estado de la sesión ETW: {s}");
            assert!(s == "on" || s == "denied", "estado: {s}");
            stop();
            assert_eq!(status(), "off");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames(fps: i64, secs: i64) -> Vec<i64> {
        (0..fps * secs).map(|i| 1_000_000_000 + i * SEC / fps).collect()
    }

    #[test]
    fn steady_60fps() {
        let ts = frames(60, 10);
        let now = *ts.last().unwrap() + SEC / 10;
        let s = stats(&ts, now).unwrap();
        assert!((s.fps - 60.0).abs() <= 1.0, "{s:?}");
        assert!((s.frametime - 16.67).abs() < 0.5, "{s:?}");
        assert!((s.low1 - 60.0).abs() < 1.0, "{s:?}");
    }

    #[test]
    fn stutters_lower_the_one_percent() {
        let mut ts = frames(60, 10);
        // Un tirón de 100 ms cada 100 fotogramas.
        let mut shift = 0;
        for (i, t) in ts.iter_mut().enumerate() {
            if i % 100 == 99 {
                shift += SEC / 10;
            }
            *t += shift;
        }
        let now = *ts.last().unwrap() + SEC / 10;
        let s = stats(&ts, now).unwrap();
        assert!(s.low1 < 15.0, "{s:?}");
        assert!(s.fps > 40.0, "{s:?}");
    }

    #[test]
    fn paused_game_has_no_data() {
        let ts = frames(60, 5);
        assert!(stats(&ts, *ts.last().unwrap() + 5 * SEC).is_none());
        assert!(stats(&[], 0).is_none());
        assert!(stats(&[1], 1).is_none());
    }

    #[test]
    fn best_process_wins() {
        let mut m = HashMap::new();
        m.insert(1, frames(10, 5).into_iter().collect::<VecDeque<_>>());
        m.insert(2, frames(60, 5).into_iter().collect::<VecDeque<_>>());
        let now = frames(60, 5).last().copied().unwrap() + SEC / 10;
        assert!((best(&m, now).unwrap().fps - 60.0).abs() <= 1.0);
    }
}
