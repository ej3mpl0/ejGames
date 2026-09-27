// Tema "Steam": barra lateral + estanterías + página de juego.
// Es el tema de referencia: úsalo como ejemplo para crear el tuyo.

import { h, img, initials, hueOf, keyed, debounce } from "/_sdk/kit/dom.js";
import { createFocus, bindNav } from "/_sdk/kit/focus.js";
import { attachStream, trailerPlayer } from "/_sdk/kit/media.js";
import { playtime, relative, date, description, SOURCE_LABEL } from "/_sdk/kit/format.js";
import { visible, sort, recent, search, inCollection, SORTS } from "/_sdk/kit/library.js";
import { artFor } from "/_sdk/kit/art.js";
import { hints } from "/_sdk/kit/hints.js";
import { downloadLabel, percent, speed } from "/_sdk/kit/store.js";
import { createStore } from "./store.js";

const ejg = await window.ejg.ready();
const $ = (s) => document.querySelector(s);
const main = $("#main");
const sideList = $("#side-list");
const filterInput = $("#filter");
const chipsEl = $("#chips");
const lightbox = $("#lightbox");

const saved = (await ejg.storage.getAll().catch(() => null)) || {};
const state = {
  tab: "home",
  gameId: null,
  prevTab: "home",
  filter: "",
  chip: saved.chip || "all",
  sort: saved.sort || "title",
  collection: null,
  scroll: 0,
};

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  sort: '<svg viewBox="0 0 24 24"><path d="M3 6h18M6 12h12M10 18h4"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4m-4 3v4m-4 3h8"/></svg>',
};
const svg = (name) => {
  const t = document.createElement("template");
  t.innerHTML = ICON[name];
  return t.content.firstChild;
};

// ─────────────── foco y mando ───────────────
const focus = createFocus({ root: document.body });
const isShop = () => state.tab === "store" || state.tab === "downloads";
bindNav(focus, {
  back: () => {
    if (!lightbox.hidden) return closeLightbox(), true;
    if (shop.back()) return true;
    if (state.tab === "game") return goBack(), true;
    if (state.collection) return (state.collection = null), render(), true;
    return false;
  },
  y: () => {
    if (state.tab === "store") return shop.search(), true;
    const id = focusedGameId();
    if (id) ejg.game.favorite(id);
    return !!id;
  },
  x: () => {
    if (isShop()) return false;
    const id = focusedGameId() ?? state.gameId;
    if (id) ejg.game.edit(id);
    return !!id;
  },
  menu: () => (ejg.ui.open("menu"), true),
  view: () => (ejg.ui.open("search"), true),
  lb: () => (shop.hasDialog() || switchTab(-1), true),
  rb: () => (shop.hasDialog() || switchTab(1), true),
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
});
shop.bindTab(() => state.tab);

function focusedGameId() {
  const id = focus.current?.closest("[data-game-id]")?.dataset.gameId;
  return id ? Number(id) : null;
}

// "/" enfoca el filtro de la barra lateral (E y F son atajos de editar/favorito).
window.addEventListener("keydown", (e) => {
  if (e.key !== "/" || document.activeElement === filterInput) return;
  e.preventDefault();
  filterInput.focus();
});

// ─────────────── datos ───────────────
const games = () => visible(ejg.library.all);
function filtered() {
  let list = games();
  if (state.collection) list = inCollection(list, ejg.library.collections.find((c) => c.id === state.collection));
  if (state.chip === "fav") list = list.filter((g) => g.favorite);
  if (state.chip === "installed") list = list.filter((g) => g.installed !== false);
  if (state.chip === "uninstalled") list = list.filter((g) => g.installed === false);
  if (state.filter) return search(list, state.filter, 500);
  return sort(list, state.sort);
}
const isRunning = (id) => ejg.game.isRunning(id);

// ─────────────── piezas ───────────────
function placeholder(g, small) {
  const hue = hueOf(g.title);
  const el = h("div", { class: small ? "ph" : "ph", style: { background: `linear-gradient(160deg, hsl(${hue} 45% 34%), hsl(${(hue + 40) % 360} 50% 16%))` } });
  if (small) el.textContent = initials(g.title);
  else el.append(h("b", null, initials(g.title)), h("span", null, g.title));
  return el;
}

function sideItem(g, prev) {
  const key = `${g.id}:${g.title}:${g.media.icon}:${isRunning(g.id)}:${g.missing}:${g.installed}:${state.gameId === g.id}`;
  if (prev && prev.__sig === key) return prev;
  const icon = g.media.icon || g.media.coverThumb;
  const el = h(
    "button",
    {
      class: "side-item" + (g.missing ? " missing" : "") + (g.installed === false ? " uninstalled" : ""),
      "data-focus": "",
      "data-game-id": g.id,
      "aria-current": state.gameId === g.id ? "true" : null,
      onclick: () => openGame(g.id),
      ondblclick: () => ejg.game.launch(g.id),
      title: g.title,
    },
    icon ? img(icon, { loading: "lazy" }) : placeholder(g, true),
    h("span", { class: "t" }, g.title),
    isRunning(g.id) ? h("span", { class: "run" }, "EN MARCHA") : null,
  );
  el.__sig = key;
  return el;
}

function coverCard(g, prev) {
  const key = `${g.id}:${g.title}:${g.media.coverThumb}:${g.media.heroThumb}:${g.favorite}:${isRunning(g.id)}:${g.playtime}:${g.missing}:${g.installed}`;
  if (prev && prev.__sig === key) return prev;
  const art = h("div", { class: "art" }, artFor(g, "portrait"));
  const badges = h(
    "div",
    { class: "badges" },
    isRunning(g.id) ? h("span", { class: "badge run" }, "EN MARCHA") : null,
    g.installed === false ? h("span", { class: "badge dl", title: "Sin instalar", html: ICON.download }) : null,
    g.favorite ? h("span", { class: "badge fav" }, "★") : null,
  );
  const el = h(
    "button",
    { class: "cover" + (g.missing ? " missing" : "") + (g.installed === false ? " uninstalled" : ""), "data-focus": "", "data-game-id": g.id, onclick: () => openGame(g.id), title: g.title },
    art,
    badges,
    h("div", { class: "hover" }, h("b", null, g.title), h("span", null, g.installed === false ? "Sin instalar" : g.playtime ? playtime(g.playtime) : "Sin jugar")),
    h("div", { class: "title" }, g.title),
  );
  el.__sig = key;
  return el;
}

function recentCard(g, prev) {
  const key = `${g.id}:${g.media.heroThumb}:${g.media.logo}:${g.lastPlayed}`;
  if (prev && prev.__sig === key) return prev;
  const el = h(
    "button",
    { class: "recent-card", "data-focus": "", "data-game-id": g.id, onclick: () => openGame(g.id), title: g.title },
    artFor(g, "landscape"),
    h("div", { class: "info" }, h("span", null, `${relative(g.lastPlayed)} · ${playtime(g.playtime)}`)),
  );
  el.__sig = key;
  return el;
}

// ─────────────── barra lateral ───────────────
const CHIPS = [
  ["all", "Todos"],
  ["installed", "Instalados"],
  ["uninstalled", "Sin instalar"],
  ["fav", "Favoritos"],
];
function renderChips() {
  chipsEl.replaceChildren(
    ...CHIPS.map(([k, label]) =>
      h("button", {
        class: "chip",
        "data-focus": "",
        "aria-pressed": String(state.chip === k),
        onclick: () => {
          state.chip = k;
          ejg.storage.set("chip", k);
          renderChips();
          render();
        },
      }, label),
    ),
  );
}

let favBox, allBox, allHead;
function renderSidebar() {
  if (!favBox) {
    favBox = h("div");
    allBox = h("div");
    allHead = h("div", { class: "side-group" });
    sideList.append(favBox, allHead, allBox);
  }
  const list = filtered();
  const favs = !state.filter && state.chip === "all" ? list.filter((g) => g.favorite) : [];
  favBox.replaceChildren(...(favs.length ? [h("div", { class: "side-group" }, h("span", null, "Favoritos"), h("span", null, favs.length))] : []));
  const favItems = h("div");
  keyed(favItems, favs, (g) => `f${g.id}`, sideItem);
  if (favs.length) favBox.append(favItems);
  allHead.replaceChildren(h("span", null, state.filter ? "Resultados" : "Todos"), h("span", null, list.length));
  keyed(allBox, list, (g) => g.id, sideItem);
}

// ─────────────── vistas ───────────────
function renderHome() {
  const list = filtered();
  const all = games();
  if (!all.length) {
    main.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("h2", null, "Tu biblioteca está vacía"),
        h("p", null, "Añade la carpeta donde tienes tus juegos o importa los de tus tiendas."),
        h("button", { class: "pill", "data-focus": "", onclick: () => ejg.ui.open("add-folder") }, "+ Añadir juegos"),
      ),
    );
    return;
  }
  const wrap = h("div", { class: "home" });
  const rec = recent(all, 10);
  if (ejg.settings.showRecent !== false && rec.length && !state.filter && state.chip === "all" && !state.collection) {
    wrap.append(h("div", { class: "shelf-head" }, h("h2", null, "Recientes")));
    const shelf = h("div", { class: "recent", "data-focus-group": "recent" });
    keyed(shelf, rec, (g) => g.id, recentCard);
    wrap.append(shelf);
  }
  const col = state.collection && ejg.library.collections.find((c) => c.id === state.collection);
  const sortKeys = Object.keys(SORTS);
  wrap.append(
    h(
      "div",
      { class: "shelf-head" },
      h("h2", null, col ? `Colección · ${col.name}` : state.filter ? "Resultados" : "Todos los juegos"),
      h("span", { class: "count" }, `(${list.length})`),
      h(
        "div",
        { class: "tools" },
        col ? h("button", { class: "pill", "data-focus": "", onclick: () => ((state.collection = null), render()) }, "✕ Quitar colección") : null,
        h(
          "button",
          {
            class: "pill",
            "data-focus": "",
            title: "Cambiar orden",
            onclick: () => {
              state.sort = sortKeys[(sortKeys.indexOf(state.sort) + 1) % sortKeys.length];
              ejg.storage.set("sort", state.sort);
              render();
            },
          },
          svg("sort"),
          SORTS[state.sort].label,
        ),
      ),
    ),
  );
  const grid = h("div", { class: "grid", "data-focus-group": "grid" });
  keyed(grid, list, (g) => g.id, coverCard);
  if (!list.length) grid.append(h("div", { class: "empty" }, "Nada coincide con el filtro."));
  wrap.append(grid);
  main.replaceChildren(wrap);
  main.scrollTop = state.scroll;
}

function renderCollections() {
  const cols = ejg.library.collections;
  const all = games();
  const wrap = h("div", { class: "cols" });
  for (const c of cols) {
    const members = inCollection(all, c);
    const mosaic = h("div", { class: "mosaic" }, ...members.slice(0, 4).map((g) => (g.media.coverThumb ? img(g.media.coverThumb) : h("div"))));
    wrap.append(
      h(
        "button",
        { class: "col-card", "data-focus": "", onclick: () => ((state.collection = c.id), (state.tab = "home"), render()) },
        mosaic,
        h("div", { class: "label" }, h("b", null, c.name), h("span", null, `${members.length} juegos${c.kind === "smart" ? " · inteligente" : ""}`)),
      ),
    );
  }
  wrap.append(
    h("button", { class: "col-card", "data-focus": "", onclick: () => ejg.ui.open("collections") }, h("div", { class: "label" }, h("b", null, "+ Nueva colección"), h("span", null, "Manual o inteligente"))),
  );
  main.replaceChildren(wrap);
}

let heroRelease = () => {};
let trailer = null;
let detailsToken = 0;

function playButton(g) {
  const running = isRunning(g.id);
  const install = g.installed === false;
  const btn = h(
    "button",
    {
      class: "play" + (running ? " running" : "") + (install ? " install" : ""),
      "data-focus": "",
      id: "play",
      disabled: g.missing || null,
      onclick: async () => {
        if (isRunning(g.id)) return;
        btn.classList.add("launching");
        btn.lastChild.textContent = install ? "ABRIENDO TIENDA…" : "INICIANDO…";
        try {
          await ejg.game.launch(g.id);
        } catch (e) {
          ejg.ui.toast(String(e.message || e), "error");
        }
        setTimeout(() => updatePlayButton(), 2500);
      },
    },
    svg(install ? "download" : "play"),
    h("span", null, g.missing ? "NO ENCONTRADO" : running ? "EN MARCHA" : install ? "INSTALAR" : "JUGAR"),
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
const statsKey = (g) => `${g.id}|${g.playtime}|${g.lastPlayed}|${g.achievements?.unlocked}/${g.achievements?.total}|${g.installed}`;
let renderedStats = "";
let achSlot = null;
let activitySlot = null;

function gameStats(g) {
  const stat = (label, value) => h("div", { class: "stat" }, h("small", null, label), h("span", null, value));
  return [
    g.installed === false ? stat("Estado", `Sin instalar · ${SOURCE_LABEL[g.source] || g.source}`) : null,
    stat("Última sesión", relative(g.lastPlayed)),
    stat("Tiempo de juego", playtime(g.playtime)),
    g.achievements ? stat("Logros", `${g.achievements.unlocked} / ${g.achievements.total}`) : null,
  ].filter(Boolean);
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

function renderActivity(d) {
  activitySlot?.replaceChildren(
    ...(d.recentSessions.length
      ? [
          h(
            "div",
            { class: "card" },
            h("h3", null, "Actividad"),
            ...d.recentSessions.slice(0, 8).map((s) => h("div", { class: "session" }, h("span", null, relative(s.startedAt)), h("span", null, playtime(s.duration)))),
          ),
        ]
      : []),
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
async function renderGame(id) {
  const g = ejg.library.byId(id);
  if (!g) return goBack();
  renderedArt = `${g.id}|${g.media.hero}|${g.media.logo}`;
  renderedStats = statsKey(g);
  heroRelease();
  trailer?.destroy();
  trailer = null;
  const token = ++detailsToken;
  const heroUrl = g.media.hero || g.media.heroThumb || g.media.header;
  const hero = h("div", { class: "hero", style: heroUrl ? { backgroundImage: `url("${heroUrl}")` } : {} });
  const back = h("button", { class: "back", "data-focus": "", onclick: goBack }, svg("back"), "Biblioteca");
  hero.append(back);
  if (g.media.logo) {
    const logo = img(g.media.logo, { class: "logo", loading: "eager" });
    logo.addEventListener("error", () => logo.replaceWith(h("div", { class: "htitle" }, g.title)));
    hero.append(logo);
  } else hero.append(h("div", { class: "htitle" }, g.title));

  const favBtn = h("button", { class: "round" + (g.favorite ? " on" : ""), "data-focus": "", title: "Favorito (Y)", onclick: () => ejg.game.favorite(g.id) }, svg("star"));
  const playbar = h(
    "div",
    { class: "playbar", "data-focus-group": "playbar" },
    playButton(g),
    h("div", { class: "stats" }, ...gameStats(g)),
    h(
      "div",
      { class: "actions" },
      favBtn,
      h("button", { class: "round", "data-focus": "", title: "Editar juego (X)", onclick: () => ejg.game.edit(g.id) }, svg("gear")),
      h("button", { class: "round", "data-focus": "", title: "Abrir carpeta", onclick: () => ejg.game.openFolder(g.id) }, svg("folder")),
    ),
  );
  const left = h("div", null, h("div", { class: "card" }, h("h3", null, "Acerca del juego"), h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel", style: { width: "60%" } })));
  achSlot = h("div");
  activitySlot = h("div");
  const right = h("div", null, achSlot);
  const body = h("div", { class: "game-body" }, left, right);
  const bg = h("div", { class: "game-bg", style: heroUrl ? { backgroundImage: `url("${g.media.heroThumb || heroUrl}")` } : {} });
  main.replaceChildren(h("div", { class: "game" }, bg, hero, playbar, body));
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

  // Columna principal: descripción, tráiler, capturas.
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
    left.append(h("div", { class: "card" }, h("h3", null, `Capturas (${d.screenshots.length})`), shots));
  }

  loadAchievements(id, token);

  // Columna lateral: información y actividad.
  const rows = [
    ["Desarrollador", d.developer],
    ["Editor", d.publisher],
    ["Lanzamiento", date(d.releaseDate)],
    ["Tienda", SOURCE_LABEL[d.source] || d.source],
    ["Valoración", d.rating ? `${d.rating} %` : null],
    ["Veces jugado", d.launchCount || null],
  ].filter((r) => r[1]);
  right.append(h("div", { class: "card" }, h("h3", null, "Información"), ...rows.map(([k, v]) => h("div", { class: "info-row" }, h("span", null, k), h("span", null, String(v))))));
  const tags = [...new Set([...(d.genres || []), ...(d.tags || [])])].slice(0, 14);
  if (tags.length) right.append(h("div", { class: "card" }, h("h3", null, "Etiquetas"), h("div", { class: "tags" }, ...tags.map((t) => h("span", { class: "tag" }, t)))));
  right.append(activitySlot);
  renderActivity(d);
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
  const more = h(
    "button",
    {
      class: "more",
      "data-focus": "",
      onclick: () => {
        all.hidden = !all.hidden;
        more.textContent = all.hidden ? `Ver todos (${list.total})` : "Ver menos";
      },
    },
    `Ver todos (${list.total})`,
  );
  return h(
    "div",
    { class: "card ach" },
    h("h3", null, "Logros"),
    h("div", { class: "ach-head" }, h("span", null, `Has desbloqueado ${list.unlocked} de ${list.total}`), h("b", null, `${pct} %`)),
    h("div", { class: "ach-bar" }, h("i", { style: { width: `${pct}%` } })),
    done.length ? h("div", { class: "ach-icons" }, ...done.slice(0, 12).map(achTile)) : null,
    locked.length ? h("div", { class: "ach-icons" }, ...locked.slice(0, done.length ? 6 : 12).map(achTile)) : null,
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

// ─────────────── navegación entre vistas ───────────────
function openGame(id) {
  if (state.tab !== "game") {
    state.prevTab = state.tab;
    state.scroll = main.scrollTop;
  }
  state.tab = "game";
  state.gameId = id;
  ejg.storage.set("last", id);
  render();
}
function goBack() {
  heroRelease();
  trailer?.destroy();
  trailer = null;
  const last = state.gameId;
  state.tab = state.prevTab || "home";
  state.gameId = null;
  render();
  const el = main.querySelector(`[data-game-id="${last}"]`) || sideList.querySelector(`[data-game-id="${last}"]`);
  if (el) focus.focus(el, { silent: true });
  else focus.first(main);
}
function tabList() {
  return ["home", "collections", ...(ejg.explore.enabled ? ["store"] : []), "downloads"];
}
function goTab(t) {
  heroRelease();
  trailer?.destroy();
  trailer = null;
  state.tab = t;
  state.gameId = null;
  state.scroll = 0;
  render();
  focus.first(main);
}
function switchTab(d) {
  const tabs = tabList();
  const cur = tabs.indexOf(state.tab === "game" ? state.prevTab : state.tab);
  state.tab = tabs[(cur + d + tabs.length) % tabs.length];
  state.gameId = null;
  state.scroll = 0;
  render();
  focus.first(main);
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === (state.tab === "game" ? state.prevTab : state.tab))));
}

function render() {
  renderTabs();
  document.documentElement.dataset.view = isShop() ? state.tab : "library";
  if (typeof updateHints === "function") updateHints();
  updateDownloadsUi();
  if (isShop()) return shop.render();
  renderSidebar();
  if (state.tab === "game") renderGame(state.gameId);
  else if (state.tab === "collections") renderCollections();
  else renderHome();
  // Si el elemento enfocado desapareció, recuperar el foco en su sustituto.
  if (focus.current && !focus.current.isConnected) {
    const id = focus.current.dataset?.gameId;
    const again = id && document.querySelector(`[data-game-id="${id}"]`);
    if (again) focus.focus(again, { noScroll: true, silent: true });
    else focus.reset();
  }
}

// ─────────────── cabecera, perfil, fondo ───────────────
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    heroRelease();
    trailer?.destroy();
    trailer = null;
    state.tab = t.dataset.tab;
    state.gameId = null;
    render();
  }),
);

// ─────────────── descargas: pestaña, contador y barra inferior ───────────────
const dlBadge = $("#dl-badge");
const dlFooter = $("#dl-footer");
dlFooter.addEventListener("click", () => goTab("downloads"));
function updateDownloadsUi() {
  const all = ejg.downloads.all;
  const pending = all.filter((d) => ["queued", "downloading", "paused", "seeding", "completed", "installing", "error"].includes(d.state));
  dlBadge.hidden = !pending.length;
  dlBadge.textContent = String(pending.length);
  $("#tab-store").hidden = !ejg.explore.enabled;
  // Barra de la biblioteca, como la de Steam: lo que se está bajando ahora.
  const now = all.filter((d) => d.state === "downloading" || d.state === "installing");
  const show = now.length > 0 && !isShop();
  dlFooter.hidden = !show;
  if (!show) return;
  const done = pending.filter((d) => ["seeding", "completed"].includes(d.state)).length;
  const cur = now[0];
  const total = now.reduce((a, d) => ({ d: a.d + d.doneBytes, t: a.t + d.totalBytes, s: a.s + d.downBps }), { d: 0, t: 0, s: 0 });
  dlFooter.replaceChildren(
    h("span", { class: "dlf-label" }, "DESCARGAS"),
    h("span", { class: "dlf-title" }, cur.state === "installing" ? `Instalando ${cur.title}` : cur.title),
    h("span", { class: "dlf-bar" }, h("i", { style: { width: `${total.t ? (total.d / total.t) * 100 : 0}%` } })),
    h("span", { class: "dlf-meta" }, cur.state === "installing" ? downloadLabel(cur) : `${percent(total.t ? total.d / total.t : 0)} · ${speed(total.s)}${done ? ` · ${done} listo${done === 1 ? "" : "s"} para instalar` : ""}`),
  );
}
ejg.explore.onEnabled(() => {
  if (!ejg.explore.enabled && state.tab === "store") goTab("home");
  else updateDownloadsUi();
});
// El host pide una vista (menú rápido, Ctrl+E / Ctrl+J, avisos…).
ejg.ui.onView(({ view, slug }) => {
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

function renderProfile() {
  const p = ejg.profile;
  const av = $("#avatar");
  av.textContent = p?.avatar ? "" : (p?.name || "?")[0].toUpperCase();
  av.style.backgroundImage = p?.avatar ? `url("${p.avatar}")` : "";
  av.style.backgroundColor = p?.color || "";
  $("#profile-name").textContent = p?.name || "";
}

function renderWallpaper() {
  const w = $("#wallpaper");
  const url = ejg.settings.wallpaper;
  w.replaceChildren();
  w.classList.toggle("custom", !!url);
  if (url && /\.(mp4|webm)$/i.test(url)) {
    const v = h("video", { autoplay: true, muted: true, loop: true, playsInline: true, src: url });
    v.muted = true;
    w.append(v);
  }
}

filterInput.setAttribute("data-focus", "");
filterInput.addEventListener(
  "input",
  debounce(() => {
    state.filter = filterInput.value.trim();
    if (state.tab !== "home") {
      state.tab = "home";
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
  if (state.tab === "game") {
    // En la página de juego solo refrescamos lo que cambia (evita recargar el tráiler).
    renderSidebar();
    updatePlayButton();
    const g = ejg.library.byId(state.gameId);
    if (g && `${g.id}|${g.media.hero}|${g.media.logo}` !== renderedArt) {
      const top = main.scrollTop;
      renderGame(g.id).then(() => (main.scrollTop = top));
      return;
    }
    const fav = document.querySelector(".playbar .round");
    if (g && fav) fav.classList.toggle("on", g.favorite);
    // Al cerrar el juego: horas, logros y actividad al día.
    if (g && statsKey(g) !== renderedStats) refreshGameStats(g);
  } else render();
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

const hintBar = hints(document.getElementById("hints"), []);
function updateHints() {
  hintBar.set(
    state.tab === "store"
      ? [["accept", "Abrir"], ["y", "Buscar"], ["back", "Volver"], ["lb", "Pestañas"], ["menu", "Menú"]]
      : state.tab === "downloads"
        ? [["accept", "Elegir"], ["lb", "Pestañas"], ["menu", "Menú"]]
        : state.tab === "game"
          ? [["accept", "Elegir"], ["back", "Biblioteca"], ["y", "Favorito"], ["x", "Editar"]]
          : [["accept", "Abrir"], ["y", "Favorito"], ["x", "Editar"], ["lb", "Pestañas"], ["menu", "Menú"]],
  );
}

renderProfile();
renderWallpaper();
renderChips();
render();
if (saved.last && ejg.library.byId(saved.last) && ejg.mode === "tv") openGame(saved.last);
focus.first(main) || focus.first();
