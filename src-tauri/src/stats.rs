//! Estadísticas de juego por perfil.

use chrono::{Datelike, Local, NaiveDate, TimeZone, Timelike};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameStat {
    pub game_id: i64,
    pub title: String,
    pub seconds: i64,
    pub sessions: i64,
    pub last_played: Option<i64>,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    pub day: String,
    pub seconds: i64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total_seconds: i64,
    pub tracked_seconds: i64,
    pub games_played: i64,
    pub sessions: i64,
    pub avg_session: i64,
    pub longest_session: i64,
    pub current_streak: i64,
    pub best_streak: i64,
    pub top_games: Vec<GameStat>,
    pub by_day: Vec<DayStat>,
    pub by_weekday: [i64; 7],
    pub by_hour: [i64; 24],
    pub by_genre: Vec<(String, i64)>,
    pub library_size: i64,
    pub never_played: i64,
}

pub fn compute(c: &Connection, profile: i64, days: i64) -> rusqlite::Result<Stats> {
    let mut s = Stats::default();
    let (total, played): (i64, i64) = c.query_row(
        "SELECT COALESCE(SUM(playtime_s), 0), COUNT(CASE WHEN playtime_s > 0 THEN 1 END) FROM profile_game WHERE profile_id = ?1",
        [profile],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    s.total_seconds = total;
    s.games_played = played;
    s.library_size = c.query_row("SELECT COUNT(*) FROM games WHERE missing = 0", [], |r| r.get(0))?;
    s.never_played = c.query_row(
        "SELECT COUNT(*) FROM games g LEFT JOIN profile_game pg ON pg.game_id = g.id AND pg.profile_id = ?1
         WHERE g.missing = 0 AND COALESCE(pg.playtime_s, 0) = 0",
        [profile],
        |r| r.get(0),
    )?;

    // Top por tiempo total (incluye horas importadas de Steam).
    let mut st = c.prepare(
        "SELECT g.id, g.title, pg.playtime_s, pg.last_played,
                (SELECT COUNT(*) FROM sessions se WHERE se.profile_id = ?1 AND se.game_id = g.id)
         FROM profile_game pg JOIN games g ON g.id = pg.game_id
         WHERE pg.profile_id = ?1 AND pg.playtime_s > 0 ORDER BY pg.playtime_s DESC LIMIT 15",
    )?;
    s.top_games = st
        .query_map([profile], |r| {
            Ok(GameStat { game_id: r.get(0)?, title: r.get(1)?, seconds: r.get(2)?, last_played: r.get(3)?, sessions: r.get(4)? })
        })?
        .collect::<rusqlite::Result<_>>()?;

    // Sesiones registradas.
    let mut st = c.prepare(
        "SELECT se.started_at, se.duration_s, g.genres FROM sessions se JOIN games g ON g.id = se.game_id
         WHERE se.profile_id = ?1",
    )?;
    let sessions: Vec<(i64, i64, String)> =
        st.query_map([profile], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    s.sessions = sessions.len() as i64;
    s.tracked_seconds = sessions.iter().map(|x| x.1).sum();
    s.longest_session = sessions.iter().map(|x| x.1).max().unwrap_or(0);
    s.avg_session = if s.sessions > 0 { s.tracked_seconds / s.sessions } else { 0 };

    let mut per_day: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    let mut genres: HashMap<String, i64> = HashMap::new();
    for (start, dur, g) in &sessions {
        if let Some(dt) = Local.timestamp_opt(*start, 0).single() {
            *per_day.entry(dt.date_naive()).or_default() += dur;
            s.by_weekday[dt.weekday().num_days_from_monday() as usize] += dur;
            s.by_hour[dt.hour() as usize] += dur;
        }
        let gs: Vec<String> = serde_json::from_str(g).unwrap_or_default();
        for genre in gs.into_iter().take(2) {
            *genres.entry(genre).or_default() += dur;
        }
    }
    let mut g: Vec<(String, i64)> = genres.into_iter().collect();
    g.sort_by_key(|x| std::cmp::Reverse(x.1));
    g.truncate(8);
    s.by_genre = g;

    let today = Local::now().date_naive();
    for i in (0..days).rev() {
        let d = today - chrono::Duration::days(i);
        s.by_day.push(DayStat { day: d.format("%Y-%m-%d").to_string(), seconds: per_day.get(&d).copied().unwrap_or(0) });
    }

    // Rachas de días consecutivos con partida.
    let days_set: HashSet<NaiveDate> = per_day.keys().copied().collect();
    let mut cur = 0;
    let mut d = today;
    if !days_set.contains(&d) {
        d -= chrono::Duration::days(1);
    }
    while days_set.contains(&d) {
        cur += 1;
        d -= chrono::Duration::days(1);
    }
    s.current_streak = cur;
    let mut best = 0;
    let mut run = 0;
    let mut prev: Option<NaiveDate> = None;
    for day in per_day.keys() {
        run = match prev {
            Some(p) if *day - p == chrono::Duration::days(1) => run + 1,
            _ => 1,
        };
        best = best.max(run);
        prev = Some(*day);
    }
    s.best_streak = best;
    Ok(s)
}

pub fn recent_sessions(c: &Connection, profile: i64, limit: i64) -> rusqlite::Result<Vec<serde_json::Value>> {
    let mut st = c.prepare(
        "SELECT se.game_id, g.title, se.started_at, se.duration_s FROM sessions se JOIN games g ON g.id = se.game_id
         WHERE se.profile_id = ?1 ORDER BY se.started_at DESC LIMIT ?2",
    )?;
    let rows = st.query_map(params![profile, limit], |r| {
        Ok(serde_json::json!({
            "gameId": r.get::<_, i64>(0)?, "title": r.get::<_, String>(1)?,
            "startedAt": r.get::<_, i64>(2)?, "duration": r.get::<_, i64>(3)?
        }))
    })?;
    rows.collect()
}
