//! Importadores de tiendas. Cada uno devuelve los juegos instalados; después se
//! analiza su carpeta (exes alternativos, pistas para el tracker, motor).

pub mod ea;
pub mod epic;
pub mod gog;
pub mod steam;
pub mod ubisoft;
pub mod vdf;

use crate::db::models::NewGame;
use crate::library::exe_detect;
use crate::settings::Settings;
use rayon::prelude::*;
use std::path::Path;

pub struct StoreResult {
    pub source: &'static str,
    /// Instalados.
    pub games: anyhow::Result<Vec<NewGame>>,
    /// Comprados y sin instalar (Epic y GOG; Steam se resuelve aparte con su API).
    pub owned: Vec<NewGame>,
    /// Steam: appids candidatos a "comprado" (hay que filtrar DLC con GetItems).
    pub steam_candidates: Vec<i64>,
}

pub fn enabled_stores(s: &Settings) -> Vec<&'static str> {
    let mut v = vec![];
    if s.import_steam {
        v.push("steam");
    }
    if s.import_epic {
        v.push("epic");
    }
    if s.import_gog {
        v.push("gog");
    }
    if s.import_ubisoft {
        v.push("ubisoft");
    }
    if s.import_ea {
        v.push("ea");
    }
    v
}

/// `known`: (tienda:id, carpeta normalizada) de juegos ya analizados.
pub fn run(stores: &[&'static str], with_owned: bool, known: &std::collections::HashSet<(String, String)>) -> Vec<StoreResult> {
    stores
        .par_iter()
        .map(|&source| {
            let games = match source {
                "steam" => steam::installed(),
                "epic" => epic::installed(),
                "gog" => gog::installed(),
                "ubisoft" => ubisoft::installed(),
                "ea" => ea::installed(),
                _ => Ok(vec![]),
            }
            .map(|g| enrich(g, known));
            let (owned, steam_candidates) = if !with_owned {
                (vec![], vec![])
            } else {
                match source {
                    "epic" => (epic::owned(), vec![]),
                    "gog" => (gog::owned(), vec![]),
                    "steam" => (vec![], steam::owned_candidates()),
                    _ => (vec![], vec![]),
                }
            };
            StoreResult { source, games, owned, steam_candidates }
        })
        .collect()
}

/// Resumen rápido (sin red) para el primer arranque: qué tiendas hay y cuántos juegos instalados.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreSummary {
    pub source: &'static str,
    pub detected: bool,
    pub installed: usize,
    pub library: usize,
}

pub fn summary() -> Vec<StoreSummary> {
    let all = ["steam", "epic", "gog", "ubisoft", "ea"];
    all.par_iter()
        .map(|&source| {
            let installed = match source {
                "steam" => steam::installed(),
                "epic" => epic::installed(),
                "gog" => gog::installed(),
                "ubisoft" => ubisoft::installed(),
                _ => ea::installed(),
            }
            .map(|v| v.len())
            .unwrap_or(0);
            let library = match source {
                "epic" => epic::owned().len(),
                "gog" => gog::owned().len(),
                _ => 0,
            };
            let detected = installed > 0
                || library > 0
                || match source {
                    "steam" => steam::steam_root().is_some(),
                    _ => false,
                };
            StoreSummary { source, detected, installed, library }
        })
        .collect()
}

/// Completa cada juego con el análisis de su carpeta.
fn enrich(games: Vec<NewGame>, known: &std::collections::HashSet<(String, String)>) -> Vec<NewGame> {
    games
        .into_par_iter()
        .map(|mut g| {
            let seen = g
                .install_dir
                .as_deref()
                .map(|d| known.contains(&(format!("{}:{}", g.source, g.source_id), crate::util::norm_path(Path::new(d)))))
                .unwrap_or(false);
            if seen {
                return g;
            }
            if let Some(a) = g.install_dir.as_deref().and_then(|d| exe_detect::analyze(Path::new(d))) {
                if g.exe_path.is_none() {
                    g.exe_path = a.best().map(|b| b.path.to_string_lossy().to_string());
                }
                g.exe_candidates = a.exes.iter().map(|c| (c.path.to_string_lossy().to_string(), c.score)).collect();
                for h in a.process_hints {
                    if !g.process_hints.contains(&h) {
                        g.process_hints.push(h);
                    }
                }
                g.engine = a.markers.engine.map(str::to_string);
                if g.steam_appid.is_none() {
                    g.steam_appid = a.markers.steam_appid;
                }
            }
            g
        })
        .collect()
}
