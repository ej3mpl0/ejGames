-- Logros. Las fuentes (estadísticas locales de Steam, ficheros de emuladores)
-- son del PC y no de un perfil, así que los desbloqueos son globales; se guarda
-- qué perfil jugaba cuando se detectó cada uno.

CREATE TABLE achievement_defs (
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  api_name    TEXT NOT NULL,
  appid       INTEGER,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  icon_gray   TEXT,
  hidden      INTEGER NOT NULL DEFAULT 0,
  global_pct  REAL,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, api_name)
) WITHOUT ROWID;

CREATE TABLE achievement_unlocks (
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  api_name    TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  source      TEXT NOT NULL,
  profile_id  INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (game_id, api_name)
) WITHOUT ROWID;

CREATE INDEX idx_ach_unlocks_time ON achievement_unlocks(unlocked_at DESC);
