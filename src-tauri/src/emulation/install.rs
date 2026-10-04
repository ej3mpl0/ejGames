//! Tienda de emuladores: bajar el programa desde su fuente oficial, descomprimirlo
//! en la carpeta de ejGames y dejarlo puesto para los sistemas que sirve.
//!
//! Solo programas: ejGames no baja juegos, BIOS, claves ni firmware. Los que no se
//! pueden bajar de forma fiable (Dolphin está tras una protección anti-bots) se
//! abren en su web.

use super::{platform, PLATFORMS};
use crate::settings::EmulatorCfg;
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

type Pick = fn(&str) -> bool;

enum Source {
    /// Última release de un repositorio de GitHub.
    Github(&'static str, Pick),
    /// Última release de un Forgejo (Eden).
    Forgejo(&'static str, Pick),
    /// URL fija (versión «nightly» de RetroArch).
    Direct(&'static str, &'static str),
    /// Sin descarga automática: se abre su web.
    Web,
}

struct Entry {
    id: &'static str,
    name: &'static str,
    blurb: &'static str,
    /// Sistemas que sirve (vacío = los que tienen núcleo, para RetroArch).
    platforms: &'static [&'static str],
    site: &'static str,
    /// Nombres del ejecutable, el preferido primero.
    exes: &'static [&'static str],
    source: Source,
}

const CATALOG: &[Entry] = &[
    Entry {
        id: "retroarch",
        name: "RetroArch",
        blurb: "Un solo programa para NES, SNES, Game Boy, GBA, N64, Mega Drive, PlayStation, arcade y más, con un núcleo por sistema.",
        platforms: &[],
        site: "https://www.retroarch.com/",
        exes: &["retroarch.exe"],
        source: Source::Direct("https://buildbot.libretro.com/nightly/windows/x86_64/RetroArch.7z", "nightly"),
    },
    Entry {
        id: "pcsx2",
        name: "PCSX2",
        blurb: "PlayStation 2.",
        platforms: &["ps2"],
        site: "https://pcsx2.net/",
        exes: &["pcsx2-qt.exe", "pcsx2.exe"],
        source: Source::Github("PCSX2/pcsx2", |n| n.ends_with("windows-x64-Qt.7z")),
    },
    Entry {
        id: "duckstation",
        name: "DuckStation",
        blurb: "PlayStation 1.",
        platforms: &["psx"],
        site: "https://www.duckstation.org/",
        exes: &["duckstation-qt-x64-ReleaseLTCG.exe", "duckstation-qt.exe", "duckstation.exe"],
        source: Source::Github("stenzek/duckstation", |n| n == "duckstation-windows-x64-release.zip"),
    },
    Entry {
        id: "ppsspp",
        name: "PPSSPP",
        blurb: "PSP.",
        platforms: &["psp"],
        site: "https://www.ppsspp.org/",
        exes: &["PPSSPPWindows64.exe", "PPSSPPWindows.exe"],
        source: Source::Github("hrydgard/ppsspp", |n| n.ends_with("-Windows-x64.zip")),
    },
    Entry {
        id: "cemu",
        name: "Cemu",
        blurb: "Wii U.",
        platforms: &["wiiu"],
        site: "https://cemu.info/",
        exes: &["Cemu.exe"],
        source: Source::Github("cemu-project/Cemu", |n| n.ends_with("-windows-x64.zip")),
    },
    Entry {
        id: "rpcs3",
        name: "RPCS3",
        blurb: "PlayStation 3. Necesita el firmware de tu propia consola.",
        platforms: &["ps3"],
        site: "https://rpcs3.net/",
        exes: &["rpcs3.exe"],
        source: Source::Github("RPCS3/rpcs3-binaries-win", |n| n.ends_with("_win64_msvc.7z")),
    },
    Entry {
        id: "eden",
        name: "Eden",
        blurb: "Nintendo Switch. Necesita las claves y el firmware de tu propia consola.",
        platforms: &["switch"],
        site: "https://eden-emu.dev/",
        exes: &["eden.exe"],
        source: Source::Forgejo("https://git.eden-emu.dev/api/v1/repos/eden-emu/eden/releases/latest", |n| n.starts_with("Eden-Windows-") && n.ends_with("-amd64-msvc-standard.zip")),
    },
    Entry {
        id: "azahar",
        name: "Azahar",
        blurb: "Nintendo 3DS (sucesor de Citra y Lime3DS). Juega tus .3ds/.cci y el homebrew .3dsx.",
        platforms: &["3ds"],
        site: "https://azahar-emu.org/",
        exes: &["azahar.exe", "azahar-qt.exe"],
        source: Source::Github("azahar-emu/azahar", |n| n.starts_with("azahar-windows-msvc-") && n.ends_with(".zip") && !n.contains("installer")),
    },
    Entry {
        id: "vita3k",
        name: "Vita3K",
        blurb: "PS Vita. Necesita el firmware oficial (se instala desde el propio Vita3K); el homebrew .vpk funciona sin más.",
        platforms: &["vita"],
        site: "https://vita3k.org/",
        exes: &["Vita3K.exe"],
        source: Source::Github("Vita3K/Vita3K", |n| n == "windows-latest.zip"),
    },
    Entry {
        id: "dolphin",
        name: "Dolphin",
        blurb: "GameCube y Wii. Se baja de su web (tiene protección anti-bots): descomprímelo donde quieras y pulsa «Buscar emuladores».",
        platforms: &["gc", "wii"],
        site: "https://dolphin-emu.org/download/",
        exes: &["Dolphin.exe"],
        source: Source::Web,
    },
];

/// De dónde se pueden bajar los programas (lo que dice una API de GitHub no basta).
fn allowed_host(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url) else { return false };
    u.scheme() == "https"
        && matches!(
            u.host_str(),
            Some("github.com")
                | Some("objects.githubusercontent.com")
                | Some("release-assets.githubusercontent.com")
                | Some("stable.eden-emu.dev")
                | Some("buildbot.libretro.com")
        )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub version: String,
    pub dir: String,
    pub exe: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreItem {
    pub id: String,
    pub name: String,
    pub blurb: String,
    /// Nombres de los sistemas que sirve.
    pub systems: Vec<String>,
    /// Sus ids (`switch`, `ps2`…), en el mismo orden.
    pub platforms: Vec<String>,
    pub site: String,
    /// Se puede instalar desde ejGames.
    pub auto: bool,
    pub installed: Option<Installed>,
    pub latest: Option<String>,
    pub size: Option<u64>,
    /// Hay una versión más nueva que la instalada.
    pub update: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
struct Latest {
    version: String,
    url: String,
    name: String,
    size: Option<u64>,
    sha256: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Meta {
    id: String,
    version: String,
    exe: String,
}

const META: &str = ".ejgames-emulator.json";

pub fn emu_dir(st: &AppState) -> PathBuf {
    let s = st.settings.get();
    if s.emulators_dir.trim().is_empty() {
        st.paths.root.join("emulators")
    } else {
        PathBuf::from(s.emulators_dir)
    }
}

fn entry(id: &str) -> Option<&'static Entry> {
    CATALOG.iter().find(|e| e.id == id)
}

fn systems_of(e: &Entry) -> Vec<&'static str> {
    if e.platforms.is_empty() {
        PLATFORMS.iter().filter(|p| !p.core.is_empty()).map(|p| p.id).collect()
    } else {
        e.platforms.to_vec()
    }
}

pub fn installed(dir: &Path, id: &str) -> Option<Installed> {
    let base = dir.join(id);
    let m: Meta = serde_json::from_slice(&std::fs::read(base.join(META)).ok()?).ok()?;
    let exe = base.join(&m.exe);
    exe.is_file().then(|| Installed { version: m.version, dir: base.to_string_lossy().into_owned(), exe: exe.to_string_lossy().into_owned() })
}

/// Cuál es más nueva: compara los números («v2.8.2» > «v2.8.1», «0.0.43-20210» > «0.0.43-20100»).
pub fn newer(latest: &str, installed: &str) -> bool {
    let nums = |s: &str| -> Vec<u64> { s.split(|c: char| !c.is_ascii_digit()).filter(|x| !x.is_empty()).filter_map(|x| x.parse().ok()).collect() };
    let (a, b) = (nums(latest), nums(installed));
    !a.is_empty() && a > b
}

fn client() -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .connect_timeout(Duration::from_secs(15))
        .user_agent(format!("ejGames/{} (+https://github.com/ej3mpl0/ejGames)", env!("CARGO_PKG_VERSION")))
        .build()?)
}

async fn latest_of(e: &Entry) -> anyhow::Result<Latest> {
    let http = client()?;
    let (json_url, pick): (&str, Pick) = match &e.source {
        Source::Github(repo, pick) => {
            return github_latest(&http, repo, *pick).await;
        }
        Source::Forgejo(url, pick) => (url, *pick),
        Source::Direct(url, fallback) => {
            let head = http.head(*url).send().await.ok();
            let size = head.as_ref().and_then(|r| r.content_length()).filter(|n| *n > 0);
            // Compilación diaria: la versión es su fecha (Last-Modified), para saber si hay otra más nueva.
            let version = head
                .as_ref()
                .and_then(|r| r.headers().get("last-modified")?.to_str().ok().map(str::to_string))
                .and_then(|d| chrono::DateTime::parse_from_rfc2822(&d).ok())
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| (*fallback).into());
            return Ok(Latest { version, url: (*url).into(), name: url.rsplit('/').next().unwrap_or("emulador").into(), size, sha256: None });
        }
        Source::Web => anyhow::bail!("{}", crate::i18n::t("Se baja de su web")),
    };
    let v: serde_json::Value = http.get(json_url).send().await?.error_for_status()?.json().await?;
    pick_asset(&v, pick)
}

async fn github_latest(http: &reqwest::Client, repo: &str, pick: Pick) -> anyhow::Result<Latest> {
    let v: serde_json::Value = http
        .get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .header("accept", "application/vnd.github+json")
        .header("x-github-api-version", "2022-11-28")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    pick_asset(&v, pick)
}

fn pick_asset(release: &serde_json::Value, pick: Pick) -> anyhow::Result<Latest> {
    let assets = release.get("assets").and_then(|a| a.as_array()).cloned().unwrap_or_default();
    let a = assets
        .iter()
        .find(|a| a.get("name").and_then(|n| n.as_str()).is_some_and(pick))
        .ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("La última versión no trae el programa para Windows")))?;
    let name = a["name"].as_str().unwrap_or_default().to_string();
    let url = a.get("browser_download_url").and_then(|u| u.as_str()).unwrap_or_default().to_string();
    let tag = release.get("tag_name").and_then(|t| t.as_str()).unwrap_or("");
    // RPCS3 etiqueta cada compilación con un hash: la versión útil va en el nombre del fichero.
    let version = if tag.starts_with("build-") {
        name.trim_start_matches("rpcs3-").split("_win").next().unwrap_or(&name).to_string()
    } else if !tag.chars().any(|c| c.is_ascii_digit()) {
        // Etiqueta móvil («latest» en DuckStation): la fecha de publicación.
        release.get("published_at").and_then(|d| d.as_str()).map(|d| d.chars().take(10).collect()).unwrap_or_else(|| tag.to_string())
    } else {
        tag.to_string()
    };
    let sha256 = a.get("digest").and_then(|d| d.as_str()).and_then(|d| d.strip_prefix("sha256:")).map(|h| h.to_ascii_lowercase()).filter(|h| h.len() == 64);
    Ok(Latest { version, url, name, size: a.get("size").and_then(|s| s.as_u64()).filter(|s| *s > 0), sha256 })
}

static LATEST: Mutex<Option<(Instant, std::collections::HashMap<&'static str, Result<Latest, String>>)>> = Mutex::new(None);

/// El catálogo con lo instalado y lo último publicado (consulta la red como mucho cada 30 min).
pub async fn store(st: &Arc<AppState>, force: bool) -> Vec<StoreItem> {
    let fresh = LATEST.lock().as_ref().is_some_and(|(t, _)| t.elapsed() < Duration::from_secs(1800));
    if force || !fresh {
        let futs = CATALOG.iter().filter(|e| !matches!(e.source, Source::Web)).map(|e| async move { (e.id, latest_of(e).await.map_err(|x| format!("{x:#}"))) });
        let all: std::collections::HashMap<&'static str, Result<Latest, String>> = futures::future::join_all(futs).await.into_iter().collect();
        *LATEST.lock() = Some((Instant::now(), all));
    }
    let dir = emu_dir(st);
    let guard = LATEST.lock();
    let latest = guard.as_ref().map(|(_, m)| m);
    CATALOG
        .iter()
        .map(|e| {
            let inst = installed(&dir, e.id);
            let l = latest.and_then(|m| m.get(e.id));
            let (lv, size, err) = match l {
                Some(Ok(x)) => (Some(x.version.clone()), x.size, None),
                Some(Err(m)) => (None, None, Some(m.clone())),
                None => (None, None, None),
            };
            let update = match (&inst, &lv) {
                (Some(i), Some(l)) => l != &i.version && newer(l, &i.version),
                _ => false,
            };
            StoreItem {
                id: e.id.into(),
                name: e.name.into(),
                blurb: e.blurb.into(),
                systems: systems_of(e).iter().filter_map(|p| platform(p)).map(|p| p.name.to_string()).collect(),
                platforms: systems_of(e).iter().filter(|p| platform(p).is_some()).map(|p| p.to_string()).collect(),
                site: e.site.into(),
                auto: !matches!(e.source, Source::Web),
                installed: inst,
                latest: lv,
                size,
                update,
                error: err,
            }
        })
        .collect()
}

static BUSY: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn emit(st: &AppState, id: &str, phase: &str, received: u64, total: u64) {
    let _ = st.app.emit("emu:progress", serde_json::json!({ "id": id, "phase": phase, "received": received, "total": total }));
}

async fn download(st: &AppState, id: &str, l: &Latest, dest: &Path) -> anyhow::Result<()> {
    if !allowed_host(&l.url) {
        anyhow::bail!("{}", crate::i18n::t("Origen de la descarga no permitido"));
    }
    let mut resp = client()?.get(&l.url).send().await?.error_for_status()?;
    if !allowed_host(resp.url().as_str()) {
        anyhow::bail!("{}", crate::i18n::t("Origen de la descarga no permitido"));
    }
    let total = resp.content_length().or(l.size).unwrap_or(0);
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part)?;
    let (mut got, mut hasher, mut last) = (0u64, Sha256::new(), Instant::now() - Duration::from_secs(1));
    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk)?;
        hasher.update(&chunk);
        got += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(150) {
            last = Instant::now();
            emit(st, id, "download", got, total);
        }
    }
    file.flush()?;
    drop(file);
    if let Some(expected) = &l.sha256 {
        let sum: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if &sum != expected {
            let _ = std::fs::remove_file(&part);
            anyhow::bail!("{}", crate::i18n::t("La descarga no coincide con la huella publicada"));
        }
    }
    std::fs::rename(&part, dest)?;
    emit(st, id, "download", got, got);
    Ok(())
}

/// Descomprime un .zip o .7z en `dest` (ya vacío), sin salirse de la carpeta.
pub fn extract(archive: &Path, dest: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(dest)?;
    let ext = archive.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "zip" => {
            let mut z = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
            for i in 0..z.len() {
                let mut f = z.by_index(i)?;
                let Some(rel) = f.enclosed_name() else { continue };
                let out = dest.join(rel);
                if f.is_dir() {
                    std::fs::create_dir_all(&out)?;
                    continue;
                }
                if let Some(p) = out.parent() {
                    std::fs::create_dir_all(p)?;
                }
                std::io::copy(&mut f, &mut std::fs::File::create(&out)?)?;
            }
        }
        "7z" => sevenz_rust2::decompress_file(archive, dest).map_err(|e| anyhow::anyhow!("7z: {e}"))?,
        other => anyhow::bail!("Formato no admitido: {other}"),
    }
    // Nada fuera de la carpeta (por si una ruta traía «..»).
    let root = dest.canonicalize()?;
    for e in walkdir::WalkDir::new(dest).into_iter().filter_map(Result::ok) {
        if !e.path().canonicalize().map(|p| p.starts_with(&root)).unwrap_or(false) {
            anyhow::bail!("El archivo trae rutas fuera de su carpeta");
        }
    }
    Ok(())
}

/// El ejecutable del emulador dentro de lo descomprimido (hasta 3 niveles).
pub fn find_exe(dir: &Path, names: &[&str]) -> Option<PathBuf> {
    for name in names {
        for e in walkdir::WalkDir::new(dir).max_depth(3).into_iter().filter_map(Result::ok) {
            if e.file_type().is_file() && e.file_name().to_string_lossy().eq_ignore_ascii_case(name) {
                return Some(e.into_path());
            }
        }
    }
    None
}

pub async fn install(st: &Arc<AppState>, id: &str) -> anyhow::Result<Installed> {
    let e = entry(id).ok_or_else(|| anyhow::anyhow!("Emulador desconocido"))?;
    if matches!(e.source, Source::Web) {
        anyhow::bail!("{}", crate::i18n::t("Este se baja de su web"));
    }
    if !BUSY.lock().get_or_insert_with(HashSet::new).insert(id.to_string()) {
        anyhow::bail!("{}", crate::i18n::t("Ya se está instalando"));
    }
    let r = install_inner(st, e).await;
    BUSY.lock().get_or_insert_with(HashSet::new).remove(id);
    r
}

async fn install_inner(st: &Arc<AppState>, e: &'static Entry) -> anyhow::Result<Installed> {
    let l = latest_of(e).await?;
    let root = emu_dir(st);
    std::fs::create_dir_all(&root)?;
    let tmp = root.join(format!(".descarga-{}", e.id));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;
    let safe: String = l.name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')).collect();
    let archive = tmp.join(if safe.is_empty() { "emulador.zip".into() } else { safe });
    let res = async {
        download(st, e.id, &l, &archive).await?;
        emit(st, e.id, "extract", 0, 0);
        let out = tmp.join("contenido");
        let (a, o) = (archive.clone(), out.clone());
        tauri::async_runtime::spawn_blocking(move || extract(&a, &o)).await??;
        let exe = find_exe(&out, e.exes).ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("No se encontró el programa dentro de lo descargado")))?;
        // La carpeta del programa: la que contiene el ejecutable.
        let exe_dir = exe.parent().unwrap_or(&out).to_path_buf();
        let final_dir = root.join(e.id);
        // Datos del usuario (ajustes, juegos guardados del emulador) de una instalación anterior: se conservan.
        let keep = final_dir.join("user");
        let keep_tmp = tmp.join("user-previo");
        if keep.is_dir() {
            std::fs::rename(&keep, &keep_tmp)?;
        }
        let _ = std::fs::remove_dir_all(&final_dir);
        std::fs::rename(&exe_dir, &final_dir)?;
        if keep_tmp.is_dir() {
            let _ = std::fs::rename(&keep_tmp, final_dir.join("user"));
        }
        let rel = exe.file_name().map(PathBuf::from).unwrap_or_default();
        std::fs::write(final_dir.join(META), serde_json::to_vec_pretty(&Meta { id: e.id.into(), version: l.version.clone(), exe: rel.to_string_lossy().into_owned() })?)?;
        anyhow::Ok(())
    }
    .await;
    let _ = std::fs::remove_dir_all(&tmp);
    res?;
    let inst = installed(&root, e.id).ok_or_else(|| anyhow::anyhow!("No se pudo dejar instalado"))?;
    configure(st, e, &inst.exe)?;
    link(st, e, &inst).await;
    *LATEST.lock() = None;
    emit(st, e.id, "done", 0, 0);
    Ok(inst)
}

/// El emulador también sale en la biblioteca (origen «emulator»), para abrirlo desde ejGames como un juego más.
async fn link(st: &Arc<AppState>, e: &Entry, inst: &Installed) {
    let g = crate::db::models::NewGame {
        title: e.name.into(),
        source: "emulator".into(),
        source_id: e.id.into(),
        install_dir: Some(inst.dir.clone()),
        exe_path: Some(inst.exe.clone()),
        working_dir: Some(inst.dir.clone()),
        ..Default::default()
    };
    match st.db.with(|c| crate::db::repo::upsert_game(c, &g)) {
        Ok(Some((id, is_new))) => {
            if is_new {
                // No es un juego: sin búsqueda de datos (IGDB confundiría «Eden» con otra cosa); su icono, del .exe.
                let _ = st.db.with(|c| c.execute("UPDATE games SET meta_status = 'manual' WHERE id = ?1", [id]));
                let (st2, exe) = (st.clone(), inst.exe.clone());
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    let png = crate::library::pe_info::extract_icon_png(Path::new(&exe))?;
                    let hash = crate::media::store::put(&st2.paths, &png, "png").ok()?;
                    st2.db
                        .with(|c| {
                            let mid = crate::db::repo::insert_media(c, id, "icon", None, "exe", true, 0, None, None)?;
                            crate::db::repo::set_media_file(c, mid, &hash, "png", None, None, None)
                        })
                        .ok()
                })
                .await;
            }
            crate::events::library_changed(st, vec![id]);
        }
        Ok(None) => {}
        Err(err) => tracing::warn!("emulador {} en la biblioteca: {err}", e.id),
    }
}

/// Al arrancar: los emuladores instalados que aún no están en la biblioteca.
pub async fn link_all(st: &Arc<AppState>) {
    let root = emu_dir(st);
    for e in CATALOG {
        if let Some(inst) = installed(&root, e.id) {
            let known: bool = st
                .db
                .with(|c| c.query_row("SELECT COUNT(*) FROM games WHERE source = 'emulator' AND source_id = ?1", [e.id], |r| r.get::<_, i64>(0)))
                .map(|n| n > 0)
                .unwrap_or(true);
            if !known {
                link(st, e, &inst).await;
            }
        }
    }
}

/// Deja el emulador puesto en los sistemas que sirve. Uno independiente manda sobre RetroArch;
/// RetroArch solo rellena los sistemas que no tienen emulador.
fn configure(st: &AppState, e: &Entry, exe: &str) -> anyhow::Result<()> {
    let mine = systems_of(e);
    st.settings.update(|s| {
        for p in &mine {
            let current = s.emulators.iter().position(|c| c.platform == *p);
            let is_ra = e.id == "retroarch";
            if let Some(i) = current {
                // Lo que eligió el usuario a mano (programa propio) no se toca; el resto sí, salvo RetroArch sobre lo ya puesto.
                let c = &s.emulators[i];
                if c.kind == "custom" || (is_ra && Path::new(&c.exe).is_file()) {
                    continue;
                }
                s.emulators.remove(i);
            }
            s.emulators.push(EmulatorCfg {
                platform: (*p).into(),
                kind: if is_ra { "retroarch".into() } else { "preset".into() },
                preset: e.id.into(),
                exe: exe.into(),
                core: String::new(),
                args: String::new(),
            });
        }
    })?;
    Ok(())
}

/// Abre el emulador instalado tal cual (para poner las claves, el firmware o la BIOS, o sus mandos).
pub fn open(st: &AppState, id: &str) -> anyhow::Result<()> {
    let i = installed(&emu_dir(st), id).ok_or_else(|| anyhow::anyhow!(crate::i18n::t("No está instalado")))?;
    std::process::Command::new(&i.exe).current_dir(&i.dir).spawn()?;
    Ok(())
}

/// Quita el programa de ejGames y los sistemas que lo usaban.
pub fn uninstall(st: &AppState, id: &str) -> anyhow::Result<()> {
    let dir = emu_dir(st).join(id);
    let exe = installed(&emu_dir(st), id).map(|i| i.exe);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    if let Some(exe) = exe {
        st.settings.update(|s| s.emulators.retain(|c| c.exe != exe))?;
    }
    st.db.with(|c| c.execute("DELETE FROM games WHERE source = 'emulator' AND source_id = ?1", [id]))?;
    crate::events::library_reset(st);
    *LATEST.lock() = None;
    Ok(())
}

/// Núcleo de RetroArch de un sistema (si no está): se baja de la buildbot de libretro.
pub async fn install_core(st: &Arc<AppState>, platform_id: &str) -> anyhow::Result<String> {
    let cfg = st.settings.get().emulators.into_iter().find(|c| c.platform == platform_id && c.kind == "retroarch");
    let pf = platform(platform_id).ok_or_else(|| anyhow::anyhow!("Sistema desconocido"))?;
    let cfg = cfg.ok_or_else(|| anyhow::anyhow!("{}", crate::i18n::t("Este sistema no usa RetroArch")))?;
    let core = if cfg.core.is_empty() { pf.core.to_string() } else { cfg.core.clone() };
    if core.is_empty() || !core.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        anyhow::bail!("{}", crate::i18n::t("Núcleo no válido"));
    }
    let cores_dir = Path::new(&cfg.exe).parent().map(|d| d.join("cores")).ok_or_else(|| anyhow::anyhow!("RetroArch no está donde se esperaba"))?;
    if cores_dir.join(format!("{core}.dll")).is_file() {
        return Ok(core);
    }
    let url = format!("https://buildbot.libretro.com/nightly/windows/x86_64/latest/{core}.dll.zip");
    let l = Latest { version: "nightly".into(), url, name: format!("{core}.dll.zip"), size: None, sha256: None };
    let tmp = st.paths.root.join(format!(".nucleo-{core}"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;
    let zip = tmp.join(format!("{core}.dll.zip"));
    let r = async {
        download(st, "retroarch", &l, &zip).await?;
        let (z, d) = (zip.clone(), cores_dir.clone());
        tauri::async_runtime::spawn_blocking(move || {
            std::fs::create_dir_all(&d)?;
            let mut a = zip::ZipArchive::new(std::fs::File::open(&z)?)?;
            for i in 0..a.len() {
                let mut f = a.by_index(i)?;
                let Some(name) = f.enclosed_name().and_then(|p| p.file_name().map(|n| n.to_owned())) else { continue };
                if name.to_string_lossy().to_lowercase().ends_with(".dll") {
                    let mut buf = Vec::new();
                    f.read_to_end(&mut buf)?;
                    std::fs::write(d.join(name), buf)?;
                }
            }
            anyhow::Ok(())
        })
        .await??;
        anyhow::Ok(())
    }
    .await;
    let _ = std::fs::remove_dir_all(&tmp);
    r?;
    if !cores_dir.join(format!("{core}.dll")).is_file() {
        anyhow::bail!("{}", crate::i18n::t("El núcleo descargado no trae el .dll esperado"));
    }
    emit(st, "retroarch", "done", 0, 0);
    Ok(core)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rolling_tags_use_the_date() {
        let rel = serde_json::json!({ "tag_name": "latest", "published_at": "2026-10-03T08:00:00Z",
            "assets": [{ "name": "duckstation-windows-x64-release.zip", "browser_download_url": "https://github.com/d", "size": 9 }] });
        assert_eq!(pick_asset(&rel, |n| n == "duckstation-windows-x64-release.zip").unwrap().version, "2026-10-03");
        assert!(newer("2026-10-03", "2026-09-28"));
    }

    #[test]
    fn version_comparison() {
        assert!(newer("v2.8.2", "v2.8.1"));
        assert!(newer("0.0.43-20210", "0.0.43-20100"));
        assert!(!newer("v2.8.2", "v2.8.2"));
        assert!(!newer("v2.8.1", "v2.8.2"));
        assert!(!newer("latest", "v1"));
    }

    #[test]
    fn only_official_hosts_are_allowed() {
        assert!(allowed_host("https://github.com/PCSX2/pcsx2/releases/download/v2/x.7z"));
        assert!(allowed_host("https://stable.eden-emu.dev/v0.2.1/Eden.zip"));
        assert!(allowed_host("https://buildbot.libretro.com/nightly/windows/x86_64/RetroArch.7z"));
        assert!(!allowed_host("http://github.com/x"));
        assert!(!allowed_host("https://github.com.evil.example/x"));
        assert!(!allowed_host("https://example.com/RetroArch.7z"));
    }

    #[test]
    fn catalog_is_consistent() {
        let mut ids = HashSet::new();
        for e in CATALOG {
            assert!(ids.insert(e.id));
            assert!(!e.exes.is_empty());
            for p in e.platforms {
                assert!(platform(p).is_some(), "{} sirve {p}", e.id);
            }
        }
        assert!(systems_of(entry("retroarch").unwrap()).len() > 10);
    }

    #[test]
    fn picks_the_windows_asset_and_rpcs3_version() {
        let rel = serde_json::json!({
            "tag_name": "build-fcbed0bc6d803abc4d7ed1a722f2ac54d4591eee",
            "assets": [
                { "name": "rpcs3-v0.0.43-20210-fcbed0bc_win64_msvc.7z.sha256", "browser_download_url": "https://github.com/a", "size": 1 },
                { "name": "rpcs3-v0.0.43-20210-fcbed0bc_win64_msvc.7z", "browser_download_url": "https://github.com/b", "size": 5,
                  "digest": "sha256:AC178A4F7E8BD2EDD3281111465D6806BA9A2CE6A0B60FBDB2833311B436130B" }
            ]
        });
        let l = pick_asset(&rel, |n| n.ends_with("_win64_msvc.7z")).unwrap();
        assert_eq!(l.version, "v0.0.43-20210-fcbed0bc");
        assert_eq!(l.url, "https://github.com/b");
        assert_eq!(l.sha256.as_deref(), Some("ac178a4f7e8bd2edd3281111465d6806ba9a2ce6a0b60fbdb2833311b436130b"));
        assert!(pick_asset(&rel, |n| n.ends_with(".dmg")).is_err());
    }

    #[test]
    fn extracts_zip_without_escaping() {
        let d = tempfile::tempdir().unwrap();
        let z = d.path().join("a.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&z).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            w.start_file("Carpeta/emu.exe", o).unwrap();
            w.write_all(b"x").unwrap();
            w.start_file("../fuera.txt", o).unwrap();
            w.write_all(b"no").unwrap();
            w.finish().unwrap();
        }
        let out = d.path().join("out");
        extract(&z, &out).unwrap();
        assert!(out.join("Carpeta").join("emu.exe").is_file());
        assert!(!d.path().join("fuera.txt").exists());
        assert_eq!(find_exe(&out, &["EMU.EXE"]).unwrap().file_name().unwrap(), "emu.exe");
    }

    /// Descarga de verdad (más de 100 MB) y comprueba que cada emulador deja su ejecutable:
    /// `cargo test --lib live_install -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_install() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        for e in CATALOG.iter().filter(|e| !matches!(e.source, Source::Web)) {
            let l = rt.block_on(latest_of(e)).unwrap();
            println!("{}: {} {:?} {:?}", e.id, l.version, l.name, l.size);
            assert!(allowed_host(&l.url), "{}", l.url);
            let d = tempfile::tempdir().unwrap();
            let archive = d.path().join(&l.name);
            let bytes = rt.block_on(async { client().unwrap().get(&l.url).send().await.unwrap().bytes().await.unwrap() });
            std::fs::write(&archive, &bytes).unwrap();
            if let Some(h) = &l.sha256 {
                let sum: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
                assert_eq!(&sum, h);
            }
            let out = d.path().join("out");
            extract(&archive, &out).unwrap();
            let exe = find_exe(&out, e.exes);
            println!("   exe: {:?}", exe.as_ref().map(|p| p.strip_prefix(&out).unwrap().to_path_buf()));
            assert!(exe.is_some(), "{} no trae {:?}", e.id, e.exes);
        }
    }
}
