-- Raíces de unidad guardadas como "E:" (Windows lo trata como relativo al
-- directorio actual de E:): pasan a "E:\".
UPDATE library_folders SET path = path || '\'
 WHERE length(path) = 2 AND substr(path, 2, 1) = ':';

-- Las coincidencias "review" ya no guardan appid (la próxima vez se daría por
-- seguro): se olvida el de versiones anteriores para volver a buscarlo.
UPDATE games SET steam_appid = NULL
 WHERE meta_status = 'review' AND source NOT IN ('steam');

-- El escaneo al arrancar ahora es incremental (salta lo que no ha cambiado):
-- uno completo tras actualizar, para aplicar la limpieza de nombres nueva.
UPDATE library_folders SET last_scan = NULL;
