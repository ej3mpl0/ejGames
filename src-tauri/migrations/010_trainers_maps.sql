-- Trainers de FLiNG: uno por juego, con la ficha que tenía al instalarlo.
CREATE TABLE trainers (
  game_id      INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  exe          TEXT NOT NULL,
  name         TEXT NOT NULL,
  title        TEXT NOT NULL,
  page_url     TEXT NOT NULL,
  game_version TEXT,
  updated      TEXT,
  options_json TEXT NOT NULL DEFAULT '[]',
  notes_json   TEXT NOT NULL DEFAULT '[]',
  anticheat    TEXT,
  sha256       TEXT NOT NULL,
  auto_start   INTEGER NOT NULL DEFAULT 1,
  installed_at INTEGER NOT NULL
);

-- Mapas de Map Genie: el juego de Map Genie de cada juego si el usuario lo
-- eligió a mano ('' = este juego no tiene mapa) y el último mapa abierto.
CREATE TABLE game_maps (
  game_id    INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  slug       TEXT,
  map        TEXT,
  updated_at INTEGER NOT NULL
);
