//! Cuentas de ejGames: amigos, «jugando a…», perfiles y actividad, contra la
//! API de `server/`. Todo corre en el núcleo, así que sigue funcionando con
//! la ventana cerrada (modo ahorro): la presencia, el sondeo y los avisos de
//! amigos dentro del juego.
//!
//! La cuenta se liga a un perfil local (tabla `accounts`). Al entrar en ese
//! perfil se activa su sesión; el resto de perfiles no ven nada.

pub mod api;
pub mod auth;
pub mod summary;

use crate::state::AppState;
use api::{ApiError, Body};
use parking_lot::{Mutex, RwLock};
use reqwest::Method;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// Latido de presencia (el servidor da por desconectado a los 15 min).
const HEARTBEAT: i64 = 10 * 60;
const POLL_ACTIVE: u64 = 60;
const POLL_IDLE: u64 = 5 * 60;

#[derive(Clone)]
struct Session {
    profile_id: i64,
    user_id: i64,
    username: String,
    /// Vacío: la cuenta sigue ligada pero hay que volver a entrar.
    token: String,
    status: String,
    notify_online: bool,
    notify_playing: bool,
    rev: i64,
}

#[derive(Clone)]
struct Playing {
    title: String,
    since: i64,
}

#[derive(Default)]
pub struct Online {
    session: RwLock<Option<Session>>,
    /// Última respuesta de /v1/sync (con las URL de las imágenes).
    social: Mutex<Option<Value>>,
    wake: tokio::sync::Notify,
    playing: Mutex<Option<Playing>>,
    pending_activity: Mutex<Vec<Value>>,
    activity_timer: AtomicBool,
    loop_started: AtomicBool,
    last_beat: AtomicI64,
    offline: AtomicBool,
}

/// Lo que ve la interfaz (host y temas).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountState {
    /// Esta versión tiene servidor de cuentas.
    pub enabled: bool,
    pub profile_id: Option<i64>,
    /// El perfil tiene una cuenta ligada.
    pub linked: bool,
    pub username: Option<String>,
    pub user_id: Option<i64>,
    /// Ligada, pero la sesión caducó: hay que volver a entrar.
    pub needs_login: bool,
    /// online | away | invisible
    pub status: String,
    pub notify_online: bool,
    pub notify_playing: bool,
    /// El último intento no llegó al servidor.
    pub offline: bool,
    /// me, friends, incoming, outgoing, blocked, lastComment.
    pub social: Option<Value>,
}

type R<T> = Result<T, ApiError>;

fn err(message: &str) -> ApiError {
    ApiError { status: 400, code: "client".into(), message: message.into() }
}

fn internal(e: impl std::fmt::Display) -> ApiError {
    tracing::warn!("cuentas: {e}");
    ApiError { status: 500, code: "client".into(), message: format!("{e}") }
}

// ───────────────────────────── estado ─────────────────────────────

pub fn state(st: &AppState) -> AccountState {
    let s = st.online.session.read().clone();
    let profile_id = *st.profile.read();
    AccountState {
        enabled: api::enabled(),
        profile_id,
        linked: s.is_some(),
        username: s.as_ref().map(|s| s.username.clone()),
        user_id: s.as_ref().map(|s| s.user_id),
        needs_login: s.as_ref().map(|s| s.token.is_empty()).unwrap_or(false),
        status: s.as_ref().map(|s| s.status.clone()).unwrap_or_else(|| "online".into()),
        notify_online: s.as_ref().map(|s| s.notify_online).unwrap_or(true),
        notify_playing: s.as_ref().map(|s| s.notify_playing).unwrap_or(true),
        offline: st.online.offline.load(Ordering::Relaxed),
        social: if s.is_some() { st.online.social.lock().clone() } else { None },
    }
}

fn emit(st: &AppState) {
    let _ = st.app.emit("social:changed", state(st));
}

fn session(st: &AppState) -> R<Session> {
    let s = st.online.session.read().clone().ok_or_else(|| err("Este perfil no tiene cuenta. Entra o crea una."))?;
    if s.token.is_empty() {
        return Err(ApiError { status: 401, code: "no_session".into(), message: "La sesión ha caducado. Vuelve a entrar.".into() });
    }
    Ok(s)
}

/// Añade `avatarUrl`, `backgroundImageUrl` y `urls` (capturas de la vitrina)
/// a partir de los hashes: las imágenes llegan por ejg-media con caché.
fn with_urls(v: &mut Value) {
    match v {
        Value::Object(map) => {
            for (key, out) in [("avatar", "avatarUrl"), ("backgroundImage", "backgroundImageUrl")] {
                if let Some(url) = map.get(key).and_then(|h| h.as_str()).and_then(api::media_url) {
                    map.insert(out.into(), Value::String(crate::explore::images::proxy_trusted(url)));
                }
            }
            if map.get("type").and_then(|t| t.as_str()) == Some("screenshots") {
                let urls: Vec<Value> = map
                    .get("items")
                    .and_then(|i| i.as_array())
                    .map(|a| a.iter().filter_map(|h| h.as_str().and_then(api::media_url)).map(|u| Value::String(crate::explore::images::proxy_trusted(u))).collect())
                    .unwrap_or_default();
                map.insert("urls".into(), Value::Array(urls));
            }
            // Portadas de Steam y demás: por el proxy de siempre.
            if let Some(url) = map.get("cover").and_then(|c| c.as_str()).and_then(crate::explore::images::proxy) {
                map.insert("coverUrl".into(), Value::String(url));
            }
            if let Some(url) = map.get("icon").and_then(|c| c.as_str()).and_then(crate::explore::images::proxy) {
                map.insert("iconUrl".into(), Value::String(url));
            }
            if let Some(url) = map.get("header").and_then(|c| c.as_str()).and_then(crate::explore::images::proxy) {
                map.insert("headerUrl".into(), Value::String(url));
            }
            for (_, x) in map.iter_mut() {
                with_urls(x);
            }
        }
        Value::Array(a) => a.iter_mut().for_each(with_urls),
        _ => {}
    }
}

// ───────────────────────────── perfil local ↔ cuenta ─────────────────────────────

fn load(st: &AppState, profile_id: i64) -> Option<(Session, Option<Value>)> {
    let row = st
        .db
        .with(|c| {
            c.query_row(
                "SELECT user_id, username, token, status, notify_online, notify_playing, rev, cache FROM accounts WHERE profile_id = ?1",
                [profile_id],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Vec<u8>>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)? != 0,
                        r.get::<_, i64>(5)? != 0,
                        r.get::<_, i64>(6)?,
                        r.get::<_, Option<String>>(7)?,
                    ))
                },
            )
            .optional()
        })
        .ok()
        .flatten()?;
    let token = if row.2.is_empty() { String::new() } else { auth::unprotect(&row.2).ok().and_then(|b| String::from_utf8(b).ok()).unwrap_or_default() };
    let cache = row.7.and_then(|c| serde_json::from_str(&c).ok());
    Some((
        Session { profile_id, user_id: row.0, username: row.1, token, status: row.3, notify_online: row.4, notify_playing: row.5, rev: row.6 },
        cache,
    ))
}

/// Se ha entrado en un perfil (o se ha salido, con `None`).
pub fn on_profile(st: &Arc<AppState>, profile: Option<i64>) {
    let loaded = profile.and_then(|p| load(st, p));
    let changed = st.online.session.read().as_ref().map(|s| s.profile_id) != loaded.as_ref().map(|l| l.0.profile_id);
    if !changed {
        return;
    }
    let (session, cache) = match loaded {
        Some((s, c)) => (Some(s), c),
        None => (None, None),
    };
    *st.online.session.write() = session;
    *st.online.social.lock() = cache;
    st.online.last_beat.store(0, Ordering::Relaxed);
    emit(st);
    st.online.wake.notify_one();
}

fn link(st: &AppState, profile_id: i64, me: &Value, token: &str) -> R<()> {
    let enc = auth::protect(token.as_bytes()).map_err(internal)?;
    let user_id = me["id"].as_i64().ok_or_else(|| internal("respuesta sin id"))?;
    let username = me["username"].as_str().unwrap_or_default().to_string();
    st.db
        .with(|c| {
            c.execute(
                "INSERT INTO accounts (profile_id, user_id, username, token, linked_at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (profile_id) DO UPDATE SET user_id = excluded.user_id, username = excluded.username, token = excluded.token,
                   rev = CASE WHEN accounts.user_id = excluded.user_id THEN accounts.rev ELSE 0 END,
                   cache = CASE WHEN accounts.user_id = excluded.user_id THEN accounts.cache ELSE NULL END,
                   summary_hash = CASE WHEN accounts.user_id = excluded.user_id THEN accounts.summary_hash ELSE NULL END",
                params![profile_id, user_id, username, enc, crate::util::now()],
            )
            .map(|_| ())
        })
        .map_err(internal)?;
    // Recargar como si se entrara en el perfil.
    let loaded = load(st, profile_id);
    *st.online.session.write() = loaded.as_ref().map(|l| l.0.clone());
    *st.online.social.lock() = loaded.and_then(|l| l.1);
    st.online.last_beat.store(0, Ordering::Relaxed);
    Ok(())
}

fn active_profile(st: &AppState) -> R<i64> {
    st.profile.read().ok_or_else(|| err("Entra primero en un perfil."))
}

/// La sesión ya no vale: la cuenta queda ligada pero sin token.
fn drop_token(st: &AppState) {
    let pid = {
        let mut s = st.online.session.write();
        let Some(s) = s.as_mut() else { return };
        s.token.clear();
        s.profile_id
    };
    let _ = st.db.with(|c| c.execute("UPDATE accounts SET token = x'' WHERE profile_id = ?1", [pid]).map(|_| ()));
    emit(st);
}

/// Pasa por aquí toda llamada con sesión: si caducó, se marca.
async fn call(st: &AppState, method: Method, path: &str, body: Body<'_>) -> R<Option<Value>> {
    let s = session(st)?;
    let r = api::request(st, method, path, Some(&s.token), body).await;
    st.online.offline.store(matches!(&r, Err(e) if e.offline()), Ordering::Relaxed);
    if let Err(e) = &r {
        if e.session_gone() {
            drop_token(st);
        }
    }
    r
}

async fn call_json(st: &AppState, method: Method, path: &str, body: Body<'_>) -> R<Value> {
    call(st, method, path, body).await?.ok_or_else(|| internal("respuesta vacía"))
}

// ───────────────────────────── entrar, registrarse, recuperar ─────────────────────────────

fn check_password(p: &str) -> R<()> {
    if p.chars().count() < 8 {
        return Err(err("La contraseña tiene que tener al menos 8 caracteres."));
    }
    Ok(())
}

async fn derive(username: String, secret: String, recovery: bool) -> R<String> {
    tauri::async_runtime::spawn_blocking(move || auth::derive(&username, &secret, recovery)).await.map_err(internal)?.map_err(internal)
}

async fn after_login(st: &Arc<AppState>, profile_id: i64, v: Value) -> R<AccountState> {
    let token = v["token"].as_str().ok_or_else(|| internal("respuesta sin token"))?.to_string();
    link(st, profile_id, &v["me"], &token)?;
    st.online.wake.notify_one();
    let _ = sync_now(st).await;
    emit(st);
    Ok(state(st))
}

/// Crea la cuenta y la liga al perfil activo. Devuelve el código de recuperación
/// (solo se enseña ahora: el servidor no lo tiene).
pub async fn register(st: &Arc<AppState>, username: &str, password: &str, display_name: &str) -> R<(AccountState, String)> {
    let profile_id = active_profile(st)?;
    check_password(password)?;
    let code = auth::new_recovery_code();
    let key = derive(username.into(), password.into(), false).await?;
    let recovery = derive(username.into(), auth::normalize_code(&code), true).await?;
    let v = api::json(st, Method::POST, "/v1/register", None, Body::Json(&json!({ "username": username.trim(), "key": key, "recovery": recovery, "displayName": display_name.trim() }))).await?;
    Ok((after_login(st, profile_id, v).await?, code))
}

pub async fn login(st: &Arc<AppState>, username: &str, password: &str) -> R<AccountState> {
    let profile_id = active_profile(st)?;
    let key = derive(username.into(), password.into(), false).await?;
    let v = api::json(st, Method::POST, "/v1/login", None, Body::Json(&json!({ "username": username.trim(), "key": key }))).await?;
    after_login(st, profile_id, v).await
}

/// Contraseña nueva con el código de recuperación. Devuelve el código nuevo.
pub async fn recover(st: &Arc<AppState>, username: &str, code: &str, password: &str) -> R<(AccountState, String)> {
    let profile_id = active_profile(st)?;
    if !auth::valid_code(code) {
        return Err(err("El código de recuperación tiene 20 letras y números."));
    }
    check_password(password)?;
    let new_code = auth::new_recovery_code();
    let recovery = derive(username.into(), auth::normalize_code(code), true).await?;
    let key = derive(username.into(), password.into(), false).await?;
    let new_recovery = derive(username.into(), auth::normalize_code(&new_code), true).await?;
    let v = api::json(
        st,
        Method::POST,
        "/v1/recover",
        None,
        Body::Json(&json!({ "username": username.trim(), "recovery": recovery, "key": key, "newRecovery": new_recovery })),
    )
    .await?;
    Ok((after_login(st, profile_id, v).await?, new_code))
}

/// Cierra la sesión y desliga la cuenta de este perfil.
pub async fn logout(st: &Arc<AppState>) -> R<AccountState> {
    if let Ok(s) = session(st) {
        let _ = put_presence(st, "offline").await;
        let _ = api::request(st, Method::POST, "/v1/logout", Some(&s.token), Body::None).await;
    }
    if let Some(s) = st.online.session.write().take() {
        let _ = st.db.with(|c| c.execute("DELETE FROM accounts WHERE profile_id = ?1", [s.profile_id]).map(|_| ()));
    }
    *st.online.social.lock() = None;
    emit(st);
    Ok(state(st))
}

pub async fn change_password(st: &Arc<AppState>, old: &str, new: &str) -> R<()> {
    let s = session(st)?;
    check_password(new)?;
    let key = derive(s.username.clone(), old.into(), false).await?;
    let new_key = derive(s.username.clone(), new.into(), false).await?;
    call_json(st, Method::POST, "/v1/password", Body::Json(&json!({ "key": key, "newKey": new_key }))).await?;
    Ok(())
}

/// Código de recuperación nuevo (el viejo deja de valer).
pub async fn new_recovery_code(st: &Arc<AppState>, password: &str) -> R<String> {
    let s = session(st)?;
    let code = auth::new_recovery_code();
    let key = derive(s.username.clone(), password.into(), false).await?;
    let rc = derive(s.username.clone(), auth::normalize_code(&code), true).await?;
    call_json(st, Method::POST, "/v1/password", Body::Json(&json!({ "key": key, "newRecovery": rc }))).await?;
    Ok(code)
}

pub async fn delete_account(st: &Arc<AppState>, password: &str) -> R<AccountState> {
    let s = session(st)?;
    let key = derive(s.username.clone(), password.into(), false).await?;
    call_json(st, Method::DELETE, "/v1/me", Body::Json(&json!({ "key": key }))).await?;
    let _ = st.db.with(|c| c.execute("DELETE FROM accounts WHERE user_id = ?1", [s.user_id]).map(|_| ()));
    *st.online.session.write() = None;
    *st.online.social.lock() = None;
    emit(st);
    Ok(state(st))
}

/// Estado (online, ausente, invisible) y avisos de amigos.
pub async fn set_prefs(st: &Arc<AppState>, status: Option<String>, notify_online: Option<bool>, notify_playing: Option<bool>) -> R<AccountState> {
    let s = {
        let mut g = st.online.session.write();
        let s = g.as_mut().ok_or_else(|| err("Este perfil no tiene cuenta."))?;
        if let Some(v) = status.filter(|v| ["online", "away", "invisible"].contains(&v.as_str())) {
            s.status = v;
        }
        if let Some(v) = notify_online {
            s.notify_online = v;
        }
        if let Some(v) = notify_playing {
            s.notify_playing = v;
        }
        s.clone()
    };
    st.db
        .with(|c| {
            c.execute(
                "UPDATE accounts SET status = ?2, notify_online = ?3, notify_playing = ?4 WHERE profile_id = ?1",
                params![s.profile_id, s.status, s.notify_online as i64, s.notify_playing as i64],
            )
        })
        .map_err(internal)?;
    if !s.token.is_empty() {
        let _ = put_presence(st, &s.status).await;
    }
    emit(st);
    Ok(state(st))
}

// ───────────────────────────── sondeo ─────────────────────────────

fn save_cache(st: &AppState, profile_id: i64, rev: i64, v: &Value) {
    let _ = st.db.with(|c| c.execute("UPDATE accounts SET rev = ?2, cache = ?3 WHERE profile_id = ?1", params![profile_id, rev, v.to_string()]).map(|_| ()));
}

/// Una vuelta de /v1/sync. Si hay cambios, se guardan, se avisa a la interfaz
/// y salen los avisos de amigos.
pub async fn sync_now(st: &Arc<AppState>) -> R<bool> {
    let s = session(st)?;
    let rev = if st.online.social.lock().is_some() { s.rev } else { 0 };
    let Some(mut v) = call(st, Method::GET, &format!("/v1/sync?rev={rev}"), Body::None).await? else {
        return Ok(false);
    };
    with_urls(&mut v);
    let new_rev = v["rev"].as_i64().unwrap_or(0);
    let old = st.online.social.lock().replace(v.clone());
    if let Some(sess) = st.online.session.write().as_mut() {
        sess.rev = new_rev;
    }
    save_cache(st, s.profile_id, new_rev, &v);
    if let Some(old) = old {
        friend_notices(st, &s, &old, &v);
    }
    emit(st);
    Ok(true)
}

fn friend_notices(st: &Arc<AppState>, s: &Session, old: &Value, new: &Value) {
    let before: HashMap<i64, &Value> = old["friends"].as_array().into_iter().flatten().filter_map(|f| Some((f["id"].as_i64()?, f))).collect();
    let mut notices: Vec<(String, Option<String>, Option<String>)> = vec![];
    for f in new["friends"].as_array().into_iter().flatten() {
        let Some(id) = f["id"].as_i64() else { continue };
        let name = f["name"].as_str().unwrap_or("Un amigo").to_string();
        let icon = f["avatarUrl"].as_str().map(str::to_string);
        let (p, q) = (&f["presence"], before.get(&id).map(|o| &o["presence"]));
        let game = p["game"].as_str();
        let was_offline = q.map(|q| q["status"] == "offline").unwrap_or(true);
        if s.notify_playing && game.is_some() && q.map(|q| q["game"].as_str() != game).unwrap_or(true) {
            notices.push((format!("{name} está jugando"), game.map(str::to_string), icon));
        } else if s.notify_online && was_offline && p["status"] != "offline" && before.contains_key(&id) {
            notices.push((format!("{name} se ha conectado"), None, icon));
        }
    }
    let known: Vec<i64> = old["incoming"].as_array().into_iter().flatten().filter_map(|r| r["id"].as_i64()).collect();
    for r in new["incoming"].as_array().into_iter().flatten() {
        if r["id"].as_i64().map(|id| !known.contains(&id)).unwrap_or(false) {
            let name = r["name"].as_str().unwrap_or("Alguien");
            notices.push((format!("{name} quiere ser tu amigo"), Some("Solicitud de amistad".into()), r["avatarUrl"].as_str().map(str::to_string)));
        }
    }
    for (title, body, icon) in notices.into_iter().take(4) {
        notify(st, title, body, icon);
    }
}

/// Dentro del juego, un aviso del overlay; fuera, uno en la ventana de ejGames.
fn notify(st: &Arc<AppState>, title: String, body: Option<String>, icon: Option<String>) {
    if st.sessions.any() {
        crate::overlay::notify_friend(st, title, body, icon);
    } else {
        let _ = st.app.emit("social:notice", json!({ "title": title, "body": body, "icon": icon }));
    }
}

fn window_visible(st: &AppState) -> bool {
    st.app
        .get_webview_window(crate::lifecycle::MAIN)
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}

/// Bucle de fondo: latido de presencia, sondeo y actividad pendiente.
pub fn start(st: &Arc<AppState>) {
    if !api::enabled() || st.online.loop_started.swap(true, Ordering::SeqCst) {
        return;
    }
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        // Al arrancar, la sesión del perfil recordado (si entró solo).
        loop {
            let has = st.online.session.read().as_ref().map(|s| !s.token.is_empty()).unwrap_or(false);
            if has {
                let t = crate::util::now();
                if t - st.online.last_beat.load(Ordering::Relaxed) >= HEARTBEAT {
                    st.online.last_beat.store(t, Ordering::Relaxed);
                    let status = st.online.session.read().as_ref().map(|s| s.status.clone()).unwrap_or_default();
                    let first = put_presence(&st, &status).await.is_ok();
                    if first {
                        schedule_summary(&st, 5);
                    }
                }
                if let Err(e) = sync_now(&st).await {
                    if !e.offline() && !e.session_gone() {
                        tracing::warn!("cuentas: sincronizar: {e}");
                    }
                }
            }
            let wait = if window_visible(&st) || st.sessions.any() { POLL_ACTIVE } else { POLL_IDLE };
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(wait)) => {}
                _ = st.online.wake.notified() => {}
            }
        }
    });
}

/// Pide un sondeo ya (tras una acción).
pub fn poke(st: &AppState) {
    st.online.wake.notify_one();
}

// ───────────────────────────── presencia y partidas ─────────────────────────────

async fn put_presence(st: &AppState, status: &str) -> R<()> {
    let playing = st.online.playing.lock().clone();
    let body = match &playing {
        Some(p) if status != "offline" => json!({ "status": status, "game": p.title, "since": p.since }),
        _ => json!({ "status": status }),
    };
    call(st, Method::PUT, "/v1/presence", Body::Json(&body)).await?;
    Ok(())
}

fn spawn_presence(st: &Arc<AppState>) {
    if session(st).is_err() {
        return;
    }
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        let status = st.online.session.read().as_ref().map(|s| s.status.clone()).unwrap_or_default();
        st.online.last_beat.store(crate::util::now(), Ordering::Relaxed);
        if let Err(e) = put_presence(&st, &status).await {
            tracing::debug!("cuentas: presencia: {e}");
        }
    });
}

/// Empieza una partida: los amigos ven «jugando a…».
pub fn game_started(st: &Arc<AppState>, title: &str, started_at: i64) {
    *st.online.playing.lock() = Some(Playing { title: title.to_string(), since: started_at });
    spawn_presence(st);
}

/// Acaba la partida: presencia, actividad («jugó 1 h 20 min») y resumen.
pub fn game_ended(st: &Arc<AppState>, title: &str, start: i64, end: i64, cover: Option<String>) {
    *st.online.playing.lock() = None;
    spawn_presence(st);
    let minutes = (end - start) / 60;
    if minutes >= 5 {
        queue_activity(st, json!({ "kind": "played", "data": { "game": title, "minutes": minutes, "cover": cover } }));
    }
    schedule_summary(st, 20);
}

/// Logro desbloqueado (y juego completado si era el último).
pub fn achievement(st: &Arc<AppState>, game: &str, name: &str, icon: Option<String>, rarity: Option<f64>, progress: Option<(i64, i64)>) {
    if session(st).is_err() {
        return;
    }
    queue_activity(st, json!({ "kind": "achievement", "data": { "game": game, "name": name, "icon": icon, "rarity": rarity } }));
    if let Some((got, total)) = progress {
        if total > 0 && got == total {
            queue_activity(st, json!({ "kind": "completed", "data": { "game": game } }));
        }
    }
}

/// La actividad se junta unos segundos (varios logros seguidos = una petición).
fn queue_activity(st: &Arc<AppState>, item: Value) {
    if session(st).is_err() {
        return;
    }
    st.online.pending_activity.lock().push(item);
    if st.online.activity_timer.swap(true, Ordering::SeqCst) {
        return;
    }
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        st.online.activity_timer.store(false, Ordering::SeqCst);
        let items: Vec<Value> = std::mem::take(&mut *st.online.pending_activity.lock());
        for chunk in items.chunks(20) {
            if let Err(e) = call(&st, Method::POST, "/v1/activity", Body::Json(&json!({ "items": chunk }))).await {
                tracing::debug!("cuentas: actividad: {e}");
            }
        }
    });
}

fn schedule_summary(st: &Arc<AppState>, delay_s: u64) {
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay_s)).await;
        if let Err(e) = upload_summary(&st).await {
            tracing::debug!("cuentas: resumen: {e}");
        }
    });
}

/// Sube el resumen de la biblioteca si ha cambiado.
pub async fn upload_summary(st: &Arc<AppState>) -> R<()> {
    let s = session(st)?;
    let (member_since, friends) = {
        let social = st.online.social.lock();
        let v = social.as_ref();
        (
            v.and_then(|v| v["me"]["createdAt"].as_i64()).unwrap_or_else(crate::util::now),
            v.and_then(|v| v["friends"].as_array().map(|a| a.len() as i64)).unwrap_or(0),
        )
    };
    let st2 = st.clone();
    let (hash, mut body) = tauri::async_runtime::spawn_blocking(move || summary::build(&st2, s.profile_id, member_since, friends)).await.map_err(internal)?.map_err(internal)?;
    let saved: Option<String> = st.db.with(|c| c.query_row("SELECT summary_hash FROM accounts WHERE profile_id = ?1", [s.profile_id], |r| r.get(0))).ok().flatten();
    if saved.as_deref() == Some(hash.as_str()) {
        return Ok(());
    }
    body["hash"] = Value::String(hash.clone());
    call_json(st, Method::PUT, "/v1/summary", Body::Json(&body)).await?;
    let _ = st.db.with(|c| c.execute("UPDATE accounts SET summary_hash = ?2 WHERE profile_id = ?1", params![s.profile_id, hash]).map(|_| ()));
    poke(st);
    Ok(())
}

/// Al cerrar ejGames: desconectado (rápido; si no llega, lo hace el servidor a los 15 min).
pub fn on_exit(st: &Arc<AppState>) {
    if session(st).is_err() {
        return;
    }
    let st = st.clone();
    let _ = tauri::async_runtime::block_on(async move { tokio::time::timeout(Duration::from_secs(2), put_presence(&st, "offline")).await });
}

// ───────────────────────────── perfil propio ─────────────────────────────

/// Guarda cambios del perfil (solo los campos que llegan).
pub async fn update_profile(st: &Arc<AppState>, patch: Value) -> R<Value> {
    let mut me = call_json(st, Method::PUT, "/v1/profile", Body::Json(&patch)).await?;
    with_urls(&mut me);
    if let Some(v) = st.online.social.lock().as_mut() {
        v["me"] = me.clone();
    }
    emit(st);
    poke(st);
    Ok(me)
}

/// Límites de cada tipo de imagen: tamaño máximo en bytes y cómo se encaja.
fn image_spec(kind: &str) -> Option<(usize, u32, u32, bool)> {
    match kind {
        // (bytes, ancho, alto, recortar para llenar)
        "avatar" => Some((240 * 1024, 184, 184, true)),
        "background" => Some((1500 * 1024, 1920, 1080, true)),
        "shot" => Some((450 * 1024, 1280, 720, false)),
        _ => None,
    }
}

fn encode_image(path: &std::path::Path, kind: &str) -> anyhow::Result<Vec<u8>> {
    let (max, w, h, fill) = image_spec(kind).ok_or_else(|| anyhow::anyhow!("tipo de imagen no válido"))?;
    let img = image::ImageReader::open(path)?.with_guessed_format()?.decode()?;
    let img = if fill { img.resize_to_fill(w, h, image::imageops::FilterType::Lanczos3) } else { img.resize(w, h, image::imageops::FilterType::Lanczos3) };
    let rgb = img.to_rgb8();
    for q in [88u8, 80, 72, 64, 55, 45] {
        let mut out = std::io::Cursor::new(Vec::new());
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, q).encode_image(&rgb)?;
        if out.get_ref().len() <= max {
            return Ok(out.into_inner());
        }
    }
    anyhow::bail!("La imagen pesa demasiado incluso comprimida")
}

/// Sube una imagen del disco (avatar, fondo o captura para la vitrina).
/// Devuelve su hash y la URL para enseñarla ya.
pub async fn upload_image(st: &Arc<AppState>, kind: &str, path: &str) -> R<Value> {
    if image_spec(kind).is_none() {
        return Err(err("Tipo de imagen no válido."));
    }
    let (p, k) = (std::path::PathBuf::from(path), kind.to_string());
    let bytes = tauri::async_runtime::spawn_blocking(move || encode_image(&p, &k))
        .await
        .map_err(internal)?
        .map_err(|e| err(&format!("No se pudo leer la imagen: {e}")))?;
    let v = call_json(st, Method::POST, &format!("/v1/media?kind={kind}"), Body::Bytes(bytes, "image/jpeg")).await?;
    let hash = v["hash"].as_str().unwrap_or_default().to_string();
    let url = api::media_url(&hash).map(crate::explore::images::proxy_trusted);
    Ok(json!({ "hash": hash, "url": url }))
}

// ───────────────────────────── amigos, perfiles, comentarios, actividad ─────────────────────────────

pub async fn friend(st: &Arc<AppState>, action: &str, target: Value) -> R<AccountState> {
    const ACTIONS: [&str; 6] = ["request", "accept", "decline", "remove", "block", "unblock"];
    if !ACTIONS.contains(&action) {
        return Err(err("Acción no válida."));
    }
    let body = if action == "request" {
        let who = target.as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| err("Escribe su nombre de usuario o su código de amigo."))?;
        json!({ "user": who })
    } else {
        json!({ "id": target.as_i64().ok_or_else(|| err("Usuario no válido."))? })
    };
    call_json(st, Method::POST, &format!("/v1/friends/{action}"), Body::Json(&body)).await?;
    let _ = sync_now(st).await;
    Ok(state(st))
}

pub async fn user(st: &Arc<AppState>, id: i64) -> R<Value> {
    let mut v = call_json(st, Method::GET, &format!("/v1/users/{id}"), Body::None).await?;
    with_urls(&mut v);
    Ok(v)
}

pub async fn comments(st: &Arc<AppState>, id: i64, before: Option<i64>) -> R<Value> {
    let q = before.map(|b| format!("?before={b}")).unwrap_or_default();
    let mut v = call_json(st, Method::GET, &format!("/v1/users/{id}/comments{q}"), Body::None).await?;
    with_urls(&mut v);
    Ok(v)
}

pub async fn post_comment(st: &Arc<AppState>, id: i64, text: &str) -> R<()> {
    let text = text.trim();
    if text.is_empty() {
        return Err(err("Escribe algo."));
    }
    call_json(st, Method::POST, &format!("/v1/users/{id}/comments"), Body::Json(&json!({ "text": text }))).await?;
    Ok(())
}

pub async fn delete_comment(st: &Arc<AppState>, id: i64) -> R<()> {
    call_json(st, Method::DELETE, &format!("/v1/comments/{id}"), Body::None).await?;
    Ok(())
}

pub async fn feed(st: &Arc<AppState>, before: Option<i64>) -> R<Value> {
    let q = before.map(|b| format!("?before={b}")).unwrap_or_default();
    let mut v = call_json(st, Method::GET, &format!("/v1/feed{q}"), Body::None).await?;
    with_urls(&mut v);
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_urls_are_added() {
        std::env::set_var("EJG_API_URL", "http://127.0.0.1:8787");
        let h = "ab".repeat(32);
        let mut v = json!({
            "friends": [{ "id": 1, "avatar": h, "presence": { "status": "online" } }],
            "profile": { "showcases": [{ "type": "screenshots", "items": [h, "nope"] }] }
        });
        with_urls(&mut v);
        assert!(v["friends"][0]["avatarUrl"].as_str().unwrap().starts_with("http://ejg-media.localhost/x/"));
        assert_eq!(v["profile"]["showcases"][0]["urls"].as_array().unwrap().len(), 1);
    }
}
