//! Ubisoft Connect: HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\<id>.

use crate::db::models::NewGame;
use std::path::Path;

pub fn installed() -> anyhow::Result<Vec<NewGame>> {
    let mut out = vec![];
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let Ok(installs) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs") else {
            return Ok(out);
        };
        for id in installs.enum_keys().filter_map(Result::ok) {
            let Ok(k) = installs.open_subkey(&id) else { continue };
            let dir: String = k.get_value("InstallDir").unwrap_or_default();
            let dir = crate::util::clean_dir(&dir);
            if dir.is_empty() || !Path::new(&dir).is_dir() {
                continue;
            }
            let title = hklm
                .open_subkey(format!(
                    "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Uplay Install {id}"
                ))
                .and_then(|u| u.get_value::<String, _>("DisplayName"))
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    Path::new(&dir).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()
                });
            out.push(NewGame {
                title,
                source: "ubisoft".into(),
                source_id: id.clone(),
                install_dir: Some(dir),
                launch_uri: Some(format!("uplay://launch/{id}/0")),
                ..Default::default()
            });
        }
    }
    Ok(out)
}
