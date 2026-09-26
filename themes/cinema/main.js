// Tema "Cinema": juego destacado con tráiler, filas horizontales y ficha modal.

import { h, img, hueOf, keyed, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { attachStream } from "/_sdk/kit/media.js";
import { playtime, relative, year, description, SOURCE_LABEL } from "/_sdk/kit/format.js";
import { visible, sort, recent, favorites, byGenre } from "/_sdk/kit/library.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const main = $("#main");
const rowsEl = $("#rows");
const modal = $("#modal");
const state = { featured: null, muted: !ejg.settings.heroSound, modalId: null, returnTo: null };
const randomSeed = Math.random();

const PLAY = '<svg viewBox="0 0 24 24"><path d="M6 4v16l14-8z"/></svg>';
const INFO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
const games = () => visible(ejg.library.all);
const installed = () => {
  const inst = games().filter((g) => g.installed !== false);
  return inst.length ? inst : games();
};
const DL = '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>';

function pickFeatured() {
  const all = installed();
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
      h("div", { class: "empty" }, h("h1", null, "Aquí irán tus juegos"), h("p", null, "Añade una carpeta o importa tus tiendas y ejGames se encarga del resto."), h("button", { class: "hbtn play", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "Añadir juegos")),
    );
    return;
  }
  $("#hero").style.display = "";
  if (state.featured === g.id) return;
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
    h(
      "div",
      { class: "hero-meta" },
      g.rating ? h("span", { class: "match" }, `${g.rating}% de acierto`) : null,
      g.releaseDate ? h("span", null, year(g.releaseDate)) : null,
      h("span", { class: "pill" }, SOURCE_LABEL[g.source] || g.source),
      g.playtime ? h("span", null, playtime(g.playtime)) : null,
      g.achievements ? h("span", null, `🏆 ${g.achievements.unlocked}/${g.achievements.total}`) : null,
    ),
    h("p", { class: "hero-desc" }, g.shortDescription || ""),
    h(
      "div",
      { class: "hero-actions", "data-focus-group": "hero" },
      h("button", { class: "hbtn play", "data-focus": "", id: "hero-play", onclick: () => launch(g.id), html: `${g.installed === false ? DL : PLAY}<span>${ejg.game.isRunning(g.id) ? "En juego" : g.installed === false ? "Instalar" : "Jugar"}</span>` }),
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
  if (!url || state.featured !== g.id || !modal.hidden) return;
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
  const sig = `${g.id}:${g.media.coverThumb}:${g.media.heroThumb}:${g.media.logo}:${portrait}:${ejg.game.isRunning(g.id)}:${g.installed}:${opts.progress ? g.playtime : ""}`;
  if (prev && prev.__sig === sig) return prev;
  const el = h(
    "button",
    { class: "card" + (g.installed === false ? " uninstalled" : ""), "data-focus": "", "data-game-id": g.id, onclick: () => openModal(g.id), title: g.title },
    h("div", { class: "art" }, artFor(g, portrait ? "portrait" : "landscape")),
    ejg.game.isRunning(g.id) ? h("span", { class: "tag" }, "EN JUEGO") : null,
    g.installed === false ? h("span", { class: "dl", html: DL }) : null,
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
  const all = installed();
  if (!all.length) return;
  const toInstall = games().filter((g) => g.installed === false);
  const rec = recent(all, 20);
  const rows = [
    row("row-rec", "Seguir jugando", rec, { progress: true }),
    row("row-fav", "Mi lista", sort(favorites(all), "title")),
    row("row-new", "Añadidos recientemente", sort(all, "added").slice(0, 20)),
    row("row-unplayed", "Aún sin estrenar", sort(all.filter((g) => !g.playtime), "rating").slice(0, 20)),
    row("row-top", "Mejor valorados", sort(all.filter((g) => g.rating), "rating").slice(0, 20)),
  ];
  if (toInstall.length && all !== toInstall) {
    rows.push(row("row-install", "En tu biblioteca, por instalar", [...recent(toInstall, 20), ...sort(toInstall.filter((g) => !g.lastPlayed), "rating")].slice(0, 30)));
  }
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
        h("button", { class: "hbtn play", "data-focus": "", id: "m-play", onclick: () => launch(g.id), html: `${g.installed === false ? DL : PLAY}<span>${ejg.game.isRunning(g.id) ? "En juego" : g.installed === false ? "Instalar" : "Jugar"}</span>` }),
        favBtn,
        h("button", { class: "round", "data-focus": "", title: "Editar (X)", onclick: () => ejg.game.edit(g.id) }, "✎"),
        h("button", { class: "round", "data-focus": "", title: "Carpeta", onclick: () => ejg.game.openFolder(g.id) }, "📁"),
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
      h("div", { class: "hero-meta" }, g.rating ? h("span", { class: "match" }, `${g.rating}% de acierto`) : null, h("span", null, year(g.releaseDate)), h("span", { class: "pill" }, SOURCE_LABEL[g.source] || g.source), h("span", null, g.playtime ? `${playtime(g.playtime)} jugadas · ${relative(g.lastPlayed)}` : "Sin jugar")),
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
  const sheet = h("div", { class: "sheet", "data-focus-trap": "" }, sheetHero, body, h("h3", { class: "sec" }, "Tráileres y capturas"), eps);
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

function closeModal() {
  modalRelease();
  modal.hidden = true;
  modal.replaceChildren();
  state.modalId = null;
  if (state.returnTo?.isConnected) focus.focus(state.returnTo, { silent: true });
  const g = ejg.library.byId(state.featured);
  if (g && main.scrollTop < 200 && ejg.settings.heroTrailer !== false) heroTimer = setTimeout(() => startHeroTrailer(g), 1500);
}
modal.addEventListener("click", (e) => e.target === modal && closeModal());

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
    if (el.closest("#hero")) main.scrollTo({ top: 0, behavior: "smooth" });
    else if (el.closest(".row")) {
      const r = el.closest(".row");
      const top = r.offsetTop - 90;
      if (Math.abs(main.scrollTop - top) > 40) main.scrollTo({ top, behavior: "smooth" });
    }
  },
});
bindNav(focus, {
  back: () => {
    if (!modal.hidden) return closeModal(), true;
    if (main.scrollTop > 50) {
      main.scrollTo({ top: 0, behavior: "smooth" });
      const p = $("#hero-play");
      if (p) focus.focus(p, { noScroll: true });
      return true;
    }
    return false;
  },
  y: () => {
    const id = state.modalId || Number(focus.current?.dataset.gameId);
    if (id) ejg.game.favorite(id);
    return true;
  },
  x: () => {
    const id = state.modalId || Number(focus.current?.dataset.gameId);
    if (id) ejg.game.edit(id);
    return true;
  },
  menu: () => (ejg.ui.open("menu"), true),
  view: () => (ejg.ui.open("search"), true),
});
ejg.on("focus-return", () => focus.restore());

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
  hintBar.set(
    modal.hidden
      ? [["accept", "Más información"], ["y", "Mi lista"], ["x", "Editar"], ["back", "Arriba"], ["menu", "Menú"]]
      : [["accept", "Elegir"], ["back", "Cerrar"], ["y", "Mi lista"], ["x", "Editar"]],
  );
}
new MutationObserver(updateHints).observe(modal, { attributes: true, attributeFilter: ["hidden"] });

renderProfile();
renderHero();
renderRows();
updateHints();
focus.focus($("#hero-play") || rowsEl.querySelector("[data-focus]") || document.querySelector("[data-focus]"), { instant: true, silent: true });
