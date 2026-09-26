// Tema "Xbox": inicio con filas de mosaicos, "Mi colección" con filtros y
// ficha de juego a pantalla completa.

import { h, img, hueOf, keyed, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { createBackdrop, attachStream } from "/_sdk/kit/media.js";
import { playtime, relative, year, description, SOURCE_LABEL } from "/_sdk/kit/format.js";
import { visible, sort, recent, favorites, byGenre, inCollection, SORTS } from "/_sdk/kit/library.js";
import { clock } from "/_sdk/kit/clock.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";

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
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1m0-14.2-2.1 2.1m-10 10-2.1 2.1"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
};

const games = () => visible(ejg.library.all);
const installedGames = () => {
  const inst = games().filter((g) => g.installed !== false);
  return inst.length ? inst : games();
};
const running = (id) => ejg.game.isRunning(id);

function tile(g, wide, prev) {
  const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}:${g.media.logo}:${wide}:${running(g.id)}:${g.installed}`;
  if (prev && prev.__sig === sig) return prev;
  const el = h(
    "button",
    { class: "tile" + (wide ? " wide" : "") + (g.installed === false ? " uninstalled" : ""), "data-focus": "", "data-game-id": g.id, onclick: () => openHub(g.id), title: g.title },
    artFor(g, wide ? "landscape" : "square"),
    running(g.id) ? h("span", { class: "run" }, "EN JUEGO") : null,
    g.installed === false ? h("span", { class: "dl", html: ICON.download }) : null,
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
  const all = installedGames();
  if (!all.length) {
    home.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("h1", null, "Empieza tu colección"),
        h("p", null, "Añade la carpeta donde tienes juegos o importa los de tus tiendas instaladas."),
        h("button", { class: "btn primary", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "Añadir juegos"),
      ),
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
  const addTile = h("button", { class: "tile special", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, h("span", { html: ICON.plus }), h("b", null, "Añadir juegos"), h("small", null, "Carpetas y tiendas"));
  const rows = [row(rec.length ? "Continuar jugando" : "Añadidos recientemente", jump, { first: "wide", cls: "hero-row", extra: [colTile, addTile] })];
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

// ─────────────── colección ───────────────
function renderCollection() {
  const all = games();
  const opts = [
    ["all", "Todos", all.length],
    ["installed", "Instalados", all.filter((g) => g.installed !== false).length],
    ["uninstalled", "Sin instalar", all.filter((g) => g.installed === false).length],
    ["fav", "Favoritos", all.filter((g) => g.favorite).length],
    ["played", "Jugados", all.filter((g) => g.playtime).length],
    ["new", "Sin jugar", all.filter((g) => !g.playtime).length],
    ...ejg.library.collections.map((c) => [`c${c.id}`, c.name, inCollection(all, c).length]),
  ];
  $("#filters").replaceChildren(
    ...opts.map(([k, l, n], i) =>
      h(
        "button",
        { class: "filter" + (i === 6 ? " sep" : ""), "data-focus": "", "aria-pressed": String(state.filter === k), onclick: () => ((state.filter = k), renderCollection()) },
        h("span", null, l),
        h("span", null, n),
      ),
    ),
    h("button", { class: "filter sep", "data-focus": "", onclick: () => ejg.ui.open("collections") }, h("span", null, "+ Colecciones"), h("span")),
  );
  let list = all;
  if (state.filter === "fav") list = all.filter((g) => g.favorite);
  else if (state.filter === "installed") list = all.filter((g) => g.installed !== false);
  else if (state.filter === "uninstalled") list = all.filter((g) => g.installed === false);
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
  const install = g.installed === false;
  const playBtn = h(
    "button",
    { class: "btn primary" + (install ? " install" : ""), "data-focus": "", id: "play", onclick: () => launch(g.id) },
    h("span", { html: install ? ICON.download : ICON.play }),
    running(g.id) ? "En juego" : install ? "Instalar" : "Jugar",
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
    ),
    h(
      "div",
      { class: "hub-stats" },
      h("div", { class: "hstat" }, h("small", null, "Tiempo de juego"), h("b", null, playtime(g.playtime, "—"))),
      h("div", { class: "hstat" }, h("small", null, "Última vez"), h("b", null, relative(g.lastPlayed))),
      g.achievements ? h("div", { class: "hstat" }, h("small", null, "Logros"), h("b", null, `${g.achievements.unlocked} / ${g.achievements.total}`)) : null,
      h("div", { class: "hstat" }, h("small", null, "Tienda"), h("b", null, SOURCE_LABEL[g.source] || g.source)),
    ),
    h("div", { class: "hub-desc", id: "desc" }, g.shortDescription || ""),
  );
  const mediaRow = h("div", { class: "hub-media", "data-focus-group": "media" });
  hub.replaceChildren(h("div", { class: "hub-bg", style: heroUrl ? { backgroundImage: `url("${heroUrl}")` } : {} }), content, mediaRow);
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
  if (b) b.lastChild.textContent = ejg.library.byId(id)?.installed === false ? "Abriendo la tienda…" : "Iniciando…";
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
function openImage(url) {
  player.replaceChildren(img(url, { loading: "eager" }));
  player.hidden = false;
}
function closePlayer() {
  release();
  release = () => {};
  player.replaceChildren();
  player.hidden = true;
}
player.addEventListener("click", (e) => e.target === player && closePlayer());

// ─────────────── vistas y foco ───────────────
function setView(v) {
  state.view = v;
  document.querySelectorAll(".navbtn").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  $("#home").hidden = v !== "home";
  $("#collection").hidden = v !== "collection";
  if (v === "home") {
    renderHome();
    focus.first(home);
  } else {
    renderCollection();
    focus.first($("#grid")) || focus.first($("#filters"));
  }
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
  onChange: (el) => {
    const id = Number(el.dataset.gameId);
    if (id && hub.hidden) updateBg(ejg.library.byId(id));
  },
});
bindNav(focus, {
  back: () => {
    if (!player.hidden) return closePlayer(), true;
    if (!hub.hidden) return closeHub(), true;
    if (state.view !== "home") return setView("home"), true;
    return false;
  },
  y: () => {
    const id = state.hubId || Number(focus.current?.dataset.gameId);
    if (id) ejg.game.favorite(id);
    return true;
  },
  x: () => {
    const id = state.hubId || Number(focus.current?.dataset.gameId);
    if (id) ejg.game.edit(id);
    return true;
  },
  menu: () => (ejg.ui.open("menu"), true),
  view: () => (ejg.ui.open("search"), true),
  lb: () => (hub.hidden ? setView(state.view === "home" ? "collection" : "home") : null, true),
  rb: () => (hub.hidden ? setView(state.view === "home" ? "collection" : "home") : null, true),
});
ejg.on("focus-return", () => focus.restore());

const hintBar = hints($("#hints"), []);
function updateHints() {
  hintBar.set(
    !hub.hidden
      ? [["accept", "Elegir"], ["back", "Volver"], ["y", "Anclar"], ["x", "Gestionar"]]
      : [["accept", "Abrir"], ["y", "Anclar"], ["x", "Gestionar"], ["lb", "Inicio / Colección"], ["menu", "Menú"]],
  );
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

const refresh = debounce(() => {
  renderProfile();
  if (!hub.hidden && state.hubId) {
    const g = ejg.library.byId(state.hubId);
    const p = $("#play");
    if (g && p) {
      p.classList.toggle("running", running(g.id));
      p.lastChild.textContent = running(g.id) ? "En juego" : g.installed === false ? "Instalar" : "Jugar";
      const f = $("#fav");
      f.classList.toggle("on", g.favorite);
      f.lastChild.textContent = g.favorite ? "Anclado" : "Anclar";
    }
  }
  if (state.view === "home") renderHome();
  else renderCollection();
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
