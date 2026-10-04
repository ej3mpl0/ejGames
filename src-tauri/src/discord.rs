//! Discord Rich Presence en un hilo propio: reconexión con backoff si Discord no
//! está abierto. Con `name` + StatusDisplayType::Name se ve "Jugando a <juego>";
//! dentro de la tarjeta, "Jugando desde ejGames" y el icono de la aplicación.
//! Si Discord conoce el juego, se usa su Application ID para que el icono del
//! canal de voz sea el del juego.

use discord_rich_presence::activity::{Activity, Assets, StatusDisplayType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Presence {
    pub title: String,
    pub details: Option<String>,
    pub state: Option<String>,
    pub start: i64,
    pub image_url: Option<String>,
    /// Icono de la aplicación de Discord (si tiene).
    pub small_image_url: Option<String>,
}

/// Icono de la aplicación de Discord (el que se sube en el Developer Portal),
/// para la imagen pequeña. Se consulta una vez por Application ID.
pub async fn app_icon(http: &reqwest::Client, client_id: &str) -> Option<String> {
    use parking_lot::Mutex;
    static CACHE: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);
    if let Some((id, icon)) = CACHE.lock().as_ref() {
        if id == client_id {
            return icon.clone();
        }
    }
    let url = format!("https://discord.com/api/v10/applications/{client_id}/rpc");
    let icon = async {
        let v: serde_json::Value = http.get(&url).send().await.ok()?.error_for_status().ok()?.json().await.ok()?;
        let hash = v.get("icon")?.as_str()?.to_string();
        Some(format!("https://cdn.discordapp.com/app-icons/{client_id}/{hash}.png?size=256"))
    };
    let icon = tokio::time::timeout(Duration::from_secs(4), icon).await.ok().flatten();
    *CACHE.lock() = Some((client_id.to_string(), icon.clone()));
    icon
}

/// Índice compacto de los juegos que Discord reconoce (`/applications/detectable`).
/// Con el Application ID del propio juego, Discord muestra su icono en el canal
/// de voz y en la lista de miembros (con el de ejGames solo se ve el nuestro).
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Detectable {
    steam: std::collections::HashMap<String, String>,
    exe: std::collections::HashMap<String, String>,
    name: std::collections::HashMap<String, String>,
}

const DETECTABLE_TTL: Duration = Duration::from_secs(7 * 24 * 3600);

fn norm_name(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn build_detectable(raw: &[u8]) -> Option<Detectable> {
    #[derive(serde::Deserialize)]
    struct Exe {
        name: String,
        #[serde(default)]
        os: String,
    }
    #[derive(serde::Deserialize)]
    struct Sku {
        distributor: String,
        id: Option<String>,
    }
    #[derive(serde::Deserialize)]
    struct App {
        id: String,
        name: String,
        #[serde(default)]
        aliases: Vec<String>,
        #[serde(default)]
        executables: Option<Vec<Exe>>,
        #[serde(default)]
        third_party_skus: Option<Vec<Sku>>,
    }
    let apps: Vec<App> = serde_json::from_slice(raw).ok()?;
    let mut d = Detectable::default();
    let mut exe_seen: std::collections::HashMap<String, usize> = Default::default();
    for a in &apps {
        for s in a.third_party_skus.iter().flatten() {
            if let (true, Some(id)) = (s.distributor == "steam", &s.id) {
                d.steam.entry(id.clone()).or_insert_with(|| a.id.clone());
            }
        }
        for e in a.executables.iter().flatten() {
            // «>java» y similares son patrones con argumentos: demasiado genéricos.
            if e.os == "win32" && !e.name.starts_with('>') {
                let k = e.name.to_lowercase().replace('\\', "/");
                *exe_seen.entry(k.clone()).or_default() += 1;
                d.exe.entry(k).or_insert_with(|| a.id.clone());
            }
        }
        for n in std::iter::once(&a.name).chain(&a.aliases) {
            let k = norm_name(n);
            if k.len() >= 3 {
                d.name.entry(k).or_insert_with(|| a.id.clone());
            }
        }
    }
    // Un .exe que comparten varios juegos (game.exe, launcher.exe…) no identifica nada.
    d.exe.retain(|k, _| exe_seen.get(k) == Some(&1));
    Some(d)
}

/// Se lee del disco en cada lanzamiento (unos ms) en vez de quedarse en memoria.
async fn detectable(http: &reqwest::Client, cache: &std::path::Path) -> Option<Detectable> {
    let fresh = std::fs::metadata(cache)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < DETECTABLE_TTL);
    let from_disk = || std::fs::read(cache).ok().and_then(|b| serde_json::from_slice::<Detectable>(&b).ok());
    let mut d = if fresh { from_disk() } else { None };
    if d.is_none() {
        let get = async {
            let r = http.get("https://discord.com/api/v10/applications/detectable").send().await.ok()?;
            r.error_for_status().ok()?.bytes().await.ok()
        };
        let raw = tokio::time::timeout(Duration::from_secs(20), get).await.ok().flatten();
        d = match raw {
            Some(raw) => tauri::async_runtime::spawn_blocking(move || build_detectable(&raw)).await.ok().flatten(),
            None => None,
        };
        match &d {
            Some(idx) => {
                if let Ok(b) = serde_json::to_vec(idx) {
                    let _ = std::fs::write(cache, b);
                }
            }
            // Sin red: el índice viejo sigue valiendo.
            None => d = from_disk(),
        }
    }
    d
}

/// Application ID de Discord del propio juego (por AppID de Steam, nombre o
/// ruta del .exe), si Discord lo conoce.
pub async fn game_app_id(http: &reqwest::Client, cache: &std::path::Path, game: &crate::db::models::Game) -> Option<String> {
    let d = detectable(http, cache).await?;
    if let Some(id) = game.steam_appid.and_then(|a| d.steam.get(&a.to_string())) {
        return Some(id.clone());
    }
    if let Some(id) = d.name.get(&norm_name(&game.title)) {
        return Some(id.clone());
    }
    let exe = game.exe_path.as_deref()?.to_lowercase().replace('\\', "/");
    // Del sufijo más largo («game/eldenring.exe») al más corto («eldenring.exe»).
    let mut suffix = exe.as_str();
    loop {
        if let Some(id) = d.exe.get(suffix) {
            return Some(id.clone());
        }
        suffix = &suffix[suffix.find('/')? + 1..];
    }
}

enum Cmd {
    Set(String, Presence),
    Clear,
}

pub struct Discord {
    tx: mpsc::Sender<Cmd>,
}

impl Discord {
    pub fn start() -> Self {
        let (tx, rx) = mpsc::channel::<Cmd>();
        let _ = std::thread::Builder::new().name("ejg-discord".into()).spawn(move || worker(rx));
        Discord { tx }
    }

    pub fn set(&self, client_id: &str, p: Presence) {
        if client_id.trim().is_empty() {
            return;
        }
        let _ = self.tx.send(Cmd::Set(client_id.trim().to_string(), p));
    }

    pub fn clear(&self) {
        let _ = self.tx.send(Cmd::Clear);
    }
}

fn apply(client: &mut DiscordIpcClient, p: &Presence) -> Result<(), Box<dyn std::error::Error>> {
    let mut a = Activity::new()
        .name(p.title.as_str())
        .status_display_type(StatusDisplayType::Name)
        .timestamps(Timestamps::new().start(p.start));
    if let Some(d) = &p.details {
        a = a.details(d.as_str());
    }
    if let Some(s) = &p.state {
        a = a.state(s.as_str());
    }
    // Portada grande + icono de ejGames pequeño. Sin portada, el icono va grande.
    let mut assets = Assets::new();
    match (&p.image_url, &p.small_image_url) {
        (Some(img), small) => {
            assets = assets.large_image(img.as_str()).large_text(p.title.as_str());
            if let Some(s) = small {
                assets = assets.small_image(s.as_str()).small_text("ejGames");
            }
        }
        (None, Some(s)) => assets = assets.large_image(s.as_str()).large_text("ejGames"),
        (None, None) => {}
    }
    a = a.assets(assets);
    client.set_activity(a)?;
    Ok(())
}

fn worker(rx: mpsc::Receiver<Cmd>) {
    let mut client: Option<(String, DiscordIpcClient)> = None;
    let mut wanted: Option<(String, Presence)> = None;
    let mut backoff = Duration::from_secs(5);
    loop {
        // Sin nada que mostrar: bloqueado en el canal. Con presencia pendiente de
        // conectar: reintento con backoff (máx. 2 min).
        let cmd = if wanted.is_some() && client.is_none() {
            match rx.recv_timeout(backoff) {
                Ok(c) => Some(c),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(_) => return,
            }
        } else {
            match rx.recv() {
                Ok(c) => Some(c),
                Err(_) => return,
            }
        };
        match cmd {
            Some(Cmd::Set(id, p)) => wanted = Some((id, p)),
            Some(Cmd::Clear) => {
                wanted = None;
                if let Some((_, mut c)) = client.take() {
                    let _ = c.clear_activity();
                    let _ = c.close();
                }
                continue;
            }
            None => {}
        }
        let Some((id, p)) = wanted.clone() else { continue };
        if client.as_ref().map(|(cid, _)| *cid != id).unwrap_or(false) {
            if let Some((_, mut c)) = client.take() {
                let _ = c.close();
            }
        }
        if client.is_none() {
            let mut c = DiscordIpcClient::new(&id);
            if c.connect().is_ok() {
                tracing::info!("discord: conectado");
                client = Some((id.clone(), c));
                backoff = Duration::from_secs(5);
            } else {
                tracing::info!("discord: no está abierto, reintento en {} s", backoff.as_secs());
                backoff = (backoff * 2).min(Duration::from_secs(120));
                continue;
            }
        }
        if let Some((_, c)) = client.as_mut() {
            if let Err(e) = apply(c, &p) {
                tracing::info!("discord: error al enviar la presencia ({e}), reconectando");
                // Discord se cerró: reconectar en el siguiente ciclo.
                let _ = c.close();
                client = None;
            } else {
                tracing::info!("discord: jugando a «{}»", p.title);
            }
        }
    }
}
