//! Cola de metadatos: agrupa juegos en lotes (GetItems admite muchos appids),
//! se puede pausar (modo ahorro) y emite progreso.

use crate::state::AppState;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Notify};

#[derive(Debug, Clone)]
pub enum Job {
    Game(i64),
    /// Coincidencia elegida por el usuario: (id juego, proveedor, id externo).
    Forced(i64, String, i64),
}

pub struct MetaQueue {
    tx: mpsc::UnboundedSender<Job>,
    paused: AtomicBool,
    resume: Notify,
    total: AtomicUsize,
    done: AtomicUsize,
}

impl MetaQueue {
    pub fn new() -> (Self, mpsc::UnboundedReceiver<Job>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (
            MetaQueue {
                tx,
                paused: AtomicBool::new(false),
                resume: Notify::new(),
                total: AtomicUsize::new(0),
                done: AtomicUsize::new(0),
            },
            rx,
        )
    }

    pub fn push(&self, job: Job) {
        self.total.fetch_add(1, Ordering::Relaxed);
        let _ = self.tx.send(job);
    }

    pub fn push_many(&self, ids: impl IntoIterator<Item = i64>) {
        for id in ids {
            self.push(Job::Game(id));
        }
    }

    pub fn set_paused(&self, p: bool) {
        self.paused.store(p, Ordering::Relaxed);
        if !p {
            self.resume.notify_waiters();
        }
    }

    pub fn progress(&self) -> (usize, usize) {
        (self.done.load(Ordering::Relaxed), self.total.load(Ordering::Relaxed))
    }
}

pub fn start_worker(st: Arc<AppState>, mut rx: mpsc::UnboundedReceiver<Job>) {
    tauri::async_runtime::spawn(async move {
        while let Some(first) = rx.recv().await {
            // Pequeña espera para juntar un lote (escaneos e importaciones llegan en ráfaga).
            tokio::time::sleep(Duration::from_millis(400)).await;
            let mut batch = vec![first];
            while batch.len() < 25 {
                match rx.try_recv() {
                    Ok(j) => batch.push(j),
                    Err(_) => break,
                }
            }
            while st.meta.paused.load(Ordering::Relaxed) {
                let wait = st.meta.resume.notified();
                if !st.meta.paused.load(Ordering::Relaxed) {
                    break;
                }
                wait.await;
            }
            let mut ids = vec![];
            let mut forced = HashMap::new();
            for j in &batch {
                match j {
                    Job::Game(id) => ids.push(*id),
                    Job::Forced(id, p, ext) => {
                        ids.push(*id);
                        forced.insert(*id, (p.clone(), *ext));
                    }
                }
            }
            ids.dedup();
            crate::events::meta_progress(&st);
            if let Err(e) = super::process_batch(&st, &ids, &forced).await {
                tracing::warn!("lote de metadatos: {e:#}");
            }
            st.meta.done.fetch_add(batch.len(), Ordering::Relaxed);
            if st.meta.done.load(Ordering::Relaxed) >= st.meta.total.load(Ordering::Relaxed) {
                st.meta.done.store(0, Ordering::Relaxed);
                st.meta.total.store(0, Ordering::Relaxed);
            }
            crate::events::meta_progress(&st);
        }
    });
}
