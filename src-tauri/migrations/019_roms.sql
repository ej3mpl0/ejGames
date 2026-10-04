-- 1.3.0: ROMs propias y homebrew. Lo leído del propio archivo (TitleID, versión,
-- región, serie) y el DLC y las actualizaciones, que no son juegos aparte: se
-- enganchan al juego base por su TitleID.
ALTER TABLE games ADD COLUMN rom_meta TEXT;
CREATE TABLE rom_extras (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  base_title_id TEXT NOT NULL,
  title_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- update | dlc
  version TEXT,
  path TEXT NOT NULL UNIQUE,
  added_at INTEGER NOT NULL
);
CREATE INDEX rom_extras_base ON rom_extras (platform, base_title_id);
