-- Juegos de consola: sistema (snes, ps2…) y archivo de la ROM. NULL en los de PC.
ALTER TABLE games ADD COLUMN platform TEXT;
ALTER TABLE games ADD COLUMN rom_path TEXT;
CREATE INDEX games_platform ON games (platform);
