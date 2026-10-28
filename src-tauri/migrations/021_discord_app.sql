-- El juego de Discord elegido a mano, cuando un port no se reconoce solo.
ALTER TABLE games ADD COLUMN discord_app_id TEXT;
ALTER TABLE games ADD COLUMN discord_app_name TEXT;
