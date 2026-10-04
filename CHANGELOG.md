# Cambios

Cada versión tiene su instalador en `installer/ejGames_<versión>_Setup.exe`
(se genera con `pnpm release patch|minor|major`, que nunca sobrescribe uno
anterior). Al instalar una versión nueva encima de otra se conservan la
biblioteca, las horas y los ajustes; la base de datos se actualiza sola.

## 1.3.0

**ROMs propias**
- **Importar ROMs** (Ajustes → Biblioteca, y Tienda → Software): por archivos o por carpeta, con los `.zip` y `.7z`
  descomprimidos. El sistema sale de la extensión y, si vale para varios, de la cabecera (un `.iso` o `.cso` de PSP,
  PS2, PS1, GameCube o Wii; un `.cue` de Saturn o PlayStation). Se copian ordenadas a `roms\<sistema>` en la carpeta de
  datos (una carpeta de la biblioteca por sistema) o se juegan donde están.
- Nuevos sistemas: **PS Vita** (`.vpk`) y **Nintendo 3DS** (`.3ds`, `.cci`, `.cxi`, `.3dsx`; los `.cia` se instalan en el
  emulador). Switch admite también `.nca` y `.nro`.
- De la propia ROM se lee lo que trae en claro: TitleID, versión, región, serie y nombre interno (Switch, 3DS, Vita,
  PSP, PS1, PS2, GameCube, Wii, N64, SNES, GBA, DS). Las **actualizaciones y DLC** de Switch, 3DS y Vita no salen como
  juegos aparte: se enganchan a su juego por el TitleID.
- **Carátulas sin clave**: si IGDB y SteamGridDB no dan portada, se busca en libretro-thumbnails por el nombre del
  archivo.

**Jugar**
- Si el emulador elegido para un sistema no está, ejGames usa el que haya: el instalado desde Software (en Switch, Eden o
  Ryujinx) o, buscándolo, uno del disco. Vita3K arranca por su TitleID los `.vpk` ya instalados.
- **Partidas guardadas** de los juegos de consola: las de su emulador (RetroArch, PCSX2, DuckStation, PPSSPP, Eden,
  Ryujinx, Vita3K, Azahar, RPCS3, Cemu, Dolphin), con las mismas copias al cerrar el juego.
- **Tienda → Software** suma **Azahar** (3DS) y **Vita3K** (PS Vita).

**Explorar → Homebrew**
- Software libre o redistribuible para **Switch** (hb-appstore), **PS Vita** (VitaDB) y **3DS** (Universal-DB), con
  búsqueda, categorías, orden y páginas. Cada ficha dice con qué emulador se juega (o si es solo para la consola real).
- **Instalar** lo baja (de uno en uno), lo descomprime y lo deja en la biblioteca con su icono, capturas y descripción,
  listo para **Jugar**. Se actualiza y se quita desde ahí.

**En los seis temas**
- Entrada **Homebrew** en la tienda; apartado **ROMs** en la biblioteca, agrupado por sistema; en la ficha de cada juego
  de consola, «Requiere emulador: …» con su TitleID, versión, región, actualización y DLC (o el botón para instalar el
  emulador).

**Para temas**
- Kit: `isRom`, `roms`, `romsBySystem`, `systemName`, `romParts` (`library.js`) y `emulatorNote(juego)`
  (`emulator.js`). Los juegos traen `emulator` y `rom`; `ejg.ui.open("homebrew" | "rom-import")`.

## 1.2.0

**Software en la biblioteca**
- Los emuladores instalados desde la tienda salen en la biblioteca de los seis temas, en su apartado **Software**,
  aparte de los juegos: se abren desde ejGames para poner sus claves, firmware o BIOS. Los que ya tenías instalados
  se añaden solos al arrancar.
- En **Tienda → Software**, cada emulador instalado tiene «Abrir», «Añadir juegos» (la carpeta de juegos de su
  consola) y «Carpeta», y un aviso de lo que pide antes del primer juego.

**Juegos de consola sueltos**
- **Ajustes → Biblioteca → Añadir un juego a mano** acepta ROMs (`.nsp`, `.xci`, `.iso`…): ejGames reconoce la consola
  por la extensión (si vale para varias, primero las que tienen emulador, y si no, pregunta) y al darle a **Jugar** se
  abre su emulador con el juego.
- Al añadir una carpeta, si es de juegos de consola, propone «Juegos de <consola> (ROMs)».

**Para temas**
- Kit: `isSoftware(juego)` y `software(juegos)`; `visible()` deja fuera los programas.
- Xbox: el «null» que salía bajo los filtros de «Mi colección».

## 1.1.0

**Tienda → Software: emuladores con un clic**
- Nuevo apartado **Software** en la tienda de los seis temas y en Explorar (también desde Ajustes → Biblioteca → Consolas →
  «Descargar emuladores»). Instala RetroArch, PCSX2, DuckStation, PPSSPP, Cemu, RPCS3 y Eden desde su fuente oficial
  (GitHub, el servidor de Eden o el de libretro), con la huella comprobada cuando la publican, en `emulators`, dentro de la
  carpeta de datos.
- Al instalarlo, el emulador queda puesto para sus sistemas: solo falta añadir la carpeta de ROMs. Se actualiza (avisa
  cuando hay versión nueva) y se quita desde ahí; la carpeta `user` de cada emulador se conserva al actualizar.
- **Núcleos de RetroArch**: lista los sistemas que juegas con RetroArch y baja el núcleo que les falta.
- Dolphin se baja de su web (tiene protección anti-bots) y luego «Buscar emuladores» lo encuentra.
- ejGames no incluye ni descarga juegos, BIOS, claves ni firmware.

**Nintendo Switch**
- Nuevo sistema Switch (`.nsp`, `.xci`) con los presets de Eden y Ryujinx. Necesita las claves y el firmware de tu
  propia consola.

**Modo juego por perfil**
- El modo juego (plan de energía y «No molestar») pasa a **Ajustes → Perfil**: cada perfil decide. Lo que tenías puesto
  se pasa a todos los perfiles.

**Más completo**
- Bloque **Partidas** en el panel del overlay de las siete pieles: última copia y «Copia ahora».
- **Descargas → Actualizaciones**: los juegos con un repack más nuevo, con «Ver en la tienda» y «Ocultar».
- Textos que faltaban en inglés (emuladores y copias de seguridad); `pnpm i18n:check` ya no se salta los textos de `t()`
  que acaban en un hueco.

## 1.0.0

**ejGames en inglés (y en español)**
- Toda la interfaz está en los dos idiomas: ventanas del host, overlay y avisos, los seis temas y los mensajes del núcleo
  y de la bandeja. **Ajustes → Sistema → Idioma**: el de Windows (por defecto), español o English; también se cambia en el
  primer paso del asistente. Fechas, números y horas siguen el idioma.
- Los temas escritos en español se traducen con un diccionario (`<tema>/i18n/en.json`), sin tocar su código: ejGames
  traduce solo los textos que pinta el tema y sus ajustes de `theme.json`. Ver [Idiomas](https://ej3mplo.mintlify.site/referencia/idiomas).

**Volver a una versión anterior**
- Ajustes → Sistema → «Volver a una versión anterior»: lista las versiones publicadas en GitHub y reinstala la que
  elijas, con su huella comprobada. Antes guarda una copia de la biblioteca en `rollback`, en la carpeta de datos.

**Más fiable**
- `pnpm check` comprueba tipos, sintaxis de los temas y del SDK, los `theme.json` y que no falte ningún texto por traducir.
  `pnpm i18n:check --wide` lista lo que falta.

**Para temas**
- `ejg.lang`, `ejg.locale`, `ejg.t()` y `ejg.tn()`; `ejg.translate(raíz)` y el atributo `data-t` para traducir a mano.
- El módulo `/_sdk/kit/translate.js` (el mismo traductor que usa ejGames).

## 0.12.0

**Juegos de consola**
- Ajustes → Biblioteca → Consolas: añade una carpeta de ROMs de un sistema (NES, Super Nintendo, Game Boy / Color /
  Advance, Nintendo DS y 64, GameCube, Wii, Wii U, Master System, Mega Drive, Game Gear, Saturn, Dreamcast, PC Engine,
  PlayStation 1, 2, 3 y PSP, arcade) y ejGames crea un juego por ROM.
- Cada sistema se juega con RetroArch (y un núcleo), con un emulador independiente (PCSX2, Dolphin, PPSSPP,
  DuckStation, Cemu o RPCS3) o con el programa que tú elijas y sus argumentos. «Buscar emuladores» los encuentra en
  los sitios habituales. Las horas, el overlay y Discord funcionan igual que con un juego de PC.
- La portada y los datos salen de IGDB (con la clave de Ajustes → Info y arte) y de SteamGridDB, buscando en el
  sistema correcto. Cada sistema tiene su colección inteligente, que los temas ya enseñan como filtro.
- Una ROM no se desinstala: así nunca se borra la carpeta de ROMs.

**Cuánto dura cada juego**
- En la ficha de cada juego, las horas de historia, con extras y completista de
  [HowLongToBeat](https://howlongtobeat.com), con una barra de las que llevas. Se puede desactivar en
  Ajustes → Info y arte.

**Tu año en ejGames**
- Estadísticas → «Tu año»: un repaso en tarjetas de tus horas, juegos, mes, hora y día favoritos, racha, partida más
  larga, géneros y logros (el más raro). Del 1 de diciembre al 15 de enero, ejGames te avisa una vez.

**Temas de la comunidad**
- Ajustes → Apariencia → De la comunidad: temas de otras personas, que se instalan con un clic. La lista vive en el
  repositorio de ejGames (`community/`); ejGames comprueba la huella SHA-256 de cada descarga antes de instalarla.

**Para temas**
- `ejg.game.hltb(id)`, `ejg.stats.year(año)` y `howLongNote(g)` en `/_sdk/kit/hltb.js`.
- Los juegos de consola traen `platform`; las colecciones inteligentes admiten la regla `platform`.

## 0.11.0

**Copias de las partidas guardadas**
- Al cerrar un juego, ejGames copia sus partidas guardadas (solo si han cambiado) y guarda las últimas 10. Dónde las
  guarda cada juego sale del manifiesto de [Ludusavi](https://github.com/mtkennerly/ludusavi-manifest) (más de 12.000
  juegos), de las carpetas de los emuladores de Steam (Goldberg, GSE…) y de Steam Cloud. Se baja cada dos semanas.
- Editar juego → Partidas guardadas: dónde están, copias hechas, «Hacer una copia ahora» y «Restaurar» (con el juego
  cerrado; antes de restaurar se copian las de ahora). Si no las encuentra, añades la carpeta a mano.
- Se puede desactivar ahí mismo.

**FPS en el overlay** (Ajustes → Overlay → Mostrar FPS, desactivado de serie)
- FPS, 1 % bajo y tiempo de fotograma en el panel, sin tocar el juego: se leen los eventos de presentación que Windows
  ya emite (como PresentMon). Funciona con juegos DirectX 9, 10, 11 y 12; con Vulkan y OpenGL el panel lo dice.
- Windows exige permiso para leerlos: el botón «Dar permiso para medir FPS» te mete una sola vez en el grupo
  «Usuarios del registro de rendimiento» (aviso de Windows) y, tras volver a iniciar sesión en Windows, funciona sin ser
  administrador.

**Para temas**
- `ejg.saves.info(id)`, `ejg.saves.backup(id)`, `ejg.saves.restore(id, copia)` y el evento `ejg.saves.onChange`.

## 0.10.0

**Copias de seguridad y llevarte la biblioteca a otro PC**
- Ajustes → Sistema → Copias de seguridad: guarda en un .zip tu biblioteca, horas, logros, perfiles, notas,
  colecciones, ajustes y temas propios (y, si quieres, el arte descargado). Restaurarla reinicia ejGames; lo que había
  se guarda en la carpeta de datos, en `.before-restore`.
- Copias automáticas en la carpeta que elijas, como mucho una al día, guardando las últimas 3, 5, 10 o 20.
- Si esa carpeta está en OneDrive o Google Drive, tu biblioteca te sigue: en el otro PC, ejGames avisa de que hay una
  copia más nueva y la restauras con un clic. También se puede restaurar desde el asistente de bienvenida.

**Aviso de repack nuevo**
- Cuando la tienda tiene una versión más nueva de un juego que instalaste desde Descargas, su ficha lo dice (v1.03 →
  v1.04) con «Ver en la tienda» y «Ocultar». Se comprueba al abrir ejGames, como mucho cada 12 horas.

**Modo juego** (Ajustes → Sistema, desactivado de serie)
- Mientras juegas: plan de energía de alto rendimiento y notificaciones de Windows en silencio. Al cerrar el juego
  vuelve todo como estaba, y si ejGames se cae con el modo puesto, lo deshace al abrirse.

**Lanzar desde fuera de ejGames**
- En Editar juego: acceso directo en el escritorio y «Añadir a Steam». Los dos abren `ejgames.exe --play <id>`, así
  que se cuentan las horas y salen el overlay y Discord. Con Steam cerrado; Steam dará el juego por cerrado enseguida
  (las horas se cuentan en ejGames).

**Idioma**
- Ajustes → Sistema → Idioma (el de Windows, español o English). Es la base: los textos en inglés llegan con la 1.0.

**Para temas**
- `ejg.t()`, `ejg.tn()`, `ejg.lang`, `ejg.locale` y el atributo `data-t` para traducir; las traducciones van en
  `<tema>/i18n/en.json`.
- Los juegos traen `repackUpdate`; `repackUpdateNote(g)` en `/_sdk/kit/updates.js` pinta el aviso.
- `ejg.game.shortcut(id)`, `ejg.game.addToSteam(id)`, `ejg.game.dismissRepackUpdate(id)`.

## 0.9.4

**Discord: el icono del juego en el canal de voz**
- Si Discord conoce el juego (por AppID de Steam, nombre o ruta del .exe), la presencia usa la aplicación del propio
  juego: en el canal de voz y en la lista de miembros sale su icono en vez del de ejGames. La tarjeta sigue diciendo
  «Jugando desde ejGames».
- La lista de juegos de Discord se descarga como mucho una vez por semana y se guarda en la carpeta de datos.
- Con «Ocultar el nombre del juego» se sigue usando la aplicación de ejGames.

## 0.9.3

**Juegos ocultos: ahora se encuentran**
- Los seis temas tienen un filtro «Ocultos (N)», que solo sale si hay alguno, para ver qué juegos están ocultos:
  - Steam: en el desplegable «Juegos» de la barra lateral.
  - PS5: un chip más en Biblioteca, junto a Favoritos.
  - Xbox: al final de la columna de filtros de Mi colección.
  - Switch: en «Todos los programas», las pestañas Todos / Ocultos (también con LB/RB).
  - Cinema: en la barra de arriba y en una fila al final de Inicio.
  - Retro: la pestaña HIDDEN, junto a FAV.
- En la página de un juego oculto, un aviso con el botón «Mostrar en la biblioteca». Al mostrar el último, el filtro
  vuelve a «Todos».

**Tienda Steam**
- «Novedades» en la barra de la tienda (lo último publicado).
- «Tienda» en la barra de arriba lleva siempre a «Tu tienda», vengas de donde vengas.

**Retro**
- «OPTIONS» al final de la fila de pestañas abre los ajustes del launcher.

**Arreglos**
- Switch: «Todos los programas» pintaba las fichas sin arte (a 0×0).
- Xbox: con el mando, subir desde «Jugar» en la página de un juego saltaba a la colección de detrás.

## 0.9.2

**Tienda Steam: la portada de Halloween, como la de las rebajas de Steam**
- Todo lo de arriba es de terror y la tienda de siempre empieza en las pestañas de populares: la cabecera con tres
  cápsulas, «Ofertas de miedo», una rejilla de 16, «Recomendados para pasar miedo», «Porque te gusta el terror» (con
  sus etiquetas), el catálogo del género, otra rejilla y dos paneles («Tu lista de deseados» y «De miedo y
  ligeros», de menos de 10 GB). Sin repetir juegos entre secciones.
- Las cápsulas grandes usan el arte vertical de la biblioteca de Steam, entero y sin recortar; sin él, la carátula
  completa sobre un fondo hecho con ella. Las etiquetas van encima del arte, donde Steam pone el precio: el
  tamaño de la descarga y «NUEVO» si salió hace menos de diez días.
- Las pestañas de populares y su vista previa, en tonos de noche mientras dura el evento.

**Para temas**
- `seasonPicks(…, { pages })`: varias páginas del catálogo del género, sin duplicados.

## 0.9.1

**Modo Halloween desde hoy, con una cabecera a lo grande**
- ejGames Scream V empieza el 3 de octubre (hasta el 2 de noviembre); el banner ya lo dice: «OCT 3 - NOV 2».
- En la tienda del tema Steam, la cabecera del evento ocupa casi todo el ancho, como en las rebajas de Steam: el
  banner animado sobre la calle encantada (también animada), fundido por los bordes, con las tres cápsulas de
  terror montadas encima de su parte baja.

**Para temas**
- El evento trae `hero` y `heroVideo` (1600×560) y `seasonBanner(ev, cls, { hero: true })` los usa (clase
  `ejg-ev-hero`).

## 0.9.0

**Al cerrar: ¿bandeja o salir?**
- La X de la ventana (y Alt+F4 o «Cerrar ventana» en la barra de tareas) pregunta si minimizar a la bandeja o
  salir de ejGames del todo, con «No volver a preguntar». Avisa si hay juegos abiertos o descargas en curso.
- En Ajustes → Sistema, «Al cerrar la ventana»: Preguntar, Minimizar a la bandeja o Salir del todo. Quien tenía
  quitado «seguir en la bandeja» pasa a «Salir del todo».

**Modo Halloween: ejGames Scream V (26 oct – 2 nov)**
- Toda la app se viste de noche mientras dura: colores calabaza y violeta en los seis temas, en los ajustes, los
  diálogos y el overlay del juego; fondos ilustrados (una calle encantada, animada en bucle en el tema Steam, y un
  cementerio a la luz de la luna en el selector de perfil y la bienvenida); niebla a ras de suelo, ascuas y algún
  murciélago que cruza de vez en cuando; telarañas en las esquinas de los diálogos y una calabacita en los avisos
  de logros. Con «reducir movimiento» de Windows, todo quieto.
- La tienda de cada tema estrena portada: el banner animado del evento y la selección «Ofertas de miedo» (lo más
  popular de Terror, con «Ver todo»). En la del tema Steam, como en sus rebajas: fondo con su patrón, tres
  cápsulas con flechas y puntos y el panel naranja.
- Ajustes → Apariencia → «Modo Halloween»: en sus fechas, siempre o nunca. Lo que el usuario tenía (colores,
  fondo) vuelve solo al acabar.
- Tema Steam: el fondo personalizado (imagen) no se veía, lo tapaba el fondo de la página.

**Para temas**
- Con un evento activo, el SDK pone `data-season` en `<html>`, las variables `--ejg-season-*`, su paleta y su
  fondo en las opciones del tema (`accent`, `bg`, `panel`, `play`, `dark`, `wallpaper`) y una capa de ambiente.
  `ejg.season` (`id`, `event`, `mode`, `onChange`). En `/_sdk/kit/events.js`: `seasonOf`, `seasonBanner`,
  `seasonPicks`, `EVENTS`, `activeEvent`. El arte, en `/_sdk/events/<id>/`. Ver «Eventos de temporada» en la
  referencia.

## 0.8.1

**Tienda: juegos con crack de hipervisor (HV)**
- Los repacks con crack de hipervisor (los que la web marca como tales) llevan la etiqueta **HV** junto al nombre en
  toda la tienda: portada, filas, búsqueda, catálogo, lista de deseados y la ficha. En la ventana Explorar del
  launcher y en las seis tiendas de los temas, cada una con el estilo de su plataforma.
- Su ficha lo explica antes del botón de descargar: qué es (el crack no quita la protección, la engaña con un driver
  sin firmar que va por debajo de Windows), qué necesitas (virtualización activada en la BIOS; no hace falta tocar el
  arranque seguro), qué se desactiva mientras juegas (integridad de memoria, Credential Guard, Windows Hello, el
  hipervisor de Windows y la firma obligatoria de drivers), los pasos para jugar y para deshacerlo, y los riesgos.
  Con un botón a la guía completa de la web.
- El diálogo de descarga avisa antes de empezar, también de que el antivirus borra los archivos del crack si no se
  excluyen sus carpetas.
- Las fichas guardadas se vuelven a pedir una vez para saber cuáles son HV.

**Para temas**
- Cada `Repack` trae `hypervisor` (y la descarga preparada, `prepare().hypervisor`). El kit de la tienda trae el
  texto (`HYPERVISOR`), `repackName` (el nombre con la etiqueta, que se corta con «…» sin perderla),
  `hypervisorTag`, `hypervisorInfo` (el aviso plegable de la ficha) y `openHypervisorGuide`.

## 0.8.0

**Sin cuentas ni amigos: tu perfil, en tu PC**
- Fuera las cuentas de ejGames, los amigos, las solicitudes, el estado (en línea, ausente…), la actividad de los
  amigos y los comentarios, y con ellos el servidor (`server/`, Cloudflare Workers + D1). No hay nada que crear ni que
  tener conectado.
- El **perfil** se queda como estaba (el de Steam en Steam y el suyo en cada tema, con marco, fondo, tema del
  perfil, resumen, vitrinas, nivel e insignias), pero ahora es **de cada perfil local y se guarda en el PC**. Su nombre
  y su avatar son los del perfil local.
- Lo que tuvieras en la cuenta (resumen, país, marco, fondo, tema, vitrinas e insignia destacada) pasa solo a tu
  perfil; las imágenes que estaban en el servidor, no.
- El nivel y las insignias salen de tu biblioteca, tus horas y tus logros. La insignia Social desaparece y Veterano
  cuenta los años de tu perfil.
- **Historial** de partidas, logros y juegos completados de cada perfil, que se queda aunque desinstales el juego (se
  rellena con lo que ya había). La actividad del perfil sale de ahí, y es la base para un resumen del año.
- El perfil está en «Mi perfil» del menú rápido, en **Ajustes → Perfil** (Ver mi perfil, Editar perfil) y en cada
  tema: tu nombre junto a Biblioteca y el menú de tu foto en Steam, y un botón de Perfil en PS5, Xbox, Switch, Cine y
  Retro, donde estaba el de Amigos.
- El overlay dentro del juego pierde la pestaña Amigos y los avisos de amigos; el inicio, el paso de la cuenta.

**Para temas**
- Fuera `ejg.account`, `ejg.friends`, `ejg.comments` y `ejg.activity`. `ejg.profiles` trae tu perfil: `me` (nivel,
  avatar, marco…), `onChange`, `view()`, `open()`, `badges()` y `edit()`, además de `current()` y `switch()` (que no
  llegaban a los temas por un nombre repetido).
- El kit pasa de `social.js` / `social.css` a `profile.js` / `profile.css`: `createProfilePages` (perfil e insignias)
  en lugar de `createSocialView`, y sin `createFriendsView`. En `theme.json`, `"features": {"profile": true}` (`social`
  sigue valiendo).
- `ejg.ui.open` y `ui.onView` ya no tienen `friends`, `account` ni `account-login`.

## 0.7.3

**Tienda: lista de deseados**
- Guarda los juegos que quieres desde su ficha («Añadir a tu lista de deseados») y tenlos a mano en su sección de la
  tienda, con cuándo los añadiste, su tamaño, su estado al día (descargando, instalado, en tu biblioteca) y el botón
  para descargarlos o jugar. Se ordena por fecha, nombre, publicación o tamaño.
- Se guarda **en tu PC**, una lista por perfil local, y es la misma en todos los temas: «Lista de deseados» en
  Steam (arriba a la derecha de la tienda, como en Steam), «Lista de deseos» con su corazón en PS5, Xbox y Switch,
  «Deseados» en Cine (con su fila en la portada) y la sección DESEADOS en Retro. También en la ventana Explorar del
  host. Los juegos que tienes en la lista llevan su marca en la tienda.
- Para temas: `ejg.explore.wishlist` (items, has, toggle, onChange) y, en el kit, `sortWishlist` y `toggleWish`.

**Arreglos**
- En Cine, la ficha de un juego sin capturas enseñaba «null».

## 0.7.2

**Cada tema, su perfil**
- El perfil ya no es el de Steam en todos los temas: cada uno tiene el suyo, con el estilo de su plataforma.
  - **PS5**: portada, avatar redondo grande, nivel con su estrella y pestañas Perfil, Juegos, Insignias y Amigos.
  - **Xbox**: la franja con el color de tu perfil, la tarjeta del gamertag con tu gamerscore (tu EXP), nivel, amigos
    y juegos, y los pivotes Destacado, Juegos, Insignias y Amigos.
  - **Switch**: la página de usuario, con el menú a la izquierda (Perfil, Actividad de juego, Insignias, Amigos), tu
    icono sobre la franja y tu presentación en un bocadillo.
  - **Cine**: como la ficha de una película, con tu fondo a lo ancho, tu nombre enorme, «Seguir jugando» y filas.
  - **Retro**: la tarjeta **PLAYER 1** con tu nivel en bloques, **HI-SCORES** de tus juegos, tus insignias y el
    **GUESTBOOK**.
  - **Steam** sigue siendo la página de Steam.
- Tu marco, tu fondo y las vitrinas salen en todos; el **tema del perfil** pone el color de tu perfil en los demás
  temas (en Steam, sus colores de siempre). El overlay de cada plataforma usa también su perfil, y la vista previa
  del editor enseña el del tema que usas.

**Arreglos del perfil**
- **Guardar** en «Editar perfil» ya no te saca del editor, y el perfil de detrás se pone al día solo (antes no
  cambiaba hasta volver a entrar). «Guardar» solo se activa si hay cambios y avisa de lo que queda sin guardar.
- **Vitrinas**: el desplegable para elegir el juego se cortaba dentro de la tarjeta; ahora se ve entero. Las
  vitrinas sin datos ya no desaparecen: en tu perfil salen con lo que les falta («Elige el juego…», «Añade
  capturas…») y las que se rellenan solas lo dicen («Todavía no hay insignias…»). Para el juego destacado se
  pueden elegir los mismos juegos que salen en el perfil.
- En el tema Steam, amigos, perfiles e insignias van a página entera, **sin la barra lateral de la biblioteca**.

## 0.7.1

**Tu perfil, 1:1 como el de Steam**
- La página de perfil es ahora la de Steam pieza a pieza: cabecera con el avatar de 166 px (con el color de tu
  estado), nombre, nombre real, país y resumen («Ver más información»), el círculo de **Nivel**, tu **insignia
  destacada** con su EXP y los botones de Steam («Añadir amigo», «Más ▾» con eliminar y bloquear).
- Debajo, las **vitrinas** con su barra en degradado (juego destacado y favorito, estadísticas, vitrina de logros,
  coleccionista de insignias, capturas e información personalizada), la **actividad reciente** («46 h registradas ·
  última sesión: 28 SEP», barra de logros y horas de las últimas dos semanas) y los **comentarios** con su «Publicar
  comentario».
- A la derecha, tu estado («Actualmente jugando / en línea / Sin conexión»), tus insignias, juegos, capturas y tus
  **amigos** con su nivel.
- Los **temas de perfil** de Steam: Por defecto, Verano, Medianoche, Acero, Cósmico, Modo oscuro, Violeta, Rojo
  apagado, Verde Steam, Oro, Rosa y turquesa y Azul intenso (sustituyen a los colores de antes).
- Página de **insignias** como la de Steam: nivel y EXP, lo que falta para el siguiente y cada insignia con su
  progreso. Se abre desde el nivel o desde «Insignias» en cualquier perfil.
- **Editar perfil** como el de Steam: General, Avatar (con sus tres tamaños y los marcos), Fondo del perfil, Tema,
  Insignia destacada, Vitrinas destacadas y Privacidad, con «Cancelar / Guardar».

**La cuenta, a la vista**
- Diálogo nuevo para **crear la cuenta o entrar**: lo que desbloquea a la izquierda y un formulario claro a la
  derecha (validación al escribir, fuerza de la contraseña, enseñarla, recuperar la cuenta) y, al terminar, tu código
  de amigo y «Personalizar mi perfil / Añadir amigos».
- **Guardado en la nube: próximamente.** Ya sale entre lo que desbloquea la cuenta, con su insignia de «Próximamente».
- Sale **una vez** en cada perfil sin cuenta («Novedad») y lo abren todos los «Crear cuenta» de ejGames: el menú
  rápido, Ajustes → Cuenta y amigos, el paso del inicio y las listas de amigos de los temas.
- **Tema Steam**: tu nombre junto a Biblioteca, como en Steam (clic: tu perfil; encima: Actividad, Perfil, Amigos,
  Solicitudes, Insignias y Editar perfil) y un **menú en tu foto** con tu perfil, tu estado (en línea, ausente,
  invisible), los detalles de la cuenta y cambiar de perfil. Sin cuenta, los dos invitan a crearla.

**Para temas**
- `ejg.account.openLogin("register" | "login")` abre el diálogo; `ejg.friends.open(tab)` y el `tab` de
  `ui.onView` abren Amigos en Solicitudes o Actividad; `ejg.profiles.badges(id)` y la vista `badges`, la página de
  insignias. En el kit, `createBadgesView` y `start: "requests" | "activity" | "badges"` en `createSocialView`.

**Servidor** (hay que volver a desplegarlo: `pnpm deploy-server`)
- Cada perfil trae sus amigos de más nivel para la columna derecha, y el resumen guarda los juegos de la biblioteca,
  las horas de las dos últimas semanas, las capturas y la cabecera de cada juego.

## 0.7.0

**Cuenta de ejGames: opcional, pero lo desbloquea todo**
- Hacerte una cuenta es **opcional**: sin ella, ejGames funciona exactamente igual que antes. Con ella desbloqueas
  todo lo de abajo: amigos y a qué juegan, avisos dentro del juego, actividad, tu perfil personalizable, nivel,
  insignias y comentarios.
- Créala al empezar (un paso nuevo del inicio, que se puede saltar) o cuando quieras en **Ajustes → Cuenta y
  amigos**. Se liga a tu perfil local.
- La contraseña no sale de tu PC: se convierte en una clave (argon2) y el servidor solo guarda un hash. Al crearla te
  da un **código de recuperación** para cuando la olvides; guárdalo, solo se enseña una vez.

**Amigos**
- Añádelos por su nombre de usuario o por su **código de amigo**. Ves quién está en línea y **a qué juega**, como en
  Steam, y tus solicitudes pendientes.
- **Avisos dentro del juego** cuando un amigo se conecta o empieza a jugar (se pueden desactivar) y cuando te llega
  una solicitud.
- **Actividad**: partidas, logros (con su rareza), juegos completados y amigos nuevos de tu gente.
- Tu estado: en línea, ausente o invisible.

**Perfiles al estilo Steam**
- Avatar con **12 marcos** (neón, fuego, galaxia, píxel…), **8 fondos animados** o una imagen tuya y 7 colores.
- **Vitrinas** a elegir y ordenar: juego destacado, favorito, estadísticas, jugados hace poco, logros recientes,
  insignias, capturas y texto libre.
- **Nivel e insignias** que se ganan jugando: coleccionista, cazalogros, maratón, completista, explorador, veterano y
  social, cada una con sus niveles de bronce a leyenda.
- **Comentarios** en los perfiles y privacidad a tu gusto: quién ve tu perfil (todos, tus amigos o solo tú) y quién
  comenta.
- Editor con vista previa en vivo.

**En todas partes**
- Pestaña **Amigos** en los siete paneles del overlay, con los perfiles dentro.
- Cada tema con sus amigos: «Amigos» en la barra de abajo en Steam, un icono en la de PS5, un botón en Xbox, un
  círculo en Switch, un enlace en Cine y ♥ FRIENDS en Retro. Y en el menú rápido, «Amigos» y «Mi perfil».
- Para temas: `ejg.account`, `ejg.friends`, `ejg.profiles`, `ejg.comments` y `ejg.activity`, y en el kit
  `createSocialView` con `/_sdk/kit/social.css`. Está en la referencia.

## 0.6.0

**Trucos**
- Trucos para tus juegos de un jugador con los trainers de FLiNG, al estilo WeMod. En la ficha del juego (o en el
  overlay) ejGames busca su trainer y te enseña sus opciones, la versión del juego que cubre, las notas del autor y
  si el juego tiene antitrampas. Solo se descarga si tú lo confirmas.
- Al jugar, el trainer se abre solo cuando el juego ya ha cargado, sin permisos de administrador y con su ventana
  escondida, y se cierra con el juego. Se puede desactivar («Abrir con el juego») o abrirlo a mano.
- **Pestaña Trucos en el overlay**, en los siete estilos: interruptores para lo que se activa y desactiva, botones
  para lo que se hace una vez (+1 hora, teletransporte…) y «Ver la ventana del trainer» para las opciones que piden
  un valor. ejGames pulsa las teclas del trainer por ti; sus teclas de siempre también funcionan.
- Si Windows Defender se lleva el trainer (los antivirus suelen marcarlos), ejGames lo dice y explica cómo recuperarlo.

**Mapas**
- Mapas interactivos de Map Genie, con todos sus puntos de interés, para unos 250 juegos. ejGames encuentra solo el
  de cada juego; si no acierta, lo eliges tú (o dices que no tiene mapa).
- **Pestaña Mapa en el overlay** y botón Mapa en la ficha de cada tema.
- **Anclado**: el mapa se queda en una esquina encima del juego, semitransparente y sin quitarle el foco. Tamaño,
  transparencia y esquina a tu gusto.

**Y además**
- Los seis temas tienen su entrada a Trucos y Mapa junto a las guías.
- Para temas: `ejg.trainer.info/open` y `ejg.maps.info/open`. Instalar un trainer siempre pasa por la ventana del host.

## 0.5.0

**Solo juegos locales**
- ejGames deja de importar juegos de Steam, Epic, GOG, Ubisoft Connect y EA app: la biblioteca es lo que tienes en tus carpetas, los `.exe` que añades a mano y lo que instalas desde Descargas.
- Al actualizar, los juegos de tiendas que estaban dentro de una de tus carpetas pasan a ser juegos de carpeta y conservan sus horas, logros y notas. Los demás salen de la biblioteca (no se borra nada del disco).
- Fuera los filtros «Sin instalar» y los botones «Instalar desde la tienda» de los temas. En su lugar, filtros de **Jugados** y **Sin jugar** para encontrar lo pendiente.

**Guías de la comunidad**
- Las guías de Steam de cada juego, dentro de ejGames: mejor valoradas, populares o más recientes, por categoría (logros, paso a paso, secretos, mapas…) y con buscador. Por defecto, las de español e inglés.
- Lector propio con índice de secciones, imágenes a pantalla completa, spoilers y vídeos, que se maneja con mando (arriba/abajo para leer, LB/RB para cambiar de sección).
- **Guarda** las que te sirvan: salen primero y se leen sin conexión. Cada guía recuerda por dónde ibas y aparece en «Seguir leyendo».
- **En el overlay**, en una pestaña nueva de cada panel: consulta la guía sin salir del juego.
- Cada tema, a su manera: «Guías» en la barra del juego y una tarjeta como la de Steam, «Ayuda del juego» en PS5, una fila de guías en la ficha de Xbox y de Cine, «Guías de la comunidad» en las opciones de Switch y «GUIDES» en Retro.
- Para temas: `ejg.guides` y, en el kit, `createGuideView` (lista y lector listos para montar) con `/_sdk/kit/guides.css`. Está en la referencia.

## 0.4.0

**Overlay dentro del juego, rehecho**
- El panel (Mayús + Tab o el botón Guía) tiene ahora el aspecto de la plataforma de tu tema, igual que los avisos: el Mayús + Tab de Steam con su barra de herramientas, la Guía de Xbox a la izquierda, el centro de control de PlayStation abajo con sus tarjetas, un menú rápido de Switch, una película en pausa en Cine y la pausa de una recreativa en Retro. Los temas de otros usan uno sobrio con sus colores.
- **Capturas de pantalla** con **F12** (se cambia en *Ajustes → Overlay*) o desde el panel: se guarda la imagen del juego, sin el overlay, en `Imágenes\ejGames\<juego>` y sale un aviso con la miniatura. En el panel están las últimas y un botón para abrir la carpeta. En los juegos de Steam, F12 sigue siendo de Steam.
- **Notas de cada juego**: códigos, por dónde ibas, lo que te falta. Se guardan solas; con mando se escriben con el teclado en pantalla.
- **Música**: lo que suene en el PC (Spotify, el navegador, el reproductor de Windows…) con su carátula, pausa, anterior y siguiente.
- **Volumen** del juego y del sistema, y lo que gasta el juego: procesador, gráfica y memoria, con su gráfica del último minuto.
- **Descargas** en el panel y **Seguir descargando** si se pausaron al empezar a jugar (solo en esa partida).
- **Cerrar el juego** si se cuelga, con confirmación.
- Logros mejor ordenados: los siguientes más fáciles, los conseguidos por fecha y los ocultos que faltan en una línea. Con puntos al estilo Xbox en su tema y copas de bronce, plata, oro y platino en el de PlayStation.
- El tiempo total jugado junto al de la sesión, y la batería del mando y del portátil.
- Todo se lee solo con el panel abierto: durante la partida sigue sin gastar nada.

**Tienda: descubrir juegos**
- Nuevo catálogo con los más de 7000 juegos y filtros: hasta cuatro géneros a la vez (y perspectiva y ambientación), orden (novedades, actualizados hace poco o de la A a la Z), tamaño máximo de la descarga y «ocultar los que ya tengo». Se carga más al bajar.
- Accesos por género en la portada de cada tienda, géneros pulsables en las fichas y una fila de juegos parecidos («Más como este»).
- Cada tema, a su manera: la búsqueda con filtros de Steam y sus categorías, «Explorar» con «Filtrar y ordenar» en PS5, los desplegables y las losas de colores de la tienda de Xbox, los filtros como filas de la configuración en Switch, el desplegable «Géneros» y filas por género en Cine y `GÉNERO ◀ ROL ▶` en Retro.
- Para temas: `ejg.explore.browse(filtros, página)` y `ejg.explore.genres()`, y en el kit `browse`, `browseMore`, `toggleGenre`, `clearFilters` y `similar`. Está en la referencia y en la guía.

## 0.3.3

**Tienda**
- Si tu proveedor de internet bloquea la web de FitGirl, la tienda ya no se queda sin cargar: pasa sola por un servidor de respaldo de ejGames y lo sigue usando hasta cerrar la app. Vale para todo lo que lee de la web: portada, búsqueda, fichas y el enlace de descarga que se pide antes de bajar un juego.

## 0.3.2

**Tienda**
- Si la tienda no carga, ahora dice por qué en vez de un error técnico: tu proveedor de internet bloquea la web, no hay conexión, un antivirus intercepta la conexión segura o la web no responde. La causa completa queda en el log.
- La tienda y el resto de conexiones de ejGames (portadas, metadatos, actualizaciones) ya funcionan con antivirus que inspeccionan HTTPS (Avast, Kaspersky, ESET…) y con proxies de empresa: ahora también se fían de los certificados de Windows.

## 0.3.1

**Tema Steam, más fiel al cliente**
- Arriba, como en Steam: **Tienda** y **Biblioteca**. Las descargas se abren desde la barra de abajo («Administrar descargas»), que mientras descargas enseña el juego, su progreso y la velocidad.
- La biblioteca es la de Steam: lista a la izquierda con Inicio, Colecciones, filtro, buscador y grupos plegables; en el inicio, «Juegos recientes» agrupados por fecha, tus favoritos y cada colección como estantería, y «Todos los juegos» con «Ordenar por». Nueva vista de colecciones con sus portadas en abanico.
- Página de juego como la de Steam: botón Jugar, última sesión, tiempo de juego y logros, el menú del engranaje (favoritos, colecciones, archivos locales, ocultar, desinstalar, propiedades), la actividad por días y el panel de logros.
- La tienda usa el arte de la tienda de Steam (cápsulas y carrusel) cuando el juego está allí. Portada con el carrusel de destacados y sus capturas, una fila por páginas y la lista con pestañas y vista previa; ficha de producto y resultados de búsqueda como los de Steam.
- El buscador de la tienda ya deja escribir: antes perdía el foco con cada letra.

**Desinstalar juegos**
- Nuevo «Desinstalar» en la página de juego del tema Steam y en *Editar juego*. Abre el desinstalador del juego (el de Windows o el `unins000.exe` de su carpeta) o, si no tiene, manda su carpeta a la papelera; los de Steam se desinstalan con Steam. Siempre pide confirmación y el juego sale de la biblioteca cuando desaparece del disco.
- Para temas: `ejg.game.uninstall(id)` abre ese diálogo y `canUninstall(juego)` del kit dice si se puede.

**Arreglos**
- En los diálogos «Instalar» de los temas Steam y Cine podía salir el texto «null».

## 0.3.0

**Explorar**
- Nueva tienda de repacks dentro de ejGames: populares de hoy, de la semana y del mes, novedades y búsqueda por nombre. Cada ficha trae capturas, géneros, compañías, idiomas, tamaños (original, descarga e instalado), características del repack y descripción.
- Marca lo que ya tienes: en tu biblioteca, descargando, listo para instalar o instalado.
- Oculta los juegos para adultos (se puede desactivar en *Ajustes → Descargas*).
- Se abre desde el menú rápido, con **Ctrl+E** o desde la tienda de tu tema.

**Descargas**
- Torrent integrado, sin programas aparte. Antes de empezar eliges qué idiomas y extras opcionales bajas (lo imprescindible va siempre) y la carpeta, y ves si cabe en el disco.
- Pensado para ir a toda velocidad: una descarga a la vez (el resto espera en cola), puerto de entrada abierto en el router con UPnP, trackers públicos extra y arranque inmediato con las fuentes encontradas al pedir la lista de archivos.
- Se reanuda donde lo dejaste al volver a abrir ejGames, sin comprobar otra vez lo descargado. Si cierras la ventana con descargas en marcha, ejGames sigue en la bandeja; desde su menú puedes pausarlas o reanudarlas todas.
- Se pausan solas mientras juegas y siguen al cerrar el juego (desactivable), y también mientras se instala otro juego para no pelear por el disco.
- El PC no se suspende a mitad de una descarga (desactivable).
- **Instalar** abre el instalador del repack con la carpeta de juegos ya propuesta. Cuando termina, el juego entra en tu biblioteca con su arte y el repack se borra (desactivable). Si no se sabe dónde se instaló, te pide la carpeta.
- Al terminar de descargar sale un aviso con el botón **Instalar**, y al instalar otro con **Jugar**. La descarga en curso se ve abajo a la izquierda y en el icono de la bandeja.
- Las carpetas de repacks sin instalar ya no aparecen como juegos en la biblioteca.
- Motor ligero: solo está en marcha mientras hay algo que bajar o compartir; un minuto después se apaga.

**Cada tema, su tienda**
- Steam: pestañas Tienda y Descargas con la portada de la tienda de Steam (destacados, cápsulas, listas), página de producto con su caja de compra, diálogo «Instalar» y el gestor de descargas con la gráfica de velocidad. En la biblioteca, la barra de descargas abajo.
- PS5, Xbox, Switch, Cine y Retro, cada uno con la tienda y la cola de su plataforma.
- Los temas propios pueden pintar su tienda y su cola con `"features": { "explore": true }` en `theme.json`; si no, se abren las ventanas de ejGames. Está en la guía y en la referencia de temas.

**Ajustes → Descargas**
- Carpetas de descargas y de instalación, límites de velocidad de bajada y subida, descargas a la vez, pausar al jugar, compartir (nunca, hasta instalar o hasta un ratio), abrir el instalador al terminar, borrar el repack al instalar, evitar la suspensión, puerto, UPnP, trackers extra, uTP, conexiones por descarga y proxy SOCKS5.
- El asistente del primer arranque tiene un paso nuevo para elegir la carpeta de descargas (por defecto, tu carpeta de juegos).

**Actualizaciones**
- Al abrir, ejGames mira si hay una versión nueva. Si la hay, te enseña qué trae y con un botón la descarga (comprobando que el instalador es el publicado), cierra ejGames, la instala sin tocar tus datos y lo vuelve a abrir.
- Puedes saltarte una versión o dejarlo para más tarde. En *Ajustes → Sistema → Actualizaciones* se desactiva la comprobación al abrir y está «Buscar ahora».

**Discord**
- Interruptor en *Ajustes → Sistema* para mostrar o no en Discord a qué juegas (activado de serie). Sigue pudiéndose quitar solo en un perfil o en un juego.
- Ya no se puede poner otro Application ID: se usa siempre la aplicación de ejGames.

**Instalador nuevo**
- `ejGames_0.3.0_Setup.exe`: instalador propio con la cara de ejGames. Eliges carpeta, acceso directo y si se abre al terminar, ves el progreso real y, si ya tenías ejGames, sabe que es una actualización. Si al PC le falta WebView2, abre el instalador clásico que lleva dentro.
- Es el único que se publica: las actualizaciones automáticas también lo usan, y entonces actualiza sin preguntar y vuelve a abrir ejGames.

**Además**
- Teclado en pantalla para escribir con el mando (búsquedas).
- Icono nuevo.

## 0.2.2

**Al cerrar el juego**
- Las horas, la última sesión y los logros se actualizan en cuanto cierras el juego. Antes ejGames esperaba 12 segundos por si el juego se volvía a abrir, y los temas Steam, Xbox, Switch y Cine no repintaban la ficha que tenías abierta hasta salir y volver a entrar.
- Si el juego se reinicia solo (para aplicar ajustes, o un lanzador que lo abre después de cerrarse), se sigue como una partida nueva sin tener que darle a Jugar.
- Si lo tienes configurado para minimizarse o ahorrar mientras juegas, ejGames vuelve unos 4 segundos después de cerrar el juego (antes, unos 14).
- El informe de errores que abren algunos juegos al cerrarse ya no alarga la partida.

**Avisos de logros**
- Cada tema tiene el aviso de su plataforma, con su posición, su animación y su sonido:
  - **Steam:** abajo a la derecha, sube desde el borde. Los raros (menos del 10 % de jugadores) salen en dorado.
  - **PlayStation:** arriba a la derecha, con una copa de bronce, plata u oro según la rareza, y de platino con el último logro del juego.
  - **Xbox:** abajo en el centro. El círculo se abre en píldora con el color de acento del tema y los puntos del logro (1000 por juego, repartidos por rareza). Los raros llevan diamante.
  - **Switch:** arriba a la izquierda, clara u oscura según el tema.
  - **Cine:** un rótulo abajo a la izquierda, como en los créditos.
  - **Retro:** un cartel pixelado arriba en el centro, con la paleta del tema.
- En *Ajustes → Overlay* puedes elegir otro estilo y otra posición (ahora también arriba y abajo en el centro), con vista previa encima de uno de tus juegos.
- Con el juego a pantalla completa, los avisos van pegados al borde de la pantalla y no por encima de donde estaría la barra de tareas.
- Los temas propios eligen su aviso en `theme.json` con `"overlay": { "style": "xbox" }`. Sin él, sale uno sobrio con los colores del tema. Está en la guía de temas.

## 0.2.1

**Overlay**
- El atajo de teclado (Mayús+Tab) ya funciona en los juegos que Windows tiene marcados como «Ejecutar como administrador», algo que hacen muchos instaladores. Con un juego elevado delante, Windows no deja que ejGames lea el teclado, así que ahora ejGames los abre sin elevar. De paso, ya no sale el aviso de UAC al jugar.
- Si un juego necesita de verdad ser administrador, actívalo en *Editar juego → Ejecutar como administrador*. El editor avisa cuando Windows tiene esa marca o cuando el propio juego la exige.
- Si el juego se abre como administrador de todos modos, el aviso del principio de la partida lo explica y propone el botón Guía del mando. También queda anotado en el registro.

**Temas**
- Guía paso a paso para crear un tema desde cero ([en la documentación](https://ej3mplo.mintlify.site/guia)), con el tema de ejemplo terminado en `examples/ejemplo-tema/`.
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
