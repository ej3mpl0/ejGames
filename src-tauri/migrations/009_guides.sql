-- Guías de Steam: las guardadas por cada perfil (salen primero y se leen sin
-- conexión) y por dónde va leyendo cada una.
CREATE TABLE guide_pins (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  guide_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  author     TEXT,
  preview    TEXT,
  pinned_at  INTEGER NOT NULL,
  PRIMARY KEY (profile_id, guide_id)
);
CREATE INDEX guide_pins_game ON guide_pins(profile_id, game_id);

CREATE TABLE guide_progress (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  guide_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT '',
  preview    TEXT,
  section    INTEGER NOT NULL DEFAULT 0,
  scroll     REAL NOT NULL DEFAULT 0,
  read_at    INTEGER NOT NULL,
  PRIMARY KEY (profile_id, guide_id)
);
CREATE INDEX guide_progress_game ON guide_progress(profile_id, game_id, read_at DESC);
