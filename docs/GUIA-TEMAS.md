# Guía: tu primer tema para ejGames, paso a paso

Esta guía es para ti si sabes algo de HTML, CSS y JavaScript y quieres hacer un
tema **desde cero**, sin partir de uno de los de serie. Vamos a construir entre
los dos un tema pequeño pero completo:

- una rejilla con las carátulas de tus juegos,
- que se maneja con ratón, teclado o mando,
- con una ficha para cada juego (descripción, Jugar/Instalar, favorito),
- con opciones que cualquiera puede cambiar en **Ajustes → Apariencia** sin tocar código,
- y que se adapta al modo **Big Picture**.

El resultado final está en [`docs/ejemplo-tema/`](ejemplo-tema/): son cuatro
ficheros que puedes copiar tal cual. Esta guía es práctica; para ver **todo** lo
que ofrece el SDK tienes la referencia en [`docs/THEMES.md`](THEMES.md).

**Índice**

1. [Dónde va el tema y cómo activarlo](#1-dónde-va-el-tema-y-cómo-activarlo)
2. [El `theme.json` mínimo](#2-el-themejson-mínimo)
3. [`index.html` y el primer `main.js`](#3-indexhtml-y-el-primer-mainjs)
4. [Rejilla de carátulas](#4-rejilla-de-carátulas)
5. [Mando y teclado](#5-mando-y-teclado)
6. [La ficha del juego](#6-la-ficha-del-juego)
7. [Opciones sin código y modo Big Picture](#7-opciones-sin-código-y-modo-big-picture)
8. [Sonidos y colores del launcher](#8-sonidos-y-colores-del-launcher)
9. [Depurar y errores típicos](#9-depurar-y-errores-típicos)
10. [Exportar y compartir](#10-exportar-y-compartir)

---

## Antes de empezar: qué es un tema

Un tema es una **página web normal** que ejGames abre a pantalla completa. Se
ejecuta en una caja cerrada (un *iframe* aislado): no tiene internet ni acceso
al disco. Todo lo que necesita se lo pide a ejGames a través de un objeto que
aparece solo en tu página, **`window.ejg`** (el SDK): la lista de juegos, avisos
cuando algo cambia, lanzar un juego, abrir los ajustes…

Las pantallas del propio launcher (ajustes, buscador, editor de juegos, menú
rápido, perfiles) las dibuja ejGames **por encima** de tu tema. Tú solo te
ocupas de enseñar la biblioteca a tu manera.

---

## 1. Dónde va el tema y cómo activarlo

### La carpeta

Cada tema es una carpeta dentro de:

```
%APPDATA%\ejGames\themes\
```

Pega esa ruta en **Win + R** o en la barra del Explorador. También puedes llegar
desde ejGames: **Ajustes → Apariencia → Carpeta de temas**. (Si usas la versión
portable, es la carpeta `data\themes` que hay junto a `ejgames.exe`.)

Crea dentro una carpeta llamada `ejemplo`. Al terminar la guía tendrá esto:

```
ejemplo/
  theme.json    el manifiesto: nombre, opciones, colores…
  index.html    la página
  style.css
  main.js
```

> **Ojo con Windows:** si tienes ocultas las extensiones, es fácil acabar con un
> `theme.json.txt`. Actívalas en el Explorador (Vista → Mostrar → Extensiones de
> nombre de archivo) y guarda los ficheros en UTF-8.

¿Prisa por verlo funcionar? Copia los cuatro ficheros de `docs/ejemplo-tema/` a
esa carpeta y sigue leyendo para entender cada parte.

### Que aparezca en la galería y activarlo

Abre **Ajustes** (**Ctrl + ,**) → **Apariencia**: la galería vuelve a leer la
carpeta de temas cada vez que entras, así que tu tema aparece sin reiniciar
ejGames. Pulsa la tarjeta **Mi primer tema**. Los temas tuyos llevan la etiqueta
«PROPIO». El tema elegido se guarda en tu perfil.

### Modo desarrollador y recargas

En esa misma pantalla, en el bloque **Hazlo tuyo**, activa **Modo desarrollador**.
Con él:

- el tema se **recarga solo cada vez que guardas** cualquiera de sus ficheros,
  también `theme.json` (nombre, opciones, colores, sonidos);
- los errores de JavaScript de tu tema salen como avisos («Tema: …»).

**F5** recarga el tema a mano en cualquier momento (también tienes el botón
**Recargar tema**). Si guardas un `theme.json` con un error, el tema sigue con
la versión anterior hasta que lo arregles.

### Si algo sale mal

- **Un error en tu JavaScript** deja el tema en blanco o a medias. Con el modo
  desarrollador verás el aviso con el error; arréglalo, guarda y listo.
- **Si el tema se cuelga** (por ejemplo, un bucle infinito), a los pocos
  segundos ejGames carga el tema Steam y te avisa: «El tema «Mi primer tema» no
  responde. Se ha cargado el tema Steam.». Arregla el fallo y vuelve a elegir tu
  tema en Apariencia.
- **Modo seguro:** mantén pulsada **Mayús** mientras abres ejGames y arrancará
  con el tema Steam, por si el tuyo no te deja ni llegar a los ajustes.

---

## 2. El `theme.json` mínimo

Crea `theme.json` con esto:

```json
{
  "id": "ejemplo",
  "name": "Mi primer tema",
  "version": "1.0.0",
  "author": "Tu nombre",
  "description": "Rejilla de carátulas con ficha de juego (el tema de la guía)",
  "sdk": 1
}
```

| Campo | Qué es |
|---|---|
| `id` | **Obligatorio.** Identificador único: letras, números, `-` y `_` (máximo 64). No uses el de un tema de serie (`steam`, `ps5`, `xbox`, `switch`, `cinema`, `retro`). Lo normal es que coincida con el nombre de la carpeta. |
| `name` | **Obligatorio.** El nombre que se ve en la galería. |
| `version`, `author`, `description` | Opcionales; la descripción sale bajo el nombre en la galería. |
| `sdk` | Versión del SDK que usa tu tema. Hoy es `1`. |

Hay más campos (`entry`, `palette`, `host`, `sounds`, `settings`…) que iremos
añadiendo en los pasos 7 y 8. `entry` es la página de entrada y, si no lo pones,
vale `index.html`.

> **¿No aparece en la galería?** Casi siempre es un JSON mal escrito (una coma
> de más al final, comillas que faltan) o un `id` con espacios o tildes. ejGames
> se salta el tema y lo apunta en `%APPDATA%\ejGames\logs\ejgames.log`, en una
> línea como `WARN ejgames_lib::themes: tema C:\…\themes\ejemplo: trailing comma
> at line 1 column 33`. Arréglalo y vuelve a entrar en Apariencia.

---

## 3. `index.html` y el primer `main.js`

### La página

Este es el `index.html` completo del tema. No cambiará en el resto de la guía,
así que lo ponemos ya entero:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Mi primer tema</title>
    <link rel="stylesheet" href="style.css" />
    <script type="module" src="main.js"></script>
  </head>
  <body>
    <header class="barra" data-ejg-drag>
      <h1>Mis juegos <span id="total" class="total"></span></h1>
      <nav class="acciones" data-ejg-nodrag>
        <button data-focus data-ui="search">Buscar</button>
        <button data-focus data-ui="settings">Ajustes</button>
      </nav>
    </header>

    <main id="rejilla" class="rejilla" data-focus-group="rejilla"></main>

    <section id="ficha" class="ficha" hidden data-focus-trap></section>

    <footer id="pistas" class="pistas"></footer>
  </body>
</html>
```

Lo importante:

- **Deja la etiqueta `<head>` tal cual**, sin atributos. ejGames mete el SDK
  (`<script src="/_sdk/ejg.js">`) justo detrás de `<head>`, antes que tus
  scripts. Si no la encuentra, lo pone al principio de todo, por delante del
  `<!doctype>`, y la página pasa a modo *quirks*.
- **`type="module"`** en tu script: así puedes usar `import` y `await` fuera de
  funciones.
- **`data-ejg-drag`** convierte la barra en el asa para arrastrar la ventana
  (doble clic maximiza). Lo que no deba arrastrar, como los botones, lleva
  **`data-ejg-nodrag`**.
- `#rejilla` tendrá las carátulas, `#ficha` será la ficha del juego (paso 6) y
  `#pistas` la barra de controles (paso 5). Los atributos `data-focus…` los
  explicamos en el paso 5.

### Un poco de estilo

Empieza `style.css` con la base: colores en variables, la página a pantalla
completa y la barra superior.

```css
:root {
  --fondo: #12141b;
  --panel: #1c1f29;
  --texto: #eceef4;
  --tenue: #9aa0ae;
  --acento: #7c5cff;
  color-scheme: dark;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }

html { height: 100%; background: var(--fondo); }
body {
  height: 100%;
  margin: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--texto);
  font: 15px/1.45 "Segoe UI", system-ui, sans-serif;
  user-select: none;
}

button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }

/* Arriba se deja una franja libre: ahí aparecen los botones de ventana del launcher. */
.barra { display: flex; align-items: center; gap: 16px; padding: 40px 32px 14px; }
.barra h1 { margin: 0; font-size: 1.6em; font-weight: 600; }
.total { margin-left: 6px; font-size: 0.6em; font-weight: 400; color: var(--tenue); }
.acciones { margin-left: auto; display: flex; gap: 6px; }
.acciones button { padding: 6px 14px; border-radius: 8px; color: var(--tenue); }
```

Esa franja libre de arriba es porque ejGames dibuja **minimizar, maximizar y
cerrar** en la esquina superior derecha (aparecen al pasar el ratón) y esa zona
recibe los clics. En el paso 8 verás cómo pintarlos tú si lo prefieres.

### El primer `main.js`

```js
const ejg = await window.ejg.ready();
const rejilla = document.querySelector("#rejilla");

function pintar() {
  document.querySelector("#total").textContent = ejg.library.all.length;
  rejilla.replaceChildren(
    ...ejg.library.all.map((g) => {
      const p = document.createElement("p");
      p.textContent = g.title;
      return p;
    }),
  );
}

ejg.library.onChange(pintar);
pintar();
```

- **`await window.ejg.ready()`** espera a que ejGames mande los datos
  (biblioteca, perfil, opciones). Empieza siempre así.
- **`ejg.library.all`** es la lista de juegos, ya ordenada por nombre. Es una
  copia en memoria: leerla no cuesta nada.
- **`ejg.library.onChange(fn)`** te avisa cuando algo cambia: juegos nuevos,
  un favorito, la carátula que acaba de descargarse… Aquí volvemos a pintarlo
  todo; en el paso siguiente lo haremos sin rehacer lo que no cambia.

Guarda, elige el tema y deberías ver los nombres de tus juegos. Cada juego
(`Game`) trae, entre otros:

| Campo | Qué es |
|---|---|
| `id`, `title` | identificador y nombre |
| `installed` | `false` si lo tienes en Steam, Epic o GOG pero no está instalado |
| `favorite`, `hidden` | favorito / oculto por el usuario |
| `playtime`, `lastPlayed` | segundos jugados y última partida (fecha Unix, en segundos) |
| `developer`, `releaseDate`, `genres` | datos de la ficha |
| `media` | URLs del arte: `coverThumb`/`cover` (carátula 2:3), `heroThumb`/`hero` (fondo panorámico), `logo`, `header`, `icon`… |

La lista completa está en `THEMES.md`.

---

## 4. Rejilla de carátulas

ejGames trae un **kit** de utilidades opcionales en `/_sdk/kit/`. Se importan
con rutas que empiezan por `/_sdk/…`; tus propios ficheros, con rutas relativas
(`./util.js`). Para la rejilla usaremos estas piezas de `dom.js` y `library.js`:

- **`h(etiqueta, propiedades, ...hijos)`** crea elementos sin escribir
  `createElement` cada vez. `class` pone la clase, `onclick` añade el evento y
  lo demás (`title`, `data-…`) se pone como atributo. El `style` puede ser un
  texto (`"--tono: 120"`) o un objeto (`{ opacity: "0.5" }`); para variables CSS
  usa el texto.
- **`img(url)`** crea una `<img>` con carga perezosa (`loading="lazy"`). Le pone
  la clase `img-loaded` cuando carga, `img-error` si falla e `img-empty` si no
  había URL, así que el CSS decide qué enseñar en cada caso.
- **`keyed(contenedor, lista, clave, pintarUno)`** redibuja reutilizando los
  nodos que ya existían. `pintarUno(juego, anterior)` recibe el nodo anterior de
  ese juego (o nada) y devuelve el que toca. Con cientos de juegos va rápido y
  el foco no salta.
- **`visible(juegos)`** quita los ocultos y los desaparecidos (que `library.all`
  sí incluye) y **`sort(juegos, "title")`** ordena (`"title"`, `"recent"`,
  `"playtime"`, `"added"`, `"release"` o `"rating"`).

Sustituye `main.js` por esto:

```js
import { h, img, keyed, initials, hueOf } from "/_sdk/kit/dom.js";
import { visible, sort } from "/_sdk/kit/library.js";

const ejg = await window.ejg.ready();
const rejilla = document.querySelector("#rejilla");
const total = document.querySelector("#total");

function juegos() {
  return sort(visible(ejg.library.all), "title");
}

function nuevaTarjeta(g, firma) {
  return h(
    "button",
    { class: "tarjeta", "data-id": g.id, "data-firma": firma, title: g.title, onclick: () => jugar(g.id) },
    h(
      "div",
      { class: "caratula", style: `--tono: ${hueOf(g.title)}` },
      h("span", { class: "iniciales" }, initials(g.title)),
      img(g.media.coverThumb),
    ),
    h("span", { class: "nombre" }, g.title),
  );
}

function tarjeta(g, prev) {
  // Solo se crea una tarjeta nueva si cambia lo que se ve (nombre o carátula).
  const firma = `${g.title}|${g.media.coverThumb ?? ""}`;
  const el = prev && prev.dataset.firma === firma ? prev : nuevaTarjeta(g, firma);
  el.classList.toggle("fav", g.favorite);
  el.classList.toggle("sin-instalar", g.installed === false);
  return el;
}

function pintar() {
  const lista = juegos();
  total.textContent = lista.length;
  if (!lista.length) {
    rejilla.replaceChildren(
      h("div", { class: "vacia" },
        h("p", null, "Tu biblioteca está vacía."),
        h("button", { class: "boton", onclick: () => ejg.ui.open("add-folder") }, "Añadir juegos")),
    );
    return;
  }
  keyed(rejilla, lista, (g) => g.id, tarjeta);
}

async function jugar(id) {
  try {
    await ejg.game.launch(id);
  } catch (e) {
    ejg.ui.toast(String(e.message || e), "error");
  }
}

ejg.library.onChange(pintar);
pintar();
```

Unas cuantas ideas de este código:

- **Miniaturas en la rejilla.** `coverThumb` pesa unos 40 KB; `cover` es la
  imagen grande. En listas y rejillas, siempre miniaturas.
- **La «firma»** es el truco para no rehacer tarjetas: si el nombre y la
  carátula son los mismos, se reutiliza la anterior y solo se cambian las clases
  (favorito, sin instalar). Cuando llega la carátula de un juego recién añadido,
  la firma cambia y se crea una tarjeta nueva.
- **Sin carátula** se ven las iniciales (`initials("Hollow Knight")` → `HK`)
  sobre un degradado cuyo color sale del nombre (`hueOf()`), y la imagen se
  queda invisible hasta que carga.
- **`ejg.game.launch(id)`** lanza el juego (el sonido de lanzar lo pone
  ejGames). Con un juego sin instalar abre su tienda para instalarlo. Si falla,
  la promesa se rechaza y lo enseñamos con **`ejg.ui.toast(texto, "error")`**.
- **`ejg.ui.open("add-folder")`** abre la pantalla del launcher para añadir
  carpetas de juegos. Hay más: `"settings"`, `"search"`, `"menu"`, `"stats"`,
  `"profiles"`, `"collections"`, `"theme"`…

Y el CSS de la rejilla (añádelo a `style.css`):

```css
.rejilla {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 24px 90px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  align-content: start;
}
.tarjeta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  /* Con cientos de juegos, el navegador no dibuja las que no se ven. */
  content-visibility: auto;
  contain-intrinsic-size: auto 270px;
}
.caratula {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  background: linear-gradient(160deg, hsl(var(--tono) 45% 32%), hsl(var(--tono) 50% 14%));
  transition: transform 0.15s, box-shadow 0.15s;
}
.iniciales { position: absolute; inset: 0; display: grid; place-items: center; font-size: 2.2em; font-weight: 700; opacity: 0.75; }
.caratula img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.25s; }
.caratula img.img-loaded { opacity: 1; }
.nombre { font-size: 0.9em; color: var(--tenue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.tarjeta.fav .caratula::after { content: "★"; position: absolute; top: 6px; right: 9px; color: #ffd166; text-shadow: 0 1px 4px #000; }
.tarjeta.sin-instalar .caratula img { filter: grayscale(1) brightness(0.7); }
.vacia { grid-column: 1 / -1; padding: 60px 0; text-align: center; color: var(--tenue); }
```

> **`content-visibility: auto`** ahorra mucho con bibliotecas grandes, pero
> **recorta todo lo que se salga de la tarjeta** (sombras, anillos de foco,
> zooms). Por eso la tarjeta lleva `padding: 8px`: deja sitio para el efecto de
> foco del paso siguiente.

Guarda: ya tienes una rejilla de carátulas y un clic lanza el juego.

---

## 5. Mando y teclado

ejGames traduce el teclado y el mando a **acciones**, iguales para los dos:

| Acción | Teclado | Mando |
|---|---|---|
| `up` `down` `left` `right` | flechas | cruceta o stick izquierdo |
| `accept` | Enter, Espacio | A (✕ en PlayStation) |
| `back` | Esc, Retroceso | B (○) |
| `x` / `y` | E / F | X / Y (□ / △) |
| `lb` / `rb` | RePág / AvPág (y Mayús+Tab / Tab) | LB / RB |
| `lt` / `rt` | Inicio / Fin | LT / RT |
| `menu` | tecla de menú contextual | Start / Menú |
| `view` | — | Back / Vista |

El botón Guía del mando abre siempre el menú rápido de ejGames. F5, F11,
Ctrl + F, Ctrl + , , Ctrl + P y Ctrl + K son atajos del launcher y no llegan a
tu tema como acciones.

No tienes que calcular tú qué hay arriba o a la derecha: el kit trae una
**navegación espacial** en `focus.js`.

1. Marca con **`data-focus`** todo lo que se pueda elegir. Los dos botones de la
   barra ya lo llevan en el HTML. Añádelo a la tarjeta y al botón de la
   biblioteca vacía:

   ```js
   { class: "tarjeta", "data-focus": "", "data-id": g.id, "data-firma": firma, title: g.title, onclick: () => jugar(g.id) },
   // …
   h("button", { class: "boton", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "Añadir juegos")
   ```

2. Crea el foco y conéctalo a las acciones. Añade al principio de `main.js`:

   ```js
   import { createFocus, bindNav } from "/_sdk/kit/focus.js";
   import { hints } from "/_sdk/kit/hints.js";
   ```

   y, después de `ready()`:

   ```js
   const foco = createFocus();

   bindNav(foco, {
     y: () => {
       const id = Number(foco.current?.dataset.id);
       if (!id) return false;
       ejg.game.favorite(id);
     },
     menu: () => {
       ejg.ui.open("menu");
     },
   });

   // Al cerrar una pantalla del launcher (ajustes, buscador…), recuperar el foco.
   ejg.on("focus-return", () => foco.restore());

   // Los botones de la barra abren pantallas del launcher.
   for (const b of document.querySelectorAll("[data-ui]")) {
     b.addEventListener("click", () => ejg.ui.open(b.dataset.ui));
   }
   ```

3. Enseña el foco en CSS. El elemento enfocado lleva la clase **`is-focused`**:

   ```css
   button:focus { outline: none; } /* el foco se dibuja con .is-focused */
   .acciones button.is-focused { color: var(--texto); background: color-mix(in srgb, var(--texto) 12%, transparent); }
   .tarjeta.is-focused .caratula { transform: scale(1.03); box-shadow: 0 0 0 3px var(--acento); }
   .tarjeta.is-focused .nombre { color: var(--texto); }
   ```

4. Que siempre haya algo enfocado. Al final de `pintar()`, después de `keyed(…)`:

   ```js
   // Si el elemento enfocado ya no está (al arrancar, o porque su tarjeta se ha
   // rehecho al llegar la carátula), el foco pasa a su sustituta o a la primera.
   if (!foco.current?.isConnected) {
     const otra = (idEnfocado && rejilla.querySelector(`[data-id="${idEnfocado}"]`)) || rejilla.querySelector("[data-focus]");
     if (otra) foco.focus(otra, { noScroll: true, silent: true });
   }
   ```

   con `const idEnfocado = foco.current?.dataset.id;` al principio de `pintar()`.

Cómo funciona:

- **`bindNav(foco, { acción: función })`**: las flechas mueven el foco y
  `accept` hace clic en el elemento enfocado (con su sonido). Tus funciones se
  ejecutan antes. Si una devuelve **`false`**, la acción **no** se da por
  gestionada; con `back`, eso significa que la gestiona ejGames (cierra lo que
  tenga abierto y, en Big Picture, abre el menú rápido).
- **`foco.current`** es el elemento enfocado; `foco.focus(el)` enfoca uno
  concreto y `foco.first(contenedor)` el primero de un contenedor. Con
  `{ silent: true }` no suena y con `{ noScroll: true }` no desplaza.
- **`ejg.game.favorite(id)`** alterna el favorito (o lo fija si le pasas
  `true`/`false`). No hace falta repintar a mano: el cambio llega por
  `library.onChange` y la tarjeta se actualiza sola.
- **`data-focus-group`** (lo lleva `#rejilla`) recuerda el último elemento
  enfocado del grupo: si subes a la barra y vuelves a bajar, regresas a la misma
  carátula.
- **Con ratón**, pasar por encima enfoca y al salir se quita la marca, para que
  no se quede «pegada». Con mando se oculta el cursor.

### La barra de pistas

`hints()` pinta los controles con los símbolos del dispositivo que se esté
usando: A B X Y con un mando de Xbox, ✕ ○ □ △ con uno de PlayStation, Enter, Esc,
E, F con teclado. Cambia sola cuando cambias de dispositivo:

```js
const pistas = hints(document.querySelector("#pistas"), [["accept", "Jugar"], ["y", "Favorito"], ["menu", "Menú"]]);
```

Luego puedes cambiar los textos con `pistas.set([...])`. El `<html>` lleva
`data-input="mouse|keyboard|gamepad"`, así que ocultarla con ratón es CSS puro:

```css
.pistas {
  position: fixed; right: 20px; bottom: 16px; z-index: 20;
  display: flex; gap: 18px; padding: 8px 14px; border-radius: 99px;
  background: rgb(0 0 0 / 0.55); backdrop-filter: blur(8px); font-size: 13px;
}
.pistas:empty, html[data-input="mouse"] .pistas { display: none; }
```

Prueba ya con las flechas, Enter y F (favorito).

---

## 6. La ficha del juego

Ahora, en vez de lanzar el juego al pulsar una carátula, abriremos una ficha
con su descripción y sus botones. La ficha es la `<section id="ficha" hidden
data-focus-trap>` del HTML:

- **`hidden`**: empieza oculta.
- **`data-focus-trap`**: mientras se vea, el foco no sale de ella (las flechas
  no se escapan a la rejilla que queda detrás).

Cambia el `onclick` de la tarjeta por `onclick: () => abrirFicha(g.id)` y añade
esto a `main.js` (añade también `description`, `playtime` y `year` a los
imports: `import { description, playtime, year } from "/_sdk/kit/format.js";`):

```js
let fichaId = null;
let turno = 0; // para descartar respuestas de una ficha que ya se cerró

async function abrirFicha(id) {
  const g = ejg.library.byId(id);
  if (!g) return;
  fichaId = id;
  const miTurno = ++turno;

  const fondo = g.media.hero || g.media.heroThumb;
  const texto = h("div", { class: "descripcion" }, h("p", null, "Cargando…"));
  const botones = h("div", { class: "botones" });
  ficha.replaceChildren(
    h("div", { class: "ficha-fondo", style: fondo ? `background-image: url("${fondo}")` : null }),
    h(
      "div",
      { class: "ficha-contenido" },
      h("div", { class: "ficha-caratula" }, img(g.media.cover || g.media.coverThumb)),
      h(
        "div",
        { class: "ficha-info" },
        h("h2", null, g.title),
        h("p", { class: "datos" }, [g.developer, year(g.releaseDate), playtime(g.playtime)].filter(Boolean).join(" · ")),
        botones,
        texto,
      ),
    ),
  );
  pintarBotones(g);
  ficha.hidden = false;
  ejg.sound.play("open");
  foco.first(botones);
  pistasFicha();

  // La descripción larga no viene en la biblioteca: se pide aparte.
  try {
    const d = await ejg.game.details(id);
    if (miTurno !== turno) return;
    texto.replaceChildren(description(d.description || d.shortDescription || "Sin descripción."));
  } catch {
    if (miTurno === turno) texto.replaceChildren(h("p", null, "No se ha podido cargar la descripción."));
  }
}
```

(y `const ficha = document.querySelector("#ficha");` junto a las demás constantes).

- **`ejg.library.byId(id)`** da el juego al instante, sin esperar.
- **`ejg.game.details(id)`** pide lo que no viene en la biblioteca: la
  descripción, capturas (`screenshots`), tráileres (`trailers`) y últimas
  sesiones (`recentSessions`). Es asíncrono, así que primero pintamos la ficha y
  luego rellenamos el texto. El `turno` evita que, si el usuario abre y cierra
  fichas deprisa, la descripción de un juego acabe en la ficha de otro.
- **`description(texto)`** convierte el formato de las descripciones (`## título`,
  `- viñeta` y párrafos separados por una línea en blanco) en elementos HTML
  seguros. No uses `innerHTML` con textos que vienen de fuera.
- **`playtime(segundos)`** → «12 h 34 min» o «Sin jugar»; **`year(fecha)`** → «2017».
- Aquí sí usamos las imágenes grandes (`cover`, `hero`): en una ficha solo hay una.

Los botones van aparte porque se repintan cuando cambia algo (favorito, partida
en marcha):

```js
function pintarBotones(g) {
  const caja = ficha.querySelector(".botones");
  if (!caja) return;
  const enMarcha = ejg.game.isRunning(g.id);
  const antes = foco.current?.dataset.accion;
  caja.replaceChildren(
    h(
      "button",
      { class: "boton principal", "data-focus": "", "data-accion": "jugar", onclick: () => jugar(g.id) },
      enMarcha ? "En marcha" : g.installed === false ? "Instalar" : "Jugar",
    ),
    h("button", { class: "boton", "data-focus": "", "data-accion": "fav", onclick: () => ejg.game.favorite(g.id) }, g.favorite ? "★ Favorito" : "☆ Favorito"),
    h("button", { class: "boton", "data-focus": "", "data-accion": "editar", onclick: () => ejg.game.edit(g.id) }, "Editar"),
    h("button", { class: "boton", "data-focus": "", "data-accion": "volver", onclick: cerrarFicha }, "Volver"),
  );
  // Tras repintar, el foco vuelve al mismo botón.
  const b = antes && caja.querySelector(`[data-accion="${antes}"]`);
  if (b) foco.focus(b, { noScroll: true, silent: true });
}

async function jugar(id) {
  if (ejg.game.isRunning(id)) return;
  const b = ficha.querySelector('[data-accion="jugar"]');
  if (b) b.textContent = "Iniciando…";
  try {
    await ejg.game.launch(id); // el sonido de lanzar lo pone ejGames
  } catch (e) {
    ejg.ui.toast(String(e.message || e), "error");
  }
  const g = ejg.library.byId(id);
  if (g && fichaId === id) pintarBotones(g);
}

function cerrarFicha() {
  if (ficha.hidden) return;
  const id = fichaId;
  fichaId = null;
  turno++;
  ficha.hidden = true;
  ficha.replaceChildren();
  ejg.sound.play("back");
  pistasRejilla();
  const t = rejilla.querySelector(`[data-id="${id}"]`);
  if (t) foco.focus(t, { silent: true });
  else foco.first(rejilla);
}
```

- **Jugar o Instalar** según `installed`; **En marcha** si
  `ejg.game.isRunning(id)`.
- **`ejg.game.edit(id)`** abre el editor de juegos de ejGames (nombre, arte,
  ejecutable…). Al cerrarlo llega `focus-return` y el foco vuelve al botón.

Queda enseñar a `bindNav` que **Atrás** cierra la ficha y que el favorito
también funciona dentro de ella, cambiar las pistas según dónde estemos y
repintar cuando algo cambie:

```js
bindNav(foco, {
  // Sin ficha abierta devolvemos false: así "Atrás" lo gestiona ejGames.
  back: () => {
    if (ficha.hidden) return false;
    cerrarFicha();
  },
  y: () => {
    const id = fichaId ?? Number(foco.current?.dataset.id);
    if (!id) return false;
    ejg.game.favorite(id);
  },
  menu: () => {
    ejg.ui.open("menu");
  },
});

const pistas = hints(document.querySelector("#pistas"), []);
const pistasRejilla = () => pistas.set([["accept", "Abrir"], ["y", "Favorito"], ["menu", "Menú"]]);
const pistasFicha = () => pistas.set([["accept", "Elegir"], ["back", "Volver"], ["y", "Favorito"]]);

const repintar = debounce(() => {
  pintar();
  if (fichaId) {
    const g = ejg.library.byId(fichaId);
    if (g) pintarBotones(g);
    else cerrarFicha();
  }
}, 50);
ejg.library.onChange(repintar); // juegos nuevos, favoritos, carátulas…
ejg.on("running", repintar); // un juego empieza o termina

pintar();
pistasRejilla();
```

Sustituye con esto el `bindNav`, la barra de pistas y las dos últimas líneas
que tenías, y añade `debounce` al `import` de `dom.js`: agrupa varios avisos
seguidos en un solo repintado. El CSS de la ficha, resumido (el completo está en
`docs/ejemplo-tema/style.css`):

```css
.ficha { position: fixed; inset: 0; z-index: 10; overflow-y: auto; background: var(--fondo); }
.ficha-fondo { position: absolute; inset: 0 0 auto; height: 75vh; background: center / cover no-repeat; opacity: 0.35;
               mask-image: linear-gradient(#000 35%, transparent); }
.ficha-contenido { position: relative; display: flex; align-items: flex-start; gap: 40px; padding: 90px 64px 64px; max-width: 1200px; }
.ficha-caratula { flex: none; width: 240px; aspect-ratio: 2 / 3; border-radius: 12px; overflow: hidden; background: var(--panel); }
.ficha-caratula img { width: 100%; height: 100%; object-fit: cover; }
.ficha-caratula img.img-empty, .ficha-caratula img.img-error { display: none; }
.botones { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 26px; }
.boton { padding: 10px 18px; border-radius: 8px; background: color-mix(in srgb, var(--texto) 10%, transparent); }
.boton.principal { padding-inline: 30px; background: var(--acento); color: #fff; font-weight: 600; }
.boton.is-focused { box-shadow: 0 0 0 3px var(--texto); }
```

---

## 7. Opciones sin código y modo Big Picture

### Opciones en Ajustes → Apariencia

Cualquier usuario puede personalizar tu tema sin abrir un fichero si declaras
**`settings`** en `theme.json`. Este es el `theme.json` completo del ejemplo:

```json
{
  "id": "ejemplo",
  "name": "Mi primer tema",
  "version": "1.0.0",
  "author": "Tu nombre",
  "description": "Rejilla de carátulas con ficha de juego (el tema de la guía)",
  "sdk": 1,
  "entry": "index.html",
  "modes": ["desktop", "tv"],
  "palette": ["#12141b", "#1c1f29", "#7c5cff", "#eceef4"],
  "host": { "accent": "#7c5cff", "surface": "#161922", "radius": "10px", "dark": true },
  "sounds": { "preset": "soft" },
  "windowControls": "host",
  "settings": [
    { "key": "accent", "type": "color", "label": "Color de acento", "default": "#7c5cff" },
    { "key": "wallpaper", "type": "image", "label": "Imagen de fondo" },
    { "key": "cardSize", "type": "range", "label": "Tamaño de las carátulas", "min": 120, "max": 260, "step": 10, "unit": "px", "default": 160, "group": "Rejilla" },
    { "key": "showTitles", "type": "toggle", "label": "Nombre bajo la carátula", "default": true, "group": "Rejilla" },
    { "key": "order", "type": "select", "label": "Orden", "default": "title", "group": "Rejilla", "options": [
      { "value": "title", "label": "Nombre" },
      { "value": "recent", "label": "Jugado recientemente" },
      { "value": "playtime", "label": "Horas jugadas" }
    ] }
  ]
}
```

(Con el modo desarrollador, los cambios de `theme.json` se aplican al guardar; si
no, pulsa F5.)

En **Ajustes → Apariencia** aparecerán dos bloques, «Mi primer tema · General»
y «Mi primer tema · Rejilla» (sale del campo `group`), con un botón
**Restablecer**. ejGames añade por su cuenta el selector de **Sonidos de
navegación** (paso 8) y un cuadro de **CSS extra** con el que cada perfil puede
retocar tu tema.

Cada opción llega a tu página **sola**, de dos formas:

1. Una **variable CSS** en `<html>`: `--ejg-` + la clave en minúsculas con
   guiones (`cardSize` → `--ejg-card-size`).
2. Para `toggle` y `select`, además, un **atributo** `data-…` en `<html>`.

| `type` | Control | Variable CSS | Atributo |
|---|---|---|---|
| `color` | selector de color | `--ejg-accent: #7c5cff` | — |
| `range` / `number` | deslizador (`min`, `max`, `step`, `unit`) | `--ejg-card-size: 160px` (con su `unit`) | — |
| `toggle` | interruptor | `--ejg-show-titles: 1` o `0` | `data-show-titles="on"` / `"off"` |
| `select` | lista (`options`) | `--ejg-order: title` | `data-order="title"` |
| `font` | tipografías de Windows | `--ejg-…: "Segoe UI", system-ui, sans-serif` | — |
| `image` | imagen o vídeo del usuario | `--ejg-wallpaper: url("…")` | — |
| `text` | cuadro de texto | el texto tal cual | — |

Una opción sin valor (como `wallpaper` mientras no se elija nada) **no** crea la
variable, así que usa siempre un valor de reserva en `var()`. En el CSS del
ejemplo:

```css
:root {
  --acento: var(--ejg-accent, #7c5cff);
  --carta: var(--ejg-card-size, 160px);
}
.rejilla { grid-template-columns: repeat(auto-fill, minmax(var(--carta), 1fr)); }
html[data-show-titles="off"] .nombre { display: none; }

/* Imagen de fondo: detrás de todo y atenuada. */
body::before {
  content: ""; position: fixed; inset: 0; z-index: -1;
  background: var(--ejg-wallpaper, none) center / cover no-repeat;
  opacity: 0.3;
}
```

(Si has seguido la guía, cambia `--acento: #7c5cff;` por la línea de arriba y
pon `var(--carta)` donde tenías `160px` en la rejilla.)

Cuando la opción la tienes que leer **desde JavaScript** (aquí, el orden), está
en **`ejg.settings`**, y **`ejg.on("settings", …)`** avisa cuando el usuario la
cambia:

```js
function juegos() {
  // visible(): sin ocultos ni desaparecidos. El orden es una opción del tema.
  return sort(visible(ejg.library.all), ejg.settings.order);
}

ejg.on("settings", repintar); // "Orden" se aplica en JavaScript
```

> El tipo `image` también admite **vídeos** mp4/webm. Un vídeo no sirve como
> `background` de CSS: si quieres admitirlo, compruébalo en `ejg.settings` y
> pinta un `<video muted loop autoplay>` (el tema Steam lo hace así).

### Modo Big Picture

Big Picture es el modo «tele»: pantalla completa y pensado para el mando. Se
entra desde el menú rápido (**Ctrl + K** o el botón Guía del mando → **Big
Picture**) o desde **Ajustes → Sistema**. Al entrar, ejGames:

- pone **`data-mode="tv"`** en el `<html>` de tu tema (`ejg.mode` vale `"tv"` y
  `ejg.on("mode", …)` avisa del cambio);
- oculta sus botones de ventana;
- y, si pulsas **Atrás** sin nada abierto (tu `back` devolvió `false`), abre el
  menú rápido.

Con CSS basta para adaptarse: letra y carátulas más grandes, y fuera lo que no
se usa con mando.

```css
html[data-mode="tv"] { --carta: calc(var(--ejg-card-size, 160px) * 1.3); }
html[data-mode="tv"] body { font-size: 19px; }
html[data-mode="tv"] .acciones { display: none; }
```

El campo `"modes": ["desktop", "tv"]` de `theme.json` es informativo: todos los
temas reciben `data-mode="tv"` en Big Picture, así que diséñalo para los dos.

---

## 8. Sonidos y colores del launcher

### Sonidos

Muchos suenan sin que hagas nada:

| Sonido | Cuándo |
|---|---|
| `move` | al mover el foco con `createFocus` (no al pasar el ratón) |
| `select` | al pulsar `accept` con `bindNav` |
| `launch` / `error` | al lanzar un juego con `ejg.game.launch()` / si falla |
| `open` | al abrir una pantalla del launcher con `ejg.ui.open()` |

Los demás los pones tú con **`ejg.sound.play(nombre)`**: en el ejemplo, `"open"`
al abrir la ficha y `"back"` al cerrarla (cuando tu tema gestiona el `back`,
ejGames no suena por su cuenta).

Qué sonidos se oyen lo decide `sounds` en `theme.json`:

```json
"sounds": { "preset": "soft" }
```

Los juegos de sonidos de serie son `soft`, `ps`, `xbox`, `switch`, `retro` y
`none`. También puedes poner **tus propios ficheros** (wav, ogg o mp3, con
rutas relativas a la carpeta del tema); los que falten se toman del `preset`:

```json
"sounds": { "preset": "soft", "move": "sounds/move.wav", "select": "sounds/select.wav" }
```

Las claves son `move`, `select`, `back`, `launch`, `error` y `open`. Ten en
cuenta que el usuario manda: si en **Apariencia → Sonidos de navegación** elige
otro juego de sonidos (o «Sin sonidos»), se usa ese y no tus ficheros. El volumen
es un ajuste de cada perfil (**Ajustes → Perfil**).

### Colores de las pantallas del launcher

Las pantallas de ejGames que se abren encima de tu tema (ajustes, buscador,
editor…) pueden llevar tus colores con **`host`**:

```json
"host": { "accent": "#7c5cff", "surface": "#161922", "radius": "10px", "dark": true }
```

| Clave | Qué cambia |
|---|---|
| `accent` | color de acento (botones, interruptores, foco). Sin él, el color del perfil. Los textos sobre el acento son blancos: elige un color con contraste. |
| `surface` | fondo de los paneles |
| `text` | color del texto |
| `radius` | redondeo de las esquinas (`"10px"`) |
| `font` | tipografía (`"Consolas, monospace"`) |
| `dark` | `false` para pantallas claras |

Y para la galería:

- **`palette`**: cuatro colores **en este orden: fondo, superficie, acento y
  texto**. Si no hay imagen de vista previa, la galería dibuja un boceto con
  ellos.
- **`preview`**: una imagen de tu tema (`"preview": "preview.jpg"`), en la
  carpeta del tema. La tarjeta es de 16:10.

### Botones de ventana

Con **`"windowControls": "host"`** (lo del ejemplo) ejGames dibuja minimizar,
maximizar y cerrar en la esquina superior derecha, visibles al pasar el ratón.
Si prefieres pintarlos tú, pon `"theme"` y usa **`ejg.window.minimize()`**,
**`ejg.window.maximize()`** (alterna) y **`ejg.window.close()`**. Para arrastrar
la ventana, `data-ejg-drag` como en el paso 3.

---

## 9. Depurar y errores típicos

### Ver los errores

- Con el **modo desarrollador** activado, los errores sin capturar de tu tema
  salen como avisos: «Tema: Uncaught SyntaxError: …».
- Para tener las **herramientas de desarrollo** de verdad (consola, inspector,
  red):
  1. Sal de ejGames del todo (menú rápido → **Salir de ejGames**).
  2. Ábrelo desde una ventana de `cmd` con la depuración remota activada:

     ```bat
     set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
     "%LOCALAPPDATA%\ejGames\ejgames.exe"
     ```

     (cambia la ruta si lo instalaste en otro sitio).
  3. En Edge, abre `edge://inspect` (si no sale nada, pulsa **Configure…** y
     añade `localhost:9222`) y pulsa **inspect** en la entrada de tipo iframe
     que empieza por `http://ejg-theme.localhost/ejemplo/`. Ahí tienes la
     consola de tu tema: `console.log()` escribe ahí. También vale inspeccionar
     la página `http://tauri.localhost/` y elegir el iframe del tema en el
     selector de contexto de la consola (donde pone «top»).

### Lo que un tema no puede hacer

El tema vive en una caja cerrada por seguridad. Esto **no** funciona:

| Quieres… | Qué pasa | Qué hacer |
|---|---|---|
| Datos de internet (`fetch`, una API) | bloqueado | Todo lo que necesites, dentro de la carpeta del tema. |
| Fuentes, imágenes o scripts de internet (Google Fonts, un CDN) | no cargan | Descárgalos a la carpeta y usa rutas relativas: `@font-face { src: url("fonts/mi-fuente.woff2"); }` |
| Leer tus propios ficheros con `fetch("datos.json")` | también bloqueado: `fetch` solo llega al arte de la biblioteca (`http://ejg-media.localhost`) | Pon los datos en un módulo JS (`export default { … }`) y cárgalo con `import datos from "./datos.js";`. Imágenes, CSS, fuentes, audio y vídeo del tema sí cargan en sus etiquetas. |
| `localStorage`, `sessionStorage`, `IndexedDB`, cookies | lanzan `SecurityError` | `ejg.storage` (abajo). |
| `alert()`, `confirm()`, `prompt()` | no hacen nada | `ejg.ui.toast("Texto", "info" \| "ok" \| "error")` o tu propio diálogo en HTML. |
| Abrir webs | `window.open` está bloqueado, y un enlace `<a href="https://…">` abre la web **dentro** del tema, que desaparece (a los pocos segundos ejGames carga el tema Steam) | No pongas enlaces a webs. |
| Acceder al disco, a otros programas o a Tauri | imposible | Solo lo que ofrece `window.ejg`. |

Para guardar cosas (el último juego abierto, un filtro…) usa **`ejg.storage`**:
cada tema tiene 512 KB por perfil y guarda cualquier valor JSON.

```js
await ejg.storage.set("ultimo", 42);
const ultimo = await ejg.storage.get("ultimo"); // 42 (undefined si no existe)
const todo = await ejg.storage.getAll();        // { ultimo: 42, … }
```

Gracias a estas restricciones, instalar el tema de otra persona es seguro: como
mucho puede lanzar juegos de tu biblioteca o abrir pantallas del launcher.

### Errores típicos

| Síntoma | Causa probable |
|---|---|
| El tema no sale en la galería | `theme.json` con errores o `id` no válido (mira `logs\ejgames.log`). |
| Cambié `theme.json` y no se nota | Tiene un error (el tema sigue con la versión anterior): mira el log. |
| Guardo y no se recarga | Modo desarrollador apagado. Mientras, F5. |
| Pantalla en blanco | Error de JavaScript (activa el modo desarrollador), `import` mal escrito (las rutas del kit empiezan por `/_sdk/kit/`, las tuyas por `./`) o falta `type="module"` en el `<script>` (sin él, `await` e `import` dan error). |
| «No responde. Se ha cargado el tema Steam» | Tu código bloquea la página (un bucle que no termina, un cálculo enorme al arrancar). |
| El mando no llega a un botón | Le falta `data-focus`, o está oculto o `disabled`. |
| Las flechas se escapan de un panel | Ponle `data-focus-trap` al panel. |
| Esc cierra tu panel **y** además actúa ejGames (en Big Picture, se abre el menú rápido) | Tu `back` no se dio por gestionado: en `bindNav`, no devuelvas `false` cuando sí lo has usado. |
| Tras cerrar los ajustes no hay foco | Falta `ejg.on("focus-return", () => foco.restore())`. |
| El anillo de foco sale cortado | `content-visibility: auto` recorta lo que sobresale: deja `padding` en la tarjeta. |
| Un elemento con `hidden` se sigue viendo | Tu CSS le da `display`: añade `[hidden] { display: none !important; }`. |
| Un clic arriba a la derecha no llega | Esa esquina es de los botones de ventana del launcher (`windowControls: "host"`). |
| La variable CSS no se aplica desde `h()` | Con `style` como objeto no se pueden poner variables: usa texto, `style: "--tono: 120"`. |

---

## 10. Exportar y compartir

Cuando tu tema esté listo:

1. Cambia en `theme.json` el `id` (si lo has copiado de aquí, que no sea
   `ejemplo`), el `name`, el `author` y la `version`. Si puedes, añade una
   `preview`.
2. Quita de la carpeta lo que no haga falta: **se exporta todo lo que haya
   dentro**.
3. Elige tu tema en **Ajustes → Apariencia** y pulsa **Exportar .ejtheme**
   (exporta el tema activo y te pregunta dónde guardarlo). Un `.ejtheme` no es
   más que un zip con la carpeta del tema.

Para instalarlo en otro PC: **Ajustes → Apariencia → Importar**, elige el
`.ejtheme` y queda instalado y seleccionado. Detalles útiles:

- También acepta un `.zip` hecho a mano, con `theme.json` en la raíz o dentro
  de una única carpeta.
- Se instala en `themes\<id>`. **Si ya había un tema con ese `id`, lo
  sustituye.**
- No se puede importar un tema con el `id` de uno de serie («El id «steam» es de
  un tema de serie; cámbialo en theme.json»).
- Límite: 200 MB descomprimido.

---

## Y ahora, ¿qué?

- **[`docs/THEMES.md`](THEMES.md)** tiene la referencia completa: logros
  (`ejg.game.achievements()`), colecciones (`ejg.library.collections`),
  estadísticas (`ejg.stats`), tráileres con `attachStream()`, fondos con fundido
  (`createBackdrop()`), arte que encaja en cualquier marco (`artFor()`)…
- Los temas de serie están hechos exactamente con lo mismo: **Retro** es el más
  sencillo y **Steam** el más completo. Los encontrarás en la carpeta `themes`
  de la instalación (normalmente `%LOCALAPPDATA%\ejGames\themes`), y **Duplicar para
  editar** (Apariencia) copia cualquiera a tu carpeta de temas para que
  trastees con él.
