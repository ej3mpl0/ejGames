//! Vigila (sin recursión) la raíz de cada carpeta de biblioteca y pide un
//! reescaneo con debounce cuando aparecen o desaparecen subcarpetas.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

type FolderMap = Arc<Mutex<HashMap<PathBuf, i64>>>;

pub struct FolderWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    map: FolderMap,
}

impl FolderWatcher {
    /// `on_change(folder_id)` se llama desde un hilo propio tras 4 s sin eventos.
    pub fn start(on_change: impl Fn(i64) + Send + 'static) -> Self {
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let watcher = notify::recommended_watcher(tx).ok();
        let map: FolderMap = Arc::default();
        let map_thread = map.clone();
        let _ = std::thread::Builder::new().name("ejg-watcher".into()).spawn(move || {
            let mut pending: HashSet<i64> = HashSet::new();
            let mut last = Instant::now();
            loop {
                // Sin nada pendiente el hilo duerme bloqueado en el canal (0 % CPU).
                let ev = if pending.is_empty() {
                    rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected)
                } else {
                    rx.recv_timeout(Duration::from_millis(500))
                };
                match ev {
                    Ok(Ok(ev)) => {
                        let relevant = matches!(
                            ev.kind,
                            EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(notify::event::ModifyKind::Name(_))
                        );
                        if relevant {
                            let m = map_thread.lock();
                            for p in &ev.paths {
                                if let Some(id) = p.parent().and_then(|parent| m.get(parent)) {
                                    pending.insert(*id);
                                    last = Instant::now();
                                }
                            }
                        }
                    }
                    Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
                if !pending.is_empty() && last.elapsed() > Duration::from_secs(4) {
                    for id in pending.drain() {
                        on_change(id);
                    }
                }
            }
        });
        FolderWatcher {
            watcher: Mutex::new(watcher),
            map,
        }
    }

    /// Sincroniza las carpetas vigiladas con la lista actual.
    pub fn set_folders(&self, folders: &[(i64, String)]) {
        let mut w = self.watcher.lock();
        let Some(watcher) = w.as_mut() else { return };
        let mut current = self.map.lock();
        let wanted: HashMap<PathBuf, i64> = folders.iter().map(|(id, p)| (PathBuf::from(p), *id)).collect();
        for p in current.keys() {
            if !wanted.contains_key(p) {
                let _ = watcher.unwatch(p);
            }
        }
        for p in wanted.keys() {
            if !current.contains_key(p) {
                let _ = watcher.watch(p, RecursiveMode::NonRecursive);
            }
        }
        *current = wanted;
    }
}
