//! EA app: entradas de desinstalación de Electronic Arts cuyo directorio tiene
//! `__Installer\installerdata.xml` (de ahí sale el contentID para lanzar por URI).

use crate::db::models::NewGame;
use regex::Regex;
use std::path::Path;
use std::sync::LazyLock;

static CONTENT_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<contentID>\s*([^<\s]+)\s*</contentID>").unwrap());
static TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<gameTitle[^>]*locale="(?:en_US|es_ES)"[^>]*>\s*([^<]+?)\s*</gameTitle>"#).unwrap());

pub fn parse_installer_data(xml: &str) -> (Option<String>, Option<String>) {
    let id = CONTENT_ID.captures(xml).map(|c| c[1].to_string());
    let title = TITLE.captures(xml).map(|c| c[1].trim().to_string());
    (id, title)
}

pub fn installed() -> anyhow::Result<Vec<NewGame>> {
    let mut out = vec![];
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let roots = [
            "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ];
        let mut seen = std::collections::HashSet::new();
        for root in roots {
            let Ok(un) = hklm.open_subkey(root) else { continue };
            for sub in un.enum_keys().filter_map(Result::ok) {
                let Ok(k) = un.open_subkey(&sub) else { continue };
                let publisher: String = k.get_value("Publisher").unwrap_or_default();
                if !publisher.to_lowercase().contains("electronic arts") {
                    continue;
                }
                let dir: String = k.get_value("InstallLocation").unwrap_or_default();
                let dir = crate::util::clean_dir(dir.trim_matches('"'));
                if dir.is_empty() {
                    continue;
                }
                let xml_path = Path::new(&dir).join("__Installer").join("installerdata.xml");
                let Ok(xml) = std::fs::read_to_string(&xml_path) else { continue };
                if !seen.insert(crate::util::norm_path(Path::new(&dir))) {
                    continue;
                }
                let (content_id, xml_title) = parse_installer_data(&xml);
                let display: String = k.get_value("DisplayName").unwrap_or_default();
                let title = xml_title.or(Some(display).filter(|s| !s.is_empty())).unwrap_or_else(|| {
                    Path::new(&dir).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()
                });
                out.push(NewGame {
                    title,
                    source: "ea".into(),
                    source_id: content_id.clone().unwrap_or_else(|| crate::util::norm_path(Path::new(&dir))),
                    install_dir: Some(dir),
                    launch_uri: content_id.map(|id| format!("origin2://game/launch?offerIds={id}")),
                    ..Default::default()
                });
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn installer_data() {
        let xml = r#"<DiPManifest><gameTitles><gameTitle locale="en_US">Star Wars Jedi: Survivor</gameTitle></gameTitles>
          <contentIDs><contentID>Origin.OFR.50.0005179</contentID></contentIDs></DiPManifest>"#;
        let (id, t) = super::parse_installer_data(xml);
        assert_eq!(id.as_deref(), Some("Origin.OFR.50.0005179"));
        assert_eq!(t.as_deref(), Some("Star Wars Jedi: Survivor"));
    }
}
