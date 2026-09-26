CREATE TABLE library_folders (
  id        INTEGER PRIMARY KEY,
  path      TEXT NOT NULL UNIQUE,
  mode      TEXT NOT NULL DEFAULT 'subfolders',   -- subfolders | single
  enabled   INTEGER NOT NULL DEFAULT 1,
  last_scan INTEGER
);

CREATE TABLE games (
  id                INTEGER PRIMARY KEY,
  title             TEXT NOT NULL,
  sort_title        TEXT NOT NULL,
  source            TEXT NOT NULL,                -- folder|steam|epic|gog|ea|ubisoft|manual
  source_id         TEXT NOT NULL,
  folder_id         INTEGER REFERENCES library_folders(id) ON DELETE CASCADE,
  install_dir       TEXT,
  exe_path          TEXT,
  args              TEXT NOT NULL DEFAULT '',
  working_dir       TEXT,
  launch_uri        TEXT,
  run_as_admin      INTEGER NOT NULL DEFAULT 0,
  process_hints     TEXT NOT NULL DEFAULT '[]',
  engine            TEXT,
  steam_appid       INTEGER,
  sgdb_id           INTEGER,
  igdb_id           INTEGER,
  description       TEXT,
  short_description TEXT,
  developer         TEXT,
  publisher         TEXT,
  release_date      TEXT,
  genres            TEXT NOT NULL DEFAULT '[]',
  tags              TEXT NOT NULL DEFAULT '[]',
  rating            INTEGER,
  meta_status       TEXT NOT NULL DEFAULT 'pending', -- pending|matched|review|manual|failed
  match_confidence  REAL,
  meta_locked       TEXT NOT NULL DEFAULT '[]',
  discord_enabled   INTEGER NOT NULL DEFAULT 1,
  missing           INTEGER NOT NULL DEFAULT 0,
  added_at          INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX games_install ON games (install_dir COLLATE NOCASE);
CREATE INDEX games_meta ON games (meta_status);

CREATE TABLE game_exes (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  path    TEXT NOT NULL,
  score   REAL NOT NULL,
  PRIMARY KEY (game_id, path)
);

CREATE TABLE media (
  id         INTEGER PRIMARY KEY,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,     -- cover|hero|logo|icon|screenshot|microtrailer|trailer
  remote_url TEXT,
  hash       TEXT,
  ext        TEXT,
  thumb_hash TEXT,
  w          INTEGER,
  h          INTEGER,
  source     TEXT NOT NULL,     -- steam|sgdb|igdb|exe|user
  selected   INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  title      TEXT,
  extra      TEXT
);
CREATE INDEX media_game ON media (game_id, kind, selected);

CREATE TABLE profiles (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  avatar             TEXT,
  color              TEXT NOT NULL DEFAULT '#3b82f6',
  theme_id           TEXT NOT NULL DEFAULT 'steam',
  theme_settings     TEXT NOT NULL DEFAULT '{}',
  custom_css         TEXT NOT NULL DEFAULT '{}',
  pin_hash           TEXT,
  discord_enabled    INTEGER NOT NULL DEFAULT 1,
  discord_hide_names INTEGER NOT NULL DEFAULT 0,
  launch_behavior    TEXT NOT NULL DEFAULT 'minimize', -- none|minimize|saver
  sounds_volume      REAL NOT NULL DEFAULT 0.6,
  created_at         INTEGER NOT NULL,
  last_used          INTEGER
);

CREATE TABLE profile_game (
  profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  favorite     INTEGER NOT NULL DEFAULT 0,
  hidden       INTEGER NOT NULL DEFAULT 0,
  last_played  INTEGER,
  playtime_s   INTEGER NOT NULL DEFAULT 0,
  launch_count INTEGER NOT NULL DEFAULT 0,
  user_rating  INTEGER,
  notes        TEXT,
  PRIMARY KEY (profile_id, game_id)
);

CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER NOT NULL,
  duration_s INTEGER NOT NULL
);
CREATE INDEX sessions_profile ON sessions (profile_id, started_at);

CREATE TABLE collections (
  id         INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'manual', -- manual|smart
  rules      TEXT NOT NULL DEFAULT '{}',
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE collection_games (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  pos           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, game_id)
);

CREATE TABLE theme_storage (
  profile_id INTEGER NOT NULL,
  theme_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (profile_id, theme_id, key)
);

CREATE TABLE metadata_cache (
  provider   TEXT NOT NULL,
  key        TEXT NOT NULL,
  json       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (provider, key)
);
