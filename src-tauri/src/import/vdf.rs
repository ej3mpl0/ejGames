//! Parser mínimo y tolerante de KeyValues/VDF de texto (libraryfolders.vdf, *.acf,
//! localconfig.vdf). Claves sin distinción de mayúsculas.

#[derive(Debug, Clone, PartialEq)]
pub enum Vdf {
    Str(String),
    Obj(Vec<(String, Vdf)>),
}

impl Vdf {
    pub fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Obj(items) => items.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn path(&self, keys: &[&str]) -> Option<&Vdf> {
        keys.iter().try_fold(self, |v, k| v.get(k))
    }
    pub fn str(&self, key: &str) -> Option<&str> {
        match self.get(key)? {
            Vdf::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn entries(&self) -> &[(String, Vdf)] {
        match self {
            Vdf::Obj(items) => items,
            _ => &[],
        }
    }
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn skip_ws(&mut self) {
        while self.i < self.s.len() {
            let c = self.s[self.i];
            if c.is_ascii_whitespace() {
                self.i += 1;
            } else if c == b'/' && self.s.get(self.i + 1) == Some(&b'/') {
                while self.i < self.s.len() && self.s[self.i] != b'\n' {
                    self.i += 1;
                }
            } else {
                break;
            }
        }
    }

    fn token(&mut self) -> Option<String> {
        self.skip_ws();
        if self.i >= self.s.len() {
            return None;
        }
        if self.s[self.i] == b'"' {
            self.i += 1;
            let mut out = Vec::new();
            while self.i < self.s.len() && self.s[self.i] != b'"' {
                if self.s[self.i] == b'\\' && self.i + 1 < self.s.len() {
                    self.i += 1;
                    out.push(match self.s[self.i] {
                        b'n' => b'\n',
                        b't' => b'\t',
                        c => c,
                    });
                } else {
                    out.push(self.s[self.i]);
                }
                self.i += 1;
            }
            self.i += 1;
            Some(String::from_utf8_lossy(&out).into_owned())
        } else {
            let start = self.i;
            while self.i < self.s.len() && !self.s[self.i].is_ascii_whitespace() && !matches!(self.s[self.i], b'{' | b'}' | b'"') {
                self.i += 1;
            }
            Some(String::from_utf8_lossy(&self.s[start..self.i]).into_owned())
        }
    }

    fn object(&mut self) -> Vec<(String, Vdf)> {
        let mut items = vec![];
        loop {
            self.skip_ws();
            if self.i >= self.s.len() {
                break;
            }
            if self.s[self.i] == b'}' {
                self.i += 1;
                break;
            }
            let Some(key) = self.token() else { break };
            self.skip_ws();
            if self.i < self.s.len() && self.s[self.i] == b'{' {
                self.i += 1;
                items.push((key, Vdf::Obj(self.object())));
            } else if let Some(v) = self.token() {
                items.push((key, Vdf::Str(v)));
            }
        }
        items
    }
}

pub fn parse(text: &str) -> Vdf {
    let mut p = Parser { s: text.as_bytes(), i: 0 };
    Vdf::Obj(p.object())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_folders() {
        let t = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps"
		{
			"228980"		"1234"
			"367520"		"9999"
		}
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;
        let v = parse(t);
        let lf = v.get("LibraryFolders").unwrap();
        assert_eq!(lf.entries().len(), 2);
        assert_eq!(lf.path(&["0", "path"]).unwrap(), &Vdf::Str("C:\\Program Files (x86)\\Steam".into()));
        assert_eq!(lf.get("1").unwrap().str("path"), Some("D:\\SteamLibrary"));
    }

    #[test]
    fn acf() {
        let t = "\"AppState\"\n{\n\t\"appid\"\t\t\"367520\"\n\t\"name\"\t\t\"Hollow Knight\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"Hollow Knight\"\n}";
        let v = parse(t);
        let a = v.get("appstate").unwrap();
        assert_eq!(a.str("name"), Some("Hollow Knight"));
        assert_eq!(a.str("stateflags"), Some("4"));
    }
}
