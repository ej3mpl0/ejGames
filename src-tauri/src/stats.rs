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

// ───────────────────────────── resumen del año ─────────────────────────────

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct YearTop {
    pub game_id: i64,
    pub title: String,
    pub seconds: i64,
    pub sessions: i64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct YearRare {
    pub name: String,
    pub game: String,
    pub game_id: i64,
    pub pct: f64,
    pub at: i64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct YearReview {
    pub year: i32,
    pub total_seconds: i64,
    pub sessions: i64,
    pub games_played: i64,
    pub days_played: i64,
    pub best_streak: i64,
    pub top_games: Vec<YearTop>,
    /// Segundos jugados en cada mes (enero = 0).
    pub by_month: [i64; 12],
    pub top_month: Option<usize>,
    pub favorite_hour: Option<usize>,
    pub favorite_weekday: Option<usize>,
    pub longest_session: i64,
    pub longest_session_game: Option<String>,
    pub genres: Vec<(String, i64)>,
    pub achievements: i64,
    pub rarest: Option<YearRare>,
    /// Juegos añadidos a la biblioteca en el año.
    pub new_games: i64,
    /// Primer juego al que jugaste en el año.
    pub first_game: Option<String>,
}

/// Resumen de un año natural (hora local) del perfil.
pub fn year(c: &Connection, profile: i64, year: i32) -> rusqlite::Result<YearReview> {
    let mut r = YearReview { year, ..Default::default() };
    let bound = |y: i32| Local.with_ymd_and_hms(y, 1, 1, 0, 0, 0).single().map(|d| d.timestamp()).unwrap_or(0);
    let (from, to) = (bound(year), bound(year + 1));

    let mut st = c.prepare(
        "SELECT se.game_id, g.title, se.started_at, se.duration_s, g.genres FROM sessions se JOIN games g ON g.id = se.game_id
         WHERE se.profile_id = ?1 AND se.started_at >= ?2 AND se.started_at < ?3 ORDER BY se.started_at",
    )?;
    let rows: Vec<(i64, String, i64, i64, String)> = st
        .query_map(params![profile, from, to], |x| Ok((x.get(0)?, x.get(1)?, x.get(2)?, x.get(3)?, x.get(4)?)))?
        .collect::<rusqlite::Result<_>>()?;
    r.sessions = rows.len() as i64;
    r.first_game = rows.first().map(|x| x.1.clone());

    let mut per_game: HashMap<i64, YearTop> = HashMap::new();
    let mut per_day: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    let mut genres: HashMap<String, i64> = HashMap::new();
    let (mut by_hour, mut by_weekday) = ([0i64; 24], [0i64; 7]);
    for (gid, title, start, dur, g) in &rows {
        r.total_seconds += dur;
        if *dur > r.longest_session {
            r.longest_session = *dur;
            r.longest_session_game = Some(title.clone());
        }
        let e = per_game.entry(*gid).or_insert_with(|| YearTop { game_id: *gid, title: title.clone(), ..Default::default() });
        e.seconds += dur;
        e.sessions += 1;
        if let Some(dt) = Local.timestamp_opt(*start, 0).single() {
            r.by_month[dt.month0() as usize] += dur;
            by_hour[dt.hour() as usize] += dur;
            by_weekday[dt.weekday().num_days_from_monday() as usize] += dur;
            *per_day.entry(dt.date_naive()).or_default() += dur;
        }
        let gs: Vec<String> = serde_json::from_str(g).unwrap_or_default();
        for genre in gs.into_iter().take(2) {
            *genres.entry(genre).or_default() += dur;
        }
    }
    r.games_played = per_game.len() as i64;
    r.days_played = per_day.len() as i64;
    let mut top: Vec<YearTop> = per_game.into_values().collect();
    top.sort_by_key(|t| std::cmp::Reverse(t.seconds));
    top.truncate(5);
    r.top_games = top;
    let argmax = |v: &[i64]| v.iter().enumerate().max_by_key(|(_, x)| **x).filter(|(_, x)| **x > 0).map(|(i, _)| i);
    r.top_month = argmax(&r.by_month);
    r.favorite_hour = argmax(&by_hour);
    r.favorite_weekday = argmax(&by_weekday);
    let mut g: Vec<(String, i64)> = genres.into_iter().collect();
    g.sort_by_key(|x| std::cmp::Reverse(x.1));
    g.truncate(5);
    r.genres = g;

    let (mut best, mut run, mut prev): (i64, i64, Option<NaiveDate>) = (0, 0, None);
    for day in per_day.keys() {
        run = match prev {
            Some(p) if *day - p == chrono::Duration::days(1) => run + 1,
            _ => 1,
        };
        best = best.max(run);
        prev = Some(*day);
    }
    r.best_streak = best;

    // Logros del año y el más raro.
    r.achievements = c.query_row(
        "SELECT COUNT(*) FROM achievement_unlocks WHERE unlocked_at >= ?1 AND unlocked_at < ?2 AND (profile_id = ?3 OR profile_id IS NULL)",
        params![from, to, profile],
        |x| x.get(0),
    )?;
    r.rarest = c
        .query_row(
            "SELECT d.name, g.title, g.id, d.global_pct, u.unlocked_at
             FROM achievement_unlocks u
             JOIN achievement_defs d ON d.game_id = u.game_id AND d.api_name = u.api_name
             JOIN games g ON g.id = u.game_id
             WHERE u.unlocked_at >= ?1 AND u.unlocked_at < ?2 AND (u.profile_id = ?3 OR u.profile_id IS NULL) AND d.global_pct IS NOT NULL
             ORDER BY d.global_pct ASC LIMIT 1",
            params![from, to, profile],
            |x| Ok(YearRare { name: x.get(0)?, game: x.get(1)?, game_id: x.get(2)?, pct: x.get(3)?, at: x.get(4)? }),
        )
        .ok();
    r.new_games = c.query_row("SELECT COUNT(*) FROM games WHERE added_at >= ?1 AND added_at < ?2", params![from, to], |x| x.get(0))?;
    Ok(r)
}

#[cfg(test)]
mod year_tests {
    use super::*;
    use crate::db::{models::NewGame, repo, Db};

    #[test]
    fn summarizes_one_calendar_year() {
        let db = Db::memory().unwrap();
        let ts = |y: i32, m: u32, d: u32, h: u32| Local.with_ymd_and_hms(y, m, d, h, 0, 0).unwrap().timestamp();
        db.with(|c| {
            c.execute("INSERT INTO profiles (id, name, color, theme_id, created_at) VALUES (1, 'Ana', '#fff', 'steam', 1)", [])?;
            let a = repo::upsert_game(c, &NewGame { title: "Hades".into(), source: "folder".into(), source_id: "a".into(), ..Default::default() })?.unwrap().0;
            let b = repo::upsert_game(c, &NewGame { title: "Celeste".into(), source: "folder".into(), source_id: "b".into(), ..Default::default() })?.unwrap().0;
            let put = |g: i64, t: i64, d: i64| {
                c.execute("INSERT INTO sessions (profile_id, game_id, started_at, ended_at, duration_s) VALUES (1, ?1, ?2, ?3, ?4)", params![g, t, t + d, d])
            };
            put(a, ts(2025, 12, 31, 23), 600)?; // otro año
            put(a, ts(2026, 3, 1, 21), 7200)?;
            put(a, ts(2026, 3, 2, 21), 3600)?;
            put(b, ts(2026, 3, 3, 21), 1800)?;
            put(b, ts(2026, 7, 10, 9), 900)?;
            Ok(())
        })
        .unwrap();
        let y = db.with(|c| year(c, 1, 2026)).unwrap();
        assert_eq!((y.sessions, y.games_played, y.days_played), (4, 2, 4));
        assert_eq!(y.total_seconds, 13_500);
        assert_eq!(y.top_games[0].title, "Hades");
        assert_eq!(y.top_month, Some(2)); // marzo
        assert_eq!(y.favorite_hour, Some(21));
        assert_eq!(y.best_streak, 3);
        assert_eq!(y.longest_session, 7200);
        assert_eq!(y.first_game.as_deref(), Some("Hades"));
        let empty = db.with(|c| year(c, 1, 2024)).unwrap();
        assert_eq!((empty.sessions, empty.top_month), (0, None));
    }
}
