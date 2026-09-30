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
    Migration::Sql(include_str!("../../migrations/011_accounts.sql")),
    Migration::Sql(include_str!("../../migrations/012_wishlist.sql")),
    // 0.8.0: sin cuentas; el perfil y el historial, en el PC.
    Migration::Sql(include_str!("../../migrations/013_local_profile.sql")),
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 0.8.0: lo que hubiera en la cuenta pasa al perfil local y el historial
    /// se rellena con las partidas y los logros de antes.
    #[test]
    fn accounts_become_local_profile_pages() {
        let mut conn = Connection::open_in_memory().unwrap();
        let before = MIGRATIONS.len() - 1;
        {
            let tx = conn.transaction().unwrap();
            for m in &MIGRATIONS[..before] {
                match m {
                    Migration::Sql(sql) => tx.execute_batch(sql).unwrap(),
                    Migration::Rust(f) => f(&tx).unwrap(),
                }
            }
            tx.execute_batch(
                r#"
                INSERT INTO profiles (id, name, created_at) VALUES (1, 'Ana', 0), (2, 'Leo', 0);
                INSERT INTO games (id, title, sort_title, source, source_id, added_at, updated_at) VALUES (7, 'Hades', 'hades', 'manual', 'h', 0, 0);
                INSERT INTO sessions (profile_id, game_id, started_at, ended_at, duration_s) VALUES (1, 7, 100, 700, 600);
                INSERT INTO achievement_defs (game_id, api_name, name) VALUES (7, 'A', 'Primera sangre');
                INSERT INTO achievement_unlocks (game_id, api_name, unlocked_at, source, profile_id) VALUES (7, 'A', 650, 'test', 1);
                INSERT INTO accounts (profile_id, user_id, username, token, linked_at, cache)
                  VALUES (1, 5, 'ana', x'', 0, '{"me":{"profile":{"bio":"Hola","frame":"neon","color":"gold","country":"ES","featuredBadge":"marathon","showcases":[{"type":"stats"}]}}}'),
                         (2, 6, 'leo', x'', 0, NULL);
                "#,
            )
            .unwrap();
            tx.pragma_update(None, "user_version", before).unwrap();
            tx.commit().unwrap();
        }
        let db = Db::init(conn).unwrap();
        db.with(|c| {
            let (bio, frame, color, country, badge, showcases): (String, String, String, String, String, String) = c.query_row(
                "SELECT bio, frame, color, country, featured_badge, showcases FROM profile_page WHERE profile_id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )?;
            assert_eq!((bio.as_str(), frame.as_str(), color.as_str(), country.as_str(), badge.as_str()), ("Hola", "neon", "gold", "ES", "marathon"));
            assert_eq!(showcases, r#"[{"type":"stats"}]"#);
            let pages: i64 = c.query_row("SELECT COUNT(*) FROM profile_page", [], |r| r.get(0))?;
            assert_eq!(pages, 1);
            let gone: i64 = c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'accounts'", [], |r| r.get(0))?;
            assert_eq!(gone, 0);
            let kinds: Vec<String> = c.prepare("SELECT kind FROM activity ORDER BY at")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            assert_eq!(kinds, ["achievement", "played"]);
            Ok(())
        })
        .unwrap();
    }
}
