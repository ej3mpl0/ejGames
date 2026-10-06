//! Consultas SQL. Todas reciben `&Connection` y se llaman dentro de `Db::with`.

use super::json_vec;
use super::models::*;
use crate::util::now;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;

// ───────────────────────────── carpetas ─────────────────────────────

pub fn list_folders(c: &Connection) -> rusqlite::Result<Vec<LibraryFolder>> {
    let mut st = c.prepare_cached(
        "SELECT f.id, f.path, f.mode, f.enabled, f.last_scan,
                (SELECT COUNT(*) FROM games g WHERE g.folder_id = f.id AND g.missing = 0)
         FROM library_folders f ORDER BY f.path",
    )?;
    let rows = st.query_map([], |r| {
        Ok(LibraryFolder {
            id: r.get(0)?,
            // Carpetas guardadas por versiones antiguas como "E:" (raíz de unidad).
            path: crate::util::clean_dir(&r.get::<_, String>(1)?),
            mode: r.get(2)?,
            enabled: r.get(3)?,
            last_scan: r.get(4)?,
            game_count: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn add_folder(c: &Connection, path: &str, mode: &str) -> rusqlite::Result<i64> {
    c.execute(
        "INSERT INTO library_folders (path, mode) VALUES (?1, ?2)
         ON CONFLICT(path) DO UPDATE SET mode = excluded.mode, enabled = 1",
        params![path, mode],
    )?;
    c.query_row(
        "SELECT id FROM library_folders WHERE path = ?1",
        [path],
        |r| r.get(0),
    )
}

pub fn remove_folder(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("DELETE FROM library_folders WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_folder_scanned(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute(
        "UPDATE library_folders SET last_scan = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    Ok(())
}

// ───────────────────────────── juegos ─────────────────────────────

pub fn sort_title(title: &str) -> String {
    let t = title.trim().to_lowercase();
    for p in ["the ", "a ", "an "] {
        if let Some(rest) = t.strip_prefix(p) {
            return rest.to_string();
        }
    }
    t
}

/// Inserta o actualiza un juego detectado. Devuelve `(id, es_nuevo)`, o `None`
/// si el escáner de carpetas encuentra un directorio que ya es de un juego
/// añadido de otra forma (a mano o instalado desde Descargas): ese gana.
pub fn upsert_game(c: &Connection, g: &NewGame) -> rusqlite::Result<Option<(i64, bool)>> {
    if g.source == "folder" {
        if let Some(dir) = &g.install_dir {
            let taken: Option<i64> = c
                .query_row(
                    "SELECT id FROM games WHERE install_dir = ?1 COLLATE NOCASE AND source != 'folder' LIMIT 1",
                    [dir],
                    |r| r.get(0),
                )
                .optional()?;
            if taken.is_some() {
                return Ok(None);
            }
        }
    }

    let existing: Option<(i64, String)> = c
        .query_row(
            "SELECT id, meta_locked FROM games WHERE source = ?1 AND source_id = ?2",
            params![g.source, g.source_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let hints = serde_json::to_string(&g.process_hints).unwrap_or_else(|_| "[]".into());
    let ts = now();

    if let Some((id, locked)) = existing {
        let locked: Vec<String> = serde_json::from_str(&locked).unwrap_or_default();
        let lock_exe = locked.iter().any(|l| l == "exe");
        let lock_launch = locked.iter().any(|l| l == "launch");
        c.execute(
            "UPDATE games SET
               install_dir = ?2,
               exe_path = CASE WHEN ?3 THEN exe_path ELSE COALESCE(?4, exe_path) END,
               launch_uri = CASE WHEN ?14 THEN launch_uri ELSE COALESCE(?5, launch_uri) END,
               process_hints = CASE WHEN ?3 OR ?6 = '[]' THEN process_hints ELSE ?6 END,
               engine = COALESCE(?7, engine),
               steam_appid = COALESCE(steam_appid, ?8),
               folder_id = COALESCE(?9, folder_id),
               working_dir = CASE WHEN ?3 THEN working_dir ELSE COALESCE(?10, working_dir) END,
               platform = COALESCE(?15, platform),
               rom_path = COALESCE(?16, rom_path),
               rom_meta = COALESCE(?17, rom_meta),
               missing = 0,
               installed = 1,
               -- Sin datos identificados ni nombre puesto a mano: el título es el
               -- de la carpeta (así mejora si mejora la limpieza de nombres).
               title = CASE WHEN meta_status IN ('failed', 'pending') AND meta_locked NOT LIKE '%\"title\"%'
                            AND ?12 <> '' THEN ?12 ELSE title END,
               sort_title = CASE WHEN meta_status IN ('failed', 'pending') AND meta_locked NOT LIKE '%\"title\"%'
                                 AND ?12 <> '' THEN ?13 ELSE sort_title END,
               updated_at = ?11
             WHERE id = ?1",
            params![
                id,
                g.install_dir,
                lock_exe,
                g.exe_path,
                g.launch_uri,
                hints,
                g.engine,
                g.steam_appid,
                g.folder_id,
                g.working_dir,
                ts,
                g.title,
                sort_title(&g.title),
                lock_launch,
                g.platform,
                g.rom_path,
                g.rom_meta
            ],
        )?;
        Ok(Some((id, false)))
    } else {
        c.execute(
            "INSERT INTO games (title, sort_title, source, source_id, folder_id, install_dir, exe_path,
               args, working_dir, launch_uri, process_hints, engine, steam_appid, added_at, updated_at, platform, rom_path, rom_meta)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15, ?16, ?17)",
            params![
                g.title,
                sort_title(&g.title),
                g.source,
                g.source_id,
                g.folder_id,
                g.install_dir,
                g.exe_path,
                g.args,
                g.working_dir,
                g.launch_uri,
                hints,
                g.engine,
                g.steam_appid,
                ts,
                g.platform,
                g.rom_path,
                g.rom_meta
            ],
        )?;
        Ok(Some((c.last_insert_rowid(), true)))
    }
}

pub fn replace_exe_candidates(
    c: &Connection,
    game_id: i64,
    cands: &[(String, f32)],
) -> rusqlite::Result<()> {
    c.execute("DELETE FROM game_exes WHERE game_id = ?1", [game_id])?;
    let mut st = c.prepare_cached("INSERT OR IGNORE INTO game_exes (game_id, path, score) VALUES (?1, ?2, ?3)")?;
    for (p, s) in cands.iter().take(12) {
        st.execute(params![game_id, p, *s as f64])?;
    }
    Ok(())
}

pub fn exe_candidates(c: &Connection, game_id: i64) -> rusqlite::Result<Vec<(String, f64)>> {
    let mut st = c.prepare_cached("SELECT path, score FROM game_exes WHERE game_id = ?1 ORDER BY score DESC")?;
    let rows = st.query_map([game_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// Marca como "missing" los juegos de una carpeta que ya no se han encontrado.
pub fn mark_missing(
    c: &Connection,
    folder_id: i64,
    present: &[i64],
) -> rusqlite::Result<usize> {
    let all: Vec<i64> = {
        let mut st = c.prepare_cached("SELECT id FROM games WHERE folder_id = ?1 AND missing = 0")?;
        let rows = st.query_map([folder_id], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut n = 0;
    for id in all {
        if !present.contains(&id) {
            c.execute("UPDATE games SET missing = 1 WHERE id = ?1", [id])?;
            n += 1;
        }
    }
    Ok(n)
}

const GAME_COLS: &str = "id, title, sort_title, source, source_id, folder_id, install_dir, exe_path, args,
  working_dir, launch_uri, run_as_admin, process_hints, engine, steam_appid, sgdb_id, igdb_id,
  description, short_description, developer, publisher, release_date, genres, tags, rating,
  meta_status, match_confidence, meta_locked, discord_enabled, missing, added_at, updated_at,
  installed, platform, rom_path, rom_meta";

fn row_game(r: &Row) -> rusqlite::Result<Game> {
    Ok(Game {
        id: r.get(0)?,
        title: r.get(1)?,
        sort_title: r.get(2)?,
        source: r.get(3)?,
        source_id: r.get(4)?,
        folder_id: r.get(5)?,
        install_dir: r.get(6)?,
        exe_path: r.get(7)?,
        args: r.get(8)?,
        working_dir: r.get(9)?,
        launch_uri: r.get(10)?,
        run_as_admin: r.get(11)?,
        process_hints: json_vec(r.get(12)?),
        engine: r.get(13)?,
        steam_appid: r.get(14)?,
        sgdb_id: r.get(15)?,
        igdb_id: r.get(16)?,
        description: r.get(17)?,
        short_description: r.get(18)?,
        developer: r.get(19)?,
        publisher: r.get(20)?,
        release_date: r.get(21)?,
        genres: json_vec(r.get(22)?),
        tags: json_vec(r.get(23)?),
        rating: r.get(24)?,
        meta_status: r.get(25)?,
        match_confidence: r.get(26)?,
        meta_locked: json_vec(r.get(27)?),
        discord_enabled: r.get(28)?,
        missing: r.get(29)?,
        added_at: r.get(30)?,
        updated_at: r.get(31)?,
        installed: r.get(32)?,
        platform: r.get(33)?,
        rom_path: r.get(34)?,
        rom_meta: r.get(35)?,
    })
}

pub fn get_game(c: &Connection, id: i64) -> rusqlite::Result<Game> {
    c.query_row(&format!("SELECT {GAME_COLS} FROM games WHERE id = ?1"), [id], row_game)
}

pub fn games_by_status(c: &Connection, statuses: &[&str]) -> rusqlite::Result<Vec<Game>> {
    let list = statuses
        .iter()
        .map(|s| format!("'{s}'"))
        .collect::<Vec<_>>()
        .join(",");
    let mut st = c.prepare(&format!(
        "SELECT {GAME_COLS} FROM games WHERE meta_status IN ({list}) AND missing = 0 ORDER BY added_at"
    ))?;
    let rows = st.query_map([], row_game)?;
    rows.collect()
}

pub fn set_meta_status(c: &Connection, id: i64, status: &str, conf: Option<f64>) -> rusqlite::Result<()> {
    c.execute(
        "UPDATE games SET meta_status = ?2, match_confidence = COALESCE(?3, match_confidence), updated_at = ?4 WHERE id = ?1",
        params![id, status, conf, now()],
    )?;
    Ok(())
}

/// Aplica metadatos descargados sin pisar los campos que el usuario bloqueó al editarlos.
pub fn apply_metadata(c: &Connection, id: i64, m: &crate::metadata::Metadata) -> rusqlite::Result<()> {
    let g = get_game(c, id)?;
    let locked = |f: &str| g.meta_locked.iter().any(|l| l == f);
    let pick = |f: &str, new: &Option<String>, old: &Option<String>| -> Option<String> {
        if locked(f) || new.as_deref().map(str::is_empty).unwrap_or(true) {
            old.clone()
        } else {
            new.clone()
        }
    };
    let title = if locked("title") {
        g.title.clone()
    } else {
        m.title.clone().filter(|t| !t.is_empty()).unwrap_or(g.title.clone())
    };
    let genres = if locked("genres") || m.genres.is_empty() { g.genres.clone() } else { m.genres.clone() };
    let tags = if m.tags.is_empty() { g.tags.clone() } else { m.tags.clone() };
    c.execute(
        "UPDATE games SET title = ?2, sort_title = ?3, description = ?4, short_description = ?5,
           developer = ?6, publisher = ?7, release_date = ?8, genres = ?9, tags = ?10,
           rating = COALESCE(?11, rating), steam_appid = COALESCE(?12, steam_appid),
           sgdb_id = COALESCE(?13, sgdb_id), igdb_id = COALESCE(?14, igdb_id), updated_at = ?15
         WHERE id = ?1",
        params![
            id,
            title,
            sort_title(&title),
            pick("description", &m.description, &g.description),
            pick("short_description", &m.short_description, &g.short_description),
            pick("developer", &m.developer, &g.developer),
            pick("publisher", &m.publisher, &g.publisher),
            pick("release_date", &m.release_date, &g.release_date),
            serde_json::to_string(&genres).unwrap(),
            serde_json::to_string(&tags).unwrap(),
            m.rating,
            m.steam_appid,
            m.sgdb_id,
            m.igdb_id,
            now()
        ],
    )?;
    Ok(())
}

pub fn update_game(c: &Connection, id: i64, p: &GamePatch) -> rusqlite::Result<()> {
    let g = get_game(c, id)?;
    let mut locked = g.meta_locked.clone();
    let mut lock = |f: &str| {
        if !locked.iter().any(|l| l == f) {
            locked.push(f.to_string());
        }
    };
    let mut sets: Vec<String> = vec![];
    let mut vals: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    macro_rules! set {
        ($col:literal, $val:expr) => {{
            vals.push(Box::new($val));
            sets.push(format!("{} = ?{}", $col, vals.len() + 1));
        }};
    }
    if let Some(v) = &p.title {
        lock("title");
        set!("title", v.clone());
        set!("sort_title", sort_title(v));
    }
    if let Some(v) = &p.exe_path {
        lock("exe");
        set!("exe_path", v.clone());
    }
    if let Some(v) = &p.args {
        set!("args", v.clone());
    }
    if let Some(v) = &p.working_dir {
        lock("exe");
        set!("working_dir", v.clone());
    }
    if let Some(v) = &p.launch_uri {
        // Elegido a mano (también vaciarla): la tienda no lo vuelve a poner.
        lock("launch");
        set!("launch_uri", v.clone());
    }
    if let Some(v) = p.run_as_admin {
        set!("run_as_admin", v);
    }
    if let Some(v) = &p.description {
        lock("description");
        set!("description", v.clone());
    }
    if let Some(v) = &p.short_description {
        lock("short_description");
        set!("short_description", v.clone());
    }
    if let Some(v) = &p.developer {
        lock("developer");
        set!("developer", v.clone());
    }
    if let Some(v) = &p.publisher {
        lock("publisher");
        set!("publisher", v.clone());
    }
    if let Some(v) = &p.release_date {
        lock("release_date");
        set!("release_date", v.clone());
    }
    if let Some(v) = &p.genres {
        lock("genres");
        set!("genres", serde_json::to_string(v).unwrap());
    }
    if let Some(v) = p.discord_enabled {
        set!("discord_enabled", v);
    }
    if let Some(v) = &p.process_hints {
        set!("process_hints", serde_json::to_string(v).unwrap());
    }
    set!("meta_locked", serde_json::to_string(&locked).unwrap());
    set!("updated_at", now());
    let sql = format!("UPDATE games SET {} WHERE id = ?1", sets.join(", "));
    let mut all: Vec<&dyn rusqlite::ToSql> = vec![&id];
    all.extend(vals.iter().map(|b| b.as_ref()));
    c.execute(&sql, all.as_slice())?;
    Ok(())
}

/// Funde el juego `from` en `into` (horas, sesiones, colecciones, logros y
/// estado por perfil) y borra `from`.
fn merge_game(c: &Connection, from: i64, into: i64) -> rusqlite::Result<()> {
    c.execute("UPDATE sessions SET game_id = ?2 WHERE game_id = ?1", params![from, into])?;
    c.execute(
        "INSERT INTO profile_game (profile_id, game_id, favorite, hidden, last_played, playtime_s, launch_count, user_rating, notes)
         SELECT profile_id, ?2, favorite, hidden, last_played, playtime_s, launch_count, user_rating, notes
           FROM profile_game WHERE game_id = ?1
         ON CONFLICT(profile_id, game_id) DO UPDATE SET
           favorite = MAX(favorite, excluded.favorite),
           hidden = MIN(hidden, excluded.hidden),
           last_played = MAX(COALESCE(last_played, 0), COALESCE(excluded.last_played, 0)),
           playtime_s = playtime_s + excluded.playtime_s,
           launch_count = launch_count + excluded.launch_count,
           user_rating = COALESCE(user_rating, excluded.user_rating),
           notes = COALESCE(notes, excluded.notes)",
        params![from, into],
    )?;
    c.execute("UPDATE OR IGNORE collection_games SET game_id = ?2 WHERE game_id = ?1", params![from, into])?;
    c.execute("UPDATE OR IGNORE achievement_unlocks SET game_id = ?2 WHERE game_id = ?1", params![from, into])?;
    // El arte elegido a mano también pasa al juego de la tienda.
    c.execute("UPDATE media SET game_id = ?2, selected = 0 WHERE game_id = ?1 AND source = 'user'", params![from, into])?;
    c.execute("DELETE FROM games WHERE id = ?1", [from])?;
    Ok(())
}

/// Migración de la 0.5.0: ejGames ya no importa juegos de tiendas. Los que
/// están dentro de una carpeta de la biblioteca (donde el escáner los habría
/// encontrado) pasan a ser juegos de carpeta y conservan horas, logros y notas;
/// el resto se quita de la biblioteca (no se borra nada del disco).
pub fn migrate_local_only(c: &Connection) -> rusqlite::Result<()> {
    use crate::util::norm_path;
    use std::path::Path;
    let folders: Vec<(i64, String, String)> = {
        let mut q = c.prepare("SELECT id, path, mode FROM library_folders WHERE enabled = 1")?;
        let rows = q.query_map([], |r| Ok((r.get(0)?, r.get::<_, String>(1)?, r.get(2)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?.into_iter().map(|(id, p, m)| (id, norm_path(Path::new(&p)), m)).collect()
    };
    let stores: Vec<(i64, Option<String>, bool)> = {
        let mut q = c.prepare("SELECT id, install_dir, installed FROM games WHERE source IN ('steam', 'epic', 'gog', 'ubisoft', 'ea')")?;
        let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (id, dir, installed) in stores {
        let dir = dir.filter(|d| installed && !d.trim().is_empty()).map(|d| norm_path(Path::new(&d)));
        // Donde lo buscaría el escáner: la carpeta misma («un juego») o una o
        // dos subcarpetas por debajo.
        let folder = dir.as_deref().and_then(|d| {
            folders.iter().find(|(_, f, mode)| {
                if mode == "single" {
                    return d == f;
                }
                d.strip_prefix(&format!("{f}\\")).map(|rest| (1..=2).contains(&rest.split('\\').count())).unwrap_or(false)
            })
        });
        match (dir, folder) {
            (Some(d), Some((fid, ..))) => {
                let twin: Option<i64> =
                    c.query_row("SELECT id FROM games WHERE source = 'folder' AND source_id = ?1", [&d], |r| r.get(0)).optional()?;
                match twin {
                    Some(t) => merge_game(c, id, t)?,
                    None => {
                        c.execute(
                            "UPDATE games SET source = 'folder', source_id = ?2, folder_id = ?3, launch_uri = NULL, installed = 1 WHERE id = ?1",
                            params![id, d, fid],
                        )?;
                    }
                }
            }
            _ => {
                c.execute("DELETE FROM games WHERE id = ?1", [id])?;
            }
        }
    }
    // Un escaneo completo al arrancar pone al día los que se han convertido.
    c.execute("UPDATE library_folders SET last_scan = NULL", [])?;
    Ok(())
}

pub fn delete_game(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("DELETE FROM games WHERE id = ?1", [id])?;
    Ok(())
}

pub fn purge_missing(c: &Connection) -> rusqlite::Result<usize> {
    c.execute("DELETE FROM games WHERE missing = 1", [])
}

// ───────────────────────────── biblioteca para UI/temas ─────────────────────────────

struct MediaRef {
    id: i64,
    kind: String,
    hash: Option<String>,
    ext: Option<String>,
    thumb_hash: Option<String>,
    remote: Option<String>,
}

fn resolve(m: &MediaRef) -> Option<String> {
    match m.kind.as_str() {
        "microtrailer" | "trailer" => {
            let file = m.remote.as_deref()?.rsplit('/').next()?.split('?').next()?.to_string();
            Some(trailer_url(m.id, &file))
        }
        _ => match (&m.hash, &m.ext) {
            (Some(h), Some(e)) => Some(media_url(h, e)),
            _ => m.remote.as_ref().map(|_| remote_media_url(m.id)),
        },
    }
}

fn thumb(m: &MediaRef) -> Option<String> {
    match (&m.thumb_hash, &m.hash) {
        (Some(h), _) => Some(media_url(h, "jpg")),
        // Aún sin descargar: el protocolo lo baja y sirve su miniatura.
        (None, None) if m.remote.is_some() && matches!(m.kind.as_str(), "cover" | "hero" | "header") => {
            Some(format!("{}/t", remote_media_url(m.id)))
        }
        _ => None,
    }
}

fn selected_media(c: &Connection, game: Option<i64>) -> rusqlite::Result<HashMap<i64, MediaUrls>> {
    let sql = format!(
        "SELECT id, game_id, kind, hash, ext, thumb_hash, remote_url FROM media
         WHERE selected = 1 AND kind IN ('cover','hero','logo','icon','header','microtrailer') {}
         ORDER BY position",
        if game.is_some() { "AND game_id = ?1" } else { "" }
    );
    let mut st = c.prepare_cached(&sql)?;
    let map_row = |r: &Row| -> rusqlite::Result<(i64, MediaRef)> {
        Ok((
            r.get(1)?,
            MediaRef {
                id: r.get(0)?,
                kind: r.get(2)?,
                hash: r.get(3)?,
                ext: r.get(4)?,
                thumb_hash: r.get(5)?,
                remote: r.get(6)?,
            },
        ))
    };
    let rows: Vec<(i64, MediaRef)> = match game {
        Some(g) => st.query_map([g], map_row)?.collect::<rusqlite::Result<_>>()?,
        None => st.query_map([], map_row)?.collect::<rusqlite::Result<_>>()?,
    };
    let mut out: HashMap<i64, MediaUrls> = HashMap::new();
    for (gid, m) in rows {
        let e = out.entry(gid).or_default();
        let url = resolve(&m);
        match m.kind.as_str() {
            "cover" if e.cover.is_none() => {
                e.cover_thumb = thumb(&m).or(url.clone());
                e.cover = url;
            }
            "hero" if e.hero.is_none() => {
                e.hero_thumb = thumb(&m).or(url.clone());
                e.hero = url;
            }
            "logo" if e.logo.is_none() => e.logo = url,
            "icon" if e.icon.is_none() => e.icon = url,
            "header" if e.header.is_none() => e.header = url,
            "microtrailer" if e.microtrailer.is_none() => e.microtrailer = url,
            _ => {}
        }
    }
    Ok(out)
}

fn collections_by_game(c: &Connection, profile_id: i64) -> rusqlite::Result<HashMap<i64, Vec<i64>>> {
    let mut st = c.prepare_cached(
        "SELECT cg.game_id, cg.collection_id FROM collection_games cg
         JOIN collections co ON co.id = cg.collection_id WHERE co.profile_id = ?1",
    )?;
    let mut out: HashMap<i64, Vec<i64>> = HashMap::new();
    let rows = st.query_map([profile_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (g, col) = row?;
        out.entry(g).or_default().push(col);
    }
    Ok(out)
}

const LIB_SQL: &str = "SELECT g.id, g.title, g.sort_title, g.source, g.engine, g.short_description,
   g.developer, g.publisher, g.release_date, g.genres, g.tags, g.rating, g.meta_status, g.missing, g.added_at,
   COALESCE(pg.favorite, 0), COALESCE(pg.hidden, 0), pg.last_played, COALESCE(pg.playtime_s, 0),
   COALESCE(pg.launch_count, 0), pg.user_rating, g.installed, g.platform, g.rom_meta
 FROM games g LEFT JOIN profile_game pg ON pg.game_id = g.id AND pg.profile_id = ?1";

fn row_lib(r: &Row) -> rusqlite::Result<LibGame> {
    Ok(LibGame {
        id: r.get(0)?,
        title: r.get(1)?,
        sort_title: r.get(2)?,
        source: r.get(3)?,
        engine: r.get(4)?,
        short_description: r.get(5)?,
        developer: r.get(6)?,
        publisher: r.get(7)?,
        release_date: r.get(8)?,
        genres: json_vec(r.get(9)?),
        tags: json_vec(r.get(10)?),
        rating: r.get(11)?,
        meta_status: r.get(12)?,
        missing: r.get(13)?,
        added_at: r.get(14)?,
        favorite: r.get(15)?,
        hidden: r.get(16)?,
        last_played: r.get(17)?,
        playtime: r.get(18)?,
        launch_count: r.get(19)?,
        user_rating: r.get(20)?,
        installed: r.get(21)?,
        platform: r.get(22)?,
        rom: r.get::<_, Option<String>>(23)?.and_then(|s| serde_json::from_str(&s).ok()),
        ..Default::default()
    })
}

pub fn library(c: &Connection, profile_id: i64) -> rusqlite::Result<Vec<LibGame>> {
    let mut media = selected_media(c, None)?;
    let mut cols = collections_by_game(c, profile_id)?;
    let mut ach = crate::achievements::summaries(c)?;
    let mut upd = repack_updates(c)?;
    let mut st = c.prepare_cached(&format!("{LIB_SQL} ORDER BY g.sort_title"))?;
    let rows = st.query_map([profile_id], row_lib)?;
    let mut out = Vec::new();
    for r in rows {
        let mut g = r?;
        g.media = media.remove(&g.id).unwrap_or_default();
        g.collections = cols.remove(&g.id).unwrap_or_default();
        g.achievements = ach.remove(&g.id);
        g.repack_update = upd.remove(&g.id);
        out.push(g);
    }
    Ok(out)
}

pub fn lib_game(c: &Connection, profile_id: i64, id: i64) -> rusqlite::Result<LibGame> {
    let mut g = c.query_row(&format!("{LIB_SQL} WHERE g.id = ?2"), params![profile_id, id], row_lib)?;
    g.media = selected_media(c, Some(id))?.remove(&id).unwrap_or_default();
    g.collections = collections_by_game(c, profile_id)?.remove(&id).unwrap_or_default();
    g.achievements = crate::achievements::summary(c, id)?;
    g.repack_update = repack_updates(c)?.remove(&id);
    Ok(g)
}

// ───────────────────────── repacks con versión nueva ─────────────────────────

/// Avisos vigentes (sin los que el usuario ocultó), por juego.
pub fn repack_updates(c: &Connection) -> rusqlite::Result<HashMap<i64, RepackUpdate>> {
    let mut st = c.prepare_cached(
        "SELECT game_id, slug, installed_version, latest_version FROM repack_updates
         WHERE dismissed_version IS NULL OR dismissed_version <> latest_version",
    )?;
    let rows = st.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, RepackUpdate { slug: r.get(1)?, installed: r.get(2)?, latest: r.get(3)? }))
    })?;
    rows.collect()
}

/// (juego, slug, versión bajada) de cada repack instalado; el último por juego.
pub fn installed_repacks(c: &Connection) -> rusqlite::Result<Vec<(i64, String, String)>> {
    let mut st = c.prepare_cached(
        "SELECT game_id, slug, version FROM downloads
         WHERE state = 'installed' AND game_id IS NOT NULL AND slug IS NOT NULL AND version IS NOT NULL
           AND game_id IN (SELECT id FROM games) ORDER BY id",
    )?;
    let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
    let mut by_game: HashMap<i64, (String, String)> = HashMap::new();
    for r in rows {
        let (g, s, v) = r?;
        by_game.insert(g, (s, v));
    }
    Ok(by_game.into_iter().map(|(g, (s, v))| (g, s, v)).collect())
}

/// Anota (o actualiza) el aviso; true si es nuevo o cambió la versión.
pub fn set_repack_update(c: &Connection, game_id: i64, slug: &str, installed: &str, latest: &str, now: i64) -> rusqlite::Result<bool> {
    let prev: Option<String> = c
        .query_row("SELECT latest_version FROM repack_updates WHERE game_id = ?1", [game_id], |r| r.get(0))
        .ok();
    c.execute(
        "INSERT INTO repack_updates (game_id, slug, installed_version, latest_version, checked_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(game_id) DO UPDATE SET slug = ?2, installed_version = ?3, latest_version = ?4, checked_at = ?5",
        params![game_id, slug, installed, latest, now],
    )?;
    Ok(prev.as_deref() != Some(latest))
}

/// Quita el aviso (ya está al día); true si había uno.
pub fn clear_repack_update(c: &Connection, game_id: i64) -> rusqlite::Result<bool> {
    Ok(c.execute("DELETE FROM repack_updates WHERE game_id = ?1", [game_id])? > 0)
}

pub fn dismiss_repack_update(c: &Connection, game_id: i64) -> rusqlite::Result<()> {
    c.execute("UPDATE repack_updates SET dismissed_version = latest_version WHERE game_id = ?1", [game_id])?;
    Ok(())
}

/// Última revisión (guardada en `metadata_cache`, sin tabla aparte).
pub fn repack_updates_checked(c: &Connection) -> rusqlite::Result<i64> {
    Ok(c
        .query_row("SELECT fetched_at FROM metadata_cache WHERE provider = 'explore' AND key = 'updates:checked'", [], |r| r.get(0))
        .unwrap_or(0))
}

pub fn repack_updates_touch(c: &Connection, now: i64) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO metadata_cache (provider, key, json, fetched_at) VALUES ('explore', 'updates:checked', '{}', ?1)
         ON CONFLICT(provider, key) DO UPDATE SET fetched_at = ?1",
        [now],
    )?;
    Ok(())
}

pub fn list_media(c: &Connection, game_id: i64, kind: Option<&str>) -> rusqlite::Result<Vec<MediaItem>> {
    let mut st = c.prepare_cached(
        "SELECT id, kind, hash, ext, thumb_hash, remote_url, source, selected, title, w, h, extra
         FROM media WHERE game_id = ?1 AND (?2 IS NULL OR kind = ?2) ORDER BY kind, selected DESC, position",
    )?;
    let rows = st.query_map(params![game_id, kind], |r| {
        let m = MediaRef {
            id: r.get(0)?,
            kind: r.get(1)?,
            hash: r.get(2)?,
            ext: r.get(3)?,
            thumb_hash: r.get(4)?,
            remote: r.get(5)?,
        };
        let extra: Option<String> = r.get(11)?;
        let extra: serde_json::Value = extra
            .and_then(|e| serde_json::from_str(&e).ok())
            .unwrap_or(serde_json::Value::Null);
        let has_thumb_remote = extra.get("thumb").and_then(|v| v.as_str()).is_some();
        let has_poster = extra.get("poster").and_then(|v| v.as_str()).is_some();
        Ok(MediaItem {
            id: m.id,
            url: resolve(&m).unwrap_or_default(),
            thumb: thumb(&m).or_else(|| {
                has_thumb_remote.then(|| format!("{}/thumb", remote_media_url(m.id)))
            }),
            kind: m.kind.clone(),
            remote_url: m.remote.clone(),
            source: r.get(6)?,
            selected: r.get(7)?,
            title: r.get(8)?,
            w: r.get(9)?,
            h: r.get(10)?,
            poster: has_poster.then(|| format!("{}/poster", remote_media_url(m.id))),
        })
    })?;
    rows.collect()
}

pub fn game_details(c: &Connection, profile_id: i64, id: i64) -> rusqlite::Result<GameDetails> {
    let lib = lib_game(c, profile_id, id)?;
    let g = get_game(c, id)?;
    let screenshots = list_media(c, id, Some("screenshot"))?;
    let trailers = list_media(c, id, Some("trailer"))?;
    let mut st = c.prepare_cached(
        "SELECT id, game_id, started_at, ended_at, duration_s FROM sessions
         WHERE profile_id = ?1 AND game_id = ?2 ORDER BY started_at DESC LIMIT 20",
    )?;
    let recent_sessions = st
        .query_map(params![profile_id, id], row_session)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(GameDetails {
        lib,
        description: g.description,
        install_dir: g.install_dir,
        screenshots,
        trailers,
        recent_sessions,
        steam_appid: g.steam_appid,
    })
}

fn row_session(r: &Row) -> rusqlite::Result<Session> {
    Ok(Session {
        id: r.get(0)?,
        game_id: r.get(1)?,
        started_at: r.get(2)?,
        ended_at: r.get(3)?,
        duration: r.get(4)?,
    })
}

// ───────────────────────────── perfil ↔ juego ─────────────────────────────

fn ensure_pg(c: &Connection, profile: i64, game: i64) -> rusqlite::Result<()> {
    c.execute(
        "INSERT OR IGNORE INTO profile_game (profile_id, game_id) VALUES (?1, ?2)",
        params![profile, game],
    )?;
    Ok(())
}

pub fn set_favorite(c: &Connection, profile: i64, game: i64, v: bool) -> rusqlite::Result<()> {
    ensure_pg(c, profile, game)?;
    c.execute(
        "UPDATE profile_game SET favorite = ?3 WHERE profile_id = ?1 AND game_id = ?2",
        params![profile, game, v],
    )?;
    Ok(())
}

pub fn set_hidden(c: &Connection, profile: i64, game: i64, v: bool) -> rusqlite::Result<()> {
    ensure_pg(c, profile, game)?;
    c.execute(
        "UPDATE profile_game SET hidden = ?3 WHERE profile_id = ?1 AND game_id = ?2",
        params![profile, game, v],
    )?;
    Ok(())
}

pub fn set_user_rating(c: &Connection, profile: i64, game: i64, v: Option<i64>) -> rusqlite::Result<()> {
    ensure_pg(c, profile, game)?;
    c.execute(
        "UPDATE profile_game SET user_rating = ?3 WHERE profile_id = ?1 AND game_id = ?2",
        params![profile, game, v],
    )?;
    Ok(())
}

pub fn bump_launch(c: &Connection, profile: i64, game: i64) -> rusqlite::Result<()> {
    ensure_pg(c, profile, game)?;
    c.execute(
        "UPDATE profile_game SET launch_count = launch_count + 1, last_played = ?3
         WHERE profile_id = ?1 AND game_id = ?2",
        params![profile, game, now()],
    )?;
    Ok(())
}

pub fn record_session(c: &Connection, profile: i64, game: i64, start: i64, end: i64) -> rusqlite::Result<()> {
    let dur = (end - start).max(0);
    ensure_pg(c, profile, game)?;
    c.execute(
        "INSERT INTO sessions (profile_id, game_id, started_at, ended_at, duration_s) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![profile, game, start, end, dur],
    )?;
    c.execute(
        "UPDATE profile_game SET playtime_s = playtime_s + ?3, last_played = ?4
         WHERE profile_id = ?1 AND game_id = ?2",
        params![profile, game, dur, end],
    )?;
    Ok(())
}

// ───────────────────────────── media ─────────────────────────────

#[allow(clippy::too_many_arguments)]
pub fn insert_media(
    c: &Connection,
    game_id: i64,
    kind: &str,
    remote_url: Option<&str>,
    source: &str,
    selected: bool,
    position: i64,
    title: Option<&str>,
    extra: Option<&serde_json::Value>,
) -> rusqlite::Result<i64> {
    if let Some(url) = remote_url {
        let dup: Option<i64> = c
            .query_row(
                "SELECT id FROM media WHERE game_id = ?1 AND kind = ?2 AND remote_url = ?3",
                params![game_id, kind, url],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = dup {
            return Ok(id);
        }
    }
    // Capturas y tráilers son listas: no hay "uno seleccionado".
    if selected && !matches!(kind, "screenshot" | "trailer") {
        c.execute(
            "UPDATE media SET selected = 0 WHERE game_id = ?1 AND kind = ?2",
            params![game_id, kind],
        )?;
    }
    c.execute(
        "INSERT INTO media (game_id, kind, remote_url, source, selected, position, title, extra)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            game_id,
            kind,
            remote_url,
            source,
            selected,
            position,
            title,
            extra.map(|e| e.to_string())
        ],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn set_media_file(
    c: &Connection,
    id: i64,
    hash: &str,
    ext: &str,
    thumb_hash: Option<&str>,
    w: Option<u32>,
    h: Option<u32>,
) -> rusqlite::Result<()> {
    c.execute(
        "UPDATE media SET hash = ?2, ext = ?3, thumb_hash = ?4, w = ?5, h = ?6 WHERE id = ?1",
        params![id, hash, ext, thumb_hash, w, h],
    )?;
    Ok(())
}

pub fn select_media(c: &Connection, game_id: i64, media_id: i64) -> rusqlite::Result<()> {
    let kind: String = c.query_row(
        "SELECT kind FROM media WHERE id = ?1 AND game_id = ?2",
        params![media_id, game_id],
        |r| r.get(0),
    )?;
    c.execute(
        "UPDATE media SET selected = (id = ?3) WHERE game_id = ?1 AND kind = ?2",
        params![game_id, kind, media_id],
    )?;
    Ok(())
}

pub fn delete_media_by_source(c: &Connection, game_id: i64, sources: &[&str]) -> rusqlite::Result<()> {
    for s in sources {
        c.execute(
            "DELETE FROM media WHERE game_id = ?1 AND source = ?2",
            params![game_id, s],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct MediaRecord {
    pub id: i64,
    pub kind: String,
    pub remote_url: Option<String>,
    pub hash: Option<String>,
    pub ext: Option<String>,
    pub extra: serde_json::Value,
}

pub fn media_by_id(c: &Connection, id: i64) -> rusqlite::Result<Option<MediaRecord>> {
    c.query_row(
        "SELECT id, game_id, kind, remote_url, hash, ext, extra FROM media WHERE id = ?1",
        [id],
        |r| {
            let extra: Option<String> = r.get(6)?;
            Ok(MediaRecord {
                id: r.get(0)?,
                kind: r.get(2)?,
                remote_url: r.get(3)?,
                hash: r.get(4)?,
                ext: r.get(5)?,
                extra: extra
                    .and_then(|e| serde_json::from_str(&e).ok())
                    .unwrap_or(serde_json::Value::Null),
            })
        },
    )
    .optional()
}

/// Media seleccionada pendiente de descargar (covers, heroes…), para la cola.
pub fn pending_downloads(c: &Connection, game_id: i64) -> rusqlite::Result<Vec<MediaRecord>> {
    let mut st = c.prepare_cached(
        "SELECT id FROM media WHERE game_id = ?1 AND selected = 1 AND hash IS NULL
           AND remote_url IS NOT NULL AND kind IN ('cover','hero','logo','icon','header')",
    )?;
    let ids: Vec<i64> = st.query_map([game_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let mut out = vec![];
    for id in ids {
        if let Some(m) = media_by_id(c, id)? {
            out.push(m);
        }
    }
    Ok(out)
}

pub fn selected_remote_url(c: &Connection, game_id: i64, kind: &str) -> rusqlite::Result<Option<String>> {
    c.query_row(
        "SELECT remote_url FROM media WHERE game_id = ?1 AND kind = ?2 AND selected = 1 AND remote_url LIKE 'https://%'",
        params![game_id, kind],
        |r| r.get(0),
    )
    .optional()
    .map(|o| o.flatten())
}

// ───────────────────────────── perfiles ─────────────────────────────

const PROFILE_COLS: &str = "id, name, avatar, color, theme_id, theme_settings, custom_css, pin_hash,
  discord_enabled, discord_hide_names, launch_behavior, sounds_volume, created_at, last_used,
  game_mode_power, game_mode_dnd";

fn row_profile(r: &Row) -> rusqlite::Result<Profile> {
    let ts: String = r.get(5)?;
    let css: String = r.get(6)?;
    let pin: Option<String> = r.get(7)?;
    Ok(Profile {
        id: r.get(0)?,
        name: r.get(1)?,
        avatar: r.get(2)?,
        color: r.get(3)?,
        theme_id: r.get(4)?,
        theme_settings: serde_json::from_str(&ts).unwrap_or_default(),
        custom_css: serde_json::from_str(&css).unwrap_or_default(),
        has_pin: pin.is_some(),
        discord_enabled: r.get(8)?,
        discord_hide_names: r.get(9)?,
        launch_behavior: r.get(10)?,
        sounds_volume: r.get(11)?,
        created_at: r.get(12)?,
        last_used: r.get(13)?,
        game_mode_power: r.get(14)?,
        game_mode_dnd: r.get(15)?,
    })
}

pub fn list_profiles(c: &Connection) -> rusqlite::Result<Vec<Profile>> {
    let mut st = c.prepare_cached(&format!("SELECT {PROFILE_COLS} FROM profiles ORDER BY id"))?;
    let rows = st.query_map([], row_profile)?;
    rows.collect()
}

pub fn get_profile(c: &Connection, id: i64) -> rusqlite::Result<Profile> {
    c.query_row(&format!("SELECT {PROFILE_COLS} FROM profiles WHERE id = ?1"), [id], row_profile)
}

pub fn create_profile(c: &Connection, name: &str, color: &str, theme: &str) -> rusqlite::Result<i64> {
    c.execute(
        "INSERT INTO profiles (name, color, theme_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![name, color, theme, now()],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn pin_hash(profile_id: i64, pin: &str) -> String {
    let mut h = blake3::Hasher::new();
    h.update(b"ejgames-pin-v1");
    h.update(&profile_id.to_le_bytes());
    h.update(pin.as_bytes());
    h.finalize().to_hex().to_string()
}

pub fn verify_pin(c: &Connection, id: i64, pin: &str) -> rusqlite::Result<bool> {
    let stored: Option<String> =
        c.query_row("SELECT pin_hash FROM profiles WHERE id = ?1", [id], |r| r.get(0))?;
    Ok(match stored {
        None => true,
        Some(h) => h == pin_hash(id, pin),
    })
}

pub fn update_profile(c: &Connection, id: i64, p: &ProfilePatch) -> rusqlite::Result<()> {
    if let Some(v) = &p.name {
        c.execute("UPDATE profiles SET name = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = &p.avatar {
        c.execute("UPDATE profiles SET avatar = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = &p.color {
        c.execute("UPDATE profiles SET color = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = &p.theme_id {
        c.execute("UPDATE profiles SET theme_id = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = p.discord_enabled {
        c.execute("UPDATE profiles SET discord_enabled = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = p.discord_hide_names {
        c.execute("UPDATE profiles SET discord_hide_names = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = &p.launch_behavior {
        c.execute("UPDATE profiles SET launch_behavior = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = p.sounds_volume {
        c.execute("UPDATE profiles SET sounds_volume = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = p.game_mode_power {
        c.execute("UPDATE profiles SET game_mode_power = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = p.game_mode_dnd {
        c.execute("UPDATE profiles SET game_mode_dnd = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(pin) = &p.pin {
        let v: Option<String> = if pin.is_empty() { None } else { Some(pin_hash(id, pin)) };
        c.execute("UPDATE profiles SET pin_hash = ?2 WHERE id = ?1", params![id, v])?;
    }
    Ok(())
}

pub fn touch_profile(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("UPDATE profiles SET last_used = ?2 WHERE id = ?1", params![id, now()])?;
    Ok(())
}

pub fn delete_profile(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("DELETE FROM profiles WHERE id = ?1", [id])?;
    c.execute("DELETE FROM theme_storage WHERE profile_id = ?1", [id])?;
    Ok(())
}

/// Guarda los valores del editor visual de un tema para un perfil.
pub fn set_theme_settings(
    c: &Connection,
    profile: i64,
    theme: &str,
    values: &serde_json::Value,
) -> rusqlite::Result<()> {
    let cur: String = c.query_row("SELECT theme_settings FROM profiles WHERE id = ?1", [profile], |r| r.get(0))?;
    let mut all: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&cur).unwrap_or_default();
    all.insert(theme.to_string(), values.clone());
    c.execute(
        "UPDATE profiles SET theme_settings = ?2 WHERE id = ?1",
        params![profile, serde_json::Value::Object(all).to_string()],
    )?;
    Ok(())
}

pub fn set_custom_css(c: &Connection, profile: i64, theme: &str, css: &str) -> rusqlite::Result<()> {
    let cur: String = c.query_row("SELECT custom_css FROM profiles WHERE id = ?1", [profile], |r| r.get(0))?;
    let mut all: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&cur).unwrap_or_default();
    if css.trim().is_empty() {
        all.remove(theme);
    } else {
        all.insert(theme.to_string(), serde_json::Value::String(css.to_string()));
    }
    c.execute(
        "UPDATE profiles SET custom_css = ?2 WHERE id = ?1",
        params![profile, serde_json::Value::Object(all).to_string()],
    )?;
    Ok(())
}

// ───────────────────────────── colecciones ─────────────────────────────

pub fn list_collections(c: &Connection, profile: i64) -> rusqlite::Result<Vec<Collection>> {
    let mut st = c.prepare_cached(
        "SELECT id, profile_id, name, kind, rules, position FROM collections WHERE profile_id = ?1 ORDER BY position, id",
    )?;
    let cols: Vec<Collection> = st
        .query_map([profile], |r| {
            let rules: String = r.get(4)?;
            Ok(Collection {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                name: r.get(2)?,
                kind: r.get(3)?,
                rules: serde_json::from_str(&rules).unwrap_or_default(),
                position: r.get(5)?,
                game_ids: vec![],
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut st = c.prepare_cached("SELECT game_id FROM collection_games WHERE collection_id = ?1 ORDER BY pos")?;
    let mut out = vec![];
    for mut col in cols {
        col.game_ids = st.query_map([col.id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        out.push(col);
    }
    Ok(out)
}

/// Colección inteligente «<sistema>» del perfil (la crea si no está): así los
/// temas pueden filtrar por consola con las colecciones que ya enseñan.
pub fn ensure_platform_collection(c: &Connection, profile: i64, name: &str, platform: &str) -> rusqlite::Result<()> {
    let needle = format!("%\"platform\":\"{platform}\"%");
    let have: Option<i64> = c
        .query_row(
            "SELECT id FROM collections WHERE profile_id = ?1 AND kind = 'smart' AND REPLACE(rules, ' ', '') LIKE ?2",
            params![profile, needle],
            |r| r.get(0),
        )
        .optional()?;
    if have.is_none() {
        create_collection(c, profile, name, "smart", &serde_json::json!({ "platform": platform }))?;
    }
    Ok(())
}

pub fn create_collection(
    c: &Connection,
    profile: i64,
    name: &str,
    kind: &str,
    rules: &serde_json::Value,
) -> rusqlite::Result<i64> {
    let pos: i64 = c.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM collections WHERE profile_id = ?1",
        [profile],
        |r| r.get(0),
    )?;
    c.execute(
        "INSERT INTO collections (profile_id, name, kind, rules, position) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![profile, name, kind, rules.to_string(), pos],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn update_collection(
    c: &Connection,
    id: i64,
    name: Option<&str>,
    rules: Option<&serde_json::Value>,
) -> rusqlite::Result<()> {
    if let Some(n) = name {
        c.execute("UPDATE collections SET name = ?2 WHERE id = ?1", params![id, n])?;
    }
    if let Some(r) = rules {
        c.execute("UPDATE collections SET rules = ?2 WHERE id = ?1", params![id, r.to_string()])?;
    }
    Ok(())
}

pub fn delete_collection(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("DELETE FROM collections WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_in_collection(c: &Connection, col: i64, game: i64, member: bool) -> rusqlite::Result<()> {
    if member {
        c.execute(
            "INSERT OR IGNORE INTO collection_games (collection_id, game_id, pos)
             VALUES (?1, ?2, (SELECT COALESCE(MAX(pos), 0) + 1 FROM collection_games WHERE collection_id = ?1))",
            params![col, game],
        )?;
    } else {
        c.execute(
            "DELETE FROM collection_games WHERE collection_id = ?1 AND game_id = ?2",
            params![col, game],
        )?;
    }
    Ok(())
}

// ───────────────────────────── almacenamiento de temas ─────────────────────────────

pub fn theme_storage_get(c: &Connection, profile: i64, theme: &str) -> rusqlite::Result<serde_json::Value> {
    let mut st = c.prepare_cached(
        "SELECT key, value FROM theme_storage WHERE profile_id = ?1 AND theme_id = ?2",
    )?;
    let mut map = serde_json::Map::new();
    let rows = st.query_map(params![profile, theme], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (k, v) = row?;
        map.insert(k, serde_json::from_str(&v).unwrap_or(serde_json::Value::Null));
    }
    Ok(serde_json::Value::Object(map))
}

pub fn theme_storage_set(
    c: &Connection,
    profile: i64,
    theme: &str,
    key: &str,
    value: &serde_json::Value,
) -> rusqlite::Result<()> {
    if value.is_null() {
        c.execute(
            "DELETE FROM theme_storage WHERE profile_id = ?1 AND theme_id = ?2 AND key = ?3",
            params![profile, theme, key],
        )?;
    } else {
        c.execute(
            "INSERT INTO theme_storage (profile_id, theme_id, key, value) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT DO UPDATE SET value = excluded.value",
            params![profile, theme, key, value.to_string()],
        )?;
    }
    Ok(())
}

/// Bytes usados por un tema (sin contar `except`, si se da).
pub fn theme_storage_size(c: &Connection, profile: i64, theme: &str, except: Option<&str>) -> rusqlite::Result<i64> {
    c.query_row(
        "SELECT COALESCE(SUM(LENGTH(key) + LENGTH(value)), 0) FROM theme_storage
         WHERE profile_id = ?1 AND theme_id = ?2 AND (?3 IS NULL OR key <> ?3)",
        params![profile, theme, except],
        |r| r.get(0),
    )
}

// ───────────────────────────── caché de metadatos ─────────────────────────────

pub fn cache_get(c: &Connection, provider: &str, key: &str, max_age_s: i64) -> rusqlite::Result<Option<String>> {
    c.query_row(
        "SELECT json FROM metadata_cache WHERE provider = ?1 AND key = ?2 AND fetched_at > ?3",
        params![provider, key, now() - max_age_s],
        |r| r.get(0),
    )
    .optional()
}

pub fn cache_put(c: &Connection, provider: &str, key: &str, json: &str) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO metadata_cache (provider, key, json, fetched_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
        params![provider, key, json, now()],
    )?;
    Ok(())
}

// ───────────────────────────── descargas ─────────────────────────────

const DOWNLOAD_COLS: &str = "id, source, source_id, slug, title, version, page_url, cover_url, hero_url, magnet,
    info_hash, torrent_name, output_dir, selected_files, file_count, total_bytes, done_bytes, uploaded_bytes,
    state, pause_reason, queue_pos, error, install_size, install_dir, game_id, added_at, completed_at,
    installed_at, files_deleted";

fn download_row(r: &Row) -> rusqlite::Result<DownloadRow> {
    Ok(DownloadRow {
        id: r.get(0)?,
        source: r.get(1)?,
        source_id: r.get(2)?,
        slug: r.get(3)?,
        title: r.get(4)?,
        version: r.get(5)?,
        page_url: r.get(6)?,
        cover_url: r.get(7)?,
        hero_url: r.get(8)?,
        magnet: r.get(9)?,
        info_hash: r.get(10)?,
        torrent_name: r.get(11)?,
        output_dir: r.get(12)?,
        selected_files: r.get::<_, String>(13).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
        file_count: r.get(14)?,
        total_bytes: r.get(15)?,
        done_bytes: r.get(16)?,
        uploaded_bytes: r.get(17)?,
        state: r.get(18)?,
        pause_reason: r.get(19)?,
        queue_pos: r.get(20)?,
        error: r.get(21)?,
        install_size: r.get(22)?,
        install_dir: r.get(23)?,
        game_id: r.get(24)?,
        added_at: r.get(25)?,
        completed_at: r.get(26)?,
        installed_at: r.get(27)?,
        files_deleted: r.get(28)?,
    })
}

/// Todas las descargas, en el orden de la cola.
pub fn list_downloads(c: &Connection) -> rusqlite::Result<Vec<DownloadRow>> {
    let mut st = c.prepare_cached(&format!("SELECT {DOWNLOAD_COLS} FROM downloads ORDER BY queue_pos, id"))?;
    let rows = st.query_map([], download_row)?;
    rows.collect()
}

pub fn get_download(c: &Connection, id: i64) -> rusqlite::Result<Option<DownloadRow>> {
    c.query_row(&format!("SELECT {DOWNLOAD_COLS} FROM downloads WHERE id = ?1"), [id], download_row)
        .optional()
}

pub fn download_by_hash(c: &Connection, info_hash: &str) -> rusqlite::Result<Option<DownloadRow>> {
    c.query_row(&format!("SELECT {DOWNLOAD_COLS} FROM downloads WHERE info_hash = ?1"), [info_hash], download_row)
        .optional()
}

pub fn download_torrent(c: &Connection, id: i64) -> rusqlite::Result<Vec<u8>> {
    c.query_row("SELECT torrent FROM downloads WHERE id = ?1", [id], |r| r.get(0))
}

pub fn insert_download(c: &Connection, d: &NewDownload) -> rusqlite::Result<i64> {
    let pos: i64 = c.query_row("SELECT COALESCE(MAX(queue_pos), 0) + 1 FROM downloads", [], |r| r.get(0))?;
    c.execute(
        "INSERT INTO downloads (source, source_id, slug, title, version, page_url, cover_url, hero_url, magnet,
            info_hash, torrent, torrent_name, output_dir, selected_files, file_count, total_bytes, install_size,
            state, queue_pos, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'queued', ?18, ?19)",
        params![
            d.source,
            d.source_id,
            d.slug,
            d.title,
            d.version,
            d.page_url,
            d.cover_url,
            d.hero_url,
            d.magnet,
            d.info_hash,
            d.torrent,
            d.torrent_name,
            d.output_dir,
            serde_json::to_string(&d.selected_files).unwrap_or_else(|_| "[]".into()),
            d.file_count,
            d.total_bytes,
            d.install_size,
            pos,
            now(),
        ],
    )?;
    Ok(c.last_insert_rowid())
}

/// Cambia el estado. `completed_at` se fija la primera vez que termina.
pub fn set_download_state(c: &Connection, id: i64, state: &str, pause_reason: Option<&str>, error: Option<&str>) -> rusqlite::Result<()> {
    c.execute(
        "UPDATE downloads SET state = ?2, pause_reason = ?3, error = ?4,
            completed_at = CASE WHEN ?2 IN ('seeding', 'completed') AND completed_at IS NULL THEN ?5 ELSE completed_at END
         WHERE id = ?1",
        params![id, state, pause_reason, error, now()],
    )?;
    Ok(())
}

pub fn set_download_progress(c: &Connection, id: i64, done: i64, total: i64, uploaded: i64) -> rusqlite::Result<()> {
    c.execute(
        "UPDATE downloads SET done_bytes = ?2, total_bytes = CASE WHEN ?3 > 0 THEN ?3 ELSE total_bytes END,
            uploaded_bytes = MAX(uploaded_bytes, ?4) WHERE id = ?1",
        params![id, done, total, uploaded],
    )?;
    Ok(())
}

pub fn set_download_install_dir(c: &Connection, id: i64, install_dir: &str) -> rusqlite::Result<()> {
    c.execute("UPDATE downloads SET install_dir = ?2 WHERE id = ?1", params![id, install_dir])?;
    Ok(())
}

pub fn set_download_installed(c: &Connection, id: i64, install_dir: &str, game_id: Option<i64>) -> rusqlite::Result<()> {
    c.execute(
        "UPDATE downloads SET state = 'installed', pause_reason = NULL, error = NULL, install_dir = ?2, game_id = ?3,
            installed_at = ?4 WHERE id = ?1",
        params![id, install_dir, game_id, now()],
    )?;
    Ok(())
}

pub fn set_download_files_deleted(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("UPDATE downloads SET files_deleted = 1 WHERE id = ?1", [id])?;
    Ok(())
}

/// Mueve una descarga a la posición `pos` (0 = primera) y renumera la cola.
pub fn move_download(c: &mut Connection, id: i64, pos: usize) -> rusqlite::Result<()> {
    let tx = c.transaction()?;
    let mut ids: Vec<i64> = {
        let mut st = tx.prepare("SELECT id FROM downloads ORDER BY queue_pos, id")?;
        let rows = st.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    if let Some(i) = ids.iter().position(|x| *x == id) {
        ids.remove(i);
        ids.insert(pos.min(ids.len()), id);
    }
    for (i, d) in ids.iter().enumerate() {
        tx.execute("UPDATE downloads SET queue_pos = ?2 WHERE id = ?1", params![d, i as i64 + 1])?;
    }
    tx.commit()
}

pub fn delete_download(c: &Connection, id: i64) -> rusqlite::Result<()> {
    c.execute("DELETE FROM downloads WHERE id = ?1", [id])?;
    Ok(())
}

/// Juegos instalados, para marcar en Explorar lo que ya tienes: (id, título, source, source_id).
pub fn library_titles(c: &Connection) -> rusqlite::Result<Vec<(i64, String, String, String)>> {
    let mut st = c.prepare_cached("SELECT id, title, source, source_id FROM games WHERE missing = 0 AND installed = 1")?;
    let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn upsert_and_library() {
        let db = Db::memory().unwrap();
        db.with(|c| {
            let pid = create_profile(c, "Yo", "#fff", "steam")?;
            let g = NewGame {
                title: "Hollow Knight".into(),
                source: "folder".into(),
                source_id: "c:\\games\\hollow knight".into(),
                install_dir: Some("C:\\Games\\Hollow Knight".into()),
                exe_path: Some("C:\\Games\\Hollow Knight\\hollow_knight.exe".into()),
                ..Default::default()
            };
            let (id, new) = upsert_game(c, &g)?.unwrap();
            assert!(new);
            let (id2, new2) = upsert_game(c, &g)?.unwrap();
            assert_eq!(id, id2);
            assert!(!new2);

            // Un juego a mano en ese directorio: el escáner ya no lo duplica.
            let m = NewGame {
                title: "Hollow Knight".into(),
                source: "manual".into(),
                source_id: r"c:\games\hollow knight\hollow_knight.exe".into(),
                install_dir: Some(r"c:\games\hollow knight".into()),
                ..Default::default()
            };
            c.execute("DELETE FROM games WHERE id = ?1", [id])?;
            let (id, _) = upsert_game(c, &m)?.unwrap();
            assert!(upsert_game(c, &g)?.is_none());

            set_favorite(c, pid, id, true)?;
            record_session(c, pid, id, 100, 400)?;
            let lib = library(c, pid)?;
            assert_eq!(lib.len(), 1);
            assert!(lib[0].favorite);
            assert_eq!(lib[0].playtime, 300);
            assert_eq!(lib[0].source, "manual");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn store_games_become_folder_games_or_go() {
        let db = Db::memory().unwrap();
        db.with(|c| {
            let pid = create_profile(c, "Yo", "#fff", "steam")?;
            let lib = add_folder(c, r"E:\Juegos", "subfolders")?;
            add_folder(c, r"D:\Solo", "single")?;
            let ins = |source: &str, sid: &str, dir: Option<&str>, installed: bool| -> rusqlite::Result<i64> {
                c.execute(
                    "INSERT INTO games (title, sort_title, source, source_id, install_dir, launch_uri, installed, added_at, updated_at)
                     VALUES (?1, ?1, ?2, ?3, ?4, 'x://run', ?5, 0, 0)",
                    params![sid, source, sid, dir, installed],
                )?;
                Ok(c.last_insert_rowid())
            };
            // Dentro de la biblioteca: pasa a ser de carpeta, con sus horas.
            let hades = ins("epic", "Hades", Some(r"E:\Juegos\Hades"), true)?;
            record_session(c, pid, hades, 0, 3600)?;
            // Dos niveles por debajo (carpeta de colección): también.
            let deep = ins("gog", "Deep", Some(r"E:\Juegos\Pack\Deep"), true)?;
            // La carpeta «un juego» exacta: también.
            let solo = ins("ea", "Solo", Some(r"D:\Solo"), true)?;
            // Ya había uno de carpeta en ese directorio: se funden.
            let twin_store = ins("steam", "620", Some(r"E:\Juegos\Portal 2"), true)?;
            record_session(c, pid, twin_store, 0, 60)?;
            c.execute(
                "INSERT INTO games (title, sort_title, source, source_id, install_dir, added_at, updated_at)
                 VALUES ('Portal 2', 'portal 2', 'folder', 'e:\\juegos\\portal 2', 'E:\\Juegos\\Portal 2', 0, 0)",
                [],
            )?;
            let twin = c.last_insert_rowid();
            // Fuera de la biblioteca, sin instalar o demasiado hondo: se quitan.
            let steam_lib = ins("steam", "70", Some(r"C:\Steam\steamapps\common\Half-Life"), true)?;
            let owned = ins("steam", "400", None, false)?;
            let too_deep = ins("steam", "10", Some(r"E:\Juegos\a\b\c"), true)?;

            migrate_local_only(c)?;

            let g = get_game(c, hades)?;
            assert_eq!((g.source.as_str(), g.source_id.as_str(), g.folder_id, g.launch_uri), ("folder", r"e:\juegos\hades", Some(lib), None));
            assert_eq!(get_game(c, deep)?.source, "folder");
            assert_eq!(get_game(c, solo)?.source, "folder");
            assert!(get_game(c, twin_store).is_err());
            assert_eq!(library(c, pid)?.iter().find(|x| x.id == twin).unwrap().playtime, 60);
            assert_eq!(library(c, pid)?.iter().find(|x| x.id == hades).unwrap().playtime, 3600);
            for id in [steam_lib, owned, too_deep] {
                assert!(get_game(c, id).is_err());
            }
            let rest: i64 = c.query_row("SELECT COUNT(*) FROM games WHERE source NOT IN ('folder', 'manual', 'repack')", [], |r| r.get(0))?;
            assert_eq!(rest, 0);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn theme_storage_overwrite_not_double_counted() {
        let db = Db::memory().unwrap();
        db.with(|c| {
            let pid = create_profile(c, "Yo", "#fff", "steam")?;
            theme_storage_set(c, pid, "t", "a", &serde_json::json!("x".repeat(1000)))?;
            theme_storage_set(c, pid, "t", "b", &serde_json::json!("y"))?;
            let all = theme_storage_size(c, pid, "t", None)?;
            let without_a = theme_storage_size(c, pid, "t", Some("a"))?;
            assert!(all > 1000 && without_a < 10);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn patch_locks_fields() {
        let db = Db::memory().unwrap();
        db.with(|c| {
            let (id, _) = upsert_game(
                c,
                &NewGame { title: "x".into(), source: "manual".into(), source_id: "1".into(), ..Default::default() },
            )?
            .unwrap();
            update_game(c, id, &GamePatch { title: Some("Mi Juego".into()), ..Default::default() })?;
            let g = get_game(c, id)?;
            assert_eq!(g.title, "Mi Juego");
            assert!(g.meta_locked.contains(&"title".to_string()));
            Ok(())
        })
        .unwrap();
    }
}
