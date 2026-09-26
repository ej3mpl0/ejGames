//! Logros de juegos sin launcher (solo el .exe) que traen un emulador de la API
//! de Steam. Cada emulador guarda los desbloqueos en su propio fichero:
//! - INI por secciones (CODEX, RUNE, OnlineFix…): `[ACH_X] Achieved=1 UnlockTime=…`
//! - INI por listas: `[Achievements] ACH_X=1` + `[AchievementsUnlockTimes] ACH_X=…`
//! - JSON (Goldberg, GSE…): `{"ACH_X": {"earned": true, "earned_time": …}}`
//!
//! El appid sale de la configuración del emulador (`steam_appid.txt`,
//! `steam_emu.ini`, `OnlineFix.ini`…) y los ficheros se buscan en las carpetas
//! conocidas + la carpeta del juego + las que añada el usuario.

use super::Def;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Carpetas raíz donde cada emulador crea `<appid>\…`.
pub fn roots(extra: &[String]) -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let public = env("PUBLIC").unwrap_or_else(|| PathBuf::from("C:\\Users\\Public"));
    let appdata = dirs::config_dir();
    let local = dirs::data_local_dir();
    let docs = dirs::document_dir();
    let mut out = vec![
        public.join("Documents").join("Steam").join("CODEX"),
        public.join("Documents").join("Steam").join("RUNE"),
        public.join("Documents").join("OnlineFix"),
        public.join("Documents").join("EMPRESS"),
    ];
    if let Some(a) = appdata {
        for n in ["Steam\\CODEX", "Goldberg SteamEmu Saves", "GSE Saves", "EMPRESS", "SmartSteamEmu", "CreamAPI"] {
            out.push(a.join(n));
        }
    }
    if let Some(l) = local {
        out.push(l.join("SKIDROW"));
    }
    if let Some(d) = docs {
        out.push(d.join("SKIDROW"));
    }
    out.extend(extra.iter().filter(|s| !s.trim().is_empty()).map(PathBuf::from));
    out
}

fn is_ach_file(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    matches!(n.as_str(), "achievements.ini" | "achievements.json" | "achiev.ini" | "achievement.ini")
}

/// Ficheros de logros existentes bajo `<root>\<appid>` (hasta 4 niveles).
pub fn find_in_roots(appid: i64, roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = vec![];
    for r in roots {
        let dir = r.join(appid.to_string());
        if !dir.is_dir() {
            continue;
        }
        for e in walkdir::WalkDir::new(&dir).max_depth(4).into_iter().filter_map(Result::ok) {
            if e.file_type().is_file() && is_ach_file(&e.file_name().to_string_lossy()) {
                out.push(e.into_path());
            }
        }
    }
    out
}

/// Lo que se encuentra en la carpeta del juego.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct InstallScan {
    pub appid: Option<i64>,
    /// Ficheros de desbloqueos (saves locales del emulador).
    pub files: Vec<PathBuf>,
    /// Esquema que trae el emulador (`steam_settings/achievements.json`).
    pub schema: Option<PathBuf>,
}

const SKIP_DIRS: &[&str] = &["_commonredist", "redist", "directx", "vcredist", "__installer", "movies", "videos", "paks", "content"];

pub fn scan_install(dir: &Path) -> InstallScan {
    let mut s = InstallScan::default();
    let mut real_appid: Option<i64> = None;
    let mut ini_appid: Option<i64> = None;
    let mut txt_appid: Option<i64> = None;
    let walker = walkdir::WalkDir::new(dir).max_depth(8).into_iter().filter_entry(|e| {
        !(e.file_type().is_dir() && e.depth() > 0 && SKIP_DIRS.contains(&e.file_name().to_string_lossy().to_ascii_lowercase().as_str()))
    });
    for e in walker.filter_map(Result::ok).take(20_000) {
        if !e.file_type().is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_ascii_lowercase();
        let path = e.path();
        match name.as_str() {
            "steam_appid.txt" if txt_appid.is_none() => {
                txt_appid = std::fs::read_to_string(path).ok().and_then(|t| t.trim().parse().ok()).filter(|v: &i64| *v > 0);
            }
            "achievements.json" if in_settings_dir(path) => {
                if s.schema.is_none() {
                    s.schema = Some(path.to_path_buf());
                }
            }
            n if is_ach_file(n) => s.files.push(path.to_path_buf()),
            "steam_emu.ini" | "onlinefix.ini" | "onlinefix64.ini" | "cream_api.ini" | "smartsteamemu.ini" | "codex.ini"
            | "rune.ini" | "empress.ini" | "ali213.ini" | "valve.ini" | "steam_api.ini" | "configs.app.ini" => {
                if let Ok(t) = std::fs::read(path) {
                    let t = String::from_utf8_lossy(&t);
                    let (real, any) = ini_appids(&t);
                    real_appid = real_appid.or(real);
                    ini_appid = ini_appid.or(any);
                }
            }
            _ => {}
        }
    }
    s.appid = real_appid.or(ini_appid).or(txt_appid);
    s
}

fn in_settings_dir(p: &Path) -> bool {
    p.parent()
        .and_then(|d| d.file_name())
        .map(|n| n.to_string_lossy().eq_ignore_ascii_case("steam_settings"))
        .unwrap_or(false)
}

/// (RealAppId, AppId) de un INI de emulador.
fn ini_appids(t: &str) -> (Option<i64>, Option<i64>) {
    let mut real = None;
    let mut any = None;
    for line in t.lines() {
        let Some((k, v)) = line.split_once('=') else { continue };
        let k = k.trim().to_ascii_lowercase();
        let v: Option<i64> = v.trim().trim_matches('"').parse().ok().filter(|v: &i64| *v > 0);
        match k.as_str() {
            "realappid" => real = real.or(v),
            "appid" | "app_id" | "gameid" => any = any.or(v),
            _ => {}
        }
    }
    (real, any)
}

fn norm_time(t: i64) -> i64 {
    match t {
        t if t > 100_000_000_000 => t / 1000, // milisegundos
        t if t > 0 => t,
        _ => 0,
    }
}

fn truthy(v: &str) -> bool {
    let v = v.trim().trim_matches('"').to_ascii_lowercase();
    v == "1" || v == "true" || v == "yes"
}

fn parse_ini(t: &str) -> Vec<(String, i64)> {
    let mut sections: Vec<(String, HashMap<String, String>)> = vec![];
    for raw in t.lines() {
        let line = raw.trim().trim_start_matches('\u{feff}');
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            sections.push((name.trim().to_string(), HashMap::new()));
            continue;
        }
        if let (Some((_, map)), Some((k, v))) = (sections.last_mut(), line.split_once('=')) {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    let mut out: HashMap<String, i64> = HashMap::new();
    let mut times: HashMap<String, i64> = HashMap::new();
    for (name, map) in &sections {
        let lower = name.to_ascii_lowercase();
        match lower.as_str() {
            "steamachievements" | "stats" | "steam" | "settings" | "steamstats" => {}
            // Formato por listas.
            "achievements" | "achievement" => {
                for (k, v) in map {
                    // "ACH=1" o "ACH=1@1700000000"
                    let (flag, t) = v.split_once('@').unwrap_or((v.as_str(), "0"));
                    if truthy(flag) {
                        out.insert(k.clone(), norm_time(t.trim().parse().unwrap_or(0)));
                    }
                }
            }
            "achievementsunlocktimes" | "unlocktimes" => {
                for (k, v) in map {
                    times.insert(k.clone(), norm_time(v.trim().parse().unwrap_or(0)));
                }
            }
            // Formato por secciones: [ACH_X] Achieved=1 UnlockTime=…
            _ => {
                let get = |keys: &[&str]| map.iter().find(|(k, _)| keys.iter().any(|x| k.eq_ignore_ascii_case(x))).map(|(_, v)| v.as_str());
                let Some(flag) = get(&["Achieved", "achieved", "State", "Unlocked", "earned"]) else { continue };
                if truthy(flag) {
                    let t = get(&["UnlockTime", "unlocktime", "timestamp", "Time", "earned_time"]).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
                    out.insert(name.clone(), norm_time(t));
                }
            }
        }
    }
    for (k, t) in times {
        if let Some(v) = out.get_mut(&k) {
            if *v == 0 {
                *v = t;
            }
        }
    }
    out.into_iter().collect()
}

fn json_flag(o: &serde_json::Map<String, Value>) -> Option<bool> {
    for k in ["earned", "achieved", "Achieved", "unlocked", "State"] {
        match o.get(k) {
            Some(Value::Bool(b)) => return Some(*b),
            Some(Value::Number(n)) => return Some(n.as_i64().unwrap_or(0) != 0),
            Some(Value::String(s)) => return Some(truthy(s)),
            _ => {}
        }
    }
    None
}

fn json_time(o: &serde_json::Map<String, Value>) -> i64 {
    for k in ["earned_time", "unlocktime", "UnlockTime", "unlock_time", "time", "timestamp"] {
        if let Some(t) = o.get(k).and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))) {
            return norm_time(t);
        }
    }
    0
}

fn parse_json(v: &Value) -> Vec<(String, i64)> {
    let mut out = vec![];
    match v {
        Value::Object(m) => {
            // Envoltorio {"achievements": {...}}
            if let Some(inner) = m.iter().find(|(k, _)| k.eq_ignore_ascii_case("achievements")).map(|(_, v)| v) {
                if inner.is_object() || inner.is_array() {
                    return parse_json(inner);
                }
            }
            for (k, e) in m {
                if let Value::Object(o) = e {
                    if json_flag(o) == Some(true) {
                        out.push((k.clone(), json_time(o)));
                    }
                }
            }
        }
        Value::Array(items) => {
            for e in items {
                let Value::Object(o) = e else { continue };
                let Some(name) = o.get("name").or_else(|| o.get("apiname")).and_then(Value::as_str) else { continue };
                if json_flag(o) == Some(true) {
                    out.push((name.to_string(), json_time(o)));
                }
            }
        }
        _ => {}
    }
    out
}

/// Desbloqueos de un fichero. `None` si no se puede leer o no se entiende
/// (p. ej. se está escribiendo); así no se pisa el estado anterior.
pub fn parse_file(path: &Path) -> Option<Vec<(String, i64)>> {
    let bytes = std::fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let body = text.trim_start_matches('\u{feff}');
    let is_json = path.extension().map(|e| e.eq_ignore_ascii_case("json")).unwrap_or(false);
    // Un INI también empieza por "[": JSON solo si parsea.
    match serde_json::from_str::<Value>(body) {
        Ok(v) if v.is_object() || v.is_array() => Some(parse_json(&v)),
        _ if is_json => None, // JSON a medio escribir
        _ => Some(parse_ini(body)),
    }
}

/// Esquema de `steam_settings/achievements.json` (Goldberg / GSE):
/// `[{"name", "displayName", "description", "hidden", "icon", "icongray"}]`.
pub fn goldberg_schema(path: &Path, lang: &str) -> Vec<Def> {
    let Ok(t) = std::fs::read_to_string(path) else { return vec![] };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')) else { return vec![] };
    let text = |v: Option<&Value>| -> Option<String> {
        match v? {
            Value::String(s) => Some(s.clone()),
            Value::Object(m) => m.get(lang).or_else(|| m.get("english")).or_else(|| m.values().next()).and_then(Value::as_str).map(str::to_string),
            _ => None,
        }
    };
    items
        .iter()
        .filter_map(|e| {
            let api = e.get("name")?.as_str()?.to_string();
            Some(Def {
                name: text(e.get("displayName")).filter(|s| !s.is_empty()).unwrap_or_else(|| super::pretty_name(&api)),
                description: text(e.get("description")).filter(|s| !s.is_empty()),
                hidden: match e.get("hidden") {
                    Some(Value::String(s)) => truthy(s),
                    Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
                    Some(Value::Bool(b)) => *b,
                    _ => false,
                },
                // Iconos locales (rutas relativas): no se sirven.
                icon: None,
                icon_gray: None,
                global_pct: None,
                api_name: api,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ini_sections_rune() {
        let t = "[ACH_FIRST_JOB_DONE]\nAchieved=1\nCurProgress=0\nMaxProgress=0\nUnlockTime=1786905791\n\
                 [ACH_LOCKED]\nAchieved=0\nUnlockTime=0\n\
                 [SteamAchievements]\n00000=ACH_FIRST_STEPS\nCount=3\n";
        let mut v = parse_ini(t);
        v.sort();
        assert_eq!(v, vec![("ACH_FIRST_JOB_DONE".to_string(), 1786905791)]);
    }

    #[test]
    fn ini_file_starting_with_bracket() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("achievements.ini");
        std::fs::write(&f, "[CHARMED]\nAchieved=1\nUnlockTime=1758800000\n").unwrap();
        assert_eq!(parse_file(&f), Some(vec![("CHARMED".to_string(), 1758800000)]));
        let j = d.path().join("achievements.json");
        std::fs::write(&j, "{\"A\": {\"earned\": tr").unwrap();
        assert_eq!(parse_file(&j), None);
    }

    #[test]
    fn ini_lists() {
        let t = "[Achievements]\nACH_A=1\nACH_B=0\nACH_C=1@1700000000\n[AchievementsUnlockTimes]\nACH_A=1690000000\n";
        let mut v = parse_ini(t);
        v.sort();
        assert_eq!(v, vec![("ACH_A".to_string(), 1690000000), ("ACH_C".to_string(), 1700000000)]);
    }

    #[test]
    fn json_goldberg() {
        let v: Value = serde_json::from_str(r#"{"ACH_A":{"earned":true,"earned_time":1700000000},"ACH_B":{"earned":false,"earned_time":0}}"#).unwrap();
        assert_eq!(parse_json(&v), vec![("ACH_A".to_string(), 1700000000)]);
        let arr: Value = serde_json::from_str(r#"[{"name":"X","achieved":1,"unlocktime":1700000000000}]"#).unwrap();
        assert_eq!(parse_json(&arr), vec![("X".to_string(), 1700000000)]);
    }

    #[test]
    fn install_scan_and_schema() {
        let d = tempfile::tempdir().unwrap();
        let s = d.path().join("steam_settings");
        std::fs::create_dir_all(&s).unwrap();
        std::fs::write(d.path().join("steam_appid.txt"), "480\n").unwrap();
        std::fs::write(d.path().join("OnlineFix.ini"), "[Main]\nRealAppId=3167920\nFakeAppId=480\n").unwrap();
        std::fs::write(
            s.join("achievements.json"),
            r#"[{"name":"ACH_A","displayName":{"english":"First","spanish":"Primero"},"description":"d","hidden":"1"}]"#,
        )
        .unwrap();
        std::fs::write(d.path().join("achievements.ini"), "[ACH_A]\nAchieved=1\n").unwrap();
        let r = scan_install(d.path());
        assert_eq!(r.appid, Some(3167920));
        assert_eq!(r.files.len(), 1);
        let defs = goldberg_schema(r.schema.as_ref().unwrap(), "spanish");
        assert_eq!(defs[0].name, "Primero");
        assert!(defs[0].hidden);
    }
}
