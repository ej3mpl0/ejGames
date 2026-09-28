//! El trainer durante la partida: se abre solo cuando el juego ya tiene
//! ventana (sin elevar, minimizado y enseguida oculto), sus opciones se pulsan
//! desde el overlay y se cierra con el juego. ejGames lleva la cuenta de lo que
//! está activado (el trainer no lo cuenta) y la reinicia si el trainer se reinicia.

use super::keys;
use crate::db::models::Game;
use crate::launcher::tracker::{self, Target};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Margen tras aparecer la ventana del juego: los trainers buscan el proceso y
/// sus módulos, que no están hasta que el juego termina de cargar.
const START_DELAY: Duration = Duration::from_secs(8);

#[derive(Default)]
pub struct Trainers {
    rt: Mutex<Runtime>,
    pub(super) client: OnceLock<reqwest::Client>,
}

#[derive(Default)]
struct Runtime {
    game_id: Option<i64>,
    target: Option<Target>,
    /// none | idle | waiting | starting | running | stopped | error
    state: &'static str,
    message: Option<String>,
    on: BTreeSet<String>,
    pid: u32,
    /// Ventanas del trainer que ejGames ocultó (para volver a enseñarlas).
    hidden: Vec<isize>,
    visible: bool,
    elevated: bool,
    /// Cambia con cada partida o arranque: los hilos viejos se retiran.
    gen: u64,
}

/// Estado para el overlay y la ficha.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub game_id: Option<i64>,
    /// none (sin trainer) | idle (instalado, sin abrir) | waiting (esperando
    /// al juego) | starting | running | stopped (se cerró) | error
    pub state: String,
    pub message: Option<String>,
    /// Teclas de las opciones activadas.
    pub on: Vec<String>,
    /// La ventana del trainer está a la vista.
    pub visible: bool,
    /// Va como administrador (porque el juego también): ejGames no puede
    /// ocultarlo ni cerrarlo.
    pub elevated: bool,
}

fn snapshot(rt: &Runtime) -> Live {
    Live {
        game_id: rt.game_id,
        state: if rt.state.is_empty() { "none".into() } else { rt.state.into() },
        message: rt.message.clone(),
        on: rt.on.iter().cloned().collect(),
        visible: rt.visible,
        elevated: rt.elevated,
    }
}

pub fn status(st: &AppState) -> Live {
    snapshot(&st.trainers.rt.lock())
}

fn emit(st: &AppState) {
    let _ = st.app.emit("trainer:state", status(st));
}

fn set_state(st: &AppState, gen: u64, state: &'static str, message: Option<String>) -> bool {
    {
        let mut rt = st.trainers.rt.lock();
        if rt.gen != gen {
            return false;
        }
        rt.state = state;
        rt.message = message;
        if state != "running" {
            rt.on.clear();
            rt.pid = 0;
            rt.hidden.clear();
            rt.visible = false;
        }
    }
    emit(st);
    true
}

// ───────────────────────────── partida ─────────────────────────────

pub fn session_started(st: &Arc<AppState>, game: &Game, target: Target) {
    let info = super::installed(st, game.id);
    let auto = info.as_ref().map(|i| i.auto_start).unwrap_or(false);
    let state = match &info {
        None => "none",
        Some(_) if auto => "waiting",
        Some(_) => "idle",
    };
    let gen = {
        let mut rt = st.trainers.rt.lock();
        *rt = Runtime { gen: rt.gen + 1, game_id: Some(game.id), target: Some(target.clone()), state, ..Default::default() };
        rt.gen
    };
    emit(st);
    if !auto {
        return;
    }
    let st = st.clone();
    let game_id = game.id;
    let _ = std::thread::Builder::new().name("ejg-trainer-wait".into()).spawn(move || {
        // Hasta 10 min a que el juego enseñe su ventana (launchers, intros…).
        let until = Instant::now() + Duration::from_secs(600);
        while Instant::now() < until {
            if st.trainers.rt.lock().gen != gen {
                return;
            }
            if game_window(&target).is_some() {
                std::thread::sleep(START_DELAY);
                if st.trainers.rt.lock().gen != gen {
                    return;
                }
                if let Err(e) = start(&st, game_id, false) {
                    tracing::warn!("trainer: {e:#}");
                }
                return;
            }
            std::thread::sleep(Duration::from_millis(700));
        }
    });
}

pub fn session_ended(st: &Arc<AppState>, game_id: i64) {
    let (pid, elevated) = {
        let mut rt = st.trainers.rt.lock();
        if rt.game_id != Some(game_id) {
            return;
        }
        let out = (rt.pid, rt.elevated);
        *rt = Runtime { gen: rt.gen + 1, ..Default::default() };
        out
    };
    #[cfg(windows)]
    if pid != 0 && !elevated {
        let n = crate::overlay::win::terminate(&[pid]);
        tracing::info!("trainer: cerrado con el juego ({n})");
    }
    let _ = (pid, elevated);
    emit(st);
}

/// Al quitar el trainer de un juego: si está abierto, se cierra.
pub fn forget(st: &Arc<AppState>, game_id: i64) {
    let pid = {
        let mut rt = st.trainers.rt.lock();
        if rt.game_id != Some(game_id) {
            return;
        }
        let pid = rt.pid;
        rt.gen += 1;
        rt.state = "none";
        rt.message = None;
        rt.pid = 0;
        rt.on.clear();
        rt.hidden.clear();
        rt.visible = false;
        pid
    };
    #[cfg(windows)]
    if pid != 0 {
        crate::overlay::win::terminate(&[pid]);
    }
    let _ = pid;
    emit(st);
}

/// Se instaló o se quitó el trainer del juego: si es el que está en marcha,
/// el overlay se pone al día.
pub fn refresh(st: &Arc<AppState>, game_id: i64) {
    {
        let mut rt = st.trainers.rt.lock();
        if rt.game_id != Some(game_id) || rt.pid != 0 {
            return;
        }
        rt.state = if super::installed(st, game_id).is_some() { "idle" } else { "none" };
        rt.message = None;
    }
    emit(st);
}

/// Ventana del juego en marcha y su proceso.
fn game_window(target: &Target) -> Option<(isize, u32)> {
    #[cfg(windows)]
    {
        let hwnd = crate::overlay::win::find_window(&|pid| tracker::matches_pid(target, pid))?;
        Some((hwnd, crate::overlay::win::window_pid(hwnd)))
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        None
    }
}

// ───────────────────────────── abrir ─────────────────────────────

/// Abre el trainer del juego en marcha. `allow_elevation`: si el juego va como
/// administrador, pedir permiso (UAC) para abrirlo igual; sin él, se avisa.
pub fn start(st: &Arc<AppState>, game_id: i64, allow_elevation: bool) -> anyhow::Result<()> {
    let info = super::installed(st, game_id).ok_or_else(|| anyhow::anyhow!("Este juego no tiene trainer"))?;
    let (gen, target) = {
        let mut rt = st.trainers.rt.lock();
        if rt.game_id != Some(game_id) {
            anyhow::bail!("El juego no está en marcha");
        }
        if rt.pid != 0 {
            return Ok(());
        }
        rt.gen += 1;
        (rt.gen, rt.target.clone())
    };
    let exe = Path::new(&info.exe);
    if !exe.is_file() {
        let msg = "No se encuentra el trainer. Windows Defender puede haberlo puesto en cuarentena: restáuralo desde Seguridad de Windows o vuelve a instalarlo.";
        set_state(st, gen, "error", Some(msg.into()));
        anyhow::bail!(msg);
    }
    let game = target.as_ref().and_then(game_window);
    let game_elevated = game.map(|(_, pid)| crate::launcher::admin::above_us(pid)).unwrap_or(false);
    if game_elevated && !allow_elevation {
        let msg = "El juego va como administrador, así que el trainer también tiene que ir así: ábrelo desde aquí y Windows pedirá permiso.";
        set_state(st, gen, "idle", Some(msg.into()));
        anyhow::bail!(msg);
    }
    set_state(st, gen, "starting", None);
    #[cfg(windows)]
    {
        let proc = if game_elevated { spawn_elevated(exe) } else { spawn_invoker(exe) };
        let proc = match proc {
            Ok(p) => p,
            Err(e) => {
                let msg = format!("No se pudo abrir el trainer: {e:#}");
                set_state(st, gen, "error", Some(msg.clone()));
                anyhow::bail!(msg);
            }
        };
        let pid = proc.pid();
        tracing::info!("trainer: abierto «{}» (pid {pid}, elevado: {game_elevated})", info.name);
        {
            let mut rt = st.trainers.rt.lock();
            if rt.gen != gen {
                crate::overlay::win::terminate(&[pid]);
                return Ok(());
            }
            rt.state = "running";
            rt.message = None;
            rt.pid = pid;
            rt.elevated = game_elevated;
            rt.on.clear();
        }
        emit(st);
        let st = st.clone();
        let game_hwnd = game.map(|g| g.0).unwrap_or(0);
        let _ = std::thread::Builder::new().name("ejg-trainer".into()).spawn(move || watch(st, gen, proc, game_hwnd));
    }
    #[cfg(not(windows))]
    {
        let _ = (exe, game_elevated);
        set_state(st, gen, "error", Some("Solo en Windows".into()));
    }
    Ok(())
}

/// Oculta sus ventanas en cuanto salen, devuelve el foco al juego y espera a
/// que se cierre.
#[cfg(windows)]
fn watch(st: Arc<AppState>, gen: u64, proc: crate::launcher::launch::OwnedProcess, game_hwnd: isize) {
    use crate::overlay::win;
    let pid = proc.pid();
    let until = Instant::now() + Duration::from_secs(12);
    while Instant::now() < until {
        if proc.wait(150) {
            break;
        }
        let (current, user_wants_it) = {
            let rt = st.trainers.rt.lock();
            (rt.gen == gen, rt.visible)
        };
        if !current {
            return;
        }
        if user_wants_it {
            continue;
        }
        let shown: Vec<isize> = windows_of(pid).into_iter().filter(|h| win::is_visible(*h)).collect();
        if shown.is_empty() {
            continue;
        }
        let stole_focus = shown.contains(&win::foreground());
        for h in &shown {
            hide(*h);
        }
        {
            let mut rt = st.trainers.rt.lock();
            for h in shown {
                if !rt.hidden.contains(&h) {
                    rt.hidden.push(h);
                }
            }
        }
        if stole_focus && game_hwnd != 0 {
            win::force_foreground(game_hwnd);
        }
    }
    loop {
        if proc.wait(1000) {
            let code = proc.exit_code();
            tracing::info!("trainer: se ha cerrado (código {code:?})");
            set_state(&st, gen, "stopped", Some("El trainer se ha cerrado.".into()));
            return;
        }
        if st.trainers.rt.lock().gen != gen {
            return;
        }
    }
}

// ───────────────────────────── opciones ─────────────────────────────

/// Pulsa las teclas de una opción. Devuelve el estado nuevo.
pub fn trigger(st: &Arc<AppState>, keys_text: &str) -> anyhow::Result<Live> {
    let (game_id, running) = {
        let rt = st.trainers.rt.lock();
        (rt.game_id, rt.state == "running" && rt.pid != 0)
    };
    let game_id = game_id.ok_or_else(|| anyhow::anyhow!("No hay ningún juego en marcha"))?;
    if !running {
        anyhow::bail!("El trainer no está abierto");
    }
    let info = super::installed(st, game_id).ok_or_else(|| anyhow::anyhow!("Este juego no tiene trainer"))?;
    let opt = info.options.iter().find(|o| o.keys == keys_text).ok_or_else(|| anyhow::anyhow!("Esa opción no es de este trainer"))?;
    let combo = keys::parse(&opt.keys).ok_or_else(|| anyhow::anyhow!("ejGames no sabe pulsar «{}»", opt.keys))?;
    keys::press(&combo)?;
    if opt.kind != "action" {
        let mut rt = st.trainers.rt.lock();
        if !rt.on.remove(&opt.keys) {
            rt.on.insert(opt.keys.clone());
        }
    }
    emit(st);
    Ok(status(st))
}

/// Olvida lo activado (si el trainer y ejGames no coinciden).
pub fn reset_toggles(st: &AppState) -> Live {
    st.trainers.rt.lock().on.clear();
    emit(st);
    status(st)
}

/// Enseña la ventana del trainer (para escribir un valor) o la vuelve a ocultar.
pub fn show(st: &Arc<AppState>, visible: bool) -> anyhow::Result<Live> {
    let (pid, hidden) = {
        let rt = st.trainers.rt.lock();
        if rt.pid == 0 {
            anyhow::bail!("El trainer no está abierto");
        }
        (rt.pid, rt.hidden.clone())
    };
    #[cfg(windows)]
    {
        use crate::overlay::win;
        if visible {
            let mut wins: Vec<isize> = hidden.iter().copied().filter(|h| win::is_window(*h)).collect();
            if wins.is_empty() {
                wins = windows_of(pid);
            }
            // El panel del overlay tapa todo: se cierra sin devolver el foco al juego.
            crate::overlay::close_panel(st, false);
            for h in &wins {
                unhide(*h);
            }
            if let Some(h) = wins.first() {
                win::force_foreground(*h);
            }
        } else {
            let shown: Vec<isize> = windows_of(pid).into_iter().filter(|h| win::is_visible(*h)).collect();
            for h in &shown {
                hide(*h);
            }
            let mut rt = st.trainers.rt.lock();
            for h in shown {
                if !rt.hidden.contains(&h) {
                    rt.hidden.push(h);
                }
            }
        }
    }
    let _ = (pid, hidden);
    st.trainers.rt.lock().visible = visible;
    emit(st);
    Ok(status(st))
}

// ───────────────────────────── Win32 ─────────────────────────────

/// CreateProcess sin elevar (`__COMPAT_LAYER=RunAsInvoker`, aunque el exe pida
/// administrador) y minimizado sin activar, para que no le quite el foco al juego.
#[cfg(windows)]
fn spawn_invoker(exe: &Path) -> anyhow::Result<crate::launcher::launch::OwnedProcess> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{CreateProcessW, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTF_USESHOWWINDOW, STARTUPINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWMINNOACTIVE;

    let mut vars: Vec<(OsString, OsString)> =
        std::env::vars_os().filter(|(k, _)| !k.to_string_lossy().eq_ignore_ascii_case("__COMPAT_LAYER")).collect();
    vars.push(("__COMPAT_LAYER".into(), "RunAsInvoker".into()));
    vars.sort_by_key(|(k, _)| k.to_string_lossy().to_uppercase());
    let mut env: Vec<u16> = vec![];
    for (k, v) in &vars {
        env.extend(k.encode_wide());
        env.push(b'=' as u16);
        env.extend(v.encode_wide());
        env.push(0);
    }
    env.push(0);
    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let app = wide(exe.as_os_str());
    let mut quoted = OsString::from("\"");
    quoted.push(exe.as_os_str());
    quoted.push("\"");
    let mut cmd = wide(&quoted);
    let dir = wide(exe.parent().map(|p| p.as_os_str()).unwrap_or_default());
    let si = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        dwFlags: STARTF_USESHOWWINDOW,
        wShowWindow: SW_SHOWMINNOACTIVE.0 as u16,
        ..Default::default()
    };
    let mut pi = PROCESS_INFORMATION::default();
    unsafe {
        CreateProcessW(
            PCWSTR(app.as_ptr()),
            Some(PWSTR(cmd.as_mut_ptr())),
            None,
            None,
            false,
            CREATE_UNICODE_ENVIRONMENT,
            Some(env.as_ptr() as *const std::ffi::c_void),
            PCWSTR(dir.as_ptr()),
            &si,
            &mut pi,
        )?;
        let _ = CloseHandle(pi.hThread);
    }
    Ok(crate::launcher::launch::OwnedProcess(pi.hProcess))
}

/// Como administrador (pide UAC): solo si el juego también lo es.
#[cfg(windows)]
fn spawn_elevated(exe: &Path) -> anyhow::Result<crate::launcher::launch::OwnedProcess> {
    use crate::launcher::launch::{start_shown, InstallerError};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWMINNOACTIVE;
    let dir = exe.parent().map(|p| p.to_string_lossy().into_owned());
    match start_shown("runas", &exe.to_string_lossy(), "", dir.as_deref(), SW_SHOWMINNOACTIVE) {
        Ok(Some(p)) => Ok(p),
        Ok(None) => anyhow::bail!("Windows no devolvió el proceso"),
        Err(InstallerError::Cancelled) => anyhow::bail!("No se dio permiso de administrador"),
        Err(InstallerError::Other(e)) => Err(e),
    }
}

/// Ventanas principales (sin dueño) de un proceso, visibles o no.
#[cfg(windows)]
fn windows_of(pid: u32) -> Vec<isize> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindow, GetWindowThreadProcessId, GW_OWNER};
    struct Ctx {
        pid: u32,
        out: Vec<isize>,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> BOOL {
        let ctx = &mut *(lp.0 as *mut Ctx);
        let mut p = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut p));
        if p == ctx.pid && GetWindow(hwnd, GW_OWNER).map(|o| o.is_invalid()).unwrap_or(true) {
            ctx.out.push(hwnd.0 as isize);
        }
        BOOL(1)
    }
    let mut ctx = Ctx { pid, out: vec![] };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut Ctx as isize));
    }
    ctx.out
}

#[cfg(windows)]
fn hide(hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
    unsafe {
        let _ = ShowWindow(HWND(hwnd as _), SW_HIDE);
    }
}

#[cfg(windows)]
fn unhide(hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_RESTORE, SW_SHOW};
    unsafe {
        let _ = ShowWindow(HWND(hwnd as _), SW_SHOW);
        let _ = ShowWindow(HWND(hwnd as _), SW_RESTORE);
    }
}
