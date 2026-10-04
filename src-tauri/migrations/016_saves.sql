-- Partidas guardadas: rutas que añade el usuario a mano y las copias hechas.
CREATE TABLE save_paths (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  path    TEXT NOT NULL,
  PRIMARY KEY (game_id, path)
);
CREATE TABLE save_snapshots (
  id      INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  at      INTEGER NOT NULL,
  size    INTEGER NOT NULL,
  file    TEXT NOT NULL,
  hash    TEXT NOT NULL,
  note    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX save_snapshots_game ON save_snapshots (game_id, at DESC);
