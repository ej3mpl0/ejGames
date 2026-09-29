// Tema "Retro": menú arcade en una pantalla CRT. Las carátulas se pixelan y
// se reducen a la paleta elegida en un <canvas> (pixel.js). SHOP y DOWNLOADS
// están en store.js.

import { h, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { playtime, relative, year, description } from "/_sdk/kit/format.js";
import { visible, sort } from "/_sdk/kit/library.js";
import { clock } from "/_sdk/kit/clock.js";
import { hints } from "/_sdk/kit/hints.js";
import { SIZES, drawCover, quantize } from "./pixel.js";
import { createStore } from "./store.js";
import { createGuideView } from "/_sdk/kit/guides.js";
import { createSocialView } from "/_sdk/kit/social.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const list = $("#list");
const detail = $("#detail");
const FILTERS = [
  ["all", "ALL"],
  ["played", "PLAYED"],
  ["new", "NEW"],
  ["fav", "FAV ★"],
];
const TITLES = { library: "SELECT GAME", shop: "GAME SHOP", downloads: "DOWNLOADS" };
// view: library (pestañas de filtro) | shop | downloads
const state = { filter: 0, selected: null, view: "library" };
clock($("#clock"));

const games = () => {
  let l = sort(visible(ejg.library.all), "title");
  const f = FILTERS[state.filter][0];
  if (f === "fav") l = l.filter((g) => g.favorite);
  if (f === "played") l = l.filter((g) => g.playtime > 0 || g.lastPlayed);
  if (f === "new") l = l.filter((g) => !g.playtime && !g.lastPlayed);
  return l;
};

// ─────────────── pestañas: filtros + SHOP + DOWNLOADS ───────────────
const tabList = () => [...FILTERS.map((_, i) => i), ...(ejg.explore.enabled ? ["shop"] : []), "downloads"];
const curTab = () => (state.view === "library" ? state.filter : state.view);
const pending = () => ejg.downloads.all.filter((d) => ["queued", "downloading", "paused", "seeding", "completed", "installing", "error"].includes(d.state)).length;

function renderTabs() {
  const cur = curTab();
  const tab = (id, label, extra) => h("button", { class: "tab" + (id === cur ? " on" : ""), "data-focus": "", onclick: () => goTab(id) }, label, extra);
  const n = pending();
  $("#tabs").replaceChildren(
    ...[
      ...FILTERS.map(([, l], i) => tab(i, l)),
      h("span", { class: "tab-sep" }),
      ejg.explore.enabled ? tab("shop", "SHOP") : null,
      tab("downloads", "DOWNLOADS", h("span", { class: "tab-n", id: "tab-n", hidden: !n }, String(n))),
    ].filter(Boolean),
  );
  const total = visible(ejg.library.all).length;
  $("#credits").textContent = `CREDIT ${String(Math.min(total, 99)).padStart(2, "0")}`;
  $("#p1").textContent = `1UP ${(ejg.profile?.name || "PLAYER").toUpperCase().slice(0, 10)}`;
}

function goTab(t) {
  if (!detail.hidden) closeDetail(true);
  shop.leave();
  if (typeof t === "number") {
    state.filter = (t + FILTERS.length) % FILTERS.length;
    state.view = "library";
  } else state.view = t;
  document.documentElement.dataset.view = state.view;
  $("#lib").hidden = state.view !== "library";
  $("#view").hidden = state.view === "library";
  $("#title").textContent = TITLES[state.view];
  renderTabs();
  updateStatus();
  if (state.view === "library") {
    renderList();
    const first = list.querySelector(".item");
    if (first) focus.focus(first, { instant: true });
    const g = ejg.library.byId(state.selected);
    if (g) showCard(g);
    else updateHints();
  } else shop.render();
}
function switchTab(d) {
  const tabs = tabList();
  goTab(tabs[(tabs.indexOf(curTab()) + d + tabs.length) % tabs.length]);
}

function renderList() {
  const l = games();
  const cur = focus.current?.dataset.gameId;
  list.replaceChildren(
    ...l.map((g) =>
      h(
        "li",
        null,
        h(
          "button",
          { class: "item" + (g.missing ? " missing" : ""), "data-focus": "", "data-game-id": g.id, onclick: () => start(g.id) },
          g.title,
          g.favorite ? h("span", { class: "star" }, "★") : null,
          ejg.game.isRunning(g.id) ? h("span", { class: "run" }, "● PLAY") : null,
        ),
      ),
    ),
  );
  if (!l.length) list.replaceChildren(h("li", { class: "empty" }, state.filter ? "NO HAY JUEGOS AQUÍ" : "INSERT GAME: pulsa ▶ para añadir carpetas", h("br"), h("button", { class: "item", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "AÑADIR JUEGOS")));
  if (cur) {
    const again = list.querySelector(`[data-game-id="${cur}"]`);
    if (again) focus.focus(again, { noScroll: true, silent: true });
  }
}

// ─────────────── carátula pixelada ───────────────
let artToken = 0;
function drawArt(url) {
  const my = ++artToken;
  const canvas = $("#art");
  const plain = $("#art-img");
  const mode = ejg.settings.pixelate || "medium";
  if (!url) {
    canvas.hidden = false;
    plain.hidden = true;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg2");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (mode === "off") {
    canvas.hidden = true;
    plain.hidden = false;
    plain.src = url;
    return;
  }
  const im = new Image();
  im.crossOrigin = "anonymous";
  im.onload = () => {
    if (my !== artToken) return;
    const [w, hh] = SIZES[mode] || SIZES.medium;
    canvas.width = w;
    canvas.height = hh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    drawCover(ctx, im, w, hh);
    quantize(ctx, w, hh);
    canvas.hidden = false;
    plain.hidden = true;
  };
  im.src = url;
}

function showCard(g) {
  if (!g) return;
  state.selected = g.id;
  drawArt(g.media.coverThumb || g.media.header);
  const row = (k, v) => h("div", null, h("span", null, k), h("b", null, v));
  const hs = String(Math.floor((g.playtime || 0) / 60)).padStart(6, "0");
  $("#info").replaceChildren(
    ...[
    row("HI-SCORE", hs),
    row("PLAY TIME", playtime(g.playtime, "0 MIN").toUpperCase()),
    row("LAST", relative(g.lastPlayed).toUpperCase()),
    g.achievements ? row("TROPHIES", `${g.achievements.unlocked}/${g.achievements.total}`) : null,
    row("YEAR", year(g.releaseDate) || "????"),
    row("DEV", (g.developer || "UNKNOWN").toUpperCase().slice(0, 22)),
    row("GENRE", ((g.genres || [])[0] || "???").toUpperCase()),
    ].filter(Boolean),
  );
  if (state.view !== "library") return;
  updateHints(g);
  $("#ticker").textContent = (g.shortDescription || `${g.title} · INSERT COIN`).toUpperCase();
}

async function start(id) {
  if (ejg.game.isRunning(id)) return;
  try {
    await ejg.game.launch(id);
  } catch (e) {
    ejg.ui.toast(String(e.message || e), "error");
  }
}

// ─────────────── pantalla de info (X) ───────────────
async function openDetail(id) {
  const g = ejg.library.byId(id);
  if (!g) return;
  const shots = h("div", { class: "shots" });
  const desc = h("div", { class: "desc" }, g.shortDescription || "");
  const actions = h(
    "div",
    { class: "actions", "data-focus-group": "detail" },
    h("button", { "data-focus": "", onclick: () => (closeDetail(), start(g.id)) }, "▶ START"),
    h("button", { "data-focus": "", onclick: () => ejg.game.favorite(g.id) }, "★ FAV"),
    h("button", { "data-focus": "", onclick: () => (closeDetail(true), openGuides(g.id)) }, "? GUIDES"),
    h("button", { "data-focus": "", onclick: () => ejg.trainer.open(g.id) }, "* CHEATS"),
    h("button", { "data-focus": "", onclick: () => ejg.maps.open(g.id) }, "# MAP"),
    h("button", { "data-focus": "", onclick: () => (closeDetail(), ejg.game.edit(g.id)) }, "EDIT"),
    h("button", { "data-focus": "", onclick: closeDetail }, "BACK"),
  );
  detail.replaceChildren(h("h2", null, g.title.toUpperCase()), desc, shots, actions);
  detail.hidden = false;
  focus.first(actions);
  ejg.sound.play("open");
  const d = await ejg.game.details(id).catch(() => null);
  if (!d || detail.hidden) return;
  if (d.description) desc.replaceChildren(description(d.description.split("\n\n").slice(0, 4).join("\n\n")));
  for (const s of d.screenshots.slice(0, 6)) {
    const c = h("canvas", { width: 128, height: 72 });
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      const ctx = c.getContext("2d", { willReadFrequently: true });
      drawCover(ctx, im, 128, 72);
      quantize(ctx, 128, 72);
    };
    im.src = s.thumb || s.url;
    shots.append(c);
  }
}
function closeDetail(quiet) {
  detail.hidden = true;
  detail.replaceChildren();
  if (quiet === true) return;
  const el = list.querySelector(`[data-game-id="${state.selected}"]`);
  if (el) focus.focus(el, { silent: true });
}

// ─────────────── guías (GUÍAS: las de la comunidad de Steam) ───────────────
let guideView = null;
const guidesEl = $("#guides");
// Las pistas de la vista del kit, en el inglés arcade del tema (la fuente no trae «Ó», «Á»…).
const GUIDE_HINTS = { Leer: "READ", "Sección": "SECTION", Guardar: "SAVE", "Quitar de guardadas": "UNSAVE", Steam: "STEAM", Volver: "BACK", "Atrás": "BACK", Cerrar: "CLOSE", Ir: "GO", Buscar: "SEARCH" };
// ─────────────── amigos y perfiles (en la pantalla de las guías) ───────────────
function openSocial(start = "friends", userId = null) {
  if (!detail.hidden) closeDetail(true);
  guideView?.destroy();
  guidesEl.hidden = false;
  guideView = createSocialView({ ejg, root: guidesEl, focus, start, userId, onExit: closeGuides, onChange: () => updateHints() });
  updateHints();
  ejg.sound.play("open");
}

/** «3» amigos en línea o «+1» solicitud, para el botón de Amigos. */
function friendsBadge() {
  const a = ejg.account.state;
  if (!a?.linked || a.needsLogin) return "";
  const req = a.social?.incoming?.length || 0;
  if (req) return `+${req}`;
  const online = (a.social?.friends || []).filter((f) => f.presence.status !== "offline").length;
  return online ? String(online) : "";
}

function renderFriendsBtn() {
  const a = ejg.account.state;
  const b = $("#friends-btn");
  b.hidden = !a?.enabled;
  const n = friendsBadge();
  b.textContent = `♥ FRIENDS${n ? ` ${n}` : ""}`;
}
$("#friends-btn").addEventListener("click", () => openSocial("friends"));
ejg.account.onChange(renderFriendsBtn);
renderFriendsBtn();

function openGuides(gameId, guideId = null) {
  const g = ejg.library.byId(gameId);
  if (!g) return;
  if (!detail.hidden) closeDetail(true);
  guideView?.destroy();
  guidesEl.hidden = false;
  guideView = createGuideView({
    ejg,
    root: guidesEl,
    focus,
    gameId,
    gameTitle: g.title.toUpperCase(),
    guide: guideId,
    labels: {
      title: "GUIDES",
      saved: "SAVED",
      continue: "CONTINUE",
      community: "COMMUNITY",
      count: (n) => `${n} GUIDES`,
      more: "MORE GUIDES",
      loading: "LOADING…",
      opening: "LOADING GUIDE…",
      pin: "☆ SAVE",
      pinned: "★ SAVED",
      browser: "STEAM",
      back: "BACK",
      search: "SEARCH",
      index: "INDEX",
      end: "GAME OVER · THE END",
    },
    onExit: closeGuides,
    onChange: () => updateHints(),
  });
  ejg.sound.play("open");
}
function closeGuides() {
  if (!guideView) return false;
  guideView.destroy();
  guideView = null;
  guidesEl.hidden = true;
  const el = list.querySelector(`[data-game-id="${state.selected}"]`);
  if (el) focus.focus(el, { silent: true });
  updateHints(ejg.library.byId(state.selected));
  return true;
}

// ─────────────── mando ───────────────
const focus = createFocus({
  root: document.body,
  scroll: "nearest",
  onChange: (el) => {
    const id = Number(el.dataset.gameId);
    if (id) showCard(ejg.library.byId(id));
    else if (state.view !== "library") shop.onFocus(el);
  },
});
const inLib = () => state.view === "library";
function jump(n) {
  const items = [...list.querySelectorAll(".item")];
  const i = items.indexOf(focus.current);
  const next = items[Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i) + n))];
  if (next) focus.focus(next);
}
const gv = (a) => !!(guideView && guideView.nav(a));
bindNav(focus, {
  back: () => {
    if (gv("back")) return true;
    if (!detail.hidden) return closeDetail(), true;
    if (inLib()) return false;
    if (shop.back()) return true;
    goTab(0); // a la pantalla principal
    return true;
  },
  up: () => gv("up"),
  down: () => gv("down"),
  lt: () => gv("lt"),
  left: () => (guideView ? false : inLib() ? (detail.hidden && list.contains(focus.current) ? (jump(-10), true) : false) : shop.nav("left")),
  right: () => (guideView ? false : inLib() ? (detail.hidden && list.contains(focus.current) ? (jump(10), true) : false) : shop.nav("right")),
  x: () => {
    if (gv("x")) return true;
    if (!inLib()) return shop.key("x");
    const id = Number(focus.current?.dataset.gameId);
    if (id && detail.hidden) openDetail(id);
    return true;
  },
  y: () => {
    if (gv("y")) return true;
    if (!inLib()) return shop.key("y");
    const id = Number(focus.current?.dataset.gameId) || state.selected;
    if (id) ejg.game.favorite(id);
    return true;
  },
  rt: () => gv("rt") || (!inLib() && shop.key("rt")),
  lb: () => gv("lb") || guideView || (shop.hasDialog() || switchTab(-1), true),
  rb: () => gv("rb") || guideView || (shop.hasDialog() || switchTab(1), true),
  menu: () => (ejg.ui.open("menu"), true),
  view: () => gv("view") || (ejg.ui.open("search"), true),
});
ejg.on("focus-return", () => focus.restore());
// Letra = saltar al primer juego que empieza por ella (en SHOP, buscar).
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1 || e.target.tagName === "INPUT") return;
  if (state.view === "shop") return shop.typeKey(e);
  // E y F son atajos (opciones/favorito): no saltan de letra.
  if (!inLib() || guideView || !/[a-df-z0-9]/i.test(e.key) || !detail.hidden) return;
  const k = e.key.toLowerCase();
  const el = [...list.querySelectorAll(".item")].find((b) => b.textContent.trim().toLowerCase().startsWith(k));
  if (el) focus.focus(el);
});
document.addEventListener("contextmenu", (e) => {
  const t = e.target.closest?.("[data-game-id]");
  if (t) {
    e.preventDefault();
    openDetail(Number(t.dataset.gameId));
  }
});

// ─────────────── SHOP y DOWNLOADS (store.js) ───────────────
const hintBar = hints($("#press"), []);
const shop = createStore({
  ejg,
  root: $("#view"),
  screen: $(".screen"),
  ficha: $("#repack"),
  focus,
  hints: hintBar,
  ticker: (t) => ($("#ticker").textContent = String(t || "").toUpperCase()),
  tab: () => state.view,
  goTab,
  onChange: () => {
    const n = pending();
    const el = $("#tab-n");
    if (el) (el.hidden = !n), (el.textContent = String(n));
    updateStatus();
  },
});
// Línea de estado con la descarga actual (solo en la pantalla principal).
const statusEl = $("#status");
statusEl.addEventListener("click", () => goTab("downloads"));
function updateStatus() {
  if (!inLib()) statusEl.hidden = true;
  else shop.status(statusEl);
}
ejg.ui.onView(({ view, slug, gameId, guideId, userId }) => {
  if (view === "guides" && gameId) return openGuides(gameId, guideId);
  if (view === "friends" || view === "profile") return openSocial(view, userId ?? null);
  closeGuides();
  if (view === "downloads") return goTab("downloads");
  if (!ejg.explore.enabled) return;
  if (state.view !== "shop") goTab("shop");
  if (view === "repack" && slug) shop.openRepack(slug);
});
ejg.explore.onEnabled(() => {
  if (!ejg.explore.enabled && state.view === "shop") goTab(state.filter);
  else renderTabs();
});

const refresh = debounce(() => {
  renderTabs();
  renderList();
  if (!inLib()) return;
  const g = ejg.library.byId(state.selected);
  if (g) showCard(g);
}, 60);
ejg.library.onChange(refresh);
ejg.on("running", refresh);
ejg.game.onState(refresh);
ejg.on("settings", () => {
  refresh();
  const g = ejg.library.byId(state.selected);
  if (g) drawArt(g.media.coverThumb);
  shop.redraw();
});
ejg.on("profile", renderTabs);

function updateHints(g) {
  if (guideView) return hintBar.set(guideView.hints().map(([a, l]) => [a, GUIDE_HINTS[l] || l.toUpperCase()]));
  if (!inLib()) return;
  hintBar.set([
    ["accept", "START"],
    ["x", "INFO"],
    ["y", "FAV"],
    ["lb", "PESTAÑA"],
  ]);
}

renderTabs();
renderList();
updateHints();
updateStatus();
const first = list.querySelector(".item");
if (first) focus.focus(first, { instant: true, silent: true });
