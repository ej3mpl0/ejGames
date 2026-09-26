//! KeyValues binario de Valve (appcache/stats/*.bin): tipo (1 byte), clave
//! terminada en 0 y valor. 0x00 abre sección, 0x08 la cierra.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Kv {
    Obj(BTreeMap<String, Kv>),
    Str(String),
    Int(i64),
    Float(f32),
}

impl Kv {
    pub fn get(&self, key: &str) -> Option<&Kv> {
        match self {
            Kv::Obj(m) => m.get(key).or_else(|| m.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v)),
            _ => None,
        }
    }
    #[cfg(test)]
    pub fn path(&self, keys: &[&str]) -> Option<&Kv> {
        keys.iter().try_fold(self, |v, k| v.get(k))
    }
    pub fn entries(&self) -> impl Iterator<Item = (&String, &Kv)> {
        let m = match self {
            Kv::Obj(m) => Some(m),
            _ => None,
        };
        m.into_iter().flat_map(|m| m.iter())
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Kv::Str(s) => Some(s),
            _ => None,
        }
    }
    /// Entero, aceptando también texto numérico ("1").
    pub fn as_int(&self) -> Option<i64> {
        match self {
            Kv::Int(i) => Some(*i),
            Kv::Str(s) => s.trim().parse().ok(),
            Kv::Float(f) => Some(*f as i64),
            Kv::Obj(_) => None,
        }
    }
}

const MAX_DEPTH: usize = 32;

pub fn parse(b: &[u8]) -> Option<Kv> {
    let mut i = 0;
    let v = obj(b, &mut i, 0)?;
    Some(v)
}

fn cstr(b: &[u8], i: &mut usize) -> Option<String> {
    let rest = b.get(*i..)?;
    let end = rest.iter().position(|c| *c == 0)?;
    let s = String::from_utf8_lossy(&rest[..end]).into_owned();
    *i += end + 1;
    Some(s)
}

fn take<const N: usize>(b: &[u8], i: &mut usize) -> Option<[u8; N]> {
    let s: [u8; N] = b.get(*i..*i + N)?.try_into().ok()?;
    *i += N;
    Some(s)
}

fn obj(b: &[u8], i: &mut usize, depth: usize) -> Option<Kv> {
    if depth > MAX_DEPTH {
        return None;
    }
    let mut out = BTreeMap::new();
    while *i < b.len() {
        let t = b[*i];
        *i += 1;
        if t == 0x08 {
            return Some(Kv::Obj(out));
        }
        let key = cstr(b, i)?;
        let v = match t {
            0x00 => obj(b, i, depth + 1)?,
            0x01 => Kv::Str(cstr(b, i)?),
            0x02 => Kv::Int(i32::from_le_bytes(take::<4>(b, i)?) as i64),
            0x03 => Kv::Float(f32::from_le_bytes(take::<4>(b, i)?)),
            0x04 | 0x06 => Kv::Int(u32::from_le_bytes(take::<4>(b, i)?) as i64), // puntero / color
            0x07 => Kv::Int(u64::from_le_bytes(take::<8>(b, i)?) as i64),
            0x0A => Kv::Int(i64::from_le_bytes(take::<8>(b, i)?)),
            _ => return None,
        };
        out.insert(key, v);
    }
    // Fin de fichero sin 0x08 final: válido en la raíz.
    Some(Kv::Obj(out))
}

#[cfg(test)]
pub fn encode(v: &Kv) -> Vec<u8> {
    fn walk(m: &BTreeMap<String, Kv>, out: &mut Vec<u8>) {
        for (k, v) in m {
            let t = match v {
                Kv::Obj(_) => 0x00,
                Kv::Str(_) => 0x01,
                Kv::Int(_) => 0x02,
                Kv::Float(_) => 0x03,
            };
            out.push(t);
            out.extend_from_slice(k.as_bytes());
            out.push(0);
            match v {
                Kv::Obj(m) => {
                    walk(m, out);
                    out.push(0x08);
                }
                Kv::Str(s) => {
                    out.extend_from_slice(s.as_bytes());
                    out.push(0);
                }
                Kv::Int(i) => out.extend_from_slice(&(*i as i32).to_le_bytes()),
                Kv::Float(f) => out.extend_from_slice(&f.to_le_bytes()),
            }
        }
    }
    let mut out = vec![];
    if let Kv::Obj(m) = v {
        walk(m, &mut out);
    }
    out.push(0x08);
    out
}

#[cfg(test)]
pub fn obj_of(items: Vec<(&str, Kv)>) -> Kv {
    Kv::Obj(items.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let v = obj_of(vec![(
            "cache",
            obj_of(vec![
                ("crc", Kv::Int(12)),
                ("1", obj_of(vec![("data", Kv::Int(-1)), ("AchievementTimes", obj_of(vec![("0", Kv::Int(1686524117))]))])),
            ]),
        )]);
        let b = encode(&v);
        let p = parse(&b).unwrap();
        assert_eq!(p.path(&["cache", "1", "data"]).and_then(Kv::as_int), Some(-1));
        assert_eq!(p.path(&["cache", "1", "achievementtimes", "0"]).and_then(Kv::as_int), Some(1686524117));
    }

    #[test]
    fn truncated_is_none() {
        let v = obj_of(vec![("a", obj_of(vec![("b", Kv::Str("hola".into()))]))]);
        let b = encode(&v);
        assert!(parse(&b[..b.len() - 6]).is_none());
    }
}
