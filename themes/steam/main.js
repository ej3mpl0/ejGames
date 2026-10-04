// Tema "Steam": la biblioteca del cliente de Steam (barra lateral, inicio con
// estanterías, colecciones y página de juego), su tienda y sus descargas.
// Es el tema de referencia: úsalo como ejemplo para crear el tuyo.

import { h, img, initials, hueOf, keyed, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { attachStream, trailerPlayer } from "/_sdk/kit/media.js";
import { playtime, relative, date, description, SOURCE_LABEL } from "/_sdk/kit/format.js";
import { visible, sort, search, inCollection, canUninstall, software, SORTS } from "/_sdk/kit/library.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";
import { repackUpdateNote } from "/_sdk/kit/updates.js";
import { howLongNote } from "/_sdk/kit/hltb.js";
import { downloadLabel, percent, speed } from "/_sdk/kit/store.js";
import { createProfilePages, avatar as kitAvatar, levelBadge } from "/_sdk/kit/profile.js";
import { createGuideView, starsText } from "/_sdk/kit/guides.js";
import { createStore } from "./store.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const main = $("#main");
const sideList = $("#side-list");
const filterInput = $("#filter");
const lightbox = $("#lightbox");

const saved = (await ejg.storage.getAll().catch(() => null)) || {};
const state = {
  tab: "library", // library | store | downloads
  view: "home", // (biblioteca) home | collections | collection | game
  gameId: null,
  collection: null, // id de colección o "fav"
  prev: [], // vistas anteriores de la biblioteca, para «Atrás»
  filter: "",
  chip: ["all", "played", "unplayed", "fav"].includes(saved.chip) ? saved.chip : "all",
  sort: saved.sort || "title",
  sideSort: saved.sideSort || "title",
  collapsed: new Set(saved.collapsed || []),
};

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  caret: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4m-4 3v4m-4 3h8"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};
const svg = (name) => {
  const t = document.createElement("template");
  t.innerHTML = ICON[name];
  return t.content.firstChild;
};

// ─────────────── foco y mando ───────────────
const focus = createFocus({ root: document.body });
const isShop = () => state.tab === "store" || state.tab === "downloads";
/** Guías abiertas: su vista usa primero el mando (leer, secciones, guardar…). */
const inGuides = () => state.tab === "library" && state.view === "guides" && guideView;
const gv = (action) => !!(inGuides() && guideView.nav(action));
bindNav(focus, {
  back: () => back(),
  up: () => gv("up"),
  down: () => gv("down"),
  lt: () => gv("lt"),
  rt: () => gv("rt"),
  y: () => {
    if (gv("y")) return true;
    if (state.tab === "store") return shop.search(), true;
    const id = focusedGameId() ?? (state.view === "game" ? state.gameId : null);
    if (id && !isShop()) ejg.game.favorite(id);
    return !!id;
  },
  x: () => {
    if (gv("x")) return true;
    if (isShop()) return false;
    const id = focusedGameId() ?? (state.view === "game" ? state.gameId : null);
    if (id) ejg.game.edit(id);
    return !!id;
  },
  menu: () => (ejg.ui.open("menu"), true),
  view: () => gv("view") || (ejg.ui.open("search"), true),
  lb: () => gv("lb") || (menu || shop.hasDialog() || switchTab(-1), true),
  rb: () => gv("rb") || (menu || shop.hasDialog() || switchTab(1), true),
  left: () => (!lightbox.hidden ? (stepLightbox(-1), true) : false),
  right: () => (!lightbox.hidden ? (stepLightbox(1), true) : false),
});
ejg.on("focus-return", () => focus.restore());

// Tienda y Descargas (store.js).
const shop = createStore({
  ejg,
  main,
  focus,
  openGame: (id) => openGame(id),
  goTab: (t) => goTab(t),
  onChange: () => updateDownloadsUi(),
  onNavigate: () => updateHistory(),
});
shop.bindTab(() => state.tab);

function focusedGameId() {
  const id = focus.current?.closest("[data-game-id]")?.dataset.gameId;
  return id ? Number(id) : null;
}

// "/" enfoca el buscador de la barra lateral (E y F son atajos de editar/favorito).
window.addEventListener("keydown", (e) => {
  if (e.key !== "/" || document.activeElement?.tagName === "INPUT" || state.tab !== "library") return;
  e.preventDefault();
  filterInput.focus();
});

// ─────────────── menús desplegables (como los de Steam) ───────────────
let menu = null;
/** items: [{ label, run, danger?, on? } | "-"] */
function openMenu(anchor, items, { cls = "", first = false } = {}) {
  closeMenu(true);
  const prev = focus.current;
  const box = h(
    "div",
    { class: `menu ${cls}`.trim(), "data-focus-trap": "" },
    ...items.map((it) =>
      it === "-"
        ? h("div", { class: "menu-sep" })
        : it.node
          ? it.node
          : h(
            "button",
            {
              class: "menu-item" + (it.danger ? " danger" : "") + (it.on ? " on" : ""),
              "data-focus": "",
              onclick: () => {
                closeMenu();
                it.run();
              },
            },
            it.label,
          ),
    ),
  );
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth;
  const hgt = box.offsetHeight;
  box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  box.style.top = `${r.bottom + hgt + 8 > innerHeight ? Math.max(8, r.top - hgt - 4) : r.bottom + 4}px`;
  menu = { box, prev };
  ejg.sound.play("open");
  focus.focus((!first && box.querySelector(".menu-item.on")) || box.querySelector("[data-focus]"), { instant: true, silent: true });
}
function closeMenu(silent) {
  if (!menu) return false;
  const { box, prev } = menu;
  menu = null;
  box.remove();
  if (!silent) ejg.sound.play("back");
  if (prev?.isConnected) focus.focus(prev, { silent: true, noScroll: true });
  return true;
}
window.addEventListener("mousedown", (e) => menu && !menu.box.contains(e.target) && closeMenu(true), true);
window.addEventListener("resize", () => closeMenu(true));

// ─────────────── datos ───────────────
const games = () => visible(ejg.library.all);
const CHIPS = { all: "Juegos", played: "Jugados", unplayed: "Sin jugar", fav: "Favoritos", software: "Software", hidden: "Ocultos" };
/** Los programas (emuladores): solo en «Software». */
const softwareList = () => software(ejg.library.all);
/** Los ocultos: no salen en ningún otro filtro, solo en «Ocultos». */
const hiddenGames = () => ejg.library.all.filter((g) => g.hidden && !g.missing);
function chipped(list) {
  if (state.chip === "fav") return list.filter((g) => g.favorite);
  if (state.chip === "played") return list.filter((g) => g.playtime > 0 || g.lastPlayed);
  if (state.chip === "unplayed") return list.filter((g) => !g.playtime && !g.lastPlayed);
  return list;
}
function filtered(sortKey = state.sort) {
  // Mostrado el último oculto, el filtro vuelve a «Juegos».
  if (state.chip === "hidden" && !hiddenGames().length) state.chip = "all";
  if (state.chip === "software" && !softwareList().length) state.chip = "all";
  const list = state.chip === "hidden" ? hiddenGames() : state.chip === "software" ? softwareList() : chipped(games());
  if (state.filter) return search(list, state.filter, 500);
  return sort(list, sortKey);
}
const isRunning = (id) => ejg.game.isRunning(id);
const collectionById = (id) => (id === "fav" ? { id: "fav", name: "Favoritos", kind: "fav" } : ejg.library.collections.find((c) => c.id === id));
const members = (c) => (c.kind === "fav" ? games().filter((g) => g.favorite) : inCollection(games(), c));

function saveState() {
  ejg.storage.set("chip", state.chip);
  ejg.storage.set("sort", state.sort);
  ejg.storage.set("sideSort", state.sideSort);
  ejg.storage.set("collapsed", [...state.collapsed]);
}

// ─────────────── piezas ───────────────
function placeholder(g) {
  const hue = hueOf(g.title);
  const el = h("div", { class: "ph", style: { background: `linear-gradient(160deg, hsl(${hue} 45% 34%), hsl(${(hue + 40) % 360} 50% 16%))` } });
  el.textContent = initials(g.title);
  return el;
}

function sideItem(g, prev) {
  const running = isRunning(g.id);
  const key = `${g.id}:${g.title}:${g.media.icon}:${running}:${g.missing}:${state.gameId === g.id && state.view === "game"}`;
  if (prev && prev.__sig === key) return prev;
  const icon = g.media.icon || g.media.coverThumb;
  const el = h(
    "button",
    {
      class: "side-item" + (g.missing ? " missing" : "") + (running ? " running" : ""),
      "data-focus": "",
      "data-game-id": g.id,
      "aria-current": state.gameId === g.id && state.view === "game" ? "true" : null,
      onclick: () => openGame(g.id),
      ondblclick: () => ejg.game.launch(g.id),
      title: g.title,
    },
    icon ? img(icon, { loading: "lazy" }) : placeholder(g),
    h("span", { class: "t" }, g.title, running ? h("span", { class: "run" }, " - En marcha") : null),
  );
  el.__sig = key;
  return el;
}

/** Cápsula vertical de la biblioteca (600×900 en Steam). */
function capsule(g, prev) {
  const running = isRunning(g.id);
  const key = `${g.id}:${g.title}:${g.media.coverThumb}:${g.media.heroThumb}:${running}:${g.playtime}:${g.missing}`;
  if (prev && prev.__sig === key) return prev;
  const el = h(
    "button",
    {
      class: "cap" + (g.missing ? " missing" : ""),
      "data-focus": "",
      "data-game-id": g.id,
      onclick: () => openGame(g.id),
      ondblclick: () => ejg.game.launch(g.id),
      title: g.title,
    },
    h("div", { class: "cap-art" }, artFor(g, "portrait"), running ? h("span", { class: "cap-run" }, "EN MARCHA") : null),
    h(
      "div",
      { class: "cap-hover" },
      h("b", null, g.title),
      h("span", null, g.playtime ? `${playtime(g.playtime)} jugadas` : "Sin jugar"),
    ),
    h("div", { class: "cap-title" }, g.title),
  );
  el.__sig = key;
  return el;
}

/** Estantería horizontal con flechas, como las del inicio de la biblioteca. */
function shelf(id, title, count, list, render = capsule, extra = null) {
  const row = h("div", { class: "shelf-row", "data-focus-group": `shelf-${id}` });
  keyed(row, list, (g) => `${id}-${g.id}`, render);
  const scrollBy = (d) => row.scrollBy({ left: d * row.clientWidth * 0.8, behavior: "smooth" });
  return h(
    "section",
    { class: "shelf" },
    h(
      "div",
      { class: "shelf-head" },
      h("h2", null, title, count != null ? h("span", { class: "n" }, ` (${count})`) : null),
      extra,
      h("div", { class: "shelf-arrows" }, h("button", { class: "arr", onclick: () => scrollBy(-1), "aria-label": "Anterior" }, svg("left")), h("button", { class: "arr", onclick: () => scrollBy(1), "aria-label": "Siguiente" }, svg("right"))),
    ),
    row,
  );
}

function sortDrop() {
  return h(
    "div",
    { class: "sortby" },
    h("span", null, "Ordenar por"),
    h(
      "button",
      {
        class: "drop",
        "data-focus": "",
        onclick: (e) =>
          openMenu(
            e.currentTarget,
            Object.entries(SORTS).map(([k, s]) => ({
              label: s.label,
              on: state.sort === k,
              run: () => {
                state.sort = k;
                saveState();
                render();
              },
            })),
          ),
      },
      h("span", null, SORTS[state.sort].label),
      svg("caret"),
    ),
  );
}

function grid(list, group = "grid") {
  const el = h("div", { class: "grid", "data-focus-group": group });
  keyed(el, list, (g) => g.id, capsule);
  if (!list.length) el.append(h("div", { class: "empty small" }, state.filter ? "Ningún juego coincide con la búsqueda." : "No hay juegos aquí."));
  return el;
}

// ─────────────── barra lateral ───────────────
const sideDrop = $("#side-drop");
const sideRecent = $("#side-recent");
const sideReady = $("#side-ready");
$("#side-home").addEventListener("click", () => goLibrary("home"));
$("#side-cols").addEventListener("click", () => goLibrary("collections"));
sideDrop.addEventListener("click", () =>
  openMenu(
    sideDrop,
    Object.entries(CHIPS)
      .filter(([k]) => (k !== "hidden" || hiddenGames().length) && (k !== "software" || softwareList().length))
      .map(([k, label]) => ({
      label: k === "hidden" ? `${label} (${hiddenGames().length})` : label,
      on: state.chip === k,
      run: () => {
        state.chip = k;
        saveState();
        render();
      },
    })),
  ),
);
sideRecent.addEventListener("click", () => {
  state.sideSort = state.sideSort === "recent" ? "title" : "recent";
  saveState();
  renderSidebar();
});
sideReady.addEventListener("click", () => {
  state.chip = state.chip === "played" ? "all" : "played";
  saveState();
  render();
});

const groupBoxes = new Map();
function sideGroup(id, label, list) {
  let g = groupBoxes.get(id);
  if (!g) {
    const head = h("button", { class: "side-group", "data-focus": "", onclick: () => toggleGroup(id) });
    const box = h("div", { class: "side-items" });
    g = { head, box, wrap: h("div", null, head, box) };
    groupBoxes.set(id, g);
  }
  const open = !state.collapsed.has(id);
  g.head.replaceChildren(h("span", { class: "tri" + (open ? " open" : ""), html: ICON.caret }), h("span", null, label), h("span", { class: "n" }, `(${list.length})`));
  g.box.hidden = !open;
  if (open) keyed(g.box, list, (x) => `${id}${x.id}`, sideItem);
  else g.box.replaceChildren();
  return g.wrap;
}
function toggleGroup(id) {
  state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id);
  saveState();
  renderSidebar();
}

function renderSidebar() {
  const list = filtered(state.sideSort);
  sideDrop.replaceChildren(h("span", null, CHIPS[state.chip]), h("small", null, `(${list.length})`), svg("caret"));
  sideRecent.classList.toggle("on", state.sideSort === "recent");
  sideReady.classList.toggle("on", state.chip === "played");
  $("#side-home").classList.toggle("on", state.view === "home");
  $("#side-cols").classList.toggle("on", state.view === "collections" || state.view === "collection");
  const favs = !state.filter && state.chip === "all" ? list.filter((g) => g.favorite) : [];
  const groups = [];
  if (favs.length) groups.push(sideGroup("fav", "Favoritos", favs));
  groups.push(sideGroup("all", state.filter ? "Resultados" : state.chip === "hidden" ? "Ocultos" : state.chip === "software" ? "Software" : favs.length ? "Sin categoría" : "Todos", favs.length ? list.filter((g) => !g.favorite) : list));
  if (sideList.children.length !== groups.length || [...sideList.children].some((c, i) => c !== groups[i])) sideList.replaceChildren(...groups);
}

// ─────────────── inicio de la biblioteca ───────────────
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function bucket(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff <= 0) return "Hoy";
  if (diff === 1) return "Ayer";
  if (diff < 7) return "Esta semana";
  if (diff < 14) return "La semana pasada";
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return "Este mes";
  const m = cap1(d.toLocaleDateString(ejg.locale, { month: "long" }));
  return d.getFullYear() === now.getFullYear() ? m : `${m} de ${d.getFullYear()}`;
}

function recentShelf(all) {
  const rec = all.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 14);
  if (!rec.length) return null;
  const row = h("div", { class: "shelf-row recent-row", "data-focus-group": "shelf-recent" });
  let cur = null;
  let box = null;
  for (const g of rec) {
    const b = bucket(g.lastPlayed);
    if (b !== cur) {
      cur = b;
      box = h("div", { class: "rg-cards" });
      row.append(h("div", { class: "rg" }, h("div", { class: "rg-label" }, b), box));
    }
    box.append(capsule(g));
  }
  const scrollBy = (d) => row.scrollBy({ left: d * row.clientWidth * 0.8, behavior: "smooth" });
  return h(
    "section",
    { class: "shelf" },
    h(
      "div",
      { class: "shelf-head" },
      h("h2", null, "Juegos recientes"),
      h("div", { class: "shelf-arrows" }, h("button", { class: "arr", onclick: () => scrollBy(-1) }, svg("left")), h("button", { class: "arr", onclick: () => scrollBy(1) }, svg("right"))),
    ),
    row,
  );
}

function emptyLibrary() {
  return h(
    "div",
    { class: "empty" },
    h("h2", null, "Tu biblioteca está vacía"),
    h("p", null, "Añade la carpeta donde tienes tus juegos: cada subcarpeta se convierte en un juego, con su arte y sus logros."),
    h("button", { class: "btn-steam", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "Añadir un juego"),
  );
}

function renderHome() {
  const all = games();
  if (!all.length) return main.replaceChildren(emptyLibrary());
  // Con búsqueda o filtro, Steam enseña directamente la rejilla.
  if (state.filter || state.chip !== "all") {
    const list = filtered();
    return main.replaceChildren(
      h(
        "div",
        { class: "lib-home" },
        h(
          "section",
          { class: "all" },
          h("div", { class: "all-head" }, h("h2", null, state.filter ? "Resultados" : CHIPS[state.chip], h("span", { class: "n" }, ` (${list.length})`)), sortDrop()),
          grid(list),
        ),
      ),
    );
  }
  const wrap = h("div", { class: "lib-home" });
  if (ejg.settings.showRecent !== false) {
    const r = recentShelf(all);
    if (r) wrap.append(r);
  }
  const favs = all.filter((g) => g.favorite);
  if (favs.length) wrap.append(shelf("fav", "Favoritos", favs.length, sort(favs, state.sort)));
  for (const c of ejg.library.collections) {
    const list = inCollection(all, c);
    if (list.length) wrap.append(shelf(`c${c.id}`, c.name, list.length, sort(list, state.sort)));
  }
  const list = sort(all, state.sort);
  wrap.append(
    h(
      "section",
      { class: "all" },
      h("div", { class: "all-head" }, h("h2", null, "Todos los juegos", h("span", { class: "n" }, ` (${list.length})`)), sortDrop()),
      grid(list),
    ),
  );
  main.replaceChildren(wrap);
}

// ─────────────── colecciones ───────────────
function renderCollections() {
  const all = games();
  const tiles = [];
  const favs = all.filter((g) => g.favorite);
  if (favs.length) tiles.push({ id: "fav", name: "Favoritos", smart: false, list: favs });
  for (const c of ejg.library.collections) tiles.push({ id: c.id, name: c.name, smart: c.kind === "smart", list: inCollection(all, c) });
  const tile = (t) =>
    h(
      "button",
      { class: "col-tile", "data-focus": "", onclick: () => openCollection(t.id) },
      h("div", { class: "col-stack" }, ...t.list.slice(0, 3).map((g, i) => h("div", { class: `col-card c${i}` }, artFor(g, "portrait")))),
      h("div", { class: "col-name" }, t.smart ? h("span", { class: "col-smart", html: ICON.spark, title: "Colección dinámica" }) : null, h("b", null, t.name), h("span", null, ` (${t.list.length})`)),
    );
  main.replaceChildren(
    h(
      "div",
      { class: "cols-page" },
      h(
        "div",
        { class: "cols-head" },
        h("h2", null, "Colecciones"),
        h("button", { class: "btn-steam", "data-focus": "", onclick: () => ejg.ui.open("collections") }, svg("plus"), "Crear una colección"),
      ),
      tiles.length
        ? h("div", { class: "cols-grid", "data-focus-group": "cols" }, ...tiles.map(tile))
        : h("div", { class: "empty small" }, "Todavía no tienes colecciones. Agrupa tus juegos como quieras: a mano o con reglas (colecciones dinámicas)."),
    ),
  );
}

function renderCollection() {
  const c = collectionById(state.collection);
  if (!c) return goLibrary("collections");
  const list = sort(members(c), state.sort);
  main.replaceChildren(
    h(
      "div",
      { class: "lib-home" },
      h(
        "section",
        { class: "all" },
        h(
          "div",
          { class: "all-head" },
          h("h2", null, c.kind === "smart" ? h("span", { class: "col-smart", html: ICON.spark }) : null, c.name, h("span", { class: "n" }, ` (${list.length})`)),
          c.kind !== "fav" ? h("button", { class: "btn-text", "data-focus": "", onclick: () => ejg.ui.open("collections") }, "Editar colección") : null,
          sortDrop(),
        ),
        grid(list),
      ),
    ),
  );
}

// ─────────────── página de juego ───────────────
let heroRelease = () => {};
let trailer = null;
let detailsToken = 0;

function playButton(g) {
  const running = isRunning(g.id);
  const btn = h(
    "button",
    {
      class: "play" + (running ? " running" : ""),
      "data-focus": "",
      id: "play",
      disabled: g.missing || null,
      onclick: async () => {
        if (isRunning(g.id)) return;
        btn.classList.add("launching");
        btn.lastChild.textContent = "INICIANDO…";
        try {
          await ejg.game.launch(g.id);
        } catch (e) {
          ejg.ui.toast(String(e.message || e), "error");
        }
        setTimeout(() => updatePlayButton(), 2500);
      },
    },
    svg("play"),
    h("span", null, g.missing ? "NO ENCONTRADO" : running ? "EN MARCHA" : "JUGAR"),
  );
  return btn;
}

function updatePlayButton() {
  const old = $("#play");
  const g = state.gameId && ejg.library.byId(state.gameId);
  if (!old || !g) return;
  const wasFocused = focus.current === old;
  const nb = playButton(g);
  old.replaceWith(nb);
  if (wasFocused) focus.focus(nb, { noScroll: true, silent: true });
}

// Lo que cambia al terminar una partida: horas, última sesión y logros. Se
// repinta solo eso (sin recargar el banner ni el tráiler).
const statsKey = (g) => `${g.id}|${g.playtime}|${g.lastPlayed}|${g.achievements?.unlocked}/${g.achievements?.total}`;
let renderedStats = "";
let achSlot = null;
let activitySlot = null;

function gameStats(g) {
  const stat = (label, value, extra) => h("div", { class: "stat" }, h("small", null, label), h("span", null, value), extra || null);
  const a = g.achievements;
  return [
    stat("Última sesión", g.lastPlayed ? relative(g.lastPlayed) : "Nunca"),
    stat("Tiempo de juego", playtime(g.playtime)),
    a ? stat("Logros", `${a.unlocked}/${a.total}`, h("div", { class: "stat-bar" }, h("i", { style: { width: `${a.total ? (a.unlocked / a.total) * 100 : 0}%` } }))) : null,
  ].filter(Boolean);
}

/** Menú del engranaje: el «Administrar» de Steam. */
function manageMenu(anchor, g) {
  const items = [
    { label: g.favorite ? "Quitar de favoritos" : "Añadir a favoritos", run: () => ejg.game.favorite(g.id) },
    { label: "Añadir a una colección…", run: () => ejg.game.edit(g.id) },
    "-",
    { label: "Explorar archivos locales", run: () => ejg.game.openFolder(g.id) },
    { label: g.hidden ? "Mostrar este juego" : "Ocultar este juego", run: () => ejg.game.hide(g.id, !g.hidden) },
  ];
  if (canUninstall(g)) items.push({ label: "Desinstalar", danger: true, run: () => ejg.game.uninstall(g.id) });
  items.push("-", { label: "Propiedades…", run: () => ejg.game.edit(g.id) });
  openMenu(anchor, items);
}

// Logros (llegan aparte: la primera vez pueden descargar el esquema).
function loadAchievements(id, token) {
  ejg.game
    .achievements(id)
    .then((list) => {
      if (token !== detailsToken || !achSlot) return;
      achSlot.replaceChildren(...(list.total ? [achievementsCard(list)] : []));
    })
    .catch(() => {});
}

/** «Actividad»: las últimas sesiones agrupadas por día, como el muro de Steam. */
function renderActivity(d) {
  if (!activitySlot) return;
  const sessions = d.recentSessions || [];
  if (!sessions.length) return activitySlot.replaceChildren();
  const byDay = [];
  for (const s of sessions.slice(0, 12)) {
    const label = date(new Date(s.startedAt * 1000).toISOString());
    const last = byDay[byDay.length - 1];
    if (last && last.label === label) last.items.push(s);
    else byDay.push({ label, items: [s] });
  }
  activitySlot.replaceChildren(
    h(
      "div",
      { class: "card activity" },
      h("h3", null, "Actividad"),
      ...byDay.map((day) =>
        h(
          "div",
          { class: "act-day" },
          h("div", { class: "act-date" }, day.label),
          ...day.items.map((s) => h("div", { class: "act-item" }, h("span", { class: "act-dot" }), h("span", null, `Has jugado ${playtime(s.duration)}`), h("small", null, relative(s.startedAt)))),
        ),
      ),
    ),
  );
}

async function refreshGameStats(g) {
  renderedStats = statsKey(g);
  $(".playbar .stats")?.replaceChildren(...gameStats(g));
  const token = detailsToken;
  loadAchievements(g.id, token);
  const d = await ejg.game.details(g.id).catch(() => null);
  if (d && token === detailsToken) renderActivity(d);
}

let renderedArt = "";
/** En la página de un juego oculto: el aviso y el botón para devolverlo a la biblioteca. */
function hiddenNote(g) {
  const note = h(
    "div",
    { class: "hidden-note", "data-focus-group": "hidden-note" },
    h("span", null, h("b", null, "Este juego está oculto."), " No sale en tu biblioteca; solo en el filtro «Ocultos»."),
    h(
      "button",
      {
        class: "btn-show",
        "data-focus": "",
        onclick: async () => {
          await ejg.game.hide(g.id, false);
          note.remove();
          focus.focus($("#play"), { silent: true });
          ejg.ui.toast(`«${g.title}» vuelve a tu biblioteca`, "ok");
        },
      },
      "Mostrar en la biblioteca",
    ),
  );
  return note;
}

async function renderGame(id) {
  const g = ejg.library.byId(id);
  if (!g) return back();
  renderedArt = `${g.id}|${g.media.hero}|${g.media.logo}`;
  renderedStats = statsKey(g);
  heroRelease();
  trailer?.destroy();
  trailer = null;
  const token = ++detailsToken;
  const heroUrl = g.media.hero || g.media.heroThumb || g.media.header;
  const hero = h("div", { class: "hero", style: heroUrl ? { backgroundImage: `url("${heroUrl}")` } : {} });
  if (g.media.logo) {
    const logo = img(g.media.logo, { class: "logo", loading: "eager" });
    logo.addEventListener("error", () => logo.replaceWith(h("div", { class: "htitle" }, g.title)));
    hero.append(logo);
  } else hero.append(h("div", { class: "htitle" }, g.title));

  const gear = h("button", { class: "round", "data-focus": "", title: "Administrar", onclick: (e) => manageMenu(e.currentTarget, ejg.library.byId(g.id) || g) }, svg("gear"));
  const info = h("button", { class: "round", "data-focus": "", title: "Información del juego", onclick: () => main.querySelector(".info-card")?.scrollIntoView({ behavior: "smooth", block: "center" }) }, svg("info"));
  const favBtn = h("button", { class: "round fav" + (g.favorite ? " on" : ""), "data-focus": "", title: "Favorito (Y)", onclick: () => ejg.game.favorite(g.id) }, svg("star"));
  const playbar = h(
    "div",
    { class: "playbar", "data-focus-group": "playbar" },
    playButton(g),
    h("div", { class: "stats" }, ...gameStats(g)),
    h("div", { class: "actions" }, gear, info, favBtn),
  );
  const link = (label, fn) => h("button", { class: "gnav-link", "data-focus": "", onclick: fn }, label);
  const gnav = h(
    "div",
    { class: "game-nav", "data-focus-group": "gnav" },
    link("Guías", () => openGuides(g.id)),
    link("Trucos", () => ejg.trainer.open(g.id)),
    link("Mapa", () => ejg.maps.open(g.id)),
    link("Explorar archivos locales", () => ejg.game.openFolder(g.id)),
    link("Propiedades", () => ejg.game.edit(g.id)),
    link("Estadísticas", () => ejg.ui.open("stats")),
    canUninstall(g) ? link("Desinstalar", () => ejg.game.uninstall(g.id)) : null,
  );
  const left = h("div", { class: "g-left" }, h("div", { class: "card" }, h("h3", null, "Acerca del juego"), h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel", style: { width: "60%" } })));
  achSlot = h("div");
  activitySlot = h("div");
  const guideSlot = h("div");
  const right = h("div", { class: "g-right" }, achSlot, guideSlot);
  const body = h("div", { class: "game-body" }, left, right);
  const bg = h("div", { class: "game-bg", style: heroUrl ? { backgroundImage: `url("${g.media.heroThumb || heroUrl}")` } : {} });
  main.replaceChildren(h("div", { class: "game" }, bg, hero, playbar, g.hidden ? hiddenNote(g) : null, repackUpdateNote(g), howLongNote(g), gnav, body));
  main.scrollTop = 0;
  focus.focus($("#play"), { instant: true, silent: true });

  // Microtráiler de fondo en el banner.
  if (ejg.settings.autoTrailer && g.media.microtrailer) {
    const v = h("video", { muted: true, loop: true, playsInline: true });
    v.muted = true;
    hero.prepend(v);
    const t = setTimeout(async () => {
      const rel = await attachStream(v, g.media.microtrailer);
      heroRelease = () => (clearTimeout(t), rel(), v.remove());
      v.onplaying = () => (v.style.opacity = "1");
      v.play().catch(() => {});
    }, 1200);
    heroRelease = () => clearTimeout(t);
  }

  let d;
  try {
    d = await ejg.game.details(id);
  } catch (e) {
    left.replaceChildren(h("div", { class: "card" }, h("h3", null, "Error"), h("p", null, String(e.message || e))));
    return;
  }
  if (token !== detailsToken) return;

  // Columna principal: actividad, descripción, tráileres, capturas.
  left.replaceChildren();
  if (d.metaStatus === "review" || d.metaStatus === "failed") {
    left.append(
      h(
        "div",
        { class: "card meta-warn" },
        d.metaStatus === "failed" ? "No hemos encontrado información de este juego." : "¿No es este juego? La identificación automática no está segura.",
        h("button", { "data-focus": "", onclick: () => ejg.game.edit(g.id) }, "Corregir"),
      ),
    );
  }
  left.append(activitySlot);
  renderActivity(d);
  if (d.description || d.shortDescription) {
    const desc = h("div", { class: "desc" });
    desc.append(description(d.description || d.shortDescription));
    const card = h("div", { class: "card" }, h("h3", null, "Acerca del juego"), desc);
    left.append(card);
    requestAnimationFrame(() => {
      if (desc.scrollHeight > 280) {
        desc.classList.add("clamp");
        const more = h("button", { class: "more", "data-focus": "", onclick: () => (desc.classList.remove("clamp"), more.remove()) }, "Leer más");
        card.append(more);
      }
    });
  }
  if (d.trailers.length) {
    const box = h("div", { class: "trailer-box" });
    const list = h("div", { class: "shots", "data-focus-group": "trailers" });
    d.trailers.slice(0, 6).forEach((t, i) => {
      list.append(
        h(
          "button",
          { class: "shot", "data-focus": "", onclick: () => ((trailer?.destroy(), (trailer = trailerPlayer(box, t, { autoplay: true })))) },
          t.poster ? img(t.poster) : null,
          h("div", { class: "playico", html: ICON.play }),
          h("div", { class: "cap" }, t.title || `Tráiler ${i + 1}`),
        ),
      );
    });
    const first = d.trailers[0];
    if (first.poster) box.append(img(first.poster, { style: "width:100%;height:100%;object-fit:cover" }));
    left.append(h("div", { class: "card" }, h("h3", null, "Tráileres"), box, list));
  }
  if (d.screenshots.length) {
    const shots = h("div", { class: "shots", "data-focus-group": "shots" });
    d.screenshots.forEach((s, i) => shots.append(h("button", { class: "shot", "data-focus": "", onclick: () => openLightbox(d.screenshots, i) }, img(s.thumb || s.url))));
    left.append(h("div", { class: "card" }, h("h3", null, "Capturas", h("span", { class: "n" }, ` ${d.screenshots.length}`)), shots));
  }

  loadAchievements(id, token);
  loadGuidesCard(id, token, guideSlot);

  // Columna lateral: información y etiquetas.
  const rows = [
    ["Desarrollador", d.developer],
    ["Editor", d.publisher],
    ["Fecha de lanzamiento", date(d.releaseDate)],
    ["Origen", SOURCE_LABEL[d.source] || d.source],
    ["Valoración", d.rating ? `${d.rating} %` : null],
    ["Veces jugado", d.launchCount || null],
  ].filter((r) => r[1]);
  right.append(h("div", { class: "card info-card" }, h("h3", null, "Información"), ...rows.map(([k, v]) => h("div", { class: "info-row" }, h("span", null, k), h("span", null, String(v))))));
  const tags = [...new Set([...(d.genres || []), ...(d.tags || [])])].slice(0, 14);
  if (tags.length) right.append(h("div", { class: "card" }, h("h3", null, "Etiquetas"), h("div", { class: "tags" }, ...tags.map((t) => h("span", { class: "tag" }, t)))));
}

// ─────────────── guías de la comunidad ───────────────
let guideView = null;
let guideRoot = null;

function openGuides(gameId, guideId = null) {
  pushView("guides", { gameId, guideId });
  render();
}

// ─────────────── tu perfil e insignias (en la misma página que las guías) ───────────────
/** start: "profile" | "badges". */
function openProfilePage(start = "profile") {
  pushView("guides", { gameId: null, profilePage: { start } });
  render();
}

function renderProfilePage() {
  const key = state.profilePage.start;
  if (guideView && guideRoot?.isConnected && guideRoot.dataset.profile === key) return;
  dropGuides();
  guideRoot = h("div", { class: "guides-body profile-body", "data-profile": key });
  main.replaceChildren(h("div", { class: "guides-page profile-page" }, guideRoot));
  main.scrollTop = 0;
  guideView = createProfilePages({ ejg, root: guideRoot, focus, start: key, onExit: () => back(), onChange: () => updateHints() });
  updateHints();
}

/** La página de guías: la del juego, con su arte difuminado detrás. */
function renderGuides() {
  if (guideView && guideRoot?.isConnected && guideRoot.dataset.game === String(state.gameId)) return;
  dropGuides();
  const g = ejg.library.byId(state.gameId);
  if (!g) return back();
  const art = g.media.hero || g.media.heroThumb || g.media.header;
  guideRoot = h("div", { class: "guides-body", "data-game": g.id });
  main.replaceChildren(
    h(
      "div",
      { class: "guides-page" },
      h("div", { class: "guides-bg", style: art ? { backgroundImage: `url("${art}")` } : {} }),
      h(
        "div",
        { class: "guides-top" },
        h("button", { class: "guides-game", "data-focus": "", onclick: () => back() }, g.media.icon ? img(g.media.icon) : null, h("span", null, g.title)),
        h("span", { class: "guides-crumb" }, "›  Guías"),
      ),
      guideRoot,
    ),
  );
  main.scrollTop = 0;
  guideView = createGuideView({
    ejg,
    root: guideRoot,
    focus,
    gameId: g.id,
    guide: state.guideId || null,
    labels: { title: "Guías de la comunidad", browser: "Ver en Steam" },
    onExit: () => back(),
    onChange: () => updateHints(),
  });
  state.guideId = null;
}

function dropGuides() {
  guideView?.destroy();
  guideView = null;
  guideRoot = null;
}

/** Tarjeta de la ficha: las guías guardadas y las mejor valoradas. */
async function loadGuidesCard(id, token, slot) {
  const [shelf, list] = await Promise.all([ejg.guides.shelf(id).catch(() => null), ejg.guides.list(id, {}).catch(() => null)]);
  if (token !== detailsToken || !list || list.appid == null) return;
  // Lo tuyo primero (guardadas y la que dejaste a medias) y luego las mejor valoradas.
  const mine = [...(shelf?.pinned || []).slice(0, 2).map((x) => [x, "saved"]), ...(shelf?.recent || []).slice(0, 1).map((x) => [x, "recent"])];
  const top = list.items.filter((x) => !mine.some(([m]) => m.id === x.id)).slice(0, Math.max(1, 4 - mine.length));
  const sub = (it, kind) =>
    kind === "saved"
      ? "★ Guardada"
      : kind === "recent"
        ? `Seguir leyendo${it.progress ? ` · sección ${it.progress.section + 1}` : ""}`
        : [starsText(it.stars), it.author].filter(Boolean).join(" · ");
  const entry = (it, kind) =>
    h(
      "button",
      { class: "guide-row" + (kind ? " is-" + kind : ""), "data-focus": "", onclick: () => openGuides(id, it.id) },
      it.preview ? img(it.preview) : h("span", { class: "guide-ph" }, "📖"),
      h("span", { class: "guide-txt" }, h("b", null, it.title), h("small", null, sub(it, kind))),
    );
  const rows = [...mine.map(([x, kind]) => entry(x, kind)), ...top.map((x) => entry(x, null))];
  if (!rows.length) return;
  slot.replaceChildren(
    h(
      "div",
      { class: "card guides-card", "data-focus-group": "guides-card" },
      h("h3", null, "Guías de la comunidad", list.total ? h("span", { class: "n" }, ` ${list.total.toLocaleString(ejg.locale)}`) : null),
      ...rows,
      h("button", { class: "gnav-link guides-all", "data-focus": "", onclick: () => openGuides(id) }, "Ver todas las guías"),
    ),
  );
}

// ─────────────── logros ───────────────
function achTile(a) {
  const on = !!a.unlockedAt;
  const src = on ? a.icon : a.iconGray || a.icon;
  const tip = [a.name, a.description, on ? `Desbloqueado ${date(new Date(a.unlockedAt * 1000).toISOString())}` : a.globalPct != null ? `${a.globalPct.toFixed(1)} % de jugadores` : ""]
    .filter(Boolean)
    .join("\n");
  return h("div", { class: "ach-tile" + (on ? "" : " locked"), title: tip }, src ? img(src) : h("span", { class: "ach-ph", html: ICON.trophy }));
}

function achRow(a) {
  const on = !!a.unlockedAt;
  const src = on ? a.icon : a.iconGray || a.icon;
  return h(
    "div",
    { class: "ach-row" + (on ? "" : " locked"), "data-focus": "" },
    src ? img(src) : h("span", { class: "ach-ph", html: ICON.trophy }),
    h("div", { class: "ach-txt" }, h("b", null, a.name), a.description ? h("span", null, a.description) : null),
    h("small", null, on ? relative(a.unlockedAt) : a.globalPct != null ? `${a.globalPct.toFixed(1)} %` : ""),
  );
}

function achievementsCard(list) {
  const pct = Math.round((list.unlocked / list.total) * 100);
  const done = list.items.filter((a) => a.unlockedAt).sort((a, b) => b.unlockedAt - a.unlockedAt);
  const locked = list.items.filter((a) => !a.unlockedAt).sort((a, b) => (b.globalPct ?? -1) - (a.globalPct ?? -1));
  const all = h("div", { class: "ach-list", hidden: true, "data-focus-group": "achievements" }, ...[...done, ...locked].map(achRow));
  const tiles = (arr, max) => {
    const out = arr.slice(0, max).map(achTile);
    if (arr.length > max) out.push(h("div", { class: "ach-tile more-n" }, `+${arr.length - max}`));
    return out;
  };
  const more = h(
    "button",
    {
      class: "btn-steam wide",
      "data-focus": "",
      onclick: () => {
        all.hidden = !all.hidden;
        more.textContent = all.hidden ? "Ver mis logros" : "Ocultar la lista";
      },
    },
    "Ver mis logros",
  );
  return h(
    "div",
    { class: "card ach" },
    h("h3", null, "Logros"),
    h("div", { class: "ach-head" }, h("span", null, `Has desbloqueado ${list.unlocked}/${list.total} `, h("span", { class: "muted" }, `(${pct} %)`))),
    h("div", { class: "ach-bar" }, h("i", { style: { width: `${pct}%` } })),
    done.length ? h("div", { class: "ach-icons" }, ...tiles(done, 7)) : null,
    locked.length ? h("div", { class: "ach-sub" }, "Logros bloqueados") : null,
    locked.length ? h("div", { class: "ach-icons" }, ...tiles(locked, 7)) : null,
    all,
    more,
  );
}

// ─────────────── lightbox ───────────────
let lbItems = [];
let lbIndex = 0;
function openLightbox(items, i) {
  lbItems = items;
  lbIndex = i;
  lightbox.hidden = false;
  showLightbox();
  ejg.sound.play("open");
}
function showLightbox() {
  const it = lbItems[lbIndex];
  lightbox.replaceChildren(img(it.url, { loading: "eager" }), h("div", { class: "hint" }, `${lbIndex + 1} / ${lbItems.length} · ← → para cambiar · Esc para cerrar`));
}
function stepLightbox(d) {
  lbIndex = (lbIndex + d + lbItems.length) % lbItems.length;
  showLightbox();
  ejg.sound.play("move");
}
function closeLightbox() {
  lightbox.hidden = true;
  ejg.sound.play("back");
}
lightbox.addEventListener("click", closeLightbox);

// ─────────────── navegación ───────────────
function stopMedia() {
  dropGuides();
  heroRelease();
  heroRelease = () => {};
  trailer?.destroy();
  trailer = null;
}

/** Entra en una vista de la biblioteca recordando la actual para «Atrás». */
function pushView(view, extra = {}) {
  if (state.tab === "library") state.prev.push({ view: state.view, gameId: state.gameId, collection: state.collection, profilePage: state.profilePage, scroll: main.scrollTop });
  if (state.prev.length > 30) state.prev.shift();
  stopMedia();
  state.tab = "library";
  state.view = view;
  state.profilePage = null;
  Object.assign(state, extra);
}

function openGame(id) {
  if (state.tab === "library" && state.view === "game" && state.gameId === id) return;
  pushView("game", { gameId: id });
  ejg.storage.set("last", id);
  render();
}
function openCollection(id) {
  pushView("collection", { collection: id, gameId: null });
  render();
  focus.first(main);
}
/** Inicio o Colecciones desde la barra lateral: empiezan un historial nuevo. */
function goLibrary(view) {
  stopMedia();
  state.prev = [];
  state.tab = "library";
  state.view = view;
  state.gameId = null;
  state.collection = null;
  state.profilePage = null;
  render();
  main.scrollTop = 0;
  focus.first(main);
}

function back() {
  if (!lightbox.hidden) return closeLightbox(), true;
  if (closeMenu()) return true;
  if (meMenu.contains(focus.current)) return focus.focus(meTab, { silent: true }), true;
  // En una guía: vuelve a la lista (o a la ficha, si se abrió desde ella).
  if (inGuides() && guideView.mode === "reader") return guideView.nav("back");
  // En las insignias abiertas desde el perfil: vuelve al perfil.
  if (inGuides() && state.profilePage && guideView.depth > 1) return guideView.nav("back");
  if (shop.back()) return true;
  if (state.tab !== "library") return false;
  const p = state.prev.pop();
  if (!p) {
    if (state.view === "home") return false;
    goLibrary("home");
    return true;
  }
  const last = state.gameId;
  stopMedia();
  Object.assign(state, { view: p.view, gameId: p.gameId, collection: p.collection, profilePage: p.profilePage || null });
  render();
  main.scrollTop = p.scroll || 0;
  const el = (last && (main.querySelector(`[data-game-id="${last}"]`) || sideList.querySelector(`[data-game-id="${last}"]`))) || null;
  if (el) focus.focus(el, { silent: true });
  else focus.first(main);
  ejg.sound.play("back");
  return true;
}

/** Pestañas de la barra superior, como en Steam. Descargas se abre desde la barra inferior. */
function tabList() {
  return [...(ejg.explore.enabled ? ["store"] : []), "library"];
}
function goTab(t) {
  stopMedia();
  closeMenu(true);
  state.tab = t;
  render();
  if (t === "library") main.scrollTop = 0;
  focus.first(main);
}
function switchTab(d) {
  const tabs = tabList();
  const cur = tabs.indexOf(state.tab === "downloads" ? "library" : state.tab);
  goTab(tabs[(cur + d + tabs.length) % tabs.length]);
}

const navBack = $("#nav-back");
navBack.addEventListener("click", () => back());
function updateHistory() {
  const can = state.tab === "library" ? state.view !== "home" : state.tab === "store" && shop.canBack();
  navBack.disabled = !can;
}

function renderTabs() {
  // Las descargas son parte de la biblioteca (en Steam también). Tu perfil y
  // tus insignias son de la pestaña con tu nombre.
  const me = state.tab === "library" && state.view === "guides" && !!state.profilePage;
  const on = me ? "me" : state.tab === "downloads" ? "library" : state.tab;
  document.querySelectorAll(".tab[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === on)));
  meTab.setAttribute("aria-selected", String(me));
}

function render() {
  renderTabs();
  // Tu perfil y tus insignias van a página entera, sin la barra de la biblioteca.
  document.documentElement.dataset.view = isShop() ? state.tab : state.view === "guides" && state.profilePage ? "profile" : "library";
  updateHints();
  updateDownloadsUi();
  if (isShop()) {
    shop.render();
    return updateHistory();
  }
  renderSidebar();
  if (state.view === "game") renderGame(state.gameId);
  else if (state.view === "guides") state.profilePage ? renderProfilePage() : renderGuides();
  else if (state.view === "collections") renderCollections();
  else if (state.view === "collection") renderCollection();
  else renderHome();
  updateHistory();
  // Si el elemento enfocado desapareció, recuperar el foco en su sustituto.
  if (focus.current && !focus.current.isConnected) {
    const id = focus.current.dataset?.gameId;
    const again = id && document.querySelector(`[data-game-id="${id}"]`);
    if (again) focus.focus(again, { noScroll: true, silent: true });
    else focus.reset();
  }
}

document.querySelectorAll(".tab[data-tab]").forEach((t) =>
  t.addEventListener("click", () => {
    // Otra vez en Biblioteca: vuelve a su inicio, como en Steam.
    if (t.dataset.tab === "library" && state.tab === "library") return goLibrary("home");
    // Tienda: siempre a su portada, vengas de donde vengas.
    if (t.dataset.tab === "store") shop.home();
    goTab(t.dataset.tab);
    if (t.dataset.tab === "store") main.scrollTop = 0;
  }),
);

// ─────────────── descargas: la barra inferior ───────────────
// Como en Steam: en el centro, «Administrar descargas» o el juego que se está
// bajando (su imagen, el nombre y el progreso). Es la entrada al gestor.
const dlFooter = $("#dl-footer");
dlFooter.addEventListener("click", () => goTab("downloads"));
let dlfSig = "";
function updateDownloadsUi() {
  const all = ejg.downloads.all;
  $("#tab-store").hidden = !ejg.explore.enabled;
  const now = all.filter((d) => d.state === "downloading" || d.state === "installing");
  const queued = all.filter((d) => d.state === "queued" || d.state === "paused").length;
  const ready = all.filter((d) => ["seeding", "completed"].includes(d.state)).length;
  dlFooter.classList.toggle("on", state.tab === "downloads");
  if (!now.length) {
    const sig = `idle|${ready}|${queued}`;
    if (sig === dlfSig) return;
    dlfSig = sig;
    dlFooter.classList.remove("active");
    const extra = ready ? `${ready} ${ready === 1 ? "lista" : "listas"} para instalar` : queued ? `${queued} en cola` : "";
    dlFooter.replaceChildren(
      h("span", { class: "dlf-ico", html: ICON.download }),
      h("span", { class: "dlf-label" }, "Administrar descargas"),
      ...(extra ? [h("span", { class: "dlf-extra" }, extra)] : []),
    );
    return;
  }
  const cur = now[0];
  const total = now.reduce((a, d) => ({ d: a.d + d.doneBytes, t: a.t + d.totalBytes, s: a.s + d.downBps }), { d: 0, t: 0, s: 0 });
  const pct = total.t ? total.d / total.t : 0;
  // La estructura solo se rehace si cambia el juego; el progreso se actualiza en su sitio.
  const sig = `busy|${cur.id}|${cur.state}|${queued + now.length - 1}`;
  if (sig !== dlfSig) {
    dlfSig = sig;
    dlFooter.classList.add("active");
    const art = cur.capsule || cur.cover;
    const others = queued + now.length - 1;
    dlFooter.replaceChildren(
      art ? h("span", { class: "dlf-art" }, img(art)) : h("span", { class: "dlf-ico", html: ICON.download }),
      h(
        "span",
        { class: "dlf-main" },
        h("span", { class: "dlf-top" }, h("b", null, cur.state === "installing" ? "Instalando" : "Descargando"), h("span", { class: "dlf-title" }, cur.title), others ? h("small", null, `+${others} en cola`) : null),
        h("span", { class: "dlf-bar" }, h("i")),
      ),
      h("span", { class: "dlf-meta" }),
    );
  }
  dlFooter.querySelector(".dlf-bar i").style.width = `${pct * 100}%`;
  dlFooter.querySelector(".dlf-meta").textContent = cur.state === "installing" ? downloadLabel(cur) : `${percent(pct)} · ${speed(total.s)}`;
}
ejg.explore.onEnabled(() => {
  if (!ejg.explore.enabled && state.tab === "store") goTab("library");
  else updateDownloadsUi();
});
// El host pide una vista (menú rápido, Ctrl+E / Ctrl+J, avisos…).
ejg.ui.onView(({ view, slug, gameId, guideId }) => {
  if (view === "guides" && gameId) return openGuides(gameId, guideId);
  if (view === "profile" || view === "badges") return openProfilePage(view);
  if (view === "downloads") return goTab("downloads");
  if (!ejg.explore.enabled) return;
  goTab("store");
  if (view === "repack" && slug) shop.openRepack(slug);
});
document.querySelectorAll("[data-action]").forEach((b) =>
  b.addEventListener("click", () => {
    const a = b.dataset.action;
    if (a === "add") ejg.ui.open("add-folder");
    else ejg.ui.open(a);
  }),
);
document.querySelector('[data-win="min"]').onclick = () => ejg.window.minimize();
document.querySelector('[data-win="max"]').onclick = () => ejg.window.maximize();
document.querySelector('[data-win="close"]').onclick = () => ejg.window.close();

// ─────────────── tu perfil: el avatar de arriba y la pestaña con tu nombre ───────────────
// Como en el cliente de Steam: tu foto abre el menú de tu perfil y, a la
// derecha de Biblioteca, tu nombre lleva a tu perfil y al pasar por encima
// enseña Perfil, Insignias y Editar perfil.
const acctBtn = $("#acct-btn");
const meTab = $("#tab-me");
const meWrap = $("#me-wrap");
const meMenu = $("#me-menu");

function me() {
  const card = ejg.profiles.me;
  return { card, name: card?.name || ejg.profile?.name || "" };
}

function renderProfile() {
  const p = ejg.profile;
  const { card, name } = me();
  const url = card?.avatarUrl || p?.avatar;
  const av = $("#avatar");
  av.textContent = url ? "" : (name || "?")[0].toUpperCase();
  av.style.backgroundImage = url ? `url("${url}")` : "";
  av.style.backgroundColor = url ? "" : p?.color || "";
  $("#profile-name").textContent = name;
  meTab.replaceChildren(name || "Perfil");
  const item = (label, run) => h("button", { class: "tab-menu-item", "data-focus": "", onclick: run }, label);
  meMenu.replaceChildren(item("Perfil", () => openProfilePage("profile")), item("Insignias", () => openProfilePage("badges")), item("Editar perfil", () => ejg.profiles.edit()));
  renderTabs();
}

meTab.addEventListener("click", () => openProfilePage("profile"));
// Con ratón el submenú sale al pasar por encima (CSS); al elegir, se esconde.
meMenu.addEventListener("click", () => meWrap.classList.add("is-done"));
meWrap.addEventListener("mouseleave", () => meWrap.classList.remove("is-done"));

/** El menú de tu foto: tú arriba (con tu nivel), tu perfil y cambiar de perfil. */
function openProfileMenu() {
  const { card, name } = me();
  const head = h(
    "div",
    { class: "acct-head" },
    kitAvatar({ avatarUrl: card?.avatarUrl || ejg.profile?.avatar, frame: card?.frame || "", name }, { size: "l" }),
    h("div", { class: "acct-who" }, h("b", { class: "acct-name" }, name), h("small", { class: "acct-lvl" }, "Nivel ", levelBadge(card?.level || 0))),
  );
  openMenu(
    acctBtn,
    [
      { node: head },
      "-",
      { label: "Ver mi perfil", run: () => openProfilePage("profile") },
      { label: "Editar perfil", run: () => ejg.profiles.edit() },
      { label: "Insignias", run: () => openProfilePage("badges") },
      "-",
      { label: "Cambiar de perfil…", run: () => ejg.ui.open("profiles") },
    ],
    { cls: "acct-menu", first: true },
  );
}
acctBtn.addEventListener("click", openProfileMenu);

function renderWallpaper() {
  const w = $("#wallpaper");
  // Con evento (Halloween…), su fondo animado.
  const url = ejg.season.event?.wallpaperVideo || ejg.settings.wallpaper;
  w.replaceChildren();
  w.classList.toggle("custom", !!url);
  if (url && /\.(mp4|webm)$/i.test(url)) {
    const v = h("video", { autoplay: true, muted: true, loop: true, playsInline: true, src: url });
    v.muted = true;
    w.append(v);
  }
}

// ─────────────── buscador de la barra lateral ───────────────
filterInput.setAttribute("data-focus", "");
filterInput.addEventListener(
  "input",
  debounce(() => {
    state.filter = filterInput.value.trim();
    if (state.view !== "home") {
      stopMedia();
      state.prev = [];
      state.view = "home";
      state.gameId = null;
    }
    render();
  }, 90),
);
filterInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = filtered()[0];
    if (first) openGame(first.id);
  }
  if (e.key === "Escape") {
    filterInput.value = "";
    state.filter = "";
    filterInput.blur();
    render();
  }
});

// ─────────────── eventos del host ───────────────
const rerender = debounce(() => {
  if (isShop()) return updateDownloadsUi();
  // Leyendo guías no se repinta la página (se perdería la posición).
  if (state.view === "guides") return renderSidebar();
  if (state.view === "game") {
    // En la página de juego solo refrescamos lo que cambia (evita recargar el tráiler).
    renderSidebar();
    updatePlayButton();
    const g = ejg.library.byId(state.gameId);
    if (!g) return back(); // desinstalado o quitado
    if (`${g.id}|${g.media.hero}|${g.media.logo}` !== renderedArt) {
      const top = main.scrollTop;
      renderGame(g.id).then(() => (main.scrollTop = top));
      return;
    }
    main.querySelector(".playbar .fav")?.classList.toggle("on", g.favorite);
    // Al cerrar el juego: horas, logros y actividad al día.
    if (statsKey(g) !== renderedStats) refreshGameStats(g);
  } else {
    const top = main.scrollTop;
    render();
    main.scrollTop = top;
  }
}, 60);
ejg.library.onChange(rerender);
ejg.on("collections", rerender);
ejg.on("running", rerender);
ejg.game.onState(() => rerender());
ejg.on("settings", () => {
  renderWallpaper();
  render();
});
ejg.on("profile", renderProfile);
ejg.profiles.onChange(renderProfile);

const hintBar = hints(document.getElementById("hints"), []);
function updateHints() {
  hintBar.set(
    state.tab === "store"
      ? [["accept", "Abrir"], ["y", "Buscar"], ["back", "Volver"], ["lb", "Pestañas"], ["menu", "Menú"]]
      : state.tab === "downloads"
        ? [["accept", "Elegir"], ["lb", "Pestañas"], ["menu", "Menú"]]
        : state.view === "guides" && guideView
          ? guideView.hints()
          : state.view === "game"
          ? [["accept", "Elegir"], ["back", "Atrás"], ["y", "Favorito"], ["x", "Propiedades"]]
          : [["accept", "Abrir"], ["y", "Favorito"], ["x", "Propiedades"], ["lb", "Pestañas"], ["menu", "Menú"]],
  );
}

renderProfile();
renderWallpaper();
render();
if (saved.last && ejg.library.byId(saved.last) && ejg.mode === "tv") openGame(saved.last);
focus.first(main) || focus.first();
