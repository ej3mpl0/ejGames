//! Lanzar juegos: URI de tienda o exe vía ShellExecuteExW (maneja UAC/"runas";
//! CreateProcess falla con el error 740 en juegos que piden admin). Los exes que
//! solo son administrador por la marca de compatibilidad de Windows se lanzan
//! sin elevar (ver `admin`).

use crate::db::models::Game;
use std::path::Path;

pub struct Launched {
    pub pid: Option<u32>,
    pub via_uri: bool,
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn shell_execute(verb: &str, file: &str, params: &str, dir: Option<&str>) -> anyhow::Result<Option<u32>> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use windows::Win32::System::Threading::GetProcessId;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    }
    let verb_w = wide(verb);
    let file_w = wide(file);
    let params_w = wide(params);
    let dir_w = dir.map(wide);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: PCWSTR(verb_w.as_ptr()),
        lpFile: PCWSTR(file_w.as_ptr()),
        lpParameters: if params.is_empty() { PCWSTR::null() } else { PCWSTR(params_w.as_ptr()) },
        lpDirectory: dir_w.as_ref().map(|d| PCWSTR(d.as_ptr())).unwrap_or(PCWSTR::null()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut info)?;
        if !info.hProcess.is_invalid() {
            let pid = GetProcessId(info.hProcess);
            let _ = CloseHandle(info.hProcess);
            return Ok((pid != 0).then_some(pid));
        }
    }
    Ok(None)
}

/// CreateProcess con `__COMPAT_LAYER` en el entorno (ShellExecuteEx no deja
/// pasarle un entorno propio). Los argumentos van tal cual los escribió el usuario.
#[cfg(windows)]
fn spawn_as_invoker(exe: &str, args: &str, dir: Option<&str>, layers: &str) -> std::io::Result<u32> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    let mut cmd = Command::new(exe);
    if !args.trim().is_empty() {
        cmd.raw_arg(args.trim());
    }
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    cmd.env("__COMPAT_LAYER", layers).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    Ok(cmd.spawn()?.id())
}

pub fn launch(g: &Game) -> anyhow::Result<Launched> {
    // Las tiendas con URI (Steam, Epic, Ubisoft, EA) se lanzan por su cliente.
    if let Some(uri) = g.launch_uri.as_deref().filter(|u| !u.is_empty()) {
        #[cfg(windows)]
        shell_execute("open", uri, "", None)?;
        return Ok(Launched { pid: None, via_uri: true });
    }
    let exe = g.exe_path.as_deref().ok_or_else(|| anyhow::anyhow!("El juego no tiene ejecutable"))?;
    if !Path::new(exe).exists() {
        anyhow::bail!("No existe el ejecutable: {exe}");
    }
    let dir = g
        .working_dir
        .clone()
        .filter(|d| Path::new(d).is_dir())
        .or_else(|| Path::new(exe).parent().map(|p| p.to_string_lossy().to_string()));
    #[cfg(windows)]
    {
        // Windows lo tiene como «Ejecutar como administrador» pero en ejGames no
        // se pidió: sin elevar (sin UAC y con el atajo del overlay funcionando).
        if !g.run_as_admin {
            if let Some(layers) = super::admin::invoker_layers(Path::new(exe)) {
                match spawn_as_invoker(exe, &g.args, dir.as_deref(), &layers) {
                    Ok(pid) => {
                        tracing::info!("lanzado sin elevar (__COMPAT_LAYER={layers}): {exe}");
                        return Ok(Launched { pid: Some(pid), via_uri: false });
                    }
                    Err(e) => tracing::warn!("no se pudo lanzar sin elevar ({e}); se usa ShellExecute"),
                }
            }
        }
        let verb = if g.run_as_admin { "runas" } else { "open" };
        let pid = shell_execute(verb, exe, &g.args, dir.as_deref())?;
        Ok(Launched { pid, via_uri: false })
    }
    #[cfg(not(windows))]
    {
        let child = std::process::Command::new(exe).args(g.args.split_whitespace()).current_dir(dir.unwrap_or_default()).spawn()?;
        Ok(Launched { pid: Some(child.id()), via_uri: false })
    }
}
