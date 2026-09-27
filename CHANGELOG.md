# Cambios

Cada versión tiene su instalador en `installer/ejGames_<versión>_Setup.exe`
(se genera con `pnpm release patch|minor|major`, que nunca sobrescribe uno
anterior). Al instalar una versión nueva encima de otra se conservan la
biblioteca, las horas y los ajustes; la base de datos se actualiza sola.

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
