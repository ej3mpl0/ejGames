// Tema "Cinema": juego destacado con tráiler, filas horizontales y ficha modal.
// Explorar y Mis descargas están en store.js.

import { h, img, hueOf, keyed, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { attachStream } from "/_sdk/kit/media.js";
import { playtime, relative, year, description } from "/_sdk/kit/format.js";
import { visible, sort, recent, favorites, byGenre } from "/_sdk/kit/library.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";
import { createGuideView, starsText } from "/_sdk/kit/guides.js";
import { percent, speed } from "/_sdk/kit/store.js";
import { createStore } from "./store.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const main = $("#main");
const rowsEl = $("#rows");
const modal = $("#modal");
const state = { featured: null, muted: !ejg.settings.heroSound, modalId: null, returnTo: null, view: "home", prevView: "home", homeScroll: 0 };
const randomSeed = Math.random();

const PLAY = '<svg viewBox="0 0 24 24"><path d="M6 4v16l14-8z"/></svg>';
const INFO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
const games = () => visible(ejg.library.all);

function pickFeatured() {
  const all = games();
  if (!all.length) return null;
  const withArt = all.filter((g) => g.media.hero || g.media.heroThumb);
  const pool = withArt.length ? withArt : all;
  const mode = ejg.settings.featured || "recent";
  if (mode === "favorite") {
    const f = pool.filter((g) => g.favorite);
    if (f.length) return f[Math.floor(randomSeed * f.length)];
  }
  if (mode === "random") return pool[Math.floor(randomSeed * pool.length)];
  return recent(pool, 1)[0] || pool[Math.floor(randomSeed * pool.length)];
}

// ─────────────── lo que cambia al jugar ───────────────
const playLabel = (g) => (ejg.game.isRunning(g.id) ? "En juego" : "Jugar");

function heroMeta(g) {
  return h(
    "div",
    { class: "hero-meta" },
    g.rating ? h("span", { class: "match" }, `${g.rating}% de acierto`) : null,
    g.releaseDate ? h("span", null, year(g.releaseDate)) : null,
    g.genres?.[0] ? h("span", { class: "pill" }, g.genres[0]) : null,
    g.playtime ? h("span", null, playtime(g.playtime)) : null,
    g.achievements ? h("span", null, `🏆 ${g.achievements.unlocked}/${g.achievements.total}`) : null,
  );
}

function sheetMeta(g) {
  return h(
    "div",
    { class: "hero-meta" },
    g.rating ? h("span", { class: "match" }, `${g.rating}% de acierto`) : null,
    h("span", null, year(g.releaseDate)),
    g.genres?.[0] ? h("span", { class: "pill" }, g.genres[0]) : null,
    h("span", null, g.playtime ? `${playtime(g.playtime)} jugadas · ${relative(g.lastPlayed)}` : "Sin jugar"),
    g.achievements ? h("span", null, `🏆 ${g.achievements.unlocked}/${g.achievements.total}`) : null,
  );
}

// ─────────────── portada ───────────────
let heroRelease = () => {};
let heroVideo = null;
let heroTimer = 0;
function renderHero() {
  const g = pickFeatured();
  const media = $("#hero-media");
  const info = $("#hero-info");
  if (!g) {
    $("#hero").style.display = "none";
    rowsEl.replaceChildren(
      h("div", { class: "empty" }, h("h1", null, "Aquí irán tus juegos"), h("p", null, "Añade la carpeta donde tienes tus juegos y ejGames se encarga del resto."), h("button", { class: "hbtn play", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "Añadir juegos")),
    );
    return;
  }
  $("#hero").style.display = "";
  if (state.featured === g.id) {
    // El mismo juego: solo lo que cambia al jugar (horas, logros, «En juego»).
    info.querySelector(".hero-meta")?.replaceWith(heroMeta(g));
    const label = $("#hero-play span");
    if (label) label.textContent = playLabel(g);
    return;
  }
  state.featured = g.id;
  heroRelease();
  clearTimeout(heroTimer);
  document.body.classList.remove("playing-hero");
  media.style.backgroundImage = `url("${g.media.hero || g.media.heroThumb}")`;
  media.replaceChildren();
  const title = g.media.logo ? img(g.media.logo, { class: "hero-logo", loading: "eager" }) : h("h1", { class: "hero-title" }, g.title);
  const muteBtn = h("button", { class: "mute", "data-focus": "", title: "Sonido", onclick: toggleMute }, state.muted ? "🔇" : "🔊");
  info.replaceChildren(
    title,
    heroMeta(g),
    h("p", { class: "hero-desc" }, g.shortDescription || ""),
    h(
      "div",
      { class: "hero-actions", "data-focus-group": "hero" },
      h("button", { class: "hbtn play", "data-focus": "", id: "hero-play", onclick: () => launch(g.id), html: `${PLAY}<span>${playLabel(g)}</span>` }),
      h("button", { class: "hbtn info", "data-focus": "", onclick: () => openModal(g.id), html: `${INFO}<span>Más información</span>` }),
    ),
  );
  $("#hero").append(muteBtn);
  $("#hero").querySelectorAll(".mute").forEach((m) => m !== muteBtn && m.remove());
  if (ejg.settings.heroTrailer !== false) heroTimer = setTimeout(() => startHeroTrailer(g), 2500);
}

async function startHeroTrailer(g) {
  const d = await ejg.game.details(g.id).catch(() => null);
  const url = d?.trailers?.[0]?.url || g.media.microtrailer;
  if (!url || state.featured !== g.id || !modal.hidden || state.view !== "home") return;
  const v = h("video", { playsInline: true, autoplay: true });
  v.muted = state.muted;
  $("#hero-media").append(v);
  const rel = await attachStream(v, url);
  heroVideo = v;
  heroRelease = () => {
    rel();
    v.remove();
    heroVideo = null;
    document.body.classList.remove("playing-hero");
  };
  v.onplaying = () => {
    v.classList.add("on");
    document.body.classList.add("playing-hero");
  };
  v.onended = () => heroRelease();
  v.play().catch(() => {});
}

function toggleMute() {
  state.muted = !state.muted;
  if (heroVideo) heroVideo.muted = state.muted;
  document.querySelectorAll(".mute").forEach((m) => (m.textContent = state.muted ? "🔇" : "🔊"));
}

// ─────────────── filas ───────────────
function card(g, prev, opts = {}) {
  const portrait = ejg.settings.cardStyle === "portrait";
  const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}:${g.media.logo}:${portrait}:${ejg.game.isRunning(g.id)}:${opts.progress ? g.playtime : ""}`;
  if (prev && prev.__sig === sig) return prev;
  const el = h(
    "button",
    { class: "card", "data-focus": "", "data-game-id": g.id, onclick: () => openModal(g.id), title: g.title },
    h("div", { class: "art" }, artFor(g, portrait ? "portrait" : "landscape")),
    ejg.game.isRunning(g.id) ? h("span", { class: "tag" }, "EN JUEGO") : null,
    opts.progress && g.playtime ? h("div", { class: "bar" }, h("i", { style: { width: `${Math.min(100, 12 + Math.log2(1 + g.playtime / 3600) * 14)}%` } })) : null,
  );
  el.__sig = sig;
  return el;
}

function row(id, title, list, opts) {
  if (!list.length) return null;
  const track = h("div", { class: "track", "data-focus-group": id });
  keyed(track, list, (g) => g.id, (g, prev) => card(g, prev, opts));
  return h("section", { class: "row", id }, h("h2", null, title), track);
}

function renderRows() {
  const all = games();
  if (!all.length) return;
  const rec = recent(all, 20);
  const rows = [
    row("row-rec", "Seguir jugando", rec, { progress: true }),
    row("row-fav", "Mi lista", sort(favorites(all), "title")),
    row("row-new", "Añadidos recientemente", sort(all, "added").slice(0, 20)),
    row("row-unplayed", "Aún sin estrenar", sort(all.filter((g) => !g.playtime), "rating").slice(0, 20)),
    row("row-top", "Mejor valorados", sort(all.filter((g) => g.rating), "rating").slice(0, 20)),
  ];
  if (ejg.settings.genreRows !== false) byGenre(all, 3).slice(0, 6).forEach((grp) => rows.push(row(`row-g-${grp.name}`, grp.name, grp.games)));
  rows.push(row("row-all", "Toda tu biblioteca", sort(all, "title")));
  rowsEl.replaceChildren(...rows.filter(Boolean));
}

// ─────────────── ficha modal ───────────────
let modalRelease = () => {};
async function openModal(id) {
  const g = ejg.library.byId(id);
  if (!g) return;
  heroRelease();
  state.modalId = id;
  state.returnTo = focus.current;
  const heroUrl = g.media.hero || g.media.heroThumb || g.media.header;
  const sheetHero = h("div", { class: "sheet-hero", style: heroUrl ? { backgroundImage: `url("${heroUrl}")` } : {} });
  const favBtn = h("button", { class: "round" + (g.favorite ? " on" : ""), "data-focus": "", id: "m-fav", title: "Mi lista (Y)", onclick: () => ejg.game.favorite(g.id) }, g.favorite ? "✓" : "+");
  sheetHero.append(
    h("button", { class: "close", "data-focus": "", onclick: closeModal, title: "Cerrar" }, "✕"),
    h(
      "div",
      { class: "over" },
      g.media.logo ? img(g.media.logo, { loading: "eager" }) : h("h1", { class: "hero-title" }, g.title),
      h(
        "div",
        { class: "hero-actions", "data-focus-group": "sheet-actions" },
        h("button", { class: "hbtn play", "data-focus": "", id: "m-play", onclick: () => launch(g.id), html: `${PLAY}<span>${playLabel(g)}</span>` }),
        favBtn,
        h("button", { class: "round", "data-focus": "", title: "Editar (X)", onclick: () => ejg.game.edit(g.id) }, "✎"),
        h("button", { class: "round", "data-focus": "", title: "Carpeta", onclick: () => ejg.game.openFolder(g.id) }, "📁"),
        h("button", { class: "round", "data-focus": "", title: "Guías de la comunidad", onclick: () => openGuides(g.id) }, "📖"),
        h("button", { class: "round", "data-focus": "", title: "Trucos", onclick: () => ejg.trainer.open(g.id) }, "✨"),
        h("button", { class: "round", "data-focus": "", title: "Mapa", onclick: () => ejg.maps.open(g.id) }, "🗺️"),
      ),
    ),
  );
  const desc = h("div", { class: "desc" }, g.shortDescription || "");
  const body = h(
    "div",
    { class: "sheet-body" },
    h(
      "div",
      null,
      sheetMeta(g),
      desc,
    ),
    h(
      "div",
      { class: "side" },
      h("div", null, "Géneros: ", h("b", null, (g.genres || []).join(", ") || "—")),
      h("div", null, "Desarrollo: ", h("b", null, g.developer || "—")),
      h("div", null, "Edición: ", h("b", null, g.publisher || "—")),
      h("div", null, "Etiquetas: ", h("b", null, (g.tags || []).slice(0, 5).join(", ") || "—")),
    ),
  );
  const eps = h("div", { class: "eps", "data-focus-group": "eps" });
  const guideRow = h("div", { class: "cg-row-wrap" });
  const sheet = h("div", { class: "sheet", "data-focus-trap": "" }, sheetHero, body, h("h3", { class: "sec" }, "Tráileres y capturas"), eps, guideRow);
  loadGuideRow(g.id, guideRow);
  modal.replaceChildren(sheet);
  modal.hidden = false;
  modal.scrollTop = 0;
  focus.focus($("#m-play"), { instant: true, silent: true });
  ejg.sound.play("open");

  const d = await ejg.game.details(id).catch(() => null);
  if (!d || state.modalId !== id) return;
  if (d.description) desc.replaceChildren(description(d.description.split("\n\n").slice(0, 5).join("\n\n")));
  const items = [];
  d.trailers.slice(0, 6).forEach((t, i) =>
    items.push(h("button", { class: "ep", "data-focus": "", onclick: () => playIn(sheetHero, t.url, false) }, t.poster ? img(t.poster) : null, h("span", null, `▶ ${t.title || `Tráiler ${i + 1}`}`))),
  );
  d.screenshots.slice(0, 9).forEach((s) => items.push(h("button", { class: "ep", "data-focus": "", onclick: () => (sheetHero.style.backgroundImage = `url("${s.url}")`, modalRelease()) }, img(s.thumb || s.url))));
  eps.replaceChildren(...items);
  if (d.trailers[0] && ejg.settings.heroTrailer !== false) playIn(sheetHero, d.trailers[0].url, true);
}

async function playIn(box, url, muted) {
  modalRelease();
  const v = h("video", { autoplay: true, playsInline: true, controls: !muted });
  v.muted = muted;
  box.prepend(v);
  const rel = await attachStream(v, url);
  modalRelease = () => {
    rel();
    v.remove();
    modalRelease = () => {};
  };
  v.play().catch(() => {});
}

function closeModal(quiet) {
  modalRelease();
  modal.hidden = true;
  modal.replaceChildren();
  state.modalId = null;
  if (quiet) return;
  if (state.returnTo?.isConnected) focus.focus(state.returnTo, { silent: true });
  const g = ejg.library.byId(state.featured);
  if (g && main.scrollTop < 200 && ejg.settings.heroTrailer !== false) heroTimer = setTimeout(() => startHeroTrailer(g), 1500);
}
modal.addEventListener("click", (e) => e.target === modal && closeModal());

// ─────────────── guías de la comunidad ───────────────
let guideView = null;
let guideReturn = null;
const guidesEl = $("#guides");

function openGuides(gameId, guideId = null) {
  const g = ejg.library.byId(gameId);
  if (!g) return;
  heroRelease();
  modalRelease();
  if (!guideView) guideReturn = focus.current;
  guideView?.destroy();
  const art = g.media.hero || g.media.heroThumb || g.media.header;
  $("#cg-bg").style.backgroundImage = art ? `url("${art}")` : "";
  guidesEl.hidden = false;
  guideView = createGuideView({
    ejg,
    root: $("#cg-inner"),
    focus,
    gameId,
    gameTitle: g.title,
    layout: "grid",
    guide: guideId,
    labels: { title: "Guías", saved: "Mi lista", continue: "Seguir viendo", community: "De la comunidad", pin: "+ Mi lista", pinned: "✓ En mi lista" },
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
  const back = guideReturn?.isConnected ? guideReturn : null;
  guideReturn = null;
  if (back) focus.focus(back, { silent: true });
  updateHints();
  return true;
}

/** Fila «Guías» en la ficha, como una fila más del catálogo. */
async function loadGuideRow(id, wrap) {
  const [shelf, list] = await Promise.all([ejg.guides.shelf(id).catch(() => null), ejg.guides.list(id, {}).catch(() => null)]);
  if (state.modalId !== id || !list || list.appid == null) return;
  const mine = [...(shelf?.pinned || []), ...(shelf?.recent || [])].slice(0, 4);
  const top = list.items.filter((x) => !mine.some((m) => m.id === x.id)).slice(0, 10 - mine.length);
  const ep = (it, sub) =>
    h(
      "button",
      { class: "ep cg-ep", "data-focus": "", onclick: () => openGuides(id, it.id) },
      it.preview ? img(it.preview) : null,
      h("span", null, it.title),
      h("small", null, sub),
    );
  wrap.replaceChildren(
    h("h3", { class: "sec" }, "Guías de la comunidad"),
    h(
      "div",
      { class: "eps", "data-focus-group": "guides" },
      ...mine.map((x) => ep(x, x.pinned ? "✓ En mi lista" : `Seguir viendo${x.progress ? ` · parte ${x.progress.section + 1}` : ""}`)),
      ...top.map((x) => ep(x, [starsText(x.stars), x.author].filter(Boolean).join(" · "))),
      h("button", { class: "ep cg-all", "data-focus": "", onclick: () => openGuides(id) }, h("b", null, "Ver todas"), h("small", null, `${list.total.toLocaleString("es")} guías`)),
    ),
  );
}

async function launch(id) {
  if (ejg.game.isRunning(id)) return;
  heroRelease();
  modalRelease();
  try {
    await ejg.game.launch(id);
  } catch (e) {
    ejg.ui.toast(String(e.message || e), "error");
  }
}

// ─────────────── foco, scroll y eventos ───────────────
const focus = createFocus({
  root: document.body,
  scroll: "nearest",
  onChange: (el, _prev, { pointer }) => {
    // Con el ratón no se desplaza la página (saltaría mientras lo mueves).
    if (pointer) return;
    if (el.closest("#hero, .bb")) main.scrollTo({ top: 0, behavior: "smooth" });
    else if (el.closest(".row, .s-row")) {
      const r = el.closest(".row, .s-row");
      const top = r.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 90;
      if (Math.abs(main.scrollTop - top) > 40) main.scrollTo({ top, behavior: "smooth" });
    }
  },
});
const gv = (a) => !!(guideView && guideView.nav(a));
bindNav(focus, {
  back: () => {
    if (gv("back")) return true;
    if (shop.back()) return true;
    if (!modal.hidden) return closeModal(), true;
    if (state.view !== "home") return setView(state.view === "downloads" && state.prevView === "explore" ? "explore" : "home"), true;
    if (main.scrollTop > 50) {
      main.scrollTo({ top: 0, behavior: "smooth" });
      const p = $("#hero-play");
      if (p) focus.focus(p, { noScroll: true });
      return true;
    }
    return false;
  },
  up: () => gv("up"),
  down: () => gv("down"),
  lt: () => gv("lt"),
  rt: () => gv("rt"),
  y: () => {
    if (gv("y")) return true;
    if (state.view !== "home") return state.view === "explore" && !shop.layer() && shop.search(), true;
    const id = state.modalId || Number(focus.current?.dataset.gameId);
    if (id) ejg.game.favorite(id);
    return true;
  },
  x: () => {
    if (gv("x")) return true;
    if (state.view !== "home") return false;
    const id = state.modalId || Number(focus.current?.dataset.gameId);
    if (id) ejg.game.edit(id);
    return true;
  },
  menu: () => (ejg.ui.open("menu"), true),
  view: () => gv("view") || (state.view === "home" ? ejg.ui.open("search") : shop.layer() || shop.search(), true),
  // Al final de una fila, la derecha no salta a otra fila.
  right: () => {
    if (guideView) return false;
    const t = focus.current?.closest(".track");
    const items = t ? t.querySelectorAll("[data-focus]") : [];
    return !!t && items[items.length - 1] === focus.current;
  },
  lb: () => gv("lb") || guideView || (shop.layer() || !modal.hidden || stepView(-1), true),
  rb: () => gv("rb") || guideView || (shop.layer() || !modal.hidden || stepView(1), true),
});
ejg.on("focus-return", () => focus.restore());

// ─────────────── Explorar y Mis descargas ───────────────
const shop = createStore({
  ejg,
  main,
  focus,
  root: $("#shop"),
  searchBox: $("#nsearch"),
  searchInput: $("#nav-q"),
  goView: (v) => setView(v),
  onUi: () => updateHints(),
  onQueue: () => updateDownloadsUi(),
});

const views = () => ["home", ...(ejg.explore.enabled ? ["explore"] : []), "downloads"];
function setView(v) {
  if (v === "explore" && !ejg.explore.enabled) v = "home";
  if (v === state.view) return;
  if (state.view === "home") {
    state.homeScroll = main.scrollTop;
    heroRelease();
    clearTimeout(heroTimer);
  }
  if (!modal.hidden) closeModal(true);
  state.prevView = state.view;
  state.view = v;
  document.documentElement.dataset.view = v;
  shop.show(v);
  main.scrollTo({ top: v === "home" ? state.homeScroll : 0, behavior: "instant" });
  document.body.classList.toggle("scrolled", main.scrollTop > 40);
  if (v === "home") {
    const g = ejg.library.byId(state.featured);
    if (g && main.scrollTop < 200 && ejg.settings.heroTrailer !== false) heroTimer = setTimeout(() => startHeroTrailer(g), 1500);
    focus.focus($("#hero-play") || rowsEl.querySelector("[data-focus]") || $("#nav-home"), { instant: true, silent: true });
  } else if (!focus.first($("#shop"))) focus.focus($(v === "explore" ? "#nav-explore" : "#nav-dl"), { silent: true, noScroll: true });
  renderNav();
  updateHints();
}
function stepView(d) {
  const list = views();
  setView(list[(list.indexOf(state.view) + d + list.length) % list.length]);
}
function renderNav() {
  $("#nav-home").classList.toggle("on", state.view === "home");
  $("#nav-explore").classList.toggle("on", state.view === "explore");
  $("#nav-dl").classList.toggle("on", state.view === "downloads");
}

// Contador de «Mis descargas» e indicador con anillo en la barra superior.
function updateDownloadsUi() {
  const g = shop.groups();
  const pending = g.all.filter((d) => d.state !== "installed");
  const count = $("#dl-count");
  count.hidden = !pending.length;
  count.textContent = String(pending.length);
  $("#nav-explore").hidden = !ejg.explore.enabled;
  const ind = $("#dl-ind");
  ind.hidden = !pending.length;
  if (!pending.length) return;
  const down = g.all.some((d) => d.state === "downloading");
  const installing = g.all.some((d) => d.state === "installing");
  const p = g.total.size ? g.total.done / g.total.size : 0;
  ind.dataset.state = down ? "down" : installing ? "install" : g.ready.length ? "ready" : "idle";
  ind.querySelector(".rg-fg").style.strokeDashoffset = String(100 - Math.round(p * 1000) / 10);
  ind.title = down
    ? `Descargando · ${percent(p)} · ${speed(g.total.speed)}`
    : installing
      ? "Instalando…"
      : g.ready.length
        ? `${g.ready.length === 1 ? "1 juego listo" : `${g.ready.length} juegos listos`} para instalar`
        : "Mis descargas";
}
$("#nav-explore").addEventListener("click", () => setView("explore"));
$("#nav-dl").addEventListener("click", () => setView("downloads"));
$("#dl-ind").addEventListener("click", () => setView("downloads"));
$("#nav-search").addEventListener("click", () => (state.view === "home" ? ejg.ui.open("search") : shop.search()));
ejg.explore.onEnabled(() => {
  if (!ejg.explore.enabled && state.view === "explore") setView("home");
  updateDownloadsUi();
});
// El host pide una vista (menú rápido, Ctrl+E / Ctrl+J, avisos…).
ejg.ui.onView(({ view, slug, gameId, guideId }) => {
  if (view === "guides" && gameId) return openGuides(gameId, guideId);
  closeGuides();
  if (view === "downloads") return setView("downloads");
  if (!ejg.explore.enabled) return;
  setView("explore");
  if (view === "repack" && slug) shop.openRepack(slug);
});

main.addEventListener(
  "scroll",
  debounce(() => {
    document.body.classList.toggle("scrolled", main.scrollTop > 40);
    // Sin tráiler cuando la portada ya no se ve (ahorra CPU/GPU).
    if (main.scrollTop > window.innerHeight * 0.6 && heroVideo) heroRelease();
  }, 50),
);
ejg.on("visibility", (v) => !v.visible && heroVideo && heroVideo.pause());

document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => ejg.ui.open(b.dataset.action)));
document.querySelectorAll("[data-go]").forEach((b) =>
  b.addEventListener("click", () => {
    if (state.view !== "home") setView("home");
    if (b.dataset.go === "top") return main.scrollTo({ top: 0, behavior: "smooth" });
    const r = document.getElementById(b.dataset.go);
    if (r) focus.first(r);
    else ejg.ui.toast("Aún no tienes favoritos: pulsa + en un juego");
  }),
);

function renderProfile() {
  const p = ejg.profile;
  const av = $("#avatar");
  av.textContent = p?.avatar ? "" : (p?.name || "?")[0].toUpperCase();
  av.style.backgroundImage = p?.avatar ? `url("${p.avatar}")` : "";
  av.style.backgroundColor = p?.color || "";
}

const refresh = debounce(() => {
  renderHero();
  renderRows();
  if (state.modalId) {
    const g = ejg.library.byId(state.modalId);
    const f = $("#m-fav");
    if (g && f) {
      f.classList.toggle("on", g.favorite);
      f.textContent = g.favorite ? "✓" : "+";
    }
    if (g) {
      modal.querySelector(".sheet-body .hero-meta")?.replaceWith(sheetMeta(g));
      const label = $("#m-play span");
      if (label) label.textContent = playLabel(g);
    }
  }
  if (focus.current && !focus.current.isConnected) {
    const again = document.querySelector(`[data-game-id="${focus.current.dataset.gameId}"]`);
    if (again) focus.focus(again, { noScroll: true, silent: true });
  }
}, 80);
ejg.library.onChange(refresh);
ejg.on("running", refresh);
ejg.game.onState(refresh);
ejg.on("collections", refresh);
ejg.on("settings", () => {
  state.featured = null;
  refresh();
});
ejg.on("profile", renderProfile);

const hintBar = hints($("#hints"), []);
function updateHints() {
  if (guideView) return hintBar.set(guideView.hints());
  const layer = shop.layer();
  hintBar.set(
    layer === "ask" || layer === "dialog"
      ? [["accept", "Elegir"], ["back", "Cancelar"]]
      : layer === "sheet"
        ? [["accept", "Elegir"], ["back", "Cerrar"]]
        : state.view === "explore"
          ? [["accept", "Más información"], ["y", "Buscar"], ["lb", "Secciones"], ["back", "Inicio"], ["menu", "Menú"]]
          : state.view === "downloads"
            ? [["accept", "Elegir"], ["lb", "Secciones"], ["back", "Volver"], ["menu", "Menú"]]
            : modal.hidden
              ? [["accept", "Más información"], ["y", "Mi lista"], ["x", "Editar"], ["back", "Arriba"], ["menu", "Menú"]]
              : [["accept", "Elegir"], ["back", "Cerrar"], ["y", "Mi lista"], ["x", "Editar"]],
  );
}
new MutationObserver(updateHints).observe(modal, { attributes: true, attributeFilter: ["hidden"] });

renderProfile();
renderHero();
renderRows();
renderNav();
updateDownloadsUi();
updateHints();
focus.focus($("#hero-play") || rowsEl.querySelector("[data-focus]") || document.querySelector("[data-focus]"), { instant: true, silent: true });
