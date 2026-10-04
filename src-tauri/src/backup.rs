//! Copias de seguridad de ejGames: biblioteca (horas, logros, perfiles, notas,
//! colecciones…), ajustes, temas propios y arte, en un .zip.
//!
//! Restaurar no puede pisar la base de datos abierta: se descomprime en
//! `.restore/` y se aplica al arrancar, antes de abrirla (`apply_pending`).
//! Lo que había se guarda en `.before-restore/` por si acaso.
//!
//! Copias automáticas: en la carpeta elegida (una de OneDrive o Drive sirve para
//! llevarlas a otro PC), como mucho una al día, guardando las últimas N.

use crate::paths::Paths;
use crate::state::AppState;
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MANIFEST: &str = "ejgames-backup.json";
const RESTORE_DIR: &str = ".restore";
const BEFORE_DIR: &str = ".before-restore";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub app: String,
    pub version: String,
    /// Segundos Unix.
    pub created: i64,
    /// Nombre del PC donde se hizo.
    pub pc: String,
    pub games: i64,
    pub profiles: i64,
    #[serde(default)]
    pub with_media: bool,
    /// Ruta del .zip (al listar o inspeccionar).
    #[serde(default, skip_deserializing)]
    pub path: String,
    #[serde(default, skip_deserializing)]
    pub size: u64,
}

pub fn pc_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into())
}

fn add_dir(zip: &mut zip::ZipWriter<std::fs::File>, dir: &Path, prefix: &str, stored: bool) -> anyhow::Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    let method = if stored { zip::CompressionMethod::Stored } else { zip::CompressionMethod::Deflated };
    let opts = zip::write::SimpleFileOptions::default().compression_method(method).large_file(true);
    for e in walkdir::WalkDir::new(dir).into_iter().filter_map(Result::ok) {
        if !e.file_type().is_file() {
            continue;
        }
        let rel = e.path().strip_prefix(dir)?.to_string_lossy().replace('\\', "/");
        zip.start_file(format!("{prefix}/{rel}"), opts)?;
        std::io::copy(&mut std::fs::File::open(e.path())?, zip)?;
    }
    Ok(())
}

/// Crea la copia en `dest` (un .zip).
pub fn create(db: &crate::db::Db, paths: &Paths, dest: &Path, with_media: bool) -> anyhow::Result<BackupInfo> {
    let tmp_db = paths.root.join("backup-tmp.db");
    let _ = std::fs::remove_file(&tmp_db);
    // Copia coherente aunque la base esté en uso (WAL incluido).
    db.with(|c| c.execute("VACUUM INTO ?1", [tmp_db.to_string_lossy()]))?;
    let (games, profiles) = db.with(|c| {
        Ok((
            c.query_row("SELECT COUNT(*) FROM games", [], |r| r.get::<_, i64>(0))?,
            c.query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get::<_, i64>(0))?,
        ))
    })?;
    let info = BackupInfo {
        app: "ejGames".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        created: chrono::Utc::now().timestamp(),
        pc: pc_name(),
        games,
        profiles,
        with_media,
        path: dest.to_string_lossy().into(),
        size: 0,
    };
    let part = dest.with_extension("zip.part");
    let r = (|| -> anyhow::Result<()> {
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&part)?);
        let deflate = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file(MANIFEST, deflate)?;
        zip.write_all(&serde_json::to_vec_pretty(&info)?)?;
        zip.start_file("library.db", deflate.large_file(true))?;
        std::io::copy(&mut std::fs::File::open(&tmp_db)?, &mut zip)?;
        if paths.settings.exists() {
            zip.start_file("settings.json", deflate)?;
            zip.write_all(&std::fs::read(&paths.settings)?)?;
        }
        add_dir(&mut zip, &paths.user_themes, "themes", false)?;
        if with_media {
            // Las imágenes ya van comprimidas: se guardan tal cual (mucho más rápido).
            add_dir(&mut zip, &paths.media, "media", true)?;
        }
        zip.finish()?;
        Ok(())
    })();
    let _ = std::fs::remove_file(&tmp_db);
    if let Err(e) = r {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    std::fs::rename(&part, dest)?;
    let mut info = info;
    info.size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    Ok(info)
}

/// Lee el manifiesto de una copia (y comprueba que es de ejGames).
pub fn inspect(file: &Path) -> anyhow::Result<BackupInfo> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(file)?).context(crate::i18n::t("No es una copia de ejGames"))?;
    let mut s = String::new();
    z.by_name(MANIFEST)
        .map_err(|_| anyhow::anyhow!("{}", crate::i18n::t("No es una copia de ejGames")))?
        .read_to_string(&mut s)?;
    let mut info: BackupInfo = serde_json::from_str(&s)?;
    if info.app != "ejGames" || z.by_name("library.db").is_err() {
        anyhow::bail!("{}", crate::i18n::t("No es una copia de ejGames"));
    }
    info.path = file.to_string_lossy().into();
    info.size = std::fs::metadata(file).map(|m| m.len()).unwrap_or(0);
    Ok(info)
}

/// Descomprime la copia en `.restore/`; se aplica al reiniciar.
pub fn stage_restore(paths: &Paths, file: &Path) -> anyhow::Result<BackupInfo> {
    let info = inspect(file)?;
    let dir = paths.root.join(RESTORE_DIR);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let mut z = zip::ZipArchive::new(std::fs::File::open(file)?)?;
    for i in 0..z.len() {
        let mut f = z.by_index(i)?;
        let Some(rel) = f.enclosed_name() else { continue };
        let out = dir.join(rel);
        if f.is_dir() {
            std::fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::io::copy(&mut f, &mut std::fs::File::create(&out)?)?;
    }
    // Marca de «completo»: sin ella (corte a medias) no se aplica nada.
    std::fs::write(dir.join("ok"), b"1")?;
    Ok(info)
}

/// Al arrancar, antes de abrir la base: aplica una restauración pendiente.
pub fn apply_pending(paths: &Paths) {
    let dir = paths.root.join(RESTORE_DIR);
    if !dir.join("ok").exists() {
        if dir.exists() {
            let _ = std::fs::remove_dir_all(&dir);
        }
        return;
    }
    let before = paths.root.join(BEFORE_DIR);
    let _ = std::fs::remove_dir_all(&before);
    let _ = std::fs::create_dir_all(&before);
    let db = paths.db.to_string_lossy().to_string();
    // Lo actual, a un lado (la base con su WAL: si no, SQLite mezclaría la vieja).
    for (from, name) in [
        (PathBuf::from(&db), "library.db"),
        (PathBuf::from(format!("{db}-wal")), "library.db-wal"),
        (PathBuf::from(format!("{db}-shm")), "library.db-shm"),
        (paths.settings.clone(), "settings.json"),
    ] {
        if from.exists() {
            let _ = std::fs::rename(&from, before.join(name));
        }
    }
    let _ = std::fs::rename(dir.join("library.db"), &paths.db);
    if dir.join("settings.json").exists() {
        let _ = std::fs::rename(dir.join("settings.json"), &paths.settings);
    }
    if dir.join("themes").is_dir() {
        let _ = std::fs::rename(&paths.user_themes, before.join("themes"));
        let _ = std::fs::rename(dir.join("themes"), &paths.user_themes);
    }
    if dir.join("media").is_dir() {
        // El arte se suma al que ya hay (direccionado por contenido: no choca).
        for e in walkdir::WalkDir::new(dir.join("media")).into_iter().filter_map(Result::ok) {
            if !e.file_type().is_file() {
                continue;
            }
            if let Ok(rel) = e.path().strip_prefix(dir.join("media")) {
                let to = paths.media.join(rel);
                if !to.exists() {
                    if let Some(p) = to.parent() {
                        let _ = std::fs::create_dir_all(p);
                    }
                    let _ = std::fs::rename(e.path(), &to);
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    tracing::info!("copia de seguridad restaurada");
}

/// Nombre de las copias automáticas: ejGames-<PC>-<fecha>.zip.
fn auto_name() -> String {
    let now = chrono::Local::now().format("%Y-%m-%d_%H%M");
    let pc: String = pc_name().chars().filter(|c| c.is_alphanumeric() || *c == '-').collect();
    format!("ejGames-{pc}-{now}.zip")
}

/// Copias de una carpeta, la más nueva primero.
pub fn list(dir: &Path) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("zip")))
        .filter_map(|e| inspect(&e.path()).ok())
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

/// Copia automática si toca (como mucho una al día) y limpieza de las viejas.
pub fn auto_if_due(st: &Arc<AppState>) {
    let s = st.settings.get();
    if !s.backup_auto || s.backup_dir.trim().is_empty() {
        return;
    }
    let now = chrono::Utc::now().timestamp();
    if now - s.backup_last < 20 * 3600 {
        return;
    }
    let dir = PathBuf::from(&s.backup_dir);
    match create(&st.db, &st.paths, &dir.join(auto_name()), s.backup_media) {
        Ok(info) => {
            tracing::info!("copia automática: {} ({} MB)", info.path, info.size / 1_048_576);
            let _ = st.settings.update(|x| {
                x.backup_last = now;
                x.backup_seen = x.backup_seen.max(info.created);
            });
            prune(&dir, s.backup_keep.max(1) as usize);
        }
        Err(e) => tracing::warn!("copia automática: {e:#}"),
    }
}

/// Deja las `keep` copias más nuevas de este PC (las de otros PC no se tocan).
fn prune(dir: &Path, keep: usize) {
    let pc = pc_name();
    for old in list(dir).into_iter().filter(|b| b.pc == pc).skip(keep) {
        let _ = std::fs::remove_file(&old.path);
    }
}

/// Copia más nueva de OTRO PC en la carpeta de copias que aún no se ha visto
/// (para ofrecer restaurarla: así se pasa la biblioteca de un PC a otro).
pub fn newer_from_other_pc(st: &AppState) -> Option<BackupInfo> {
    let s = st.settings.get();
    if s.backup_dir.trim().is_empty() {
        return None;
    }
    let pc = pc_name();
    list(Path::new(&s.backup_dir)).into_iter().find(|b| b.pc != pc && b.created > s.backup_seen)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths_in(root: &Path) -> Paths {
        let p = Paths {
            db: root.join("library.db"),
            settings: root.join("settings.json"),
            media: root.join("cache").join("media"),
            trailers: root.join("cache").join("trailers"),
            user_themes: root.join("themes"),
            builtin_themes: root.join("builtin"),
            sdk: root.join("sdk"),
            logs: root.join("logs"),
            portable: false,
            root: root.to_path_buf(),
        };
        std::fs::create_dir_all(&p.media).unwrap();
        std::fs::create_dir_all(&p.user_themes).unwrap();
        p
    }

    #[test]
    fn create_modify_restore_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths_in(dir.path());
        {
            let db = crate::db::Db::open(&paths.db).unwrap();
            db.with(|c| c.execute("INSERT INTO profiles (name, color, theme_id, created_at) VALUES ('Ana', '#fff', 'steam', 1)", [])).ok();
            std::fs::write(&paths.settings, br#"{"uiLanguage":"en"}"#).unwrap();
            std::fs::create_dir_all(paths.user_themes.join("mio")).unwrap();
            std::fs::write(paths.user_themes.join("mio").join("theme.json"), b"{}").unwrap();
            std::fs::write(paths.media.join("a.png"), b"png").unwrap();
            let zip = dir.path().join("copia.zip");
            let info = create(&db, &paths, &zip, true).unwrap();
            assert!(info.with_media && info.size > 0);
            assert_eq!(inspect(&zip).unwrap().pc, pc_name());

            // Después de la copia: ajustes distintos, perfil nuevo y un tema que sobra.
            std::fs::write(&paths.settings, br#"{"uiLanguage":"es"}"#).unwrap();
            db.with(|c| c.execute("INSERT INTO profiles (name, color, theme_id, created_at) VALUES ('Beto', '#000', 'steam', 2)", [])).ok();
            std::fs::create_dir_all(paths.user_themes.join("otro")).unwrap();
            std::fs::write(paths.user_themes.join("otro").join("theme.json"), b"{}").unwrap();
            stage_restore(&paths, &zip).unwrap();
        }
        // «Reinicio»: se aplica antes de abrir la base.
        apply_pending(&paths);
        let db = crate::db::Db::open(&paths.db).unwrap();
        let names: Vec<String> = db
            .with(|c| {
                let mut q = c.prepare("SELECT name FROM profiles ORDER BY id")?;
                let v = q.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
                Ok(v)
            })
            .unwrap();
        assert_eq!(names, vec!["Ana".to_string()]);
        assert!(std::fs::read_to_string(&paths.settings).unwrap().contains("\"en\""));
        assert!(paths.user_themes.join("mio").join("theme.json").exists());
        assert!(!paths.user_themes.join("otro").exists());
        assert!(dir.path().join(BEFORE_DIR).join("library.db").exists());
        assert!(!dir.path().join(RESTORE_DIR).exists());
    }

    #[test]
    fn incomplete_restore_is_discarded() {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths_in(dir.path());
        std::fs::write(&paths.settings, b"{}").unwrap();
        std::fs::create_dir_all(dir.path().join(RESTORE_DIR)).unwrap();
        std::fs::write(dir.path().join(RESTORE_DIR).join("settings.json"), b"basura").unwrap();
        apply_pending(&paths);
        assert_eq!(std::fs::read(&paths.settings).unwrap(), b"{}");
        assert!(!dir.path().join(RESTORE_DIR).exists());
    }

    #[test]
    fn not_a_backup_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("x.zip");
        std::fs::write(&f, b"no soy un zip").unwrap();
        assert!(inspect(&f).is_err());
    }

    #[test]
    fn auto_names_are_zip_files() {
        let n = auto_name();
        assert!(n.starts_with("ejGames-") && n.ends_with(".zip"));
    }
}
