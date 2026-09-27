// El paquete NSIS va dentro del ejecutable. Lo pasa scripts/build-installer.mjs:
//   EJG_PAYLOAD          ruta del ejGames_<versión>_x64-setup.exe
//   EJG_VERSION          versión que se instala
//   EJG_INSTALLED_BYTES  lo que ocupa instalado (para el espacio y el progreso)
// Sin EJG_PAYLOAD compila igual, con un paquete vacío (para desarrollar la UI).

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=EJG_PAYLOAD");
    println!("cargo:rerun-if-env-changed=EJG_VERSION");
    println!("cargo:rerun-if-env-changed=EJG_INSTALLED_BYTES");
    let payload = match std::env::var("EJG_PAYLOAD") {
        Ok(p) if !p.is_empty() => PathBuf::from(p),
        _ => {
            let empty = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("empty.bin");
            std::fs::write(&empty, b"").unwrap();
            empty
        }
    };
    println!("cargo:rerun-if-changed={}", payload.display());
    println!("cargo:rustc-env=EJG_PAYLOAD_PATH={}", payload.display());
    println!("cargo:rustc-env=EJG_VERSION={}", std::env::var("EJG_VERSION").unwrap_or_else(|_| "0.0.0".into()));
    println!("cargo:rustc-env=EJG_INSTALLED_BYTES={}", std::env::var("EJG_INSTALLED_BYTES").unwrap_or_else(|_| "60000000".into()));
    tauri_build::build();
}
