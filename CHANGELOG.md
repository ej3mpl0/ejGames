# Cambios

Cada versión tiene su instalador en `installer/ejGames_<versión>_Setup.exe`
(se genera con `pnpm release patch|minor|major`, que nunca sobrescribe uno
anterior). Al instalar una versión nueva encima de otra se conservan la
biblioteca, las horas y los ajustes; la base de datos se actualiza sola.

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
