-- Cuenta de ejGames ligada a un perfil local: la sesión (cifrada con DPAPI),
-- el estado elegido, los avisos de amigos y la última foto de amigos
-- (para enseñarla al instante y sin conexión).
CREATE TABLE accounts (
  profile_id     INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL,
  username       TEXT NOT NULL,
  token          BLOB NOT NULL,
  -- online | away | invisible
  status         TEXT NOT NULL DEFAULT 'online',
  notify_online  INTEGER NOT NULL DEFAULT 1,
  notify_playing INTEGER NOT NULL DEFAULT 1,
  rev            INTEGER NOT NULL DEFAULT 0,
  cache          TEXT,
  summary_hash   TEXT,
  linked_at      INTEGER NOT NULL
);
