//! Seguimiento de la partida: localiza los procesos del juego (exe bajo el
//! directorio de instalación o pistas por nombre) y luego espera en sus handles
//! sin sondear. Cuando todos terminan se mira enseguida si el juego sigue en
//! otro proceso (lanzador → juego); si no, la partida acaba ya, y quien llama
//! vigila un rato por si el juego se vuelve a abrir solo (`reappears`).

use crate::db::models::Game;
use crate::util::{is_under, now};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct Target {
    pub install_dir: Option<PathBuf>,
    pub exe_names: Vec<String>,
    pub launched_pid: Option<u32>,
}

impl Target {
    pub fn from_game(g: &Game, pid: Option<u32>) -> Self {
        let mut names: Vec<String> = g.process_hints.iter().map(|h| h.to_ascii_lowercase()).collect();
        if let Some(exe) = g.exe_path.as_deref().and_then(|e| Path::new(e).file_name()) {
            let n = exe.to_string_lossy().to_ascii_lowercase();
            if !names.contains(&n) {
                names.push(n);
            }
        }
        Target {
            install_dir: g.install_dir.as_ref().map(PathBuf::from).filter(|d| safe_install_dir(d)),
            exe_names: names,
            launched_pid: pid,
        }
    }
}

/// ¿Se puede usar esta carpeta para reconocer procesos del juego? Nunca raíces
/// de disco ni carpetas del sistema (ahí coincidiría casi cualquier proceso).
pub(crate) fn safe_install_dir(d: &Path) -> bool {
    if d.components().count() <= 2 {
        return false;
    }
    let n = crate::util::norm_path(d);
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    let blocked = [
        crate::util::norm_path(Path::new(&windir)),
        "c:\\program files".into(),
        "c:\\program files (x86)".into(),
        "c:\\programdata".into(),
        "c:\\users".into(),
    ];
    if blocked.contains(&n) || is_under(d, Path::new(&windir)) {
        return false;
    }
    if let Some(home) = dirs::home_dir() {
        let h = crate::util::norm_path(&home);
        if n == h || n == format!("{h}\\desktop") || n == format!("{h}\\downloads") || n == format!("{h}\\documents") {
            return false;
        }
    }
    true
}

#[derive(Debug)]
pub enum Outcome {
    /// (inicio, fin) en segundos Unix.
    Played(i64, i64),
    NeverStarted,
    Cancelled(Option<(i64, i64)>),
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_FAILED, WAIT_TIMEOUT};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, WaitForMultipleObjects, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    };

    pub struct Proc {
        pub pid: u32,
        pub name: String,
    }

    pub fn snapshot() -> Vec<Proc> {
        let mut out = vec![];
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
            let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if Process32FirstW(snap, &mut e).is_ok() {
                loop {
                    let len = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(e.szExeFile.len());
                    out.push(Proc { pid: e.th32ProcessID, name: String::from_utf16_lossy(&e.szExeFile[..len]).to_ascii_lowercase() });
                    if Process32NextW(snap, &mut e).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        out
    }

    pub fn image_path(pid: u32) -> Option<PathBuf> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(h);
            ok.then(|| PathBuf::from(String::from_utf16_lossy(&buf[..len as usize])))
        }
    }

    pub struct Handles(pub Vec<HANDLE>);
    impl Drop for Handles {
        fn drop(&mut self) {
            for h in &self.0 {
                unsafe {
                    let _ = CloseHandle(*h);
                }
            }
        }
    }

    pub fn open_waitable(pids: &[u32]) -> Handles {
        Handles(
            pids.iter()
                .filter_map(|p| unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, *p).ok() })
                .take(63)
                .collect(),
        )
    }

    /// Espera a que terminen todos (true) o vence el timeout (false).
    pub fn wait_all(h: &Handles, timeout_ms: u32) -> bool {
        if h.0.is_empty() {
            return true;
        }
        let r = unsafe { WaitForMultipleObjects(&h.0, true, timeout_ms) };
        r != WAIT_TIMEOUT && r != WAIT_FAILED
    }
}

/// ¿Es este proceso del juego? (para el atajo del overlay).
pub fn matches_pid(t: &Target, pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    if t.launched_pid == Some(pid) {
        return true;
    }
    #[cfg(windows)]
    {
        if let Some(path) = win::image_path(pid) {
            let name = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            return t.exe_names.contains(&name) || t.install_dir.as_ref().map(|d| is_under(&path, d)).unwrap_or(false);
        }
        // Proceso protegido (anticheat): solo el nombre.
        win::snapshot().iter().any(|p| p.pid == pid && t.exe_names.contains(&p.name))
    }
    #[cfg(not(windows))]
    false
}

/// Programas que viven en la carpeta del juego pero no son el juego: no
/// alargan la partida (el informe de errores se queda abierto tras un cierre).
fn is_helper(name: &str) -> bool {
    ["crash", "bugsplat", "unins", "redist", "dxsetup", "werfault"].iter().any(|h| name.contains(h))
}

/// Encuentra los PIDs del juego. Cachea rutas por PID para no reabrir procesos.
pub(crate) fn find_pids(t: &Target, cache: &mut HashMap<u32, (String, Option<PathBuf>)>) -> Vec<u32> {
    #[cfg(windows)]
    {
        let procs = win::snapshot();
        let mut out = vec![];
        let alive: std::collections::HashSet<u32> = procs.iter().map(|p| p.pid).collect();
        cache.retain(|pid, _| alive.contains(pid));
        for p in procs {
            if p.pid <= 4 {
                continue;
            }
            if t.launched_pid == Some(p.pid) {
                out.push(p.pid);
                continue;
            }
            let entry = cache.entry(p.pid).or_insert_with(|| (p.name.clone(), None));
            if entry.0 != p.name {
                *entry = (p.name.clone(), None); // PID reutilizado
            }
            let by_name = t.exe_names.contains(&p.name);
            let by_dir = !is_helper(&p.name) && match &t.install_dir {
                Some(dir) => {
                    if entry.1.is_none() {
                        entry.1 = win::image_path(p.pid);
                    }
                    // Sin ruta (anticheat protegido): solo cuenta el nombre.
                    entry.1.as_ref().map(|path| is_under(path, dir)).unwrap_or(false)
                }
                None => false,
            };
            if by_name || by_dir {
                out.push(p.pid);
            }
        }
        out
    }
    #[cfg(not(windows))]
    {
        let _ = (t, cache);
        vec![]
    }
}

/// Bucle completo de una partida. Bloqueante: se ejecuta en su propio hilo.
/// `cancel` se consulta en cada espera (máx. cada 1 s).
pub fn run(t: Target, discovery: Duration, cancel: &std::sync::atomic::AtomicBool, on_start: impl Fn(i64)) -> Outcome {
    use std::sync::atomic::Ordering;
    let mut cache = HashMap::new();
    let begin = Instant::now();

    // 1) Descubrimiento.
    let mut pids;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Outcome::Cancelled(None);
        }
        pids = find_pids(&t, &mut cache);
        if !pids.is_empty() {
            break;
        }
        if begin.elapsed() > discovery {
            return Outcome::NeverStarted;
        }
        std::thread::sleep(Duration::from_millis(2500));
    }
    let started = now();
    on_start(started);

    // 2) Esperar en handles. Al terminar todos, el juego puede seguir en otro
    // proceso que no estaba al principio (lanzador → juego): se mira enseguida
    // y otra vez al poco por si tarda un instante en aparecer.
    loop {
        #[cfg(windows)]
        {
            let handles = win::open_waitable(&pids);
            if handles.0.is_empty() {
                // Sin permiso para esperar (anticheat): sondeo lento por nombre.
                while !find_pids(&t, &mut cache).is_empty() {
                    if cancel.load(Ordering::Relaxed) {
                        return Outcome::Cancelled(Some((started, now())));
                    }
                    std::thread::sleep(Duration::from_secs(5));
                }
            } else {
                while !win::wait_all(&handles, 1000) {
                    if cancel.load(Ordering::Relaxed) {
                        return Outcome::Cancelled(Some((started, now())));
                    }
                }
            }
        }
        #[cfg(not(windows))]
        std::thread::sleep(Duration::from_secs(5));

        let ended = now();
        let mut again = find_pids(&t, &mut cache);
        if again.is_empty() {
            std::thread::sleep(Duration::from_millis(1500));
            again = find_pids(&t, &mut cache);
        }
        if again.is_empty() {
            return Outcome::Played(started, ended);
        }
        pids = again;
    }
}

/// Tras una partida: ¿vuelve a abrirse el juego solo en `within`? (se reinicia
/// para aplicar ajustes, un lanzador que abre el juego después de cerrarse…)
/// `abort` corta la espera; `tick` recibe el tiempo transcurrido.
pub fn reappears(t: &Target, within: Duration, abort: impl Fn() -> bool, mut tick: impl FnMut(Duration)) -> bool {
    let mut cache = HashMap::new();
    // El PID del lanzamiento ya no es del juego (Windows puede reutilizarlo).
    let t = Target { launched_pid: None, ..t.clone() };
    let begin = Instant::now();
    while begin.elapsed() < within {
        std::thread::sleep(Duration::from_millis(1500));
        if abort() {
            return false;
        }
        if !find_pids(&t, &mut cache).is_empty() {
            return true;
        }
        tick(begin.elapsed());
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers_do_not_extend_the_session() {
        assert!(is_helper("crashreportclient.exe"));
        assert!(is_helper("unitycrashhandler64.exe"));
        assert!(is_helper("unins000.exe"));
        assert!(!is_helper("controlresonant.exe"));
        assert!(!is_helper("launcher.exe"));
    }
}
