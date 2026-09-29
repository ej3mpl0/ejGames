-- Cuentas de ejGames: usuarios, sesiones, perfiles, amigos, presencia,
-- imágenes, comentarios y actividad.
--
-- `users.rev` cambia cuando cambia algo que ese usuario ve (sus amigos, sus
-- solicitudes, la presencia o el perfil de un amigo, un comentario en su
-- perfil): el sondeo /v1/sync solo lee esa fila si no ha cambiado nada.

CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  username    TEXT NOT NULL,
  username_lc TEXT NOT NULL UNIQUE,
  -- Para añadir amigos sin saber el nombre: 9 cifras.
  friend_code TEXT NOT NULL UNIQUE,
  -- sha256(sal ‖ clave). La clave la deriva el cliente con argon2id.
  pw_salt     BLOB NOT NULL,
  pw_hash     BLOB NOT NULL,
  rc_salt     BLOB NOT NULL,
  rc_hash     BLOB NOT NULL,
  created_at  INTEGER NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE profiles (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name   TEXT NOT NULL,
  real_name      TEXT NOT NULL DEFAULT '',
  country        TEXT NOT NULL DEFAULT '',
  bio            TEXT NOT NULL DEFAULT '',
  -- Hashes de /v1/media (o NULL).
  avatar         TEXT,
  background_img TEXT,
  -- Objetos de serie del kit (marco, fondo animado, color) por su id.
  frame          TEXT NOT NULL DEFAULT '',
  background     TEXT NOT NULL DEFAULT '',
  color          TEXT NOT NULL DEFAULT '',
  showcases      TEXT NOT NULL DEFAULT '[]',
  featured_badge TEXT NOT NULL DEFAULT '',
  -- public | friends | private
  privacy        TEXT NOT NULL DEFAULT 'friends',
  -- public | friends | off
  comments       TEXT NOT NULL DEFAULT 'friends',
  updated_at     INTEGER NOT NULL
);

-- Resumen de la biblioteca que sube el cliente (juegos, horas, logros) y lo
-- que se calcula con él: experiencia, nivel e insignias.
CREATE TABLE summaries (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL,
  json       TEXT NOT NULL,
  xp         INTEGER NOT NULL DEFAULT 0,
  level      INTEGER NOT NULL DEFAULT 0,
  badges     TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

-- Una fila por pareja (a < b). state: pending | accepted | blocked.
CREATE TABLE friends (
  a            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state        TEXT NOT NULL,
  requested_by INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (a, b),
  CHECK (a < b)
);
CREATE INDEX friends_b ON friends(b);

-- status: online | away | invisible | offline. Sin latido en 15 min = desconectado.
CREATE TABLE presence (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'online',
  game       TEXT,
  game_appid INTEGER,
  since      INTEGER,
  last_seen  INTEGER NOT NULL
);

-- Avatares, fondos y capturas de la vitrina (D1 limita las filas a 2 MB).
CREATE TABLE media (
  hash       TEXT PRIMARY KEY,
  owner      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX media_owner ON media(owner, kind);

CREATE TABLE comments (
  id           INTEGER PRIMARY KEY,
  profile_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX comments_profile ON comments(profile_user, id);

-- Actividad: jugó a…, consiguió un logro, completó un juego, nueva insignia.
CREATE TABLE activity (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX activity_user ON activity(user_id, id);
