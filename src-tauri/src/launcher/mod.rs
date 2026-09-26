//! Partidas: lanzar, seguir procesos, registrar sesiones, Discord y modo ahorro.

pub mod gamepad_home;
pub mod launch;
pub mod tracker;

use crate::db::repo;
use crate::discord::Presence;
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningGame {
    pub game_id: i64,
    pub profile_id: i64,
    pub title: String,
    pub started_at: Option<i64>,
    #[serde(skip)]
    pub cancel: Arc<AtomicBool>,
    /// La sesión ya se guardó (el tracker o al salir de ejGames): solo una vez.
    #[serde(skip)]
    pub recorded: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Sessions {
    running: Mutex<HashMap<i64, RunningGame>>,
    /// Juegos que se están lanzando (entre la comprobación y el alta).
    starting: Mutex<HashSet<i64>>,
}

impl Sessions {
    /// Reserva el juego para lanzarlo. false si ya está en marcha o lanzándose
    /// (p. ej. doble clic en "Jugar").
    fn claim(&self, id: i64) -> bool {
        let running = self.running.lock();
        let mut starting = self.starting.lock();
        !running.contains_key(&id) && starting.insert(id)
    }
    fn release(&self, id: i64) {
        self.starting.lock().remove(&id);
    }
    pub fn list(&self) -> Vec<RunningGame> {
        self.running.lock().values().cloned().collect()
    }
    pub fn is_running(&self, id: i64) -> bool {
        self.running.lock().contains_key(&id)
    }
    pub fn any(&self) -> bool {
        !self.running.lock().is_empty()
    }
    pub fn stop_tracking(&self, id: i64) {
        if let Some(r) = self.running.lock().get(&id) {
            r.cancel.store(true, Ordering::Relaxed);
        }
    }
}

/// Guarda las sesiones en curso (al salir de ejGames con juegos abiertos).
pub fn finish_all(st: &AppState) {
    let now = crate::util::now();
    let list: Vec<RunningGame> = st.sessions.running.lock().values().cloned().collect();
    for r in list {
        r.cancel.store(true, Ordering::Relaxed);
        if let Some(start) = r.started_at {
            if now - start >= 5 && !r.recorded.swap(true, Ordering::SeqCst) {
                if let Err(e) = st.db.with(|c| repo::record_session(c, r.profile_id, r.game_id, start, now)) {
                    tracing::warn!("sesión al salir: {e:#}");
                }
            }
        }
    }
    st.discord.clear();
}

pub async fn play(st: &Arc<AppState>, game_id: i64, profile_id: i64) -> anyhow::Result<()> {
    if !st.sessions.claim(game_id) {
        anyhow::bail!("El juego ya está en marcha");
    }
    let r = play_inner(st, game_id, profile_id).await;
    st.sessions.release(game_id);
    r
}

async fn play_inner(st: &Arc<AppState>, game_id: i64, profile_id: i64) -> anyhow::Result<()> {
    let (game, profile) = st.db.with(|c| Ok((repo::get_game(c, game_id)?, repo::get_profile(c, profile_id)?)))?;
    if !game.installed {
        let uri = game
            .install_uri
            .clone()
            .or_else(|| game.steam_appid.map(|a| format!("steam://install/{a}")))
            .ok_or_else(|| anyhow::anyhow!("No se sabe cómo instalar este juego"))?;
        use tauri_plugin_opener::OpenerExt;
        st.app.opener().open_url(uri, None::<&str>).map_err(|e| anyhow::anyhow!("{e}"))?;
        crate::events::toast(st, "info", format!("Abriendo la tienda para instalar {}…", game.title));
        crate::events::game_state(st, game_id, "installing", None);
        return Ok(());
    }
    let g2 = game.clone();
    let launched = tauri::async_runtime::spawn_blocking(move || launch::launch(&g2)).await??;
    st.db.with(|c| repo::bump_launch(c, profile_id, game_id))?;
    crate::events::library_changed(st, vec![game_id]);

    let cancel = Arc::new(AtomicBool::new(false));
    let recorded = Arc::new(AtomicBool::new(false));
    st.sessions.running.lock().insert(
        game_id,
        RunningGame {
            game_id,
            profile_id,
            title: game.title.clone(),
            started_at: None,
            cancel: cancel.clone(),
            recorded: recorded.clone(),
        },
    );
    crate::events::game_state(st, game_id, "launching", None);

    let behavior = profile.launch_behavior.clone();
    match behavior.as_str() {
        "saver" => crate::lifecycle::enter_saver(st),
        "minimize" => crate::lifecycle::minimize(st),
        _ => {}
    }

    let target = tracker::Target::from_game(&game, launched.pid);
    let discovery = if launched.via_uri { Duration::from_secs(300) } else { Duration::from_secs(120) };
    let st2 = st.clone();
    let settings = st.settings.get();
    let cover_url = st.db.with(|c| repo::selected_remote_url(c, game_id, "cover")).ok().flatten();
    let discord_on = profile.discord_enabled && game.discord_enabled;
    let discord_id = settings.discord_id();
    let small_icon = if discord_on { crate::discord::app_icon(&st.http, &discord_id).await } else { None };
    let hide = profile.discord_hide_names;
    let title = game.title.clone();
    let game2 = game.clone();

    std::thread::Builder::new().name(format!("ejg-track-{game_id}")).spawn(move || {
        let pad_stop = Arc::new(AtomicBool::new(false));
        let st_start = st2.clone();
        let pad_stop2 = pad_stop.clone();
        let target2 = target.clone();
        let outcome = tracker::run(target, discovery, &cancel, move |started| {
            if let Some(r) = st_start.sessions.running.lock().get_mut(&game_id) {
                r.started_at = Some(started);
            }
            crate::events::game_state(&st_start, game_id, "running", Some(started));
            if discord_on {
                st_start.discord.set(
                    &discord_id,
                    Presence {
                        title: if hide { "Un juego".into() } else { title.clone() },
                        details: Some("Jugando desde ejGames".into()),
                        state: None,
                        start: started,
                        image_url: if hide { None } else { cover_url.clone() },
                        small_image_url: small_icon.clone(),
                    },
                );
            }
            crate::overlay::session_started(&st_start, &game2, profile_id, started, target2.clone());
            crate::achievements::watch(st_start.clone(), game_id, profile_id, pad_stop2.clone());
            if st_start.settings.get().gamepad_home_button {
                let st_pad = st_start.clone();
                // En juegos de Steam el botón Guía es del overlay de Steam.
                let guide = game2.source != "steam";
                gamepad_home::spawn(pad_stop2.clone(), guide, move |ev| crate::overlay::pad_event(&st_pad, ev));
            }
        });
        pad_stop.store(true, Ordering::Relaxed);
        crate::overlay::session_ended(&st2, game_id);
        if discord_on {
            st2.discord.clear();
        }
        let played = match outcome {
            tracker::Outcome::Played(s, e) | tracker::Outcome::Cancelled(Some((s, e))) => Some((s, e)),
            _ => None,
        };
        if let Some((s, e)) = played {
            if e - s >= 5 && !recorded.swap(true, Ordering::SeqCst) {
                if let Err(err) = st2.db.with(|c| repo::record_session(c, profile_id, game_id, s, e)) {
                    tracing::warn!("sesión: {err:#}");
                }
            }
        }
        st2.sessions.running.lock().remove(&game_id);
        crate::events::game_state(&st2, game_id, "stopped", played.map(|p| p.1 - p.0));
        crate::events::library_changed(&st2, vec![game_id]);
        if !st2.sessions.any() {
            match behavior.as_str() {
                "saver" | "minimize" => crate::lifecycle::show_main(&st2),
                _ => {}
            }
        }
    })?;
    Ok(())
}
