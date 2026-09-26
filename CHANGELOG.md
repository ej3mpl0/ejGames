# Cambios

Cada versión tiene su instalador en `installer/ejGames_<versión>_x64-setup.exe`
(se genera con `pnpm release patch|minor|major`, que nunca sobrescribe uno
anterior). Al instalar una versión nueva encima de otra se conservan la
biblioteca, las horas y los ajustes; la base de datos se actualiza sola.

## 0.2.1

**Overlay**
- El atajo de teclado (Mayús+Tab) ya funciona en los juegos que Windows tiene marcados como «Ejecutar como administrador», algo que hacen muchos instaladores. Con un juego elevado delante, Windows no deja que ejGames lea el teclado, así que ahora ejGames los abre sin elevar. De paso, ya no sale el aviso de UAC al jugar.
- Si un juego necesita de verdad ser administrador, actívalo en *Editar juego → Ejecutar como administrador*. El editor avisa cuando Windows tiene esa marca o cuando el propio juego la exige.
- Si el juego se abre como administrador de todos modos, el aviso del principio de la partida lo explica y propone el botón Guía del mando. También queda anotado en el registro.

**Temas**
- Guía paso a paso para crear un tema desde cero ([`docs/GUIA-TEMAS.md`](docs/GUIA-TEMAS.md)), con el tema de ejemplo terminado en `docs/ejemplo-tema/`.
- La recarga en vivo del modo desarrollador ya funciona también al volver a abrir ejGames. Antes había que apagar y encender el modo desarrollador.
- Los temas nuevos y los cambios de `theme.json` se ven sin reiniciar: la galería vuelve a leer la carpeta al abrir Apariencia, y `theme.json` se aplica al recargar el tema. Un `theme.json` a medio escribir ya no hace saltar al tema Steam.

## 0.2.0

**Logros**
- Lee los logros de Steam desde tu PC, sin cuenta ni clave.
- Lee los de los juegos que solo tienen el `.exe` si traen un emulador de la API de Steam (Goldberg, GSE y similares). El appid sale de la configuración del emulador, aunque esté muy dentro de la carpeta.
- Nombres en español, iconos y rareza vienen de Steam.
- El tema Steam muestra los logros en la ficha del juego; los demás temas, un resumen.
- Los temas pueden leerlos con `ejg.game.achievements(id)`.

**Overlay dentro del juego** (sin inyectar nada en el juego)
- Aviso al desbloquear un logro, con icono, rareza y sonido, en el monitor donde está el juego.
- Panel con Mayús+Tab o el botón Guía (o Select + Start): tus logros, el tiempo de sesión y la hora.
- Funciona en ventana, en ventana sin bordes y en la pantalla completa optimizada de Windows. Con pantalla completa exclusiva de verdad, al cerrar el juego sale un resumen.
- El atajo solo se captura con el juego delante. También funciona en juegos que bloquean los atajos globales.
- La ventana del overlay solo existe mientras se ve algo. En modo ahorro, el consumo vuelve a unos 4 MB después de cada aviso.

**Discord**
- Viene configurado con la aplicación de ejGames: «Jugando a <juego>» con su portada y «Jugando desde ejGames».

**Interfaz**
- Pasar el ratón por encima ya no deja elementos marcados ni anillos de foco del mando.
- PS5 ya no desliza la fila al pasar el ratón, y Cinema ya no da saltos.
- Con mando se oculta el cursor.
- El editor de juego no lanza el juego dos veces con un doble clic.

**Biblioteca**
- Mejor limpieza de nombres de carpeta: sin versiones, sin guiones y con mayúsculas.
- Las coincidencias dudosas ya no aplican el título ni los datos de otro juego. Las de versiones anteriores se deshacen solas al actualizar.
- Se puede añadir una unidad entera (`E:\`).
- Si una tienda detecta instalado en tu carpeta un juego que ya tenía, se fusionan las dos fichas conservando horas, favoritos, colecciones y logros.
- «Volver a descargar todo» respeta lo que elegiste a mano.
- Vaciar la URI de lanzamiento en el editor la borra de verdad.

**Rendimiento y robustez**
- Al arrancar solo se revisan las carpetas que han cambiado.
- La búsqueda de logros en la carpeta de cada juego se guarda y se repite menos.
- La importación de tiendas no vuelve a analizar juegos que ya conoce.
- Salir de ejGames con un juego abierto guarda la sesión.
- Las imágenes pedidas dos veces a la vez se descargan una sola vez.
- Ya no se cierra con nombres de logros no ASCII ni con juegos de nombre genérico.
- Se escribe un registro en `%APPDATA%\ejGames\logs\ejgames.log`.

## 0.1.0

Primera versión:
- Carpetas con detección de juegos por su `.exe`.
- Importación de Steam, Epic, GOG, Ubisoft y EA, instalados y comprados.
- Metadatos y arte de Steam, SteamGridDB e IGDB, con tráilers.
- Seis temas de serie (Steam, PS5, Xbox, Switch, Cinema y Retro) personalizables con código completo.
- Perfiles, horas y estadísticas.
- Discord Rich Presence.
- Mando y Big Picture.
- Modo ahorro al jugar.
