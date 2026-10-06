// Tema "PS5": fila de iconos arriba, fondo a pantalla completa del juego
// seleccionado y hub con Jugar, datos, capturas y tráileres. PlayStation Store
// y Descargas están en store.js.

import { h, img, initials, hueOf, keyed, debounce } from "/_sdk/kit/dom.js";
import { repackUpdateNote } from "/_sdk/kit/updates.js";
import { howLongNote } from "/_sdk/kit/hltb.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { createBackdrop, attachStream } from "/_sdk/kit/media.js";
import { playtime, relative, year } from "/_sdk/kit/format.js";
import { visible, sort, recent, isSoftware, isRom } from "/_sdk/kit/library.js";
import { emulatorNote } from "/_sdk/kit/emulator.js";
import { clock } from "/_sdk/kit/clock.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";
import { createGuideView } from "/_sdk/kit/guides.js";
import { createHomebrewView } from "/_sdk/kit/homebrew.js";
import { percent } from "/_sdk/kit/store.js";
import { createStore } from "./store.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const row = $("#row");
const hub = $("#hub");
const media = $("#media");
const player = $("#player");
const viewer = $("#viewer");
const saved = (await ejg.storage.getAll().catch(() => null)) || {};

// backTo: la pestaña a la que vuelve «Atrás» desde el hub (un juego abierto desde Homebrew).
const state = { tab: "home", selected: saved.last ?? null, chip: "all", detailsFor: null, peek: null, backTo: null };
const bg = createBackdrop($("#bg"), { fade: 700 });
clock($("#clock"));

const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>';
const GRID_ICON = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';

const games = () => visible(ejg.library.all);
// Ocultos: solo salen en su filtro de la Biblioteca; el que se abre desde ahí
// (state.peek) se ve en la fila mientras siga seleccionado.
const hiddenGames = () => visible(ejg.library.all, { hidden: true }).filter((g) => g.hidden);
// Lo que no sale en la fila (ocultos, y emuladores y juegos de consola, que son de Homebrew): se ve
// en ella mientras esté seleccionado.
const peekable = (g) => g && (g.hidden || isSoftware(g) || isRom(g));

function rowGames() {
  const all = games();
  let list;
  switch (ejg.settings.rowOrder) {
    case "added":
      list = sort(all, "added");
      break;
    case "title":
      list = sort(all, "title");
      break;
    case "favorites":
      list = [...sort(all.filter((g) => g.favorite), "recent"), ...sort(all.filter((g) => !g.favorite), "recent")];
      break;
    default: {
      const rec = recent(all, 50);
      const ids = new Set(rec.map((g) => g.id));
      list = [...rec, ...sort(all.filter((g) => !ids.has(g.id)), "added")];
    }
  }
  list = list.slice(0, 20);
  const peek = state.peek === state.selected && ejg.library.byId(state.peek);
  const sel = state.selected && (all.find((g) => g.id === state.selected) || (peekable(peek) ? peek : null));
  if (sel && !list.includes(sel)) list = [sel, ...list.slice(0, 19)];
  return list;
}

function art(g) {
  return h("div", { class: "art" }, artFor(g, "square"));
}

function tile(g, prev) {
  const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}:${g.media.logo}:${ejg.game.isRunning(g.id)}`;
  if (prev && prev.__sig === sig) return prev;
  const el = h(
    "button",
    { class: "tile", "data-focus": "", "data-game-id": g.id, onclick: () => (state.selected === g.id ? $("#play").click() : select(g.id, true)) },
    art(g),
    h("span", { class: "name" }, g.title),
    ejg.game.isRunning(g.id) ? h("span", { class: "run" }) : null,
  );
  el.__sig = sig;
  return el;
}

let allTile;
function renderRow() {
  const list = rowGames();
  if (!list.length) {
    row.replaceChildren();
    renderEmpty();
    return;
  }
  keyed(row, list, (g) => g.id, tile);
  allTile ||= h("button", { class: "tile all", "data-focus": "", onclick: () => setTab("library") }, h("div", { class: "art", html: GRID_ICON }), h("span", { class: "name" }, "Biblioteca de juegos"));
  row.append(allTile);
  if (!state.selected || !list.some((g) => g.id === state.selected)) state.selected = list[0].id;
  markSelected();
}

function markSelected() {
  for (const t of row.children) t.classList.toggle("sel", Number(t.dataset.gameId) === state.selected);
  const sel = row.querySelector(".tile.sel");
  if (!sel) return;
  // Hueco para el nombre a la derecha del icono seleccionado.
  const name = sel.querySelector(".name");
  row.style.setProperty("--name-w", `${Math.min(name.scrollWidth + 50, 520)}px`);
  slideTo(sel);
}

function slideTo(el) {
  const pad = parseFloat(getComputedStyle(row).paddingLeft) || 0;
  const x = Math.max(0, el.offsetLeft - pad);
  row.style.transform = `translateX(${-x}px)`;
}

// ─────────────── hub del juego seleccionado ───────────────
let idleTimer = 0;
let detailsTimer = 0;
let releaseTrailer = () => {};

let shownId = null;
function select(id, userInitiated) {
  const g = ejg.library.byId(id);
  if (!g) return;
  if (state.peek && state.peek !== id) state.peek = null;
  if (state.selected !== id) ejg.storage.set("last", id);
  state.selected = id;
  markSelected();
  renderHub(g);
  if (userInitiated) {
    const t = row.querySelector(`[data-game-id="${id}"]`);
    if (t && focus.current !== t) focus.focus(t, { noScroll: true, silent: true });
  }
}

let shownArt = "";
function renderHub(g) {
  hub.hidden = false;
  const changed = shownId !== g.id;
  shownId = g.id;
  // El arte puede llegar después (descarga en segundo plano): se repinta si cambia.
  const artKey = `${g.media.logo}|${g.media.hero || g.media.heroThumb}`;
  const artChanged = artKey !== shownArt;
  shownArt = artKey;
  const logo = $("#logo");
  if (changed || artChanged || !logo.firstChild) {
    logo.replaceChildren();
    if (g.media.logo) {
      const l = img(g.media.logo, { loading: "eager" });
      l.addEventListener("error", () => l.replaceWith(h("h1", null, g.title)));
      logo.append(l);
    } else logo.append(h("h1", null, g.title));
  }
  $("#meta").textContent = [year(g.releaseDate), g.developer, ...(g.genres || []).slice(0, 2)].filter(Boolean).join("  ·  ");
  updatePlay(g);
  $("#hidden-note").hidden = !g.hidden;
  const upd = repackUpdateNote(g);
  if (upd) $("#update-note").replaceChildren(upd);
  else $("#update-note").replaceChildren();
  $("#hltb-note").replaceChildren(emulatorNote(g), howLongNote(g));
  $("#fav").classList.toggle("on", g.favorite);
  $("#stats").replaceChildren(
    ...[
      h("div", null, h("b", null, playtime(g.playtime, "—")), "Tiempo jugado"),
      h("div", null, h("b", null, relative(g.lastPlayed)), "Última partida"),
      g.achievements ? h("div", null, h("b", null, `${Math.round((g.achievements.unlocked / g.achievements.total) * 100)} %`), `Trofeos · ${g.achievements.unlocked}/${g.achievements.total}`) : null,
      g.launchCount ? h("div", null, h("b", null, String(g.launchCount)), g.launchCount === 1 ? "Partida" : "Partidas") : null,
    ].filter(Boolean),
  );
  $("#blurb").textContent = g.shortDescription || "";

  if (!changed && artChanged) {
    const u = g.media.hero || g.media.heroThumb || g.media.header;
    if (u) bg.set(u);
  }
  if (!changed) return;
  // Fondo + tráiler al detenerse.
  releaseTrailer();
  releaseTrailer = () => {};
  document.body.classList.remove("trailer-on");
  const heroUrl = g.media.hero || g.media.heroThumb || g.media.header;
  if (heroUrl) bg.set(heroUrl);
  else if (ejg.settings.wallpaper) bg.set(ejg.settings.wallpaper);
  else bg.set(null);
  clearTimeout(idleTimer);
  media.replaceChildren();
  clearTimeout(detailsTimer);
  detailsTimer = setTimeout(() => loadDetails(g.id), 350);
  if (ejg.settings.autoTrailer !== false) {
    idleTimer = setTimeout(() => startBackgroundTrailer(g), (Number(ejg.settings.trailerDelay) || 3) * 1000);
  }
}

async function startBackgroundTrailer(g) {
  if (state.selected !== g.id || state.tab !== "home" || shop.panelOpen || !document.hasFocus()) return;
  let url = g.media.microtrailer;
  if (ejg.settings.trailerSound) {
    const d = await ejg.game.details(g.id).catch(() => null);
    url = d?.trailers?.[0]?.url || url;
  }
  if (!url || state.selected !== g.id || state.tab !== "home") return;
  const video = document.querySelector(".ejg-backdrop-video");
  if (video) video.muted = !ejg.settings.trailerSound;
  await bg.video(url);
  document.body.classList.add("trailer-on");
  releaseTrailer = () => bg.stopVideo();
}

// Fuera de Juegos no hace falta el tráiler ni cargar el hub.
function stopHome() {
  releaseTrailer();
  releaseTrailer = () => {};
  clearTimeout(idleTimer);
  clearTimeout(detailsTimer);
  document.body.classList.remove("trailer-on");
}

function homeBg() {
  const g = ejg.library.byId(state.selected);
  const u = g && (g.media.hero || g.media.heroThumb || g.media.header);
  bg.set(u || ejg.settings.wallpaper || null);
}

async function loadDetails(id) {
  let d;
  try {
    d = await ejg.game.details(id);
  } catch {
    return;
  }
  if (state.selected !== id) return;
  const cards = [];
  if (d.steamAppid) {
    cards.push(
      h(
        "button",
        { class: "mcard help-card", "data-focus": "", onclick: () => openGuides(id) },
        h("span", { class: "help-ico", html: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>' }),
        h("div", { class: "lbl" }, "Ayuda del juego"),
        h("div", { class: "sub" }, "Guías de la comunidad"),
      ),
    );
  }
  // Trucos (trainers de FLiNG) y mapa (Map Genie): las ventanas son del host.
  cards.push(
    h(
      "button",
      { class: "mcard help-card", "data-focus": "", onclick: () => ejg.trainer.open(id) },
      h("span", { class: "help-ico", html: '<svg viewBox="0 0 24 24"><path d="m15 4 5 5L8 21l-5-5L15 4Z"/><path d="M18 2v3M21 5h-3M4 3v2M5 4H3M20 13v2M21 14h-2"/></svg>' }),
      h("div", { class: "lbl" }, "Trucos"),
      h("div", { class: "sub" }, "Trainer de FLiNG"),
    ),
    h(
      "button",
      { class: "mcard help-card", "data-focus": "", onclick: () => ejg.maps.open(id) },
      h("span", { class: "help-ico", html: '<svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>' }),
      h("div", { class: "lbl" }, "Mapa"),
      h("div", { class: "sub" }, "Puntos de interés"),
    ),
  );
  for (const t of d.trailers.slice(0, 3)) {
    cards.push(
      h(
        "button",
        { class: "mcard", "data-focus": "", onclick: () => openPlayer(t) },
        t.poster ? img(t.poster) : null,
        h("div", { class: "pl" }, h("span", { html: PLAY_ICON })),
        h("div", { class: "lbl" }, t.title || "Tráiler"),
      ),
    );
  }
  d.screenshots.slice(0, 8).forEach((s, i) => cards.push(h("button", { class: "mcard", "data-focus": "", onclick: () => openViewer(d.screenshots, i) }, img(s.thumb || s.url))));
  media.replaceChildren(...cards);
}

function updatePlay(g) {
  const play = $("#play");
  const running = ejg.game.isRunning(g.id);
  play.classList.toggle("running", running);
  play.disabled = !!g.missing;
  play.textContent = g.missing ? "No encontrado" : running ? "En marcha" : "Jugar";
}

$("#play").addEventListener("click", async () => {
  const id = state.selected;
  if (!id || ejg.game.isRunning(id)) return;
  $("#play").textContent = "Iniciando…";
  releaseTrailer();
  try {
    await ejg.game.launch(id);
  } catch (e) {
    ejg.ui.toast(String(e.message || e), "error");
  }
  setTimeout(() => {
    const g = ejg.library.byId(id);
    if (g) updatePlay(g);
  }, 2500);
});
$("#edit").addEventListener("click", () => state.selected && ejg.game.edit(state.selected));
$("#fav").addEventListener("click", () => state.selected && ejg.game.favorite(state.selected));
$("#help").addEventListener("click", () => state.selected && openGuides(state.selected));
$("#unhide").addEventListener("click", async () => {
  const g = ejg.library.byId(state.selected);
  if (!g?.hidden) return;
  try {
    await ejg.game.hide(g.id, false);
    ejg.ui.toast(`«${g.title}» vuelve a tu biblioteca`, "ok");
    focus.focus($("#play"), { silent: true });
  } catch (e) {
    ejg.ui.toast(String(e.message || e), "error");
  }
});

// ─────────────── ayuda del juego (guías de la comunidad de Steam) ───────────────
let guideView = null;
let guideReturn = null;
const guidesLayer = $("#guides");
function openGuides(gameId, guideId = null) {
  const g = ejg.library.byId(gameId);
  if (!g) return;
  stopHome();
  shop.closeDownloads();
  guideView?.destroy();
  guideReturn = guideView ? guideReturn : focus.current;
  const art = g.media.hero || g.media.heroThumb || g.media.header;
  $("#gh-bg").style.backgroundImage = art ? `url("${art}")` : "";
  guidesLayer.hidden = false;
  document.documentElement.dataset.panel = "guides";
  guideView = createGuideView({
    ejg,
    root: $("#gh-inner"),
    focus,
    gameId,
    gameTitle: g.title,
    layout: "grid",
    guide: guideId,
    labels: { title: "Ayuda del juego", community: "Guías de la comunidad", pin: "Guardar", pinned: "Guardada" },
    onExit: closeGuides,
    onChange: () => updateHints(),
  });
  ejg.sound.play("open");
}
function closeGuides() {
  if (!guideView) return false;
  guideView.destroy();
  guideView = null;
  guidesLayer.hidden = true;
  delete document.documentElement.dataset.panel;
  const back = guideReturn?.isConnected ? guideReturn : $("#help");
  guideReturn = null;
  if (back) focus.focus(back, { silent: true });
  updateHints();
  return true;
}
const gv = (a) => !!(guideView && guideView.nav(a));

// ─────────────── reproductor y visor ───────────────
let release = () => {};
async function openPlayer(t) {
  releaseTrailer();
  const v = h("video", { controls: true, autoplay: true, playsInline: true });
  if (t.poster) v.poster = t.poster;
  player.replaceChildren(v);
  player.hidden = false;
  release = await attachStream(v, t.url);
  v.play().catch(() => {});
}
function closePlayer() {
  release();
  player.replaceChildren();
  player.hidden = true;
}
let viewItems = [];
let viewIndex = 0;
function openViewer(items, i) {
  viewItems = items;
  viewIndex = i;
  viewer.hidden = false;
  viewer.replaceChildren(img(items[i].url, { loading: "eager" }));
}
function stepViewer(d) {
  viewIndex = (viewIndex + d + viewItems.length) % viewItems.length;
  viewer.replaceChildren(img(viewItems[viewIndex].url, { loading: "eager" }));
}
viewer.addEventListener("click", () => (viewer.hidden = true));
player.addEventListener("click", (e) => e.target === player && closePlayer());

// ─────────────── Homebrew: emuladores y juegos de consola (kit/homebrew.js) ───────────────
let hbView = null;
function openHomebrewView() {
  hbView?.destroy();
  hbView = createHomebrewView({
    ejg,
    root: $("#homebrew"),
    focus,
    layout: "ps5",
    onExit: () => setTab("home"),
    onChange: () => updateHints(),
    // Como desde la Biblioteca: el juego se abre en el hub de Juegos y «Atrás» vuelve aquí.
    onGame: (g) => {
      state.peek = g.id;
      state.selected = g.id;
      setTab("home");
      state.backTo = "homebrew";
      select(g.id, true);
    },
  });
  bg.set(ejg.settings.wallpaper || null);
}
const hv = (a) => !!(state.tab === "homebrew" && hbView && hbView.nav(a));

// ─────────────── biblioteca ───────────────
const CHIPS = [
  ["all", "Todos"],
  ["played", "Jugados"],
  ["unplayed", "Sin jugar"],
  ["fav", "Favoritos"],
];
function renderLibrary() {
  const nHidden = hiddenGames().length;
  // Si ya no queda ninguno oculto, se vuelve a Todos.
  if (state.chip === "hidden" && !nHidden) state.chip = "all";
  const chips = [...CHIPS, ...(nHidden ? [["hidden", `Ocultos (${nHidden})`]] : [])];
  $("#chips").replaceChildren(
    ...chips.map(([k, l]) =>
      h("button", { class: "chip", "data-focus": "", "aria-pressed": String(state.chip === k), onclick: () => ((state.chip = k), renderLibrary()) }, l),
    ),
  );
  let list = sort(state.chip === "hidden" ? hiddenGames() : games(), "title");
  if (state.chip === "fav") list = list.filter((g) => g.favorite);
  if (state.chip === "played") list = list.filter((g) => g.playtime > 0 || g.lastPlayed);
  if (state.chip === "unplayed") list = list.filter((g) => !g.playtime && !g.lastPlayed);
  keyed($("#lib-grid"), list, (g) => g.id, (g, prev) => {
    const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}`;
    if (prev && prev.__sig === sig) return prev;
    const el = h(
      "button",
      {
        class: "lcard",
        "data-focus": "",
        "data-game-id": g.id,
        onclick: () => {
          state.peek = peekable(g) ? g.id : null;
          state.selected = g.id;
          setTab("home");
          select(g.id, true);
        },
      },
      art(g),
      h("div", { class: "t" }, g.title),
    );
    el.__sig = sig;
    return el;
  });
}

const hintBar = hints($("#hints"), []);
function updateHints() {
  if (guideView) return hintBar.set(guideView.hints());
  if (state.tab === "homebrew" && hbView) return hintBar.set(hbView.hints());
  if (state.tab === "store" || shop.hasDialog()) return hintBar.set(shop.hints());
  const inMedia = focus.current?.closest("#media");
  hintBar.set(
    state.tab === "library"
      ? [["accept", "Abrir"], ["y", "Favorito"], ["back", "Inicio"], ["lb", "Pestañas"]]
      : [["accept", inMedia ? "Ver" : "Seleccionar"], ["back", "Atrás"], ["y", "Favorito"], ["x", "Opciones"], ["lb", "Pestañas"], ["menu", "Menú"]],
  );
}

// Pestañas: Juegos, Biblioteca, Homebrew y PlayStation Store (si Explorar está activado).
function tabList() {
  return ["home", "library", "homebrew", ...(ejg.explore.enabled ? ["store"] : [])];
}
function cycleTab(d) {
  const tabs = tabList();
  const i = Math.max(0, tabs.indexOf(state.tab));
  setTab(tabs[(i + d + tabs.length) % tabs.length]);
}

function setTab(tab) {
  if (tab === "store" && !ejg.explore.enabled) tab = "home";
  const was = state.tab;
  state.tab = tab;
  state.backTo = null;
  document.documentElement.dataset.view = tab;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === tab)));
  $("#home").hidden = tab !== "home";
  $("#library").hidden = tab !== "library";
  $("#homebrew").hidden = tab !== "homebrew";
  if (was === "homebrew" && tab !== "homebrew") {
    hbView?.destroy();
    hbView = null;
  }
  $("#store").hidden = tab !== "store";
  if (was === "store" && tab !== "store") {
    shop.hide();
    // El fondo vuelve a ser el del juego seleccionado.
    shownId = null;
    if (tab === "library") homeBg();
  }
  if (tab === "store" || tab === "homebrew") stopHome();
  updateHints();
  if (tab === "library") {
    renderLibrary();
    focus.first($("#lib-grid"));
  } else if (tab === "store") {
    shop.show();
  } else if (tab === "homebrew") {
    openHomebrewView();
  } else {
    renderRow();
    const g = ejg.library.byId(state.selected);
    if (g) renderHub(g);
    else homeBg();
    const t = row.querySelector(".tile.sel") || row.firstChild;
    if (t) focus.focus(t, { instant: true, silent: true });
  }
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => ejg.ui.open(b.dataset.action)));

function renderEmpty() {
  hub.hidden = false;
  $("#logo").replaceChildren(h("h1", null, "Tu biblioteca está vacía"));
  $("#meta").textContent = "Añade la carpeta donde tienes tus juegos.";
  $("#play").textContent = "Añadir juegos";
  $("#stats").replaceChildren();
  $("#blurb").textContent = "";
}

// ─────────────── foco y mando ───────────────
const focus = createFocus({
  root: document.body,
  scroll: "none",
  onChange: (el, _prev, { pointer }) => {
    if (shop.owns(el)) {
      shop.onFocus(el, pointer);
      return updateHints();
    }
    // Con el ratón, pasar por encima solo resalta: se selecciona con clic (si
    // no, la fila se deslizaría y el icono se escaparía de debajo del cursor).
    if (pointer) return updateHints();
    const id = Number(el.dataset.gameId);
    if (el.classList.contains("tile") && id) select(id);
    hub.classList.toggle("media-focus", !!el.closest("#media"));
    updateHints();
    if (el.closest("#media")) el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    if (el.closest("#library") || el.closest("#homebrew")) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },
});

// PlayStation Store y Descargas (store.js).
const shop = createStore({
  ejg,
  root: $("#store"),
  layer: $("#downloads"),
  focus,
  bg,
  openViewer,
  setTab: (t) => setTab(t),
  focusView: () => {
    if (state.tab === "library") return focus.first($("#lib-grid"));
    const t = row.querySelector(".tile.sel") || row.firstChild || $("#play");
    if (t) focus.focus(t, { silent: true });
  },
  onChange: () => updateDownloadsUi(),
  onView: () => updateHints(),
});

const mediaOpen = () => !player.hidden || !viewer.hidden;
bindNav(focus, {
  back: () => {
    if (gv("back")) return true;
    if (!player.hidden) return closePlayer(), true;
    if (!viewer.hidden) return (viewer.hidden = true), true;
    if (shop.back()) return true;
    if (state.tab === "library" || state.tab === "store" || state.tab === "homebrew") return setTab("home"), true;
    // Un juego abierto desde Homebrew: vuelve allí.
    if (state.backTo) return setTab(state.backTo), true;
    const t = row.querySelector(".tile.sel");
    if (t && focus.current !== t) return focus.focus(t), true;
    return false;
  },
  left: () => (!viewer.hidden ? (stepViewer(-1), true) : !player.hidden),
  right: () => (!viewer.hidden ? (stepViewer(1), true) : !player.hidden),
  up: () => {
    if (gv("up")) return true;
    if (!player.hidden || !viewer.hidden) return true;
    // Desde el aviso de oculto, subir al icono seleccionado (no a las pestañas).
    const t = focus.current?.id === "unhide" && row.querySelector(".tile.sel");
    return t ? (focus.focus(t), true) : false;
  },
  lt: () => gv("lt"),
  rt: () => gv("rt"),
  down: () => {
    if (gv("down")) return true;
    // Desde la fila, bajar siempre a "Jugar".
    if (focus.current?.classList.contains("tile") && state.tab === "home") return focus.focus($("#play")), true;
    return !player.hidden || !viewer.hidden;
  },
  y: () => {
    if (gv("y") || hv("y")) return true;
    if (mediaOpen() || shop.hasDialog()) return true;
    if (state.tab === "store") return shop.search(), true;
    return (state.selected && ejg.game.favorite(state.selected), true);
  },
  x: () => (gv("x") || mediaOpen() || shop.hasDialog() || (state.tab === "store" ? shop.filters() : state.selected && ejg.game.edit(state.selected)), true),
  menu: () => (ejg.ui.open("menu"), true),
  view: () => gv("view") || (ejg.ui.open("search"), true),
  lb: () => gv("lb") || guideView || hv("lb") || (mediaOpen() || shop.hasDialog() || cycleTab(-1), true),
  rb: () => gv("rb") || guideView || hv("rb") || (mediaOpen() || shop.hasDialog() || cycleTab(1), true),
});
ejg.on("focus-return", () => focus.restore());
// Tráiler solo con la ventana activa.
ejg.on("visibility", (v) => !v.visible && (releaseTrailer(), document.body.classList.remove("trailer-on")));

function renderProfile() {
  const p = ejg.profile;
  const av = $("#avatar");
  av.textContent = p?.avatar ? "" : (p?.name || "?")[0].toUpperCase();
  av.style.backgroundImage = p?.avatar ? `url("${p.avatar}")` : "";
  av.style.backgroundColor = p?.color || "";
}

// ─────────────── eventos ───────────────
const refresh = debounce(() => {
  if (state.tab === "library") renderLibrary();
  if (state.tab !== "home") return;
  renderRow();
  const g = ejg.library.byId(state.selected);
  if (g) renderHub(g);
}, 60);
ejg.library.onChange(refresh);
ejg.on("running", refresh);
ejg.game.onState(refresh);
ejg.on("settings", () => {
  if (state.tab !== "home") return void (shownId = null);
  renderRow();
  const g = ejg.library.byId(state.selected);
  if (g) {
    shownId = null;
    select(g.id);
  }
});
ejg.on("profile", renderProfile);
window.addEventListener("resize", debounce(markSelected, 100));

// ─────────────── descargas: icono de la barra de estado ───────────────
const dlIco = $("#dl-ico");
const dlBadge = $("#dl-badge");
const dlRing = $("#dl-ring");
const RING = 2 * Math.PI * 20;
dlRing.style.strokeDasharray = String(RING);
dlIco.addEventListener("click", () => (stopHome(), shop.openDownloads()));
function updateDownloadsUi() {
  const all = ejg.downloads.all;
  const n = shop.pendingCount();
  dlBadge.hidden = !n;
  dlBadge.textContent = String(n);
  $("#tab-store").hidden = !ejg.explore.enabled;
  // Anillo con el progreso de lo que se está bajando (o instalando).
  const going = all.filter((d) => d.state === "downloading");
  const inst = all.find((d) => d.state === "installing");
  const t = going.reduce((a, d) => ({ done: a.done + d.doneBytes, size: a.size + d.totalBytes }), { done: 0, size: 0 });
  const p = t.size ? t.done / t.size : inst ? inst.progress || 0 : 0;
  dlIco.classList.toggle("busy", going.length > 0 || !!inst);
  dlRing.style.strokeDashoffset = String(RING * (1 - p));
  dlIco.title = going.length ? `Descargando ${going[0].title} · ${percent(p)}` : inst ? `Instalando ${inst.title}` : n ? `Descargas · ${n} pendientes` : "Descargas";
}
ejg.explore.onEnabled(() => {
  if (!ejg.explore.enabled && state.tab === "store") setTab("home");
  updateDownloadsUi();
});
// El host pide una vista (menú rápido, Ctrl+E / Ctrl+J, avisos…).
ejg.ui.onView(({ view, slug, gameId, guideId }) => {
  if (view === "guides" && gameId) return openGuides(gameId, guideId);
  closeGuides();
  if (view === "downloads") return stopHome(), shop.openDownloads();
  if (!ejg.explore.enabled) return;
  shop.closeDownloads();
  if (state.tab !== "store") setTab("store");
  if (view === "repack" && slug) shop.openRepack(slug);
  else shop.front();
});

renderProfile();
document.documentElement.dataset.view = "home";
updateDownloadsUi();
renderRow();
if (state.selected) select(state.selected);
const first = row.querySelector(".tile.sel") || row.firstChild || $("#play");
if (first) focus.focus(first, { instant: true, silent: true });
if (!games().length) $("#play").onclick = () => ejg.ui.open("add-folder");

updateHints();
