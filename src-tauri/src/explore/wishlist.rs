//! Lista de deseados de la tienda: los juegos que el usuario quiere, por perfil
//! local y solo en este PC. Se guarda la ficha tal cual la da la fuente y al
//! leerla se publica como las demás (estado al día e imágenes por ejg-media).

use super::{details_raw, publish, status_index, steamart, Repack};
use crate::state::AppState;
use rusqlite::params;
use serde::Serialize;
use std::sync::Arc;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WishItem {
    #[serde(flatten)]
    pub repack: Repack,
    /// Cuándo se añadió (segundos).
    pub added_at: i64,
}

fn profile(st: &AppState) -> anyhow::Result<i64> {
    st.profile.read().ok_or_else(|| anyhow::anyhow!("Entra primero en un perfil."))
}

/// La lista del perfil activo, la última añadida primero.
pub fn list(st: &Arc<AppState>) -> anyhow::Result<Vec<WishItem>> {
    let pid = profile(st)?;
    let rows: Vec<(String, i64)> = st.db.with(|c| {
        let mut q = c.prepare_cached("SELECT repack, added_at FROM wishlist WHERE profile_id = ?1 ORDER BY added_at DESC")?;
        let rows = q.query_map([pid], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    })?;
    let hide_adult = st.settings.get().explore_hide_adult;
    let idx = status_index(st);
    let mut missing = Vec::new();
    let mut out = Vec::new();
    for (json, added_at) in rows {
        let Ok(mut repack) = serde_json::from_str::<Repack>(&json) else { continue };
        if hide_adult && repack.adult {
            continue;
        }
        if !publish(st, &mut repack, &idx) {
            missing.push(repack.title.clone());
        }
        out.push(WishItem { repack, added_at });
    }
    steamart::resolve_later(st, missing);
    Ok(out)
}

/// Añade un juego (su ficha sale de la caché de la tienda o de la web).
pub async fn add(st: &Arc<AppState>, slug: &str) -> anyhow::Result<Vec<WishItem>> {
    let pid = profile(st)?;
    let d = details_raw(st, slug, false).await?;
    let json = serde_json::to_string(&d.repack)?;
    st.db.with(|c| {
        c.execute(
            "INSERT INTO wishlist (profile_id, slug, repack, added_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (profile_id, slug) DO UPDATE SET repack = excluded.repack",
            params![pid, slug, json, crate::util::now()],
        )
        .map(|_| ())
    })?;
    changed(st)
}

pub fn remove(st: &Arc<AppState>, slug: &str) -> anyhow::Result<Vec<WishItem>> {
    let pid = profile(st)?;
    st.db.with(|c| c.execute("DELETE FROM wishlist WHERE profile_id = ?1 AND slug = ?2", params![pid, slug]).map(|_| ()))?;
    changed(st)
}

/// Avisa al host (y de ahí al tema) con la lista nueva.
fn changed(st: &Arc<AppState>) -> anyhow::Result<Vec<WishItem>> {
    let items = list(st)?;
    let _ = st.app.emit("wishlist:changed", &items);
    Ok(items)
}
