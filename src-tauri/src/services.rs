//! Orquestación: escaneos, importación de tiendas y post-proceso de juegos nuevos.

use crate::db::models::NewGame;
use crate::db::repo;
use crate::library::{pe_info, scanner};
use crate::state::AppState;
use rayon::prelude::*;
use std::path::Path;
use std::sync::Arc;

/// Iconos del exe para juegos nuevos + cola de metadatos.
pub(crate) async fn after_new_games(st: &Arc<AppState>, new: Vec<(i64, Option<String>)>) {
    if new.is_empty() {
        return;
    }
    let st2 = st.clone();
    let ids: Vec<i64> = new.iter().map(|n| n.0).collect();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let icons: Vec<(i64, Vec<u8>)> = new
            .par_iter()
            .filter_map(|(id, exe)| Some((*id, pe_info::extract_icon_png(Path::new(exe.as_ref()?))?)))
            .collect();
        for (id, png) in icons {
            let Ok(hash) = crate::media::store::put(&st2.paths, &png, "png") else { continue };
            let _ = st2.db.with(|c| {
                let mid = repo::insert_media(c, id, "icon", None, "exe", true, 0, None, None)?;
                repo::set_media_file(c, mid, &hash, "png", None, None, None)
            });
        }
    })
    .await;
    st.meta.push_many(ids.clone());
    crate::events::library_changed(st, ids);
}

/// `incremental`: solo lo nuevo o cambiado (arranque, vigilancia de carpetas).
pub async fn scan_folder(st: &Arc<AppState>, folder_id: i64, incremental: bool) -> anyhow::Result<scanner::ScanReport> {
    let _guard = st.scan_lock.lock().await;
    let folder = st
        .db
        .with(repo::list_folders)?
        .into_iter()
        .find(|f| f.id == folder_id)
        .ok_or_else(|| anyhow::anyhow!("carpeta desconocida"))?;
    let st2 = st.clone();
    let name = folder.path.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_folder(&st2.db, &folder, incremental, &|done, total, cur| {
            crate::events::scan_progress(&st2, &name, done, total, cur);
        })
    })
    .await??;
    crate::events::scan_progress(st, "done", 1, 1, "");
    let new = report.new_games.clone();
    after_new_games(st, new).await;
    if report.missing > 0 {
        crate::events::library_reset(st);
    }
    Ok(report)
}

pub async fn scan_all(st: &Arc<AppState>, incremental: bool) -> anyhow::Result<usize> {
    let folders = st.db.with(repo::list_folders)?;
    let mut found = 0;
    for f in folders.iter().filter(|f| f.enabled) {
        match scan_folder(st, f.id, incremental).await {
            Ok(r) => found += r.found,
            Err(e) => crate::events::toast(st, "error", format!("{}: {e:#}", f.path)),
        }
    }
    Ok(found)
}

/// (id, es nuevo, exe, (horas importadas, última partida importada)).
type Upserted = (i64, bool, Option<String>, (Option<i64>, Option<i64>));

pub async fn import_stores(st: &Arc<AppState>, only: Option<Vec<String>>) -> anyhow::Result<usize> {
    let _guard = st.scan_lock.lock().await;
    let settings = st.settings.get();
    let stores: Vec<&'static str> = crate::import::enabled_stores(&settings)
        .into_iter()
        .filter(|s| only.as_ref().map(|o| o.iter().any(|x| x == s)).unwrap_or(true))
        .collect();
    crate::events::scan_progress(st, "stores", 0, 1, "");
    let with_owned = settings.import_uninstalled;
    // Juegos de tienda ya conocidos con su exe: no hace falta volver a analizar
    // su carpeta (el arranque no relee todos los exes).
    let known: std::collections::HashSet<(String, String)> = st
        .db
        .with(|c| {
            let mut q = c.prepare(
                "SELECT source, source_id, install_dir FROM games
                 WHERE source NOT IN ('folder', 'manual') AND exe_path IS NOT NULL AND install_dir IS NOT NULL",
            )?;
            let rows = q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
            rows.map(|r| r.map(|(s, id, dir)| (format!("{s}:{id}"), crate::util::norm_path(Path::new(&dir))))).collect()
        })
        .unwrap_or_default();
    let results = tauri::async_runtime::spawn_blocking(move || crate::import::run(&stores, with_owned, &known)).await?;
    let profile = *st.profile.read();
    let mut new: Vec<(i64, Option<String>)> = vec![];
    let mut total = 0;
    for r in results {
        let games: Vec<NewGame> = match r.games {
            Ok(g) => g,
            Err(e) => {
                tracing::warn!("import {}: {e:#}", r.source);
                continue;
            }
        };
        total += games.len();
        let source = r.source;
        // Comprados sin instalar (sin repetir lo que ya está instalado).
        let installed_ids: std::collections::HashSet<String> = games.iter().map(|g| g.source_id.clone()).collect();
        let mut owned: Vec<NewGame> = r.owned;
        if !r.steam_candidates.is_empty() {
            let pending: Vec<i64> = r
                .steam_candidates
                .iter()
                .copied()
                .filter(|id| !installed_ids.contains(&id.to_string()))
                .collect();
            owned.extend(steam_owned_games(st, &pending).await);
        }
        owned.retain(|g| !installed_ids.contains(&g.source_id));
        let ids: Vec<Upserted> = st.db.with_mut(|c| {
            let tx = c.transaction()?;
            let mut out = vec![];
            for g in games.iter().chain(owned.iter()) {
                if let Some((id, is_new)) = repo::upsert_game(&tx, g)? {
                    if !g.exe_candidates.is_empty() {
                        repo::replace_exe_candidates(&tx, id, &g.exe_candidates)?;
                    }
                    out.push((id, is_new, g.exe_path.clone(), (g.imported_playtime, g.imported_last_played)));
                }
            }
            // Lo que no aparece ni instalado ni comprado se marca como desaparecido.
            let present: Vec<String> = games.iter().chain(owned.iter()).map(|g| g.source_id.clone()).collect();
            repo::mark_missing_source(&tx, source, &present)?;
            tx.commit()?;
            Ok(out)
        })?;
        for (id, is_new, exe, pt) in ids {
            if let (Some(p), (secs, last)) = (profile, pt) {
                if secs.is_some() || last.is_some() {
                    let _ = st.db.with(|c| repo::add_imported_playtime(c, p, id, secs.unwrap_or(0), last));
                }
            }
            if is_new {
                new.push((id, exe));
            }
        }
    }
    crate::events::scan_progress(st, "done", 1, 1, "");
    after_new_games(st, new).await;
    crate::events::library_reset(st);
    Ok(total)
}

/// De los appids candidatos de Steam, se queda con los juegos (no DLC, bandas
/// sonoras ni herramientas). Tipo y nombre se cachean 30 días en la base de datos.
async fn steam_owned_games(st: &Arc<AppState>, candidates: &[i64]) -> Vec<NewGame> {
    let mut known: std::collections::HashMap<i64, (i64, String)> = std::collections::HashMap::new();
    let mut unknown = vec![];
    for id in candidates {
        let cached = st.db.with(|c| repo::cache_get(c, "steam_app", &id.to_string(), 30 * 86400)).ok().flatten();
        match cached.and_then(|j| serde_json::from_str::<(i64, String)>(&j).ok()) {
            Some(v) => {
                known.insert(*id, v);
            }
            None => unknown.push(*id),
        }
    }
    if !unknown.is_empty() {
        let s = st.settings.get();
        match st.providers.steam.app_types(&st.http, &unknown, &s.language, &s.country).await {
            Ok(found) => {
                let _ = st.db.with_mut(|c| {
                    let tx = c.transaction()?;
                    for (id, v) in &found {
                        repo::cache_put(&tx, "steam_app", &id.to_string(), &serde_json::to_string(v).unwrap_or_default())?;
                    }
                    tx.commit()
                });
                known.extend(found);
            }
            Err(e) => tracing::warn!("tipos de apps de Steam: {e:#}"),
        }
    }
    let times = tauri::async_runtime::spawn_blocking(crate::import::steam::all_playtimes).await.unwrap_or_default();
    candidates
        .iter()
        .filter_map(|id| {
            known
                .get(id)
                .filter(|(ty, name)| *ty == 0 && !name.is_empty())
                .map(|(_, name)| crate::import::steam::owned_game(*id, name, &times))
        })
        .collect()
}

pub fn sync_watcher(st: &Arc<AppState>) {
    if let (Some(w), Ok(folders)) = (st.watcher.get(), st.db.with(repo::list_folders)) {
        let list: Vec<(i64, String)> = folders.into_iter().filter(|f| f.enabled).map(|f| (f.id, f.path)).collect();
        w.set_folders(&list);
    }
}

/// Juego añadido a mano a partir de un exe.
pub async fn add_manual(st: &Arc<AppState>, exe: String) -> anyhow::Result<i64> {
    let p = Path::new(&exe);
    if !p.is_file() {
        anyhow::bail!("No existe el fichero");
    }
    let dir = p.parent().map(|d| d.to_string_lossy().to_string());
    let title = pe_info::read(p)
        .and_then(|i| i.product_name)
        .filter(|n| !crate::library::names::is_generic_name(n))
        .unwrap_or_else(|| crate::library::names::clean_title(&p.file_stem().unwrap_or_default().to_string_lossy()));
    let g = NewGame {
        title,
        source: "manual".into(),
        source_id: crate::util::norm_path(p),
        install_dir: dir,
        exe_path: Some(exe.clone()),
        ..Default::default()
    };
    let (id, is_new) = st
        .db
        .with(|c| repo::upsert_game(c, &g))?
        .ok_or_else(|| anyhow::anyhow!("Ese juego ya está en la biblioteca"))?;
    if is_new {
        after_new_games(st, vec![(id, Some(exe))]).await;
    }
    Ok(id)
}
