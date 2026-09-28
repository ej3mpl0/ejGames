-- Overlay: notas de cada juego (por perfil) y capturas de pantalla.
CREATE TABLE game_notes (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, game_id)
);

CREATE TABLE screenshots (
  id         INTEGER PRIMARY KEY,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  thumb      TEXT NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  taken_at   INTEGER NOT NULL
);
CREATE INDEX screenshots_game ON screenshots(game_id, taken_at DESC);
