// Tema "Xbox": inicio con filas de mosaicos, "Mi colección" con filtros,
// ficha de juego a pantalla completa, Tienda y «Administrar cola» (store.js).

import { h, img, hueOf, keyed, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { createBackdrop, attachStream } from "/_sdk/kit/media.js";
import { playtime, relative, year, description } from "/_sdk/kit/format.js";
import { visible, sort, recent, favorites, byGenre, inCollection, SORTS } from "/_sdk/kit/library.js";
import { clock } from "/_sdk/kit/clock.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";
import { createDownloads, percent, speed } from "/_sdk/kit/store.js";
import { createGuideView, starsText } from "/_sdk/kit/guides.js";
import { createStore } from "./store.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const home = $("#home");
const hub = $("#hub");
const player = $("#player");
const saved = (await ejg.storage.getAll().catch(() => null)) || {};
const state = { view: "home", filter: "all", sort: saved.sort || "title", hubId: null, returnTo: null };
const bg = createBackdrop($("#bg"), { fade: 600 });
clock($("#clock"));

const ICON = {
  wand: '<svg viewBox="0 0 24 24"><path d="m15 4 5 5L8 21l-5-5L15 4Z"/><path d="M18 2v3M21 5h-3M4 3v2M5 4H3M20 13v2M21 14h-2"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1m0-14.2-2.1 2.1m-10 10-2.1 2.1"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  store: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.2 12H6.2Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
  queue: '<svg viewBox="0 0 24 24"><path d="M4 6h10M4 11h10M4 16h6m8-8v10m0 0-3-3m3 3 3-3"/></svg>',
};

const games = () => visible(ejg.library.all);
const running = (id) => ejg.game.isRunning(id);

function tile(g, wide, prev) {
  const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}:${g.media.logo}:${wide}:${running(g.id)}`;
  if (prev && prev.__sig === sig) return prev;
  const el = h(
    "button",
    { class: "tile" + (wide ? " wide" : ""), "data-focus": "", "data-game-id": g.id, onclick: () => openHub(g.id), title: g.title },
    artFor(g, wide ? "landscape" : "square"),
    running(g.id) ? h("span", { class: "run" }, "EN JUEGO") : null,
    h("span", { class: "label" }, g.title),
  );
  el.__sig = sig;
  return el;
}

function row(title, list, { first = "square", cls = "", extra = [] } = {}) {
  const track = h("div", { class: "track", "data-focus-group": title });
  keyed(track, list, (g) => g.id, (g, prev) => tile(g, first === "wide" && g === list[0], prev));
  track.append(...extra);
  return h("section", { class: "row " + cls }, title ? h("h2", null, title) : null, track);
}

function renderHome() {
  const all = games();
  updateQueueUi();
  if (!all.length) {
    home.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("h1", null, "Empieza tu colección"),
        h("p", null, "Añade la carpeta donde tienes tus juegos: cada subcarpeta se convierte en un juego de tu colección."),
        h("button", { class: "btn primary", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "Añadir juegos"),
      ),
      h("div", { class: "track home-empty-tiles", "data-focus-group": "empty" }, storeTile, queueTile),
    );
    return;
  }
  const rec = recent(all, 12);
  const jump = rec.length ? rec : sort(all, "added").slice(0, 12);
  const colTile = h(
    "button",
    { class: "tile special", "data-focus": "", onclick: () => setView("collection") },
    h("span", { html: ICON.grid }),
    h("b", null, "Mi colección"),
    h("small", null, `${games().length} juegos`),
  );
  const addTile = h("button", { class: "tile special", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, h("span", { html: ICON.plus }), h("b", null, "Añadir juegos"), h("small", null, "Carpetas de juegos"));
  const rows = [row(rec.length ? "Continuar jugando" : "Añadidos recientemente", jump, { first: "wide", cls: "hero-row", extra: [colTile, queueTile, storeTile, addTile] })];
  const favs = favorites(all);
  if (favs.length) rows.push(row("Anclados", sort(favs, "title")));
  if (rec.length) rows.push(row("Añadidos recientemente", sort(all, "added").slice(0, 16)));
  const unplayed = all.filter((g) => !g.playtime);
  if (unplayed.length > 2) rows.push(row("Aún sin jugar", sort(unplayed, "rating").slice(0, 16)));
  if (ejg.settings.genreRows !== false) for (const grp of byGenre(all, 3).slice(0, 5)) rows.push(row(grp.name, sort(grp.games, "title").slice(0, 20)));
  const top = home.scrollTop;
  home.replaceChildren(...rows);
  home.scrollTop = top;
}

// Mosaicos «Tienda» y «Cola»: nodos fijos que se actualizan en su sitio (el
// progreso llega cada segundo y no debe quitarles el foco).
const storeTile = h(
  "button",
  { class: "tile special", "data-focus": "", onclick: () => setView("store") },
  h("span", { class: "ico", html: ICON.store }),
  h("b", null, "Tienda"),
  h("small", null, "Explorar juegos"),
);
const qt = { bg: h("span", { class: "qt-bg" }), sub: h("small"), meta: h("small", { class: "qt-meta" }), bar: h("i"), count: h("span", { class: "qt-count" }) };
const queueTile = h(
  "button",
  { class: "tile special qtile", "data-focus": "", onclick: () => setView("queue") },
  qt.bg,
  h("span", { class: "ico", html: ICON.queue }),
  h("b", null, "Cola"),
  qt.sub,
  qt.meta,
  h("span", { class: "qt-bar" }, qt.bar),
  qt.count,
);

const downloads = createDownloads(ejg, () => updateQueueUi());
const PENDING = new Set(["queued", "downloading", "paused", "seeding", "completed", "installing", "error"]);
function updateQueueUi() {
  const g = downloads.groups();
  const pend = g.all.filter((d) => PENDING.has(d.state)).length;
  const cur = g.active[0];
  const ready = g.ready.length;
  const p = cur ? (cur.state === "installing" ? cur.progress : g.total.size ? g.total.done / g.total.size : cur.progress) : 0;
  queueTile.classList.toggle("busy", !!cur);
  qt.bg.style.backgroundImage = cur && (cur.hero || cur.cover) ? `url("${cur.hero || cur.cover}")` : "";
  qt.sub.textContent = cur ? cur.title : ready ? `${ready} ${ready === 1 ? "listo" : "listos"} para instalar` : pend ? `${pend} en cola` : "No hay descargas";
  qt.meta.textContent = cur ? (cur.state === "installing" ? "Instalando…" : `${percent(p)} · ${speed(g.total.speed)}`) : "";
  qt.bar.style.width = `${p * 100}%`;
  qt.count.textContent = pend ? String(pend) : "";
  storeTile.hidden = !ejg.explore.enabled;
  queueTile.hidden = !ejg.explore.enabled && !g.all.length;
  // Icono de la barra superior: visible si hay algo pendiente, con anillo de progreso.
  const qb = $("#q-btn");
  qb.hidden = !pend;
  qb.classList.toggle("busy", !!cur);
  qb.style.setProperty("--p", String(Math.round(p * 100)));
  qb.title = cur ? `Administrar cola · ${cur.title} ${percent(p)}` : "Administrar cola";
  $("#q-badge").textContent = pend ? String(pend) : "";
  $("#nav-store").hidden = !ejg.explore.enabled;
}
$("#q-btn").addEventListener("click", () => setView("queue"));

// ─────────────── colección ───────────────
function renderCollection() {
  const all = games();
  const opts = [
    ["all", "Todos", all.length],
    ["fav", "Favoritos", all.filter((g) => g.favorite).length],
    ["played", "Jugados", all.filter((g) => g.playtime).length],
    ["new", "Sin jugar", all.filter((g) => !g.playtime).length],
    ...ejg.library.collections.map((c) => [`c${c.id}`, c.name, inCollection(all, c).length]),
  ];
  $("#filters").replaceChildren(
    ...opts.map(([k, l, n], i) =>
      h(
        "button",
        { class: "filter" + (i === 4 ? " sep" : ""), "data-focus": "", "aria-pressed": String(state.filter === k), onclick: () => ((state.filter = k), renderCollection()) },
        h("span", null, l),
        h("span", null, n),
      ),
    ),
    h("button", { class: "filter sep", "data-focus": "", onclick: () => ejg.ui.open("collections") }, h("span", null, "+ Colecciones"), h("span")),
  );
  let list = all;
  if (state.filter === "fav") list = all.filter((g) => g.favorite);
  else if (state.filter === "played") list = all.filter((g) => g.playtime);
  else if (state.filter === "new") list = all.filter((g) => !g.playtime);
  else if (state.filter.startsWith("c")) list = inCollection(all, ejg.library.collections.find((c) => `c${c.id}` === state.filter));
  list = sort(list, state.sort);
  $("#col-title").textContent = opts.find((o) => o[0] === state.filter)?.[1] || "Mi colección";
  $("#sort").textContent = `Ordenar: ${SORTS[state.sort].label}`;
  keyed($("#grid"), list, (g) => g.id, (g, prev) => tile(g, false, prev));
}
$("#sort").addEventListener("click", () => {
  const keys = Object.keys(SORTS);
  state.sort = keys[(keys.indexOf(state.sort) + 1) % keys.length];
  ejg.storage.set("sort", state.sort);
  renderCollection();
});

// ─────────────── ficha del juego ───────────────
let token = 0;
async function openHub(id) {
  const g = ejg.library.byId(id);
  if (!g) return;
  state.returnTo = focus.current;
  state.hubId = id;
  const my = ++token;
  const heroUrl = g.media.hero || g.media.heroThumb || g.media.header;
  const playBtn = h(
    "button",
    { class: "btn primary", "data-focus": "", id: "play", onclick: () => launch(g.id) },
    h("span", { html: ICON.play }),
    running(g.id) ? "En juego" : "Jugar",
  );
  if (running(g.id)) playBtn.classList.add("running");
  const content = h(
    "div",
    { class: "hub-content" },
    g.media.logo ? img(g.media.logo, { class: "hub-logo", loading: "eager" }) : h("h1", { class: "hub-title" }, g.title),
    h("div", { class: "hub-meta" }, [year(g.releaseDate), g.developer, ...(g.genres || []).slice(0, 3)].filter(Boolean).join("  •  ")),
    h(
      "div",
      { class: "hub-actions", "data-focus-group": "actions" },
      playBtn,
      h("button", { class: "btn" + (g.favorite ? " on" : ""), "data-focus": "", id: "fav", onclick: () => ejg.game.favorite(g.id) }, h("span", { html: ICON.star }), g.favorite ? "Anclado" : "Anclar"),
      h("button", { class: "btn", "data-focus": "", onclick: () => ejg.game.edit(g.id) }, h("span", { html: ICON.gear }), "Gestionar"),
      h("button", { class: "btn", "data-focus": "", onclick: () => ejg.game.openFolder(g.id) }, h("span", { html: ICON.folder }), "Carpeta"),
      h("button", { class: "btn", "data-focus": "", onclick: () => openGuides(g.id) }, h("span", { html: ICON.book }), "Guías"),
      h("button", { class: "btn", "data-focus": "", onclick: () => ejg.trainer.open(g.id) }, h("span", { html: ICON.wand }), "Trucos"),
      h("button", { class: "btn", "data-focus": "", onclick: () => ejg.maps.open(g.id) }, h("span", { html: ICON.map }), "Mapa"),
    ),
    h("div", { class: "hub-stats" }, ...hubStats(g)),
    h("div", { class: "hub-desc", id: "desc" }, g.shortDescription || ""),
  );
  const mediaRow = h("div", { class: "hub-media", "data-focus-group": "media" });
  const guideRow = h("div", { class: "hub-guides", "data-focus-group": "hub-guides" });
  hub.replaceChildren(h("div", { class: "hub-bg", style: heroUrl ? { backgroundImage: `url("${heroUrl}")` } : {} }), content, mediaRow, guideRow);
  loadGuideRow(id, my, guideRow);
  hub.hidden = false;
  hub.scrollTop = 0;
  updateHints();
  focus.focus(playBtn, { instant: true, silent: true });
  ejg.sound.play("open");

  const d = await ejg.game.details(id).catch(() => null);
  if (!d || my !== token) return;
  if (d.description) $("#desc").replaceChildren(description(d.description.split("\n\n").slice(0, 6).join("\n\n")));
  const cards = [];
  d.trailers.slice(0, 4).forEach((t) =>
    cards.push(h("button", { class: "shot", "data-focus": "", onclick: () => openVideo(t) }, t.poster ? img(t.poster) : null, h("div", { class: "pl" }, "▶"))),
  );
  d.screenshots.slice(0, 12).forEach((s) => cards.push(h("button", { class: "shot", "data-focus": "", onclick: () => openImage(s.url) }, img(s.thumb || s.url))));
  mediaRow.replaceChildren(...cards);
}

function closeHub() {
  token++;
  hub.hidden = true;
  hub.replaceChildren();
  state.hubId = null;
  updateHints();
  const back = state.returnTo;
  if (back && back.isConnected) focus.focus(back, { silent: true });
  else focus.first($(state.view === "home" ? "#home" : "#grid"));
}

async function launch(id) {
  if (running(id)) return;
  const b = $("#play");
  if (b) b.lastChild.textContent = "Iniciando…";
  try {
    await ejg.game.launch(id);
  } catch (e) {
    ejg.ui.toast(String(e.message || e), "error");
  }
}

let release = () => {};
async function openVideo(t) {
  const v = h("video", { controls: true, autoplay: true });
  player.replaceChildren(v);
  player.hidden = false;
  release = await attachStream(v, t.url);
}
// Imagen suelta o galería (capturas de la Tienda: ← → para pasar).
let gallery = null;
function openImage(url, list = null, i = 0) {
  gallery = list && list.length > 1 ? { list, i } : null;
  player.replaceChildren(img(url, { loading: "eager" }));
  player.hidden = false;
  ejg.sound.play("open");
  updateHints();
}
function stepImage(d) {
  gallery.i = (gallery.i + d + gallery.list.length) % gallery.list.length;
  player.replaceChildren(img(gallery.list[gallery.i], { loading: "eager" }));
  ejg.sound.play("move");
}
function closePlayer() {
  release();
  release = () => {};
  gallery = null;
  player.replaceChildren();
  player.hidden = true;
  updateHints();
}
player.addEventListener("click", (e) => e.target === player && closePlayer());

// ─────────────── vistas y foco ───────────────
function setView(v) {
  if (v === "store" && !ejg.explore.enabled) v = "home";
  if (v === "queue" && state.view !== "queue") state.queueFrom = state.view;
  state.view = v;
  document.documentElement.dataset.view = v;
  document.querySelectorAll(".navbtn").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  for (const id of ["home", "collection", "store", "queue"]) $("#" + id).hidden = v !== id;
  if (v === "store" || v === "queue") shop.show(v);
  else shop.hide();
  if (v === "home") {
    renderHome();
    focus.first(home);
  } else if (v === "collection") {
    renderCollection();
    focus.first($("#grid")) || focus.first($("#filters"));
  }
  updateHints();
}
/** Inicio → Mi colección → Tienda (la cola va detrás de la Tienda). */
function cycleView(d) {
  const list = ["home", "collection", ...(ejg.explore.enabled ? ["store"] : []), ...(state.view === "queue" ? ["queue"] : [])];
  const i = Math.max(0, list.indexOf(state.view));
  setView(list[(i + d + list.length) % list.length]);
}
document.querySelectorAll(".navbtn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => ejg.ui.open(b.dataset.action)));

const updateBg = debounce((g) => {
  if (ejg.settings.dynamicBg === false) return;
  const url = g && (g.media.hero || g.media.heroThumb);
  if (url) bg.set(url);
}, 180);

const focus = createFocus({
  root: document.body,
  onChange: (el, prev, info) => {
    const id = Number(el.dataset.gameId);
    if (id && hub.hidden) updateBg(ejg.library.byId(id));
    shop.focused(el, info);
  },
});
const isShop = () => state.view === "store" || state.view === "queue";
const gv = (a) => !!(guideView && guideView.nav(a));
bindNav(focus, {
  back: () => {
    if (gv("back")) return true;
    if (!player.hidden) return closePlayer(), true;
    if (!hub.hidden) return closeHub(), true;
    if (shop.back()) return true;
    if (state.view === "queue") return setView(state.queueFrom && state.queueFrom !== "queue" ? state.queueFrom : "home"), true;
    if (state.view !== "home") return setView("home"), true;
    return false;
  },
  up: () => gv("up"),
  down: () => gv("down"),
  lt: () => gv("lt"),
  rt: () => gv("rt"),
  y: () => {
    if (gv("y")) return true;
    if (state.view === "store" && hub.hidden) return shop.search(), true;
    if (isShop()) return true;
    const id = state.hubId || Number(focus.current?.dataset.gameId);
    if (id) ejg.game.favorite(id);
    return true;
  },
  x: () => {
    if (gv("x")) return true;
    if (isShop() && hub.hidden) return true;
    const id = state.hubId || Number(focus.current?.dataset.gameId);
    if (id) ejg.game.edit(id);
    return true;
  },
  menu: () => (ejg.ui.open("menu"), true),
  view: () => gv("view") || (ejg.ui.open("search"), true),
  lb: () => gv("lb") || (hub.hidden && !guideView && player.hidden && !shop.busy() ? cycleView(-1) : null, true),
  rb: () => gv("rb") || (hub.hidden && !guideView && player.hidden && !shop.busy() ? cycleView(1) : null, true),
  left: () => (!player.hidden && gallery ? (stepImage(-1), true) : false),
  right: () => (!player.hidden && gallery ? (stepImage(1), true) : false),
});

// Tienda y Cola (store.js).
const shop = createStore({
  ejg,
  focus,
  pages: { store: $("#store"), queue: $("#queue"), repack: $("#repack") },
  setView: (v) => setView(v),
  openImage,
  onChange: () => updateHints(),
});
ejg.explore.onEnabled(() => {
  if (!ejg.explore.enabled && state.view === "store") setView("home");
  else updateQueueUi();
});
// El host pide una vista (menú rápido, Ctrl+E / Ctrl+J, avisos…).
ejg.ui.onView(({ view, slug, gameId, guideId }) => {
  if (view === "guides" && gameId) return openGuides(gameId, guideId);
  closeGuides();
  if (!player.hidden) closePlayer();
  if (!hub.hidden) closeHub();
  if (view === "downloads") return setView("queue");
  if (!ejg.explore.enabled) return;
  setView("store");
  if (view === "repack" && slug) shop.openRepack(slug);
});
ejg.on("focus-return", () => focus.restore());

const hintBar = hints($("#hints"), []);
function updateHints() {
  if (guideView) return hintBar.set(guideView.hints());
  if (!player.hidden) return hintBar.set(gallery ? [["left", "Anterior"], ["right", "Siguiente"], ["back", "Cerrar"]] : [["back", "Cerrar"]]);
  if (!hub.hidden) return hintBar.set([["accept", "Elegir"], ["back", "Volver"], ["y", "Anclar"], ["x", "Gestionar"]]);
  hintBar.set(shop.hints() || [["accept", "Abrir"], ["y", "Anclar"], ["x", "Gestionar"], ["lb", "Secciones"], ["menu", "Menú"]]);
}

function renderProfile() {
  const p = ejg.profile;
  const av = $("#avatar");
  av.textContent = p?.avatar ? "" : (p?.name || "?")[0].toUpperCase();
  av.style.backgroundImage = p?.avatar ? `url("${p.avatar}")` : "";
  av.style.backgroundColor = p?.color || "";
  av.style.boxShadow = `0 0 0 2px ${p?.color || "var(--accent)"}`;
  $("#name").textContent = p?.name || "";
  const r = ejg.library.all.filter((g) => running(g.id));
  $("#status").textContent = r.length ? `Jugando a ${r[0].title}` : "En línea";
}

function applyWallpaper() {
  const w = ejg.settings.wallpaper;
  $("#bg").classList.toggle("wall", !!w);
  if (w && ejg.settings.dynamicBg === false) bg.set(null);
}

// ─────────────── guías de la comunidad ───────────────
let guideView = null;
let guideReturn = null;
const guidesPage = $("#guides");

function openGuides(gameId, guideId = null) {
  const g = ejg.library.byId(gameId);
  if (!g) return;
  guideView?.destroy();
  if (!guideView) guideReturn = focus.current;
  const art = g.media.hero || g.media.heroThumb || g.media.header;
  $("#gx-bg").style.backgroundImage = art ? `url("${art}")` : "";
  guidesPage.hidden = false;
  guideView = createGuideView({
    ejg,
    root: $("#gx-inner"),
    focus,
    gameId,
    gameTitle: g.title,
    layout: "grid",
    guide: guideId,
    labels: { title: "Guías de la comunidad" },
    onExit: closeGuides,
    onChange: () => updateHints(),
  });
  ejg.sound.play("open");
}

function closeGuides() {
  if (!guideView) return false;
  guideView.destroy();
  guideView = null;
  guidesPage.hidden = true;
  const back = guideReturn?.isConnected ? guideReturn : null;
  guideReturn = null;
  if (back) focus.focus(back, { silent: true });
  else focus.first(hub.hidden ? $("#home") : hub);
  updateHints();
  return true;
}

/** Fila de guías en la ficha: las tuyas y las mejor valoradas. */
async function loadGuideRow(id, my, row) {
  const [shelf, list] = await Promise.all([ejg.guides.shelf(id).catch(() => null), ejg.guides.list(id, {}).catch(() => null)]);
  if (my !== token || !list || list.appid == null) return;
  const mine = [...(shelf?.pinned || []), ...(shelf?.recent || [])].slice(0, 3);
  const top = list.items.filter((x) => !mine.some((m) => m.id === x.id)).slice(0, 8 - mine.length);
  const tile = (it, sub) =>
    h(
      "button",
      { class: "gtile", "data-focus": "", onclick: () => openGuides(id, it.id) },
      it.preview ? img(it.preview) : h("span", { class: "gtile-ph", html: ICON.book }),
      h("span", { class: "gtile-txt" }, h("b", null, it.title), h("small", null, sub)),
    );
  row.replaceChildren(
    h("h2", null, "Guías de la comunidad"),
    h(
      "div",
      { class: "gtrack" },
      ...mine.map((x) => tile(x, x.pinned ? "★ Guardada" : `Seguir leyendo${x.progress ? ` · sección ${x.progress.section + 1}` : ""}`)),
      ...top.map((x) => tile(x, [starsText(x.stars), x.author].filter(Boolean).join(" · "))),
      h("button", { class: "gtile gtile-all", "data-focus": "", onclick: () => openGuides(id) }, h("span", { html: ICON.book }), h("b", null, "Ver todas"), h("small", null, `${list.total.toLocaleString("es")} guías`)),
    ),
  );
}

// Horas, última vez y logros: cambian al cerrar el juego.
function hubStats(g) {
  const stat = (label, value) => h("div", { class: "hstat" }, h("small", null, label), h("b", null, value));
  return [
    stat("Tiempo de juego", playtime(g.playtime, "—")),
    stat("Última vez", relative(g.lastPlayed)),
    g.achievements ? stat("Logros", `${g.achievements.unlocked} / ${g.achievements.total}`) : null,
    g.launchCount ? stat("Partidas", String(g.launchCount)) : null,
  ].filter(Boolean);
}

const refresh = debounce(() => {
  renderProfile();
  if (!hub.hidden && state.hubId) {
    const g = ejg.library.byId(state.hubId);
    const p = $("#play");
    if (g) $(".hub-stats")?.replaceChildren(...hubStats(g));
    if (g && p) {
      p.classList.toggle("running", running(g.id));
      p.lastChild.textContent = running(g.id) ? "En juego" : "Jugar";
      const f = $("#fav");
      f.classList.toggle("on", g.favorite);
      f.lastChild.textContent = g.favorite ? "Anclado" : "Anclar";
    }
  }
  if (state.view === "home") renderHome();
  else if (state.view === "collection") renderCollection();
  if (focus.current && !focus.current.isConnected) {
    const again = document.querySelector(`[data-game-id="${focus.current.dataset.gameId}"]`);
    if (again) focus.focus(again, { noScroll: true, silent: true });
  }
}, 80);
ejg.library.onChange(refresh);
ejg.on("collections", refresh);
ejg.on("running", refresh);
ejg.game.onState(refresh);
ejg.on("settings", () => (applyWallpaper(), refresh()));
ejg.on("profile", renderProfile);

applyWallpaper();
renderProfile();
setView("home");
updateHints();
