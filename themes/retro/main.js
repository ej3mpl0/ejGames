// Tema "Retro": menú arcade en una pantalla CRT. Las carátulas se pixelan y
// se reducen a la paleta elegida en un <canvas>.

import { h, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { playtime, relative, year, description } from "/_sdk/kit/format.js";
import { visible, sort } from "/_sdk/kit/library.js";
import { clock } from "/_sdk/kit/clock.js";
import { hints } from "/_sdk/kit/hints.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const list = $("#list");
const detail = $("#detail");
const FILTERS = [
  ["all", "ALL"],
  ["installed", "INSTALLED"],
  ["uninstalled", "NOT INSTALLED"],
  ["fav", "FAV ★"],
];
const state = { filter: 0, selected: null };
clock($("#clock"));

const games = () => {
  let l = sort(visible(ejg.library.all), "title");
  const f = FILTERS[state.filter][0];
  if (f === "fav") l = l.filter((g) => g.favorite);
  if (f === "installed") l = l.filter((g) => g.installed !== false);
  if (f === "uninstalled") l = l.filter((g) => g.installed === false);
  return l;
};

function renderTabs() {
  $("#tabs").replaceChildren(
    ...FILTERS.map(([, l], i) => h("button", { class: "tab" + (i === state.filter ? " on" : ""), "data-focus": "", onclick: () => setFilter(i) }, l)),
  );
  const total = visible(ejg.library.all).length;
  $("#credits").textContent = `CREDIT ${String(Math.min(total, 99)).padStart(2, "0")}`;
  $("#p1").textContent = `1UP ${(ejg.profile?.name || "PLAYER").toUpperCase().slice(0, 10)}`;
}

function setFilter(i) {
  state.filter = (i + FILTERS.length) % FILTERS.length;
  renderTabs();
  renderList();
  const first = list.querySelector(".item");
  if (first) focus.focus(first, { instant: true });
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
          { class: "item" + (g.missing ? " missing" : "") + (g.installed === false ? " uninstalled" : ""), "data-focus": "", "data-game-id": g.id, onclick: () => start(g.id) },
          g.title,
          g.installed === false ? h("span", { class: "dl" }, "⤓") : null,
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
const SIZES = { low: [160, 240], medium: [84, 126], high: [44, 66] };
function cssColor(v) {
  const c = document.createElement("canvas").getContext("2d");
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const hex = c.fillStyle;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
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

/** drawImage que rellena el lienzo recortando (como object-fit: cover). */
function drawCover(ctx, im, w, hh) {
  const s = Math.max(w / im.naturalWidth, hh / im.naturalHeight);
  const sw = w / s;
  const sh = hh / s;
  ctx.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 4, sw, sh, 0, 0, w, hh);
}

/** Paletas monocromas: 4 tonos por luminancia. Resto: posterizado a 4 niveles por canal. */
function quantize(ctx, w, hh) {
  let data;
  try {
    data = ctx.getImageData(0, 0, w, hh);
  } catch {
    return; // lienzo "manchado": se queda solo pixelado
  }
  const p = ejg.settings.palette || "arcade";
  const d = data.data;
  if (p === "gameboy" || p === "phosphor" || p === "amber") {
    const shades = [cssColor("--bg"), cssColor("--dim"), cssColor("--fg"), cssColor("--hi")];
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
      const s = shades[Math.min(3, Math.floor(l * 4))];
      d[i] = s[0];
      d[i + 1] = s[1];
      d[i + 2] = s[2];
    }
  } else {
    const q = (v) => Math.round(v / 85) * 85;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = q(d[i]);
      d[i + 1] = q(d[i + 1]);
      d[i + 2] = q(d[i + 2]);
    }
  }
  ctx.putImageData(data, 0, 0);
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
    g.installed === false ? row("STATUS", "NOT INSTALLED") : null,
    ].filter(Boolean),
  );
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
    h("button", { "data-focus": "", onclick: () => (closeDetail(), start(g.id)) }, g.installed === false ? "⤓ INSTALL" : "▶ START"),
    h("button", { "data-focus": "", onclick: () => ejg.game.favorite(g.id) }, "★ FAV"),
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
function closeDetail() {
  detail.hidden = true;
  detail.replaceChildren();
  const el = list.querySelector(`[data-game-id="${state.selected}"]`);
  if (el) focus.focus(el, { silent: true });
}

// ─────────────── mando ───────────────
const focus = createFocus({
  root: document.body,
  scroll: "nearest",
  onChange: (el) => {
    const id = Number(el.dataset.gameId);
    if (id) showCard(ejg.library.byId(id));
  },
});
function jump(n) {
  const items = [...list.querySelectorAll(".item")];
  const i = items.indexOf(focus.current);
  const next = items[Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i) + n))];
  if (next) focus.focus(next);
}
bindNav(focus, {
  back: () => (!detail.hidden ? (closeDetail(), true) : false),
  left: () => (detail.hidden && focus.current?.classList.contains("item") ? (jump(-10), true) : false),
  right: () => (detail.hidden && focus.current?.classList.contains("item") ? (jump(10), true) : false),
  x: () => {
    const id = Number(focus.current?.dataset.gameId);
    if (id && detail.hidden) openDetail(id);
    return true;
  },
  y: () => {
    const id = Number(focus.current?.dataset.gameId) || state.selected;
    if (id) ejg.game.favorite(id);
    return true;
  },
  lb: () => (setFilter(state.filter - 1), true),
  rb: () => (setFilter(state.filter + 1), true),
  menu: () => (ejg.ui.open("menu"), true),
  view: () => (ejg.ui.open("search"), true),
});
ejg.on("focus-return", () => focus.restore());
// Letra = saltar al primer juego que empieza por ella.
window.addEventListener("keydown", (e) => {
  // E y F son atajos (opciones/favorito): no saltan de letra.
  if (e.ctrlKey || e.altKey || e.key.length !== 1 || !/[a-df-z0-9]/i.test(e.key) || !detail.hidden) return;
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

const refresh = debounce(() => {
  renderTabs();
  renderList();
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
});
ejg.on("profile", renderTabs);

const hintBar = hints($("#press"), []);
function updateHints(g) {
  hintBar.set([
    ["accept", g && g.installed === false ? "INSTALL" : "START"],
    ["x", "INFO"],
    ["y", "FAV"],
    ["lb", "FILTRO"],
  ]);
}

renderTabs();
renderList();
updateHints();
const first = list.querySelector(".item");
if (first) focus.focus(first, { instant: true, silent: true });
