//! GOG: HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>. Sin DRM → exe directo.

use crate::db::models::NewGame;
use std::path::Path;

/// Juegos de tu biblioteca de GOG según la base de datos de GOG Galaxy (solo lectura).
pub fn owned() -> Vec<NewGame> {
    let pd = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".into());
    let db = Path::new(&pd).join("GOG.com").join("Galaxy").join("storage").join("galaxy-2.0.db");
    if !db.exists() {
        return vec![];
    }
    let uri = format!("file:{}?mode=ro&immutable=1", db.to_string_lossy().replace('\\', "/"));
    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let Ok(conn) = rusqlite::Connection::open_with_flags(uri, flags) else { return vec![] };
    owned_from(&conn)
}

pub fn owned_from(conn: &rusqlite::Connection) -> Vec<NewGame> {
    let sql = "SELECT DISTINCT lr.releaseKey, gp.value FROM LibraryReleases lr
               JOIN GamePieces gp ON gp.releaseKey = lr.releaseKey
               JOIN GamePieceTypes t ON t.id = gp.gamePieceTypeId
               WHERE t.type = 'title' AND lr.releaseKey LIKE 'gog\\_%' ESCAPE '\\'";
    let Ok(mut st) = conn.prepare(sql) else { return vec![] };
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)));
    let Ok(rows) = rows else { return vec![] };
    let mut out = vec![];
    for (key, value) in rows.filter_map(Result::ok) {
        let id = key.trim_start_matches("gog_").to_string();
        let title = serde_json::from_str::<serde_json::Value>(&value)
            .ok()
            .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(str::to_string))
            .unwrap_or_default();
        if title.is_empty() || id.is_empty() {
            continue;
        }
        out.push(NewGame {
            title,
            source: "gog".into(),
            source_id: id.clone(),
            owned_only: true,
            install_uri: Some(format!("goggalaxy://openGameView/{id}")),
            ..Default::default()
        });
    }
    out
}

pub fn installed() -> anyhow::Result<Vec<NewGame>> {
    let mut out = vec![];
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let Ok(games) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\GOG.com\\Games") else {
            return Ok(out);
        };
        for id in games.enum_keys().filter_map(Result::ok) {
            let Ok(k) = games.open_subkey(&id) else { continue };
            let get = |n: &str| k.get_value::<String, _>(n).unwrap_or_default();
            if !get("dependsOn").is_empty() {
                continue; // DLC
            }
            let dir = get("path");
            if dir.is_empty() || !Path::new(&dir).is_dir() {
                continue;
            }
            // El .info del juego manda (tarea primaria); si no, lo que diga el registro.
            let info = std::fs::read_dir(&dir).ok().and_then(|rd| {
                rd.filter_map(Result::ok).find_map(|e| {
                    let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                    (n.starts_with("goggame-") && n.ends_with(".info"))
                        .then(|| crate::library::exe_detect::parse_gog_info(&e.path(), Path::new(&dir)))
                        .flatten()
                })
            });
            let exe = info
                .as_ref()
                .and_then(|i| i.primary_exe.clone())
                .map(|p| p.to_string_lossy().to_string())
                .or_else(|| Some(get("exe")).filter(|s| !s.is_empty()));
            let wd = info
                .as_ref()
                .and_then(|i| i.working_dir.clone())
                .map(|p| p.to_string_lossy().to_string())
                .or_else(|| Some(get("workingDir")).filter(|s| !s.is_empty()));
            let args = info.as_ref().and_then(|i| i.args.clone()).unwrap_or_else(|| get("launchParam"));
            let title = Some(get("gameName")).filter(|s| !s.is_empty()).unwrap_or_else(|| {
                Path::new(&dir).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()
            });
            out.push(NewGame {
                title,
                source: "gog".into(),
                source_id: id.clone(),
                install_dir: Some(dir),
                exe_path: exe,
                working_dir: wd,
                install_uri: Some(format!("goggalaxy://openGameView/{id}")),
                args: if args.trim().starts_with('"') { String::new() } else { args },
                ..Default::default()
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn galaxy_db() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE LibraryReleases (releaseKey TEXT, userId INTEGER);
             CREATE TABLE GamePieceTypes (id INTEGER, type TEXT);
             CREATE TABLE GamePieces (releaseKey TEXT, gamePieceTypeId INTEGER, userId INTEGER, value TEXT);
             INSERT INTO GamePieceTypes VALUES (1, 'title'), (2, 'meta');
             INSERT INTO LibraryReleases VALUES ('gog_1207658930', 1), ('steam_620', 1);
             INSERT INTO GamePieces VALUES ('gog_1207658930', 1, 1, '{\"title\":\"The Witcher: Enhanced Edition\"}');
             INSERT INTO GamePieces VALUES ('steam_620', 1, 1, '{\"title\":\"Portal 2\"}');",
        )
        .unwrap();
        let g = super::owned_from(&c);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].title, "The Witcher: Enhanced Edition");
        assert_eq!(g[0].install_uri.as_deref(), Some("goggalaxy://openGameView/1207658930"));
    }
}
