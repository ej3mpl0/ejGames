//! Manifiesto de Ludusavi (`ludusavi-manifest`): dónde guarda sus partidas cada
//! juego. Es un YAML de unos 17 MB; en vez de cargarlo entero se lee línea a
//! línea (sangrado fijo de 2 espacios) y solo se queda lo que sirve en Windows.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SaveGame {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steam: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steam_extra: Vec<u64>,
    /// Nombres de la carpeta de instalación (para `<base>`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub install_dirs: Vec<String>,
    /// Rutas con marcadores (`<winDocuments>/Saved Games/Hades`).
    pub paths: Vec<String>,
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix('"').and_then(|r| r.strip_suffix('"')) {
        let mut out = String::with_capacity(inner.len());
        let mut it = inner.chars();
        while let Some(c) = it.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match it.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(o) => out.push(o),
                None => {}
            }
        }
        out
    } else if let Some(inner) = s.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')) {
        inner.replace("''", "'")
    } else {
        s.to_string()
    }
}

/// «clave:» al final de la línea → la clave; con valor («id: 12») → None.
fn block_key(t: &str) -> Option<String> {
    let t = t.trim_end();
    let body = t.strip_suffix(':')?;
    Some(unquote(body))
}

/// («clave», «valor») de «clave: valor» (la clave sin comillas).
fn pair(t: &str) -> Option<(&str, &str)> {
    let (k, v) = t.split_once(": ")?;
    Some((k.trim(), v.trim()))
}

#[derive(Default)]
struct FileEntry {
    path: String,
    save: bool,
    /// Una condición por elemento de `when` (None = sirve en cualquier sistema).
    whens: Vec<Option<String>>,
}

impl FileEntry {
    fn windows_save(&self) -> bool {
        self.save && (self.whens.is_empty() || self.whens.iter().any(|w| w.as_deref().map(|o| o == "windows").unwrap_or(true)))
    }
}

#[derive(PartialEq, Clone, Copy)]
enum Sec {
    None,
    Files,
    InstallDir,
    Steam,
    Id,
    SteamExtra,
}

pub fn parse(text: &str) -> Vec<SaveGame> {
    let mut out: Vec<SaveGame> = vec![];
    let mut cur: Option<SaveGame> = None;
    let mut sec = Sec::None;
    let mut file: Option<FileEntry> = None;
    // Dentro de `tags:` / `when:` de una ruta.
    #[derive(PartialEq, Clone, Copy)]
    enum Sub {
        None,
        Tags,
        When,
    }
    let mut sub = Sub::None;

    fn close_file(cur: &mut Option<SaveGame>, file: &mut Option<FileEntry>) {
        if let (Some(f), Some(g)) = (file.take(), cur.as_mut()) {
            if f.windows_save() {
                g.paths.push(f.path);
            }
        }
    }
    fn close_game(out: &mut Vec<SaveGame>, cur: &mut Option<SaveGame>, file: &mut Option<FileEntry>) {
        close_file(cur, file);
        if let Some(g) = cur.take() {
            if !g.paths.is_empty() {
                out.push(g);
            }
        }
    }

    for raw in text.lines() {
        if raw.trim().is_empty() || raw.starts_with('#') || raw.starts_with("---") {
            continue;
        }
        let indent = raw.len() - raw.trim_start().len();
        let t = raw.trim_start();
        match indent {
            0 => {
                close_game(&mut out, &mut cur, &mut file);
                sec = Sec::None;
                if let Some(name) = block_key(t) {
                    cur = Some(SaveGame { name, ..Default::default() });
                }
            }
            2 => {
                close_file(&mut cur, &mut file);
                sub = Sub::None;
                sec = match block_key(t).as_deref() {
                    Some("files") => Sec::Files,
                    Some("installDir") => Sec::InstallDir,
                    Some("steam") => Sec::Steam,
                    Some("id") => Sec::Id,
                    _ => Sec::None,
                };
            }
            4 => match sec {
                Sec::Files => {
                    close_file(&mut cur, &mut file);
                    sub = Sub::None;
                    if let Some(p) = block_key(t) {
                        file = Some(FileEntry { path: p, ..Default::default() });
                    }
                }
                Sec::InstallDir => {
                    // «Nombre: {}»
                    if let Some(g) = cur.as_mut() {
                        let k = t.strip_suffix(": {}").map(unquote).or_else(|| block_key(t));
                        if let Some(k) = k {
                            g.install_dirs.push(k);
                        }
                    }
                }
                Sec::Steam => {
                    if let (Some(g), Some(("id", v))) = (cur.as_mut(), pair(t)) {
                        g.steam = v.parse().ok();
                    }
                }
                Sec::Id | Sec::SteamExtra => {
                    sec = if block_key(t).as_deref() == Some("steamExtra") { Sec::SteamExtra } else { Sec::Id };
                }
                Sec::None => {}
            },
            6 => match sec {
                Sec::Files => {
                    sub = match block_key(t).as_deref() {
                        Some("tags") => Sub::Tags,
                        Some("when") => Sub::When,
                        _ => Sub::None,
                    };
                }
                Sec::SteamExtra => {
                    if let (Some(g), Some(v)) = (cur.as_mut(), t.strip_prefix("- ")) {
                        if let Ok(id) = v.trim().parse() {
                            g.steam_extra.push(id);
                        }
                    }
                }
                _ => {}
            },
            8 if sec == Sec::Files => {
                let Some(f) = file.as_mut() else { continue };
                match sub {
                    Sub::Tags => {
                        if t.strip_prefix("- ").map(str::trim) == Some("save") {
                            f.save = true;
                        }
                    }
                    Sub::When => {
                        if let Some(item) = t.strip_prefix("- ") {
                            f.whens.push(pair(item).filter(|(k, _)| *k == "os").map(|(_, v)| v.to_string()));
                        }
                    }
                    Sub::None => {}
                }
            }
            10 if sec == Sec::Files && sub == Sub::When => {
                // Otra clave del mismo elemento de `when` (el `os` puede venir después de `bit`/`store`).
                if let (Some(f), Some(("os", v))) = (file.as_mut(), pair(t)) {
                    if let Some(last) = f.whens.last_mut() {
                        *last = Some(v.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    close_game(&mut out, &mut cur, &mut file);
    out
}

/// Índices para buscar un juego: por AppID de Steam y por nombre normalizado.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Index {
    pub games: Vec<SaveGame>,
    pub steam: HashMap<u64, usize>,
    pub names: HashMap<String, usize>,
}

pub fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

pub fn index(games: Vec<SaveGame>) -> Index {
    let mut idx = Index::default();
    for (i, g) in games.iter().enumerate() {
        if let Some(id) = g.steam {
            idx.steam.entry(id).or_insert(i);
        }
        for id in &g.steam_extra {
            idx.steam.entry(*id).or_insert(i);
        }
        let n = norm(&g.name);
        if n.len() >= 3 {
            idx.names.entry(n).or_insert(i);
        }
    }
    idx.games = games;
    idx
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"---
"! That Bastard Is Trying To Steal Our Gold !":
  steam:
    id: 449940
Hades:
  cloud:
    epic: true
  files:
    "<home>/Library/Application Support/Supergiant Games/Hades":
      tags:
        - config
        - save
      when:
        - os: mac
    "<winDocuments>/Saved Games/Hades":
      tags:
        - config
        - save
      when:
        - os: windows
    "<winDocuments>/Saved Games/Hades/Settings":
      tags:
        - config
      when:
        - os: windows
    "<winLocalAppData>/Hades/Packages":
      tags:
        - save
      when:
        - bit: 64
          os: windows
          store: microsoft
  id:
    lutris: hades
    steamExtra:
      - 1206340
  installDir:
    Hades: {}
  steam:
    id: 1145360
"Quoted \"Name\"":
  files:
    "<base>/saves":
      tags:
        - save
  steam:
    id: 7
"#;

    #[test]
    fn parses_windows_saves_only() {
        let g = parse(SAMPLE);
        // El primero no tiene rutas: fuera.
        assert_eq!(g.len(), 2);
        let h = &g[0];
        assert_eq!(h.name, "Hades");
        assert_eq!(h.steam, Some(1145360));
        assert_eq!(h.steam_extra, vec![1206340]);
        assert_eq!(h.install_dirs, vec!["Hades"]);
        assert_eq!(h.paths, vec!["<winDocuments>/Saved Games/Hades".to_string(), "<winLocalAppData>/Hades/Packages".to_string()]);
        assert_eq!(g[1].name, "Quoted \"Name\"");
        assert_eq!(g[1].paths, vec!["<base>/saves".to_string()]);
    }

    #[test]
    fn index_finds_by_steam_and_name() {
        let idx = index(parse(SAMPLE));
        assert_eq!(idx.games[idx.steam[&1206340]].name, "Hades");
        assert_eq!(idx.games[idx.names[&norm("HADES")]].name, "Hades");
    }

    /// Con el manifiesto real descargado: `LUDUSAVI_YAML=ruta cargo test --lib manifest -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_manifest() {
        let p = std::env::var("LUDUSAVI_YAML").expect("LUDUSAVI_YAML");
        let t = std::fs::read_to_string(p).unwrap();
        let start = std::time::Instant::now();
        let games = parse(&t);
        let idx = index(games);
        let json = serde_json::to_vec(&idx).unwrap();
        println!("{} juegos, {} con steam, {} KB, {:?}", idx.games.len(), idx.steam.len(), json.len() / 1024, start.elapsed());
        let hades = idx.games.iter().find(|g| g.name == "Hades").expect("Hades");
        assert!(hades.paths.iter().any(|p| p.contains("Saved Games")));
        assert!(idx.games.len() > 5000);
    }
}
