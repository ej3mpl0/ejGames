-- Repacks instalados que tienen una versión más nueva en la tienda. Una fila por
-- juego; `dismissed_version` es la última que el usuario dijo que no le interesa.
CREATE TABLE repack_updates (
  game_id           INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  installed_version TEXT NOT NULL,
  latest_version    TEXT NOT NULL,
  checked_at        INTEGER NOT NULL,
  dismissed_version TEXT
);
