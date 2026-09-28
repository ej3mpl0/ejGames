//! Géneros del catálogo: las etiquetas de la web que sirven para descubrir
//! juegos, con su nombre en español. Los ids son los de la web (estables); la
//! web no se consulta para la lista.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Genre {
    pub id: u32,
    pub name: &'static str,
    /// genre | view (perspectiva) | setting (ambientación)
    pub group: &'static str,
}

const fn g(id: u32, name: &'static str, group: &'static str) -> Genre {
    Genre { id, name, group }
}

/// De más a menos útiles para buscar (y, dentro de eso, de más a menos juegos).
pub const GENRES: &[Genre] = &[
    g(55, "Acción", "genre"),
    g(51, "Aventura", "genre"),
    g(47, "Rol", "genre"),
    g(64, "Rol de acción", "genre"),
    g(59, "Mundo abierto", "genre"),
    g(54, "Terror", "genre"),
    g(56, "Disparos", "genre"),
    g(66, "Estrategia", "genre"),
    g(108, "Estrategia en tiempo real", "genre"),
    g(68, "Por turnos", "genre"),
    g(67, "Táctica", "genre"),
    g(94, "Gran estrategia", "genre"),
    g(88, "4X", "genre"),
    g(65, "Supervivencia", "genre"),
    g(164, "Fabricación", "genre"),
    g(92, "Exploración", "genre"),
    g(95, "Plataformas", "genre"),
    g(93, "Aventura de plataformas", "genre"),
    g(84, "Puzles", "genre"),
    g(96, "Point & click", "genre"),
    g(111, "Novela visual", "genre"),
    g(110, "Ficción interactiva", "genre"),
    g(109, "Película interactiva", "genre"),
    g(280, "Detectives", "genre"),
    g(70, "Carreras", "genre"),
    g(58, "Conducción", "genre"),
    g(76, "Deportes", "genre"),
    g(100, "Fútbol", "genre"),
    g(71, "Simulación", "genre"),
    g(73, "Gestión", "genre"),
    g(129, "Tower defense", "genre"),
    g(75, "Sigilo", "genre"),
    g(78, "Lucha", "genre"),
    g(62, "Beat 'em up", "genre"),
    g(63, "Hack and slash", "genre"),
    g(104, "Shoot 'em up", "genre"),
    g(266, "Bullet hell", "genre"),
    g(214, "Roguelike", "genre"),
    g(120, "Mazmorras", "genre"),
    g(201, "Construcción de mazos", "genre"),
    g(166, "Cartas", "genre"),
    g(153, "Ritmo", "genre"),
    g(134, "Sandbox", "genre"),
    g(60, "Arcade", "genre"),
    g(80, "Japonés", "genre"),
    g(57, "Primera persona", "view"),
    g(52, "Tercera persona", "view"),
    g(48, "Isométrico", "view"),
    g(82, "Vista cenital", "view"),
    g(79, "Scroll lateral", "view"),
    g(98, "2D", "view"),
    g(107, "Fantasía", "setting"),
    g(131, "Cyberpunk", "setting"),
    g(136, "Postapocalíptico", "setting"),
    g(115, "Zombis", "setting"),
    g(225, "Medieval", "setting"),
    g(122, "Segunda Guerra Mundial", "setting"),
];

pub fn known(id: u32) -> bool {
    GENRES.iter().any(|g| g.id == id)
}

#[cfg(test)]
mod tests {
    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<u32> = super::GENRES.iter().map(|g| g.id).collect();
        ids.sort_unstable();
        let n = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), n);
        assert!(!super::known(super::super::fitgirl::ADULT_TAG));
    }
}
