-- El modo juego pasa de ajuste global a ajuste de cada perfil.
ALTER TABLE profiles ADD COLUMN game_mode_power INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN game_mode_dnd INTEGER NOT NULL DEFAULT 0;
