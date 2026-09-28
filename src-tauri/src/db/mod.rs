//! SQLite (WAL). Una conexión protegida por mutex: las consultas son cortas y
//! todo el trabajo pesado (red, disco, imágenes) ocurre fuera del lock.

pub mod models;
pub mod repo;

use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::Path;

/// Un paso de migración: SQL o, si hace falta lógica (rutas…), una función.
enum Migration {
    Sql(&'static str),
    Rust(fn(&Connection) -> rusqlite::Result<()>),
}

const MIGRATIONS: &[Migration] = &[
    Migration::Sql(include_str!("../../migrations/001_init.sql")),
    Migration::Sql(include_str!("../../migrations/002_owned.sql")),
    Migration::Sql(include_str!("../../migrations/003_achievements.sql")),
    Migration::Sql(include_str!("../../migrations/004_review_reset.sql")),
    Migration::Sql(include_str!("../../migrations/005_scan_fixes.sql")),
    Migration::Sql(include_str!("../../migrations/006_downloads.sql")),
    Migration::Sql(include_str!("../../migrations/007_overlay.sql")),
    // 0.5.0: fuera los juegos de tiendas.
    Migration::Rust(repo::migrate_local_only),
    Migration::Sql(include_str!("../../migrations/009_guides.sql")),
    Migration::Sql(include_str!("../../migrations/010_trainers_maps.sql")),
];

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn memory() -> anyhow::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> anyhow::Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "temp_store", "MEMORY")?;
        conn.pragma_update(None, "cache_size", -8000)?; // ~8 MB
        conn.busy_timeout(std::time::Duration::from_secs(5))?;

        let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < MIGRATIONS.len() {
            let tx = conn.transaction()?;
            for m in &MIGRATIONS[version..] {
                match m {
                    Migration::Sql(sql) => tx.execute_batch(sql)?,
                    Migration::Rust(f) => f(&tx)?,
                }
            }
            tx.pragma_update(None, "user_version", MIGRATIONS.len())?;
            tx.commit()?;
        }
        Ok(Db {
            conn: Mutex::new(conn),
        })
    }

    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> anyhow::Result<T> {
        let c = self.conn.lock();
        Ok(f(&c)?)
    }

    pub fn with_mut<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>,
    ) -> anyhow::Result<T> {
        let mut c = self.conn.lock();
        Ok(f(&mut c)?)
    }
}

/// Lee una columna JSON como `Vec<String>`.
pub fn json_vec(s: Option<String>) -> Vec<String> {
    s.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
