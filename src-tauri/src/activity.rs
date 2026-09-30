//! Historial de cada perfil (tabla `activity`): partidas, logros y juegos
//! completados, con el título del juego para que sobreviva a desinstalarlo.
//! De aquí salen la actividad del perfil y, a fin de año, el resumen.

use rusqlite::{params, Connection};
use serde_json::{json, Value};

/// Una partida guardada (la llama `repo::record_session`).
pub fn played(c: &Connection, profile: i64, game: i64, start: i64, end: i64) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO activity (profile_id, kind, game_id, game, at, data)
         SELECT ?1, 'played', id, title, ?4, json_object('start', ?3, 'seconds', ?4 - ?3) FROM games WHERE id = ?2",
        params![profile, game, start, end],
    )?;
    Ok(())
}

/// Un logro nuevo de un perfil (y «completado» si era el último que faltaba).
pub fn unlocked(c: &Connection, profile: i64, game: i64, api: &str, at: i64) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO activity (profile_id, kind, game_id, game, at, data)
         SELECT ?1, 'achievement', g.id, g.title, ?4,
                json_object('api', ?3, 'name', COALESCE(d.name, ?3), 'appid', d.appid, 'icon', d.icon, 'rarity', d.global_pct)
         FROM games g LEFT JOIN achievement_defs d ON d.game_id = g.id AND d.api_name = ?3
         WHERE g.id = ?2",
        params![profile, game, api, at],
    )?;
    let (total, got): (i64, i64) = c.query_row(
        "SELECT COUNT(*), COUNT(u.api_name) FROM achievement_defs d
         LEFT JOIN achievement_unlocks u ON u.game_id = d.game_id AND u.api_name = d.api_name
         WHERE d.game_id = ?1",
        [game],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if total > 0 && got == total {
        // Con el último logro (si llegan varios de golpe, no tiene por qué ser este).
        c.execute(
            "INSERT INTO activity (profile_id, kind, game_id, game, at, data)
             SELECT ?1, 'completed', id, title, (SELECT MAX(unlocked_at) FROM achievement_unlocks WHERE game_id = ?2), '{}' FROM games WHERE id = ?2
               AND NOT EXISTS (SELECT 1 FROM activity a WHERE a.profile_id = ?1 AND a.game_id = ?2 AND a.kind = 'completed')",
            params![profile, game],
        )?;
    }
    Ok(())
}

/// Lo último de un perfil, como lo pinta el kit: {id, kind, at, data: {game, …}}.
/// Las partidas de menos de 5 minutos no cuentan.
pub fn recent(c: &Connection, profile: i64, limit: i64) -> rusqlite::Result<Vec<Value>> {
    let mut st = c.prepare_cached(
        "SELECT id, kind, game, at, data FROM activity
         WHERE profile_id = ?1 AND (kind != 'played' OR COALESCE(json_extract(data, '$.seconds'), 0) >= 300)
         ORDER BY at DESC, id DESC LIMIT ?2",
    )?;
    let rows = st.query_map(params![profile, limit], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?))
    })?;
    let mut out = vec![];
    for row in rows {
        let (id, kind, game, at, data) = row?;
        let d: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
        let mut data = json!({ "game": game });
        match kind.as_str() {
            "played" => data["minutes"] = json!(d["seconds"].as_i64().unwrap_or(0) / 60),
            "achievement" => {
                data["name"] = d["name"].clone();
                data["rarity"] = d["rarity"].clone();
                data["iconUrl"] = json!(crate::achievements::icon_url(d["appid"].as_i64(), d["icon"].as_str()));
            }
            _ => {}
        }
        out.push(json!({ "id": id, "kind": kind, "at": at, "data": data }));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use crate::db::{repo, Db};

    #[test]
    fn history_outlives_the_game() {
        let db = Db::memory().unwrap();
        db.with(|c| {
            let pid = repo::create_profile(c, "Ana", "#fff", "steam")?;
            c.execute(
                "INSERT INTO games (title, sort_title, source, source_id, added_at, updated_at) VALUES ('Hades', 'hades', 'manual', 'h', 0, 0)",
                [],
            )?;
            let gid = c.last_insert_rowid();
            c.execute("INSERT INTO achievement_defs (game_id, api_name, name, appid, icon) VALUES (?1, 'A', 'Primera sangre', 1145360, 'a.jpg')", [gid])?;
            repo::record_session(c, pid, gid, 1_000, 1_000 + 3_600)?;
            repo::record_session(c, pid, gid, 9_000, 9_060)?;
            c.execute("INSERT INTO achievement_unlocks (game_id, api_name, unlocked_at, source, profile_id) VALUES (?1, 'A', 5000, 'test', ?2)", [gid, pid])?;
            super::unlocked(c, pid, gid, "A", 5_000)?;

            let list = super::recent(c, pid, 10)?;
            // La partida de un minuto no sale; el logro era el único: completado.
            let kinds: Vec<&str> = list.iter().map(|a| a["kind"].as_str().unwrap()).collect();
            assert_eq!(kinds, ["completed", "achievement", "played"]);
            assert_eq!(list[2]["data"]["minutes"], 60);
            assert_eq!(list[1]["data"]["name"], "Primera sangre");
            assert!(list[1]["data"]["iconUrl"].as_str().unwrap().ends_with("/a/1145360/a.jpg"));

            repo::delete_game(c, gid)?;
            assert_eq!(super::recent(c, pid, 10)?.len(), 3);
            Ok(())
        })
        .unwrap();
    }
}
