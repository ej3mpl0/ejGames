//! Windows: espacio libre, no suspender mientras descarga y las claves de
//! desinstalación (para saber dónde instaló el juego un instalador).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Bytes libres en la unidad de `path` (sube hasta la primera carpeta que exista).
pub fn disk_free(path: &Path) -> Option<u64> {
    let mut p: PathBuf = path.to_path_buf();
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
        Some(free)
    }
    #[cfg(not(windows))]
    {
        let _ = p;
        None
    }
}

/// Avisa a Windows de que hay trabajo: evita la suspensión por inactividad
/// (hay que repetirlo; sin ES_CONTINUOUS vale desde cualquier hilo).
pub fn keep_awake() {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::Power::{SetThreadExecutionState, ES_SYSTEM_REQUIRED};
        SetThreadExecutionState(ES_SYSTEM_REQUIRED);
    }
}

/// Clave de desinstalación → carpeta de instalación.
pub type UninstallSnapshot = HashMap<String, String>;

/// Entradas de desinstalación de HKCU y HKLM (64 y 32 bits) con su carpeta.
pub fn uninstall_snapshot() -> UninstallSnapshot {
    let mut out = HashMap::new();
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
        use winreg::RegKey;
        const PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
        let roots = [
            ("HKCU", RegKey::predef(HKEY_CURRENT_USER), KEY_READ),
            ("HKLM64", RegKey::predef(HKEY_LOCAL_MACHINE), KEY_READ | KEY_WOW64_64KEY),
            ("HKLM32", RegKey::predef(HKEY_LOCAL_MACHINE), KEY_READ | KEY_WOW64_32KEY),
        ];
        for (tag, root, flags) in roots {
            let Ok(key) = root.open_subkey_with_flags(PATH, flags) else { continue };
            for name in key.enum_keys().flatten() {
                let Ok(sub) = key.open_subkey_with_flags(&name, flags) else { continue };
                let dir: String = sub
                    .get_value("InstallLocation")
                    .or_else(|_| sub.get_value("Inno Setup: App Path"))
                    .unwrap_or_default();
                if !dir.trim().is_empty() {
                    out.insert(format!("{tag}\\{name}"), dir.trim().trim_matches('"').to_string());
                }
            }
        }
    }
    out
}

/// Carpetas de instalación nuevas o cambiadas entre dos fotos del registro
/// (las de Inno Setup, `*_is1`, primero).
pub fn new_install_dirs(before: &UninstallSnapshot, after: &UninstallSnapshot) -> Vec<String> {
    let mut found: Vec<(bool, String)> = after
        .iter()
        .filter(|(k, v)| before.get(*k) != Some(*v))
        .map(|(k, v)| (k.ends_with("_is1"), v.clone()))
        .filter(|(_, v)| Path::new(v).is_dir())
        .collect();
    found.sort_by_key(|(inno, _)| !inno);
    found.into_iter().map(|(_, v)| v).collect()
}
