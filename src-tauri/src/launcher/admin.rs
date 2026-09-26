//! «Ejecutar como administrador». Muchos repacks marcan el exe con esa opción
//! de compatibilidad de Windows (`AppCompatFlags\Layers` en el registro). Un
//! juego elevado pide UAC al lanzarlo y, además, Windows (UIPI) no deja que un
//! programa normal lea el teclado mientras ese juego está delante: el atajo del
//! overlay no llegaría nunca. Si en ejGames no se pidió administrador, se lanza
//! con `__COMPAT_LAYER=…RunAsInvoker`, que anula esa marca y conserva las demás.

use std::path::Path;

fn is_admin_layer(l: &str) -> bool {
    l.eq_ignore_ascii_case("RUNASADMIN") || l.eq_ignore_ascii_case("RUNASHIGHEST")
}

/// Valor de `__COMPAT_LAYER` a partir de las capas del registro: las demás
/// (p. ej. desactivar las optimizaciones de pantalla completa) + RunAsInvoker.
/// None si ninguna pide administrador.
fn invoker_value(values: &[String]) -> Option<String> {
    let layers: Vec<&str> = values.iter().flat_map(|v| v.split_whitespace()).collect();
    if !layers.iter().any(|l| is_admin_layer(l)) {
        return None;
    }
    let mut keep: Vec<&str> = vec![];
    for l in layers {
        // "~" y similares son marcas del registro, no capas.
        let marker = !l.starts_with(|c: char| c.is_ascii_alphanumeric());
        if marker || is_admin_layer(l) || l.eq_ignore_ascii_case("RunAsInvoker") || keep.iter().any(|k| k.eq_ignore_ascii_case(l)) {
            continue;
        }
        keep.push(l);
    }
    keep.push("RunAsInvoker");
    Some(keep.join(" "))
}

/// Capas de compatibilidad del exe (usuario y equipo).
#[cfg(windows)]
fn registry_layers(exe: &Path) -> Vec<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    const LAYERS: &str = "Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers";
    let name = exe.to_string_lossy();
    [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE]
        .into_iter()
        .filter_map(|root| RegKey::predef(root).open_subkey(LAYERS).ok()?.get_value::<String, _>(name.as_ref()).ok())
        .collect()
}

/// El manifiesto del exe pide administrador (`requireAdministrator` o
/// `highestAvailable`): ese juego lo necesita de verdad.
#[cfg(windows)]
fn manifest_requires_admin(exe: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::FreeLibrary;
    use windows::Win32::System::LibraryLoader::{
        FindResourceW, LoadLibraryExW, LoadResource, LockResource, SizeofResource, LOAD_LIBRARY_AS_DATAFILE,
        LOAD_LIBRARY_AS_IMAGE_RESOURCE,
    };
    use windows::Win32::UI::WindowsAndMessaging::RT_MANIFEST;
    let wide: Vec<u16> = exe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        let Ok(m) = LoadLibraryExW(PCWSTR(wide.as_ptr()), None, LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE) else {
            return false;
        };
        let mut admin = false;
        // El manifiesto de un exe es el recurso 1.
        let r = FindResourceW(Some(m), PCWSTR(1 as _), RT_MANIFEST);
        if !r.is_invalid() {
            let len = SizeofResource(Some(m), r) as usize;
            if let Ok(data) = LoadResource(Some(m), r) {
                let p = LockResource(data) as *const u8;
                if !p.is_null() && len > 0 {
                    let text = String::from_utf8_lossy(std::slice::from_raw_parts(p, len));
                    admin = text.contains("requireAdministrator") || text.contains("highestAvailable");
                }
            }
        }
        let _ = FreeLibrary(m);
        admin
    }
}

/// Por qué se abriría como administrador aunque ejGames no lo pida:
/// "manifest" (el propio exe lo exige) o "windows" (marca de compatibilidad).
pub fn elevation_reason(exe: &Path) -> Option<&'static str> {
    #[cfg(windows)]
    {
        if !exe.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
            return None;
        }
        if manifest_requires_admin(exe) {
            return Some("manifest");
        }
        invoker_value(&registry_layers(exe)).map(|_| "windows")
    }
    #[cfg(not(windows))]
    {
        let _ = exe;
        None
    }
}

/// `__COMPAT_LAYER` para lanzar sin elevar un exe que Windows tiene marcado
/// como administrador. None si no está marcado o si el manifiesto lo exige.
#[cfg(windows)]
pub fn invoker_layers(exe: &Path) -> Option<String> {
    if !exe.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
        return None;
    }
    let v = invoker_value(&registry_layers(exe))?;
    (!manifest_requires_admin(exe)).then_some(v)
}

/// ¿Corre el proceso como administrador? Si se puede consultar el proceso pero
/// no su token, es que tiene más privilegios que ejGames (elevado).
#[cfg(windows)]
pub fn process_elevated(pid: u32) -> Option<bool> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut tok = HANDLE::default();
        let opened = OpenProcessToken(h, TOKEN_QUERY, &mut tok).is_ok();
        let _ = CloseHandle(h);
        if !opened {
            return Some(true);
        }
        let mut e = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(
            tok,
            TokenElevation,
            Some(&mut e as *mut TOKEN_ELEVATION as *mut core::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(tok);
        ok.then_some(e.TokenIsElevated != 0)
    }
}

/// El juego tiene más privilegios que ejGames: Windows no dejará leer el teclado.
#[cfg(windows)]
pub fn above_us(pid: u32) -> bool {
    let me = process_elevated(std::process::id()).unwrap_or(false);
    !me && process_elevated(pid).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::invoker_value;

    fn v(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn invoker_layers() {
        assert_eq!(invoker_value(&v(&["~ RUNASADMIN"])).as_deref(), Some("RunAsInvoker"));
        assert_eq!(
            invoker_value(&v(&["~ DISABLEDXMAXIMIZEDWINDOWEDMODE RUNASADMIN HIGHDPIAWARE"])).as_deref(),
            Some("DISABLEDXMAXIMIZEDWINDOWEDMODE HIGHDPIAWARE RunAsInvoker")
        );
        // Usuario y equipo a la vez, sin repetir capas.
        assert_eq!(invoker_value(&v(&["~ HIGHDPIAWARE", "~ runasadmin HIGHDPIAWARE"])).as_deref(), Some("HIGHDPIAWARE RunAsInvoker"));
        assert_eq!(invoker_value(&v(&["~ HIGHDPIAWARE"])), None);
        assert_eq!(invoker_value(&[]), None);
    }
}
