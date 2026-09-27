-- Descargas de Explorar (repacks por torrent). El .torrent se guarda entero:
-- se puede volver a añadir al motor sin buscar los metadatos otra vez.
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,           -- "fitgirl:<id de la entrada>"
  slug TEXT,
  title TEXT NOT NULL,
  version TEXT,
  page_url TEXT,
  cover_url TEXT,
  hero_url TEXT,
  magnet TEXT NOT NULL,
  info_hash TEXT NOT NULL UNIQUE,    -- hex en minúsculas
  torrent BLOB NOT NULL,
  torrent_name TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  selected_files TEXT NOT NULL DEFAULT '[]',
  file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  done_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  -- queued | downloading | paused | seeding | completed | installing | installed | error
  state TEXT NOT NULL DEFAULT 'queued',
  -- Por qué está parada: user | queue | playing | install
  pause_reason TEXT,
  queue_pos INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  install_size TEXT,
  install_dir TEXT,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  added_at INTEGER NOT NULL,
  completed_at INTEGER,
  installed_at INTEGER,
  files_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX downloads_state ON downloads(state, queue_pos);
CREATE INDEX downloads_source ON downloads(source_id);
