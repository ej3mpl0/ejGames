# Crear temas para ejGames

Un tema es una **página web completa** (HTML + CSS + JavaScript) que dibuja tu
biblioteca como quieras. Los 6 temas de serie (Steam, PS5, Xbox, Switch, Cinema
y Retro) están hechos exactamente con lo que se explica aquí: úsalos de ejemplo.

## Empezar en 1 minuto

1. Ajustes → Apariencia → elige el tema que más se parezca a lo que quieres.
2. Pulsa **Duplicar para editar**. Se copia a tu carpeta de temas
   (`%APPDATA%\ejGames\themes\<id>-custom`) y queda seleccionado.
3. Activa **Modo desarrollador** (misma pantalla) y pulsa **Abrir carpeta del tema**.
4. Edita `style.css` o `main.js` con tu editor: al guardar, el tema se recarga solo.

`F5` recarga el tema a mano. Si algo se rompe y el tema no arranca en 6 segundos,
ejGames vuelve al tema Steam automáticamente. Mantén **Shift** al abrir ejGames
para arrancar en modo seguro.

## Estructura

```
mi-tema/
  theme.json      manifiesto (obligatorio)
  index.html      entrada (el SDK se inyecta solo en el <head>)
  style.css
  main.js         ES module
  fonts/ sounds/ img/ …  lo que necesites
```

### theme.json

```json
{
  "id": "mi-tema",
  "name": "Mi tema",
  "version": "1.0.0",
  "author": "yo",
  "description": "Una línea para la galería",
  "sdk": 1,
  "entry": "index.html",
  "modes": ["desktop", "tv"],
  "preview": "preview.jpg",
  "palette": ["#101010", "#202020", "#ff4d4d", "#ffffff"],
  "host": { "accent": "#ff4d4d", "surface": "#161616", "radius": "10px", "dark": true },
  "sounds": { "preset": "soft" },
  "windowControls": "host",
  "settings": [
    { "key": "accent", "type": "color", "label": "Acento", "default": "#ff4d4d" },
    { "key": "cardSize", "type": "range", "label": "Tamaño", "min": 120, "max": 300, "step": 10, "unit": "px", "default": 180, "group": "Rejilla" },
    { "key": "showClock", "type": "toggle", "label": "Reloj", "default": true },
    { "key": "layout", "type": "select", "label": "Distribución", "default": "grid",
      "options": [{ "value": "grid", "label": "Rejilla" }, { "value": "list", "label": "Lista" }] },
    { "key": "font", "type": "font", "label": "Tipografía", "default": "Segoe UI" },
    { "key": "wallpaper", "type": "image", "label": "Fondo" }
  ]
}
```

| Campo | Para qué |
|---|---|
| `id` | letras, números, `-` y `_`. Único. |
| `sdk` | versión del SDK que usa el tema (hoy `1`). |
| `modes` | `desktop` y/o `tv` (Big Picture). |
| `preview` | imagen para la galería. Sin ella se dibuja un boceto con `palette`. |
| `host` | colores de las pantallas del launcher (ajustes, editor…) mientras el tema está activo. `dark: false` = claras. |
| `sounds` | `{"preset": "soft" \| "ps" \| "xbox" \| "switch" \| "retro" \| "none"}` o ficheros propios: `{"move": "sounds/move.wav", "select": …, "back": …, "launch": …, "error": …, "open": …}`. |
| `windowControls` | `"host"`: ejGames pinta minimizar/maximizar/cerrar arriba a la derecha (aparecen al pasar el ratón). `"theme"`: los pinta el tema con `ejg.window.*`. |
| `settings` | opciones que aparecen en **Ajustes → Apariencia** para cualquier usuario, sin tocar código. |

### Opciones del editor visual → CSS

Cada opción llega al tema de dos formas:

* **Variable CSS** en `:root`: `--ejg-<clave-en-kebab>`. `cardSize` → `--ejg-card-size: 180px`.
  - `color`, `text`, `select`: el valor tal cual.
  - `range`/`number`: con su `unit`.
  - `toggle`: `1` o `0`.
  - `font`: `"Nombre", system-ui, sans-serif`.
  - `image`: `url("…")` (el usuario elige una imagen o un vídeo mp4/webm).
* **Atributo** en `<html>` para `toggle` y `select`: `data-show-clock="on|off"`, `data-layout="grid"`.

```css
:root { --accent: var(--ejg-accent, #ff4d4d); }
.card { width: var(--ejg-card-size, 180px); }
html[data-show-clock="off"] .clock { display: none; }
html[data-layout="list"] .grid { display: block; }
html[data-mode="tv"] body { font-size: 18px; }   /* Big Picture */
```

Y en JavaScript: `ejg.settings.cardSize`. Si una opción necesita volver a
dibujar, escucha `ejg.on("settings", …)`.

Además, cada perfil puede añadir **CSS extra** a cualquier tema (Ajustes →
Apariencia), que se aplica el último.

## El SDK: `window.ejg`

Se inyecta antes que tus scripts. Espera a que el host mande los datos:

```js
const ejg = await window.ejg.ready();
```

### Biblioteca

```js
ejg.library.all              // Game[] ya ordenados (copia local, sin llamadas)
ejg.library.byId(id)
ejg.library.collections      // colecciones del perfil
ejg.library.onChange(({ full, changed, removed }) => render())
```

Cada `Game` trae: `id, title, sortTitle, source, developer, publisher,
releaseDate, genres[], tags[], rating, favorite, hidden, missing, installed,
playtime` (segundos)`, lastPlayed` (Unix)`, launchCount, userRating, collections[],
running`, `media` y, si el juego tiene logros, `achievements: { unlocked, total }`.

`installed: false` son juegos que tienes en Steam, Epic o GOG pero no están
instalados. `ejg.game.launch(id)` con ellos abre su tienda para instalarlos, así
que muestra **Instalar** en vez de **Jugar**. Para filtrar:
`visible(games, { installed: "installed" | "uninstalled" | "all" })`.

`media` contiene:

| `media.` | Qué es |
|---|---|
| `cover` / `coverThumb` | carátula 2:3 (la miniatura pesa ~40 KB) |
| `hero` / `heroThumb` | fondo panorámico |
| `logo` | logo con transparencia |
| `header` | cápsula horizontal 460×215 |
| `icon` | icono pequeño |
| `microtrailer` | vídeo corto sin sonido (mp4) |

Usa las miniaturas en listas y rejillas; las grandes, solo en fondos y fichas.

### Juegos

```js
const d = await ejg.game.details(id)   // + description, screenshots[], trailers[], recentSessions[]
await ejg.game.launch(id)
ejg.game.favorite(id)                  // alterna (o pasa true/false)
ejg.game.hide(id, true)
ejg.game.rate(id, 80)
ejg.game.edit(id)                      // abre el editor del host
ejg.game.openFolder(id)
ejg.game.isRunning(id)
ejg.game.onState(({ gameId, state }) => …)   // "launching" | "running" | "stopped"
```

`description` es texto con un marcado mínimo (`## título`, `- viñeta`,
párrafos separados por línea en blanco). `description()` del kit lo convierte en
nodos DOM seguros.

Los tráilers (`d.trailers[i].url`) son HLS (`.m3u8`): usa `attachStream()` del kit,
que usa HLS nativo o hls.js según haga falta.

### Logros

```js
const list = await ejg.game.achievements(id)
// { total, unlocked, items: [{ apiName, name, description, icon, iconGray,
//                              hidden, globalPct, unlockedAt }] }
```

Salen de las estadísticas locales de Steam o de los ficheros de los emuladores
de los juegos sueltos. La primera vez puede tardar un momento, porque descarga
el esquema de Steam; después se cachea una semana. Para pintar un resumen sin
esperar, usa `game.achievements` de la biblioteca.

- `items` va en el orden del juego. Sin `unlockedAt`, el logro está bloqueado.
- `icon` y `iconGray` se sirven por `ejg-media`, así que cargan en el tema sin
  red.
- `globalPct` es el % de jugadores de Steam que lo tienen; sirve para marcar la
  rareza.
- Un logro oculto sin desbloquear llega como «Logro oculto», sin icono ni
  descripción.

### Mando y teclado

```js
ejg.input.on("nav", (e) => {
  // e.action: up down left right accept back x y lb rb lt rt menu view
  // e.source: "keyboard" | "gamepad"; e.repeat: al mantener pulsado
  if (e.action === "back" && algoAbierto) { cerrar(); e.preventDefault(); }
});
```

Teclado: flechas, Enter/Espacio (accept), Esc/Retroceso (back), **E** (x),
**F** (y), RePág/AvPág (lb/rb), Tab (rb).

Si no marcas un `back` como gestionado, lo usa el host: cierra lo que tenga
abierto y, en Big Picture sin nada abierto, abre el menú rápido. El botón Guía
del mando abre siempre el menú rápido del host.

### Pistas de controles (mando o teclado)

`ejg.input.source` dice qué se usó por última vez (`"gamepad"`, `"keyboard"` o
`"mouse"`) y `ejg.input.pad` qué mando es (`"xbox"`, `"playstation"`,
`"nintendo"` o `"generic"`). El `<html>` lleva `data-input` y `data-pad`, y
`ejg.on("input", …)` avisa de los cambios. Lo más fácil es usar el kit:

```js
import { hints } from "/_sdk/kit/hints.js";
const bar = hints(document.querySelector("#hints"), [["accept", "Jugar"], ["back", "Atrás"], ["y", "Favorito"]]);
bar.set([["accept", "Instalar"]]);   // cambia los textos cuando haga falta
```

Con un mando de PlayStation se ven ✕ ○ △ □; con uno de Xbox, A B X Y en sus
colores; con teclado, Enter, Esc, E y F. Se actualiza solo. Truco CSS:
`html[data-input="mouse"] .hints { display: none; }`.

### Host y ventana

```js
ejg.ui.open("settings" | "game" | "profiles" | "search" | "add-folder" | "stats" | "theme" | "collections" | "menu", args)
ejg.ui.toast("Hecho", "ok")
ejg.sound.play("move" | "select" | "back" | "launch" | "error" | "open")
ejg.window.minimize(); ejg.window.maximize(); ejg.window.close(); ejg.window.fullscreen()
ejg.stats.get(30)        // estadísticas del perfil
ejg.storage.set("clave", valor); await ejg.storage.get("clave")   // 512 KB por tema y perfil
ejg.profile              // { id, name, avatar, color }
ejg.mode                 // "desktop" | "tv"
ejg.on("focus-return", () => …)   // se cerró un overlay del host: recupera el foco
ejg.on("visibility", ({ visible }) => …)   // pausa vídeos si no se ve
```

Arrastrar la ventana: pon `data-ejg-drag` en tu barra superior (y
`data-ejg-nodrag` en los botones que tenga dentro). Doble clic maximiza.

Tipos completos: `/_sdk/ejg.d.ts`.

## El kit (opcional)

Módulos sin dependencias en `/_sdk/kit/`. Importa solo lo que uses:

```js
import { h, img, keyed, debounce, initials, hueOf } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { createBackdrop, attachStream, trailerPlayer, idle } from "/_sdk/kit/media.js";
import { playtime, relative, date, year, description, SOURCE_LABEL } from "/_sdk/kit/format.js";
import { visible, sort, recent, favorites, byGenre, search, inCollection, SORTS } from "/_sdk/kit/library.js";
import { clock } from "/_sdk/kit/clock.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints, glyph } from "/_sdk/kit/hints.js";
```

* **`createFocus` + `bindNav`**: navegación espacial con mando. Marca lo navegable
  con `data-focus`, agrupa filas con `data-focus-group` (recuerda el último foco de
  cada grupo) y encierra diálogos con `data-focus-trap`. El elemento enfocado
  recibe la clase `is-focused`.
  * **Con ratón:** pasar por encima enfoca, y al salir se quita la clase para
    que no se quede marcado. Con mando, el cursor se oculta y `:hover` no se
    aplica.
  * **`onChange(el, prev, { pointer })`:** si `pointer` es `true`, el foco vino
    del ratón. En ese caso no desplaces ni selecciones nada, porque el elemento
    se movería de debajo del cursor.
* **`artFor(juego, "portrait" | "square" | "landscape")`**: arte que encaja en el
  marco sin recortar logos. En cuadrado y panorámico compone el fondo del juego con
  su logo encima; si falta algo, recurre a la carátula centrada, a la cabecera o
  al nombre. Devuelve un elemento que ocupa todo su contenedor.
* **`hints(contenedor, [[acción, texto], …])`**: barra de pistas de controles (ver arriba).
* **`keyed(contenedor, lista, clave, render)`**: reutiliza nodos al redibujar,
  así el foco no salta y va rápido con cientos de juegos.
* **`createBackdrop`**: fondo con fundido entre imágenes y vídeo encima.

Esqueleto mínimo:

```js
import { h, img, keyed } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { visible, sort } from "/_sdk/kit/library.js";

const ejg = await window.ejg.ready();
const grid = document.querySelector("#grid");
const focus = createFocus();
bindNav(focus, { y: () => ejg.game.favorite(Number(focus.current?.dataset.id)) });

function render() {
  keyed(grid, sort(visible(ejg.library.all)), (g) => g.id, (g, prev) =>
    prev ?? h("button", { class: "card", "data-focus": "", "data-id": g.id, onclick: () => ejg.game.launch(g.id) },
      img(g.media.coverThumb), h("span", null, g.title)));
}
ejg.library.onChange(render);
render();
focus.first(grid);
```

## Qué puede y qué no puede hacer un tema

Los temas se ejecutan en un **iframe aislado** (origen `null`, sin
`allow-same-origin`) y con una política de seguridad estricta:

* ✅ Todo el HTML/CSS/JS que quieras, animaciones, canvas, WebGL, vídeo.
* ✅ Imágenes y vídeos de la biblioteca (`http://ejg-media.localhost`) y los ficheros del propio tema.
* ❌ Internet (fetch, fuentes o imágenes externas): mete lo que necesites en la carpeta del tema.
* ❌ Acceso a disco, a otros programas o a Tauri: solo lo que ofrece `window.ejg`.
* ❌ `localStorage`/`IndexedDB`: usa `ejg.storage`.

Por eso instalar un tema de otra persona es seguro: como mucho puede lanzar
juegos de tu biblioteca o abrir pantallas del launcher.

## Rendimiento

* Usa `coverThumb`/`heroThumb` en rejillas y filas; `img()` del kit ya pone `loading="lazy"`.
* En rejillas largas: `content-visibility: auto; contain-intrinsic-size: auto 240px;`.
* Nada de `setInterval` rápidos. El reloj del kit se actualiza una vez por minuto.
* Pausa vídeos con `ejg.on("visibility")` y cuando no se vean.

## Compartir

**Exportar .ejtheme** (Ajustes → Apariencia) crea un zip con tu tema. Para
instalarlo en otro PC: **Importar**. Un tema de usuario no puede usar el `id` de
uno de serie.
