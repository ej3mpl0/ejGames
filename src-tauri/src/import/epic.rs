//! Epic Games Store: manifiestos *.item (JSON) en ProgramData. Se lanza siempre
//! por URI: el exe directo rompe el login de Epic.

use crate::db::models::NewGame;
use serde_json::Value;
use std::path::{Path, PathBuf};

fn manifests_dir() -> PathBuf {
    let pd = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".into());
    PathBuf::from(pd).join("Epic").join("EpicGamesLauncher").join("Data").join("Manifests")
}

pub fn parse_item(v: &Value) -> Option<NewGame> {
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let app = s("AppName");
    let main = s("MainGameAppName");
    if app.is_empty() || (!main.is_empty() && main != app) {
        return None; // DLC
    }
    if v.get("bIsIncompleteInstall").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let cats: Vec<String> = v
        .get("AppCategories")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|c| c.as_str().map(str::to_lowercase)).collect())
        .unwrap_or_default();
    if !cats.is_empty() && !cats.iter().any(|c| c == "games") {
        return None; // Unreal Engine, plugins…
    }
    let dir = s("InstallLocation");
    if dir.is_empty() || !Path::new(&dir).is_dir() {
        return None;
    }
    let ns = s("CatalogNamespace");
    let id = s("CatalogItemId");
    let exe_rel = s("LaunchExecutable");
    let exe = (!exe_rel.is_empty()).then(|| Path::new(&dir).join(&exe_rel));
    let hint = exe
        .as_ref()
        .and_then(|e| e.file_name())
        .map(|f| f.to_string_lossy().to_ascii_lowercase());
    Some(NewGame {
        title: s("DisplayName"),
        source: "epic".into(),
        source_id: app.clone(),
        install_dir: Some(dir),
        exe_path: exe.map(|e| e.to_string_lossy().to_string()),
        launch_uri: Some(format!(
            "com.epicgames.launcher://apps/{ns}%3A{id}%3A{app}?action=launch&silent=true"
        )),
        install_uri: Some(format!("com.epicgames.launcher://apps/{ns}%3A{id}%3A{app}?action=install")),
        process_hints: hint.into_iter().collect(),
        ..Default::default()
    })
}

fn catcache_path() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
    PathBuf::from(base).join("EpicGamesLauncher").join("Saved").join("Data").join("Catalog").join("catcache.bin")
}

/// Juegos de tu biblioteca de Epic (catcache.bin = JSON en base64 del catálogo
/// que tienes). Se descartan DLC, complementos y aplicaciones.
pub fn parse_catcache(raw: &[u8]) -> Vec<NewGame> {
    let txt = String::from_utf8_lossy(raw);
    let decoded = decode_b64(txt.trim()).unwrap_or_default();
    let Ok(items) = serde_json::from_slice::<Vec<Value>>(&decoded) else { return vec![] };
    let mut out = vec![];
    for it in items {
        let s = |k: &str| it.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
        if it.get("mainGameItem").is_some() {
            continue; // DLC
        }
        let cats: Vec<String> = it
            .get("categories")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|c| c.get("path").and_then(Value::as_str).map(str::to_lowercase)).collect())
            .unwrap_or_default();
        let has = |k: &str| cats.iter().any(|c| c == k);
        if !has("games") || has("addons") || has("digitalextras") {
            continue;
        }
        let app = it
            .get("releaseInfo")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(|r| r.get("appId"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let (ns, id, title) = (s("namespace"), s("id"), s("title"));
        if app.is_empty() || title.is_empty() {
            continue;
        }
        out.push(NewGame {
            title,
            source: "epic".into(),
            source_id: app.clone(),
            owned_only: true,
            install_uri: Some(format!("com.epicgames.launcher://apps/{ns}%3A{id}%3A{app}?action=install")),
            ..Default::default()
        });
    }
    out
}

fn decode_b64(s: &str) -> Option<Vec<u8>> {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut map = [255u8; 256];
    for (i, c) in T.iter().enumerate() {
        map[*c as usize] = i as u8;
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut buf, mut bits) = (0u32, 0);
    for c in s.bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        let v = map[c as usize];
        if v == 255 {
            return None;
        }
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
}

pub fn owned() -> Vec<NewGame> {
    std::fs::read(catcache_path()).map(|raw| parse_catcache(&raw)).unwrap_or_default()
}

pub fn installed() -> anyhow::Result<Vec<NewGame>> {
    let Ok(rd) = std::fs::read_dir(manifests_dir()) else { return Ok(vec![]) };
    let mut out = vec![];
    for e in rd.filter_map(Result::ok) {
        if e.path().extension().map(|x| x != "item").unwrap_or(true) {
            continue;
        }
        let Ok(t) = std::fs::read_to_string(e.path()) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')) else { continue };
        if let Some(g) = parse_item(&v) {
            out.push(g);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_and_dlc() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().to_string_lossy().to_string();
        let v = serde_json::json!({
            "DisplayName": "Alan Wake 2", "AppName": "Dill", "MainGameAppName": "Dill",
            "InstallLocation": dir, "LaunchExecutable": "AlanWake2.exe",
            "CatalogNamespace": "dc9d2e595d0e4650b35d659f90d41059", "CatalogItemId": "c4763f236d08423eb47b4c3008779c84",
            "AppCategories": ["public", "games", "applications"], "bIsIncompleteInstall": false
        });
        let g = parse_item(&v).unwrap();
        assert_eq!(g.title, "Alan Wake 2");
        assert!(g.launch_uri.unwrap().starts_with("com.epicgames.launcher://apps/dc9d2e595d0e4650b35d659f90d41059%3Ac4763f236d08423eb47b4c3008779c84%3ADill"));
        assert_eq!(g.process_hints, vec!["alanwake2.exe"]);

        let dlc = serde_json::json!({"AppName": "DillDLC", "MainGameAppName": "Dill", "InstallLocation": dir});
        assert!(parse_item(&dlc).is_none());
    }

    #[test]
    fn catcache() {
        let json = serde_json::json!([
            {"id": "c1", "namespace": "ns1", "title": "Juego Uno", "categories": [{"path": "games"}],
             "releaseInfo": [{"appId": "AppUno"}]},
            {"id": "c2", "namespace": "ns1", "title": "DLC", "categories": [{"path": "addons"}],
             "mainGameItem": {"id": "c1"}, "releaseInfo": [{"appId": "AppDlc"}]},
            {"id": "c3", "namespace": "ns2", "title": "Motor", "categories": [{"path": "engines"}],
             "releaseInfo": [{"appId": "UE"}]}
        ])
        .to_string();
        // Codificación base64 mínima para el test.
        let enc = {
            const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            let b = json.as_bytes();
            let mut s = String::new();
            for ch in b.chunks(3) {
                let n = (ch[0] as u32) << 16 | (*ch.get(1).unwrap_or(&0) as u32) << 8 | *ch.get(2).unwrap_or(&0) as u32;
                for i in 0..4 {
                    if i <= ch.len() {
                        s.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
                    } else {
                        s.push('=');
                    }
                }
            }
            s
        };
        let games = parse_catcache(enc.as_bytes());
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].title, "Juego Uno");
        assert!(games[0].owned_only);
        assert_eq!(games[0].install_uri.as_deref(), Some("com.epicgames.launcher://apps/ns1%3Ac1%3AAppUno?action=install"));
    }
}
