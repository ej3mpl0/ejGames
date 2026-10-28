//! Discord Rich Presence en un hilo propio: reconexión con backoff si Discord no
//! está abierto. Con `name` + StatusDisplayType::Name se ve "Jugando a <juego>";
//! dentro de la tarjeta, la portada y el icono de la aplicación.
//! Si Discord conoce el juego, se usa su Application ID para que el icono del
//! canal de voz sea el del juego.

use discord_rich_presence::activity::{Activity, Assets, StatusDisplayType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Presence {
    pub title: String,
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
#[derive(serde::Serialize, serde::Deserialize)]
struct DiscGame {
    id: String,
    name: String,
    /// Nombre y alias normalizados, para buscar.
    keys: Vec<String>,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Detectable {
    steam: std::collections::HashMap<String, String>,
    exe: std::collections::HashMap<String, String>,
    name: std::collections::HashMap<String, String>,
    /// Lista para el selector. Los índices viejos no la traen.
    #[serde(default)]
    games: Vec<DiscGame>,
}

const DETECTABLE_TTL: Duration = Duration::from_secs(7 * 24 * 3600);

/// Ya se intentó renovar un índice antiguo en este proceso.
static REFRESH_LEGACY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

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
    let mut seen_ids: std::collections::HashSet<String> = Default::default();
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
        let mut keys = Vec::new();
        for n in std::iter::once(&a.name).chain(&a.aliases) {
            let k = norm_name(n);
            if k.len() >= 2 && !keys.iter().any(|x| x == &k) {
                keys.push(k.clone());
            }
            if k.len() >= 3 {
                d.name.entry(k).or_insert_with(|| a.id.clone());
            }
        }
        if seen_ids.insert(a.id.clone()) {
            d.games.push(DiscGame { id: a.id.clone(), name: a.name.clone(), keys });
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
    // Un índice reciente y con nombres se usa tal cual. Si es reciente pero antiguo
    // (sin la lista), se intenta bajar una vez: si no hay red, no se reintenta en cada búsqueda.
    if fresh {
        if let Some(d) = from_disk() {
            if !d.games.is_empty() || REFRESH_LEGACY.swap(true, std::sync::atomic::Ordering::Relaxed) {
                return Some(d);
            }
        }
    }
    let get = async {
        let r = http.get("https://discord.com/api/v10/applications/detectable").send().await.ok()?;
        r.error_for_status().ok()?.bytes().await.ok()
    };
    let raw = tokio::time::timeout(Duration::from_secs(20), get).await.ok().flatten();
    let mut d = match raw {
        Some(raw) => tauri::async_runtime::spawn_blocking(move || build_detectable(&raw)).await.ok().flatten(),
        None => None,
    };
    match &d {
        Some(idx) => {
            if let Ok(b) = serde_json::to_vec(idx) {
                let _ = std::fs::write(cache, b);
            }
        }
        // Sin red: el índice viejo sigue valiendo, aunque no traiga la lista de nombres.
        None => d = from_disk(),
    }
    d
}

/// Application ID de Discord del propio juego. Si el usuario eligió uno en los
/// ajustes, ese; si no, el que cuadre por AppID de Steam, nombre o ruta del .exe.
pub async fn game_app_id(http: &reqwest::Client, cache: &std::path::Path, game: &crate::db::models::Game) -> Option<String> {
    if let Some(id) = game.discord_app_id.as_deref().and_then(crate::db::models::discord_app_id_ok) {
        return Some(id);
    }
    let d = detectable(http, cache).await?;
    auto_match(&d, game)
}

fn auto_match(d: &Detectable, game: &crate::db::models::Game) -> Option<String> {
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

/// Un juego de la lista de Discord, para elegirlo en los ajustes.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordGameHit {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordGameSearch {
    /// False si no se pudo leer la lista de Discord (sin red y sin caché útil).
    pub ready: bool,
    pub games: Vec<DiscordGameHit>,
}

/// Qué juego pondría Discord solo, sin mirar la elección manual.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordDetection {
    /// "match", "unknown" o "unavailable".
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

pub async fn search_games(http: &reqwest::Client, cache: &std::path::Path, query: &str) -> DiscordGameSearch {
    let Some(d) = detectable(http, cache).await else {
        return DiscordGameSearch { ready: false, games: vec![] };
    };
    if d.games.is_empty() {
        return DiscordGameSearch { ready: false, games: vec![] };
    }
    DiscordGameSearch { ready: true, games: rank_games(&d.games, query, 15) }
}

pub async fn detected_game(http: &reqwest::Client, cache: &std::path::Path, game: &crate::db::models::Game) -> DiscordDetection {
    let Some(d) = detectable(http, cache).await else {
        return DiscordDetection { status: "unavailable", id: None, name: None };
    };
    if d.games.is_empty() && d.steam.is_empty() && d.exe.is_empty() && d.name.is_empty() {
        return DiscordDetection { status: "unavailable", id: None, name: None };
    }
    match auto_match(&d, game) {
        Some(id) => {
            let name = d.games.iter().find(|g| g.id == id).map(|g| g.name.clone());
            DiscordDetection { status: "match", id: Some(id), name }
        }
        None => DiscordDetection { status: "unknown", id: None, name: None },
    }
}

fn rank_games(games: &[DiscGame], query: &str, limit: usize) -> Vec<DiscordGameHit> {
    let q = norm_name(query);
    if q.len() < 2 {
        return vec![];
    }
    let mut best: Vec<(i32, usize, usize)> = Vec::new();
    for (i, g) in games.iter().enumerate() {
        let mut score: Option<i32> = None;
        for k in &g.keys {
            let s = if k == &q {
                0
            } else if k.starts_with(&q) {
                1
            } else if k.contains(&q) {
                2
            } else {
                continue;
            };
            score = Some(score.map_or(s, |b| b.min(s)));
            if score == Some(0) {
                break;
            }
        }
        if let Some(s) = score {
            best.push((s, g.name.chars().count(), i));
        }
    }
    best.sort_by(|a, b| {
        a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then_with(|| games[a.2].name.to_lowercase().cmp(&games[b.2].name.to_lowercase()))
    });
    best.truncate(limit);
    best.into_iter().map(|(_, _, i)| DiscordGameHit { id: games[i].id.clone(), name: games[i].name.clone() }).collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Detectable {
        build_detectable(
            br#"[
            {"id":"111111111111111111","name":"ELDEN RING","aliases":["Elden Ring"],
             "executables":[{"os":"win32","name":"eldenring.exe"},{"os":"win32","name":"game.exe"}],
             "third_party_skus":[{"distributor":"steam","id":"1245620"}]},
            {"id":"222222222222222222","name":"Elden Ring Nightreign","aliases":[],
             "executables":[{"os":"win32","name":"nightreign.exe"},{"os":"win32","name":"game.exe"}]},
            {"id":"333333333333333333","name":"Hades","aliases":["HADES"],
             "executables":[{"os":"darwin","name":"Hades.app"}]}
        ]"#,
        )
        .unwrap()
    }

    #[test]
    fn index_matches_steam_name_and_unique_exe() {
        let d = sample();
        assert_eq!(d.steam.get("1245620").map(String::as_str), Some("111111111111111111"));
        assert_eq!(d.name.get("eldenring").map(String::as_str), Some("111111111111111111"));
        assert_eq!(d.exe.get("eldenring.exe").map(String::as_str), Some("111111111111111111"));
        assert!(d.exe.get("game.exe").is_none());
        assert!(d.exe.get("hades.app").is_none());
        assert_eq!(d.games.len(), 3);
    }

    #[test]
    fn search_prefers_the_shorter_prefix() {
        let d = sample();
        let hits = rank_games(&d.games, "elden", 10);
        assert_eq!(hits[0].name, "ELDEN RING");
        assert_eq!(hits[1].name, "Elden Ring Nightreign");
        assert!(rank_games(&d.games, "e", 10).is_empty());
        let exact = rank_games(&d.games, "hades", 10);
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].id, "333333333333333333");
        let night = rank_games(&d.games, "nightreign", 10);
        assert_eq!(night.len(), 1);
        assert_eq!(night[0].id, "222222222222222222");
    }

    #[test]
    fn old_cache_without_games_still_parses() {
        let d: Detectable = serde_json::from_str(r#"{"steam":{"1":"9"},"exe":{},"name":{"hades":"9"}}"#).unwrap();
        assert!(d.games.is_empty());
        assert_eq!(d.name.get("hades").map(String::as_str), Some("9"));
    }

    #[test]
    fn manual_id_beats_the_title() {
        let d = sample();
        let mut game = crate::db::models::Game { title: "Hades".into(), ..Default::default() };
        assert_eq!(auto_match(&d, &game).as_deref(), Some("333333333333333333"));
        game.discord_app_id = Some("111111111111111111".into());
        assert_eq!(
            game.discord_app_id.as_deref().and_then(crate::db::models::discord_app_id_ok).as_deref(),
            Some("111111111111111111")
        );
        assert!(crate::db::models::discord_app_id_ok("nope").is_none());
    }
}
