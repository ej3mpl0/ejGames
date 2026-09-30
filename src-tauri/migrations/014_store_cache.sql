-- 0.8.1: las fichas de la tienda dicen si el crack es de hipervisor (HV). Lo
-- guardado antes no lo sabe: fuera la caché de la tienda (se vuelve a pedir al
-- entrar). El arte de Steam (claves "steamart:…") se queda.
DELETE FROM metadata_cache WHERE provider = 'explore' AND key LIKE 'fg:%';
