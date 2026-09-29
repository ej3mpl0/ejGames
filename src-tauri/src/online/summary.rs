//! Resumen de la biblioteca que ven los amigos (juegos, horas, logros) y lo
//! que sale de él: experiencia, nivel e insignias. Se calcula aquí con la BD
//! local y solo se sube cuando cambia su hash.

use crate::db::repo;
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Insignias: id, umbrales de cada nivel (tier) y de qué se miden.
pub const BADGES: [(&str, &[i64]); 7] = [
    ("collector", &[5, 10, 25, 50, 100, 250]),
    ("achiever", &[10, 50, 100, 250, 500, 1000, 2500]),
    ("marathon", &[10, 50, 100, 250, 500, 1000]),
    ("completionist", &[1, 3, 5, 10, 25, 50]),
    ("explorer", &[5, 10, 25, 50, 100]),
    ("veteran", &[1, 2, 3, 4, 5]),
    ("social", &[1, 5, 10, 25, 50]),
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
    pub years: i64,
    pub friends: i64,
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
        "social" => s.friends,
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

/// El resumen con su hash (el hash no depende del orden de los juegos).
pub fn build(st: &AppState, profile_id: i64, member_since: i64, friends: i64) -> anyhow::Result<(String, Value)> {
    let lib = st.db.with(|c| repo::library(c, profile_id))?;
    let mut s = Stats { games: lib.len() as i64, years: (crate::util::now() - member_since).max(0) / (365 * 86400), friends, ..Default::default() };
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
        // Portada pública (la de Steam): la ven los amigos desde su PC.
        let cover = st.db.with(|c| repo::selected_remote_url(c, g.id, "cover")).ok().flatten().filter(|u| u.starts_with("https://"));
        games.push(json!({
            "title": g.title,
            "minutes": g.playtime / 60,
            "last": g.last_played,
            "ach": ach.map(|a| vec![a.unlocked, a.total]),
            "cover": cover,
        }));
    }
    games.sort_by(|a, b| b["minutes"].as_i64().cmp(&a["minutes"].as_i64()).then_with(|| a["title"].as_str().cmp(&b["title"].as_str())));
    games.truncate(500);
    let b = badges(&s);
    let xp = xp(&s, &b);
    let body = json!({
        "games": games,
        "stats": { "minutes": s.minutes, "achievements": s.achievements, "perfect": s.perfect },
        "xp": xp,
        "level": level_of(xp),
        "badges": b.iter().map(|(id, t)| json!({ "id": id, "tier": t })).collect::<Vec<_>>(),
    });
    let hash: String = Sha256::digest(serde_json::to_vec(&body)?).iter().map(|b| format!("{b:02x}")).collect();
    Ok((hash, body))
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
        let s = Stats { games: 30, played: 6, minutes: 120 * 60, achievements: 55, perfect: 1, years: 0, friends: 5 };
        let b = badges(&s);
        let get = |id: &str| b.iter().find(|(x, _)| x == id).map(|(_, t)| *t);
        assert_eq!(get("collector"), Some(3));
        assert_eq!(get("achiever"), Some(2));
        assert_eq!(get("marathon"), Some(3));
        assert_eq!(get("completionist"), Some(1));
        assert_eq!(get("explorer"), Some(1));
        assert_eq!(get("veteran"), None);
        assert_eq!(get("social"), Some(2));
        // 1200 (horas) + 1100 (logros) + 300 (100 %) + 240 (jugados) + 12 niveles × 50.
        assert_eq!(xp(&s, &b), 1200 + 1100 + 300 + 240 + 600);
    }
}
