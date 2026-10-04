//! Aviso de repack nuevo: compara la versión con la que se bajó cada juego
//! instalado con la que tiene ahora su entrada en la tienda.

use super::parse;
use crate::db::repo;
use crate::state::AppState;
use std::collections::HashMap;
use std::sync::Arc;

/// Los números de una versión («v1.03/v1.03.1 + 5 DLCs» → [1, 3, 1, 5]); si hay
/// varias separadas por «/», la última.
fn numbers(v: &str) -> Vec<u64> {
    let last = v.rsplit('/').next().unwrap_or(v);
    let mut out = vec![];
    let mut cur = String::new();
    for ch in last.chars().chain(std::iter::once(' ')) {
        if ch.is_ascii_digit() {
            cur.push(ch);
        } else if !cur.is_empty() {
            out.push(cur.parse().unwrap_or(0));
            cur.clear();
        }
    }
    out
}

/// ¿`latest` es una versión posterior a `installed`? Sin números comparables
/// (o iguales), no: un cambio de redacción no es una actualización.
pub fn version_newer(installed: &str, latest: &str) -> bool {
    let (a, b) = (numbers(installed), numbers(latest));
    !a.is_empty() && !b.is_empty() && b > a
}

/// Revisa los repacks instalados (cada 12 h como mucho). Devuelve los juegos
/// cuyo aviso cambió.
pub async fn check(st: &Arc<AppState>, force: bool) -> anyhow::Result<Vec<i64>> {
    let now = chrono::Utc::now().timestamp();
    let last = st.db.with(|c| repo::repack_updates_checked(c))?;
    if !force && now - last < 12 * 3600 {
        return Ok(vec![]);
    }
    let installed = st.db.with(repo::installed_repacks)?;
    if installed.is_empty() {
        return Ok(vec![]);
    }
    let slugs: Vec<String> = {
        let mut s: Vec<String> = installed.iter().map(|(_, slug, _)| slug.clone()).collect();
        s.sort();
        s.dedup();
        s
    };
    let posts = st.explore.fitgirl.by_slugs(&slugs).await?;
    let latest: HashMap<String, String> = posts
        .iter()
        .filter_map(|p| parse::parse_post(&p.content, &p.title).version.map(|v| (p.slug.clone(), v)))
        .collect();
    let mut changed = vec![];
    for (game_id, slug, version) in installed {
        let newer = latest.get(&slug).filter(|l| version_newer(&version, l));
        let did = st.db.with(|c| match newer {
            Some(l) => repo::set_repack_update(c, game_id, &slug, &version, l, now),
            None => repo::clear_repack_update(c, game_id),
        })?;
        if did {
            changed.push(game_id);
        }
    }
    st.db.with(|c| repo::repack_updates_touch(c, now))?;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(version_newer("v1.03", "v1.04"));
        assert!(version_newer("v1.2", "v1.10"));
        assert!(version_newer("Build 12345", "Build 12399"));
        assert!(version_newer("v1.03 + 5 DLCs", "v1.03 + 7 DLCs"));
        assert!(version_newer("v1.0", "v1.0/v1.0.1"));
        assert!(!version_newer("v1.04", "v1.03"));
        assert!(!version_newer("v1.0", "v1.0"));
        assert!(!version_newer("Final", "Gold"));
        assert!(!version_newer("v1.0 + Bonus", "v1.0 + Bonuses"));
    }
}

#[cfg(test)]
mod db_tests {
    use crate::db::{models::NewGame, repo, Db};

    #[test]
    fn dismissed_update_returns_with_a_newer_version() {
        let db = Db::memory().unwrap();
        let gid = db
            .with(|c| repo::upsert_game(c, &NewGame { title: "Juego".into(), source: "repack".into(), source_id: "fitgirl:1".into(), ..Default::default() }))
            .unwrap()
            .unwrap()
            .0;
        db.with(|c| repo::set_repack_update(c, gid, "juego", "v1.0", "v1.1", 10)).unwrap();
        assert_eq!(db.with(repo::repack_updates).unwrap().len(), 1);
        db.with(|c| repo::dismiss_repack_update(c, gid)).unwrap();
        assert!(db.with(repo::repack_updates).unwrap().is_empty());
        // Sale otra versión: el aviso vuelve.
        assert!(db.with(|c| repo::set_repack_update(c, gid, "juego", "v1.0", "v1.2", 20)).unwrap());
        assert_eq!(db.with(repo::repack_updates).unwrap().get(&gid).unwrap().latest, "v1.2");
        // Ya está al día.
        assert!(db.with(|c| repo::clear_repack_update(c, gid)).unwrap());
        assert!(db.with(repo::repack_updates).unwrap().is_empty());
    }
}
