//! Lo que no sale del PC: la contraseña y el código de recuperación se
//! convierten aquí en claves con argon2id (el servidor solo ve la clave), y el
//! token de sesión se guarda cifrado con DPAPI (solo lo lee este usuario de Windows).

use sha2::{Digest, Sha256};

/// Alfabeto de Crockford: sin I, L, O ni U (no se confunden al copiarlo a mano).
const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Clave de 32 bytes (hex) para una contraseña o un código de recuperación.
/// La sal sale del usuario: así la misma contraseña da claves distintas en cada cuenta.
pub fn derive(username: &str, secret: &str, recovery: bool) -> anyhow::Result<String> {
    use argon2::{Algorithm, Argon2, Params, Version};
    let salt = Sha256::digest(format!("ejgames/v1/{}{}", if recovery { "rc/" } else { "" }, username.trim().to_lowercase()).as_bytes());
    let params = Params::new(19 * 1024, 2, 1, Some(32)).map_err(|e| anyhow::anyhow!("argon2: {e}"))?;
    let mut out = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret.as_bytes(), &salt, &mut out)
        .map_err(|e| anyhow::anyhow!("argon2: {e}"))?;
    Ok(out.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("getrandom");
    b
}

/// Código de recuperación: 20 caracteres (100 bits) en grupos de 4.
pub fn new_recovery_code() -> String {
    let bytes = random_bytes::<20>();
    let chars: Vec<char> = bytes.iter().map(|b| CROCKFORD[(*b & 31) as usize] as char).collect();
    chars.chunks(4).map(|c| c.iter().collect::<String>()).collect::<Vec<_>>().join("-")
}

/// Como lo teclea la gente: minúsculas, espacios, guiones, O por 0, I/L por 1.
pub fn normalize_code(code: &str) -> String {
    code.to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        })
        .collect()
}

pub fn valid_code(code: &str) -> bool {
    let n = normalize_code(code);
    n.len() == 20 && n.bytes().all(|b| CROCKFORD.contains(&b))
}

// ───────────────────────────── DPAPI ─────────────────────────────

#[cfg(windows)]
pub fn protect(data: &[u8]) -> anyhow::Result<Vec<u8>> {
    dpapi(data, true)
}

#[cfg(windows)]
pub fn unprotect(data: &[u8]) -> anyhow::Result<Vec<u8>> {
    dpapi(data, false)
}

#[cfg(windows)]
fn dpapi(data: &[u8], encrypt: bool) -> anyhow::Result<Vec<u8>> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        if encrypt {
            CryptProtectData(&input, PCWSTR::null(), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)?;
        } else {
            CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)?;
        }
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
        Ok(bytes)
    }
}

#[cfg(not(windows))]
pub fn protect(data: &[u8]) -> anyhow::Result<Vec<u8>> {
    Ok(data.to_vec())
}

#[cfg(not(windows))]
pub fn unprotect(data: &[u8]) -> anyhow::Result<Vec<u8>> {
    Ok(data.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_depend_on_user_and_kind() {
        let a = derive("Ana", "secreto", false).unwrap();
        assert_eq!(a.len(), 64);
        assert_eq!(a, derive("ana", "secreto", false).unwrap(), "el usuario no distingue mayúsculas");
        assert_ne!(a, derive("beto", "secreto", false).unwrap());
        assert_ne!(a, derive("ana", "secreto", true).unwrap());
    }

    #[test]
    fn recovery_codes() {
        let c = new_recovery_code();
        assert_eq!(c.len(), 24);
        assert!(valid_code(&c));
        assert!(valid_code(&c.to_lowercase().replace('-', " ")));
        assert_eq!(normalize_code("abcd-oill"), "ABCD0111");
        assert!(!valid_code("ABCD"));
        assert_ne!(new_recovery_code(), new_recovery_code());
    }

    #[test]
    fn dpapi_roundtrip() {
        let secret = b"token-de-prueba";
        let enc = protect(secret).unwrap();
        assert_ne!(enc.as_slice(), secret);
        assert_eq!(unprotect(&enc).unwrap(), secret);
    }
}
