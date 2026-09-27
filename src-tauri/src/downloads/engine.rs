//! Motor torrent (librqbit) perezoso: la sesión solo existe mientras hay algo
//! que bajar, compartir o preparar; sin nada, se para y no gasta hilos,
//! sockets ni DHT.
//!
//! Ojo con librqbit:
//! - Por defecto no escucha (`listen: None`): nadie se te podría conectar.
//! - No guardar clones de `ManagedTorrentHandle`: dejan los archivos abiertos
//!   (y Windows no deja ejecutar setup.exe).
//! - «Olvidar» (`delete(.., false)`) borra también el fastresume: solo para
//!   torrents terminados o que se quitan.

use crate::state::AppState;
use librqbit::dht::DhtPersistenceConfig;
use librqbit::limits::LimitsConfig;
use librqbit::{
    ConnectionOptions, DhtSessionConfig, ListenerMode, ListenerOptions, PeerConnectionOptions, Session, SessionOptions,
    SessionPersistenceConfig,
};
use parking_lot::RwLock;
use std::collections::HashSet;
use std::net::Ipv6Addr;
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Trackers públicos estables (se añaden a todas las descargas si el ajuste
/// está activo). Mitigan que el DHT de librqbit se caiga en Windows.
pub const TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.qu.ax:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://opentracker.io:6969/announce",
    "udp://tracker.theoks.net:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "http://tracker.openbittorrent.com:80/announce",
];

/// KB/s → límite de librqbit. Por debajo de 64 KB/s librqbit no puede pedir
/// bloques de 16 KB a tiempo y se atasca.
pub fn bps(kbps: u32) -> Option<NonZeroU32> {
    if kbps == 0 {
        return None;
    }
    NonZeroU32::new(kbps.max(64).saturating_mul(1024))
}

#[derive(Default)]
pub struct Engine {
    session: RwLock<Option<Arc<Session>>>,
    life: tokio::sync::Mutex<()>,
    started: RwLock<Option<Instant>>,
}

impl Engine {
    pub fn get(&self) -> Option<Arc<Session>> {
        self.session.read().clone()
    }

    /// Desde cuándo está en marcha.
    pub fn uptime(&self) -> Option<Duration> {
        self.started.read().map(|t| t.elapsed())
    }

    pub async fn ensure(&self, st: &Arc<AppState>) -> anyhow::Result<Arc<Session>> {
        if let Some(s) = self.get() {
            return Ok(s);
        }
        let _g = self.life.lock().await;
        if let Some(s) = self.get() {
            return Ok(s);
        }
        let s = start(st).await?;
        *self.session.write() = Some(s.clone());
        *self.started.write() = Some(Instant::now());
        Ok(s)
    }

    pub async fn stop(&self) {
        let _g = self.life.lock().await;
        let s = self.session.write().take();
        *self.started.write() = None;
        if let Some(s) = s {
            s.stop().await;
            tracing::info!("motor torrent parado");
        }
    }
}

pub fn root(st: &AppState) -> PathBuf {
    st.paths.root.join("torrents")
}

/// Puerto de entrada: el guardado o uno al azar (20000-60000) que se guarda.
fn listen_port(st: &AppState) -> u16 {
    let p = st.settings.get().listen_port;
    if p != 0 {
        return p;
    }
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let port = 20000 + (h.finish() % 40000) as u16;
    let _ = st.settings.update(|s| s.listen_port = port);
    port
}

fn options(st: &AppState, port: u16) -> SessionOptions {
    let s = st.settings.get();
    let root = root(st);
    let proxy = s.torrent_proxy.trim().to_string();
    let peer_opts = PeerConnectionOptions {
        connect_timeout: Some(Duration::from_secs(4)),
        read_write_timeout: Some(Duration::from_secs(15)),
        keep_alive_interval: None,
    };
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let trackers: HashSet<url::Url> = if s.extra_trackers {
        TRACKERS.iter().filter_map(|t| url::Url::parse(t).ok()).collect()
    } else {
        HashSet::new()
    };
    SessionOptions {
        // Con proxy solo salen conexiones por él: sin escuchar ni DHT/LSD, que
        // irían directas.
        dht: proxy.is_empty().then(|| DhtSessionConfig {
            persistence: Some(DhtPersistenceConfig {
                config_filename: Some(root.join("dht.json")),
                dump_interval: Some(Duration::from_secs(300)),
            }),
            ..Default::default()
        }),
        fastresume: true,
        persistence: Some(SessionPersistenceConfig::Json {
            folder: Some(root.join("session")),
        }),
        listen: proxy.is_empty().then(|| ListenerOptions {
            mode: if s.utp { ListenerMode::TcpAndUtp } else { ListenerMode::TcpOnly },
            listen_addr: (Ipv6Addr::UNSPECIFIED, port).into(),
            enable_upnp_port_forwarding: s.upnp && port != 0,
            ..Default::default()
        }),
        connect: Some(ConnectionOptions {
            proxy_url: (!proxy.is_empty()).then_some(proxy.clone()),
            peer_opts: Some(peer_opts),
            ..Default::default()
        }),
        concurrent_init_limit: Some(1),
        runtime_worker_threads: Some((cores / 2).clamp(2, 4)),
        ratelimits: LimitsConfig {
            download_bps: bps(s.max_download_kbps),
            upload_bps: bps(s.max_upload_kbps),
        },
        trackers,
        peer_limit: (s.peer_limit > 0).then_some(s.peer_limit.clamp(20, 1000) as usize),
        disable_local_service_discovery: !proxy.is_empty(),
        ..Default::default()
    }
}

async fn start(st: &Arc<AppState>) -> anyhow::Result<Arc<Session>> {
    let root = root(st);
    std::fs::create_dir_all(root.join("session"))?;
    let port = listen_port(st);
    // Si el puerto está ocupado, los siguientes; al final, uno cualquiera.
    let mut last = None;
    for p in [port, port.wrapping_add(1), port.wrapping_add(2), port.wrapping_add(3), 0] {
        match Session::new_with_opts(root.join("files"), options(st, p)).await {
            Ok(s) => {
                tracing::info!("motor torrent en marcha (puerto {:?})", s.announce_port());
                return Ok(s);
            }
            Err(e) => {
                tracing::warn!("motor torrent (puerto {p}): {e:#}");
                last = Some(e);
            }
        }
    }
    Err(last.unwrap_or_else(|| anyhow::anyhow!("no se pudo arrancar")).context("No se pudo arrancar el motor de descargas"))
}

/// Aplica los límites de velocidad en caliente.
pub fn apply_limits(session: &Session, down_kbps: u32, up_kbps: u32) {
    session.ratelimits.set_download_bps(bps(down_kbps));
    session.ratelimits.set_upload_bps(bps(up_kbps));
}
