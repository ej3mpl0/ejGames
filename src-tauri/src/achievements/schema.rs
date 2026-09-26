//! Esquema de logros de Steam sin clave: `IPlayerService/GetGameAchievements`
//! devuelve nombre y descripción localizados, iconos, si es oculto y el % global.

use super::Def;
use serde_json::Value;

pub async fn fetch(http: &reqwest::Client, appid: i64, lang: &str) -> anyhow::Result<Vec<Def>> {
    let url = format!("https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?appid={appid}&language={lang}");
    let r = http.get(&url).send().await?;
    if !r.status().is_success() {
        anyhow::bail!("GetGameAchievements HTTP {}", r.status());
    }
    let v: Value = r.json().await?;
    Ok(parse(&v))
}

pub fn parse(v: &Value) -> Vec<Def> {
    let Some(items) = v.pointer("/response/achievements").and_then(Value::as_array) else { return vec![] };
    items
        .iter()
        .filter(|a| !a.get("archived").and_then(Value::as_bool).unwrap_or(false))
        .filter_map(|a| {
            let api = a.get("internal_name")?.as_str()?.to_string();
            let s = |k: &str| a.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
            Some(Def {
                name: s("localized_name").unwrap_or_else(|| super::pretty_name(&api)),
                description: s("localized_desc"),
                icon: s("icon"),
                icon_gray: s("icon_gray"),
                hidden: a.get("hidden").and_then(Value::as_bool).unwrap_or(false),
                global_pct: a
                    .get("player_percent_unlocked")
                    .and_then(|p| p.as_f64().or_else(|| p.as_str().and_then(|s| s.parse().ok()))),
                api_name: api,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_response() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"response":{"achievements":[
              {"internal_name":"TheFool","localized_name":"El Loco","localized_desc":"Conviértete en mercenario.","icon":"a.jpg","icon_gray":"b.jpg","hidden":true,"player_percent_unlocked":"88.5","archived":false},
              {"internal_name":"Old","localized_name":"x","archived":true}
            ]}}"#,
        )
        .unwrap();
        let d = super::parse(&v);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].name, "El Loco");
        assert_eq!(d[0].global_pct, Some(88.5));
        assert!(d[0].hidden);
        assert!(super::parse(&serde_json::json!({"response":{}})).is_empty());
    }
}
