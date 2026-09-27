#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Instalador de ejGames: una ventana propia (HTML/CSS en ../ui) que instala en
//! silencio el paquete NSIS de siempre, que lleva dentro. El NSIS sigue siendo
//! el de las actualizaciones automáticas y el desinstalador; esto es solo la
//! cara de la primera instalación.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::Emitter;

static PAYLOAD: &[u8] = include_bytes!(env!("EJG_PAYLOAD_PATH"));
const VERSION: &str = env!("EJG_VERSION");
const INSTALLED_BYTES: &str = env!("EJG_INSTALLED_BYTES");
/// Clave que escribe el instalador NSIS de Tauri (instalación por usuario).
const UNINST_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ejGames";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    version: String,
    installed_version: Option<String>,
    install_dir: String,
    required_bytes: u64,
    free_bytes: Option<u64>,
    has_payload: bool,
}

fn required_bytes() -> u64 {
    INSTALLED_BYTES.parse().unwrap_or(60_000_000)
}

/// Versión y carpeta de una instalación anterior.
fn existing() -> Option<(String, String)> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        let key = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey(UNINST_KEY).ok()?;
        let version: String = key.get_value("DisplayVersion").ok()?;
        let dir: String = key.get_value("InstallLocation").unwrap_or_default();
        let dir = dir.trim().trim_matches('"').to_string();
        return Some((version, dir));
    }
    #[allow(unreachable_code)]
    None
}

fn default_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("ejGames")
}

fn disk_free(path: &Path) -> Option<u64> {
    let mut p = path.to_path_buf();
    while !p.exists() {
        p = p.parent()?.to_path_buf();
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let w: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut free = 0u64;
        unsafe { GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), None, None).ok()? };
        return Some(free);
    }
    #[allow(unreachable_code)]
    None
}

#[tauri::command]
fn info() -> Info {
    let old = existing();
    let dir = old
        .as_ref()
        .map(|(_, d)| d.clone())
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| default_dir().to_string_lossy().into_owned());
    Info {
        version: VERSION.into(),
        installed_version: old.map(|(v, _)| v),
        free_bytes: disk_free(Path::new(&dir)),
        install_dir: dir,
        required_bytes: required_bytes(),
        has_payload: !PAYLOAD.is_empty(),
    }
}

#[tauri::command]
fn free_space(path: String) -> Option<u64> {
    disk_free(Path::new(&path))
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            match e.metadata() {
                Ok(m) if m.is_dir() => stack.push(e.path()),
                Ok(m) => total += m.len(),
                _ => {}
            }
        }
    }
    total
}

/// Instala en `dir`. Emite `progress` (0..1) mientras tanto.
#[tauri::command]
async fn install(app: tauri::AppHandle, dir: String, desktop: bool) -> Result<(), String> {
    let dir = dir.trim().trim_end_matches(['\\', '/']).to_string();
    let target = PathBuf::from(&dir);
    if PAYLOAD.is_empty() {
        return Err("Este instalador no lleva el paquete de ejGames.".into());
    }
    if !target.is_absolute() || dir.contains('"') || target.parent().is_none() {
        return Err("Elige otra carpeta.".into());
    }
    tauri::async_runtime::spawn_blocking(move || run(app, target, desktop))
        .await
        .map_err(|e| e.to_string())?
}

fn run(app: tauri::AppHandle, target: PathBuf, desktop: bool) -> Result<(), String> {
    let tmp = std::env::temp_dir().join("ejgames-installer");
    std::fs::create_dir_all(&tmp).map_err(|e| format!("No se pudo preparar la instalación: {e}"))?;
    let setup = tmp.join(format!("ejGames_{VERSION}_setup.exe"));
    std::fs::write(&setup, PAYLOAD).map_err(|e| format!("No se pudo preparar la instalación: {e}"))?;

    let shortcut = dirs::desktop_dir().map(|d| d.join("ejGames.lnk"));
    let had_shortcut = shortcut.as_ref().map(|s| s.exists()).unwrap_or(false);
    let base = if target.exists() { dir_size(&target) } else { 0 };

    // NSIS en silencio: /D va la última y sin comillas aunque tenga espacios.
    let mut cmd = std::process::Command::new(&setup);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.raw_arg(format!("/S /D={}", target.display()));
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("No se pudo abrir el instalador: {e}"))?;

    // Progreso: lo copiado frente a lo que ocupa (si es una instalación nueva)
    // y, como mínimo, una curva por tiempo (al actualizar se sobrescribe).
    let start = Instant::now();
    let total = required_bytes().max(1) as f64;
    let code = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status.code().unwrap_or(-1);
        }
        let t = start.elapsed().as_secs_f64();
        let by_time = 0.92 * (1.0 - (-t / 3.5).exp());
        let copied = dir_size(&target).saturating_sub(base) as f64;
        let by_size = (copied / total).min(0.95);
        let _ = app.emit("progress", by_time.max(by_size));
        std::thread::sleep(Duration::from_millis(180));
    };
    let _ = std::fs::remove_file(&setup);

    if code != 0 {
        return Err(match code {
            1 | 2 => "La instalación se canceló. Si ejGames estaba abierto, ciérralo y vuelve a intentarlo.".to_string(),
            c => format!("El instalador terminó con un error (código {c})."),
        });
    }
    if !target.join("ejgames.exe").exists() {
        return Err("No se encuentra ejGames en la carpeta de instalación.".into());
    }
    // El NSIS en silencio siempre crea el acceso del escritorio.
    if !desktop && !had_shortcut {
        if let Some(s) = shortcut {
            let _ = std::fs::remove_file(s);
        }
    }
    let _ = app.emit("progress", 1.0);
    Ok(())
}

#[tauri::command]
fn launch(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let dir = PathBuf::from(dir.trim());
    std::process::Command::new(dir.join("ejgames.exe"))
        .current_dir(&dir)
        .spawn()
        .map_err(|e| format!("No se pudo abrir ejGames: {e}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Sin WebView2 no hay ventana propia: se abre el instalador de siempre, que
/// sabe instalarlo.
fn fallback() -> bool {
    if tauri::webview_version().is_ok() || PAYLOAD.is_empty() {
        return false;
    }
    let setup = std::env::temp_dir().join(format!("ejGames_{VERSION}_setup.exe"));
    if std::fs::write(&setup, PAYLOAD).is_ok() {
        let _ = std::process::Command::new(&setup).spawn();
    }
    true
}

fn main() {
    if fallback() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![info, free_space, install, launch, quit])
        .run(tauri::generate_context!())
        .expect("error al abrir el instalador");
}
