fn main() {
    relay_env();
    server_env();
    tauri_build::build()
}

/// URL y clave de la API de cuentas, de `server/.dev.vars` (fuera de git, ver
/// server/wrangler.toml). Sin ese archivo la app se compila sin cuentas.
fn server_env() {
    let path = std::path::Path::new("../server/.dev.vars");
    println!("cargo:rerun-if-changed={}", if path.exists() { "../server/.dev.vars" } else { "../server" });
    for line in std::fs::read_to_string(path).unwrap_or_default().lines() {
        let Some((k, v)) = line.split_once('=') else { continue };
        let v = v.trim().trim_matches('"');
        match k.trim() {
            "API_URL" => println!("cargo:rustc-env=EJG_API_URL={v}"),
            "APP_KEY" => println!("cargo:rustc-env=EJG_APP_KEY={v}"),
            _ => {}
        }
    }
}

/// URL y clave del relay de Explorar, de `relay/.dev.vars` (fuera de git, ver
/// relay/wrangler.toml). Sin ese archivo la app se compila sin relay.
fn relay_env() {
    let path = std::path::Path::new("../relay/.dev.vars");
    // Si aún no existe, vigilar la carpeta para enterarse cuando aparezca.
    println!("cargo:rerun-if-changed={}", if path.exists() { "../relay/.dev.vars" } else { "../relay" });
    for line in std::fs::read_to_string(path).unwrap_or_default().lines() {
        let Some((k, v)) = line.split_once('=') else { continue };
        let v = v.trim().trim_matches('"');
        match k.trim() {
            "RELAY_URL" => println!("cargo:rustc-env=EJG_RELAY_URL={v}"),
            "RELAY_KEY" => println!("cargo:rustc-env=EJG_RELAY_KEY={v}"),
            _ => {}
        }
    }
}
