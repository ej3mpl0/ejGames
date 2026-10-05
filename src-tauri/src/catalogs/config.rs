//! `<datos>\config\catalog-sources.json`: las fuentes de catálogos que configura el
//! usuario (ejemplo comentado en `config/catalog-sources.example.json`).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const FILE: &str = "catalog-sources.json";
pub const EXAMPLE: &str = include_str!("../../../config/catalog-sources.example.json");

/// Direcciones de cada consulta. Admiten `{query}`, `{page}`, `{platform}`,
/// `{platformPath}` e `{id}`; relativas a `baseUrl` o absolutas (del mismo sitio).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Endpoints {
    pub search: Option<String>,
    pub popular: Option<String>,
    pub newest: Option<String>,
    pub by_platform: Option<String>,
    pub detail: Option<String>,
}

/// Selectores CSS. Varios separados por comas se prueban en orden; `@atributo` al
/// final toma ese atributo en vez del texto («img.cover@src»).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Selectors {
    pub game_list: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub cover_image: Option<String>,
    pub download_link: Option<String>,
    pub platform: Option<String>,
    pub region: Option<String>,
    pub language: Option<String>,
    pub size: Option<String>,
    pub version: Option<String>,
    pub next_page: Option<String>,
    /// Enlace a la ficha dentro de cada elemento de la lista (si no, el primer enlace).
    pub detail_link: Option<String>,
    /// Juego, DLC, actualización… (si no, se deduce del título).
    pub category: Option<String>,
    /// Migas de pan de la ficha (para saber la plataforma).
    pub breadcrumbs: Option<String>,
    /// Capturas de la ficha.
    pub screenshots: Option<String>,
}

/// Fuentes `api`: dónde está cada dato en el JSON («data.items», «links.0.url»).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ApiFields {
    pub items: Option<String>,
    pub id: Option<String>,
    pub title: Option<String>,
    pub platform: Option<String>,
    pub cover: Option<String>,
    pub description: Option<String>,
    pub region: Option<String>,
    pub language: Option<String>,
    pub size: Option<String>,
    pub version: Option<String>,
    pub category: Option<String>,
    pub url: Option<String>,
    /// La ficha: si el objeto viene dentro de otro («data»).
    pub detail: Option<String>,
    /// Lista de descargas (texto o objetos) y, en cada objeto, la URL y el nombre.
    pub downloads: Option<String>,
    pub download_url: Option<String>,
    pub download_label: Option<String>,
    pub screenshots: Option<String>,
    /// Número total de páginas (para saber si hay más).
    pub total_pages: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CatalogSource {
    pub id: String,
    pub name: String,
    pub base_url: String,
    /// api | scrape
    #[serde(rename = "type")]
    pub kind: String,
    pub enabled: bool,
    pub platforms: Vec<String>,
    #[serde(alias = "apiEndpoints", alias = "pages")]
    pub endpoints: Endpoints,
    pub api_fields: ApiFields,
    pub selectors: Selectors,
    pub platform_mapping: HashMap<String, String>,
    /// Plataforma → tramo de URL para `{platformPath}` («ps2» → «sony-playstation-2»).
    pub platform_paths: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub rate_limit_per_minute: u32,
    /// Minutos que se guarda cada página.
    pub cache_minutes: u32,
    /// Contraseñas de los comprimidos de esta fuente (se prueban antes que las generales).
    pub extract_passwords: Vec<String>,
    /// Más hosts de los que salen sus carátulas (CDN).
    pub image_hosts: Vec<String>,
    /// auto (si falla la conexión directa) | always | never
    pub relay: String,
    /// Icono (URL https) o emoji para la tarjeta de la fuente.
    pub icon: Option<String>,
    /// De serie (viene con ejGames), no del archivo del usuario.
    #[serde(skip_deserializing)]
    pub builtin: bool,
}

impl Default for CatalogSource {
    fn default() -> Self {
        CatalogSource {
            id: String::new(),
            name: String::new(),
            base_url: String::new(),
            kind: "scrape".into(),
            enabled: true,
            platforms: vec![],
            endpoints: Endpoints::default(),
            api_fields: ApiFields::default(),
            selectors: Selectors::default(),
            platform_mapping: HashMap::new(),
            platform_paths: HashMap::new(),
            headers: HashMap::new(),
            rate_limit_per_minute: 30,
            cache_minutes: 30,
            extract_passwords: vec![],
            image_hosts: vec![],
            relay: "auto".into(),
            icon: None,
            builtin: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DownloadSettings {
    /// Carpeta de las ROMs («%APPDATA%\ejGames\roms»); vacía = la de ejGames.
    pub default_rom_path: String,
    pub extract_passwords: Vec<String>,
    pub auto_extract: bool,
    pub organize_by_platform: bool,
}

impl Default for DownloadSettings {
    fn default() -> Self {
        DownloadSettings { default_rom_path: String::new(), extract_passwords: vec![], auto_extract: true, organize_by_platform: true }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CatalogsFile {
    pub sources: Vec<CatalogSource>,
    pub download_settings: DownloadSettings,
}

pub fn path(root: &Path) -> PathBuf {
    crate::emulation::custom::config_dir(root).join(FILE)
}

/// Problemas de una fuente que impiden usarla (vacío = bien).
pub fn problems(s: &CatalogSource) -> Vec<String> {
    use crate::i18n::t;
    let mut out = vec![];
    match url::Url::parse(&s.base_url) {
        Ok(u) if matches!(u.scheme(), "https" | "http") && u.host_str().is_some() => {
            let h = u.host_str().unwrap_or_default();
            if h.contains("ejemplo") || h.contains("example") {
                out.push(t("baseUrl todavía es la de ejemplo").into_owned());
            }
        }
        _ => out.push(t("baseUrl no es una URL http(s)").into_owned()),
    }
    if !matches!(s.kind.as_str(), "api" | "scrape") {
        out.push(t("type debe ser «api» o «scrape»").into_owned());
    }
    if s.kind == "scrape" && s.selectors.game_list.as_deref().is_none_or(|x| x.trim().is_empty()) {
        out.push(t("falta selectors.gameList").into_owned());
    }
    let e = &s.endpoints;
    if [&e.search, &e.popular, &e.newest, &e.by_platform].iter().all(|x| x.as_deref().is_none_or(|x| x.trim().is_empty())) {
        out.push(t("faltan las direcciones (apiEndpoints: search, popular, byPlatform…)").into_owned());
    }
    for p in &s.platforms {
        if super::platforms::external(p).is_none() {
            out.push(format!("{} {p}", t("plataforma desconocida:")));
        }
    }
    out
}

/// Fuentes de serie (dentro del .exe): los huecos de `config/catalog-sources.default.json`.
pub const DEFAULTS: &str = include_str!("../../../config/catalog-sources.default.json");

fn normalize(f: &mut CatalogsFile) {
    let mut seen = std::collections::HashSet::new();
    f.sources.retain(|s| {
        let ok = !s.id.trim().is_empty() && s.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        ok && seen.insert(s.id.clone())
    });
    for s in &mut f.sources {
        s.base_url = s.base_url.trim().trim_end_matches('/').to_string();
        s.platforms = s.platforms.iter().map(|p| super::platforms::external(p).map(str::to_string).unwrap_or_else(|| p.clone())).collect();
        s.rate_limit_per_minute = s.rate_limit_per_minute.clamp(1, 600);
        if s.name.trim().is_empty() {
            s.name = s.id.clone();
        }
    }
}

/// Las de serie que ya tienen dirección (un hueco vacío no se muestra).
pub fn defaults() -> Vec<CatalogSource> {
    let mut f: CatalogsFile = serde_json::from_str(DEFAULTS).unwrap_or_default();
    normalize(&mut f);
    f.sources.into_iter().filter(|s| !s.base_url.is_empty()).map(|s| CatalogSource { builtin: true, ..s }).collect()
}

/// Las fuentes de serie más las del archivo del usuario (si una suya tiene el mismo id
/// que una de serie, la sustituye) y el error si su archivo no se pudo leer.
pub fn read(root: &Path) -> (CatalogsFile, Option<String>) {
    let (mut f, error) = match std::fs::read(path(root)) {
        Err(_) => (CatalogsFile::default(), None),
        Ok(bytes) => match serde_json::from_slice::<CatalogsFile>(crate::emulation::custom::strip_bom(&bytes)) {
            Ok(mut f) => {
                normalize(&mut f);
                (f, None)
            }
            Err(e) => (CatalogsFile::default(), Some(format!("{FILE}: {e}"))),
        },
    };
    let mine: Vec<CatalogSource> = std::mem::take(&mut f.sources);
    let mut all: Vec<CatalogSource> = defaults().into_iter().filter(|d| !mine.iter().any(|m| m.id == d.id)).collect();
    all.extend(mine);
    f.sources = all;
    (f, error)
}

/// Crea el archivo del usuario si no existe: con las fuentes del ejemplo desactivadas,
/// para copiarlas y rellenarlas.
pub fn ensure_file(root: &Path) -> anyhow::Result<PathBuf> {
    let p = path(root);
    if !p.is_file() {
        std::fs::create_dir_all(p.parent().unwrap_or(root))?;
        let mut v: serde_json::Value = serde_json::from_str(EXAMPLE)?;
        if let Some(list) = v.get_mut("sources").and_then(|s| s.as_array_mut()) {
            for s in list {
                s["enabled"] = serde_json::Value::Bool(false);
            }
        }
        std::fs::write(&p, serde_json::to_string_pretty(&v)?)?;
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_is_valid_but_marked_as_placeholder() {
        let f: CatalogsFile = serde_json::from_str(EXAMPLE).unwrap();
        assert!(!f.sources.is_empty());
        for s in &f.sources {
            let p = problems(s);
            assert!(p.iter().any(|x| x.contains("ejemplo") || x.contains("example")), "{}: {p:?}", s.id);
            assert_eq!(p.len(), 1, "{}: {p:?}", s.id);
        }
        assert!(f.download_settings.auto_extract);
    }

    #[test]
    fn default_slots_parse_and_user_sources_override_them() {
        let f: CatalogsFile = serde_json::from_str(DEFAULTS).unwrap();
        assert_eq!(f.sources.len(), 2);
        let d = tempfile::tempdir().unwrap();
        // Sin archivo del usuario: solo las de serie con dirección (los huecos vacíos no salen).
        let n = defaults().len();
        assert_eq!(read(d.path()).0.sources.len(), n);
        let cfg = path(d.path());
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        std::fs::write(&cfg, r#"{"sources":[{"id":"fuente-1","name":"Mía","baseUrl":"https://a.test/"},{"id":"otra","baseUrl":"https://b.test"}]}"#).unwrap();
        let (f, err) = read(d.path());
        assert!(err.is_none());
        let one = f.sources.iter().find(|s| s.id == "fuente-1").unwrap();
        assert_eq!((one.name.as_str(), one.base_url.as_str(), one.builtin), ("Mía", "https://a.test", false));
        assert!(f.sources.iter().any(|s| s.id == "otra"));
        // El archivo de partida lleva el ejemplo desactivado.
        let d2 = tempfile::tempdir().unwrap();
        ensure_file(d2.path()).unwrap();
        assert!(read(d2.path()).0.sources.iter().filter(|s| !s.builtin).all(|s| !s.enabled));
    }
}
