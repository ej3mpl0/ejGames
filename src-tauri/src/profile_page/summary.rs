//! Resumen de la biblioteca de un perfil (juegos, horas, logros) y lo que sale
//! de él: experiencia, nivel e insignias. Todo con la BD local.

use crate::db::repo;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};

/// Insignias: id y umbrales de cada nivel (tier).
pub const BADGES: [(&str, &[i64]); 6] = [
    ("collector", &[5, 10, 25, 50, 100, 250]),
    ("achiever", &[10, 50, 100, 250, 500, 1000, 2500]),
    ("marathon", &[10, 50, 100, 250, 500, 1000]),
    ("completionist", &[1, 3, 5, 10, 25, 50]),
    ("explorer", &[5, 10, 25, 50, 100]),
    ("veteran", &[1, 2, 3, 4, 5]),
];

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Stats {
    /// Juegos en la biblioteca.
    pub games: i64,
    /// Juegos jugados al menos una hora.
    pub played: i64,
    pub minutes: i64,
    pub achievements: i64,
    /// Juegos con todos los logros.
    pub perfect: i64,
    /// Años desde que se creó el perfil.
    pub years: i64,
}

pub fn tier(value: i64, thresholds: &[i64]) -> i64 {
    thresholds.iter().filter(|t| value >= **t).count() as i64
}

pub fn badges(s: &Stats) -> Vec<(String, i64)> {
    let value = |id: &str| match id {
        "collector" => s.games,
        "achiever" => s.achievements,
        "marathon" => s.minutes / 60,
        "completionist" => s.perfect,
        "explorer" => s.played,
        "veteran" => s.years,
        _ => 0,
    };
    BADGES
        .iter()
        .map(|(id, th)| (id.to_string(), tier(value(id), th)))
        .filter(|(_, t)| *t > 0)
        .collect()
}

/// Experiencia: 10 por hora, 20 por logro, 300 por juego al 100 %, 40 por
/// juego jugado y 50 por cada nivel de insignia.
pub fn xp(s: &Stats, badges: &[(String, i64)]) -> i64 {
    s.minutes / 6 + s.achievements * 20 + s.perfect * 300 + s.played * 40 + badges.iter().map(|(_, t)| t * 50).sum::<i64>()
}

/// Nivel n cuesta 100·n(n+1)/2 de experiencia acumulada (1 = 100, 10 = 5500).
pub fn level_of(xp: i64) -> i64 {
    let mut n = 0;
    while 100 * (n + 1) * (n + 2) / 2 <= xp {
        n += 1;
    }
    n
}

/// El resumen de la biblioteca (para las vitrinas, la actividad reciente y
/// las pestañas de juegos) con su experiencia, nivel e insignias.
pub fn build(c: &Connection, profile_id: i64, member_since: i64) -> rusqlite::Result<Value> {
    let lib = repo::library(c, profile_id)?;
    let mut s = Stats { games: lib.len() as i64, years: (crate::util::now() - member_since).max(0) / (365 * 86400), ..Default::default() };
    let mut games: Vec<Value> = vec![];
    for g in &lib {
        let ach = g.achievements.as_ref();
        if let Some(a) = ach {
            s.achievements += a.unlocked;
            if a.total > 0 && a.unlocked == a.total {
                s.perfect += 1;
            }
        }
        s.minutes += g.playtime / 60;
        if g.playtime >= 3600 {
            s.played += 1;
        }
        if g.playtime < 60 && ach.map(|a| a.unlocked == 0).unwrap_or(true) {
            continue;
        }
        games.push(json!({
            "id": g.id,
            "title": g.title,
            "minutes": g.playtime / 60,
            "last": g.last_played,
            "ach": ach.map(|a| vec![a.unlocked, a.total]),
            "coverUrl": g.media.cover,
            "headerUrl": g.media.header,
        }));
    }
    games.sort_by(|a, b| b["minutes"].as_i64().cmp(&a["minutes"].as_i64()).then_with(|| a["title"].as_str().cmp(&b["title"].as_str())));
    // Lo de la columna derecha del perfil: horas de las dos últimas semanas y capturas.
    let since = crate::util::now() - 14 * 86400;
    let recent: i64 = c.query_row("SELECT COALESCE(SUM(duration_s), 0) / 60 FROM sessions WHERE profile_id = ?1 AND started_at >= ?2", rusqlite::params![profile_id, since], |r| r.get(0))?;
    let shots: i64 = c.query_row("SELECT COUNT(*) FROM screenshots WHERE game_id IN (SELECT game_id FROM profile_game WHERE profile_id = ?1)", [profile_id], |r| r.get(0))?;
    let b = badges(&s);
    let xp = xp(&s, &b);
    Ok(json!({
        "games": games,
        "stats": { "minutes": s.minutes, "achievements": s.achievements, "perfect": s.perfect, "library": s.games, "played": s.played, "recent": recent, "shots": shots },
        "xp": xp,
        "level": level_of(xp),
        "badges": b.iter().map(|(id, t)| json!({ "id": id, "tier": t })).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels() {
        assert_eq!(level_of(0), 0);
        assert_eq!(level_of(99), 0);
        assert_eq!(level_of(100), 1);
        assert_eq!(level_of(299), 1);
        assert_eq!(level_of(300), 2);
        assert_eq!(level_of(5500), 10);
    }

    #[test]
    fn badges_and_xp() {
        let s = Stats { games: 30, played: 6, minutes: 120 * 60, achievements: 55, perfect: 1, years: 0 };
        let b = badges(&s);
        let get = |id: &str| b.iter().find(|(x, _)| x == id).map(|(_, t)| *t);
        assert_eq!(get("collector"), Some(3));
        assert_eq!(get("achiever"), Some(2));
        assert_eq!(get("marathon"), Some(3));
        assert_eq!(get("completionist"), Some(1));
        assert_eq!(get("explorer"), Some(1));
        assert_eq!(get("veteran"), None);
        // 1200 (horas) + 1100 (logros) + 300 (100 %) + 240 (jugados) + 10 niveles × 50.
        assert_eq!(xp(&s, &b), 1200 + 1100 + 300 + 240 + 500);
    }
}
