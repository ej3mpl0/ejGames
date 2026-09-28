//! Datos vivos del panel del overlay: rendimiento del juego, lo que suena en el
//! PC, volumen, baterías y descargas. Un hilo los toma cada segundo solo
//! mientras el panel está abierto (durante la partida no gasta nada) y los
//! manda a la página con `overlay:live`.

use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveInfo {
    pub perf: Option<Perf>,
    pub media: Option<MediaNow>,
    pub volume: Option<Volume>,
    pub pad: Option<PadPower>,
    pub battery: Option<Battery>,
    pub downloads: DownloadsNow,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Perf {
    /// % de todo el procesador que usa el juego.
    pub cpu: f32,
    /// Memoria privada en uso del juego (bytes).
    pub ram: u64,
    /// % de la GPU (el motor más ocupado, como el Administrador de tareas).
    pub gpu: Option<f32>,
    /// Memoria de vídeo dedicada del juego (bytes).
    pub vram: Option<u64>,
    pub sys_cpu: f32,
    pub sys_ram_used: u64,
    pub sys_ram_total: u64,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaNow {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Programa que suena (Spotify, Chrome…).
    pub app: String,
    pub playing: bool,
    /// Carátula como data: URL.
    pub art: Option<String>,
    /// Segundos (si el programa lo dice).
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub can_prev: bool,
    pub can_next: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    /// 0..1; None si el juego aún no ha sonado.
    pub game: Option<f32>,
    pub game_muted: bool,
    pub master: f32,
    pub master_muted: bool,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PadPower {
    pub name: String,
    /// wired | charging | discharging | charged | unknown
    pub state: String,
    /// 0..100
    pub level: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub level: u8,
    pub charging: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadsNow {
    pub items: Vec<DownloadBrief>,
    /// Hay descargas esperando a que acabe la partida.
    pub paused_for_game: bool,
    /// El usuario pidió seguir descargando en esta partida.
    pub allowed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadBrief {
    pub id: i64,
    pub title: String,
    pub state: String,
    pub pause_reason: Option<String>,
    pub progress: f64,
    pub down_bps: u64,
    pub eta: Option<u64>,
    pub capsule: Option<String>,
    pub cover: Option<String>,
}

#[derive(Default)]
pub struct Sampler {
    running: AtomicBool,
    /// Último estado (para la primera pintura del panel).
    pub last: Mutex<LiveInfo>,
    /// Mando conectado (lo actualiza el hilo del mando).
    pub pad: Mutex<Option<PadPower>>,
}

/// Arranca el muestreo (si no estaba ya).
pub fn start(st: &Arc<AppState>) {
    if st.overlay.sampler.running.swap(true, Ordering::SeqCst) {
        return;
    }
    let st = st.clone();
    let _ = std::thread::Builder::new().name("ejg-overlay-live".into()).spawn(move || {
        #[cfg(windows)]
        let _com = win::Com::init();
        let mut perf = PerfState::default();
        let mut media = MediaState::default();
        while st.overlay.panel_open.load(Ordering::Relaxed) {
            let t0 = Instant::now();
            let info = sample(&st, &mut perf, &mut media);
            *st.overlay.sampler.last.lock() = info.clone();
            let _ = st.app.emit_to(super::LABEL, "overlay:live", &info);
            let spent = t0.elapsed();
            // El primer dato de CPU y GPU sale al segundo tick: el siguiente, antes.
            let wait = if perf.ticks <= 1 { Duration::from_millis(400) } else { Duration::from_millis(1000) };
            std::thread::sleep(wait.saturating_sub(spent));
        }
        st.overlay.sampler.running.store(false, Ordering::SeqCst);
    });
}

fn sample(st: &Arc<AppState>, perf: &mut PerfState, media: &mut MediaState) -> LiveInfo {
    let target = st.overlay.inner.lock().live.as_ref().map(|l| l.target.clone());
    let pids = match &target {
        Some(t) => perf.pids(t),
        None => vec![],
    };
    LiveInfo {
        perf: perf.sample(&pids),
        media: media.sample(),
        volume: volume(&pids),
        pad: st.overlay.sampler.pad.lock().clone(),
        battery: battery(),
        downloads: downloads(st),
    }
}

fn downloads(st: &AppState) -> DownloadsNow {
    let list = crate::downloads::list(st).unwrap_or_default();
    let items: Vec<DownloadBrief> = list
        .into_iter()
        .filter(|d| d.state != "installed")
        .take(5)
        .map(|d| DownloadBrief {
            id: d.id,
            title: d.title,
            state: d.state,
            pause_reason: d.pause_reason,
            progress: d.progress,
            down_bps: d.down_bps,
            eta: d.eta,
            capsule: d.capsule,
            cover: d.cover,
        })
        .collect();
    DownloadsNow {
        paused_for_game: items.iter().any(|d| d.pause_reason.as_deref() == Some("playing")),
        allowed: st.downloads.allow_while_playing.load(Ordering::Relaxed),
        items,
    }
}

// ───────────────────────────── rendimiento ─────────────────────────────

#[derive(Default)]
struct PerfState {
    ticks: u32,
    cache: std::collections::HashMap<u32, (String, Option<std::path::PathBuf>)>,
    pids: Vec<u32>,
    pids_at: Option<Instant>,
    /// (tiempo de CPU del juego en 100 ns, instante).
    prev_game: Option<(u64, Instant)>,
    /// (ocioso, total) del sistema en 100 ns.
    prev_sys: Option<(u64, u64)>,
    #[cfg(windows)]
    gpu: Option<win::Gpu>,
}

impl PerfState {
    /// Procesos del juego (se vuelven a buscar cada 5 s).
    fn pids(&mut self, t: &crate::launcher::tracker::Target) -> Vec<u32> {
        if self.pids_at.map(|a| a.elapsed() > Duration::from_secs(5)).unwrap_or(true) {
            self.pids = crate::launcher::tracker::find_pids(t, &mut self.cache);
            self.pids_at = Some(Instant::now());
        }
        self.pids.clone()
    }

    #[cfg(windows)]
    fn sample(&mut self, pids: &[u32]) -> Option<Perf> {
        self.ticks += 1;
        let now = Instant::now();
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
        let (cpu_time, ram) = win::process_usage(pids);
        let cpu = match self.prev_game.replace((cpu_time, now)) {
            Some((t, at)) if cpu_time >= t => {
                let wall = now.duration_since(at).as_nanos() as f64 / 100.0;
                ((cpu_time - t) as f64 / wall / cores * 100.0).clamp(0.0, 100.0) as f32
            }
            _ => 0.0,
        };
        let sys_cpu = match (win::system_times(), self.prev_sys) {
            (Some((idle, total)), prev) => {
                self.prev_sys = Some((idle, total));
                match prev {
                    Some((pi, pt)) if total > pt => (100.0 - (idle - pi) as f64 / (total - pt) as f64 * 100.0).clamp(0.0, 100.0) as f32,
                    _ => 0.0,
                }
            }
            _ => 0.0,
        };
        let (sys_ram_used, sys_ram_total) = win::memory();
        if self.gpu.is_none() {
            self.gpu = win::Gpu::open();
        }
        let (gpu, vram) = match self.gpu.as_mut() {
            Some(g) => g.sample(pids),
            None => (None, None),
        };
        Some(Perf { cpu, ram, gpu, vram, sys_cpu, sys_ram_used, sys_ram_total })
    }

    #[cfg(not(windows))]
    fn sample(&mut self, _pids: &[u32]) -> Option<Perf> {
        None
    }
}

// ───────────────────────────── música ─────────────────────────────

#[derive(Default)]
struct MediaState {
    /// (programa, título, artista) de la carátula guardada.
    art_key: Option<(String, String, String)>,
    art: Option<String>,
    #[cfg(windows)]
    manager: Option<windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager>,
}

impl MediaState {
    #[cfg(windows)]
    fn sample(&mut self) -> Option<MediaNow> {
        use windows::Media::Control::*;
        if self.manager.is_none() {
            self.manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().and_then(|a| a.get()).ok();
        }
        let session = self.manager.as_ref()?.GetCurrentSession().ok()?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let title = props.Title().map(|s| s.to_string_lossy()).unwrap_or_default();
        if title.trim().is_empty() {
            return None;
        }
        let artist = props.Artist().map(|s| s.to_string_lossy()).unwrap_or_default();
        let album = props.AlbumTitle().map(|s| s.to_string_lossy()).unwrap_or_default();
        let app = session.SourceAppUserModelId().map(|s| s.to_string_lossy()).unwrap_or_default();
        let info = session.GetPlaybackInfo().ok();
        let playing = info
            .as_ref()
            .and_then(|i| i.PlaybackStatus().ok())
            .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
            .unwrap_or(false);
        let controls = info.as_ref().and_then(|i| i.Controls().ok());
        let can_next = controls.as_ref().and_then(|c| c.IsNextEnabled().ok()).unwrap_or(false);
        let can_prev = controls.as_ref().and_then(|c| c.IsPreviousEnabled().ok()).unwrap_or(false);
        let (position, duration) = session
            .GetTimelineProperties()
            .ok()
            .map(|t| {
                let end = t.EndTime().map(|d| d.Duration as f64 / 1e7).unwrap_or(0.0);
                let mut pos = t.Position().map(|d| d.Duration as f64 / 1e7).unwrap_or(0.0);
                // La posición es la de la última vez que el programa la dijo.
                if playing {
                    if let Ok(at) = t.LastUpdatedTime() {
                        let now_ft = win::now_filetime() as i64;
                        let ago = (now_ft - at.UniversalTime) as f64 / 1e7;
                        if (0.0..3600.0).contains(&ago) {
                            pos += ago;
                        }
                    }
                }
                (end > 0.0).then_some((pos.min(end), end))
            })
            .flatten()
            .map(|(p, e)| (Some(p), Some(e)))
            .unwrap_or((None, None));
        let key = (app.clone(), title.clone(), artist.clone());
        if self.art_key.as_ref() != Some(&key) {
            self.art = props.Thumbnail().ok().and_then(|r| win::read_stream(&r));
            self.art_key = Some(key);
        }
        Some(MediaNow {
            title,
            artist,
            album,
            app: app_name(&app),
            playing,
            art: self.art.clone(),
            position,
            duration,
            can_prev,
            can_next,
        })
    }

    #[cfg(not(windows))]
    fn sample(&mut self) -> Option<MediaNow> {
        None
    }
}

/// "Spotify.exe" → "Spotify"; "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" → "Reproductor multimedia".
fn app_name(aumid: &str) -> String {
    let low = aumid.to_ascii_lowercase();
    let known = [
        ("spotify", "Spotify"),
        ("zunemusic", "Reproductor multimedia"),
        ("zunevideo", "Películas y TV"),
        ("msedge", "Edge"),
        ("chrome", "Chrome"),
        ("firefox", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("vivaldi", "Vivaldi"),
        ("vlc", "VLC"),
        ("foobar2000", "foobar2000"),
        ("musicbee", "MusicBee"),
        ("aimp", "AIMP"),
        ("tidal", "TIDAL"),
        ("deezer", "Deezer"),
        ("applemusic", "Apple Music"),
        ("itunes", "iTunes"),
        ("youtube", "YouTube Music"),
        ("discord", "Discord"),
    ];
    if let Some((_, name)) = known.iter().find(|(k, _)| low.contains(k)) {
        return name.to_string();
    }
    let base = aumid.rsplit(['\\', '!']).next().unwrap_or(aumid);
    let base = base.strip_suffix(".exe").or_else(|| base.strip_suffix(".EXE")).unwrap_or(base);
    let mut c = base.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// Pausa/continúa, siguiente o anterior en el programa que suena.
#[cfg(windows)]
pub fn media_command(cmd: &str) -> anyhow::Result<()> {
    use windows::Media::Control::*;
    let mgr = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    let s = mgr.GetCurrentSession().map_err(|_| anyhow::anyhow!("No suena nada"))?;
    let ok = match cmd {
        "toggle" => s.TryTogglePlayPauseAsync()?.get()?,
        "next" => s.TrySkipNextAsync()?.get()?,
        "prev" => s.TrySkipPreviousAsync()?.get()?,
        _ => anyhow::bail!("orden no válida"),
    };
    if !ok {
        anyhow::bail!("El programa no lo permite");
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn media_command(_cmd: &str) -> anyhow::Result<()> {
    anyhow::bail!("Solo en Windows")
}

// ───────────────────────────── volumen y baterías ─────────────────────────────

#[cfg(windows)]
fn volume(pids: &[u32]) -> Option<Volume> {
    win::volume(pids).ok()
}

#[cfg(not(windows))]
fn volume(_pids: &[u32]) -> Option<Volume> {
    None
}

/// Cambia el volumen (0..1) o el silencio del juego ("game") o del sistema ("master").
pub fn set_volume(st: &AppState, which: &str, level: Option<f32>, muted: Option<bool>) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        let _com = win::Com::init();
        let pids = match which {
            "game" => {
                let target = st.overlay.inner.lock().live.as_ref().map(|l| l.target.clone()).ok_or_else(|| anyhow::anyhow!("No hay partida"))?;
                crate::launcher::tracker::find_pids(&target, &mut Default::default())
            }
            _ => vec![],
        };
        win::set_volume(which == "game", &pids, level.map(|v| v.clamp(0.0, 1.0)), muted)
    }
    #[cfg(not(windows))]
    {
        let _ = (st, which, level, muted);
        anyhow::bail!("Solo en Windows")
    }
}

#[cfg(windows)]
fn battery() -> Option<Battery> {
    win::battery()
}

#[cfg(not(windows))]
fn battery() -> Option<Battery> {
    None
}

#[cfg(windows)]
mod win {
    use super::{Battery, Volume};
    use std::collections::HashMap;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, FILETIME};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W,
        PDH_FMT_DOUBLE, PDH_FMT_LARGE, PDH_HCOUNTER, PDH_HQUERY,
    };
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX2};
    use windows::Win32::System::SystemInformation::{GetSystemTimeAsFileTime, GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::{GetProcessTimes, GetSystemTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    /// COM en este hilo mientras viva.
    pub struct Com(bool);
    impl Com {
        pub fn init() -> Self {
            Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).is_ok() })
        }
    }
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn ft(f: FILETIME) -> u64 {
        ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
    }

    pub fn now_filetime() -> u64 {
        unsafe { ft(GetSystemTimeAsFileTime()) }
    }

    /// (tiempo de CPU total en 100 ns, memoria privada en uso) de los procesos.
    pub fn process_usage(pids: &[u32]) -> (u64, u64) {
        let (mut cpu, mut ram) = (0u64, 0u64);
        for pid in pids {
            unsafe {
                let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, *pid) else { continue };
                let (mut c, mut e, mut k, mut u) = Default::default();
                if GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u).is_ok() {
                    cpu += ft(k) + ft(u);
                }
                let mut m = PROCESS_MEMORY_COUNTERS_EX2 { cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32, ..Default::default() };
                if GetProcessMemoryInfo(h, &mut m as *mut _ as *mut PROCESS_MEMORY_COUNTERS, m.cb).is_ok() {
                    ram += if m.PrivateWorkingSetSize > 0 { m.PrivateWorkingSetSize } else { m.WorkingSetSize } as u64;
                }
                let _ = CloseHandle(h);
            }
        }
        (cpu, ram)
    }

    /// (ocioso, núcleo + usuario) del sistema, en 100 ns.
    pub fn system_times() -> Option<(u64, u64)> {
        let (mut i, mut k, mut u) = Default::default();
        unsafe { GetSystemTimes(Some(&mut i), Some(&mut k), Some(&mut u)).ok()? };
        // El tiempo de núcleo incluye el ocioso.
        Some((ft(i), ft(k) + ft(u)))
    }

    /// (usada, total) en bytes.
    pub fn memory() -> (u64, u64) {
        let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        if unsafe { GlobalMemoryStatusEx(&mut m) }.is_err() {
            return (0, 0);
        }
        (m.ullTotalPhys.saturating_sub(m.ullAvailPhys), m.ullTotalPhys)
    }

    pub fn battery() -> Option<Battery> {
        let mut s = SYSTEM_POWER_STATUS::default();
        unsafe { GetSystemPowerStatus(&mut s).ok()? };
        // 128: sin batería; 255: desconocido.
        if s.BatteryFlag & 128 != 0 || s.BatteryFlag == 255 || s.BatteryLifePercent > 100 {
            return None;
        }
        Some(Battery { level: s.BatteryLifePercent, charging: s.ACLineStatus == 1 })
    }

    /// Contadores de la GPU (los del Administrador de tareas).
    pub struct Gpu {
        query: PDH_HQUERY,
        engine: PDH_HCOUNTER,
        memory: PDH_HCOUNTER,
        primed: bool,
    }

    // Los identificadores de PDH se pueden usar desde cualquier hilo; este vive en uno solo.
    unsafe impl Send for Gpu {}

    impl Gpu {
        pub fn open() -> Option<Self> {
            unsafe {
                let mut query = PDH_HQUERY::default();
                if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
                    return None;
                }
                let mut engine = PDH_HCOUNTER::default();
                let mut memory = PDH_HCOUNTER::default();
                let a = PdhAddEnglishCounterW(query, windows::core::w!("\\GPU Engine(*)\\Utilization Percentage"), 0, &mut engine);
                let b = PdhAddEnglishCounterW(query, windows::core::w!("\\GPU Process Memory(*)\\Dedicated Usage"), 0, &mut memory);
                if a != 0 && b != 0 {
                    PdhCloseQuery(query);
                    return None;
                }
                Some(Gpu { query, engine, memory, primed: false })
            }
        }

        /// (% del motor más ocupado, memoria de vídeo) de los procesos.
        pub fn sample(&mut self, pids: &[u32]) -> (Option<f32>, Option<u64>) {
            unsafe {
                if PdhCollectQueryData(self.query) != 0 {
                    return (None, None);
                }
            }
            if !self.primed {
                self.primed = true;
                return (None, None);
            }
            let tags: Vec<String> = pids.iter().map(|p| format!("pid_{p}_")).collect();
            let mine = |name: &str| tags.iter().any(|t| name.starts_with(t.as_str()));
            // Por tipo de motor (3D, copia, vídeo…), la suma de todos sus motores.
            let mut per_type: HashMap<String, f64> = HashMap::new();
            for (name, v) in counter_values(self.engine, false) {
                if !mine(&name) {
                    continue;
                }
                let ty = name.rsplit("engtype_").next().unwrap_or("").to_string();
                *per_type.entry(ty).or_default() += v;
            }
            let gpu = (!pids.is_empty()).then(|| per_type.values().copied().fold(0.0, f64::max).min(100.0) as f32);
            let vram: f64 = counter_values(self.memory, true).into_iter().filter(|(n, _)| mine(n)).map(|(_, v)| v).sum();
            (gpu, (vram > 0.0).then_some(vram as u64))
        }
    }

    impl Drop for Gpu {
        fn drop(&mut self) {
            unsafe {
                PdhCloseQuery(self.query);
            }
        }
    }

    /// (instancia, valor) de un contador con comodín.
    fn counter_values(counter: PDH_HCOUNTER, large: bool) -> Vec<(String, f64)> {
        let fmt = if large { PDH_FMT_LARGE } else { PDH_FMT_DOUBLE };
        unsafe {
            let (mut size, mut count) = (0u32, 0u32);
            let _ = PdhGetFormattedCounterArrayW(counter, fmt, &mut size, &mut count, None);
            if size == 0 {
                return vec![];
            }
            // Alineado para los PDH_FMT_COUNTERVALUE_ITEM_W del principio.
            let mut buf = vec![0u64; (size as usize).div_ceil(8)];
            let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            if PdhGetFormattedCounterArrayW(counter, fmt, &mut size, &mut count, Some(items)) != 0 {
                return vec![];
            }
            (0..count as usize)
                .filter_map(|i| {
                    let it = &*items.add(i);
                    if it.FmtValue.CStatus != 0 {
                        return None;
                    }
                    let name = it.szName.to_string().ok()?;
                    let v = if large { it.FmtValue.Anonymous.largeValue as f64 } else { it.FmtValue.Anonymous.doubleValue };
                    Some((name, v))
                })
                .collect()
        }
    }

    fn endpoint() -> windows::core::Result<windows::Win32::Media::Audio::IMMDevice> {
        unsafe {
            let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            en.GetDefaultAudioEndpoint(eRender, eConsole)
        }
    }

    /// Sesiones de audio de estos procesos en la salida por defecto.
    fn sessions(dev: &windows::Win32::Media::Audio::IMMDevice, pids: &[u32]) -> windows::core::Result<Vec<ISimpleAudioVolume>> {
        let mut out = vec![];
        if pids.is_empty() {
            return Ok(out);
        }
        unsafe {
            let mgr: IAudioSessionManager2 = dev.Activate(CLSCTX_ALL, None)?;
            let list = mgr.GetSessionEnumerator()?;
            for i in 0..list.GetCount()? {
                let Ok(s) = list.GetSession(i) else { continue };
                let Ok(s2) = s.cast::<IAudioSessionControl2>() else { continue };
                if s2.GetProcessId().map(|p| pids.contains(&p)).unwrap_or(false) {
                    if let Ok(v) = s.cast::<ISimpleAudioVolume>() {
                        out.push(v);
                    }
                }
            }
        }
        Ok(out)
    }

    pub fn volume(pids: &[u32]) -> windows::core::Result<Volume> {
        unsafe {
            let dev = endpoint()?;
            let ep: IAudioEndpointVolume = dev.Activate(CLSCTX_ALL, None)?;
            let master = ep.GetMasterVolumeLevelScalar()?;
            let master_muted = ep.GetMute()?.as_bool();
            let game = sessions(&dev, pids).unwrap_or_default();
            let level = game.first().and_then(|v| v.GetMasterVolume().ok());
            let muted = game.first().and_then(|v| v.GetMute().ok()).map(|b| b.as_bool()).unwrap_or(false);
            Ok(Volume { game: level, game_muted: muted, master, master_muted })
        }
    }

    pub fn set_volume(game: bool, pids: &[u32], level: Option<f32>, muted: Option<bool>) -> anyhow::Result<()> {
        unsafe {
            let dev = endpoint()?;
            if game {
                let list = sessions(&dev, pids)?;
                if list.is_empty() {
                    anyhow::bail!("El juego aún no tiene sonido");
                }
                for v in list {
                    if let Some(l) = level {
                        v.SetMasterVolume(l, std::ptr::null())?;
                    }
                    if let Some(m) = muted {
                        v.SetMute(m, std::ptr::null())?;
                    }
                }
            } else {
                let ep: IAudioEndpointVolume = dev.Activate(CLSCTX_ALL, None)?;
                if let Some(l) = level {
                    ep.SetMasterVolumeLevelScalar(l, std::ptr::null())?;
                }
                if let Some(m) = muted {
                    ep.SetMute(m, std::ptr::null())?;
                }
            }
        }
        Ok(())
    }

    /// Carátula del programa que suena como data: URL (máx. 1 MB).
    pub fn read_stream(r: &windows::Storage::Streams::IRandomAccessStreamReference) -> Option<String> {
        use base64::Engine;
        use windows::Storage::Streams::DataReader;
        let stream = r.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 1024 * 1024 {
            return None;
        }
        let mime = stream.ContentType().map(|s| s.to_string_lossy()).ok().filter(|m| m.starts_with("image/")).unwrap_or_else(|| "image/png".into());
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let n = reader.LoadAsync(size as u32).ok()?.get().ok()?;
        let mut buf = vec![0u8; n as usize];
        reader.ReadBytes(&mut buf).ok()?;
        Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&buf)))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn app_names() {
        assert_eq!(super::app_name("Spotify.exe"), "Spotify");
        assert_eq!(super::app_name("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"), "Reproductor multimedia");
        assert_eq!(super::app_name("MSEdge"), "Edge");
        assert_eq!(super::app_name("C:\\Apps\\cider.exe"), "Cider");
    }
}
