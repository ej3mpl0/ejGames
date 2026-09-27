//! Partidas: lanzar, seguir procesos, registrar sesiones, Discord y modo ahorro.

pub mod admin;
pub mod gamepad_home;
pub mod launch;
pub mod tracker;

use crate::db::models::Game;
use crate::db::repo;
use crate::discord::Presence;
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Si el juego se vuelve a abrir solo en este tiempo, se sigue como otra partida.
const RELAUNCH_WINDOW: Duration = Duration::from_secs(30);
/// ejGames vuelve a los pocos segundos de cerrar el juego, no al instante: si
/// el juego se reinicia, la ventana no se cuela entre medias.
const RESTORE_AFTER: Duration = Duration::from_secs(3);

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

impl RunningGame {
    fn new(game_id: i64, profile_id: i64, title: &str) -> Self {
        RunningGame {
            game_id,
            profile_id,
            title: title.to_string(),
            started_at: None,
            cancel: Arc::new(AtomicBool::new(false)),
            recorded: Arc::new(AtomicBool::new(false)),
        }
    }
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
    fn insert(&self, r: RunningGame) {
        self.running.lock().insert(r.game_id, r);
    }
    /// En marcha o lanzándose.
    fn busy(&self, id: i64) -> bool {
        self.running.lock().contains_key(&id) || self.starting.lock().contains(&id)
    }
    fn idle(&self) -> bool {
        self.running.lock().is_empty() && self.starting.lock().is_empty()
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

    let run = RunningGame::new(game_id, profile_id, &game.title);
    let (cancel, recorded) = (run.cancel.clone(), run.recorded.clone());
    st.sessions.insert(run);
    crate::events::game_state(st, game_id, "launching", None);

    let behavior = profile.launch_behavior.clone();
    apply_behavior(st, &behavior);

    let target = tracker::Target::from_game(&game, launched.pid);
    let discovery = if launched.via_uri { Duration::from_secs(300) } else { Duration::from_secs(120) };
    let discord = if st.settings.get().discord_enabled && profile.discord_enabled && game.discord_enabled {
        let id = crate::settings::DISCORD_CLIENT_ID.to_string();
        Some(DiscordCtx {
            small_icon: crate::discord::app_icon(&st.http, &id).await,
            cover_url: st.db.with(|c| repo::selected_remote_url(c, game_id, "cover")).ok().flatten(),
            hide: profile.discord_hide_names,
            id,
        })
    } else {
        None
    };
    let track = Track { st: st.clone(), game, profile_id, behavior, discord };
    std::thread::Builder::new()
        .name(format!("ejg-track-{game_id}"))
        .spawn(move || track.run(target, discovery, cancel, recorded))?;
    Ok(())
}

fn apply_behavior(st: &Arc<AppState>, behavior: &str) {
    match behavior {
        "saver" => crate::lifecycle::enter_saver(st),
        "minimize" => crate::lifecycle::minimize(st),
        _ => {}
    }
}

struct DiscordCtx {
    id: String,
    cover_url: Option<String>,
    small_icon: Option<String>,
    hide: bool,
}

/// Seguimiento de las partidas de un juego (en su propio hilo).
struct Track {
    st: Arc<AppState>,
    game: Game,
    profile_id: i64,
    behavior: String,
    discord: Option<DiscordCtx>,
}

impl Track {
    fn run(self, mut target: tracker::Target, mut discovery: Duration, mut cancel: Arc<AtomicBool>, mut recorded: Arc<AtomicBool>) {
        let (st, id) = (&self.st, self.game.id);
        loop {
            let outcome = self.session(&target, discovery, &cancel, &recorded);
            if !matches!(outcome, tracker::Outcome::Played(..)) {
                self.restore_window();
                return;
            }
            // La partida ya está guardada y a la vista. Si el juego vuelve a
            // abrirse solo, se sigue como otra partida.
            let mut restored = false;
            let again = tracker::reappears(
                &target,
                RELAUNCH_WINDOW,
                || st.sessions.busy(id),
                |t| {
                    if !restored && t >= RESTORE_AFTER {
                        restored = true;
                        self.restore_window();
                    }
                },
            );
            if !again || !st.sessions.claim(id) {
                if !restored {
                    self.restore_window();
                }
                return;
            }
            tracing::info!("«{}» se ha vuelto a abrir: nueva partida", self.game.title);
            let run = RunningGame::new(id, self.profile_id, &self.game.title);
            (cancel, recorded) = (run.cancel.clone(), run.recorded.clone());
            st.sessions.insert(run);
            st.sessions.release(id);
            crate::events::game_state(st, id, "launching", None);
            if restored {
                apply_behavior(st, &self.behavior);
            }
            target.launched_pid = None;
            discovery = Duration::from_secs(20);
        }
    }

    /// Una partida: esperar al juego, seguirlo y guardar la sesión al cerrarlo.
    fn session(&self, target: &tracker::Target, discovery: Duration, cancel: &AtomicBool, recorded: &AtomicBool) -> tracker::Outcome {
        let (st, game_id, profile_id) = (&self.st, self.game.id, self.profile_id);
        let pad_stop = Arc::new(AtomicBool::new(false));
        let outcome = tracker::run(target.clone(), discovery, cancel, |started| {
            if let Some(r) = st.sessions.running.lock().get_mut(&game_id) {
                r.started_at = Some(started);
            }
            crate::events::game_state(st, game_id, "running", Some(started));
            if let Some(d) = &self.discord {
                st.discord.set(
                    &d.id,
                    Presence {
                        title: if d.hide { "Un juego".into() } else { self.game.title.clone() },
                        details: Some("Jugando desde ejGames".into()),
                        state: None,
                        start: started,
                        image_url: if d.hide { None } else { d.cover_url.clone() },
                        small_image_url: d.small_icon.clone(),
                    },
                );
            }
            crate::overlay::session_started(st, &self.game, profile_id, started, target.clone());
            crate::achievements::watch(st.clone(), game_id, profile_id, pad_stop.clone());
            if st.settings.get().gamepad_home_button {
                let st_pad = st.clone();
                // En juegos de Steam el botón Guía es del overlay de Steam.
                let guide = self.game.source != "steam";
                gamepad_home::spawn(pad_stop.clone(), guide, move |ev| crate::overlay::pad_event(&st_pad, ev));
            }
        });
        pad_stop.store(true, Ordering::Relaxed);
        crate::overlay::session_ended(st, game_id);
        if self.discord.is_some() {
            st.discord.clear();
        }
        let played = match outcome {
            tracker::Outcome::Played(s, e) | tracker::Outcome::Cancelled(Some((s, e))) => Some((s, e)),
            _ => None,
        };
        if let Some((s, e)) = played {
            if e - s >= 5 && !recorded.swap(true, Ordering::SeqCst) {
                if let Err(err) = st.db.with(|c| repo::record_session(c, profile_id, game_id, s, e)) {
                    tracing::warn!("sesión: {err:#}");
                }
            }
        }
        st.sessions.running.lock().remove(&game_id);
        crate::events::game_state(st, game_id, "stopped", played.map(|p| p.1 - p.0));
        crate::events::library_changed(st, vec![game_id]);
        outcome
    }

    /// Con el último juego cerrado, ejGames vuelve (si se minimizó o se cerró
    /// para ahorrar).
    fn restore_window(&self) {
        if self.st.sessions.idle() && matches!(self.behavior.as_str(), "saver" | "minimize") {
            crate::lifecycle::show_main(&self.st);
        }
    }
}
