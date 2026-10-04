//! Metadatos: identificar el juego (Steam/IGDB/SteamGridDB), aplicar datos y arte,
//! y descargar el arte principal. Todo en segundo plano vía la cola.

pub mod hltb;
pub mod igdb;
pub mod queue;
pub mod ratelimit;
pub mod sgdb;
pub mod steam;

use crate::db::models::Game;
use crate::db::repo;
use crate::library::names::{clean_title, is_generic_name, normalize, similarity, split_camel};
use crate::library::pe_info;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone, Default)]
pub struct Metadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub short_description: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub release_date: Option<String>,
    pub genres: Vec<String>,
    pub tags: Vec<String>,
    pub rating: Option<i64>,
    pub steam_appid: Option<i64>,
    pub sgdb_id: Option<i64>,
    pub igdb_id: Option<i64>,
    pub art: Vec<ArtItem>,
    /// URLs de logo a probar en orden (Steam no dice cuál existe).
    pub logo_candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtItem {
    pub kind: String,
    pub url: String,
    pub source: String,
    pub title: Option<String>,
    pub position: i64,
    pub extra: Option<Value>,
}

impl ArtItem {
    pub fn new(kind: &str, url: String, source: &str) -> Self {
        ArtItem { kind: kind.into(), url, source: source.into(), title: None, position: 0, extra: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub provider: String,
    pub id: i64,
    pub name: String,
    pub image: Option<String>,
    pub year: Option<String>,
}

/// Confianza mínima para aplicar datos de una coincidencia automática.
const MIN_APPLY: f64 = 0.82;

/// Nombres con los que buscar un juego (título, ProductName, stem, carpeta).
/// Puede salir vacía (p. ej. un "Game.exe" genérico): quien la use lo comprueba.
pub fn search_names(g: &Game) -> Vec<String> {
    let mut v = vec![g.title.clone()];
    if g.source == "folder" {
        if let Some(exe) = &g.exe_path {
            let p = Path::new(exe);
            if let Some(pn) = pe_info::read(p).and_then(|i| i.product_name).filter(|n| !is_generic_name(n)) {
                v.push(pn);
            }
            if let Some(stem) = p.file_stem() {
                v.push(clean_title(&split_camel(&stem.to_string_lossy())));
            }
        }
        if let Some(dir) = g.install_dir.as_deref().and_then(|d| Path::new(d).file_name()) {
            v.push(clean_title(&dir.to_string_lossy()));
        }
    }
    let mut seen = vec![];
    v.retain(|n| {
        let k = normalize(n);
        if k.len() < 2 || seen.contains(&k) || is_generic_name(n) {
            false
        } else {
            seen.push(k);
            true
        }
    });
    v
}

fn best_candidate<'a>(cands: &'a [Candidate], names: &[String]) -> Option<(&'a Candidate, f64)> {
    cands
        .iter()
        .map(|c| {
            let s = names.iter().map(|n| similarity(n, &c.name)).fold(0.0, f64::max);
            (c, s)
        })
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
}

async fn tag_names(st: &AppState, lang: &str) -> HashMap<i64, String> {
    let key = format!("tags_{lang}");
    let cached = st.db.with(|c| repo::cache_get(c, "steam", &key, 30 * 86400)).ok().flatten();
    if let Some(json) = cached {
        if let Ok(m) = serde_json::from_str::<HashMap<i64, String>>(&json) {
            return m;
        }
    }
    match st.providers.steam.tag_names(&st.http, lang).await {
        Ok(m) => {
            if let Ok(j) = serde_json::to_string(&m) {
                let _ = st.db.with(|c| repo::cache_put(c, "steam", &key, &j));
            }
            m
        }
        Err(e) => {
            tracing::warn!("tag list: {e:#}");
            HashMap::new()
        }
    }
}

struct Resolved {
    game: Game,
    appid: Option<i64>,
    confidence: f64,
}

/// Procesa un lote de juegos. `forced`: appid/igdb elegidos por el usuario.
pub async fn process_batch(st: &Arc<AppState>, ids: &[i64], forced: &HashMap<i64, (String, i64)>) -> anyhow::Result<()> {
    let settings = st.settings.get();
    let (lang, cc) = (settings.language.clone(), settings.country.clone());
    let games: Vec<Game> = {
        let ids = ids.to_vec();
        let st2 = st.clone();
        tauri::async_runtime::spawn_blocking(move || {
            st2.db.with(|c| Ok(ids.iter().filter_map(|id| repo::get_game(c, *id).ok()).collect::<Vec<_>>()))
        })
        .await??
    };

    // 1) Identificar appid de Steam.
    let mut resolved: Vec<Resolved> = vec![];
    for g in games {
        if let Some((prov, id)) = forced.get(&g.id) {
            let appid = (prov == "steam").then_some(*id);
            resolved.push(Resolved { game: g, appid, confidence: 1.0 });
            continue;
        }
        // Los juegos de consola no están en Steam: se salta a IGDB (por su sistema).
        if g.platform.is_some() {
            resolved.push(Resolved { game: g, appid: None, confidence: 0.0 });
            continue;
        }
        // Un appid guardado es seguro salvo que venga de una coincidencia dudosa
        // ("review"): esa se vuelve a buscar.
        if let Some(a) = g.steam_appid.filter(|_| g.meta_status != "review") {
            resolved.push(Resolved { game: g, appid: Some(a), confidence: 1.0 });
            continue;
        }
        let names = {
            let g2 = g.clone();
            tauri::async_runtime::spawn_blocking(move || search_names(&g2)).await?
        };
        let mut best: Option<(i64, f64)> = None;
        for n in names.iter().take(3) {
            match st.providers.steam.search(&st.http, n, &lang, &cc).await {
                Ok(cands) => {
                    if let Some((c, s)) = best_candidate(&cands, &names) {
                        if best.map(|b| s > b.1).unwrap_or(true) {
                            best = Some((c.id, s));
                        }
                    }
                }
                Err(e) => tracing::warn!("steam search '{n}': {e:#}"),
            }
            if best.map(|b| b.1 >= 0.9).unwrap_or(false) {
                break;
            }
        }
        match best {
            // Por debajo de 0.82 es más fácil acertar a otro juego que al bueno:
            // mejor sin datos que con los de otro (queda para elegir a mano).
            Some((id, s)) if s >= MIN_APPLY => resolved.push(Resolved { game: g, appid: Some(id), confidence: s }),
            _ => resolved.push(Resolved { game: g, appid: None, confidence: best.map(|b| b.1).unwrap_or(0.0) }),
        }
    }

    // 2) GetItems en lote.
    let appids: Vec<i64> = resolved.iter().filter_map(|r| r.appid).collect();
    let items = if appids.is_empty() {
        HashMap::new()
    } else {
        st.providers.steam.get_items(&st.http, &appids, &lang, &cc).await.unwrap_or_else(|e| {
            tracing::warn!("GetItems: {e:#}");
            HashMap::new()
        })
    };
    let tags = if items.is_empty() { HashMap::new() } else { tag_names(st, &lang).await };

    // 3) Por juego: Steam → IGDB → SteamGridDB.
    for r in resolved {
        let gid = r.game.id;
        let forced_igdb = forced.get(&gid).filter(|(p, _)| p == "igdb").map(|(_, id)| *id);
        let mut meta = r.appid.and_then(|a| items.get(&a)).map(|it| steam::to_metadata(it, &tags));
        let mut status = if meta.is_some() {
            if r.confidence >= 0.9 { "matched" } else { "review" }
        } else {
            "failed"
        };
        let has_igdb = !settings.igdb_client_id.is_empty() && !settings.igdb_client_secret.is_empty();
        if (meta.is_none() || forced_igdb.is_some()) && has_igdb {
            match igdb_lookup(st, &r.game, forced_igdb).await {
                Ok(Some((m, conf))) => {
                    status = if forced_igdb.is_some() || conf >= 0.9 { "matched" } else { "review" };
                    meta = Some(m);
                }
                Ok(None) => {}
                Err(e) => tracing::warn!("igdb: {e:#}"),
            }
        }
        let mut meta = meta.unwrap_or_default();
        if !settings.sgdb_key.is_empty() {
            if let Err(e) = sgdb_fill(st, &r.game, &mut meta).await {
                tracing::warn!("sgdb: {e:#}");
            }
            if status == "failed" && meta.art.iter().any(|a| a.kind == "cover") {
                status = "review";
            }
        }
        if forced.contains_key(&gid) {
            status = "manual";
        }
        if let Err(e) = apply(st, gid, &meta, status, r.confidence, forced.contains_key(&gid)).await {
            tracing::warn!("apply {gid}: {e:#}");
        }
        crate::events::library_changed(st, vec![gid]);
    }
    Ok(())
}

async fn igdb_lookup(st: &AppState, g: &Game, forced: Option<i64>) -> anyhow::Result<Option<(Metadata, f64)>> {
    let s = st.settings.get();
    let (id, secret) = (s.igdb_client_id.as_str(), s.igdb_client_secret.as_str());
    let (gid, conf) = match forced {
        Some(f) => (f, 1.0),
        None => {
            let names = search_names(g);
            let Some(first) = names.first() else { return Ok(None) };
            let plat = g.platform.as_deref().and_then(crate::emulation::platform).map(|p| p.igdb);
            let cands = st.providers.igdb.search_on(&st.http, id, secret, first, plat).await?;
            match best_candidate(&cands, &names) {
                Some((c, s)) if s >= MIN_APPLY => (c.id, s),
                _ => return Ok(None),
            }
        }
    };
    let m = st.providers.igdb.details(&st.http, id, secret, gid).await?;
    Ok(m.map(|m| (m, conf)))
}

/// Completa con SteamGridDB el arte que falte (portada, hero, logo, icono).
async fn sgdb_fill(st: &AppState, g: &Game, m: &mut Metadata) -> anyhow::Result<()> {
    let key = st.settings.get().sgdb_key;
    let need: Vec<&str> = ["cover", "hero", "logo", "icon"]
        .into_iter()
        .filter(|k| !m.art.iter().any(|a| a.kind == *k) && !(*k == "logo" && !m.logo_candidates.is_empty()))
        .collect();
    if need.is_empty() {
        return Ok(());
    }
    let appid = m.steam_appid.or(g.steam_appid);
    let mut sg_id = g.sgdb_id;
    if sg_id.is_none() {
        if let Some(a) = appid {
            sg_id = st.providers.sgdb.game_by_steam(&st.http, &key, a).await?;
        }
    }
    if sg_id.is_none() {
        let names = search_names(g);
        let Some(first) = names.first() else { return Ok(()) };
        let cands = st.providers.sgdb.search(&st.http, &key, first).await?;
        if let Some((c, s)) = best_candidate(&cands, &names) {
            if s >= 0.8 {
                sg_id = Some(c.id);
            }
        }
    }
    let Some(sid) = sg_id else { return Ok(()) };
    m.sgdb_id = Some(sid);
    for kind in need {
        let mut arts = st.providers.sgdb.art(&st.http, &key, sid, kind).await.unwrap_or_default();
        arts.truncate(1);
        m.art.extend(arts);
    }
    Ok(())
}

/// Guarda metadatos + filas de media y descarga el arte seleccionado.
async fn apply(st: &Arc<AppState>, gid: i64, m: &Metadata, status: &str, conf: f64, replace: bool) -> anyhow::Result<()> {
    let st2 = st.clone();
    let mut m2 = m.clone();
    // Coincidencia dudosa: arte e información sí, pero ni el título ni el appid
    // (si se guardara, la próxima vez se daría por seguro).
    if status == "review" {
        m2.title = None;
        m2.steam_appid = None;
    }
    let status = status.to_string();
    let to_download = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Vec<repo::MediaRecord>> {
        st2.db.with_mut(|c| {
            let tx = c.transaction()?;
            if status != "failed" {
                repo::apply_metadata(&tx, gid, &m2)?;
            }
            repo::set_meta_status(&tx, gid, &status, Some(conf))?;
            if replace || status != "failed" {
                repo::delete_media_by_source(&tx, gid, &["steam", "sgdb", "igdb"])?;
            }
            // Si el usuario eligió arte propio, lo nuevo entra sin seleccionar.
            let mut first: HashMap<String, bool> = HashMap::new();
            for a in &m2.art {
                let user_pick = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM media WHERE game_id = ?1 AND kind = ?2 AND selected = 1 AND source IN ('user','exe'))",
                        rusqlite::params![gid, a.kind],
                        |r| r.get::<_, bool>(0),
                    )
                    .unwrap_or(false);
                let is_first = !first.contains_key(&a.kind);
                first.insert(a.kind.clone(), true);
                let selected = is_first && !user_pick && !matches!(a.kind.as_str(), "screenshot" | "trailer");
                let selected = selected || (matches!(a.kind.as_str(), "screenshot" | "trailer"));
                repo::insert_media(&tx, gid, &a.kind, Some(&a.url), &a.source, selected, a.position, a.title.as_deref(), a.extra.as_ref())?;
            }
            // Logo de Steam: no se sabe cuál de las rutas existe; se prueban al descargar.
            if let Some((first_logo, alts)) = m2.logo_candidates.split_first() {
                let user_logo = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM media WHERE game_id = ?1 AND kind = 'logo' AND selected = 1)",
                        [gid],
                        |r| r.get::<_, bool>(0),
                    )
                    .unwrap_or(false);
                let extra = serde_json::json!({ "alts": alts });
                repo::insert_media(&tx, gid, "logo", Some(first_logo), "steam", !user_logo, 0, None, Some(&extra))?;
            }
            let installed: bool = tx.query_row("SELECT installed FROM games WHERE id = ?1", [gid], |r| r.get(0)).unwrap_or(true);
            tx.commit()?;
            // Sin instalar: nada por adelantado; el arte se baja la primera vez que se ve.
            if installed {
                repo::pending_downloads(c, gid)
            } else {
                Ok(vec![])
            }
        })
    })
    .await??;

    for rec in to_download {
        if let Err(e) = crate::media::download::download_record(st, &rec).await {
            tracing::debug!("descarga {:?}: {e:#}", rec.remote_url);
        }
    }
    Ok(())
}

/// Búsqueda manual para el editor de juego (Steam + IGDB + SteamGridDB).
pub async fn search_all(st: &AppState, term: &str) -> Vec<Candidate> {
    let s = st.settings.get();
    let mut out = st.providers.steam.search(&st.http, term, &s.language, &s.country).await.unwrap_or_default();
    if !s.igdb_client_id.is_empty() && !s.igdb_client_secret.is_empty() {
        out.extend(
            st.providers
                .igdb
                .search(&st.http, &s.igdb_client_id, &s.igdb_client_secret, term)
                .await
                .unwrap_or_default(),
        );
    }
    let norm = normalize(term);
    out.sort_by(|a, b| {
        similarity(&b.name, &norm)
            .partial_cmp(&similarity(&a.name, &norm))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// Arte alternativo para elegir en el editor (SteamGridDB + lo ya conocido).
pub async fn art_options(st: &AppState, game_id: i64, kind: &str) -> anyhow::Result<Vec<ArtItem>> {
    let g = st.db.with(|c| repo::get_game(c, game_id))?;
    let mut out: Vec<ArtItem> = vec![];
    let key = st.settings.get().sgdb_key;
    if !key.is_empty() {
        let mut sid = g.sgdb_id;
        if sid.is_none() {
            if let Some(a) = g.steam_appid {
                sid = st.providers.sgdb.game_by_steam(&st.http, &key, a).await.ok().flatten();
            }
        }
        if sid.is_none() {
            let cands = st.providers.sgdb.search(&st.http, &key, &g.title).await.unwrap_or_default();
            sid = best_candidate(&cands, std::slice::from_ref(&g.title)).filter(|(_, s)| *s > 0.75).map(|(c, _)| c.id);
        }
        if let Some(sid) = sid {
            out.extend(st.providers.sgdb.art(&st.http, &key, sid, kind).await.unwrap_or_default());
        }
    }
    Ok(out)
}
