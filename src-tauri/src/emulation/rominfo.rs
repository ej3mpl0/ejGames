//! Lo que se puede leer de una ROM sin emulador: el sistema cuando la extensión
//! no basta (un .iso puede ser de PSP, PS2, PS1, GameCube o Wii), y el TitleID,
//! la versión, la región, la serie y el nombre interno cuando el formato lo trae
//! en claro. Solo se leen unos pocos KB de la cabecera; nada se descifra.
//!
//! Switch: el TitleID sale del ticket (`.tik`) de un NSP o del nombre del archivo
//! (`[0100…][v65536]`); con él se sabe si es el juego, una actualización o un DLC.

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RomInfo {
    /// TitleID (Switch, 3DS, PS Vita) o código del juego (N64, GameCube…).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    /// Número de serie del disco (SLUS-20312, ULES-00151…).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
    /// Nombre que trae el propio archivo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// base | update | dlc
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// De una actualización o un DLC: el TitleID del juego al que pertenece.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_title_id: Option<String>,
}

impl RomInfo {
    pub fn is_empty(&self) -> bool {
        *self == RomInfo::default()
    }
    /// Una actualización o un DLC (no es un juego aparte).
    pub fn is_extra(&self) -> bool {
        matches!(self.kind.as_deref(), Some("update" | "dlc")) && self.base_title_id.is_some()
    }
}

// ───────────────────────── lectura ─────────────────────────

/// Lee `len` bytes en `off` (menos si el archivo es más corto).
fn read_at(f: &mut File, off: u64, len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    if f.seek(SeekFrom::Start(off)).is_err() {
        return vec![];
    }
    let mut n = 0;
    while n < len {
        match f.read(&mut buf[n..]) {
            Ok(0) | Err(_) => break,
            Ok(k) => n += k,
        }
    }
    buf.truncate(n);
    buf
}

fn u16le(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}
fn u32le(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn u64le(b: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(o..o + 8)?.try_into().ok()?))
}
fn u32be(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn u16be(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(o..o + 2)?.try_into().ok()?))
}
fn u64be(b: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_be_bytes(b.get(o..o + 8)?.try_into().ok()?))
}

/// Texto ASCII de una cabecera: sin ceros ni espacios sobrantes; None si no es legible.
fn ascii(b: &[u8]) -> Option<String> {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    let s: String = b[..end].iter().map(|&c| c as char).collect();
    let s = s.trim().to_string();
    (!s.is_empty() && s.chars().all(|c| (' '..='~').contains(&c))).then_some(s)
}

fn utf8z(b: &[u8]) -> Option<String> {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    let s = String::from_utf8_lossy(&b[..end]).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn utf16z(b: &[u8]) -> Option<String> {
    let units: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0).collect();
    let s = String::from_utf16_lossy(&units).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn ext_of(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Región por la letra de los códigos de Nintendo (NTR-P-AXXE, NUS-NSME…).
fn nintendo_region(c: char) -> Option<&'static str> {
    Some(match c {
        'E' | 'N' => "USA",
        'J' => "Japón",
        'P' | 'X' | 'Y' | 'Z' => "Europa",
        'D' => "Alemania",
        'F' => "Francia",
        'S' => "España",
        'I' => "Italia",
        'U' => "Australia",
        'K' => "Corea",
        'A' => "Mundial",
        'C' => "China",
        _ => return None,
    })
}

/// Región por el prefijo de la serie de Sony (SLUS, SLES, ULJM…).
fn sony_region(serial: &str) -> Option<&'static str> {
    let p = serial.get(..4)?.to_ascii_uppercase();
    let third = p.chars().nth(2)?;
    Some(match third {
        'U' => "USA",
        'E' => "Europa",
        'J' | 'P' => "Japón",
        'K' => "Corea",
        'A' | 'H' => "Asia",
        _ => return None,
    })
}

// ───────────────────────── Switch ─────────────────────────

/// Clasifica un TitleID de Switch: base (…000), actualización (…800) o DLC (base + 0x1000 + n).
pub fn switch_kind(tid: u64) -> (&'static str, u64) {
    match tid & 0xFFF {
        0x000 => ("base", tid),
        0x800 => ("update", tid & !0xFFF),
        _ => ("dlc", (tid - 0x1000) & !0xFFF),
    }
}

fn hex16(n: u64) -> String {
    format!("{n:016X}")
}

/// `[0100ABCD12340000]` y `[v65536]` en el nombre (lo habitual en volcados de Switch).
fn switch_from_name(name: &str) -> (Option<u64>, Option<String>) {
    let tid = regex::Regex::new(r"(?i)\b(01[0-9a-f]{14})\b").ok().and_then(|re| re.captures(name)).and_then(|c| u64::from_str_radix(&c[1], 16).ok());
    let ver = regex::Regex::new(r"(?i)\[v(\d+)\]").ok().and_then(|re| re.captures(name)).map(|c| c[1].to_string());
    (tid, ver)
}

/// Nombres de los archivos de un PFS0 (NSP) o HFS0.
fn pfs0_names(f: &mut File, off: u64, magic: &[u8; 4], entry: usize) -> Vec<String> {
    let h = read_at(f, off, 16);
    if h.get(0..4) != Some(magic) {
        return vec![];
    }
    let (n, strs) = (u32le(&h, 4).unwrap_or(0) as usize, u32le(&h, 8).unwrap_or(0) as usize);
    if n == 0 || n > 4096 || strs > 1 << 20 {
        return vec![];
    }
    let table = read_at(f, off + 16 + (n * entry) as u64, strs);
    table.split(|&c| c == 0).filter(|s| !s.is_empty()).map(|s| String::from_utf8_lossy(s).into_owned()).collect()
}

fn switch_info(f: &mut File, path: &Path) -> RomInfo {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (mut tid, version) = switch_from_name(&name);
    if tid.is_none() && ext_of(path) == "nsp" {
        // El ticket se llama como su «rights id»: TitleID (16) + generación de clave.
        tid = pfs0_names(f, 0, b"PFS0", 0x18)
            .iter()
            .find_map(|n| n.strip_suffix(".tik").filter(|r| r.len() == 32).and_then(|r| u64::from_str_radix(&r[..16], 16).ok()));
    }
    let mut info = RomInfo { version, ..Default::default() };
    if ext_of(path) == "nro" {
        nro_info(f, &mut info);
    }
    if let Some(t) = tid {
        let (kind, base) = switch_kind(t);
        info.title_id = Some(hex16(t));
        info.kind = Some(kind.into());
        if kind != "base" {
            info.base_title_id = Some(hex16(base));
        }
    }
    info
}

/// Homebrew de Switch (.nro): nombre, autor y versión de su NACP.
fn nro_info(f: &mut File, info: &mut RomInfo) {
    let h = read_at(f, 0, 0x80);
    if h.get(0x10..0x14) != Some(b"NRO0") {
        return;
    }
    let size = u32le(&h, 0x18).unwrap_or(0) as u64;
    let aset = read_at(f, size, 0x38);
    if aset.get(0..4) != Some(b"ASET") {
        return;
    }
    let (off, len) = (u64le(&aset, 0x18).unwrap_or(0), u64le(&aset, 0x20).unwrap_or(0));
    if len < 0x3070 {
        return;
    }
    let nacp = read_at(f, size + off, 0x3070);
    // 16 idiomas de 0x300 (nombre 0x200 + autor 0x100); el primero con nombre.
    info.title = (0..16).find_map(|i| nacp.get(i * 0x300..i * 0x300 + 0x200).and_then(utf8z));
    info.version = nacp.get(0x3060..0x3070).and_then(utf8z).or(info.version.take());
}

// ───────────────────────── 3DS ─────────────────────────

fn ctr_kind(info: &mut RomInfo, tid: u64) {
    info.title_id = Some(hex16(tid));
    let (kind, base) = match tid >> 32 {
        0x0004_000E => ("update", (tid & 0xFFFF_FFFF) | 0x0004_0000_0000_0000),
        0x0004_008C => ("dlc", (tid & 0xFFFF_FFFF) | 0x0004_0000_0000_0000),
        _ => ("base", tid),
    };
    info.kind = Some(kind.into());
    if kind != "base" {
        info.base_title_id = Some(hex16(base));
    }
}

fn ncch_product(f: &mut File, off: u64, info: &mut RomInfo) {
    let h = read_at(f, off, 0x200);
    if h.get(0x100..0x104) != Some(b"NCCH") {
        return;
    }
    if let Some(code) = h.get(0x150..0x160).and_then(ascii) {
        info.region = code.chars().last().and_then(nintendo_region).map(str::to_string);
        info.serial = Some(code);
    }
    if info.title_id.is_none() {
        if let Some(t) = u64le(&h, 0x118) {
            ctr_kind(info, t);
        }
    }
}

fn ctr_info(f: &mut File, path: &Path) -> RomInfo {
    let mut info = RomInfo::default();
    match ext_of(path).as_str() {
        "3ds" | "cci" => {
            let h = read_at(f, 0, 0x200);
            if h.get(0x100..0x104) == Some(b"NCSD") {
                if let Some(t) = u64le(&h, 0x108) {
                    ctr_kind(&mut info, t);
                }
                let part0 = u32le(&h, 0x120).unwrap_or(0) as u64 * 0x200;
                if part0 > 0 {
                    ncch_product(f, part0, &mut info);
                }
            }
        }
        "cxi" => ncch_product(f, 0, &mut info),
        "cia" => {
            // Cabecera (0x2020) → certificados → ticket (TitleID) → TMD (versión), alineados a 64.
            let h = read_at(f, 0, 0x20);
            let al = |n: u64| (n + 63) & !63;
            if u32le(&h, 0) == Some(0x2020) {
                let cert = al(0x2020);
                let tik = al(cert + u32le(&h, 8).unwrap_or(0) as u64);
                let tmd = al(tik + u32le(&h, 0x0C).unwrap_or(0) as u64);
                let t = read_at(f, tik, 0x1E4);
                if let Some(tid) = u64be(&t, 0x1DC) {
                    ctr_kind(&mut info, tid);
                }
                let m = read_at(f, tmd, 0x220);
                if let Some(v) = u16be(&m, 0x1DC) {
                    info.version = Some(format!("v{v}"));
                }
            }
        }
        "3dsx" => {
            // SMDH opcional al final: nombre corto en inglés.
            let h = read_at(f, 0, 0x2C);
            if h.get(0..4) == Some(b"3DSX") && u16le(&h, 4).unwrap_or(0) >= 0x2C {
                let off = u32le(&h, 0x20).unwrap_or(0) as u64;
                let s = read_at(f, off, 0x8 + 0x200 * 2);
                if s.get(0..4) == Some(b"SMDH") {
                    info.title = s.get(0x8 + 0x200..0x8 + 0x200 + 0x80).and_then(utf16z).or_else(|| s.get(0x8..0x88).and_then(utf16z));
                }
            }
        }
        _ => {}
    }
    info
}

// ───────────────────────── PS Vita / PSP (PARAM.SFO) ─────────────────────────

/// Pares clave → valor de un PARAM.SFO.
pub fn sfo(b: &[u8]) -> Vec<(String, String)> {
    if b.get(0..4) != Some(b"\0PSF") {
        return vec![];
    }
    let (keys, data, n) = (u32le(b, 8).unwrap_or(0) as usize, u32le(b, 12).unwrap_or(0) as usize, u32le(b, 16).unwrap_or(0) as usize);
    (0..n.min(256))
        .filter_map(|i| {
            let e = 20 + i * 16;
            let (ko, fmt, len, doff) = (u16le(b, e)? as usize, u16le(b, e + 2)?, u32le(b, e + 4)? as usize, u32le(b, e + 12)? as usize);
            let key = utf8z(b.get(keys + ko..)?.get(..64.min(b.len() - keys - ko))?)?;
            let raw = b.get(data + doff..data + doff + len)?;
            let val = match fmt {
                0x0404 => u32le(raw, 0)?.to_string(),
                _ => utf8z(raw)?,
            };
            Some((key, val))
        })
        .collect()
}

fn sfo_into(pairs: &[(String, String)], info: &mut RomInfo) {
    let get = |k: &str| pairs.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
    info.title = get("TITLE").or(info.title.take());
    info.title_id = get("TITLE_ID").or(info.title_id.take());
    info.version = get("APP_VER").or_else(|| get("DISC_VERSION")).or(info.version.take());
    if let Some(id) = get("DISC_ID") {
        info.region = sony_region(&id).map(str::to_string);
        info.serial = Some(format!("{}-{}", &id[..4.min(id.len())], id.get(4..).unwrap_or("")));
    }
    if let Some(cat) = get("CATEGORY") {
        // gp = parche de Vita, ac = contenido adicional.
        info.kind = Some(match cat.as_str() { "gp" => "update", "ac" => "dlc", _ => "base" }.into());
        if info.kind.as_deref() != Some("base") {
            info.base_title_id = info.title_id.clone();
        }
    }
}

fn vpk_info(path: &Path) -> RomInfo {
    let mut info = RomInfo::default();
    let Ok(mut z) = File::open(path).map_err(anyhow::Error::from).and_then(|f| Ok(zip::ZipArchive::new(f)?)) else { return info };
    let Ok(mut e) = z.by_name("sce_sys/param.sfo") else { return info };
    let mut b = vec![];
    if e.size() < 1 << 20 && e.read_to_end(&mut b).is_ok() {
        sfo_into(&sfo(&b), &mut info);
    }
    info
}

// ───────────────────────── imágenes de disco (ISO 9660, CSO) ─────────────────────────

/// Lector por sectores de 2048 de una ISO, una CSO (comprimida por bloques) o una pista
/// en bruto de 2352 (los .bin de PS1).
struct Disc {
    f: File,
    cso: Option<(u32, u8, Vec<u32>)>,
    raw: bool,
}

impl Disc {
    fn open(path: &Path) -> Option<Disc> {
        let mut f = File::open(path).ok()?;
        let h = read_at(&mut f, 0, 0x18);
        if h.get(0..4) == Some(b"CISO") {
            let total = u64le(&h, 8)?;
            let block = u32le(&h, 16)?;
            let align = *h.get(21)?;
            if block == 0 || total == 0 {
                return None;
            }
            let blocks = (total / block as u64) as usize;
            // Solo el principio del índice: la cabecera del disco está en los primeros MB.
            let want = blocks.min(64 * 1024) + 1;
            let idx = read_at(&mut f, 0x18, want * 4);
            let index = idx.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
            return Some(Disc { f, cso: Some((block, align, index)), raw: false });
        }
        let raw = read_at(&mut f, 0, 12) == [0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0];
        Some(Disc { f, cso: None, raw })
    }

    fn sector(&mut self, lba: u64) -> Vec<u8> {
        if self.raw {
            // Modo 2 forma 1 (PS1): 24 bytes de cabecera antes de los datos.
            return read_at(&mut self.f, lba * 2352 + 24, 2048);
        }
        let Some((block, align, index)) = &self.cso else { return read_at(&mut self.f, lba * 2048, 2048) };
        let (block, align) = (*block as u64, *align);
        let pos = lba * 2048;
        let (b, within) = ((pos / block) as usize, (pos % block) as usize);
        let (Some(&a), Some(&z)) = (index.get(b), index.get(b + 1)) else { return vec![] };
        let plain = a & 0x8000_0000 != 0;
        let (start, end) = (((a & 0x7FFF_FFFF) as u64) << align, ((z & 0x7FFF_FFFF) as u64) << align);
        let data = read_at(&mut self.f, start, (end.saturating_sub(start) as usize).min(block as usize * 2 + 64));
        let out = if plain {
            data
        } else {
            let mut d = flate2::read::DeflateDecoder::new(&data[..]);
            let mut o = Vec::with_capacity(block as usize);
            let _ = d.read_to_end(&mut o);
            o
        };
        out.get(within..within + 2048).map(<[u8]>::to_vec).unwrap_or_default()
    }

    /// Un archivo por su ruta (`PSP_GAME/PARAM.SFO`), hasta 64 KB.
    fn file(&mut self, path: &str) -> Option<Vec<u8>> {
        let pvd = self.sector(16);
        if pvd.get(1..6) != Some(b"CD001") {
            return None;
        }
        let root = pvd.get(156..190)?;
        let (mut lba, mut size) = (u32le(root, 2)? as u64, u32le(root, 10)? as usize);
        let parts: Vec<&str> = path.split('/').collect();
        for (i, want) in parts.iter().enumerate() {
            let last = i == parts.len() - 1;
            let mut found = None;
            'dir: for s in 0..size.div_ceil(2048).min(16) {
                let sec = self.sector(lba + s as u64);
                let mut o = 0;
                while o < sec.len() {
                    let len = sec[o] as usize;
                    if len == 0 {
                        break;
                    }
                    let rec = sec.get(o..o + len)?;
                    let nlen = *rec.get(32)? as usize;
                    let name = String::from_utf8_lossy(rec.get(33..33 + nlen)?).to_ascii_uppercase();
                    let name = name.split(';').next().unwrap_or("");
                    if name == want.to_ascii_uppercase() {
                        found = Some((u32le(rec, 2)? as u64, u32le(rec, 10)? as usize));
                        break 'dir;
                    }
                    o += len;
                }
            }
            let (l, sz) = found?;
            if last {
                let mut out = vec![];
                for s in 0..sz.div_ceil(2048).min(32) {
                    out.extend(self.sector(l + s as u64));
                }
                out.truncate(sz);
                return Some(out);
            }
            (lba, size) = (l, sz);
        }
        None
    }
}

/// Serie de un SYSTEM.CNF de PlayStation: «BOOT2 = cdrom0:\SLUS_203.12;1» → SLUS-20312.
fn cnf_serial(text: &str) -> Option<(bool, String)> {
    let line = text.lines().find(|l| l.trim_start().to_ascii_uppercase().starts_with("BOOT"))?;
    let ps2 = line.trim_start().to_ascii_uppercase().starts_with("BOOT2");
    let file = line.rsplit(['\\', ':']).next()?.split(';').next()?.trim();
    let clean: String = file.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    (clean.len() >= 9).then(|| (ps2, format!("{}-{}", &clean[..4], &clean[4..]).to_ascii_uppercase()))
}

/// Sistema y datos de una imagen de disco.
fn disc_info(path: &Path) -> Option<(&'static str, RomInfo)> {
    let mut f = File::open(path).ok()?;
    let h = read_at(&mut f, 0, 0x60);
    // GameCube y Wii: su número mágico, el código del juego y el nombre.
    let nintendo = |sys: &'static str| {
        let mut i = RomInfo::default();
        i.serial = h.get(0..6).and_then(ascii);
        i.title_id = i.serial.clone();
        i.region = h.get(3).and_then(|c| nintendo_region(*c as char)).map(str::to_string);
        i.title = h.get(0x20..0x60).and_then(ascii);
        i.version = h.get(7).map(|v| format!("1.{v:02}"));
        (sys, i)
    };
    if u32be(&h, 0x1C) == Some(0xC233_9F3D) {
        return Some(nintendo("gc"));
    }
    if u32be(&h, 0x18) == Some(0x5D1C_9EA3) {
        return Some(nintendo("wii"));
    }
    let mut d = Disc::open(path)?;
    if let Some(sfo_bytes) = d.file("PSP_GAME/PARAM.SFO") {
        let mut i = RomInfo::default();
        sfo_into(&sfo(&sfo_bytes), &mut i);
        i.kind = None;
        i.base_title_id = None;
        return Some(("psp", i));
    }
    if d.file("UMD_DATA.BIN").is_some() {
        return Some(("psp", RomInfo::default()));
    }
    if let Some(cnf) = d.file("SYSTEM.CNF") {
        let text = String::from_utf8_lossy(&cnf).into_owned();
        let (ps2, serial) = cnf_serial(&text)?;
        let i = RomInfo { region: sony_region(&serial).map(str::to_string), title_id: Some(serial.clone()), serial: Some(serial), ..Default::default() };
        return Some((if ps2 { "ps2" } else { "psx" }, i));
    }
    // PS3 en carpeta o ISO: PS3_GAME/PARAM.SFO.
    if let Some(b) = d.file("PS3_GAME/PARAM.SFO") {
        let mut i = RomInfo::default();
        sfo_into(&sfo(&b), &mut i);
        i.kind = None;
        i.base_title_id = None;
        return Some(("ps3", i));
    }
    None
}

/// .cue: Saturn o PlayStation, según la primera pista.
fn cue_system(path: &Path) -> Option<&'static str> {
    let text = std::fs::read_to_string(path).ok()?;
    let bin = text.lines().find_map(|l| {
        let l = l.trim();
        l.to_ascii_uppercase().starts_with("FILE").then(|| l.split('"').nth(1).map(str::to_string)).flatten()
    })?;
    let mut f = File::open(path.parent()?.join(bin)).ok()?;
    let h = read_at(&mut f, 0, 0x40);
    if h.windows(15).any(|w| w == b"SEGA SEGASATURN") {
        return Some("saturn");
    }
    if h.windows(13).any(|w| w == b"SEGADISCSYSTEM") {
        return None;
    }
    Some("psx")
}

// ───────────────────────── cartuchos ─────────────────────────

fn n64_info(f: &mut File) -> RomInfo {
    let mut h = read_at(f, 0, 0x40);
    if h.len() < 0x40 {
        return RomInfo::default();
    }
    match h[..4] {
        [0x80, 0x37, 0x12, 0x40] => {}
        // .v64: bytes intercambiados de dos en dos; .n64: palabras al revés.
        [0x37, 0x80, 0x40, 0x12] => h.chunks_exact_mut(2).for_each(|c| c.swap(0, 1)),
        [0x40, 0x12, 0x37, 0x80] => h.chunks_exact_mut(4).for_each(|c| c.reverse()),
        _ => return RomInfo::default(),
    }
    let code = h.get(0x3B..0x3F).and_then(ascii);
    RomInfo {
        title: h.get(0x20..0x34).and_then(ascii),
        region: h.get(0x3E).and_then(|c| nintendo_region(*c as char)).map(str::to_string),
        version: Some(format!("1.{}", h[0x3F])),
        serial: code.as_ref().map(|c| format!("NUS-{c}")),
        title_id: code,
        ..Default::default()
    }
}

fn snes_info(f: &mut File, len: u64) -> RomInfo {
    let base = if len % 1024 == 512 { 512 } else { 0 };
    for at in [0x7FC0u64, 0xFFC0] {
        let h = read_at(f, base + at, 0x20);
        let (Some(cmp), Some(sum)) = (u16le(&h, 0x1C), u16le(&h, 0x1E)) else { continue };
        if cmp ^ sum != 0xFFFF {
            continue;
        }
        let region = match h.get(0x19) {
            Some(0) => Some("Japón"),
            Some(1) => Some("USA"),
            Some(2..=12) => Some("Europa"),
            _ => None,
        };
        return RomInfo { title: h.get(0..21).and_then(ascii), region: region.map(str::to_string), version: h.get(0x1B).map(|v| format!("1.{v}")), ..Default::default() };
    }
    RomInfo::default()
}

fn gba_info(f: &mut File) -> RomInfo {
    let h = read_at(f, 0xA0, 0x20);
    let code = h.get(0x0C..0x10).and_then(ascii);
    RomInfo {
        title: h.get(0..12).and_then(ascii),
        region: code.as_ref().and_then(|c| c.chars().nth(3)).and_then(nintendo_region).map(str::to_string),
        version: h.get(0x1C).map(|v| format!("1.{v}")),
        title_id: code,
        ..Default::default()
    }
}

fn nds_info(f: &mut File) -> RomInfo {
    let h = read_at(f, 0, 0x20);
    let code = h.get(0x0C..0x10).and_then(ascii);
    RomInfo {
        title: h.get(0..12).and_then(ascii),
        region: code.as_ref().and_then(|c| c.chars().nth(3)).and_then(nintendo_region).map(str::to_string),
        version: h.get(0x1E).map(|v| format!("1.{v}")),
        serial: code.as_ref().map(|c| format!("NTR-{c}")),
        title_id: code,
        ..Default::default()
    }
}

// ───────────────────────── entrada ─────────────────────────

/// Sistema de un archivo cuya extensión vale para varios, mirando su contenido
/// (None si no se sabe: lo decide el usuario).
pub fn sniff(path: &Path) -> Option<&'static str> {
    match ext_of(path).as_str() {
        "iso" | "cso" => disc_info(path).map(|(s, _)| s),
        "cue" => cue_system(path),
        "chd" => None,
        _ => None,
    }
}

/// Lo que se pueda leer del archivo, para el sistema dado.
pub fn read(path: &Path, platform: &str) -> RomInfo {
    let Ok(mut f) = File::open(path) else { return RomInfo::default() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    match platform {
        "switch" => switch_info(&mut f, path),
        "3ds" => ctr_info(&mut f, path),
        "vita" if ext_of(path) == "vpk" => vpk_info(path),
        "n64" => n64_info(&mut f),
        "snes" => snes_info(&mut f, len),
        "gba" => gba_info(&mut f),
        "nds" => nds_info(&mut f),
        "psp" | "ps2" | "psx" | "gc" | "wii" | "ps3" if matches!(ext_of(path).as_str(), "iso" | "cso" | "gcm") => {
            disc_info(path).map(|(_, i)| i).unwrap_or_default()
        }
        _ => RomInfo::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn switch_title_ids() {
        assert_eq!(switch_kind(0x0100_0000_0001_0000), ("base", 0x0100_0000_0001_0000));
        assert_eq!(switch_kind(0x0100_0000_0001_0800), ("update", 0x0100_0000_0001_0000));
        assert_eq!(switch_kind(0x0100_0000_0001_1001), ("dlc", 0x0100_0000_0001_0000));
        assert_eq!(switch_kind(0x0100_0000_0001_1010), ("dlc", 0x0100_0000_0001_0000));
        let d = tempfile::tempdir().unwrap();
        let p = write(d.path(), "Juego [0100ABCD00010800][v131072].nsp", b"x");
        let i = read(&p, "switch");
        assert_eq!(i.title_id.as_deref(), Some("0100ABCD00010800"));
        assert_eq!((i.kind.as_deref(), i.base_title_id.as_deref(), i.version.as_deref()), (Some("update"), Some("0100ABCD00010000"), Some("131072")));
        assert!(i.is_extra());
    }

    #[test]
    fn nsp_ticket_gives_the_title_id() {
        // PFS0 con dos archivos: un .nca y el ticket.
        let names = b"0123456789abcdef0123456789abcdef.nca\x000100ABCD00011001000000000000000a.tik\x00";
        let mut b = b"PFS0".to_vec();
        b.extend(2u32.to_le_bytes());
        b.extend((names.len() as u32).to_le_bytes());
        b.extend([0u8; 4]);
        b.extend([0u8; 0x18 * 2]);
        b.extend(names);
        let d = tempfile::tempdir().unwrap();
        let i = read(&write(d.path(), "dlc.nsp", &b), "switch");
        assert_eq!((i.kind.as_deref(), i.base_title_id.as_deref()), (Some("dlc"), Some("0100ABCD00010000")));
    }

    #[test]
    fn n64_any_byte_order() {
        let mut h = vec![0u8; 0x40];
        h[..4].copy_from_slice(&[0x80, 0x37, 0x12, 0x40]);
        h[0x20..0x2C].copy_from_slice(b"SUPER MARIO ");
        h[0x3B..0x3F].copy_from_slice(b"NSME");
        let d = tempfile::tempdir().unwrap();
        let z = read(&write(d.path(), "a.z64", &h), "n64");
        assert_eq!((z.title.as_deref(), z.title_id.as_deref(), z.region.as_deref()), (Some("SUPER MARIO"), Some("NSME"), Some("USA")));
        let v64: Vec<u8> = h.chunks_exact(2).flat_map(|c| [c[1], c[0]]).collect();
        assert_eq!(read(&write(d.path(), "a.v64", &v64), "n64").title_id.as_deref(), Some("NSME"));
        let n64: Vec<u8> = h.chunks_exact(4).flat_map(|c| [c[3], c[2], c[1], c[0]]).collect();
        assert_eq!(read(&write(d.path(), "a.n64", &n64), "n64").title_id.as_deref(), Some("NSME"));
    }

    #[test]
    fn snes_header_with_checksum() {
        let mut rom = vec![0u8; 0x8000];
        rom[0x7FC0..0x7FD5].copy_from_slice(b"SUPER MARIOWORLD     ");
        rom[0x7FD9] = 1;
        rom[0x7FDC..0x7FDE].copy_from_slice(&0x5F25u16.to_le_bytes());
        rom[0x7FDE..0x7FE0].copy_from_slice(&(0x5F25u16 ^ 0xFFFF).to_le_bytes());
        let d = tempfile::tempdir().unwrap();
        let i = read(&write(d.path(), "smw.sfc", &rom), "snes");
        assert_eq!((i.title.as_deref(), i.region.as_deref()), (Some("SUPER MARIOWORLD"), Some("USA")));
        // Con cabecera de copiadora (512 bytes delante).
        let mut c = vec![0u8; 512];
        c.extend(&rom);
        assert_eq!(read(&write(d.path(), "smw.smc", &c), "snes").title.as_deref(), Some("SUPER MARIOWORLD"));
    }

    fn sfo_bytes(pairs: &[(&str, &str)]) -> Vec<u8> {
        let mut keys = vec![];
        let mut data: Vec<u8> = vec![];
        let mut entries = vec![];
        for (k, v) in pairs {
            let ko = keys.len() as u16;
            keys.extend(k.as_bytes());
            keys.push(0);
            let d0 = data.len() as u32;
            let mut val = v.as_bytes().to_vec();
            val.push(0);
            let len = val.len() as u32;
            data.extend(&val);
            entries.extend(ko.to_le_bytes());
            entries.extend(0x0204u16.to_le_bytes());
            entries.extend(len.to_le_bytes());
            entries.extend(len.to_le_bytes());
            entries.extend(d0.to_le_bytes());
        }
        let kt = 20 + entries.len();
        let dt = kt + keys.len();
        let mut b = b"\0PSF".to_vec();
        b.extend(0x101u32.to_le_bytes());
        b.extend((kt as u32).to_le_bytes());
        b.extend((dt as u32).to_le_bytes());
        b.extend((pairs.len() as u32).to_le_bytes());
        b.extend(entries);
        b.extend(keys);
        b.extend(data);
        b
    }

    #[test]
    fn vita_vpk_reads_param_sfo() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("juego.vpk");
        {
            let mut w = zip::ZipWriter::new(File::create(&p).unwrap());
            w.start_file("sce_sys/param.sfo", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(&sfo_bytes(&[("TITLE", "VitaQuake"), ("TITLE_ID", "QUAK00001"), ("APP_VER", "01.20"), ("CATEGORY", "gd")])).unwrap();
            w.finish().unwrap();
        }
        let i = read(&p, "vita");
        assert_eq!((i.title.as_deref(), i.title_id.as_deref(), i.version.as_deref(), i.kind.as_deref()), (Some("VitaQuake"), Some("QUAK00001"), Some("01.20"), Some("base")));
    }

    /// ISO 9660 mínima con un archivo en una carpeta.
    fn iso_with(dir: &str, file: &str, content: &[u8]) -> Vec<u8> {
        let mut iso = vec![0u8; 2048 * 24];
        let rec = |lba: u32, size: u32, name: &str, isdir: bool| {
            let mut r = vec![0u8; 33 + name.len() + (name.len() + 1) % 2];
            r[0] = r.len() as u8;
            r[2..6].copy_from_slice(&lba.to_le_bytes());
            r[10..14].copy_from_slice(&size.to_le_bytes());
            r[25] = if isdir { 2 } else { 0 };
            r[32] = name.len() as u8;
            r[33..33 + name.len()].copy_from_slice(name.as_bytes());
            r
        };
        // PVD en el sector 16; raíz en el 18; carpeta en el 19; archivo en el 20.
        iso[16 * 2048] = 1;
        iso[16 * 2048 + 1..16 * 2048 + 6].copy_from_slice(b"CD001");
        let root = rec(18, 2048, "\0", true);
        iso[16 * 2048 + 156..16 * 2048 + 156 + root.len()].copy_from_slice(&root);
        let mut at = 18 * 2048;
        if dir.is_empty() {
            let r = rec(20, content.len() as u32, &format!("{file};1"), false);
            iso[at..at + r.len()].copy_from_slice(&r);
        } else {
            let r = rec(19, 2048, dir, true);
            iso[at..at + r.len()].copy_from_slice(&r);
            at = 19 * 2048;
            let r = rec(20, content.len() as u32, &format!("{file};1"), false);
            iso[at..at + r.len()].copy_from_slice(&r);
        }
        iso[20 * 2048..20 * 2048 + content.len()].copy_from_slice(content);
        iso
    }

    #[test]
    fn iso_tells_psp_from_ps2_and_ps1() {
        let d = tempfile::tempdir().unwrap();
        let psp = write(d.path(), "a.iso", &iso_with("PSP_GAME", "PARAM.SFO", &sfo_bytes(&[("TITLE", "Lumines"), ("DISC_ID", "ULES00151"), ("DISC_VERSION", "1.01")])));
        assert_eq!(sniff(&psp), Some("psp"));
        let i = read(&psp, "psp");
        assert_eq!((i.title.as_deref(), i.serial.as_deref(), i.region.as_deref()), (Some("Lumines"), Some("ULES-00151"), Some("Europa")));
        let ps2 = write(d.path(), "b.iso", &iso_with("", "SYSTEM.CNF", b"BOOT2 = cdrom0:\\SLUS_203.12;1\r\nVER = 1.00\r\n"));
        assert_eq!(sniff(&ps2), Some("ps2"));
        assert_eq!(read(&ps2, "ps2").serial.as_deref(), Some("SLUS-20312"));
        let ps1 = write(d.path(), "c.iso", &iso_with("", "SYSTEM.CNF", b"BOOT = cdrom:\\SCES_003.44;1\r\n"));
        assert_eq!(sniff(&ps1), Some("psx"));
        let mut gc = vec![0u8; 0x60];
        gc[0..6].copy_from_slice(b"GALE01");
        gc[0x1C..0x20].copy_from_slice(&0xC233_9F3Du32.to_be_bytes());
        gc[0x20..0x31].copy_from_slice(b"Super Smash Bros.");
        let gcp = write(d.path(), "d.iso", &gc);
        assert_eq!(sniff(&gcp), Some("gc"));
        assert_eq!(read(&gcp, "gc").title_id.as_deref(), Some("GALE01"));
        assert_eq!(sniff(&write(d.path(), "e.iso", &[0u8; 4096])), None);
    }

    #[test]
    fn cso_is_read_through_the_compression() {
        use flate2::write::DeflateEncoder;
        let iso = iso_with("PSP_GAME", "PARAM.SFO", &sfo_bytes(&[("TITLE", "Patapon"), ("DISC_ID", "UCUS98711")]));
        let block = 2048usize;
        let n = iso.len() / block;
        let mut blocks = vec![];
        for (i, chunk) in iso.chunks(block).enumerate() {
            // Uno sin comprimir y el resto comprimidos, como hacen las herramientas.
            if i == 0 {
                blocks.push((true, chunk.to_vec()));
            } else {
                let mut e = DeflateEncoder::new(vec![], flate2::Compression::default());
                e.write_all(chunk).unwrap();
                blocks.push((false, e.finish().unwrap()));
            }
        }
        let header = 0x18 + (n + 1) * 4;
        let mut idx = vec![];
        let mut pos = header as u32;
        let mut body: Vec<u8> = vec![];
        for (plain, b) in &blocks {
            idx.push(pos | if *plain { 0x8000_0000 } else { 0 });
            pos += b.len() as u32;
            body.extend(b);
        }
        idx.push(pos);
        let mut cso = b"CISO".to_vec();
        cso.extend(0x18u32.to_le_bytes());
        cso.extend((iso.len() as u64).to_le_bytes());
        cso.extend((block as u32).to_le_bytes());
        cso.extend([1, 0, 0, 0]);
        for i in idx {
            cso.extend(i.to_le_bytes());
        }
        cso.extend(body);
        let d = tempfile::tempdir().unwrap();
        let p = write(d.path(), "patapon.cso", &cso);
        assert_eq!(sniff(&p), Some("psp"));
        assert_eq!(read(&p, "psp").region.as_deref(), Some("USA"));
    }

    #[test]
    fn three_ds_cart_header() {
        let mut b = vec![0u8; 0x4200];
        b[0x100..0x104].copy_from_slice(b"NCSD");
        b[0x108..0x110].copy_from_slice(&0x0004_0000_0005_5D00u64.to_le_bytes());
        b[0x120..0x124].copy_from_slice(&0x20u32.to_le_bytes()); // partición 0 en 0x4000
        b[0x4100..0x4104].copy_from_slice(b"NCCH");
        b[0x4150..0x415A].copy_from_slice(b"CTR-P-AXXP");
        let d = tempfile::tempdir().unwrap();
        let i = read(&write(d.path(), "juego.3ds", &b), "3ds");
        assert_eq!((i.title_id.as_deref(), i.serial.as_deref(), i.region.as_deref(), i.kind.as_deref()), (Some("0004000000055D00"), Some("CTR-P-AXXP"), Some("Europa"), Some("base")));
        let mut info = RomInfo::default();
        ctr_kind(&mut info, 0x0004_008C_0005_5D00);
        assert_eq!((info.kind.as_deref(), info.base_title_id.as_deref()), (Some("dlc"), Some("0004000000055D00")));
    }
}
