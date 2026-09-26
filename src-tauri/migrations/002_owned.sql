-- Juegos que tienes en una tienda pero no están instalados.
ALTER TABLE games ADD COLUMN installed INTEGER NOT NULL DEFAULT 1;
ALTER TABLE games ADD COLUMN install_uri TEXT;
CREATE INDEX games_installed ON games (installed);
