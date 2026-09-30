-- 0.8.0: sin cuentas ni amigos. El perfil (resumen, marco, fondo, tema,
-- vitrinas…) se guarda en el PC, uno por perfil local; el nombre y el avatar
-- son los del perfil local. Lo que ya hubiera en una cuenta se aprovecha
-- (menos las imágenes, que estaban en el servidor).
CREATE TABLE profile_page (
  profile_id     INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  real_name      TEXT NOT NULL DEFAULT '',
  country        TEXT NOT NULL DEFAULT '',
  bio            TEXT NOT NULL DEFAULT '',
  -- URL ejg-media de una imagen propia (o NULL).
  background_img TEXT,
  -- Objetos de serie del kit (marco, fondo animado, tema) por su id.
  frame          TEXT NOT NULL DEFAULT '',
  background     TEXT NOT NULL DEFAULT '',
  color          TEXT NOT NULL DEFAULT '',
  showcases      TEXT NOT NULL DEFAULT '[]',
  featured_badge TEXT NOT NULL DEFAULT '',
  updated_at     INTEGER NOT NULL
);

INSERT INTO profile_page (profile_id, real_name, country, bio, frame, background, color, showcases, featured_badge, updated_at)
SELECT profile_id,
       COALESCE(json_extract(cache, '$.me.profile.realName'), ''),
       COALESCE(json_extract(cache, '$.me.profile.country'), ''),
       COALESCE(json_extract(cache, '$.me.profile.bio'), ''),
       COALESCE(json_extract(cache, '$.me.profile.frame'), ''),
       COALESCE(json_extract(cache, '$.me.profile.background'), ''),
       COALESCE(json_extract(cache, '$.me.profile.color'), ''),
       COALESCE(json_extract(cache, '$.me.profile.showcases'), '[]'),
       COALESCE(json_extract(cache, '$.me.profile.featuredBadge'), ''),
       CAST(strftime('%s', 'now') AS INTEGER)
FROM accounts
WHERE cache IS NOT NULL AND json_valid(cache) AND json_type(cache, '$.me.profile') = 'object';

DROP TABLE accounts;

-- Historial de cada perfil: partidas, logros y juegos completados. No depende
-- de la biblioteca (desinstalar un juego no lo borra, por eso guarda el
-- título): de aquí salen la actividad del perfil y el resumen del año.
CREATE TABLE activity (
  id         INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- played | achievement | completed
  kind       TEXT NOT NULL,
  game_id    INTEGER REFERENCES games(id) ON DELETE SET NULL,
  game       TEXT NOT NULL,
  -- Fin de la partida o momento del logro.
  at         INTEGER NOT NULL,
  -- played: {start, seconds}; achievement: {api, name, appid, icon, rarity}.
  data       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX activity_profile ON activity (profile_id, at DESC);

INSERT INTO activity (profile_id, kind, game_id, game, at, data)
SELECT s.profile_id, 'played', s.game_id, g.title, s.ended_at, json_object('start', s.started_at, 'seconds', s.duration_s)
FROM sessions s JOIN games g ON g.id = s.game_id
ORDER BY s.ended_at;

INSERT INTO activity (profile_id, kind, game_id, game, at, data)
SELECT u.profile_id, 'achievement', u.game_id, g.title, u.unlocked_at,
       json_object('api', u.api_name, 'name', COALESCE(d.name, u.api_name), 'appid', d.appid, 'icon', d.icon, 'rarity', d.global_pct)
FROM achievement_unlocks u
JOIN games g ON g.id = u.game_id
JOIN profiles p ON p.id = u.profile_id
LEFT JOIN achievement_defs d ON d.game_id = u.game_id AND d.api_name = u.api_name
ORDER BY u.unlocked_at;
