// Tema "Moneda": el de la casa. Tres formas sacadas del logo, cada una con un
// solo significado: el disco rojo es Jugar, el anillo es el progreso (logros,
// descargas) y la ranura (la barrita de la moneda) marca dónde estás: la
// pestaña abierta y el juego enfocado. Pestañas arriba: Inicio, Biblioteca,
// Tienda y Homebrew; las descargas, en el anillo de la barra.

import { h, img, keyed, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { attachStream, trailerPlayer } from "/_sdk/kit/media.js";
import { playtime, relative, date, year, description, SOURCE_LABEL } from "/_sdk/kit/format.js";
import { visible, sort, search, inCollection, canUninstall, isRom, isSoftware, SORTS } from "/_sdk/kit/library.js";
import { emulatorNote } from "/_sdk/kit/emulator.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";
import { repackUpdateNote } from "/_sdk/kit/updates.js";
import { howLongNote } from "/_sdk/kit/hltb.js";
import { percent, speed } from "/_sdk/kit/store.js";
import { createHomebrewView } from "/_sdk/kit/homebrew.js";
import { createGuideView, starsText } from "/_sdk/kit/guides.js";
import { createStore } from "./store.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const main = $("#main");
const lightbox = $("#lightbox");
const searchBox = $("#top-search");

const saved = (await ejg.storage.getAll().catch(() => null)) || {};
const state = {
  /** home | library | collections | collection | game | guides | homebrew | store | downloads */
  page: "home",
  /** La pestaña desde la que se abrió una ficha (para encender la suya). */
  from: "home",
  gameId: null,
  guideId: null,
  collection: null,
  prev: [],
  /** Lo escrito en el buscador de arriba (en la biblioteca). */
  filter: "",
  chip: ["all", "played", "unplayed", "fav", "hidden"].includes(saved.chip) ? saved.chip : "all",
  sort: saved.sort || "title",
};

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 19l1-5.4-4-3.8 5.4-.7z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m14.5 6-6 6 6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m14.5 6-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6"/></svg>',
  guide: '<svg viewBox="0 0 24 24"><path d="M5 4.5h10.5L19 8v11.5H5z"/><path d="M9 11h6M9 15h4"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 4.5h8v4.5a4 4 0 0 1-8 0Z"/><path d="M8 6.5H5.5a2.5 2.5 0 0 0 2.6 3M16 6.5h2.5a2.5 2.5 0 0 1-2.6 3M12 13v4M8.5 19.5h7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  caret: '<svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>',
  stack: '<svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="6" height="15" rx="1.5"/><rect x="13.5" y="4.5" width="6" height="15" rx="1.5"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5 9 15M15 9l2.5-2.5"/></svg>',
};
const svg = (name) => h("span", { class: "i", html: ICON[name] });

/** El anillo del logo: progreso de 0 a 1 (`live`: rojo, algo en marcha; si no, blanco). */
function ring(p, { size = 56, stroke = 8, live = false, label = "" } = {}) {
  const r = 50 - stroke / 2 - 1;
  const el = h("span", { class: "ring-box" + (live ? " live" : ""), style: `width:${size}px;height:${size}px` });
  el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="rb" cx="50" cy="50" r="${r}" stroke-width="${stroke}"/><circle class="rf" cx="50" cy="50" r="${r}" stroke-width="${stroke}" pathLength="100" stroke-dasharray="${Math.max(0, Math.min(100, p * 100))} 100"/></svg>`;
  if (label) el.append(h("b", null, label));
  return el;
}

// ─────────────── foco y mando ───────────────
const focus = createFocus({ root: document.body });
const isShop = () => state.page === "store" || state.page === "downloads";
const inGuides = () => state.page === "guides" && guideView;
const gv = (action) => !!(inGuides() && guideView.nav(action));
const inHomebrew = () => state.page === "homebrew" && hbView;
const hv = (action) => !!(inHomebrew() && hbView.nav(action));
bindNav(focus, {
  back: () => back(),
  up: () => gv("up"),
  down: () => gv("down"),
  lt: () => gv("lt"),
  rt: () => gv("rt"),
  y: () => {
    if (gv("y") || hv("y")) return true;
    if (state.page === "store") return shop.search(), true;
    const id = focusedGameId() ?? (state.page === "game" ? state.gameId : null);
    if (id && !isShop()) ejg.game.favorite(id);
    return !!id;
  },
  x: () => {
    if (gv("x") || hv("x")) return true;
    if (isShop()) return false;
    const id = focusedGameId() ?? (state.page === "game" ? state.gameId : null);
    if (id) ejg.game.edit(id);
    return !!id;
  },
  menu: () => (ejg.ui.open("menu"), true),
  view: () => gv("view") || (ejg.ui.open("search"), true),
  lb: () => gv("lb") || hv("lb") || (menu || shop.hasDialog() || switchTab(-1), true),
  rb: () => gv("rb") || hv("rb") || (menu || shop.hasDialog() || switchTab(1), true),
  left: () => (!lightbox.hidden ? (stepLightbox(-1), true) : false),
  right: () => (!lightbox.hidden ? (stepLightbox(1), true) : false),
});
ejg.on("focus-return", () => focus.restore());

const shop = createStore({
  ejg,
  main,
  focus,
  openGame: (id) => openGame(id),
  goTab: (t) => goTab(t),
  onChange: () => updateDownloadsUi(),
  onNavigate: () => {},
  searchBox,
});
shop.bindTab(() => (state.page === "store" ? "store" : state.page === "downloads" ? "downloads" : "library"));

function focusedGameId() {
  const id = focus.current?.closest("[data-game-id]")?.dataset.gameId;
  return id ? Number(id) : null;
}

// ─────────────── menús desplegables ───────────────
let menu = null;
/** items: [{ label, run, danger?, on? } | "-" | { node }] */
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
  box.style.top = `${r.bottom + hgt + 8 > innerHeight ? Math.max(8, r.top - hgt - 6) : r.bottom + 6}px`;
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
const CHIPS = { all: "Todos", played: "Jugados", unplayed: "Sin jugar", fav: "Favoritos", hidden: "Ocultos" };
const hiddenGames = () => ejg.library.all.filter((g) => g.hidden && !g.missing && !isRom(g) && !isSoftware(g));
function chipped(list) {
  if (state.chip === "fav") return list.filter((g) => g.favorite);
  if (state.chip === "played") return list.filter((g) => g.playtime > 0 || g.lastPlayed);
  if (state.chip === "unplayed") return list.filter((g) => !g.playtime && !g.lastPlayed);
  return list;
}
function filtered() {
  if (state.chip === "hidden" && !hiddenGames().length) state.chip = "all";
  const list = state.chip === "hidden" ? hiddenGames() : chipped(games());
  return state.filter ? search(list, state.filter, 500) : sort(list, state.sort);
}
const isRunning = (id) => ejg.game.isRunning(id);
const collectionById = (id) => (id === "fav" ? { id: "fav", name: "Favoritos", kind: "fav" } : ejg.library.collections.find((c) => c.id === id));
const members = (c) => (c.kind === "fav" ? games().filter((g) => g.favorite) : inCollection(games(), c));

function saveState() {
  ejg.storage.set("chip", state.chip);
  ejg.storage.set("sort", state.sort);
}

// ─────────────── piezas ───────────────
/** Una portada: la ranura debajo cuando está enfocada. */
function card(g, prev) {
  const running = isRunning(g.id);
  const key = `${g.id}:${g.title}:${g.media.coverThumb}:${running}:${g.playtime}:${g.missing}`;
  if (prev && prev.__sig === key) return prev;
  const el = h(
    "button",
    {
      class: "card" + (g.missing ? " missing" : ""),
      "data-focus": "",
      "data-game-id": g.id,
      onclick: () => openGame(g.id),
      ondblclick: () => ejg.game.launch(g.id),
      title: g.title,
    },
    h("span", { class: "cover" }, artFor(g, "portrait"), running ? h("span", { class: "tag live" }, "En marcha") : null),
    h("span", { class: "t" }, g.title),
    h("span", { class: "m" }, g.playtime ? playtime(g.playtime, { short: true }) : "Sin jugar"),
  );
  el.__sig = key;
  return el;
}

/** Fila horizontal que se desliza (con flechas a los lados al pasar el ratón). */
function row(id, title, list, extra = null) {
  const box = h("div", { class: "row-items", "data-focus-group": `row-${id}` });
  keyed(box, list, (g) => `${id}-${g.id}`, card);
  const step = (d) => box.scrollBy({ left: d * box.clientWidth * 0.8, behavior: "smooth" });
  return h(
    "section",
    { class: "row" },
    h("div", { class: "sec-head" }, h("h2", null, title), extra),
    h(
      "div",
      { class: "row-wrap" },
      h("button", { class: "row-arrow l", onclick: () => step(-1), "aria-label": "Anterior", html: ICON.left }),
      box,
      h("button", { class: "row-arrow r", onclick: () => step(1), "aria-label": "Siguiente", html: ICON.right }),
    ),
  );
}

function grid(list, group = "grid") {
  const el = h("div", { class: "grid", "data-focus-group": group });
  keyed(el, list, (g) => g.id, card);
  if (!list.length) el.append(h("div", { class: "empty small" }, "No hay juegos aquí."));
  return el;
}

function sortButton() {
  return h(
    "button",
    {
      class: "chip drop",
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
  );
}

function emptyLibrary() {
  return h(
    "div",
    { class: "empty" },
    h("span", { class: "empty-coin" }),
    h("h2", null, "Tu biblioteca está vacía"),
    h("p", null, "Añade la carpeta donde tienes tus juegos: cada subcarpeta se convierte en un juego, con su arte y sus logros."),
    h("button", { class: "soft light lg", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "Añadir un juego"),
  );
}

/** El botón Jugar: el disco rojo del logo. */
function playButton(g, big = true) {
  const running = isRunning(g.id);
  const label = g.missing ? "No encontrado" : running ? "En marcha" : "Jugar";
  const btn = h(
    "button",
    {
      class: "play" + (big ? "" : " sm") + (running ? " running" : ""),
      "data-focus": "",
      id: big ? "play" : null,
      disabled: g.missing || null,
      onclick: async (e) => {
        e.stopPropagation();
        if (isRunning(g.id)) return;
        btn.classList.add("launching");
        btn.lastChild.textContent = "Iniciando…";
        try {
          await ejg.game.launch(g.id);
        } catch (err) {
          ejg.ui.toast(String(err.message || err), "error");
        }
        setTimeout(() => updatePlayButton(), 2500);
      },
    },
    h("i", { class: "disc" }),
    h("span", null, label),
  );
  return btn;
}

function updatePlayButton() {
  const old = $("#play");
  const g = state.gameId && ejg.library.byId(state.gameId);
  if (!old || !g) return;
  const was = focus.current === old;
  const nb = playButton(g);
  old.replaceWith(nb);
  if (was) focus.focus(nb, { noScroll: true, silent: true });
}

// ─────────────── Inicio ───────────────
const heroArt = (g) => g.media.hero || g.media.heroThumb || g.media.header || "";

function continueCard(g) {
  const recent = !!g.lastPlayed;
  const art = heroArt(g);
  const a = g.achievements;
  const logo = g.media.logo ? img(g.media.logo, { class: "hero-logo", loading: "eager" }) : h("h1", { class: "hero-title" }, g.title);
  if (logo instanceof HTMLImageElement) logo.addEventListener("error", () => logo.replaceWith(h("h1", { class: "hero-title" }, g.title)));
  return h(
    "section",
    { class: "hero", "data-focus-group": "hero" },
    art ? img(art, { class: "hero-art", loading: "eager" }) : null,
    h("div", { class: "hero-scrim" }),
    h(
      "div",
      { class: "hero-in" },
      h("span", { class: "pill" }, recent ? "Continuar" : "Para empezar"),
      logo,
      h("p", { class: "hero-meta" }, h("span", null, g.playtime ? `${playtime(g.playtime)} jugadas` : "Sin jugar"), g.lastPlayed ? " · " : null, g.lastPlayed ? h("span", null, relative(g.lastPlayed)) : null),
      h(
        "div",
        { class: "hero-acts" },
        playButton(g, false),
        a && a.total
          ? h("button", { class: "round glass ach-btn", "data-focus": "", title: "Logros", onclick: () => openGame(g.id) }, ring(a.unlocked / a.total, { size: 56, stroke: 6, label: `${a.unlocked}/${a.total}` }))
          : null,
        h("button", { class: "round glass", "data-focus": "", title: "Guías", onclick: () => openGuides(g.id), html: ICON.guide }),
        h("button", { class: "soft glass", "data-focus": "", onclick: () => openGame(g.id) }, "Ver ficha"),
      ),
    ),
  );
}

function renderHome() {
  const all = games();
  if (!all.length) return main.replaceChildren(h("div", { class: "page" }, emptyLibrary()));
  const rec = all.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
  const pick = rec[0] || all.find((g) => g.favorite) || all[0];
  const wrap = h("div", { class: "page home" }, continueCard(pick));
  if (ejg.settings.showRecent !== false) {
    const list = rec.filter((g) => g.id !== pick.id).slice(0, 16);
    if (list.length) wrap.append(row("recent", "Jugado hace poco", list, h("button", { class: "link", "data-focus": "", onclick: () => goTab("library") }, "Ver la biblioteca")));
  }
  const favs = sort(all.filter((g) => g.favorite), state.sort);
  if (favs.length) wrap.append(row("fav", "Favoritos", favs));
  for (const c of ejg.library.collections) {
    const list = inCollection(all, c);
    if (list.length) wrap.append(row(`c${c.id}`, c.name, sort(list, state.sort)));
  }
  const fresh = all.filter((g) => !g.lastPlayed && !g.playtime).slice(-16).reverse();
  if (fresh.length) wrap.append(row("new", "Sin jugar todavía", fresh));
  main.replaceChildren(wrap);
}

// ─────────────── Biblioteca ───────────────
function renderLibrary() {
  const all = games();
  if (!all.length && !hiddenGames().length) return main.replaceChildren(h("div", { class: "page" }, emptyLibrary()));
  const list = filtered();
  const chip = (k, label) =>
    h(
      "button",
      {
        class: "chip" + (state.chip === k ? " on" : ""),
        "data-focus": "",
        onclick: () => {
          state.chip = k;
          saveState();
          render();
        },
      },
      label,
    );
  const nFav = all.filter((g) => g.favorite).length;
  const nHidden = hiddenGames().length;
  main.replaceChildren(
    h(
      "div",
      { class: "page" },
      h(
        "div",
        { class: "head" },
        h("h1", null, state.filter ? "Resultados" : "Biblioteca"),
        h("span", { class: "count" }, `${state.filter ? list.length : all.length} juegos`),
        h("div", { class: "grow" }),
        sortButton(),
        h("button", { class: "chip", "data-focus": "", onclick: () => goPage("collections") }, svg("stack"), "Colecciones"),
        h("button", { class: "chip strong", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, svg("plus"), "Añadir juego"),
      ),
      h(
        "div",
        { class: "chips", "data-focus-group": "chips" },
        chip("all", CHIPS.all),
        chip("played", CHIPS.played),
        chip("unplayed", CHIPS.unplayed),
        nFav ? chip("fav", `${CHIPS.fav} · ${nFav}`) : null,
        nHidden ? chip("hidden", `${CHIPS.hidden} · ${nHidden}`) : null,
      ),
      grid(list),
    ),
  );
}

// ─────────────── Colecciones ───────────────
function renderCollections() {
  const all = games();
  const tiles = [];
  const favs = all.filter((g) => g.favorite);
  if (favs.length) tiles.push({ id: "fav", name: "Favoritos", smart: false, list: favs });
  for (const c of ejg.library.collections) tiles.push({ id: c.id, name: c.name, smart: c.kind === "smart", list: inCollection(all, c) });
  const tile = (t) =>
    h(
      "button",
      { class: "col", "data-focus": "", onclick: () => openCollection(t.id) },
      h("span", { class: "fan" }, ...t.list.slice(0, 3).map((g, i) => h("span", { class: `fan-c c${i}` }, artFor(g, "portrait")))),
      h("span", { class: "col-name" }, t.smart ? h("span", { class: "col-smart", html: ICON.spark, title: "Colección dinámica" }) : null, h("b", null, t.name), h("span", { class: "muted" }, String(t.list.length))),
    );
  main.replaceChildren(
    h(
      "div",
      { class: "page" },
      h(
        "div",
        { class: "head" },
        h("button", { class: "round fill", "data-focus": "", title: "Atrás", onclick: () => back(), html: ICON.back }),
        h("h1", null, "Colecciones"),
        h("div", { class: "grow" }),
        h("button", { class: "soft light", "data-focus": "", onclick: () => ejg.ui.open("collections") }, svg("plus"), "Nueva colección"),
      ),
      tiles.length
        ? h("div", { class: "cols", "data-focus-group": "cols" }, ...tiles.map(tile))
        : h("div", { class: "empty small" }, "Todavía no tienes colecciones. Agrupa tus juegos como quieras: a mano o con reglas (colecciones dinámicas)."),
    ),
  );
}

function renderCollection() {
  const c = collectionById(state.collection);
  if (!c) return goPage("collections");
  const list = sort(members(c), state.sort);
  main.replaceChildren(
    h(
      "div",
      { class: "page" },
      h(
        "div",
        { class: "head" },
        h("button", { class: "round fill", "data-focus": "", title: "Atrás", onclick: () => back(), html: ICON.back }),
        h("h1", null, c.name),
        h("span", { class: "count" }, String(list.length)),
        h("div", { class: "grow" }),
        sortButton(),
        c.kind !== "fav" ? h("button", { class: "chip", "data-focus": "", onclick: () => ejg.ui.open("collections") }, "Editar colección") : null,
      ),
      grid(list),
    ),
  );
}

// ─────────────── página de juego ───────────────
let heroRelease = () => {};
let trailer = null;
let detailsToken = 0;
const statsKey = (g) => `${g.id}|${g.playtime}|${g.lastPlayed}|${g.achievements?.unlocked}/${g.achievements?.total}`;
let renderedStats = "";
let renderedArt = "";
let achSlot = null;
let activitySlot = null;

function tiles(g) {
  const a = g.achievements;
  return [
    h("div", { class: "tile" }, h("span", { class: "lbl" }, "Tiempo de juego"), h("span", null, h("b", { class: "big" }, g.playtime ? playtime(g.playtime, { short: true }) : "—"), h("small", null, g.lastPlayed ? `Última sesión: ${relative(g.lastPlayed)}` : "Nunca"))),
    a && a.total
      ? h(
          "button",
          { class: "tile row-tile", "data-focus": "", onclick: () => main.querySelector(".ach")?.scrollIntoView({ behavior: "smooth", block: "center" }) },
          ring(a.unlocked / a.total, { size: 76, stroke: 9, label: percent(a.unlocked / a.total) }),
          h("span", null, h("span", { class: "lbl" }, "Logros"), h("b", { class: "big" }, `${a.unlocked}/${a.total}`)),
        )
      : null,
  ].filter(Boolean);
}

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

function loadAchievements(id, token) {
  ejg.game
    .achievements(id)
    .then((list) => {
      if (token !== detailsToken || !achSlot) return;
      achSlot.replaceChildren(...(list.total ? [achievementsCard(list)] : []));
    })
    .catch(() => {});
}

function renderActivity(d) {
  if (!activitySlot) return;
  const sessions = d.recentSessions || [];
  if (!sessions.length) return activitySlot.replaceChildren();
  const byDay = [];
  for (const s of sessions.slice(0, 10)) {
    const label = date(new Date(s.startedAt * 1000).toISOString());
    const last = byDay[byDay.length - 1];
    if (last && last.label === label) last.items.push(s);
    else byDay.push({ label, items: [s] });
  }
  activitySlot.replaceChildren(
    h(
      "div",
      { class: "card-box activity" },
      h("h3", null, "Actividad"),
      ...byDay.map((day) =>
        h("div", { class: "act-day" }, h("span", { class: "act-date" }, day.label), ...day.items.map((s) => h("div", { class: "act-item" }, h("span", null, `Has jugado ${playtime(s.duration)}`), h("small", null, relative(s.startedAt))))),
      ),
    ),
  );
}

async function refreshGameStats(g) {
  renderedStats = statsKey(g);
  $(".g-tiles")?.replaceChildren(...tiles(g), howLongNote(g));
  const token = detailsToken;
  loadAchievements(g.id, token);
  const d = await ejg.game.details(g.id).catch(() => null);
  if (d && token === detailsToken) renderActivity(d);
}

function hiddenNote(g) {
  const note = h(
    "div",
    { class: "note", "data-focus-group": "hidden-note" },
    h("span", { class: "dot" }),
    h("span", null, h("b", null, "Este juego está oculto."), " No sale en tu biblioteca; solo en el filtro «Ocultos»."),
    h(
      "button",
      {
        class: "soft",
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
  const art = heroArt(g);
  const band = h(
    "div",
    { class: "g-band" },
    art ? img(art, { class: "g-band-img", loading: "eager" }) : null,
    h("button", { class: "round glass g-back", "data-focus": "", title: "Atrás", onclick: () => back(), html: ICON.back }),
  );
  const meta = h("p", { class: "g-meta" }, SOURCE_LABEL[g.source] || "");
  const head = h(
    "div",
    { class: "g-head", "data-focus-group": "g-head" },
    h("span", { class: "g-cover" }, artFor(g, "portrait")),
    h("div", { class: "g-title" }, h("h1", null, g.title), meta),
    h(
      "div",
      { class: "g-acts" },
      playButton(g),
      h("button", { class: "round fill fav" + (g.favorite ? " on" : ""), "data-focus": "", title: "Favorito (Y)", onclick: () => ejg.game.favorite(g.id), html: ICON.star }),
      h("button", { class: "round fill", "data-focus": "", title: "Administrar", onclick: (e) => manageMenu(e.currentTarget, ejg.library.byId(g.id) || g), html: ICON.more }),
    ),
  );
  const link = (label, fn, on = false) => h("button", { class: "tab" + (on ? " on" : ""), "data-focus": "", onclick: fn }, label);
  const gnav = h(
    "nav",
    { class: "g-nav", "data-focus-group": "gnav" },
    link("Resumen", () => main.scrollTo({ top: 0, behavior: "smooth" }), true),
    link("Logros", () => main.querySelector(".ach")?.scrollIntoView({ behavior: "smooth", block: "center" })),
    link("Guías", () => openGuides(g.id)),
    link("Trucos", () => ejg.trainer.open(g.id)),
    link("Mapa", () => ejg.maps.open(g.id)),
    link("Propiedades", () => ejg.game.edit(g.id)),
  );
  const left = h("div", { class: "g-left" }, h("div", { class: "card-box" }, h("h3", null, "Acerca del juego"), h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel", style: { width: "60%" } })));
  achSlot = h("div");
  activitySlot = h("div");
  const guideSlot = h("div");
  const right = h("div", { class: "g-right" }, achSlot, guideSlot);
  const bg = ejg.settings.blurHero !== false && art ? h("div", { class: "g-bg", style: { backgroundImage: `url("${g.media.heroThumb || art}")` } }) : null;
  main.replaceChildren(
    h(
      "div",
      { class: "page game" },
      bg,
      band,
      head,
      g.hidden ? hiddenNote(g) : null,
      repackUpdateNote(g),
      emulatorNote(g),
      gnav,
      h("div", { class: "g-tiles" }, ...tiles(g), howLongNote(g)),
      h("div", { class: "g-body" }, left, right),
    ),
  );
  main.scrollTop = 0;
  focus.focus($("#play"), { instant: true, silent: true });

  if (ejg.settings.autoTrailer && g.media.microtrailer) {
    const v = h("video", { muted: true, loop: true, playsInline: true, class: "g-band-img" });
    v.muted = true;
    band.prepend(v);
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
    left.replaceChildren(h("div", { class: "card-box" }, h("h3", null, "Error"), h("p", null, String(e.message || e))));
    return;
  }
  if (token !== detailsToken) return;
  meta.textContent = [d.developer, year(d.releaseDate), (d.genres || [])[0]].filter(Boolean).join(" · ") || SOURCE_LABEL[d.source] || "";

  left.replaceChildren();
  if (d.metaStatus === "review" || d.metaStatus === "failed") {
    left.append(
      h(
        "div",
        { class: "note" },
        h("span", { class: "dot" }),
        h("span", null, d.metaStatus === "failed" ? "No hemos encontrado información de este juego." : "¿No es este juego? La identificación automática no está segura."),
        h("button", { class: "soft", "data-focus": "", onclick: () => ejg.game.edit(g.id) }, "Corregir"),
      ),
    );
  }
  left.append(activitySlot);
  renderActivity(d);
  if (d.description || d.shortDescription) {
    const desc = h("div", { class: "desc" });
    desc.append(description(d.description || d.shortDescription));
    const box = h("div", { class: "card-box" }, h("h3", null, "Acerca del juego"), desc);
    left.append(box);
    requestAnimationFrame(() => {
      if (desc.scrollHeight > 260) {
        desc.classList.add("clamp");
        const more = h("button", { class: "link", "data-focus": "", onclick: () => (desc.classList.remove("clamp"), more.remove()) }, "Leer más");
        box.append(more);
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
          { class: "shot", "data-focus": "", onclick: () => (trailer?.destroy(), (trailer = trailerPlayer(box, t, { autoplay: true }))) },
          t.poster ? img(t.poster) : null,
          h("span", { class: "shot-play", html: ICON.play }),
        ),
      );
      if (i === 0 && t.poster) box.append(img(t.poster, { style: "width:100%;height:100%;object-fit:cover" }));
    });
    left.append(h("div", { class: "card-box" }, h("h3", null, "Tráileres"), box, list));
  }
  if (d.screenshots.length) {
    const shots = h("div", { class: "shots", "data-focus-group": "shots" });
    d.screenshots.forEach((s, i) => shots.append(h("button", { class: "shot", "data-focus": "", onclick: () => openLightbox(d.screenshots, i) }, img(s.thumb || s.url))));
    left.append(h("div", { class: "card-box" }, h("h3", null, "Capturas", h("span", { class: "muted" }, ` ${d.screenshots.length}`)), shots));
  }

  loadAchievements(id, token);
  loadGuidesCard(id, token, guideSlot);

  const rows = [
    ["Desarrollador", d.developer],
    ["Editor", d.publisher],
    ["Fecha de lanzamiento", date(d.releaseDate)],
    ["Origen", SOURCE_LABEL[d.source] || d.source],
    ["Valoración", d.rating ? `${d.rating} %` : null],
    ["Veces jugado", d.launchCount || null],
  ].filter((r) => r[1]);
  right.append(h("div", { class: "card-box info" }, h("h3", null, "Información"), ...rows.map(([k, v]) => h("div", { class: "info-row" }, h("span", null, k), h("span", null, String(v))))));
  const tags = [...new Set([...(d.genres || []), ...(d.tags || [])])].slice(0, 14);
  if (tags.length) right.append(h("div", { class: "card-box" }, h("h3", null, "Etiquetas"), h("div", { class: "tags" }, ...tags.map((t) => h("span", { class: "tag-pill" }, t)))));
}

// ─────────────── guías de la comunidad ───────────────
let guideView = null;
let guideRoot = null;

function openGuides(gameId, guideId = null) {
  pushPage("guides", { gameId, guideId });
  render();
}

function renderGuides() {
  if (guideView && guideRoot?.isConnected && guideRoot.dataset.game === String(state.gameId)) return;
  dropGuides();
  const g = ejg.library.byId(state.gameId);
  if (!g) return back();
  const art = heroArt(g);
  guideRoot = h("div", { class: "guides-body", "data-game": g.id });
  main.replaceChildren(
    h(
      "div",
      { class: "page guides-page" },
      art ? h("div", { class: "g-bg", style: { backgroundImage: `url("${art}")` } }) : null,
      h(
        "div",
        { class: "head" },
        h("button", { class: "round fill", "data-focus": "", title: "Atrás", onclick: () => back(), html: ICON.back }),
        h("div", { class: "guides-title" }, h("span", { class: "muted" }, g.title), h("h1", null, "Guías")),
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

async function loadGuidesCard(id, token, slot) {
  const [shelf, list] = await Promise.all([ejg.guides.shelf(id).catch(() => null), ejg.guides.list(id, {}).catch(() => null)]);
  if (token !== detailsToken || !list || list.appid == null) return;
  const mine = [...(shelf?.pinned || []).slice(0, 2).map((x) => [x, "saved"]), ...(shelf?.recent || []).slice(0, 1).map((x) => [x, "recent"])];
  const top = list.items.filter((x) => !mine.some(([m]) => m.id === x.id)).slice(0, Math.max(1, 4 - mine.length));
  const sub = (it, kind) =>
    kind === "saved" ? "★ Guardada" : kind === "recent" ? `Seguir leyendo${it.progress ? ` · sección ${it.progress.section + 1}` : ""}` : [starsText(it.stars), it.author].filter(Boolean).join(" · ");
  const entry = (it, kind) =>
    h(
      "button",
      { class: "guide-row" + (kind ? " is-" + kind : ""), "data-focus": "", onclick: () => openGuides(id, it.id) },
      it.preview ? img(it.preview) : h("span", { class: "guide-ph", html: ICON.guide }),
      h("span", { class: "guide-txt" }, h("b", null, it.title), h("small", null, sub(it, kind))),
    );
  const rows = [...mine.map(([x, kind]) => entry(x, kind)), ...top.map((x) => entry(x, null))];
  if (!rows.length) return;
  slot.replaceChildren(
    h(
      "div",
      { class: "card-box guides-card", "data-focus-group": "guides-card" },
      h("h3", null, "Guías de la comunidad", list.total ? h("span", { class: "muted" }, ` ${list.total.toLocaleString(ejg.locale)}`) : null),
      ...rows,
      h("button", { class: "link", "data-focus": "", onclick: () => openGuides(id) }, "Ver todas las guías"),
    ),
  );
}

// ─────────────── logros ───────────────
function achTile(a) {
  const on = !!a.unlockedAt;
  const src = on ? a.icon : a.iconGray || a.icon;
  const tip = [a.name, a.description, on ? `Desbloqueado ${date(new Date(a.unlockedAt * 1000).toISOString())}` : a.globalPct != null ? `${a.globalPct.toFixed(1)} % de jugadores` : ""].filter(Boolean).join("\n");
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
  const done = list.items.filter((a) => a.unlockedAt).sort((a, b) => b.unlockedAt - a.unlockedAt);
  const locked = list.items.filter((a) => !a.unlockedAt).sort((a, b) => (b.globalPct ?? -1) - (a.globalPct ?? -1));
  const all = h("div", { class: "ach-list", hidden: true, "data-focus-group": "achievements" }, ...[...done, ...locked].map(achRow));
  const icons = (arr, max) => {
    const out = arr.slice(0, max).map(achTile);
    if (arr.length > max) out.push(h("div", { class: "ach-tile more-n" }, `+${arr.length - max}`));
    return out;
  };
  const more = h(
    "button",
    {
      class: "soft wide",
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
    { class: "card-box ach" },
    h("div", { class: "ach-head" }, ring(list.total ? list.unlocked / list.total : 0, { size: 52, stroke: 9 }), h("div", null, h("h3", null, "Logros"), h("span", { class: "muted" }, `Has desbloqueado ${list.unlocked}/${list.total} `))),
    done.length ? h("div", { class: "ach-icons" }, ...icons(done, 7)) : null,
    locked.length ? h("div", { class: "ach-sub" }, "Logros bloqueados") : null,
    locked.length ? h("div", { class: "ach-icons" }, ...icons(locked, 7)) : null,
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

// ─────────────── Homebrew ───────────────
let hbView = null;
let hbRoot = null;
function renderHomebrew() {
  if (hbView && hbRoot?.isConnected) return;
  dropHomebrew();
  hbRoot = h("div", { class: "hb-page" });
  main.replaceChildren(h("div", { class: "page hb-wrap" }, hbRoot));
  main.scrollTop = 0;
  hbView = createHomebrewView({ ejg, root: hbRoot, focus, layout: "steam", onExit: () => false, onChange: () => updateHints(), onGame: (g) => openGame(g.id) });
}
function dropHomebrew() {
  hbView?.destroy();
  hbView = null;
  hbRoot = null;
}

// ─────────────── navegación ───────────────
function stopMedia() {
  dropGuides();
  dropHomebrew();
  heroRelease();
  heroRelease = () => {};
  trailer?.destroy();
  trailer = null;
}

/** Entra en una página recordando la actual para «Atrás». */
function pushPage(page, extra = {}) {
  if (!isShop()) state.prev.push({ page: state.page, from: state.from, gameId: state.gameId, collection: state.collection, scroll: main.scrollTop });
  if (state.prev.length > 30) state.prev.shift();
  stopMedia();
  state.from = activeTab();
  state.page = page;
  Object.assign(state, extra);
}

function openGame(id) {
  if (state.page === "game" && state.gameId === id) return;
  pushPage("game", { gameId: id });
  ejg.storage.set("last", id);
  render();
}
function openCollection(id) {
  pushPage("collection", { collection: id, gameId: null });
  render();
  focus.first(main);
}
function goPage(page) {
  pushPage(page, { gameId: null });
  render();
  main.scrollTop = 0;
  focus.first(main);
}

function back() {
  if (!lightbox.hidden) return closeLightbox(), true;
  if (closeMenu()) return true;
  if (inHomebrew() && hbView.nav("back")) return true;
  if (inGuides() && guideView.mode === "reader") return guideView.nav("back");
  if (isShop() && shop.back()) return true;
  if (state.page === "downloads") return goTab("store"), true;
  const p = state.prev.pop();
  if (!p) {
    if (["home", "library", "homebrew", "store"].includes(state.page)) return false;
    goTab("home");
    return true;
  }
  const last = state.gameId;
  stopMedia();
  Object.assign(state, { page: p.page, from: p.from, gameId: p.gameId, collection: p.collection });
  render();
  main.scrollTop = p.scroll || 0;
  const el = last && main.querySelector(`[data-game-id="${last}"]`);
  if (el) focus.focus(el, { silent: true });
  else focus.first(main);
  ejg.sound.play("back");
  return true;
}

function tabList() {
  return ["home", "library", ...(ejg.explore.enabled ? ["store"] : []), "homebrew"];
}
/** La pestaña encendida (la ranura roja). */
function activeTab() {
  if (state.page === "downloads") return "store";
  if (["home", "library", "store", "homebrew"].includes(state.page)) return state.page;
  if (state.page === "collections" || state.page === "collection") return "library";
  const g = state.page === "game" && ejg.library.byId(state.gameId);
  if (g && (isRom(g) || isSoftware(g))) return "homebrew";
  return state.from || "library";
}
/** Las pestañas empiezan un historial nuevo (y vacían el buscador, salvo `keepSearch`). */
function goTab(t, keepSearch = false) {
  if (!keepSearch && document.activeElement !== searchBox) {
    searchBox.value = "";
    state.filter = "";
  }
  stopMedia();
  closeMenu(true);
  state.prev = [];
  state.page = t;
  state.from = t === "downloads" ? "store" : t;
  state.gameId = null;
  state.collection = null;
  if (t === "store" && !keepSearch) shop.home();
  render();
  main.scrollTop = 0;
  // Escribiendo en el buscador, el foco se queda en él.
  if (document.activeElement !== searchBox) focus.first(main);
}
function switchTab(d) {
  const tabs = tabList();
  const cur = tabs.indexOf(activeTab());
  goTab(tabs[(cur + d + tabs.length) % tabs.length]);
}

function renderTabs() {
  const on = activeTab();
  searchBox.placeholder = isShop() ? "Buscar en la tienda" : "Buscar en tu biblioteca";
  document.querySelectorAll(".tab[data-tab]").forEach((t) => {
    t.classList.toggle("on", t.dataset.tab === on);
    t.setAttribute("aria-selected", String(t.dataset.tab === on));
  });
}

function render() {
  renderTabs();
  document.documentElement.dataset.view = state.page;
  updateHints();
  updateDownloadsUi();
  if (isShop()) return shop.render();
  if (state.page === "game") renderGame(state.gameId);
  else if (state.page === "guides") renderGuides();
  else if (state.page === "homebrew") renderHomebrew();
  else if (state.page === "collections") renderCollections();
  else if (state.page === "collection") renderCollection();
  else if (state.page === "library") renderLibrary();
  else renderHome();
  if (focus.current && !focus.current.isConnected) {
    const id = focus.current.dataset?.gameId;
    const again = id && document.querySelector(`[data-game-id="${id}"]`);
    if (again) focus.focus(again, { noScroll: true, silent: true });
    else focus.reset();
  }
}

document.querySelectorAll(".tab[data-tab]").forEach((t) => t.addEventListener("click", () => goTab(t.dataset.tab)));
// El logo: a Inicio.
$("#brand").addEventListener("click", () => goTab("home"));

// ─────────────── el buscador de arriba: uno para todo ───────────────
// Con la tienda abierta busca en la tienda; en lo demás, en tu biblioteca.
function runSearch(now = false) {
  const q = searchBox.value.trim();
  if (isShop()) {
    if (state.page === "downloads") goTab("store", true);
    return shop.query(q, now);
  }
  state.filter = q;
  if (state.page !== "library") goTab("library", true);
  else render();
}
const searchSoon = debounce(() => runSearch(), 90);
searchBox.addEventListener("input", searchSoon);
searchBox.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    runSearch(true);
    if (!isShop()) {
      const first = filtered()[0];
      if (first) openGame(first.id);
    }
  }
  if (e.key === "Escape") {
    searchBox.value = "";
    searchBox.blur();
    runSearch(true);
  }
});
// «/» lleva al buscador (si no se está escribiendo ya en otro sitio).
window.addEventListener("keydown", (e) => {
  if (e.key !== "/" || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
  e.preventDefault();
  searchBox.focus();
});

// ─────────────── descargas: el anillo de la barra ───────────────
const dlBtn = $("#dl-btn");
dlBtn.addEventListener("click", () => goTab("downloads"));
function updateDownloadsUi() {
  $("#tab-store").hidden = !ejg.explore.enabled;
  const all = ejg.downloads.all;
  const now = all.filter((d) => d.state === "downloading" || d.state === "installing");
  const ready = all.filter((d) => ["seeding", "completed"].includes(d.state)).length;
  const queued = all.filter((d) => d.state === "queued" || d.state === "paused").length;
  const total = now.reduce((a, d) => ({ d: a.d + d.doneBytes, t: a.t + d.totalBytes, s: a.s + d.downBps }), { d: 0, t: 0, s: 0 });
  const pct = total.t ? total.d / total.t : 0;
  dlBtn.classList.toggle("busy", now.length > 0);
  dlBtn.classList.toggle("ready", !now.length && ready > 0);
  dlBtn.classList.toggle("on", state.page === "downloads");
  dlBtn.style.setProperty("--p", String(now.length ? Math.max(2, pct * 100) : ready ? 100 : 0));
  dlBtn.title = now.length
    ? `${now[0].title} · ${percent(pct)} · ${speed(total.s)}`
    : ready
      ? `${ready} ${ready === 1 ? "lista" : "listas"} para instalar`
      : queued
        ? `${queued} en cola`
        : "Descargas";
}
ejg.explore.onEnabled(() => {
  if (!ejg.explore.enabled && isShop()) goTab("library");
  else updateDownloadsUi();
});
ejg.ui.onView(({ view, slug, gameId, guideId }) => {
  if (view === "guides" && gameId) return openGuides(gameId, guideId);
  if (view === "downloads") return goTab("downloads");
  if (!ejg.explore.enabled) return;
  goTab("store");
  if (view === "repack" && slug) shop.openRepack(slug);
});
document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => ejg.ui.open(b.dataset.action === "add" ? "add-folder" : b.dataset.action)));
document.querySelector('[data-win="min"]').onclick = () => ejg.window.minimize();
document.querySelector('[data-win="max"]').onclick = () => ejg.window.maximize();
document.querySelector('[data-win="close"]').onclick = () => ejg.window.close();

// ─────────────── tu perfil ───────────────
const acctBtn = $("#acct-btn");
function me() {
  const p = ejg.profile;
  const c = ejg.profiles.me;
  return { name: c?.name || p?.name || "", url: c?.avatarUrl || p?.avatar || "", color: p?.color || "" };
}
function avatarOf({ name, url, color }, cls) {
  const el = h("span", { class: cls });
  el.textContent = url ? "" : (name || "?")[0].toUpperCase();
  el.style.backgroundImage = url ? `url("${url}")` : "";
  el.style.backgroundColor = url ? "" : color;
  return el;
}
function renderProfile() {
  const m = me();
  $("#avatar").replaceWith(Object.assign(avatarOf(m, "avatar"), { id: "avatar" }));
  acctBtn.title = m.name;
}
acctBtn.addEventListener("click", () => {
  const m = me();
  const head = h("div", { class: "acct-head" }, avatarOf(m, "acct-av"), h("b", { class: "acct-name" }, m.name));
  openMenu(acctBtn, [{ node: head }, "-", { label: "Editar perfil", run: () => ejg.profiles.edit() }, { label: "Cambiar de perfil…", run: () => ejg.ui.open("profiles") }], { cls: "acct-menu", first: true });
});

function renderWallpaper() {
  const w = $("#wallpaper");
  const url = ejg.season.event?.wallpaperVideo || ejg.settings.wallpaper;
  w.replaceChildren();
  w.classList.toggle("custom", !!url);
  if (url && /\.(mp4|webm)$/i.test(url)) {
    const v = h("video", { autoplay: true, muted: true, loop: true, playsInline: true, src: url });
    v.muted = true;
    w.append(v);
  }
}

// ─────────────── eventos del host ───────────────
const rerender = debounce(() => {
  if (isShop()) return updateDownloadsUi();
  if (state.page === "guides" || state.page === "homebrew") return;
  if (state.page === "game") {
    updatePlayButton();
    const g = ejg.library.byId(state.gameId);
    if (!g) return back();
    if (`${g.id}|${g.media.hero}|${g.media.logo}` !== renderedArt) {
      const top = main.scrollTop;
      renderGame(g.id).then(() => (main.scrollTop = top));
      return;
    }
    main.querySelector(".g-acts .fav")?.classList.toggle("on", g.favorite);
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
ejg.season?.onChange(() => renderWallpaper());
ejg.on("profile", renderProfile);
ejg.profiles.onChange(renderProfile);

const hintBar = hints(document.getElementById("hints"), []);
function updateHints() {
  hintBar.set(
    state.page === "store"
      ? [["accept", "Abrir"], ["y", "Buscar"], ["back", "Volver"], ["lb", "Pestañas"], ["menu", "Menú"]]
      : state.page === "downloads"
        ? [["accept", "Elegir"], ["back", "Volver"], ["lb", "Pestañas"]]
        : state.page === "homebrew" && hbView
          ? hbView.hints()
          : state.page === "guides" && guideView
            ? guideView.hints()
            : state.page === "game"
              ? [["accept", "Elegir"], ["back", "Atrás"], ["y", "Favorito"], ["x", "Propiedades"]]
              : [["accept", "Abrir"], ["y", "Favorito"], ["x", "Propiedades"], ["lb", "Pestañas"], ["menu", "Menú"]],
  );
}

renderProfile();
renderWallpaper();
render();
if (saved.last && ejg.library.byId(saved.last) && ejg.mode === "tv") openGame(saved.last);
focus.first(main) || focus.first();
