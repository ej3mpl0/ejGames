//! Logros guardados por el cliente de Steam, sin clave ni red:
//! - `appcache/stats/UserGameStatsSchema_<appid>.bin`: esquema (stat → bits → logro).
//! - `appcache/stats/UserGameStats_<account>_<appid>.bin`: por stat, `data` es un
//!   campo de bits (bit n = logro desbloqueado) y `AchievementTimes` sus fechas.

use super::kv::{self, Kv};
use super::Def;
use std::path::{Path, PathBuf};

pub struct SchemaBit {
    pub stat: String,
    pub bit: u32,
    pub def: Def,
}

fn stats_dir(root: &Path) -> PathBuf {
    root.join("appcache").join("stats")
}

pub fn user_stats_file(root: &Path, account: u32, appid: i64) -> PathBuf {
    stats_dir(root).join(format!("UserGameStats_{account}_{appid}.bin"))
}

pub fn schema_file(root: &Path, appid: i64) -> PathBuf {
    stats_dir(root).join(format!("UserGameStatsSchema_{appid}.bin"))
}

/// Texto localizado: idioma pedido → inglés → el primero que haya.
fn localized(v: Option<&Kv>, lang: &str) -> Option<String> {
    match v? {
        Kv::Str(s) => Some(s.clone()),
        o @ Kv::Obj(_) => o
            .get(lang)
            .or_else(|| o.get("english"))
            .and_then(Kv::as_str)
            .map(str::to_string)
            .or_else(|| o.entries().find(|(k, _)| k.as_str() != "token").and_then(|(_, v)| v.as_str().map(str::to_string))),
        _ => None,
    }
}

pub fn parse_schema(bytes: &[u8], lang: &str) -> Vec<SchemaBit> {
    let Some(root) = kv::parse(bytes) else { return vec![] };
    // Raíz: { "<appid>": { stats: { "<id>": { type, bits: { "<n>": { name, display } } } } } }
    let Some((_, app)) = root.entries().next() else { return vec![] };
    let mut out = vec![];
    for (stat_id, stat) in app.get("stats").map(|s| s.entries().collect::<Vec<_>>()).unwrap_or_default() {
        let is_ach = stat.get("type_int").and_then(Kv::as_int) == Some(4)
            || stat.get("type").and_then(Kv::as_str).map(|t| t.eq_ignore_ascii_case("ACHIEVEMENTS")).unwrap_or(false)
            || stat.get("type").and_then(Kv::as_int) == Some(4);
        if !is_ach {
            continue;
        }
        for (bit, e) in stat.get("bits").map(|b| b.entries().collect::<Vec<_>>()).unwrap_or_default() {
            let (Ok(bit), Some(api)) = (bit.parse::<u32>(), e.get("name").and_then(Kv::as_str)) else { continue };
            if bit >= 32 {
                continue;
            }
            let d = e.get("display");
            let s = |k: &str| d.and_then(|d| d.get(k)).and_then(Kv::as_str).filter(|s| !s.is_empty()).map(str::to_string);
            out.push(SchemaBit {
                stat: stat_id.clone(),
                bit,
                def: Def {
                    api_name: api.to_string(),
                    name: localized(d.and_then(|d| d.get("name")), lang).unwrap_or_else(|| super::pretty_name(api)),
                    description: localized(d.and_then(|d| d.get("desc")), lang).filter(|s| !s.is_empty()),
                    icon: s("icon"),
                    icon_gray: s("icon_gray"),
                    hidden: d.and_then(|d| d.get("hidden")).and_then(Kv::as_int).unwrap_or(0) != 0,
                    global_pct: None,
                },
            });
        }
    }
    // Orden estable: por stat numérica y bit (el orden del juego).
    out.sort_by_key(|b| (b.stat.parse::<i64>().unwrap_or(i64::MAX), b.bit));
    out
}

pub fn schema(root: &Path, appid: i64, lang: &str) -> Vec<SchemaBit> {
    std::fs::read(schema_file(root, appid)).map(|b| parse_schema(&b, lang)).unwrap_or_default()
}

/// Logros desbloqueados (nombre API, fecha) según el fichero del usuario.
pub fn parse_unlocks(bytes: &[u8], schema: &[SchemaBit]) -> Option<Vec<(String, i64)>> {
    let root = kv::parse(bytes)?;
    let cache = root.get("cache").unwrap_or(&root);
    let mut out = vec![];
    for b in schema {
        let Some(stat) = cache.get(&b.stat) else { continue };
        let data = stat.get("data").and_then(Kv::as_int).unwrap_or(0) as u32;
        if data & (1u32 << b.bit) == 0 {
            continue;
        }
        let t = stat
            .get("AchievementTimes")
            .and_then(|t| t.get(&b.bit.to_string()))
            .and_then(Kv::as_int)
            .unwrap_or(0);
        out.push((b.def.api_name.clone(), t));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::achievements::kv::{encode, obj_of, Kv};

    fn schema_bytes() -> Vec<u8> {
        let bit = |api: &str, es: &str, hidden: i64| {
            obj_of(vec![
                ("name", Kv::Str(api.into())),
                (
                    "display",
                    obj_of(vec![
                        ("name", obj_of(vec![("english", Kv::Str(format!("{api} en"))), ("spanish", Kv::Str(es.into())), ("token", Kv::Str("T".into()))])),
                        ("desc", obj_of(vec![("english", Kv::Str("Do it".into()))])),
                        ("hidden", Kv::Int(hidden)),
                        ("icon", Kv::Str("abc.jpg".into())),
                        ("icon_gray", Kv::Str("def.jpg".into())),
                    ]),
                ),
            ])
        };
        encode(&obj_of(vec![(
            "480",
            obj_of(vec![(
                "stats",
                obj_of(vec![
                    ("1", obj_of(vec![("type", Kv::Str("ACHIEVEMENTS".into())), ("bits", obj_of(vec![("0", bit("ACH_A", "Primero", 0)), ("1", bit("ACH_B", "Segundo", 1))]))])),
                    ("2", obj_of(vec![("type_int", Kv::Int(4)), ("bits", obj_of(vec![("0", bit("ACH_C", "Tercero", 0))]))])),
                    ("3", obj_of(vec![("type", Kv::Str("INT".into()))])),
                ]),
            )]),
        )]))
    }

    #[test]
    fn schema_and_unlocks() {
        let s = parse_schema(&schema_bytes(), "spanish");
        assert_eq!(s.iter().map(|b| b.def.api_name.as_str()).collect::<Vec<_>>(), ["ACH_A", "ACH_B", "ACH_C"]);
        assert_eq!(s[0].def.name, "Primero");
        assert_eq!(s[0].def.description.as_deref(), Some("Do it"));
        assert!(s[1].def.hidden);

        let user = encode(&obj_of(vec![(
            "cache",
            obj_of(vec![
                ("crc", Kv::Int(1)),
                ("1", obj_of(vec![("data", Kv::Int(0b10)), ("AchievementTimes", obj_of(vec![("1", Kv::Int(1700000000))]))])),
                ("2", obj_of(vec![("data", Kv::Int(-1))])),
            ]),
        )]));
        let u = parse_unlocks(&user, &s).unwrap();
        assert_eq!(u, vec![("ACH_B".to_string(), 1700000000), ("ACH_C".to_string(), 0)]);
    }
}
