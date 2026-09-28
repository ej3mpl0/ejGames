// Mi primer tema: rejilla de carátulas + ficha de juego.
// Es el tema que se construye paso a paso en la guía: https://ej3mplo.mintlify.site/guia

import { h, img, keyed, debounce, initials, hueOf } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { visible, sort } from "/_sdk/kit/library.js";
import { description, playtime, year } from "/_sdk/kit/format.js";
import { hints } from "/_sdk/kit/hints.js";
import { bytes, speed, percent } from "/_sdk/kit/store.js";

// Espera a que ejGames mande la biblioteca, el perfil y las opciones.
const ejg = await window.ejg.ready();

const rejilla = document.querySelector("#rejilla");
const ficha = document.querySelector("#ficha");
const total = document.querySelector("#total");

// ─────────────── foco, mando y teclado ───────────────
const foco = createFocus();

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

// Al cerrar una pantalla de ejGames (ajustes, editor…), recuperar el foco.
ejg.on("focus-return", () => foco.restore());

const pistas = hints(document.querySelector("#pistas"), []);
const pistasRejilla = () => pistas.set([["accept", "Abrir"], ["y", "Favorito"], ["menu", "Menú"]]);
const pistasFicha = () => pistas.set([["accept", "Elegir"], ["back", "Volver"], ["y", "Favorito"]]);

// ─────────────── rejilla ───────────────
function juegos() {
  // visible(): sin ocultos ni desaparecidos. El orden es una opción del tema.
  return sort(visible(ejg.library.all), ejg.settings.order);
}

function tarjeta(g, prev) {
  // Solo se crea una tarjeta nueva si cambia lo que se ve (nombre o carátula);
  // si no, se reutiliza la anterior y el foco no salta.
  const firma = `${g.title}|${g.media.coverThumb ?? ""}`;
  const el = prev && prev.dataset.firma === firma ? prev : nuevaTarjeta(g, firma);
  el.classList.toggle("fav", g.favorite);
  el.classList.toggle("en-marcha", ejg.game.isRunning(g.id));
  return el;
}

function nuevaTarjeta(g, firma) {
  return h(
    "button",
    { class: "tarjeta", "data-focus": "", "data-id": g.id, "data-firma": firma, title: g.title, onclick: () => abrirFicha(g.id) },
    h(
      "div",
      { class: "caratula", style: `--tono: ${hueOf(g.title)}` },
      h("span", { class: "iniciales" }, initials(g.title)),
      img(g.media.coverThumb),
    ),
    h("span", { class: "nombre" }, g.title),
  );
}

function pintar() {
  const lista = juegos();
  const idEnfocado = foco.current?.dataset.id;
  total.textContent = lista.length;

  if (!lista.length) {
    rejilla.replaceChildren(
      h(
        "div",
        { class: "vacia" },
        h("p", null, "Tu biblioteca está vacía."),
        h("button", { class: "boton", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "Añadir juegos"),
      ),
    );
    return;
  }

  keyed(rejilla, lista, (g) => g.id, tarjeta);

  // Si el elemento enfocado ya no está (al arrancar, o porque su tarjeta se ha
  // rehecho al llegar la carátula), el foco pasa a su sustituta o a la primera.
  if (!foco.current?.isConnected) {
    const otra = (idEnfocado && rejilla.querySelector(`[data-id="${idEnfocado}"]`)) || rejilla.querySelector("[data-focus]");
    if (otra) foco.focus(otra, { noScroll: true, silent: true });
  }
}

// ─────────────── ficha del juego ───────────────
let fichaId = null;
let turno = 0; // para descartar respuestas de una ficha que ya se cerró

const datos = (g) => [g.developer, year(g.releaseDate), playtime(g.playtime)].filter(Boolean).join(" · ");

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
        h("p", { class: "datos" }, datos(g)),
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

function pintarBotones(g) {
  const caja = ficha.querySelector(".botones");
  if (!caja) return;
  const enMarcha = ejg.game.isRunning(g.id);
  const antes = foco.current?.dataset.accion;
  caja.replaceChildren(
    h(
      "button",
      { class: "boton principal", "data-focus": "", "data-accion": "jugar", onclick: () => jugar(g.id) },
      enMarcha ? "En marcha" : "Jugar",
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

// ─────────────── barra superior ───────────────
for (const b of document.querySelectorAll("[data-ui]")) {
  b.addEventListener("click", () => ejg.ui.open(b.dataset.ui));
}

// ─────────────── Explorar y descargas (ventanas de ejGames) ───────────────
const botonTienda = document.querySelector("#tienda");
botonTienda.addEventListener("click", () => ejg.downloads.open("explore"));
const pintarBoton = () => (botonTienda.hidden = !ejg.explore.enabled);
ejg.explore.onEnabled(pintarBoton);
pintarBoton();

const tira = document.querySelector("#descargas");
function pintarDescargas() {
  const ahora = ejg.downloads.all.filter((d) => d.state === "downloading");
  tira.hidden = !ahora.length;
  if (!ahora.length) return;
  const d = ahora[0];
  tira.textContent = `${d.title} · ${percent(d.progress)} · ${speed(d.downBps)} · ${bytes(d.doneBytes)} de ${bytes(d.totalBytes)}`;
}
ejg.downloads.onChange(pintarDescargas);
pintarDescargas();
tira.addEventListener("click", () => ejg.downloads.open("downloads"));

// ─────────────── cambios que avisa ejGames ───────────────
const repintar = debounce(() => {
  pintar();
  if (fichaId) {
    const g = ejg.library.byId(fichaId);
    if (!g) return cerrarFicha();
    pintarBotones(g);
    ficha.querySelector(".datos").textContent = datos(g); // las horas, al cerrar el juego
  }
}, 50);
ejg.library.onChange(repintar); // juegos nuevos, favoritos, carátulas…
ejg.on("running", repintar); // un juego empieza o termina
ejg.on("settings", repintar); // "Orden" se aplica en JavaScript

// ─────────────── arranque ───────────────
pintar(); // también deja enfocada la primera tarjeta
pistasRejilla();
