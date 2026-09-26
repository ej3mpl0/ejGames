-- Las coincidencias automáticas dudosas (< 0.82) de versiones anteriores
-- aplicaban datos y arte de otro juego. Se descartan y el juego se vuelve a
-- buscar con el umbral nuevo (el título lo repone el siguiente escaneo o
-- importación). Los juegos de Steam no: su appid viene de la propia tienda.
DELETE FROM media
 WHERE source IN ('steam', 'sgdb', 'igdb')
   AND game_id IN (SELECT id FROM games
                    WHERE meta_status = 'review' AND COALESCE(match_confidence, 0) < 0.82 AND source <> 'steam');

UPDATE games
   SET meta_status = 'pending', match_confidence = NULL, steam_appid = NULL,
       description = NULL, short_description = NULL, developer = NULL, publisher = NULL,
       release_date = NULL, genres = '[]', tags = '[]', rating = NULL
 WHERE meta_status = 'review' AND COALESCE(match_confidence, 0) < 0.82 AND source <> 'steam';
