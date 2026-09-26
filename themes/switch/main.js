// Tema "Switch": fila de iconos grandes, botones redondos y panel de opciones.

import { h, img, initials, hueOf, keyed, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { attachStream } from "/_sdk/kit/media.js";
import { playtime, relative, year, description, SOURCE_LABEL } from "/_sdk/kit/format.js";
import { visible, sort, recent, installedFirst } from "/_sdk/kit/library.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";
import { clock } from "/_sdk/kit/clock.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const rail = $("#rail");
const options = $("#options");
const state = { view: "home", optionsFor: null };
clock($("#clock"));

const games = () => visible(ejg.library.all);
function railGames() {
  const inst = games().filter((g) => g.installed !== false);
  const all = inst.length ? inst : games();
  const rec = recent(all, 30);
  const ids = new Set(rec.map((g) => g.id));
  return [...rec, ...sort(all.filter((g) => !ids.has(g.id)), "added")].slice(0, 14);
}

function art(g) {
  return h("div", { class: "art" }, artFor(g, "square"));
}

function stile(g, prev) {
  const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}:${g.favorite}:${ejg.game.isRunning(g.id)}:${g.installed}`;
  if (prev && prev.__sig === sig) return prev;
  const el = h(
    "button",
    { class: "stile" + (g.installed === false ? " uninstalled" : ""), "data-focus": "", "data-game-id": g.id, onclick: () => launch(g.id), title: g.title },
    art(g),
    g.favorite ? h("span", { class: "fav" }, "★") : null,
    g.installed === false ? h("span", { class: "dl" }, "⤓") : null,
    ejg.game.isRunning(g.id) ? h("span", { class: "run" }, "En juego") : null,
  );
  el.__sig = sig;
  return el;
}

let allTile;
function renderRail() {
  const list = railGames();
  keyed(rail, list, (g) => g.id, stile);
  allTile ||= h(
    "button",
    { class: "stile allsw", "data-focus": "", onclick: () => setView("all") },
    h("div", { class: "art", html: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span>Todos los programas</span>' }),
  );
  rail.append(allTile);
  if (!list.length) $("#sel-title").textContent = "Pulsa + para añadir tus juegos";
}

function renderAll() {
  const list = installedFirst(sort(games(), "title"));
  $("#all-count").textContent = `${list.length} programas`;
  keyed($("#all-grid"), list, (g) => g.id, (g, prev) => {
    const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}:${g.favorite}:${g.installed}`;
    if (prev && prev.__sig === sig) return prev;
    const tile = stile(g);
    const el = h("div", { class: "item" }, tile, h("div", { class: "name" }, g.title));
    el.__sig = sig;
    return el;
  });
  if (!list.length) $("#all-grid").replaceChildren(h("div", { class: "empty" }, "Aún no hay juegos."));
}

async function launch(id) {
  if (ejg.game.isRunning(id)) return;
  try {
    await ejg.game.launch(id);
  } catch (e) {
    ejg.ui.toast(String(e.message || e), "error");
  }
}

// ─────────────── panel de opciones (X) ───────────────
let releaseVideo = () => {};
async function openOptions(id) {
  const g = ejg.library.byId(id);
  if (!g) return;
  state.optionsFor = id;
  state.returnTo = focus.current;
  const cover = h("div", { class: "cover" }, (g.media.heroThumb || g.media.header) ? img(g.media.heroThumb || g.media.header, { loading: "eager" }) : null);
  const item = (label, fn) => h("button", { class: "mi", "data-focus": "", onclick: fn }, label);
  const panel = h(
    "div",
    { class: "panel", "data-focus-trap": "" },
    cover,
    h("h2", null, g.title),
    h("div", { class: "sub" }, [g.developer, year(g.releaseDate), SOURCE_LABEL[g.source]].filter(Boolean).join(" · ")),
    h(
      "div",
      { class: "stats" },
      h("div", { class: "stat" }, h("small", null, "Tiempo de juego"), h("b", null, playtime(g.playtime, "—"))),
      h("div", { class: "stat" }, h("small", null, "Última vez"), h("b", null, relative(g.lastPlayed))),
      g.achievements ? h("div", { class: "stat" }, h("small", null, "Logros"), h("b", null, `${g.achievements.unlocked} / ${g.achievements.total}`)) : null,
    ),
    h(
      "div",
      { class: "menu" },
      item(ejg.game.isRunning(g.id) ? "En juego" : g.installed === false ? "Instalar desde la tienda" : "Iniciar", () => (closeOptions(), launch(g.id))),
      item(g.favorite ? "Quitar de favoritos" : "Añadir a favoritos", () => (ejg.game.favorite(g.id), closeOptions())),
      item("Ver tráiler", () => playTrailer(g.id, cover)),
      item("Editar datos del programa", () => (closeOptions(), ejg.game.edit(g.id))),
      item("Abrir carpeta", () => ejg.game.openFolder(g.id)),
    ),
    h("div", { class: "desc", id: "opt-desc" }, g.shortDescription || ""),
  );
  options.replaceChildren(panel);
  options.hidden = false;
  focus.first(panel);
  ejg.sound.play("open");
  const d = await ejg.game.details(id).catch(() => null);
  if (d?.description && state.optionsFor === id) $("#opt-desc").replaceChildren(description(d.description.split("\n\n").slice(0, 5).join("\n\n")));
}

async function playTrailer(id, box) {
  const d = await ejg.game.details(id).catch(() => null);
  const t = d?.trailers?.[0];
  if (!t) return ejg.ui.toast("Este juego no tiene tráiler");
  const v = h("video", { autoplay: true, controls: true, playsInline: true });
  box.replaceChildren(v);
  releaseVideo = await attachStream(v, t.url);
}

function closeOptions() {
  releaseVideo();
  releaseVideo = () => {};
  options.hidden = true;
  options.replaceChildren();
  state.optionsFor = null;
  if (state.returnTo?.isConnected) focus.focus(state.returnTo, { silent: true });
}
options.addEventListener("click", (e) => e.target === options && closeOptions());

// ─────────────── vistas y navegación ───────────────
function setView(v) {
  state.view = v;
  $("#home").hidden = v !== "home";
  $("#all").hidden = v !== "all";
  if (v === "all") {
    renderAll();
    focus.first($("#all-grid"));
  } else {
    renderRail();
    focus.first(rail);
  }
}

const focus = createFocus({
  root: document.body,
  scroll: "nearest",
  onChange: (el) => {
    const id = Number(el.dataset.gameId);
    const g = id && ejg.library.byId(id);
    if (el.closest("#rail")) $("#sel-title").textContent = g ? g.title : el.classList.contains("allsw") ? "Todos los programas" : "";
    updateHints(g);
  },
});
bindNav(focus, {
  back: () => {
    if (!options.hidden) return closeOptions(), true;
    if (state.view === "all") return setView("home"), true;
    return false;
  },
  x: () => {
    const id = Number(focus.current?.dataset.gameId);
    if (id && options.hidden) openOptions(id);
    return true;
  },
  y: () => {
    const id = Number(focus.current?.dataset.gameId) || state.optionsFor;
    if (id) ejg.game.favorite(id);
    return true;
  },
  menu: () => (ejg.ui.open("menu"), true),
  view: () => (ejg.ui.open("search"), true),
});
ejg.on("focus-return", () => focus.restore());
// Clic derecho = opciones (como X).
document.addEventListener("contextmenu", (e) => {
  const t = e.target.closest?.("[data-game-id]");
  if (t) {
    e.preventDefault();
    openOptions(Number(t.dataset.gameId));
  }
});

document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => ejg.ui.open(b.dataset.action)));

function renderUser() {
  const p = ejg.profile;
  const u = $("#user");
  u.textContent = p?.avatar ? "" : (p?.name || "?")[0].toUpperCase();
  u.style.backgroundImage = p?.avatar ? `url("${p.avatar}")` : "";
  u.style.backgroundColor = p?.color || "";
  u.title = p?.name || "";
}
function applyWall() {
  document.body.classList.toggle("wall", !!ejg.settings.wallpaper);
}

const refresh = debounce(() => {
  if (state.view === "all") renderAll();
  else renderRail();
  if (focus.current && !focus.current.isConnected) {
    const again = document.querySelector(`[data-game-id="${focus.current.dataset.gameId}"]`);
    if (again) focus.focus(again, { noScroll: true, silent: true });
    else focus.first(rail);
  }
}, 60);
ejg.library.onChange(refresh);
ejg.on("running", refresh);
ejg.game.onState(refresh);
ejg.on("settings", () => (applyWall(), refresh()));
ejg.on("profile", renderUser);

const hintBar = hints($("#bar"), []);
function updateHints(g) {
  hintBar.set([
    ["accept", g && g.installed === false ? "Instalar" : "Iniciar"],
    ["x", "Opciones"],
    ["y", "Favorito"],
    ["back", "Atrás"],
  ]);
}

renderUser();
applyWall();
setView("home");
updateHints();
