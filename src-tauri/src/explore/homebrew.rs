//! Explorar → Homebrew: software libre o redistribuible para consolas, de sus
//! catálogos públicos, que se baja, se deja en `<datos>\homebrew\<sistema>\` y se
//! juega con el emulador del sistema.
//!
//! - Switch: hb-appstore (Switchbru), `repo.json` → .zip con la estructura de la SD
//!   (`switch/<app>/<app>.nro`).
//! - PS Vita: VitaDB, `list_hbs_json.php` → .vpk.
//! - 3DS: Universal-DB, `full.json` → .3dsx (o un .zip/.7z que lo trae).
//!
//! Los catálogos se piden enteros (una vez cada 6 h; sin red vale el último guardado)
//! y se filtran y paginan aquí. Si una web no responde directa, se prueba por el relay
//! de ejGames (`relay/worker.js`), que solo reenvía estos catálogos y, para descargar,
//! solo lo que está en ellos (se le pide por sistema e id, nunca por URL).

use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

pub const SYSTEMS: &[&str] = &["switch", "vita", "3ds"];
const TTL: Duration = Duration::from_secs(6 * 3600);
const PER_PAGE: usize = 40;
const META: &str = ".ejgames-homebrew.json";
/// VitaDB solo contesta a navegadores (a otros clientes les da una lista vacía).
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

fn source_url(system: &str) -> &'static str {
    match system {
        "switch" => "https://switch.cdn.fortheusers.org/repo.json",
        "vita" => "https://www.rinnegatamante.eu/vitadb/list_hbs_json.php",
        _ => "https://db.universal-team.net/data/full.json",
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HomebrewEntry {
    /// `<sistema>:<id del catálogo>`.
    pub id: String,
    pub system: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
    pub details: String,
    /// game | emulator | tool | other
    pub category: String,
    pub icon: Option<String>,
    pub screens: Vec<String>,
    pub size: Option<u64>,
    pub url: String,
    /// Switch: ruta del .nro dentro del .zip (como en la SD).
    pub binary: Option<String>,
    pub site: Option<String>,
    pub license: Option<String>,
    /// AAAA-MM-DD
    pub updated: Option<String>,
    /// Lo que pide aparte (datos del juego original, plugins…).
    pub requirements: Option<String>,
    pub downloads: u64,
    /// Se puede jugar con emulador desde ejGames (si no, es para la consola real).
    pub runnable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HbInstalled {
    pub version: String,
    pub path: String,
    pub game_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HbItem {
    #[serde(flatten)]
    pub entry: HomebrewEntry,
    pub installed: Option<HbInstalled>,
    /// Hay una versión más nueva que la instalada.
    pub update: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HbPage {
    pub items: Vec<HbItem>,
    pub total: usize,
    pub page: usize,
    pub pages: usize,
    /// Categorías del sistema con cuántos hay.
    pub categories: Vec<(String, usize)>,
    /// Con qué emulador se abrirá ("" si no hay ninguno).
    pub emulator: String,
    /// Error al pedir el catálogo (se muestra el último guardado si lo hay).
    pub error: Option<String>,
}

// ───────────────────────── catálogos → entradas ─────────────────────────

fn s(v: &serde_json::Value, k: &str) -> String {
    match v.get(k) {
        Some(serde_json::Value::String(x)) => x.trim().to_string(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}
fn num(v: &serde_json::Value, k: &str) -> u64 {
    match v.get(k) {
        Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(serde_json::Value::String(x)) => x.trim().parse().unwrap_or(0),
        _ => 0,
    }
}
fn enc(x: &str) -> String {
    percent_encoding::utf8_percent_encode(x, percent_encoding::NON_ALPHANUMERIC).to_string()
}
fn opt(x: String) -> Option<String> {
    (!x.is_empty()).then_some(x)
}

/// «dd/mm/aaaa» → «aaaa-mm-dd».
fn dmy(d: &str) -> Option<String> {
    let p: Vec<&str> = d.split('/').collect();
    (p.len() == 3 && p[2].len() == 4).then(|| format!("{}-{:0>2}-{:0>2}", p[2], p[1], p[0]))
}

pub fn parse_switch(v: &serde_json::Value) -> Vec<HomebrewEntry> {
    let base = "https://switch.cdn.fortheusers.org";
    v.get("packages")
        .and_then(|p| p.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    let name = s(p, "name");
                    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.+ ".contains(c)) {
                        return None;
                    }
                    let binary = opt(s(p, "binary")).filter(|b| b != "none");
                    let category = match s(p, "category").as_str() {
                        "game" | "demo" | "concept" => "game",
                        "emu" => "emulator",
                        "tool" | "advanced" => "tool",
                        _ => "other",
                    };
                    let shots = num(p, "screens");
                    let enc = enc(&name);
                    Some(HomebrewEntry {
                        id: format!("switch:{name}"),
                        system: "switch".into(),
                        name: opt(s(p, "title")).unwrap_or_else(|| name.clone()),
                        author: s(p, "author"),
                        version: s(p, "version"),
                        description: s(p, "description"),
                        details: s(p, "details").replace("\\n", "\n"),
                        category: category.into(),
                        icon: Some(format!("{base}/packages/{enc}/icon.png")),
                        screens: (1..=shots.min(6)).map(|i| format!("{base}/packages/{enc}/screen{i}.png")).collect(),
                        size: Some(num(p, "filesize") * 1024).filter(|n| *n > 0),
                        url: format!("{base}/zips/{enc}.zip"),
                        runnable: binary.as_deref().is_some_and(|b| b.to_lowercase().ends_with(".nro")),
                        binary,
                        site: opt(s(p, "url")),
                        license: opt(s(p, "license")),
                        updated: dmy(&s(p, "updated")),
                        requirements: None,
                        downloads: num(p, "app_dls"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_vita(v: &serde_json::Value) -> Vec<HomebrewEntry> {
    let base = "https://www.rinnegatamante.eu/vitadb";
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    let id = s(p, "id");
                    let url = s(p, "url");
                    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) || !url.starts_with("https://") {
                        return None;
                    }
                    // 1 juegos originales, 2 ports, 4 utilidades, 5 emuladores.
                    let category = match s(p, "type").as_str() {
                        "1" | "2" => "game",
                        "5" => "emulator",
                        "4" => "tool",
                        _ => "other",
                    };
                    let file = |f: String| opt(f).map(|f| if f.starts_with("http") { f } else { format!("{base}/{}", f.trim_start_matches('/')) });
                    Some(HomebrewEntry {
                        id: format!("vita:{id}"),
                        system: "vita".into(),
                        name: s(p, "name"),
                        author: s(p, "author"),
                        version: s(p, "version"),
                        description: s(p, "description"),
                        details: s(p, "long_description"),
                        category: category.into(),
                        icon: opt(s(p, "icon")).map(|i| format!("{base}/icons/{i}")),
                        screens: s(p, "screenshots").split(';').filter(|x| !x.trim().is_empty()).take(6).filter_map(|x| file(x.trim().to_string())).collect(),
                        size: Some(num(p, "size")).filter(|n| *n > 0),
                        url,
                        binary: None,
                        site: opt(s(p, "source")).or_else(|| opt(s(p, "release_page"))),
                        license: None,
                        updated: opt(s(p, "date")),
                        requirements: opt(s(p, "requirements")),
                        downloads: num(p, "downloads"),
                        runnable: true,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// La descarga preferida de una entrada de Universal-DB: el .3dsx; si no, un comprimido
/// (puede traerlo dentro); si no, el .cia (se instala en el emulador, no se juega suelto).
fn udb_pick(downloads: &serde_json::Map<String, serde_json::Value>) -> Option<(String, String, Option<u64>, bool)> {
    let mut best: Option<(u8, String, String, Option<u64>)> = None;
    for (name, d) in downloads {
        let url = s(d, "url");
        if !url.starts_with("https://") {
            continue;
        }
        let lower = name.to_lowercase();
        let rank = if lower.ends_with(".3dsx") {
            3
        } else if lower.ends_with(".zip") || lower.ends_with(".7z") {
            2
        } else if lower.ends_with(".cia") {
            1
        } else {
            continue;
        };
        if best.as_ref().is_none_or(|b| rank > b.0) {
            best = Some((rank, name.clone(), url, Some(num(d, "size")).filter(|n| *n > 0)));
        }
    }
    best.map(|(r, n, u, sz)| (n, u, sz, r >= 2))
}

pub fn parse_3ds(v: &serde_json::Value) -> Vec<HomebrewEntry> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter(|p| p.get("systems").and_then(|s| s.as_array()).is_some_and(|s| s.iter().any(|x| x.as_str().is_some_and(|x| x.eq_ignore_ascii_case("3ds")))))
                .filter_map(|p| {
                    let slug = s(p, "slug");
                    if slug.is_empty() {
                        return None;
                    }
                    let (file, url, size, runnable) = udb_pick(p.get("downloads")?.as_object()?)?;
                    let cats: Vec<String> = p.get("categories").and_then(|c| c.as_array()).map(|c| c.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
                    let category = if cats.iter().any(|c| c == "game") {
                        "game"
                    } else if cats.iter().any(|c| c == "emulator") {
                        "emulator"
                    } else if cats.iter().any(|c| matches!(c.as_str(), "utility" | "app" | "save-tool" | "firm" | "plugin" | "exploit")) {
                        "tool"
                    } else {
                        "other"
                    };
                    let updated = opt(s(p, "updated")).or_else(|| opt(s(p, "created"))).map(|d| d.chars().take(10).collect());
                    let mut screens: Vec<String> = p
                        .get("screenshots")
                        .and_then(|x| x.as_array())
                        .map(|a| a.iter().filter_map(|x| x.get("url").and_then(|u| u.as_str()).map(str::to_string)).take(6).collect())
                        .unwrap_or_default();
                    if screens.is_empty() {
                        screens.extend(opt(s(p, "image")).filter(|i| Some(i.clone()) != opt(s(p, "icon"))));
                    }
                    Some(HomebrewEntry {
                        id: format!("3ds:{slug}"),
                        system: "3ds".into(),
                        name: s(p, "title"),
                        author: s(p, "author"),
                        version: opt(s(p, "version")).unwrap_or_default(),
                        description: s(p, "description"),
                        details: s(p, "long_description"),
                        category: category.into(),
                        icon: opt(s(p, "icon")),
                        screens,
                        size,
                        url,
                        binary: Some(file),
                        site: opt(s(p, "source")).or_else(|| opt(s(p, "download_page"))),
                        license: opt(s(p, "license_name")),
                        updated,
                        requirements: None,
                        downloads: num(p, "stars"),
                        runnable,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse(system: &str, v: &serde_json::Value) -> Vec<HomebrewEntry> {
    match system {
        "switch" => parse_switch(v),
        "vita" => parse_vita(v),
        _ => parse_3ds(v),
    }
}

// ───────────────────────── red (directa o por el relay) ─────────────────────────

fn client() -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(1800))
        .connect_timeout(Duration::from_secs(15))
        .user_agent(format!("ejGames/{} (+https://github.com/ej3mpl0/ejGames)", env!("CARGO_PKG_VERSION")))
        .build()?)
}

/// GET firmado al relay (`/hb/...`). Si el reloj del PC va mal, un segundo intento con la hora del relay.
async fn relay_get(http: &reqwest::Client, path_and_query: &str) -> anyhow::Result<reqwest::Response> {
    use super::fitgirl::{relay, relay_signature, unix_now};
    let (base, key) = relay().ok_or_else(|| anyhow::anyhow!("sin relay"))?;
    let mut time = unix_now();
    for _ in 0..2 {
        let r = http
            .get(format!("{base}{path_and_query}"))
            .header("X-Ejg-Time", time.to_string())
            .header("X-Ejg-Sig", relay_signature(key, time, path_and_query))
            .send()
            .await?;
        if r.status() == reqwest::StatusCode::UNAUTHORIZED {
            if let Some(now) = r.headers().get("X-Ejg-Now").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<i64>().ok()) {
                time = now;
                continue;
            }
        }
        return Ok(r.error_for_status()?);
    }
    anyhow::bail!("el relay no acepta la firma")
}

async fn fetch_catalog(system: &str) -> anyhow::Result<serde_json::Value> {
    let http = client()?;
    let direct = async {
        let mut req = http.get(source_url(system)).timeout(Duration::from_secs(60));
        if system == "vita" {
            req = req.header("user-agent", BROWSER_UA);
        }
        let v: serde_json::Value = req.send().await?.error_for_status()?.json().await?;
        anyhow::Ok(v)
    }
    .await;
    match direct {
        Ok(v) if !parse(system, &v).is_empty() => Ok(v),
        other => {
            let why = match &other {
                Ok(_) => "catálogo vacío".to_string(),
                Err(e) => format!("{e:#}"),
            };
            tracing::info!("homebrew {system}: directo no ({why}); se prueba el relay");
            match relay_get(&http, &format!("/hb/{system}")).await {
                Ok(r) => Ok(r.json().await?),
                Err(e) => anyhow::bail!("{why} · relay: {e:#}"),
            }
        }
    }
}

struct Cache {
    at: Instant,
    items: Vec<HomebrewEntry>,
    error: Option<String>,
}

static CACHE: Mutex<Option<HashMap<String, Cache>>> = Mutex::new(None);

fn disk_file(st: &AppState, system: &str) -> PathBuf {
    st.paths.root.join("cache").join(format!("homebrew-{system}.json"))
}

/// El catálogo de un sistema: de memoria, de la red (cada 6 h o con `force`) o del disco.
pub async fn catalog(st: &AppState, system: &str, force: bool) -> (Vec<HomebrewEntry>, Option<String>) {
    if !SYSTEMS.contains(&system) {
        return (vec![], Some("Sistema desconocido".into()));
    }
    if !force {
        if let Some(c) = CACHE.lock().as_ref().and_then(|m| m.get(system)).filter(|c| c.at.elapsed() < TTL) {
            return (c.items.clone(), c.error.clone());
        }
    }
    let (items, error) = match fetch_catalog(system).await {
        Ok(v) => {
            let items = parse(system, &v);
            let file = disk_file(st, system);
            if let Some(d) = file.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = std::fs::write(&file, serde_json::to_vec(&items).unwrap_or_default());
            (items, None)
        }
        Err(e) => {
            tracing::warn!("homebrew {system}: {e:#}");
            let old: Vec<HomebrewEntry> = std::fs::read(disk_file(st, system)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
            (old, Some(format!("{e:#}")))
        }
    };
    CACHE.lock().get_or_insert_with(HashMap::new).insert(system.into(), Cache { at: Instant::now(), items: items.clone(), error: error.clone() });
    (items, error)
}

// ───────────────────────── instalado ─────────────────────────

#[derive(Serialize, Deserialize)]
struct Meta {
    id: String,
    version: String,
    /// Lo que se lanza, relativo a la carpeta.
    run: String,
}

pub fn hb_dir(st: &AppState) -> PathBuf {
    st.paths.root.join("homebrew")
}

fn safe(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' }).collect()
}

fn dir_of(st: &AppState, id: &str) -> Option<PathBuf> {
    let (system, rest) = id.split_once(':')?;
    SYSTEMS.contains(&system).then(|| hb_dir(st).join(system).join(safe(rest)))
}

fn installed(st: &AppState, id: &str) -> Option<(Meta, PathBuf)> {
    let dir = dir_of(st, id)?;
    let m: Meta = serde_json::from_slice(&std::fs::read(dir.join(META)).ok()?).ok()?;
    let run = dir.join(&m.run);
    run.is_file().then_some((m, run))
}

/// Página del catálogo: búsqueda, categoría y orden (popular | recent | name).
pub async fn page(st: &Arc<AppState>, system: &str, query: &str, category: &str, sort: &str, page: usize, force: bool) -> HbPage {
    let (all, error) = catalog(st, system, force).await;
    let q = crate::library::names::clean_title(query).to_lowercase();
    let mut cats: HashMap<String, usize> = HashMap::new();
    for e in &all {
        *cats.entry(e.category.clone()).or_default() += 1;
    }
    let mut categories: Vec<(String, usize)> = cats.into_iter().collect();
    categories.sort_by_key(|c| std::cmp::Reverse(c.1));
    let mut list: Vec<&HomebrewEntry> = all
        .iter()
        .filter(|e| category.is_empty() || category == "all" || e.category == category)
        .filter(|e| q.is_empty() || e.name.to_lowercase().contains(&q) || e.author.to_lowercase().contains(&q) || e.description.to_lowercase().contains(&q))
        .collect();
    match sort {
        "recent" => list.sort_by_key(|e| std::cmp::Reverse(e.updated.clone())),
        "name" => list.sort_by_key(|e| e.name.to_lowercase()),
        _ => list.sort_by_key(|e| std::cmp::Reverse(e.downloads)),
    }
    let total = list.len();
    let pages = total.div_ceil(PER_PAGE).max(1);
    let page = page.clamp(1, pages);
    let ids = game_ids(st);
    let items = list
        .into_iter()
        .skip((page - 1) * PER_PAGE)
        .take(PER_PAGE)
        .map(|e| item(st, e, &ids))
        .collect();
    let settings = st.settings.get();
    let emulator = crate::emulation::resolve(&settings, Some(&crate::emulation::install::emu_dir(st)), system, false).map(|c| crate::emulation::cfg_name(&c)).unwrap_or_default();
    HbPage { items, total, page, pages, categories, emulator, error }
}

fn game_ids(st: &AppState) -> HashMap<String, i64> {
    st.db
        .with(|c| {
            let mut q = c.prepare("SELECT source_id, id FROM games WHERE source = 'homebrew'")?;
            let v = q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?.collect::<rusqlite::Result<_>>()?;
            Ok(v)
        })
        .unwrap_or_default()
}

fn item(st: &AppState, e: &HomebrewEntry, ids: &HashMap<String, i64>) -> HbItem {
    let inst = installed(st, &e.id).map(|(m, run)| HbInstalled { version: m.version, path: run.to_string_lossy().into_owned(), game_id: ids.get(&e.id).copied() });
    let update = inst.as_ref().is_some_and(|i| !e.version.is_empty() && i.version != e.version && crate::emulation::install::newer(&e.version, &i.version));
    HbItem { entry: e.clone(), installed: inst, update }
}

// ───────────────────────── instalar ─────────────────────────

static BUSY: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn emit(st: &AppState, id: &str, phase: &str, received: u64, total: u64, message: Option<&str>) {
    let _ = st.app.emit("hb:progress", serde_json::json!({ "id": id, "phase": phase, "received": received, "total": total, "message": message }));
}

async fn download(st: &AppState, e: &HomebrewEntry, dest: &Path) -> anyhow::Result<()> {
    let http = client()?;
    let mut resp = match http.get(&e.url).send().await.and_then(|r| r.error_for_status()) {
        Ok(r) => r,
        Err(err) => {
            tracing::info!("homebrew {}: directo no ({err}); se prueba el relay", e.id);
            let (sys, rest) = e.id.split_once(':').unwrap_or_default();
            relay_get(&http, &format!("/hb/file?system={sys}&id={}", enc(rest))).await.map_err(|r| anyhow::anyhow!("{err} · relay: {r:#}"))?
        }
    };
    if resp.url().scheme() != "https" {
        anyhow::bail!("{}", crate::i18n::t("Origen de la descarga no permitido"));
    }
    let total = resp.content_length().or(e.size).unwrap_or(0);
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part)?;
    let (mut got, mut last) = (0u64, Instant::now() - Duration::from_secs(1));
    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk)?;
        got += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(150) {
            last = Instant::now();
            emit(st, &e.id, "download", got, total, None);
        }
    }
    file.flush()?;
    drop(file);
    std::fs::rename(&part, dest)?;
    emit(st, &e.id, "download", got, got, None);
    Ok(())
}

/// Lo que se juega dentro de lo descargado: el .nro de Switch (la ruta del catálogo o
/// el primero), el .vpk de Vita, el .3dsx de 3DS.
fn runnable_in(dir: &Path, system: &str, binary: Option<&str>) -> Option<PathBuf> {
    if let Some(b) = binary.filter(|_| system == "switch") {
        let p = dir.join(b.trim_start_matches(['/', '\\']));
        if p.is_file() {
            return Some(p);
        }
    }
    let want = match system {
        "switch" => "nro",
        "vita" => "vpk",
        _ => "3dsx",
    };
    walkdir::WalkDir::new(dir)
        .max_depth(5)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|f| f.file_type().is_file() && f.path().extension().is_some_and(|x| x.to_string_lossy().eq_ignore_ascii_case(want)))
        .map(|f| f.into_path())
        .min_by_key(|p| p.components().count())
}

pub async fn install(st: &Arc<AppState>, id: &str) -> anyhow::Result<i64> {
    if !BUSY.lock().get_or_insert_with(HashSet::new).insert(id.to_string()) {
        anyhow::bail!("{}", crate::i18n::t("Ya se está instalando"));
    }
    let r = install_inner(st, id).await;
    BUSY.lock().get_or_insert_with(HashSet::new).remove(id);
    match &r {
        Ok(_) => emit(st, id, "done", 0, 0, None),
        Err(e) => emit(st, id, "error", 0, 0, Some(&format!("{e:#}"))),
    }
    r
}

async fn install_inner(st: &Arc<AppState>, id: &str) -> anyhow::Result<i64> {
    let (system, _) = id.split_once(':').ok_or_else(|| anyhow::anyhow!("id no válido"))?;
    let (all, _) = catalog(st, system, false).await;
    let e = all.into_iter().find(|x| x.id == id).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("No está en el catálogo")))?;
    if !e.runnable {
        anyhow::bail!("{}", crate::i18n::t("Este homebrew es para la consola real: no se puede jugar con emulador"));
    }
    let dir = dir_of(st, id).ok_or_else(|| anyhow::anyhow!("id no válido"))?;
    let tmp = dir.with_extension("descarga");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;
    let fname = e
        .url
        .rsplit('/')
        .next()
        .map(|n| n.split('?').next().unwrap_or(n).to_string())
        .filter(|n| n.contains('.') && !n.ends_with(".php"))
        .or_else(|| e.binary.clone().and_then(|b| Path::new(&b).file_name().map(|n| n.to_string_lossy().into_owned())))
        .unwrap_or_else(|| format!("{}.{}", safe(&e.name), if system == "vita" { "vpk" } else { "zip" }));
    let fname: String = fname.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' ')).collect();
    let file = tmp.join(&fname);
    let res = async {
        download(st, &e, &file).await?;
        emit(st, id, "extract", 0, 0, None);
        let lower = fname.to_lowercase();
        let content = tmp.join("contenido");
        let (f2, c2) = (file.clone(), content.clone());
        if lower.ends_with(".zip") || lower.ends_with(".7z") {
            tauri::async_runtime::spawn_blocking(move || crate::emulation::install::extract(&f2, &c2)).await??;
        } else {
            std::fs::create_dir_all(&content)?;
            std::fs::rename(&file, content.join(&fname))?;
        }
        let run = runnable_in(&content, system, e.binary.as_deref()).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("No se encontró nada que jugar dentro de lo descargado")))?;
        let rel = run.strip_prefix(&content)?.to_path_buf();
        // Al actualizar, la versión nueva sustituye a la anterior (las partidas van en el emulador).
        let _ = std::fs::remove_dir_all(&dir);
        if let Some(p) = dir.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::rename(&content, &dir)?;
        std::fs::write(dir.join(META), serde_json::to_vec_pretty(&Meta { id: e.id.clone(), version: e.version.clone(), run: rel.to_string_lossy().into_owned() })?)?;
        anyhow::Ok(dir.join(rel))
    }
    .await;
    let _ = std::fs::remove_dir_all(&tmp);
    let run = res?;
    register(st, &e, &run).await
}

/// En la biblioteca como un juego más (origen «homebrew»), con su icono, capturas y descripción.
async fn register(st: &Arc<AppState>, e: &HomebrewEntry, run: &Path) -> anyhow::Result<i64> {
    let mut info = crate::emulation::rominfo::read(run, &e.system);
    info.kind = None;
    info.base_title_id = None;
    if info.version.is_none() && !e.version.is_empty() {
        info.version = Some(e.version.clone());
    }
    let g = crate::db::models::NewGame {
        title: e.name.clone(),
        source: "homebrew".into(),
        source_id: e.id.clone(),
        install_dir: run.parent().map(|p| p.to_string_lossy().into_owned()),
        platform: Some(e.system.clone()),
        rom_path: Some(run.to_string_lossy().into_owned()),
        rom_meta: serde_json::to_string(&info).ok(),
        ..Default::default()
    };
    let (gid, _) = st.db.with(|c| crate::db::repo::upsert_game(c, &g))?.ok_or_else(|| anyhow::anyhow!("No se pudo añadir a la biblioteca"))?;
    if let (Some(pid), Some(pf)) = (*st.profile.read(), crate::emulation::platform(&e.system)) {
        let _ = st.db.with(|c| crate::db::repo::ensure_platform_collection(c, pid, pf.name, pf.id));
    }
    let mut m = crate::metadata::Metadata {
        title: Some(e.name.clone()),
        description: opt(if e.details.is_empty() { e.description.clone() } else { e.details.clone() }),
        short_description: opt(e.description.clone()),
        developer: opt(e.author.clone()),
        publisher: opt(e.author.clone()),
        release_date: e.updated.clone(),
        genres: vec!["Homebrew".into()],
        ..Default::default()
    };
    if let Some(icon) = &e.icon {
        m.art.push(crate::metadata::ArtItem::new("icon", icon.clone(), "homebrew"));
        m.art.push(crate::metadata::ArtItem::new("cover", icon.clone(), "homebrew"));
    }
    if let Some(first) = e.screens.first() {
        m.art.push(crate::metadata::ArtItem::new("hero", first.clone(), "homebrew"));
    }
    for (i, sc) in e.screens.iter().enumerate() {
        let mut a = crate::metadata::ArtItem::new("screenshot", sc.clone(), "homebrew");
        a.position = i as i64;
        m.art.push(a);
    }
    if let Err(err) = crate::metadata::apply(st, gid, &m, "manual", 1.0, true).await {
        tracing::warn!("homebrew {}: datos: {err:#}", e.id);
    }
    crate::events::library_reset(st);
    Ok(gid)
}

/// Lo quita del disco y de la biblioteca.
pub fn uninstall(st: &AppState, id: &str) -> anyhow::Result<()> {
    let dir = dir_of(st, id).ok_or_else(|| anyhow::anyhow!("id no válido"))?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    st.db.with(|c| c.execute("DELETE FROM games WHERE source = 'homebrew' AND source_id = ?1", [id]))?;
    crate::events::library_reset(st);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switch_catalog() {
        let v = serde_json::json!({ "packages": [
            { "name": "100boxesNX", "title": "100 Boxes NX", "author": "Cid2mizard", "category": "game", "binary": "/switch/100_Boxes_NX/100 Boxes NX.nro",
              "version": "1.1", "filesize": 4571, "updated": "01/02/2020", "app_dls": 576, "screens": 2, "details": "Line\\nOther" },
            { "name": "BootSoundNX", "category": "advanced", "binary": "none", "version": "1" },
            { "name": "../malo", "category": "game", "binary": "/x.nro" }
        ]});
        let l = parse_switch(&v);
        assert_eq!(l.len(), 2);
        let a = &l[0];
        assert_eq!((a.id.as_str(), a.category.as_str(), a.runnable, a.updated.as_deref()), ("switch:100boxesNX", "game", true, Some("2020-02-01")));
        assert_eq!(a.url, "https://switch.cdn.fortheusers.org/zips/100boxesNX.zip");
        assert_eq!(a.screens.len(), 2);
        assert_eq!(a.size, Some(4571 * 1024));
        assert_eq!(a.details, "Line\nOther");
        assert!(!l[1].runnable);
        assert_eq!(l[1].category, "tool");
    }

    #[test]
    fn vita_catalog() {
        let v = serde_json::json!([
            { "name": "VitaQuake", "id": "12", "type": "2", "url": "https://www.rinnegatamante.eu/vitadb/get_hb_url.php?id=12", "icon": "a.png",
              "screenshots": "screenshots/1.png;screenshots/2.png", "size": "1000", "date": "2024-01-02", "requirements": "- Datos del juego" },
            { "name": "Malo", "id": "x1", "url": "https://x" }
        ]);
        let l = parse_vita(&v);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].icon.as_deref(), Some("https://www.rinnegatamante.eu/vitadb/icons/a.png"));
        assert_eq!(l[0].screens[1], "https://www.rinnegatamante.eu/vitadb/screenshots/2.png");
        assert_eq!((l[0].category.as_str(), l[0].runnable), ("game", true));
    }

    #[test]
    fn udb_prefers_3dsx_and_only_3ds() {
        let v = serde_json::json!([
            { "slug": "juego", "title": "Juego", "systems": ["3DS"], "categories": ["game"],
              "downloads": { "juego.cia": { "url": "https://github.com/a/juego.cia" }, "juego.3dsx": { "url": "https://github.com/a/juego.3dsx", "size": 10 } } },
            { "slug": "solo-cia", "title": "Cia", "systems": ["3DS"], "categories": ["utility"], "downloads": { "x.cia": { "url": "https://github.com/a/x.cia" } } },
            { "slug": "ds", "title": "DS", "systems": ["DS"], "downloads": { "x.nds": { "url": "https://github.com/a/x.nds" } } }
        ]);
        let l = parse_3ds(&v);
        assert_eq!(l.len(), 2);
        assert_eq!((l[0].url.as_str(), l[0].runnable), ("https://github.com/a/juego.3dsx", true));
        assert_eq!((l[1].runnable, l[1].category.as_str()), (false, "tool"));
    }

    #[test]
    fn finds_what_to_run() {
        let d = tempfile::tempdir().unwrap();
        let app = d.path().join("switch").join("App");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(app.join("App.nro"), b"x").unwrap();
        std::fs::write(d.path().join("otro.nro"), b"x").unwrap();
        assert_eq!(runnable_in(d.path(), "switch", Some("/switch/App/App.nro")).unwrap(), app.join("App.nro"));
        assert_eq!(runnable_in(d.path(), "switch", Some("/no/existe.nro")).unwrap(), d.path().join("otro.nro"));
        assert!(runnable_in(d.path(), "vita", None).is_none());
    }

    /// Baja de verdad uno pequeño y jugable de cada sistema y comprueba que se encuentra qué lanzar
    /// y que la cabecera se lee: `cargo test --lib live_install_homebrew -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_install_homebrew() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        for sys in SYSTEMS {
            let l = parse(sys, &rt.block_on(fetch_catalog(sys)).unwrap());
            let e = l.iter().filter(|e| e.runnable && e.size.is_some_and(|s| s < 3_000_000)).find(|e| e.category == "game").unwrap();
            let d = tempfile::tempdir().unwrap();
            let bytes = rt.block_on(async { client().unwrap().get(&e.url).send().await.unwrap().error_for_status().unwrap().bytes().await.unwrap() });
            let name = if e.url.ends_with(".3dsx") { "x.3dsx" } else if *sys == "vita" { "x.vpk" } else { "x.zip" };
            let f = d.path().join(name);
            std::fs::write(&f, &bytes).unwrap();
            let out = d.path().join("out");
            if name.ends_with(".zip") {
                crate::emulation::install::extract(&f, &out).unwrap();
            } else {
                std::fs::create_dir_all(&out).unwrap();
                std::fs::rename(&f, out.join(name)).unwrap();
            }
            let run = runnable_in(&out, sys, e.binary.as_deref()).unwrap_or_else(|| panic!("{sys}: {} sin nada que lanzar", e.name));
            let info = crate::emulation::rominfo::read(&run, sys);
            println!("{sys}: {} ({} KB) → {:?} · {:?}", e.name, bytes.len() / 1024, run.strip_prefix(&out).unwrap(), info);
        }
    }

    /// Los tres catálogos de verdad: `cargo test --lib live_catalogs -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_catalogs() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        for sys in SYSTEMS {
            let v = rt.block_on(fetch_catalog(sys)).unwrap();
            let l = parse(sys, &v);
            let run = l.iter().filter(|e| e.runnable).count();
            println!("{sys}: {} ({run} jugables) · {:?}", l.len(), l.first().map(|e| (&e.name, &e.url)));
            assert!(l.len() > 100, "{sys}");
        }
    }
}
