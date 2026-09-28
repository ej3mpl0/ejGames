//! Trucos para juegos de un jugador con los trainers de FLiNG
//! (flingtrainer.com): buscar el del juego, enseñar sus opciones y, si el
//! usuario lo decide, descargarlo y usarlo desde el overlay. Nada se instala
//! sin que lo confirme: la ficha dice de dónde viene, cuánto pesa, qué versión
//! del juego cubre y que los antivirus suelen marcarlos (tocan la memoria del juego).
//!
//! El `.exe` se guarda en `<datos>/trainers/<juego>/`. Se abre con el juego y
//! se cierra con él (ver `run`).

pub mod fling;
pub mod keys;
pub mod run;

pub use run::{Live, Trainers};

use crate::db::repo;
use crate::state::AppState;
use fling::{Candidate, Page, TrainerOption};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const TTL_SEARCH: i64 = 24 * 3600;
const TTL_PAGE: i64 = 6 * 3600;
/// Sin red vale una copia de hasta un mes.
const TTL_STALE: i64 = 30 * 86400;
/// Un trainer pesa ~1 MB; más de esto no es un trainer.
const MAX_BYTES: usize = 50 * 1024 * 1024;

/// Trainer instalado para un juego.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub game_id: i64,
    /// Nombre del archivo en la web ("Elden.Ring.v1.02-v1.16.1.Plus.35.Trainer-FLiNG").
    pub name: String,
    /// Juego según FLiNG.
    pub title: String,
    pub page_url: String,
    pub game_version: Option<String>,
    pub updated: Option<String>,
    pub options: Vec<TrainerOption>,
    pub notes: Vec<String>,
    pub anticheat: Option<String>,
    /// Se abre solo al jugar.
    pub auto_start: bool,
    pub installed_at: i64,
    pub size: u64,
    #[serde(skip)]
    pub exe: String,
    /// El `.exe` sigue en su sitio (un antivirus puede habérselo llevado).
    pub present: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub query: String,
    /// El más parecido primero.
    pub candidates: Vec<Candidate>,
}

fn dir_of(st: &AppState, game_id: i64) -> PathBuf {
    st.paths.root.join("trainers").join(game_id.to_string())
}

fn row_to_installed(r: &rusqlite::Row) -> rusqlite::Result<Installed> {
    let exe: String = r.get("exe")?;
    let options: String = r.get("options_json")?;
    let notes: String = r.get("notes_json")?;
    let meta = std::fs::metadata(&exe).ok();
    Ok(Installed {
        game_id: r.get("game_id")?,
        name: r.get("name")?,
        title: r.get("title")?,
        page_url: r.get("page_url")?,
        game_version: r.get("game_version")?,
        updated: r.get("updated")?,
        options: serde_json::from_str(&options).unwrap_or_default(),
        notes: serde_json::from_str(&notes).unwrap_or_default(),
        anticheat: r.get("anticheat")?,
        auto_start: r.get::<_, i64>("auto_start")? != 0,
        installed_at: r.get("installed_at")?,
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        present: meta.is_some(),
        exe,
    })
}

pub fn installed(st: &AppState, game_id: i64) -> Option<Installed> {
    st.db
        .with(|c| c.query_row("SELECT * FROM trainers WHERE game_id = ?1", [game_id], row_to_installed).optional())
        .ok()
        .flatten()
}

// ───────────────────────────── red ─────────────────────────────

/// Cliente propio: guarda las cookies de la web (las descargas las piden) y
/// solo sigue redirecciones dentro de flingtrainer.com.
fn client(st: &AppState) -> &reqwest::Client {
    st.trainers.client.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(UA)
            .cookie_store(true)
            .gzip(true)
            .timeout(Duration::from_secs(90))
            .connect_timeout(Duration::from_secs(12))
            .pool_idle_timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::custom(|a| {
                if a.previous().len() >= 6 {
                    a.error("demasiadas redirecciones")
                } else if a.url().scheme() == "https" && a.url().host_str() == Some("flingtrainer.com") {
                    a.follow()
                } else {
                    a.error("redirección fuera de flingtrainer.com")
                }
            }))
            .build()
            .expect("cliente http")
    })
}

fn net_error(e: impl std::fmt::Display) -> anyhow::Error {
    let text = e.to_string();
    tracing::warn!("trainers: {text}");
    if text.contains("dns") || text.contains("connect") || text.contains("timed out") {
        anyhow::anyhow!("No se pudo conectar con flingtrainer.com. Revisa tu conexión.")
    } else {
        anyhow::anyhow!("flingtrainer.com no respondió bien ({text})")
    }
}

async fn get_text(st: &AppState, url: &str) -> anyhow::Result<(String, String)> {
    let r = client(st).get(url).header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9").send().await.map_err(net_error)?;
    if !r.status().is_success() {
        return Err(net_error(format!("respondió {}", r.status())));
    }
    let final_url = r.url().to_string();
    Ok((r.text().await.map_err(net_error)?, final_url))
}

fn cache_read<T: for<'de> Deserialize<'de>>(st: &AppState, provider: &str, key: &str, ttl: i64) -> Option<T> {
    st.db.with(|c| repo::cache_get(c, provider, key, ttl)).ok().flatten().and_then(|j| serde_json::from_str(&j).ok())
}

fn cache_write<T: Serialize>(st: &AppState, provider: &str, key: &str, v: &T) {
    if let Ok(j) = serde_json::to_string(v) {
        let _ = st.db.with(|c| repo::cache_put(c, provider, key, &j));
    }
}

// ───────────────────────────── buscar ─────────────────────────────

/// Palabras para buscar: el título sin símbolos ni la coletilla de edición.
fn queries(title: &str) -> Vec<String> {
    let clean: String = title.chars().map(|c| if c.is_alphanumeric() || c == '\'' || c == '’' { c } else { ' ' }).collect();
    let words: Vec<&str> = clean.split_whitespace().collect();
    let mut out = vec![words.join(" ")];
    // Sin «Edition», «Remastered»…: la búsqueda de WordPress pide todas las palabras.
    let cut = words
        .iter()
        .position(|w| matches!(w.to_lowercase().as_str(), "edition" | "remastered" | "definitive" | "complete" | "goty" | "deluxe" | "ultimate" | "enhanced"))
        .map(|i| i.max(1));
    if let Some(n) = cut {
        out.push(words[..n.min(words.len())].join(" "));
    }
    if words.len() > 2 {
        out.push(words[..2].join(" "));
    }
    out.dedup();
    out.retain(|q| !q.is_empty());
    out
}

async fn search(st: &AppState, query: &str, title: &str) -> anyhow::Result<Vec<Candidate>> {
    let key = query.to_lowercase();
    if let Some(v) = cache_read::<Vec<Candidate>>(st, "fling_search", &key, TTL_SEARCH) {
        return Ok(rescore(v, title));
    }
    match get_text(st, &fling::search_url(query)).await {
        Ok((json, _)) => {
            let v = fling::parse_search(&json, title)?;
            cache_write(st, "fling_search", &key, &v);
            Ok(v)
        }
        Err(e) => cache_read(st, "fling_search", &key, TTL_STALE).map(|v| rescore(v, title)).ok_or(e),
    }
}

fn rescore(mut v: Vec<Candidate>, title: &str) -> Vec<Candidate> {
    for c in &mut v {
        c.score = crate::library::names::similarity(title, &c.title);
    }
    v.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    v
}

/// "Elden Ring" → "elden-ring".
fn slugify(title: &str) -> String {
    // Como WordPress: los apóstrofos desaparecen ("Assassin's" → "assassins").
    let s: String = title
        .to_lowercase()
        .chars()
        .filter(|c| !matches!(c, '\'' | '’' | '®' | '™'))
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect();
    s.split_whitespace().collect::<Vec<_>>().join("-")
}

/// La ficha a la que lleva `/trainer/<título>-trainer/`. FLiNG cambia el
/// nombre de la ficha cuando sale un DLC ("Elden Ring" → "… Shadow of the
/// Erdtree") y deja el viejo redirigiendo: es la señal más fiable.
async fn canonical(st: &AppState, title: &str) -> Option<String> {
    let slug = slugify(title);
    if slug.is_empty() {
        return None;
    }
    if let Some(v) = cache_read::<String>(st, "fling_slug", &slug, TTL_SEARCH) {
        return (!v.is_empty()).then_some(v);
    }
    let url = format!("{}/trainer/{slug}-trainer/", fling::SITE);
    let found = match client(st).head(&url).send().await {
        Ok(r) if r.status().is_success() && fling::valid_page(r.url().as_str()) => r.url().to_string(),
        Ok(_) => String::new(),
        Err(_) => return None,
    };
    cache_write(st, "fling_slug", &slug, &found);
    (!found.is_empty()).then_some(found)
}

fn same_page(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

/// Trainers de FLiNG para un juego de la biblioteca (o para `query`, si el
/// usuario escribe otro nombre).
pub async fn find(st: &Arc<AppState>, game_id: i64, query: Option<String>) -> anyhow::Result<Found> {
    let game = st.db.with(|c| repo::get_game(c, game_id))?;
    let title = query.as_deref().map(str::trim).filter(|q| !q.is_empty()).unwrap_or(&game.title).to_string();
    let mut tried = String::new();
    for q in queries(&title) {
        tried = q.clone();
        let mut found = search(st, &q, &title).await?;
        if found.is_empty() {
            continue;
        }
        if let Some(url) = canonical(st, &title).await {
            if let Some(i) = found.iter().position(|c| same_page(&c.url, &url)) {
                let mut c = found.remove(i);
                c.score = c.score.max(0.99);
                found.insert(0, c);
            }
        }
        return Ok(Found { query: q, candidates: found.into_iter().take(12).collect() });
    }
    Ok(Found { query: tried, candidates: vec![] })
}

/// La ficha de un trainer (opciones, versión, descargas).
pub async fn details(st: &Arc<AppState>, url: &str) -> anyhow::Result<Page> {
    if !fling::valid_page(url) {
        anyhow::bail!("Esa no es una ficha de flingtrainer.com");
    }
    if let Some(p) = cache_read(st, "fling_page", url, TTL_PAGE) {
        return Ok(p);
    }
    match get_text(st, url).await {
        Ok((html, final_url)) => {
            let final_url = if fling::valid_page(&final_url) { final_url } else { url.to_string() };
            let page = tauri::async_runtime::spawn_blocking(move || fling::parse_page(&html, &final_url)).await?;
            cache_write(st, "fling_page", url, &page);
            Ok(page)
        }
        Err(e) => cache_read(st, "fling_page", url, TTL_STALE).ok_or(e),
    }
}

// ───────────────────────────── instalar ─────────────────────────────

/// El `.exe` de un zip (el más grande, por si trae algo más).
fn exe_from_zip(bytes: &[u8]) -> anyhow::Result<(String, Vec<u8>)> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes))?;
    let mut best: Option<(usize, u64)> = None;
    for i in 0..z.len() {
        let f = z.by_index(i)?;
        if f.is_file() && f.name().to_lowercase().ends_with(".exe") && f.size() as usize <= MAX_BYTES && best.map(|b| f.size() > b.1).unwrap_or(true) {
            best = Some((i, f.size()));
        }
    }
    let (i, _) = best.ok_or_else(|| anyhow::anyhow!("El archivo descargado no trae ningún .exe"))?;
    let mut f = z.by_index(i)?;
    let name = Path::new(f.name()).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "trainer.exe".into());
    let mut out = Vec::with_capacity(f.size() as usize);
    f.by_ref().take(MAX_BYTES as u64).read_to_end(&mut out)?;
    Ok((name, out))
}

/// Nombre de archivo seguro.
fn safe_name(name: &str) -> String {
    let stem = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(name);
    let s: String = stem.chars().filter(|c| c.is_alphanumeric() || " .-_()+".contains(*c)).take(100).collect();
    let s = s.trim().trim_matches('.').to_string();
    format!("{}.exe", if s.is_empty() { "trainer".into() } else { s })
}

/// Windows Defender a veces borra el archivo al escribirlo (o un momento después).
fn defender_error(e: &std::io::Error) -> Option<anyhow::Error> {
    matches!(e.raw_os_error(), Some(225) | Some(226)).then(|| {
        anyhow::anyhow!(
            "Windows Defender ha bloqueado el trainer. Los trainers tocan la memoria del juego y los antivirus los marcan; si confías en él, permítelo en Seguridad de Windows → Protección contra virus → Historial de protección y vuelve a instalarlo."
        )
    })
}

/// Descarga el trainer elegido. `download_url` tiene que ser uno de los de la ficha.
pub async fn install(st: &Arc<AppState>, game_id: i64, page_url: &str, download_url: &str) -> anyhow::Result<Installed> {
    st.db.with(|c| repo::get_game(c, game_id))?;
    if !fling::valid_page(page_url) || !fling::valid_download(download_url) {
        anyhow::bail!("Enlace no válido");
    }
    // La ficha, recién leída: da las cookies que pide la descarga y confirma el enlace.
    let (html, final_url) = get_text(st, page_url).await?;
    let page_url_final = if fling::valid_page(&final_url) { final_url } else { page_url.to_string() };
    let page = {
        let u = page_url_final.clone();
        tauri::async_runtime::spawn_blocking(move || fling::parse_page(&html, &u)).await?
    };
    let dl = page.downloads.iter().find(|d| d.url == download_url).cloned().ok_or_else(|| anyhow::anyhow!("Ese archivo ya no está en la ficha del trainer"))?;

    let r = client(st).get(&dl.url).header(reqwest::header::REFERER, &page_url_final).send().await.map_err(net_error)?;
    if !r.status().is_success() {
        return Err(net_error(format!("la descarga respondió {}", r.status())));
    }
    if r.content_length().map(|n| n as usize > MAX_BYTES).unwrap_or(false) {
        anyhow::bail!("El archivo es demasiado grande para ser un trainer");
    }
    let last = r.url().path_segments().and_then(|mut s| s.next_back()).map(|s| percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned()).unwrap_or_default();
    let mut bytes = Vec::new();
    let mut stream = r;
    while let Some(chunk) = stream.chunk().await.map_err(net_error)? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_BYTES {
            anyhow::bail!("El archivo es demasiado grande para ser un trainer");
        }
    }
    let (file_name, exe_bytes) = if bytes.starts_with(b"MZ") {
        (if last.to_lowercase().ends_with(".exe") { last } else { format!("{}.exe", dl.name) }, bytes)
    } else if bytes.starts_with(b"PK") {
        tauri::async_runtime::spawn_blocking(move || exe_from_zip(&bytes)).await??
    } else {
        anyhow::bail!("flingtrainer.com no devolvió un trainer (puede que la web haya cambiado)");
    };
    if !exe_bytes.starts_with(b"MZ") {
        anyhow::bail!("El archivo descargado no es un programa de Windows");
    }
    let sha: String = Sha256::digest(&exe_bytes).iter().map(|b| format!("{b:02x}")).collect();

    let dir = dir_of(st, game_id);
    let path = dir.join(safe_name(&file_name));
    {
        let (dir, path) = (dir.clone(), path.clone());
        tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
            // Solo un trainer por juego: fuera el anterior.
            if dir.is_dir() {
                for e in std::fs::read_dir(&dir)?.flatten() {
                    let _ = std::fs::remove_file(e.path());
                }
            }
            std::fs::create_dir_all(&dir)?;
            let tmp = crate::util::temp_path(&path);
            std::fs::write(&tmp, &exe_bytes).map_err(|e| defender_error(&e).unwrap_or_else(|| e.into()))?;
            std::fs::rename(&tmp, &path).map_err(|e| defender_error(&e).unwrap_or_else(|| e.into()))?;
            Ok(())
        })
        .await??;
    }
    // Defender suele actuar un momento después de escribirlo.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    if !path.is_file() {
        anyhow::bail!(defender_error(&std::io::Error::from_raw_os_error(225)).unwrap());
    }
    tracing::info!("trainer: instalado «{}» para el juego {game_id} ({} bytes, sha256 {sha})", dl.name, std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0));

    let exe = path.to_string_lossy().into_owned();
    let (options_json, notes_json) = (serde_json::to_string(&page.options)?, serde_json::to_string(&page.notes)?);
    st.db.with(|c| {
        c.execute(
            "INSERT INTO trainers (game_id, exe, name, title, page_url, game_version, updated, options_json, notes_json, anticheat, sha256, auto_start, installed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12)
             ON CONFLICT (game_id) DO UPDATE SET exe = excluded.exe, name = excluded.name, title = excluded.title, page_url = excluded.page_url,
               game_version = excluded.game_version, updated = excluded.updated, options_json = excluded.options_json, notes_json = excluded.notes_json,
               anticheat = excluded.anticheat, sha256 = excluded.sha256, installed_at = excluded.installed_at",
            params![
                game_id,
                exe,
                dl.name,
                page.title,
                page.url,
                page.game_version,
                page.updated,
                options_json,
                notes_json,
                page.anticheat,
                sha,
                crate::util::now()
            ],
        )?;
        Ok(())
    })?;
    // Instalado a mitad de partida: que el overlay lo sepa.
    run::refresh(st, game_id);
    installed(st, game_id).ok_or_else(|| anyhow::anyhow!("No se pudo guardar el trainer"))
}

pub fn remove(st: &Arc<AppState>, game_id: i64) -> anyhow::Result<()> {
    run::forget(st, game_id);
    st.db.with(|c| c.execute("DELETE FROM trainers WHERE game_id = ?1", [game_id]).map(|_| ()))?;
    let dir = dir_of(st, game_id);
    if dir.is_dir() {
        // El trainer puede tardar un momento en soltar el archivo al cerrarse.
        for _ in 0..10 {
            if std::fs::remove_dir_all(&dir).is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    }
    run::refresh(st, game_id);
    Ok(())
}

pub fn set_auto_start(st: &AppState, game_id: i64, on: bool) -> anyhow::Result<()> {
    st.db.with(|c| c.execute("UPDATE trainers SET auto_start = ?2 WHERE game_id = ?1", params![game_id, on as i64]).map(|_| ()))?;
    Ok(())
}

/// Carpetas de trainers de juegos que ya no están en la biblioteca.
pub fn prune(st: &AppState) {
    let root = st.paths.root.join("trainers");
    let Ok(rd) = std::fs::read_dir(&root) else { return };
    let known: Vec<i64> = st
        .db
        .with(|c| {
            let mut q = c.prepare("SELECT game_id FROM trainers")?;
            let v = q.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<i64>>>();
            v
        })
        .unwrap_or_default();
    for e in rd.flatten() {
        let id = e.file_name().to_string_lossy().parse::<i64>().ok();
        if id.map(|id| !known.contains(&id)).unwrap_or(false) {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_queries() {
        assert_eq!(queries("Elden Ring"), vec!["Elden Ring"]);
        assert_eq!(queries("Hollow Knight: Silksong"), vec!["Hollow Knight Silksong", "Hollow Knight"]);
        assert_eq!(
            queries("The Witcher 3: Wild Hunt - Complete Edition"),
            vec!["The Witcher 3 Wild Hunt Complete Edition", "The Witcher 3 Wild Hunt", "The Witcher"]
        );
        assert_eq!(queries("DOOM"), vec!["DOOM"]);
    }

    #[test]
    fn slugs() {
        assert_eq!(slugify("ELDEN RING"), "elden-ring");
        assert_eq!(slugify("Hollow Knight: Silksong"), "hollow-knight-silksong");
        assert_eq!(slugify("Assassin's Creed® Valhalla"), "assassins-creed-valhalla");
    }

    #[test]
    fn file_names() {
        assert_eq!(safe_name("Hollow Knight Silksong v1.0 Plus 17 Trainer.exe"), "Hollow Knight Silksong v1.0 Plus 17 Trainer.exe");
        assert_eq!(safe_name("..\\..\\evil<>.exe"), "evil.exe");
        assert_eq!(safe_name(""), "trainer.exe");
    }

    #[test]
    fn exe_inside_a_zip() {
        use std::io::Write;
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            z.start_file("readme.txt", o).unwrap();
            z.write_all(b"hola").unwrap();
            z.start_file("Trainer/Space Crab Trainer.exe", o).unwrap();
            z.write_all(b"MZ\x90\x00trainer").unwrap();
            z.finish().unwrap();
        }
        let (name, bytes) = exe_from_zip(buf.get_ref()).unwrap();
        assert_eq!(name, "Space Crab Trainer.exe");
        assert!(bytes.starts_with(b"MZ"));
    }
}
