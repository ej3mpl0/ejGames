//! Galería de temas de la comunidad: una lista en el repositorio de ejGames
//! (`community/index.json`, revisada con pull requests) y un botón para
//! instalarlos. La descarga se comprueba con su huella SHA-256.

use super::{package, valid_id, ThemeInfo};
use crate::db::repo;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;

const INDEX_URL: &str = "https://raw.githubusercontent.com/ej3mpl0/ejGames/main/community/index.json";
const TTL: i64 = 3600;
const MAX_DOWNLOAD: usize = 60 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommunityTheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub preview: Option<String>,
    pub download: String,
    pub sha256: String,
    /// Versión instalada en este PC (si hay un tema con ese id).
    #[serde(default, skip_deserializing)]
    pub installed: Option<String>,
}

#[derive(Deserialize)]
struct Index {
    #[serde(default)]
    themes: Vec<CommunityTheme>,
}

/// Solo se baja de GitHub (el repositorio de ejGames revisa las entradas).
pub fn allowed_url(u: &str) -> bool {
    let Ok(url) = url::Url::parse(u) else { return false };
    url.scheme() == "https" && matches!(url.host_str(), Some("github.com") | Some("raw.githubusercontent.com") | Some("objects.githubusercontent.com"))
}

fn valid(t: &CommunityTheme) -> bool {
    valid_id(&t.id) && !t.name.trim().is_empty() && allowed_url(&t.download) && t.sha256.len() == 64 && t.sha256.chars().all(|c| c.is_ascii_hexdigit())
        && t.preview.as_deref().map(allowed_url).unwrap_or(true)
}

pub async fn list(st: &Arc<AppState>) -> anyhow::Result<Vec<CommunityTheme>> {
    let cached = st.db.with(|c| repo::cache_get(c, "themes", "community", TTL)).ok().flatten();
    let text = match cached {
        Some(t) => t,
        None => {
            let fetched = async {
                let r = st.http.get(INDEX_URL).timeout(Duration::from_secs(12)).send().await?.error_for_status()?;
                anyhow::Ok(r.text().await?)
            }
            .await;
            match fetched {
                Ok(t) => {
                    let _ = st.db.with(|c| repo::cache_put(c, "themes", "community", &t));
                    t
                }
                // Sin conexión: la última copia, por vieja que sea.
                Err(e) => st
                    .db
                    .with(|c| repo::cache_get(c, "themes", "community", i64::MAX / 4))
                    .ok()
                    .flatten()
                    .ok_or(e)?,
            }
        }
    };
    let idx: Index = serde_json::from_str(text.trim_start_matches('\u{feff}'))?;
    let mut out: Vec<CommunityTheme> = idx.themes.into_iter().filter(valid).collect();
    let installed = super::list(&st.paths);
    for t in &mut out {
        t.installed = installed.iter().find(|i| i.manifest.id == t.id && !i.builtin).map(|i| i.manifest.version.clone());
    }
    Ok(out)
}

pub async fn install(st: &Arc<AppState>, id: &str) -> anyhow::Result<ThemeInfo> {
    let entry = list(st).await?.into_iter().find(|t| t.id == id).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("Ese tema ya no está en la lista")))?;
    let bytes = st.http.get(&entry.download).timeout(Duration::from_secs(120)).send().await?.error_for_status()?.bytes().await?;
    if bytes.len() > MAX_DOWNLOAD {
        anyhow::bail!("{}", crate::i18n::t("El tema pesa demasiado"));
    }
    let sum = hex(&Sha256::digest(&bytes));
    if !sum.eq_ignore_ascii_case(&entry.sha256) {
        anyhow::bail!("{}", crate::i18n::t("La descarga no coincide con la huella de la lista; no se instala"));
    }
    let (st2, want) = (st.clone(), entry.id.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let paths = &st2.paths;
        let tmp = paths.root.join(format!("community-{}.ejtheme", std::process::id()));
        std::fs::write(&tmp, &bytes)?;
        let r = package::import(paths, &tmp);
        let _ = std::fs::remove_file(&tmp);
        let info = r?;
        if info.manifest.id != want {
            // El paquete trae otro id que el de la lista: no se queda.
            let _ = super::delete(paths, &info.manifest.id);
            anyhow::bail!("{}", crate::i18n::t("El tema no es el de la lista"));
        }
        Ok(info)
    })
    .await?
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(url: &str, sha: &str) -> CommunityTheme {
        CommunityTheme { id: "mi-tema".into(), name: crate::i18n::t("Mi tema").into(), download: url.into(), sha256: sha.into(), ..Default::default() }
    }

    #[test]
    fn only_github_downloads_with_a_valid_hash() {
        let sha = "a".repeat(64);
        assert!(valid(&t("https://github.com/u/r/releases/download/v1/x.ejtheme", &sha)));
        assert!(valid(&t("https://raw.githubusercontent.com/u/r/main/x.ejtheme", &sha)));
        assert!(!valid(&t("http://github.com/u/r/x.ejtheme", &sha)));
        assert!(!valid(&t("https://evil.example.com/x.ejtheme", &sha)));
        assert!(!valid(&t("https://github.com.evil.com/x.ejtheme", &sha)));
        assert!(!valid(&t("https://github.com/u/r/x.ejtheme", "corta")));
        let mut bad = t("https://github.com/u/r/x.ejtheme", &sha);
        bad.id = "../x".into();
        assert!(!valid(&bad));
    }

    #[test]
    fn hashing_matches_known_value() {
        assert_eq!(hex(&Sha256::digest(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn index_parses_with_missing_optional_fields() {
        let j = r#"{"themes":[{"id":"a","name":"A","download":"https://github.com/u/r/a.ejtheme","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}]}"#;
        let i: Index = serde_json::from_str(j).unwrap();
        assert_eq!(i.themes.len(), 1);
        assert!(valid(&i.themes[0]));
    }
}
