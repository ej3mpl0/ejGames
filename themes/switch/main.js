// Tema "Switch": fila de iconos grandes, botones redondos y panel de opciones.
// La eShop y la gestión de descargas están en store.js.

import { h, img, initials, hueOf, keyed, debounce } from "/_sdk/kit/dom.js";
import { repackUpdateNote } from "/_sdk/kit/updates.js";
import { howLongNote } from "/_sdk/kit/hltb.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { attachStream } from "/_sdk/kit/media.js";
import { playtime, relative, year, description } from "/_sdk/kit/format.js";
import { visible, sort, recent, isRom, isSoftware } from "/_sdk/kit/library.js";
import { emulatorNote } from "/_sdk/kit/emulator.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";
import { clock } from "/_sdk/kit/clock.js";
import { isActive } from "/_sdk/kit/store.js";
import { createShop } from "./store.js";
import { createGuideView } from "/_sdk/kit/guides.js";
import { createHomebrewView } from "/_sdk/kit/homebrew.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const rail = $("#rail");
const options = $("#options");
const state = { view: "home", optionsFor: null, allFilter: "all" };
clock($("#clock"));

const games = () => visible(ejg.library.all);
function railGames() {
  const all = games();
  const rec = recent(all, 30);
  const ids = new Set(rec.map((g) => g.id));
  return [...rec, ...sort(all.filter((g) => !ids.has(g.id)), "added")].slice(0, 14);
}

function art(g) {
  return h("div", { class: "art" }, artFor(g, "square"));
}

function stile(g, prev) {
  const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}:${g.favorite}:${ejg.game.isRunning(g.id)}`;
  if (prev && prev.__sig === sig) return prev;
  const el = h(
    "button",
    { class: "stile", "data-focus": "", "data-game-id": g.id, onclick: () => launch(g.id), title: g.title },
    art(g),
    g.favorite ? h("span", { class: "fav" }, "★") : null,
    ejg.game.isRunning(g.id) ? h("span", { class: "run" }, "En juego") : null,
  );
  el.__sig = sig;
  return el;
}

let allTile;
let railDl = "";
function renderRail() {
  const list = railGames();
  // Las descargas en curso van primero, con su barra de progreso (como en la consola).
  const dls = shop.railItems();
  railDl = dls.map((d) => d.id).join(",");
  keyed(rail, [...dls.map((dl) => ({ dl })), ...list], (x) => (x.dl ? "dl" + x.dl.id : x.id), (x, prev) => (x.dl ? shop.railTile(x.dl, prev) : stile(x, prev)));
  allTile ||= h(
    "button",
    { class: "stile allsw", "data-focus": "", onclick: () => ((state.allFilter = "all"), setView("all")) },
    h("div", { class: "art", html: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span>Todos los programas</span>' }),
  );
  rail.append(allTile);
  if (!list.length && !dls.length) $("#sel-title").textContent = "Pulsa + para añadir tus juegos";
}

// Filtro de «Todos los programas»: all | hidden (su pestaña, solo si hay alguno). Los emuladores y
// los juegos de consola están en Homebrew.
const hiddenGames = () => ejg.library.all.filter((g) => g.hidden && !g.missing && !isRom(g) && !isSoftware(g));
const allTabs = () => ["all", ...(hiddenGames().length ? ["hidden"] : [])];
const TAB_LABEL = { all: "Todos", hidden: "Ocultos" };
function setAllFilter(f) {
  if (state.allFilter === f) return;
  state.allFilter = f;
  ejg.sound.play("select");
  renderAll();
  focus.focus($(`#all-tabs [data-filter="${f}"]`), { silent: true });
}
// LB/RB cambian de pestaña en «Todos los programas».
function tabCycle(d = 1) {
  if (state.view !== "all" || !options.hidden || $("#all-tabs").hidden) return false;
  const list = allTabs();
  setAllFilter(list[(list.indexOf(state.allFilter) + d + list.length) % list.length]);
  return true;
}
const nextTab = () => {
  const list = allTabs();
  return list[(list.indexOf(state.allFilter) + 1) % list.length];
};
function renderTabs(nHidden) {
  const tabs = $("#all-tabs");
  const show = allTabs().length > 1;
  if (tabs.hidden !== !show) queueMicrotask(updateHints);
  tabs.hidden = !show;
  if (!show) return tabs.replaceChildren();
  const tab = (f, label) => {
    const on = state.allFilter === f;
    const b = tabs.querySelector(`[data-filter="${f}"]`) || h("button", { class: "tab", "data-focus": "", "data-filter": f, onclick: () => setAllFilter(f) });
    b.textContent = label;
    b.classList.toggle("is-on", on);
    return b;
  };
  tabs.replaceChildren(...allTabs().map((f) => tab(f, f === "hidden" ? `Ocultos (${nHidden})` : TAB_LABEL[f])));
}

function renderAll() {
  const nHidden = hiddenGames().length;
  // Si ya no queda ninguno en la pestaña, se vuelve al filtro por defecto.
  if (!allTabs().includes(state.allFilter)) state.allFilter = "all";
  renderTabs(nHidden);
  const onlyHidden = state.allFilter === "hidden";
  const list = sort(onlyHidden ? hiddenGames() : games(), "title");
  const n = list.length;
  $("#all-count").textContent = onlyHidden ? (n === 1 ? "1 oculto" : `${n} ocultos`) : `${n} programas`;
  keyed($("#all-grid"), list, (g) => g.id, (g, prev) => {
    const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}:${g.favorite}`;
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
// Lo que cambia al jugar (horas, logros, «En juego»): se repinta con el panel abierto.
const startLabel = (g) => (ejg.game.isRunning(g.id) ? "En juego" : "Iniciar");
function optionStats(g) {
  const stat = (label, value) => h("div", { class: "stat" }, h("small", null, label), h("b", null, value));
  return [
    stat("Tiempo de juego", playtime(g.playtime, "—")),
    stat("Última vez", relative(g.lastPlayed)),
    g.achievements ? stat("Logros", `${g.achievements.unlocked} / ${g.achievements.total}`) : null,
  ].filter(Boolean);
}

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
    h("div", { class: "sub" }, [g.developer, year(g.releaseDate)].filter(Boolean).join(" · ")),
    h("div", { class: "stats" }, ...optionStats(g)),
    g.hidden ? hiddenNotice(g) : null,
    repackUpdateNote(g),
    emulatorNote(g),
    howLongNote(g),
    h(
      "div",
      { class: "menu" },
      item(startLabel(g), () => (closeOptions(), launch(g.id))),
      item(g.favorite ? "Quitar de favoritos" : "Añadir a favoritos", () => (ejg.game.favorite(g.id), closeOptions())),
      item("Ver tráiler", () => playTrailer(g.id, cover)),
      item("Guías de la comunidad", () => (closeOptions(), openGuides(g.id))),
      item("Trucos", () => ejg.trainer.open(g.id)),
      item("Mapa del juego", () => ejg.maps.open(g.id)),
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

// Aviso de juego oculto, con el botón para devolverlo a la biblioteca.
function hiddenNotice(g) {
  const show = async () => {
    try {
      await ejg.game.hide(g.id, false);
    } catch (e) {
      return ejg.ui.toast(String(e.message || e), "error");
    }
    ejg.ui.toast(`«${g.title}» vuelve a tu biblioteca`, "ok");
    dropNotice();
  };
  return h(
    "div",
    { class: "hidden-note" },
    h("i", { html: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2.5 12S6 19 12 19a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>' }),
    h("div", null, h("b", null, "Oculto en tu biblioteca"), h("small", null, "No sale en el HOME ni en la pestaña «Todos».")),
    h("button", { class: "show", "data-focus": "", onclick: show }, "Mostrar en la biblioteca"),
  );
}
// Quita el aviso del panel abierto (el foco pasa a la primera opción si estaba en él).
function dropNotice() {
  const note = options.querySelector(".hidden-note");
  if (!note) return;
  const had = note.contains(focus.current);
  note.remove();
  if (had) focus.first(options.querySelector(".menu"));
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
  // El icono ya no está (p. ej. se mostró un oculto con el filtro «Ocultos» activo).
  else if (state.view === "all") focus.first($("#all-grid"));
}
options.addEventListener("click", (e) => e.target === options && closeOptions());

// ─────────────── guías de la comunidad ───────────────
let guideView = null;
let guideFrom = null;
function openGuides(gameId, guideId = null) {
  const g = ejg.library.byId(gameId);
  if (!g) return;
  if (state.view !== "guides") guideFrom = { view: state.view, focus: focus.current };
  dropGuides();
  const root = $("#guides");
  const box = h("div", { class: "gs-page" });
  root.replaceChildren(
    h(
      "header",
      { class: "gs-head" },
      g.media.coverThumb || g.media.icon ? img(g.media.coverThumb || g.media.icon, { class: "gs-icon" }) : null,
      h("div", null, h("small", null, "Guías de la comunidad"), h("b", null, g.title)),
    ),
    box,
  );
  setView("guides");
  guideView = createGuideView({
    ejg,
    root: box,
    focus,
    gameId,
    guide: guideId,
    labels: { title: "Guías", pin: "Guardar", pinned: "Guardada" },
    onExit: closeGuides,
    onChange: () => updateHints(),
  });
  ejg.sound.play("open");
}
function dropGuides() {
  guideView?.destroy();
  guideView = null;
}
function closeGuides() {
  const from = guideFrom;
  guideFrom = null;
  setView(from?.view && from.view !== "guides" ? from.view : "home", from?.focus?.isConnected ? from.focus : undefined);
  if (from?.focus?.isConnected) focus.focus(from.focus, { silent: true });
  return true;
}

// ─────────────── Homebrew: emuladores y juegos de consola (kit/homebrew.js) ───────────────
let hbView = null;
function openHomebrew() {
  setView("homebrew");
  ejg.sound.play("open");
}
function dropHomebrew() {
  hbView?.destroy();
  hbView = null;
}
$("#c-homebrew").addEventListener("click", openHomebrew);
const hv = (a) => !!(state.view === "homebrew" && options.hidden && hbView && hbView.nav(a));

// ─────────────── vistas y navegación ───────────────
// home | all | homebrew | shop (eShop) | dls (Gestión de descargas). `target`: qué enfocar al volver al HOME.
function setView(v, target) {
  if (v !== "guides") dropGuides();
  if (v !== "homebrew") dropHomebrew();
  state.view = v;
  document.documentElement.dataset.view = v;
  for (const id of ["home", "all", "homebrew", "guides", "shop", "dls"]) $("#" + id).hidden = v !== id;
  if (v === "homebrew" && !hbView) {
    // Como en el HOME: A inicia el juego; X abre sus opciones.
    hbView = createHomebrewView({ ejg, root: $("#homebrew"), focus, layout: "switch", onExit: () => setView("home", "#c-homebrew"), onChange: () => updateHints(), onGame: (g) => launch(g.id) });
  } else if (v === "all") {
    renderAll();
    focus.first($("#all-grid"));
  } else if (v === "home") {
    renderRail();
    const t = typeof target === "string" ? $(target) : target;
    if (t?.isConnected && !t.hidden) focus.focus(t, { instant: true, silent: true });
    else focus.first(rail);
  }
  updateHints();
}

const focus = createFocus({
  root: document.body,
  scroll: "nearest",
  onChange: (el) => {
    if (el.closest("#rail")) selTitle(el);
    updateHints();
  },
});

function selTitle(el) {
  const t = $("#sel-title");
  const d = el.dataset.dlId && ejg.downloads.byId(Number(el.dataset.dlId));
  if (d) return t.replaceChildren(d.title, h("small", null, shop.railState(d)));
  const g = Number(el.dataset.gameId) && ejg.library.byId(Number(el.dataset.gameId));
  t.textContent = g ? g.title : el.classList.contains("allsw") ? "Todos los programas" : "";
}
const gv = (a) => !!(guideView && guideView.nav(a));
const actions = {
  back: () => {
    if (gv("back")) return true;
    if (!options.hidden) return closeOptions(), true;
    if (shop.back()) return true;
    if (state.view === "all") return setView("home"), true;
    if (state.view === "homebrew") return setView("home", "#c-homebrew"), true;
    return false;
  },
  up: () => gv("up"),
  down: () => gv("down"),
  lt: () => gv("lt"),
  rt: () => gv("rt"),
  x: () => {
    if (gv("x")) return true;
    if (!options.hidden) return true;
    if (shop.x(focus.current)) return true;
    const id = Number(focus.current?.dataset.gameId);
    if (id) openOptions(id);
    return true;
  },
  y: () => {
    if (gv("y") || hv("y")) return true;
    if (options.hidden && shop.y()) return true;
    const id = Number(focus.current?.dataset.gameId) || state.optionsFor;
    if (id) ejg.game.favorite(id);
    return true;
  },
  lb: () => gv("lb") || hv("lb") || shop.cycle(-1) || tabCycle(-1),
  rb: () => gv("rb") || hv("rb") || shop.cycle(1) || tabCycle(),
  menu: () => (ejg.ui.open("menu"), true),
  view: () => gv("view") || (ejg.ui.open("search"), true),
};
bindNav(focus, actions);

// eShop y Gestión de descargas (store.js).
const shop = createShop({
  ejg,
  focus,
  shopEl: $("#shop"),
  dlsEl: $("#dls"),
  show: setView,
  where: () => state.view,
  openGame: (id) => launch(id),
  onChange: () => onDownloads(),
  onHints: () => updateHints(),
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

document.querySelectorAll("[data-action]").forEach((b) =>
  b.addEventListener("click", () => {
    const a = b.dataset.action;
    // La eShop y las descargas las pinta el tema, no el host.
    if (a === "explore" || a === "downloads") return shop.open(a);
    ejg.ui.open(a);
  }),
);

// ─────────────── descargas en el HOME ───────────────
function updateDlUi() {
  const all = ejg.downloads.all;
  const n = all.filter((d) => d.state !== "installed").length;
  const badge = $("#dl-count");
  badge.hidden = !n;
  badge.textContent = n > 99 ? "99+" : String(n);
  $("#c-eshop").hidden = !ejg.explore.enabled;
  $("#c-dl").hidden = !ejg.explore.enabled && !all.length;
}
function onDownloads() {
  updateDlUi();
  if (state.view !== "home") return;
  const dls = shop.railItems();
  if (dls.map((d) => d.id).join(",") !== railDl) {
    renderRail();
    if (focus.current && !focus.current.isConnected) focus.first(rail);
  } else for (const d of dls) rail.querySelector(`[data-dl-id="${d.id}"]`)?.__upd?.(d);
  const el = focus.current;
  if (el?.dataset.dlId && el.closest("#rail")) {
    selTitle(el);
    updateHints();
  }
}
ejg.explore.onEnabled(() => {
  updateDlUi();
  if (!ejg.explore.enabled && state.view === "shop") {
    shop.closeAll();
    setView("home");
  }
});
// El host pide una vista (menú rápido, Ctrl+E / Ctrl+J, avisos…).
ejg.ui.onView(({ view, slug, gameId, guideId }) => {
  if (!options.hidden) closeOptions();
  if (view === "guides" && gameId) return openGuides(gameId, guideId);
  if (view === "downloads") return shop.open("downloads");
  if (!ejg.explore.enabled) return;
  shop.open(view === "repack" ? "repack" : "explore", slug);
});

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
  // Homebrew se repinta sola.
  if (state.view === "guides" || state.view === "homebrew") return;
  if (state.view === "all") renderAll();
  else renderRail();
  const og = !options.hidden && state.optionsFor && ejg.library.byId(state.optionsFor);
  if (og) {
    options.querySelector(".stats")?.replaceChildren(...optionStats(og));
    if (!og.hidden) dropNotice();
    const start = options.querySelector(".menu .mi");
    if (start) start.textContent = startLabel(og);
  }
  if ((state.view === "home" || state.view === "all") && focus.current && !focus.current.isConnected) {
    const again = document.querySelector(`[data-game-id="${focus.current.dataset.gameId}"]`);
    if (again) focus.focus(again, { noScroll: true, silent: true });
    else focus.first(state.view === "all" ? $("#all-grid") : rail);
  }
}, 60);
ejg.library.onChange(refresh);
ejg.on("running", refresh);
ejg.game.onState(refresh);
ejg.on("settings", () => (applyWall(), refresh()));
ejg.on("profile", renderUser);

const hintBar = hints($("#bar"), []);
function updateHints() {
  if (state.view === "guides" && guideView) return hintBar.set(guideView.hints());
  if (state.view === "homebrew" && hbView && options.hidden) return hintBar.set([...hbView.hints().slice(0, 1), ["x", "Opciones"], ...hbView.hints().slice(1)]);
  if (state.view === "shop" || state.view === "dls" || shop.hasDialog()) return hintBar.set(shop.hints());
  const el = focus.current;
  const d = el?.dataset?.dlId && ejg.downloads.byId(Number(el.dataset.dlId));
  if (d) return hintBar.set([["accept", "Ver descarga"], ...(isActive(d) || d.state === "paused" ? [["x", isActive(d) ? "Pausar" : "Reanudar"]] : []), ["back", "Atrás"]]);
  if (el?.closest?.(".circles")) return hintBar.set([["accept", "Aceptar"], ["back", "Atrás"]]);
  const tabs = state.view === "all" && !$("#all-tabs").hidden ? [["lb", TAB_LABEL[nextTab()]]] : [];
  if (el?.closest?.("#all-tabs")) return hintBar.set([["accept", "Ver"], ...tabs, ["back", "Atrás"]]);
  const g = Number(el?.dataset?.gameId) && ejg.library.byId(Number(el.dataset.gameId));
  hintBar.set([
    ["accept", "Iniciar"],
    ["x", "Opciones"],
    ["y", "Favorito"],
    ...tabs,
    ["back", "Atrás"],
  ]);
}
// Las pistas se pueden pulsar, como en la pantalla táctil.
$("#bar").addEventListener("click", (e) => {
  const a = e.target.closest(".ejg-hint")?.querySelector(".ejg-glyph")?.dataset.action;
  if (a === "accept") focus.current?.click();
  else if (a) actions[a]?.();
});

renderUser();
applyWall();
updateDlUi();
setView("home");
