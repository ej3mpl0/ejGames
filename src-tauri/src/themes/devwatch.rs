//! Hot reload: vigila la carpeta del tema activo y avisa al host al guardar.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

#[derive(Default)]
pub struct DevWatch {
    current: Mutex<Option<(String, RecommendedWatcher)>>,
}

impl DevWatch {
    pub fn watch(&self, id: &str, dir: PathBuf, on_change: impl Fn(String) + Send + 'static) {
        let mut cur = self.current.lock();
        if cur.as_ref().map(|(i, _)| i == id).unwrap_or(false) {
            return;
        }
        *cur = None;
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let Ok(mut w) = notify::recommended_watcher(tx) else { return };
        if w.watch(&dir, RecursiveMode::Recursive).is_err() {
            return;
        }
        let theme = id.to_string();
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                // Debounce: los editores guardan varias veces seguidas.
                while rx.recv_timeout(Duration::from_millis(150)).is_ok() {}
                on_change(theme.clone());
            }
        });
        *cur = Some((id.to_string(), w));
    }

    pub fn stop(&self) {
        *self.current.lock() = None;
    }
}
