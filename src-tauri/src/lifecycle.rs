//! Ventana principal, bandeja y modo ahorro.
//!
//! Modo ahorro: al jugar se destruye la ventana (y con ella WebView2); el
//! proceso sigue vivo (RunEvent::ExitRequested → prevent_exit) con la bandeja,
//! el tracker y Discord. Al terminar se recrea la ventana desde una tarea async
//! (crearla desde un comando síncrono bloquea en Windows).

use crate::state::AppState;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const MAIN: &str = "main";

fn allowed_nav(url: &tauri::Url) -> bool {
    let s = url.as_str();
    s.starts_with("http://tauri.localhost")
        || s.starts_with("tauri://localhost")
        || s.starts_with("http://ejg-theme.localhost")
        || s.starts_with("http://ejg-safe.localhost")
        || s.starts_with("http://ejg-media.localhost")
        || (cfg!(debug_assertions) && s.starts_with("http://localhost:1420"))
        || s == "about:blank"
}

fn build_window(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let mut b = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()));
    if let Some(dir) = crate::paths::webview_dir() {
        b = b.data_directory(dir);
    }
    b
        .title("ejGames")
        .inner_size(1440.0, 880.0)
        .min_inner_size(960.0, 580.0)
        .decorations(false)
        .shadow(true)
        .visible(visible)
        .background_color(tauri::window::Color(9, 12, 18, 255))
        .on_navigation(allowed_nav)
        .build()?;
    Ok(())
}

pub fn create_main(app: &AppHandle) -> tauri::Result<()> {
    // Oculta hasta que el host avise de que el tema está listo (sin destello).
    build_window(app, false)
}

/// Muestra (o recrea) la ventana principal.
pub fn show_main(st: &Arc<AppState>) {
    let app = st.app.clone();
    if st.saver_active.swap(false, Ordering::Relaxed) {
        leave_saver(st);
    }
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    tauri::async_runtime::spawn(async move {
        // Espera a que la etiqueta quede libre si la ventana se estaba destruyendo.
        for _ in 0..50 {
            if app.get_webview_window(MAIN).is_none() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        if app.get_webview_window(MAIN).is_none() {
            if let Err(e) = build_window(&app, false) {
                tracing::error!("recrear ventana: {e}");
            }
        }
    });
}

static FOCUS_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Sin foco durante 30 s (p. ej. jugando con el launcher minimizado): WebView2
/// libera cachés y memoria gráfica. Al recuperar el foco vuelve a lo normal.
pub fn on_focus_changed(win: &tauri::WebviewWindow, focused: bool) {
    let gen = FOCUS_GEN.fetch_add(1, Ordering::Relaxed) + 1;
    if focused {
        set_memory_target(win, false);
        return;
    }
    let win = win.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if FOCUS_GEN.load(Ordering::Relaxed) == gen {
            set_memory_target(&win, true);
        }
    });
}

#[cfg(windows)]
fn set_memory_target(win: &tauri::WebviewWindow, low: bool) {
    let _ = win.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows::core::Interface;
        if let Ok(core) = wv.controller().CoreWebView2() {
            if let Ok(w19) = core.cast::<ICoreWebView2_19>() {
                let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
                let _ = w19.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[cfg(not(windows))]
fn set_memory_target(_win: &tauri::WebviewWindow, _low: bool) {}

pub fn minimize(st: &Arc<AppState>) {
    if let Some(w) = st.app.get_webview_window(MAIN) {
        let _ = w.minimize();
    }
}

/// Cada entrada o salida del modo ahorro cambia la generación: el ajuste
/// retrasado de `enter_saver` no se aplica si entretanto se salió.
static SAVER_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn enter_saver(st: &Arc<AppState>) {
    st.saver_active.store(true, Ordering::Relaxed);
    st.meta.set_paused(true);
    st.theme_dev.stop();
    if let Some(w) = st.app.get_webview_window(MAIN) {
        let _ = w.destroy();
    }
    let gen = SAVER_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let st = st.clone();
    // Tras liberar WebView2: recortar memoria y bajar prioridad energética.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        if SAVER_GEN.load(Ordering::SeqCst) == gen && st.saver_active.load(Ordering::Relaxed) {
            // Con descargas que siguen mientras juegas, sin EcoQoS (las frenaría).
            let downloading = !st.settings.get().pause_while_playing && st.downloads.keep_alive(&st);
            if !downloading {
                set_eco(true);
            }
            trim_memory();
        }
    });
}

fn leave_saver(st: &Arc<AppState>) {
    SAVER_GEN.fetch_add(1, Ordering::SeqCst);
    set_eco(false);
    st.meta.set_paused(false);
}

#[cfg(windows)]
fn set_eco(on: bool) {
    use windows::Win32::System::Threading::{
        GetCurrentProcess, ProcessPowerThrottling, SetProcessInformation, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
    };
    let s = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask: if on { PROCESS_POWER_THROTTLING_EXECUTION_SPEED } else { 0 },
    };
    unsafe {
        let _ = SetProcessInformation(
            GetCurrentProcess(),
            ProcessPowerThrottling,
            &s as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
    }
}

#[cfg(windows)]
pub(crate) fn trim_memory() {
    use windows::Win32::System::ProcessStatus::EmptyWorkingSet;
    use windows::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let _ = EmptyWorkingSet(GetCurrentProcess());
    }
}

#[cfg(not(windows))]
fn set_eco(_on: bool) {}
#[cfg(not(windows))]
pub(crate) fn trim_memory() {}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir ejGames", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let pause = MenuItem::with_id(app, "downloads-pause", "Pausar descargas", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "downloads-resume", "Reanudar descargas", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &sep, &pause, &resume, &sep2, &quit])?;
    let mut b = TrayIconBuilder::with_id("main")
        .tooltip("ejGames")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => {
                if let Some(st) = app.try_state::<Arc<AppState>>() {
                    show_main(st.inner());
                }
            }
            "quit" => app.exit(0),
            id @ ("downloads-pause" | "downloads-resume") => {
                if let Some(st) = app.try_state::<Arc<AppState>>() {
                    let st = st.inner().clone();
                    let pause = id == "downloads-pause";
                    tauri::async_runtime::spawn(async move {
                        let r = if pause { crate::downloads::pause(&st, None).await } else { crate::downloads::resume(&st, None).await };
                        if let Err(e) = r {
                            tracing::warn!("bandeja: {e:#}");
                        }
                    });
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                if let Some(st) = tray.app_handle().try_state::<Arc<AppState>>() {
                    show_main(st.inner());
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    Ok(())
}
