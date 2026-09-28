//! Planificador y progreso.
//!
//! `reconcile` decide qué debe estar bajando, compartiendo o parado según la
//! cola, los huecos (`maxActiveDownloads`), si hay un juego abierto (pausar al
//! jugar) o un instalador, y lleva el motor a ese estado. El ticker lee el
//! progreso, detecta lo que termina, guarda cada 30 s y apaga el motor cuando
//! no queda nada.

use super::{emit_changed, engine, forget, win, Live};
use crate::db::models::DownloadRow;
use crate::db::repo;
use crate::events;
use crate::state::AppState;
use librqbit::{AddTorrent, AddTorrentOptions, Magnet, Session, TorrentStatsState};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// Pares vistos al pedir la lista de archivos: arrancan la descarga al instante.
static PEERS: LazyLock<Mutex<HashMap<i64, Vec<SocketAddr>>>> = LazyLock::new(Default::default);

pub fn remember_peers(id: i64, peers: Vec<SocketAddr>) {
    PEERS.lock().insert(id, peers);
}

#[derive(Debug, PartialEq)]
enum Want {
    Run,
    Seed,
    /// Esperando (sin hueco, jugando o instalando): parado en el motor si estaba.
    Hold(&'static str),
    HoldSeed,
    UserPaused,
    Forget,
    Leave,
}

fn plan(rows: &[DownloadRow], slots: usize, block: Option<&'static str>) -> Vec<Want> {
    let mut used = 0;
    rows.iter()
        .map(|r| match r.state.as_str() {
            "downloading" | "queued" => {
                if used < slots {
                    used += 1;
                    Want::Run
                } else {
                    Want::Hold(block.unwrap_or("queue"))
                }
            }
            "seeding" if block.is_some() => Want::HoldSeed,
            "seeding" => Want::Seed,
            "paused" => Want::UserPaused,
            "completed" | "installing" | "installed" => Want::Forget,
            _ => Want::Leave,
        })
        .collect()
}

fn id20(hash: &str) -> Option<librqbit_core::Id20> {
    hash.parse().ok()
}

/// Lleva el motor al estado que toca. Nunca falla: los errores van al log.
pub async fn reconcile(st: &Arc<AppState>) {
    let _g = st.downloads.plan.lock().await;
    if let Err(e) = reconcile_inner(st).await {
        tracing::warn!("descargas: {e:#}");
        events::toast(st, "error", format!("Descargas: {e:#}"));
    }
    kick(st);
}

async fn reconcile_inner(st: &Arc<AppState>) -> anyhow::Result<()> {
    let set = st.settings.get();
    let rows = st.db.with(repo::list_downloads)?;
    let playing = st.sessions.any();
    st.downloads.playing.store(playing, Ordering::Relaxed);
    if !playing {
        st.downloads.allow_while_playing.store(false, Ordering::Relaxed);
    }
    let block = if st.downloads.installing.lock().is_some() {
        Some("install")
    } else if set.pause_while_playing && playing && !st.downloads.allow_while_playing.load(Ordering::Relaxed) {
        Some("playing")
    } else {
        None
    };
    let slots = if block.is_some() { 0 } else { set.max_active_downloads.clamp(1, 5) as usize };
    let wants = plan(&rows, slots, block);
    let need_engine = wants.iter().any(|w| matches!(w, Want::Run | Want::Seed));

    let session = if need_engine { Some(st.downloads.engine.ensure(st).await?) } else { st.downloads.engine.get() };
    let mut changed = false;
    for (r, w) in rows.iter().zip(&wants) {
        // Estado en la BD.
        let (state, reason) = match w {
            Want::Run => ("downloading", None),
            Want::Hold(why) => ("queued", Some(*why)),
            Want::Seed => ("seeding", None),
            Want::HoldSeed => ("seeding", block),
            _ => (r.state.as_str(), r.pause_reason.as_deref()),
        };
        if state != r.state || reason != r.pause_reason.as_deref() {
            st.db.with(|c| repo::set_download_state(c, r.id, state, reason, None))?;
            changed = true;
        }
        let Some(s) = &session else { continue };
        let Some(hash) = id20(&r.info_hash) else { continue };
        let handle = s.get(hash.into());
        match w {
            Want::Run | Want::Seed => match handle {
                None => {
                    if let Err(e) = add(st, s, r).await {
                        tracing::warn!("añadir torrent {}: {e:#}", r.title);
                        st.db.with(|c| repo::set_download_state(c, r.id, "error", None, Some(&format!("{e:#}"))))?;
                        changed = true;
                    }
                }
                Some(h) => {
                    if matches!(h.stats().state, TorrentStatsState::Error) {
                        // Reintento de una que falló: fuera del motor y otra vez dentro.
                        drop(h);
                        forget(st, &r.info_hash).await;
                        if let Err(e) = add(st, s, r).await {
                            st.db.with(|c| repo::set_download_state(c, r.id, "error", None, Some(&format!("{e:#}"))))?;
                            changed = true;
                        }
                    } else if matches!(h.stats().state, TorrentStatsState::Paused) {
                        // Por el estado real, no por `is_paused()`: si se reanuda
                        // mientras comprueba archivos, librqbit deja la marca en
                        // "no pausado" y el torrent parado. Si aún está
                        // comprobando, el ticker lo arranca al terminar.
                        s.unpause(&h).await?;
                    }
                }
            },
            Want::Hold(_) | Want::HoldSeed | Want::UserPaused => {
                if let Some(h) = handle {
                    if !matches!(h.stats().state, TorrentStatsState::Paused | TorrentStatsState::Error) {
                        let _ = s.pause(&h).await;
                    }
                }
            }
            Want::Forget => {
                if handle.is_some() {
                    drop(handle);
                    forget(st, &r.info_hash).await;
                }
            }
            Want::Leave => {}
        }
    }
    // Torrents del motor que ya no están en la cola (borrados, restos).
    if let Some(s) = &session {
        let known: std::collections::HashSet<String> = rows.iter().map(|r| r.info_hash.clone()).collect();
        let stray: Vec<String> = s.with_torrents(|it| it.map(|(_, h)| h.info_hash().as_string()).filter(|h| !known.contains(h)).collect());
        for h in stray {
            forget(st, &h).await;
        }
    }
    if changed {
        emit_changed(st);
    }
    Ok(())
}

async fn add(st: &Arc<AppState>, s: &Arc<Session>, r: &DownloadRow) -> anyhow::Result<()> {
    let torrent = st.db.with(|c| repo::download_torrent(c, r.id))?;
    let trackers = Magnet::parse(&r.magnet).map(|m| m.trackers).unwrap_or_default();
    let peers = PEERS.lock().remove(&r.id);
    let opts = AddTorrentOptions {
        only_files: Some(r.selected_files.clone()),
        output_folder: Some(r.output_dir.clone()),
        overwrite: true,
        trackers: Some(trackers),
        initial_peers: peers,
        ..Default::default()
    };
    s.add_torrent(AddTorrent::from_bytes(torrent), Some(opts)).await?;
    // Lo subido antes (librqbit cuenta desde cero cada vez que se añade).
    st.downloads.live.lock().entry(r.id).or_default().uploaded_base = r.uploaded_bytes.max(0) as u64;
    Ok(())
}

// ───────────────────────────── ticker ─────────────────────────────

/// Arranca el bucle de progreso si no está en marcha.
pub fn kick(st: &Arc<AppState>) {
    if st.downloads.ticker_on.swap(true, Ordering::SeqCst) {
        return;
    }
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        ticker(&st).await;
        st.downloads.ticker_on.store(false, Ordering::SeqCst);
    });
}

fn window_visible(st: &AppState) -> bool {
    st.app
        .get_webview_window(crate::lifecycle::MAIN)
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}

fn has_pending(st: &AppState) -> bool {
    st.downloads.keep_alive(st) || st.downloads.preparing.load(Ordering::SeqCst) > 0
}

async fn ticker(st: &Arc<AppState>) {
    let mut last_save = Instant::now();
    let mut idle_since: Option<Instant> = None;
    let mut stalled_since: Option<Instant> = None;
    let mut tooltip = String::new();
    loop {
        let visible = window_visible(st);
        tokio::time::sleep(Duration::from_secs(if visible { 1 } else { 5 })).await;

        // Un juego se abrió o se cerró: replanificar (pausar/reanudar al jugar).
        if st.sessions.any() != st.downloads.playing.load(Ordering::Relaxed) {
            reconcile(st).await;
        }

        let rows = st.db.with(repo::list_downloads).unwrap_or_default();
        let working = rows.iter().any(|r| matches!(r.state.as_str(), "downloading" | "seeding") && r.pause_reason.is_none());
        let preparing = st.downloads.preparing.load(Ordering::SeqCst) > 0;

        if let Some(s) = st.downloads.engine.get() {
            let stats = s.with_torrents(|it| it.map(|(_, h)| (h.info_hash().as_string(), h.stats())).collect::<Vec<_>>());
            let mut finished = Vec::new();
            let mut any_peer = false;
            let mut replan = false;
            {
                let mut live = st.downloads.live.lock();
                for (hash, t) in &stats {
                    let Some(r) = rows.iter().find(|r| &r.info_hash == hash) else { continue };
                    let l = live.entry(r.id).or_insert_with(Live::default);
                    l.done = t.progress_bytes;
                    l.total = t.total_bytes;
                    l.uploaded = t.uploaded_bytes;
                    l.checking = matches!(t.state, TorrentStatsState::Initializing { .. });
                    match &t.live {
                        Some(lv) => {
                            l.down_bps = lv.download_speed.as_bytes();
                            l.up_bps = lv.upload_speed.as_bytes();
                            l.peers = lv.snapshot.peer_stats.live;
                            let left = t.total_bytes.saturating_sub(t.progress_bytes);
                            l.eta = (l.down_bps > 0 && left > 0).then(|| left / l.down_bps);
                        }
                        None => {
                            l.down_bps = 0;
                            l.up_bps = 0;
                            l.peers = 0;
                            l.eta = None;
                        }
                    }
                    // Debería estar en marcha y el motor lo tiene parado.
                    let should_run = matches!(r.state.as_str(), "downloading" | "seeding") && r.pause_reason.is_none();
                    if should_run && matches!(t.state, TorrentStatsState::Paused) {
                        replan = true;
                    }
                    if r.state == "downloading" {
                        any_peer |= l.peers > 0 || l.down_bps > 0 || l.checking;
                        if t.finished && !l.checking {
                            finished.push(r.clone());
                        } else if matches!(t.state, TorrentStatsState::Error) {
                            let msg = friendly_error(t.error.as_deref().unwrap_or("error desconocido"));
                            let _ = st.db.with(|c| repo::set_download_state(c, r.id, "error", None, Some(&msg)));
                            finished.push(DownloadRow { state: "error".into(), ..r.clone() });
                        }
                    }
                    // Compartiendo hasta un ratio.
                    if r.state == "seeding" && st.settings.get().seed_policy == "ratio" {
                        let up = l.uploaded_base + l.uploaded;
                        if l.total > 0 && up as f64 >= st.settings.get().seed_ratio * l.total as f64 {
                            let _ = st.db.with(|c| repo::set_download_state(c, r.id, "completed", None, None));
                            finished.push(DownloadRow { state: "ratio".into(), ..r.clone() });
                        }
                    }
                }
            }
            for r in &finished {
                if r.state == "downloading" {
                    on_finished(st, r).await;
                }
            }
            if !finished.is_empty() {
                save_progress(st);
                reconcile(st).await;
                emit_changed(st);
            } else if replan {
                reconcile(st).await;
            }

            // Sin ningún par durante 3 minutos: el DHT de librqbit a veces se
            // queda muerto en Windows; reiniciar el motor lo arregla.
            let downloading = rows.iter().any(|r| r.state == "downloading");
            if downloading && !any_peer && st.downloads.engine.uptime().unwrap_or_default() > Duration::from_secs(180) {
                let since = *stalled_since.get_or_insert_with(Instant::now);
                if since.elapsed() > Duration::from_secs(180) {
                    tracing::warn!("descargas sin pares desde hace 3 min: reinicio el motor");
                    save_progress(st);
                    st.downloads.engine.stop().await;
                    reconcile(st).await;
                    stalled_since = None;
                }
            } else {
                stalled_since = None;
            }

            if visible && (working || !stats.is_empty()) {
                if let Ok(items) = super::list(st) {
                    let progress: Vec<_> = items.into_iter().filter(|i| matches!(i.state.as_str(), "downloading" | "seeding" | "queued")).collect();
                    let _ = st.app.emit("downloads:progress", progress);
                }
            }
            if last_save.elapsed() > Duration::from_secs(30) {
                save_progress(st);
                last_save = Instant::now();
            }
            if working && st.settings.get().prevent_sleep {
                win::keep_awake();
            }

            // Sin nada que hacer durante un minuto: se para el motor.
            if working || preparing {
                idle_since = None;
            } else if idle_since.get_or_insert_with(Instant::now).elapsed() > Duration::from_secs(60) {
                save_progress(st);
                st.downloads.engine.stop().await;
                idle_since = None;
            }
        }

        let text = tray_text(st, &rows);
        if text != tooltip {
            if let Some(t) = st.app.tray_by_id("main") {
                let _ = t.set_tooltip(Some(text.as_str()));
            }
            tooltip = text;
        }

        if st.downloads.engine.get().is_none() && !has_pending(st) {
            break;
        }
    }
}

fn tray_text(st: &AppState, rows: &[DownloadRow]) -> String {
    let live = st.downloads.live.lock();
    let active: Vec<&DownloadRow> = rows.iter().filter(|r| r.state == "downloading").collect();
    if active.is_empty() {
        return "ejGames".into();
    }
    let (mut done, mut total, mut speed) = (0u64, 0u64, 0u64);
    for r in &active {
        if let Some(l) = live.get(&r.id) {
            done += l.done;
            total += l.total;
            speed += l.down_bps;
        }
    }
    let pct = if total > 0 { done * 100 / total } else { 0 };
    let s: String = format!("ejGames · Descargando {pct} % · {:.1} MB/s", speed as f64 / 1_048_576.0);
    s.chars().take(127).collect()
}

fn friendly_error(e: &str) -> String {
    let l = e.to_lowercase();
    if l.contains("os error 112") || l.contains("not enough space") || l.contains("no space") {
        "El disco está lleno".into()
    } else if l.contains("os error 5") || l.contains("access is denied") || l.contains("acceso denegado") {
        "Windows no deja escribir en la carpeta (¿antivirus?)".into()
    } else if l.contains("os error 32") {
        "Otro programa tiene abiertos los archivos (¿antivirus?)".into()
    } else {
        e.chars().take(200).collect()
    }
}

async fn on_finished(st: &Arc<AppState>, r: &DownloadRow) {
    let s = st.settings.get();
    let state = if s.seed_policy == "never" { "completed" } else { "seeding" };
    let _ = st.db.with(|c| repo::set_download_state(c, r.id, state, None, None));
    tracing::info!("descarga terminada: {}", r.title);
    events::toast(st, "ok", format!("«{}» descargado. Ya puedes instalarlo.", r.title));
    let _ = st.app.emit("downloads:finished", serde_json::json!({ "id": r.id, "title": r.title }));
    if s.auto_install && !st.sessions.any() && st.downloads.installing.lock().is_none() {
        let st2 = st.clone();
        let id = r.id;
        tauri::async_runtime::spawn(async move {
            if let Err(e) = super::install::install(&st2, id).await {
                events::toast(&st2, "error", format!("{e:#}"));
            }
        });
    }
}

/// Guarda el progreso de lo que está en el motor.
pub fn save_progress(st: &AppState) {
    let live = st.downloads.live.lock().clone();
    let _ = st.db.with(|c| {
        for (id, l) in &live {
            if l.total > 0 {
                repo::set_download_progress(c, *id, l.done as i64, l.total as i64, (l.uploaded_base + l.uploaded) as i64)?;
            }
        }
        Ok(())
    });
}

/// Aplica ajustes que cambian en caliente (límites) o reinician el motor
/// (puerto, UPnP, uTP, trackers, proxy, conexiones).
pub async fn settings_changed(st: &Arc<AppState>, before: &crate::settings::Settings, after: &crate::settings::Settings) {
    if let Some(s) = st.downloads.engine.get() {
        if before.max_download_kbps != after.max_download_kbps || before.max_upload_kbps != after.max_upload_kbps {
            engine::apply_limits(&s, after.max_download_kbps, after.max_upload_kbps);
        }
        let restart = before.listen_port != after.listen_port
            || before.upnp != after.upnp
            || before.utp != after.utp
            || before.extra_trackers != after.extra_trackers
            || before.peer_limit != after.peer_limit
            || before.torrent_proxy != after.torrent_proxy;
        if restart {
            drop(s);
            save_progress(st);
            st.downloads.engine.stop().await;
        }
    }
    if before.max_active_downloads != after.max_active_downloads
        || before.pause_while_playing != after.pause_while_playing
        || before.seed_policy != after.seed_policy
        || st.downloads.engine.get().is_none()
    {
        if before.seed_policy != after.seed_policy && after.seed_policy == "never" {
            // Deja de compartir lo que ya terminó.
            let _ = st.db.with(|c| c.execute("UPDATE downloads SET state = 'completed', pause_reason = NULL WHERE state = 'seeding'", []).map(|_| ()));
        }
        reconcile(st).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(state: &str) -> DownloadRow {
        DownloadRow { state: state.into(), ..Default::default() }
    }

    #[test]
    fn plans_the_queue() {
        let rows = vec![row("downloading"), row("queued"), row("paused"), row("seeding"), row("completed"), row("error")];
        assert_eq!(
            plan(&rows, 1, None),
            vec![Want::Run, Want::Hold("queue"), Want::UserPaused, Want::Seed, Want::Forget, Want::Leave]
        );
        assert_eq!(plan(&rows, 2, None)[1], Want::Run);
        let playing = plan(&rows, 0, Some("playing"));
        assert_eq!(playing[0], Want::Hold("playing"));
        assert_eq!(playing[3], Want::HoldSeed);
    }
}
