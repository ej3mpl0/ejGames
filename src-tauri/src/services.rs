//! Orquestación: escaneos y post-proceso de juegos nuevos.

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
