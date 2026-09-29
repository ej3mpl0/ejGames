-- Lista de deseados de la tienda, por perfil local. Se guarda la ficha tal cual
-- (URLs originales) y al leerla se publica como el resto de la tienda: su
-- estado (descargando, instalado, en tu biblioteca) y sus imágenes, al día.
CREATE TABLE wishlist (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  repack     TEXT NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (profile_id, slug)
);
CREATE INDEX wishlist_added ON wishlist (profile_id, added_at DESC);
