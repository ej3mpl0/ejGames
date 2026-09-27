# ejGames

Launcher de juegos para Windows, ligero y personalizable al 100 %.

* **Añade carpetas** y ejGames detecta cada juego y su `.exe` bueno. Descarta instaladores, redistribuibles y crash handlers, y reconoce Unity, Unreal, Godot, GameMaker, RPG Maker, Ren'Py, EasyAntiCheat y BattlEye.
* **Importa lo instalado** en Steam (incluidas tus horas y la fecha de última partida), Epic, GOG, Ubisoft Connect y EA app. Cada juego se lanza con su propia tienda.
* **También lo que no tienes instalado** (Steam, Epic y GOG): toda tu biblioteca con filtros *Instalados / Sin instalar* y un botón **Instalar** que abre la tienda. Su arte se descarga la primera vez que se ve. Ubisoft y EA no guardan tu biblioteca en local, así que de ellas solo salen los instalados.
* **Explorar y Descargas**: una tienda de repacks dentro del launcher (populares, novedades, búsqueda y fichas con capturas) y un **torrent integrado** para descargarlos:
  * Eliges qué idiomas y extras opcionales bajas, dónde se guardan y ves el espacio que hace falta.
  * Muy rápido y ligero: una descarga a la vez a toda velocidad (el resto en cola), puerto abierto con UPnP, trackers públicos extra y reanudación sin volver a comprobar nada. El motor solo existe mientras hay algo que bajar o compartir.
  * Se pausa sola mientras juegas (se puede desactivar) y mientras instalas otro juego, evita que el PC se suspenda y sigue en la bandeja si cierras la ventana.
  * Al terminar, **Instalar** abre el instalador del repack; cuando acaba, el juego entra en tu biblioteca con su arte y se borra el repack (también desactivable).
  * Cada tema de serie tiene su propia tienda y su cola con el aspecto de su plataforma. Ajustes en *Ajustes → Descargas* (límites de velocidad, compartir hasta instalar o hasta un ratio, proxy SOCKS5…).
* **Descarga toda la info**: portada, fondo, logo, icono, capturas, tráilers, microtráileres, descripción, géneros, desarrolladora y valoración. Steam no necesita clave; SteamGridDB e IGDB son opcionales.
* **6 temas de serie**: Steam, PS5, Xbox, Switch, Cinema y Retro. Cada uno se puede **tunear sin código** (colores, tamaños, fondos, fuentes, sonidos, CSS extra), **duplicar y reescribir entero** o puedes **crear el tuyo desde cero** (HTML/CSS/JS con recarga en vivo). Ver [Crear temas](#crear-temas).
* **Perfiles locales** estilo consola, con avatar, PIN opcional, tema propio, favoritos, colecciones (manuales e inteligentes) y horas.
* **Horas y estadísticas**: sesiones, horas por día, semana y hora del día, rachas, más jugados y géneros.
* **Logros**, también de los juegos que solo tienen el `.exe`:
  * **Steam:** se leen de las estadísticas que Steam guarda en tu PC, sin cuenta ni clave.
  * **Juegos sueltos:** si traen un emulador de la API de Steam (Goldberg, GSE y similares), se leen sus `achievements.ini` / `achievements.json`. El appid sale de `steam_appid.txt` o de la configuración del emulador.
  * En los dos casos, nombres en español, iconos y rareza vienen de Steam.
* **Overlay dentro del juego** (sin inyectar nada en el juego):
  * Cuando desbloqueas un logro sale un aviso con el aspecto, la posición y el sonido de la plataforma de tu tema: el de Steam abajo a la derecha, el de PlayStation arriba con su copa de bronce, plata, oro o platino, el de Xbox abajo en el centro con sus puntos… Se puede elegir otro en *Ajustes → Overlay*, con vista previa.
  * Con **Mayús + Tab** o el botón Guía se abre un panel con tus logros, el tiempo de sesión y la hora.
  * Sale en el monitor donde está el juego, aunque la ventana activa esté en otro.
  * Va en ventana, en ventana sin bordes y en la pantalla completa «optimizada» de Windows 10/11. En una pantalla completa exclusiva de verdad no se ve nada encima; al cerrar el juego sale un resumen de lo desbloqueado.
  * La ventana del overlay solo existe mientras se ve algo, así que no gasta memoria durante la partida.
  * Con un juego abierto como administrador, Windows no deja que otros programas lean el teclado. Por eso, si Windows tiene el `.exe` marcado como «Ejecutar como administrador» (muchos instaladores lo hacen), ejGames lo abre sin elevar y así tampoco sale el aviso de UAC. Si un juego lo necesita de verdad, actívalo en *Editar juego*; entonces el overlay se abre con el mando.
* **Discord Rich Presence**: "Jugando a &lt;juego&gt;" con su portada y "Jugando desde ejGames". Viene configurado y activado de serie; se desactiva en *Ajustes → Sistema* (o solo en un perfil o en un juego).
* **Mando / Big Picture**: todo se maneja con mando, con navegación espacial y sonidos. Las pistas de botones cambian solas: ✕○△□ con un mando PlayStation, A/B/X/Y con uno de Xbox o Nintendo, y teclas con teclado. Durante la partida, el botón Guía (o Select + Start 1 s) abre el panel del overlay.
* **Arte que encaja**: en mosaicos cuadrados o panorámicos se compone el fondo del juego con su logo, en vez de recortar la carátula.
* **Se actualiza solo**: al abrir mira si hay versión nueva en GitHub; si la hay, te avisa con sus novedades y con un clic la descarga, la instala y vuelve a abrir ejGames sin perder nada.
* **Modo ahorro**: al jugar se cierra la interfaz y solo queda el núcleo en la bandeja (**~5 MB**). Cuando cierras el juego, la ventana vuelve sola. Aunque no uses el modo ahorro, tras 30 s sin foco WebView2 libera memoria (el working set baja de ~440 MB a ~160 MB).

Novedades de cada versión: [`CHANGELOG.md`](CHANGELOG.md).

## Crear temas

Un tema es una página web normal (HTML + CSS + JavaScript) que dibuja tu
biblioteca como quieras. No hace falta compilar nada: guardas y se recarga solo.

* **[Guía paso a paso](docs/GUIA-TEMAS.md)**: tu primer tema desde cero, con
  rejilla de carátulas, navegación con mando, ficha del juego y opciones
  editables sin código. El tema terminado está en
  [`docs/ejemplo-tema/`](docs/ejemplo-tema/).
* **[Referencia](docs/THEMES.md)**: `theme.json`, el SDK `window.ejg` completo
  (también Explorar y Descargas), el kit de utilidades y qué puede y qué no
  puede hacer un tema.

Lo más rápido para empezar: *Ajustes → Apariencia → Duplicar para editar* sobre
el tema que más se parezca a lo que buscas, y *Abrir carpeta del tema*.

## Instalar

Descarga `ejGames_<versión>_Setup.exe` de la [última release](https://github.com/ej3mpl0/ejGames/releases/latest)
y ábrelo: eliges la carpeta y si quieres acceso directo, y en unos segundos está. Si ya tienes ejGames, el mismo
instalador lo actualiza sin tocar tu biblioteca. Una vez instalado, las versiones nuevas llegan solas.

## Requisitos

* Windows 10/11 con WebView2 (el instalador lo descarga si falta).
* Para compilar: Node 20+ y pnpm, Rust estable (MSVC).

## Desarrollo

```bash
pnpm install          # también copia hls.js y las fuentes de los temas (scripts/vendor.mjs)
pnpm tauri dev        # app con recarga en caliente
pnpm tauri build      # instalador NSIS en target/release/bundle/nsis
pnpm release patch    # sube la versión (patch|minor|major|x.y.z), compila y deja
                      # installer/ejGames_<versión>_Setup.exe (sin pisar anteriores)
pnpm publish-release  # publica esa versión en GitHub (notas del CHANGELOG): las copias
                      # instaladas la ofrecen al abrirse. Necesita `gh auth login`
cd src-tauri && cargo test --lib
```

> **Espacio en disco:** la carpeta `target` de Rust ocupa varios GB. Si la unidad
> del proyecto va justa, compila en otra unidad:
> `set CARGO_TARGET_DIR=D:\build\ejgames-target` (o `$env:CARGO_TARGET_DIR=…` en PowerShell).

Variables útiles:

| Variable | Efecto |
|---|---|
| `EJGAMES_DATA_DIR` | Guarda los datos en otra carpeta y funciona como instancia aparte, aunque la instalada esté abierta (pruebas). |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` | Depurar la UI y los temas con DevTools (`scripts/cdp.mjs`). |
| `RUST_LOG=ejgames_lib=debug` | Logs detallados del núcleo. |
| `EJGAMES_INSTALL_VERB=open` | (Solo en desarrollo) Abre el instalador de un repack sin pedir administrador, para probar. |
| `EJGAMES_UPDATE_REPO=dueño/repo` | (Solo en desarrollo) Busca actualizaciones en otro repositorio. |

## Datos

`%APPDATA%\ejGames\` guarda `library.db` (SQLite), `settings.json`, `logs\ejgames.log`,
`cache\media` (arte, direccionado por contenido), `cache\trailers` (LRU con tamaño
configurable) y `themes\` (temas de usuario). Con un fichero `portable.txt`
junto al exe, todo va a `.\data`.

## Claves opcionales

* **SteamGridDB**: arte alternativo y arte de juegos que no están en Steam. La clave se saca en steamgriddb.com → Preferencias → API.
* **IGDB** (Twitch): datos de juegos que no están en Steam. Client ID y Secret se sacan en dev.twitch.tv → Console.
* **Discord**: usa siempre la aplicación de ejGames; no hace falta configurar nada.

## Arquitectura

```
src-tauri/src/     núcleo en Rust
  library/         escaneo de carpetas, detección de exes (PE), vigilancia de carpetas
  import/          Steam (VDF), Epic, GOG, Ubisoft, EA
  metadata/        Steam GetItems, SteamGridDB, IGDB, matcher, cola con rate limit
  media/           almacén de imágenes + miniaturas, proxy/caché de tráileres HLS
  launcher/        ShellExecuteEx, «ejecutar como administrador», tracker de procesos, sesiones, botón Guía
  achievements/    esquema de Steam, estadísticas locales (KeyValues binario), ficheros de emuladores
  overlay/         ventana transparente encima del juego, atajo global, avisos y panel
  explore/         fuente de repacks (API de WordPress), lectura de fichas, caché e imágenes por ejg-media
  downloads/       motor torrent (librqbit) perezoso, cola, progreso, instalación y registro del juego
  protocols.rs     ejg-media (Range) y ejg-theme / ejg-safe (CSP + sandbox)
  lifecycle.rs     ventana, bandeja, modo ahorro (EcoQoS + recorte de memoria)
  update.rs        versiones nuevas desde GitHub Releases (descarga + SHA-256 + instalador pasivo)
src/               host en React: ajustes, editor de juego, perfiles, estadísticas, puente con los temas
sdk/               SDK de temas (window.ejg) y kit de utilidades
themes/            temas de serie
installer-app/     instalador que se publica (Tauri): lleva dentro el NSIS y lo ejecuta en silencio
```

**Seguridad de los temas.** Cada tema corre en un iframe aislado con origen
`null`, sin `allow-same-origin` y con una CSP que corta la red. Aunque WebView2
inyecta el IPC de Tauri en todos los frames, Tauri rechaza las llamadas de
orígenes `null` y la CSP bloquea `ipc.localhost`. El tema solo habla con el host
por `postMessage`, y el host valida cada llamada. Si un tema se cuelga, un
watchdog lo sustituye por el tema Steam servido desde otro origen (`ejg-safe`),
es decir, en otro proceso.

## Licencia

[MIT](LICENSE).
