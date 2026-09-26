//! Eventos Rust → host. Si la ventana no existe (modo ahorro) no pasa nada.

use crate::state::AppState;
use serde_json::json;
use std::sync::atomic::{AtomicI64, Ordering};
use tauri::Emitter;

pub fn library_changed(st: &AppState, ids: Vec<i64>) {
    let _ = st.app.emit("library:changed", json!({ "ids": ids }));
}

pub fn library_reset(st: &AppState) {
    let _ = st.app.emit("library:changed", json!({ "full": true }));
}

pub fn meta_progress(st: &AppState) {
    let (done, total) = st.meta.progress();
    let _ = st.app.emit("meta:progress", json!({ "done": done, "total": total }));
}

static LAST_SCAN_EMIT: AtomicI64 = AtomicI64::new(0);

pub fn scan_progress(st: &AppState, phase: &str, done: usize, total: usize, current: &str) {
    let ms = chrono::Utc::now().timestamp_millis();
    if done < total && ms - LAST_SCAN_EMIT.load(Ordering::Relaxed) < 80 {
        return;
    }
    LAST_SCAN_EMIT.store(ms, Ordering::Relaxed);
    let _ = st.app.emit(
        "scan:progress",
        json!({ "phase": phase, "done": done, "total": total, "current": current }),
    );
}

pub fn game_state(st: &AppState, game_id: i64, state: &str, value: Option<i64>) {
    let _ = st.app.emit("game:state", json!({ "gameId": game_id, "state": state, "value": value }));
}

pub fn toast(st: &AppState, kind: &str, message: impl Into<String>) {
    let _ = st.app.emit("app:toast", json!({ "kind": kind, "message": message.into() }));
}

pub fn theme_changed(st: &AppState, id: &str) {
    let _ = st.app.emit("theme:changed", json!({ "id": id }));
}
