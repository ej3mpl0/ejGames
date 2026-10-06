//! Catálogos de juegos: fuentes que configura el usuario en
//! `<datos>\config\catalog-sources.json` (webs con selectores CSS o APIs JSON), con
//! listas por plataforma, búsqueda en todas, fichas con sus enlaces de descarga y una
//! cadena de descarga que descomprime, ordena en `roms\<plataforma>\<juego>\`, busca
//! carátula y deja el juego en la biblioteca con su emulador.
//!
//! ejGames no trae ninguna fuente: el archivo de ejemplo solo tiene direcciones de
//! relleno que el usuario cambia por las suyas.

pub mod adapter;
pub mod config;
pub mod pipeline;
pub mod platforms;

use crate::state::AppState;
use config::{CatalogSource, CatalogsFile, DownloadSettings};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub source_id: String,
    pub title: String,
    /// Id de catálogo de la plataforma («ps1», «switch»…), si se sabe.
    pub platform: Option<String>,
    /// Carátula servida por ejGames ("" si no hay o su host no está permitido).
    pub cover_url: String,
    /// La URL original de la carátula (para guardarla en la biblioteca).
    pub cover_original: Option<String>,
    pub description: Option<String>,
    pub region: Option<String>,
    pub language: Option<String>,
    pub size: Option<String>,
    pub size_bytes: Option<u64>,
    pub version: Option<String>,
    /// game | dlc | update | homebrew | emulator
    pub category: String,
    pub original_url: String,
    /// Ya bajado desde este catálogo: el juego de la biblioteca.
    pub installed_game_id: Option<i64>,
    /// Con qué emulador se jugaría ("" si ninguno; None si no es de consola).
    pub emulator: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadLink {
    pub url: String,
    pub label: String,
    /// direct (un archivo) | page (una web de descargas: se abre en el navegador) | magnet | torrent
    pub kind: String,
    pub host: String,
    pub size: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDetail {
    #[serde(flatten)]
    pub entry: CatalogEntry,
    pub links: Vec<DownloadLink>,
    pub screenshots: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPage {
    pub source_id: String,
    pub entries: Vec<CatalogEntry>,
    pub page: usize,
    pub has_more: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// Id de catálogo («ps1»).
    pub id: String,
    pub name: String,
    /// Id de ejGames («psx»); None si no se emula.
    pub system: Option<String>,
    /// Emulador con que se jugaría ("" si ninguno).
    pub emulator: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_url: String,
    pub icon: Option<String>,
    pub enabled: bool,
    pub platforms: Vec<PlatformInfo>,
    /// Lo que falta para poder usarla.
    pub problems: Vec<String>,
    pub has_search: bool,
    /// Viene con ejGames (si no, es del archivo del usuario).
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogState {
    pub sources: Vec<SourceInfo>,
    pub error: Option<String>,
    pub emulators_error: Option<String>,
    /// Rutas de los dos archivos de configuración.
    pub path: String,
    pub emulators_path: String,
    pub exists: bool,
    pub download_settings: DownloadSettings,
    /// Todas las plataformas que conoce el sistema de catálogos.
    pub all_platforms: Vec<PlatformInfo>,
}

struct Loaded {
    file: CatalogsFile,
    error: Option<String>,
}

static LOADED: RwLock<Option<Loaded>> = RwLock::new(None);

/// Lee los dos archivos de configuración (al arrancar y al pulsar «Recargar»).
pub fn load(st: &AppState) {
    let root = &st.paths.root;
    crate::emulation::custom::load(root);
    let (file, error) = config::read(root);
    let mut hosts = vec![];
    for s in &file.sources {
        if let Some(h) = url::Url::parse(&s.base_url).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())) {
            hosts.push(h);
        }
        hosts.extend(s.image_hosts.iter().cloned());
    }
    crate::explore::images::set_extra_hosts(hosts);
    if let Some(e) = &error {
        tracing::warn!("{e}");
    }
    tracing::info!("catálogos: {} fuentes", file.sources.len());
    *LOADED.write() = Some(Loaded { file, error });
}

pub fn file() -> CatalogsFile {
    LOADED.read().as_ref().map(|l| l.file.clone()).unwrap_or_default()
}

pub fn source(id: &str) -> anyhow::Result<CatalogSource> {
    let s = file().sources.into_iter().find(|s| s.id == id).ok_or_else(|| anyhow::anyhow!("{} {id}", crate::i18n::t("No existe la fuente:")))?;
    if !s.enabled {
        anyhow::bail!("{} {}", crate::i18n::t("La fuente está desactivada:"), s.name);
    }
    let p = config::problems(&s);
    if !p.is_empty() {
        anyhow::bail!("{}: {}", s.name, p.join(" · "));
    }
    Ok(s)
}

/// Nombre del emulador de cada sistema ("" si ninguno), calculado una vez por llamada.
struct Emus<'a> {
    st: &'a AppState,
    cache: HashMap<String, String>,
}

impl Emus<'_> {
    fn of(&mut self, external: &str) -> Option<String> {
        let sys = platforms::internal(external)?;
        let st = self.st;
        Some(
            self.cache
                .entry(sys.to_string())
                .or_insert_with(|| {
                    let s = st.settings.get();
                    let dir = crate::emulation::install::emu_dir(st);
                    crate::emulation::resolve(&s, Some(&dir), sys, false).map(|c| crate::emulation::cfg_name(&c)).unwrap_or_default()
                })
                .clone(),
        )
    }
}

fn platform_info(emus: &mut Emus, id: &str) -> PlatformInfo {
    PlatformInfo { id: id.to_string(), name: platforms::name(id).to_string(), system: platforms::internal(id).map(str::to_string), emulator: emus.of(id).unwrap_or_default() }
}

pub fn state(st: &AppState) -> CatalogState {
    let (file, error) = LOADED.read().as_ref().map(|l| (l.file.clone(), l.error.clone())).unwrap_or_default();
    let mut emus = Emus { st, cache: HashMap::new() };
    let sources = file
        .sources
        .iter()
        .map(|s| SourceInfo {
            id: s.id.clone(),
            name: s.name.clone(),
            kind: s.kind.clone(),
            base_url: s.base_url.clone(),
            icon: s.icon.clone(),
            enabled: s.enabled,
            platforms: s.platforms.iter().filter(|p| platforms::external(p).is_some()).map(|p| platform_info(&mut emus, p)).collect(),
            problems: config::problems(s),
            has_search: s.endpoints.search.as_deref().is_some_and(|x| !x.trim().is_empty()),
            builtin: s.builtin,
        })
        .collect();
    let path = config::path(&st.paths.root);
    CatalogState {
        sources,
        error,
        emulators_error: crate::emulation::custom::error(),
        exists: path.is_file(),
        path: path.to_string_lossy().into_owned(),
        emulators_path: crate::emulation::custom::path(&st.paths.root).to_string_lossy().into_owned(),
        download_settings: file.download_settings,
        all_platforms: platforms::ALL.iter().map(|(id, _, _)| platform_info(&mut emus, id)).collect(),
    }
}

// ───────────────────────── listas ─────────────────────────

/// Qué lista se pide.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Popular,
    Newest,
    Search,
    Platform,
}

impl Mode {
    pub fn parse(s: &str) -> Mode {
        match s {
            "newest" => Mode::Newest,
            "search" => Mode::Search,
            "platform" => Mode::Platform,
            _ => Mode::Popular,
        }
    }
}

fn has_platform_slot(t: &str) -> bool {
    t.contains("{platform}") || t.contains("{platformPath}")
}

/// La plantilla para una lista: la del modo; si se pide una plataforma y esa plantilla
/// no la admite, la de «byPlatform».
fn template(src: &CatalogSource, mode: Mode, platform: Option<&str>) -> Option<String> {
    let e = &src.endpoints;
    let pick = |x: &Option<String>| x.clone().filter(|t| !t.trim().is_empty());
    let base = match mode {
        Mode::Search => return pick(&e.search),
        Mode::Popular => pick(&e.popular).or_else(|| pick(&e.newest)),
        Mode::Newest => pick(&e.newest).or_else(|| pick(&e.popular)),
        Mode::Platform => None,
    };
    match (platform, base) {
        (Some(_), Some(t)) if has_platform_slot(&t) => Some(t),
        (Some(_), _) => pick(&e.by_platform).or_else(|| (mode != Mode::Platform).then(|| pick(&e.popular)).flatten()),
        (None, Some(t)) => Some(t),
        (None, None) => pick(&e.by_platform).filter(|t| !has_platform_slot(t)),
    }
}

/// Una página de una fuente.
pub async fn browse(st: &Arc<AppState>, source_id: &str, mode: Mode, query: &str, platform: Option<&str>, page: usize, force: bool) -> CatalogPage {
    let page = page.max(1);
    let platform = platform.and_then(platforms::external);
    let r = browse_inner(st, source_id, mode, query, platform, page, force).await;
    let mut out = match r {
        Ok((entries, has_more)) => CatalogPage { source_id: source_id.into(), entries, page, has_more, error: None },
        Err(e) => {
            tracing::warn!("catálogo {source_id}: {e:#}");
            CatalogPage { source_id: source_id.into(), entries: vec![], page, has_more: false, error: Some(format!("{e:#}")) }
        }
    };
    decorate(st, &mut out.entries);
    out
}

async fn browse_inner(st: &Arc<AppState>, source_id: &str, mode: Mode, query: &str, platform: Option<&'static str>, page: usize, force: bool) -> anyhow::Result<(Vec<CatalogEntry>, bool)> {
    let src = source(source_id)?;
    if mode == Mode::Search && query.trim().is_empty() {
        return Ok((vec![], false));
    }
    let tpl = template(&src, mode, platform).ok_or_else(|| {
        anyhow::anyhow!(
            "{}",
            if mode == Mode::Search { crate::i18n::t("Esta fuente no tiene búsqueda (apiEndpoints.search)") } else { crate::i18n::t("Esta fuente no tiene lista para esto (apiEndpoints.popular / byPlatform)") }
        )
    })?;
    let page_platform = platform.filter(|_| has_platform_slot(&tpl));
    let root = st.paths.root.clone();
    let (mut entries, more) = if src.kind == "api" {
        let url = adapter::expand(&src, &tpl, query, page, platform, "");
        let body = adapter::fetch(&root, &src, &url, force).await?;
        adapter::api_list(&src, &body, page_platform, page)?
    } else if tpl.contains("{page}") || tpl.contains("{page0}") || page == 1 {
        let url = adapter::expand(&src, &tpl, query, page, platform, "");
        let body = adapter::fetch(&root, &src, &url, force).await?;
        let r = adapter::scrape_list(&src, &body, &url, page_platform);
        let key = format!("{}|{tpl}|{query}|{}", src.id, platform.unwrap_or(""));
        if let Some(n) = &r.next {
            adapter::remember_page(&key, page + 1, n);
        }
        let more = r.next.is_some() || ((tpl.contains("{page}") || tpl.contains("{page0}")) && !r.entries.is_empty());
        (r.entries, more)
    } else {
        // Sin `{page}` en la plantilla: se llega a la página siguiendo «siguiente».
        let key = format!("{}|{tpl}|{query}|{}", src.id, platform.unwrap_or(""));
        let mut n = page;
        while n > 1 && adapter::known_page(&key, n).is_none() {
            n -= 1;
        }
        let mut url = if n == 1 { adapter::expand(&src, &tpl, query, 1, platform, "") } else { adapter::known_page(&key, n).unwrap_or_default() };
        loop {
            let body = adapter::fetch(&root, &src, &url, force).await?;
            let r = adapter::scrape_list(&src, &body, &url, page_platform);
            if let Some(next) = &r.next {
                adapter::remember_page(&key, n + 1, next);
            }
            if n >= page || n > 40 {
                break (r.entries, r.next.is_some());
            }
            match r.next {
                Some(next) => {
                    url = next;
                    n += 1;
                }
                None => break (vec![], false),
            }
        }
    };
    if let Some(p) = platform {
        for e in &mut entries {
            if e.platform.is_none() && page_platform.is_some() {
                e.platform = Some(p.to_string());
            }
        }
        entries.retain(|e| e.platform.as_deref() == Some(p));
    }
    entries.retain(|e| shown(&src, e));
    Ok((entries, more))
}

/// Ni lo que la fuente oculta (emuladores…) ni lo de plataformas que no declara (PC).
fn shown(src: &CatalogSource, e: &CatalogEntry) -> bool {
    !src.hide_categories.contains(&e.category) && (src.platforms.is_empty() || e.platform.as_ref().is_none_or(|p| src.platforms.contains(p)))
}

/// Busca en todas las fuentes activas a la vez (cada una con su límite).
pub async fn search_all(st: &Arc<AppState>, query: &str, platforms_filter: &[String], page: usize) -> Vec<CatalogPage> {
    let usable: Vec<CatalogSource> = file().sources.into_iter().filter(|s| s.enabled && config::problems(s).is_empty()).collect();
    let futs = usable.iter().map(|s| {
        let st = st.clone();
        let id = s.id.clone();
        let q = query.to_string();
        let wanted: Vec<String> = platforms_filter.iter().filter_map(|p| platforms::external(p).map(str::to_string)).filter(|p| s.platforms.is_empty() || s.platforms.contains(p)).collect();
        let skip = !platforms_filter.is_empty() && wanted.is_empty();
        async move {
            if skip {
                return None;
            }
            let mut p = browse(&st, &id, Mode::Search, &q, None, page, false).await;
            if !wanted.is_empty() {
                p.entries.retain(|e| e.platform.as_ref().is_some_and(|x| wanted.contains(x)));
            }
            Some(p)
        }
    });
    futures::future::join_all(futs).await.into_iter().flatten().collect()
}

pub async fn detail(st: &Arc<AppState>, source_id: &str, id: &str, force: bool) -> anyhow::Result<CatalogDetail> {
    let src = source(source_id)?;
    if id.starts_with('#') {
        anyhow::bail!("{}", crate::i18n::t("Esta entrada no tiene ficha propia en la web"));
    }
    let url = adapter::detail_url(&src, id);
    let body = adapter::fetch(&st.paths.root, &src, &url, force).await?;
    let mut d = if src.kind == "api" { adapter::api_detail(&src, &body, id)? } else { adapter::scrape_detail(&src, &body, &url, id) };
    decorate(st, std::slice::from_mut(&mut d.entry));
    Ok(d)
}

// ───────────────────────── ya bajados ─────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRec {
    pub game_ids: Vec<i64>,
    pub dir: String,
    pub platform: String,
    pub category: String,
    pub title: String,
    pub at: i64,
}

fn index_path(st: &AppState) -> std::path::PathBuf {
    st.paths.root.join("catalogs").join("installed.json")
}

pub fn index(st: &AppState) -> HashMap<String, InstalledRec> {
    std::fs::read(index_path(st)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn key(source_id: &str, id: &str) -> String {
    format!("{source_id}|{id}")
}

pub fn remember(st: &AppState, source_id: &str, id: &str, rec: InstalledRec) {
    let mut m = index(st);
    m.insert(key(source_id, id), rec);
    let p = index_path(st);
    if let Some(d) = p.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(p, serde_json::to_vec_pretty(&m).unwrap_or_default());
}

/// Olvida las descargas de catálogo de estos juegos (al borrarlos).
pub fn forget_installed(st: &AppState, game_ids: &[i64]) {
    let mut m = index(st);
    let before = m.len();
    m.retain(|_, r| !r.game_ids.iter().any(|id| game_ids.contains(id)));
    if m.len() != before {
        let _ = std::fs::write(index_path(st), serde_json::to_vec_pretty(&m).unwrap_or_default());
    }
}

fn decorate(st: &AppState, entries: &mut [CatalogEntry]) {
    if entries.is_empty() {
        return;
    }
    let idx = index(st);
    let mut emus = Emus { st, cache: HashMap::new() };
    for e in entries {
        if let Some(r) = idx.get(&key(&e.source_id, &e.id)).filter(|r| std::path::Path::new(&r.dir).exists()) {
            e.installed_game_id = r.game_ids.first().copied();
        }
        e.emulator = e.platform.as_deref().and_then(|p| emus.of(p));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_template_for_each_list() {
        let mut s = CatalogSource::default();
        s.endpoints.popular = Some("/popular".into());
        s.endpoints.by_platform = Some("/c/{platformPath}/page/{page}".into());
        s.endpoints.search = Some("/?s={query}".into());
        assert_eq!(template(&s, Mode::Popular, None).as_deref(), Some("/popular"));
        assert_eq!(template(&s, Mode::Popular, Some("ps2")).as_deref(), Some("/c/{platformPath}/page/{page}"));
        assert_eq!(template(&s, Mode::Newest, None).as_deref(), Some("/popular"));
        assert_eq!(template(&s, Mode::Search, Some("ps2")).as_deref(), Some("/?s={query}"));
        assert_eq!(template(&s, Mode::Platform, Some("ps2")).as_deref(), Some("/c/{platformPath}/page/{page}"));
        s.endpoints.by_platform = None;
        assert_eq!(template(&s, Mode::Platform, Some("ps2")), None);
        assert_eq!(template(&s, Mode::Popular, Some("ps2")).as_deref(), Some("/popular"));
    }
}
