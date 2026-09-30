// Nintendo eShop y Gestión de descargas del tema Switch: cabecera naranja con
// menú lateral y mosaicos, «Explorar» (todo el catálogo con sus filtros en
// filas de ajustes), ficha con «Más como este», «Lista de deseos», diálogos de
// sistema y la lista de descargas con su panel de opciones. La lógica común
// está en /_sdk/kit/store.js.

import { h, img, keyed, debounce, hueOf } from "/_sdk/kit/dom.js";
import { date } from "/_sdk/kit/format.js";
import {
  createExplore,
  fileSelection,
  bytes,
  speed,
  eta,
  percent,
  sizeText,
  downloadLabel,
  canInstall,
  isActive,
  repackAction,
  askQuery,
  genreLabel,
  emptyFilters,
  filterCount,
  SORTS,
  SIZES,
  GENRE_GROUPS,
  MAX_GENRES,
  WISH_SORTS,
  sortWishlist,
  toggleWish,
  HYPERVISOR,
  hypervisorInfo,
  repackName,
} from "/_sdk/kit/store.js";

export const I = {
  bag: '<svg viewBox="0 0 24 24"><path class="f" d="M4.6 8.4h14.8l-1.2 11.1a2 2 0 0 1-2 1.8H7.8a2 2 0 0 1-2-1.8Z"/><path d="M8.6 10.6V7.4a3.4 3.4 0 0 1 6.8 0v3.2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="m20 20-4-4m-5 2a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v5m0 8v5M3 12h5m8 0h5M6.3 6.3l2.5 2.5m6.4 6.4 2.5 2.5m0-11.4-2.5 2.5m-6.4 6.4-2.5 2.5"/></svg>',
  trend: '<svg viewBox="0 0 24 24"><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3m0 13v3M2.5 12h3m13 0h3M5.3 5.3l2.1 2.1m9.2 9.2 2.1 2.1m0-13.4-2.1 2.1m-9.2 9.2-2.1 2.1"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 7.5v5.5m0 3.5h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 19.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 6.7a4.3 4.3 0 0 1 7.5 2.6c0 5.6-7.5 10.2-7.5 10.2Z"/></svg>',
  heartOn: '<svg viewBox="0 0 24 24"><path class="f" d="M12 19.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 6.7a4.3 4.3 0 0 1 7.5 2.6c0 5.6-7.5 10.2-7.5 10.2Z"/></svg>',
};

/** Géneros de la portada: id y color de su tarjeta (los de la eShop son vivos). */
const GENRE_CARDS = [
  [55, "#e60012"],
  [47, "#8e44d8"],
  [51, "#ff7d00"],
  [59, "#1fa84f"],
  [84, "#00a3d9"],
  [95, "#f2b705"],
  [66, "#2f6fdb"],
  [70, "#e5007e"],
  [71, "#00a39a"],
  [54, "#4a4a55"],
  [65, "#7a9c16"],
  [214, "#5b3fd1"],
];
const icon = (n, cls = "ico") => h("span", { class: cls, html: I[n] });

// Estados de una descarga que aún no ha terminado (todo menos «instalado»).
export const pending = (d) => d.state !== "installed";

/** Texto corto del estado de una descarga, con porcentaje si se está bajando. */
export function stateText(d) {
  if (d.state === "downloading" && !d.checking) return `Descargando… ${percent(d.progress)}`;
  if (d.state === "installed") return d.filesDeleted ? "Instalado · repack borrado" : "Instalado";
  return downloadLabel(d);
}

export function createShop({ ejg, focus, shopEl, dlsEl, show, where, openGame, onChange, onHints }) {
  const store = createExplore(ejg, onStore);
  // view.name: front | popular | catalog | wishlist | search | detail
  const view = { name: "front", prev: "front", slug: null, detail: null, detailError: "", scroll: 0, auto: false };
  let dialog = null; // diálogo de descarga
  let askOpen = null; // pregunta abierta (cierra con null)
  let panel = null; // panel de opciones de una descarga
  let dlBack = "home"; // a dónde vuelve «Gestión de descargas»
  let dlFrom = null;
  let picker = null; // selector de un filtro de «Explorar»

  // ─────────────── esqueleto de la eShop ───────────────
  const MENU = [
    ["search", "Buscar", "search"],
    ["front", "Destacados", "star"],
    ["catalog", "Explorar", "grid"],
    ["popular", "Populares", "trend"],
    ["wishlist", "Lista de deseos", "heart"],
    ["downloads", "Descargas", "down"],
  ];
  const userEl = h("div", { class: "es-user" });
  const sideCount = h("b", { class: "es-count", hidden: true });
  const wishCount = h("b", { class: "es-count wish", hidden: true });
  const side = h(
    "nav",
    { class: "es-side", "data-focus-group": "es-side" },
    userEl,
    ...MENU.map(([id, label, ico]) =>
      h(
        "button",
        { class: "es-mi", "data-focus": "", "data-menu": id, onclick: () => menu(id) },
        icon(ico),
        h("span", null, label),
        id === "downloads" ? sideCount : id === "wishlist" ? wishCount : null,
      ),
    ),
  );
  const mainEl = h("div", { class: "es-main" });
  shopEl.append(
    h("header", { class: "es-head", "data-ejg-drag": "" }, h("div", { class: "es-logo" }, icon("bag"), h("b", null, "Nintendo"), h("b", { class: "e" }, "eShop"))),
    h("div", { class: "es-body" }, side, mainEl),
  );

  function paintUser() {
    const p = ejg.profile;
    const av = h("i", { style: { backgroundImage: p?.avatar ? `url("${p.avatar}")` : "", backgroundColor: p?.color || "" } }, p?.avatar ? "" : (p?.name || "?")[0].toUpperCase());
    userEl.replaceChildren(av, h("span", null, p?.name || ""));
  }
  paintUser();
  ejg.on("profile", paintUser);

  // ─────────────── piezas ───────────────
  const STATUS = {
    installed: "Instalado",
    library: "En tu biblioteca",
    queued: "En cola",
    paused: "En pausa",
    seeding: "Listo para instalar",
    completed: "Listo para instalar",
    installing: "Instalando…",
    error: "Error",
  };
  function tag(r) {
    const s = r.status?.state;
    if (!s || s === "none") return null;
    const t = s === "downloading" ? `Descargando ${percent(r.status.progress)}` : STATUS[s];
    return t ? h("span", { class: "es-tag " + s }, t) : null;
  }

  const art = (src, title) => (src ? img(src, { loading: "lazy" }) : h("div", { class: "es-ph", style: { background: `hsl(${hueOf(title)} 45% 45%)` } }, title));

  // Corazón de los mosaicos que están en la lista de deseos.
  const heart = () => h("span", { class: "es-heart", title: "En tu lista de deseos", html: I.heartOn });
  const wishMark = (r) => (ejg.explore.wishlist.has(r.slug) ? heart() : null);

  function tile(r) {
    return h(
      "button",
      { class: "es-tile", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug), title: r.title },
      h("div", { class: "es-art" }, art(r.cover, r.title), tag(r), wishMark(r)),
      repackName(r, "b", { class: "es-name" }),
      h("span", { class: "es-size" }, sizeText(r.repackSize) || " "),
    );
  }
  const tileSig = (r) => `${r.status?.state}|${r.status?.progress}`;
  const tiles = (box, list) =>
    keyed(box, list, (r) => r.slug, (r, prev) => {
      if (prev && prev.__sig === tileSig(r)) return prev;
      const el = tile(r);
      el.__sig = tileSig(r);
      return el;
    });

  function feature(r) {
    return h(
      "button",
      { class: "es-feat", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug), title: r.title },
      h("div", { class: "es-feat-img" }, img(r.hero, { loading: "eager" }), tag(r), wishMark(r)),
      repackName(r),
      h("span", null, [r.genres.slice(0, 3).map(genreLabel).join(", "), sizeText(r.repackSize)].filter(Boolean).join(" · ")),
    );
  }

  const section = (title, body, extra) => h("section", { class: "es-sec" }, h("div", { class: "es-sec-h" }, h("h2", null, title), extra), body);
  const spinner = () => h("div", { class: "sw-spin" });
  const loading = (text = "Cargando…") => h("div", { class: "es-empty" }, spinner(), h("p", null, text));
  const empty = (title, text, ...extra) => h("div", { class: "es-empty" }, h("h2", null, title), text ? h("p", null, text) : null, ...extra);
  const pill = (label, cls, fn, key) => h("button", { class: "sw-pill " + (cls || ""), "data-focus": "", "data-key": key, onclick: fn }, label);
  const run = (p) => p.catch((e) => ejg.ui.toast(e.message || String(e), "error"));

  // ─────────────── menú lateral ───────────────
  function menu(id) {
    if (id === "downloads") return openDownloads(null, "shop");
    if (id === "search") return startSearch();
    if (id === "catalog") return openCatalog();
    if (id === "wishlist") return openWishlist();
    view.name = id;
    paint();
    if (!focus.first(mainEl)) view.auto = true;
  }

  /** LB/RB: sección anterior/siguiente del menú lateral. */
  function cycle(d) {
    const order = ["front", "catalog", "popular", "wishlist"];
    const i = order.indexOf(view.name);
    menu(order[(Math.max(0, i) + d + order.length) % order.length]);
  }

  // ─────────────── portada ───────────────
  function front() {
    const s = store.state;
    if (s.homeError) return empty("No se ha podido conectar con Nintendo eShop", s.homeError, pill("Reintentar", "orange", () => store.loadHome(true)));
    if (!s.home) return loading("Conectando con Nintendo eShop…");
    const byId = Object.fromEntries(s.home.sections.map((x) => [x.id, x]));
    const out = [];
    const top = ((byId.today || byId.week)?.items || []).filter((r) => r.hero).slice(0, 8);
    if (top.length) out.push(section("Destacados", h("div", { class: "es-feats", "data-focus-group": "feat" }, ...top.map(feature))));
    if (s.genres.length) out.push(section("Buscar por género", genreCards(), pill("Ver todo", "", () => openCatalog({}), "all-genres")));
    for (const id of ["week", "month"]) {
      const sec = byId[id];
      if (!sec?.items.length) continue;
      const row = h("div", { class: "es-row", "data-focus-group": "row-" + id });
      tiles(row, sec.items);
      out.push(section(sec.title, row));
    }
    if (byId.latest?.items.length) {
      const row = h("div", { class: "es-row", "data-focus-group": "row-latest" });
      tiles(row, byId.latest.items.slice(0, 14));
      row.append(h("button", { class: "es-tile es-moretile", "data-focus": "", onclick: () => openCatalog({ sort: "date" }) }, h("div", { class: "es-art" }, icon("plus"), h("span", null, "Ver más")), h("b", { class: "es-name" }, "Todas las novedades")));
      out.push(section("Novedades", row));
    }
    return h("div", { class: "es-page" }, ...out);
  }

  function popular() {
    const s = store.state;
    if (s.homeError) return empty("No se ha podido conectar con Nintendo eShop", s.homeError, pill("Reintentar", "orange", () => store.loadHome(true)));
    if (!s.home) return loading();
    const out = s.home.sections
      .filter((x) => x.id !== "latest" && x.items.length)
      .map((x) => {
        const grid = h("div", { class: "es-grid", "data-focus-group": "pop-" + x.id });
        tiles(grid, x.items);
        return section(x.title, grid, h("span", null, `${x.items.length} programas`));
      });
    return h("div", { class: "es-page" }, ...out);
  }

  // Rejilla de resultados que se rellena en su sitio (sin perder el foco).
  function resultsBox() {
    const grid = h("div", { class: "es-grid", "data-focus-group": "results" });
    const msg = h("p", { class: "es-msg", hidden: true });
    const spin = spinner();
    const more = pill("Ver más resultados", "es-more");
    const box = h("div", { class: "es-results" }, msg, grid, spin, more);
    box.fill = ({ items, busy, error, hasMore, onMore, none }) => {
      const had = grid.children.length;
      tiles(grid, items);
      msg.textContent = error || (!items.length && !busy ? none : "");
      msg.hidden = !msg.textContent;
      spin.hidden = !busy;
      const wasOnMore = focus.current === more;
      more.hidden = !(hasMore && !busy);
      more.onclick = onMore;
      if (wasOnMore && more.hidden) {
        const next = grid.children[had] || grid.lastElementChild;
        if (next) focus.focus(next, { silent: true });
      }
    };
    return box;
  }

  // ─────────────── explorar: todo el catálogo ───────────────
  const genreName = (id) => store.state.genres.find((g) => g.id === id)?.name || "";

  function genreCards() {
    const row = h("div", { class: "es-row es-genres", "data-focus-group": "row-genres" });
    for (const [id, color] of GENRE_CARDS) {
      const name = genreName(id);
      if (name) row.append(h("button", { class: "es-genre", "data-focus": "", "data-key": `g-${id}`, style: `--c: ${color}`, onclick: () => openCatalog({ genres: [id] }) }, h("b", null, name)));
    }
    return row;
  }

  /** «Explorar». `filters`: empezar con estos (los demás, vacíos). */
  function openCatalog(filters = null) {
    if (where() !== "shop") show("shop");
    const c = store.state.catalog;
    store.loadGenres();
    if (filters) store.browse({ ...emptyFilters(), ...filters });
    else if (!c.page && !c.loading) store.browse({});
    view.name = "catalog";
    paint();
    mainEl.scrollTop = 0;
    focus.focus(mainEl.querySelector('[data-key="f-sort"]'), { silent: true });
  }

  let catBox = null;
  let catRows = null;
  function catalogPage() {
    catBox = resultsBox();
    catBox.count = h("span", { class: "es-total" });
    catRows = h("div", { class: "es-set", "data-focus-group": "filters" });
    const page = h("div", { class: "es-page" }, section("Explorar", catRows), section("Programas", catBox, catBox.count));
    fillCatalog();
    return page;
  }

  /** Filtros como filas de la configuración de la consola: nombre a la izquierda y valor a la derecha. */
  function fillCatalog() {
    if (!catBox) return;
    const c = store.state.catalog;
    const f = c.filters;
    const key = focus.current && catRows.contains(focus.current) ? focus.current.dataset.key : null;
    const row = (k, label, value, fn, extra) =>
      h("button", { class: "es-setrow", "data-focus": "", "data-key": k, onclick: fn }, h("span", null, label), h("b", null, value), extra || icon("chev"));
    const toggle = h("i", { class: "sw-toggle" + (f.hideOwned ? " on" : "") });
    catRows.replaceChildren(
      row("f-sort", "Ordenar", SORTS.find((o) => o.id === f.sort)?.label || "", () => openPicker("sort")),
      row("f-genre", "Género", f.genres.length ? f.genres.map(genreName).join(", ") : "Todos", () => openPicker("genre")),
      row("f-size", "Tamaño de la descarga", SIZES.find((o) => o.gb === (f.maxGb || null))?.label || "", () => openPicker("size")),
      row("f-owned", "Ocultar los que ya tengo", f.hideOwned ? "Sí" : "No", () => store.browse({ hideOwned: !f.hideOwned }), toggle),
      ...(filterCount(f) ? [h("div", { class: "es-set-foot" }, pill("Quitar los filtros", "", () => store.clearFilters(), "f-clear"))] : []),
    );
    if (key) {
      const el = catRows.querySelector(`[data-key="${key}"]`) || catRows.querySelector("[data-focus]");
      if (el && el !== focus.current) focus.focus(el, { silent: true, noScroll: true });
    }
    catBox.fill({
      items: c.items,
      busy: c.loading,
      error: c.error,
      hasMore: c.page > 0 && c.page < c.pages,
      onMore: () => store.browseMore(),
      none: "No se ha encontrado ningún programa con estos filtros.",
    });
    catBox.count.textContent = c.loading && !c.items.length ? "" : `${c.filtered && c.page < c.pages ? "unos " : ""}${c.total.toLocaleString("es")} programas`;
    fillPicker();
  }

  // Más al llegar abajo (rueda o ratón).
  mainEl.addEventListener(
    "scroll",
    () => {
      if (view.name === "catalog" && mainEl.scrollTop + mainEl.clientHeight > mainEl.scrollHeight - 700) store.browseMore();
    },
    { passive: true },
  );

  /** Selector de un filtro: el diálogo de sistema con la lista de opciones. */
  function openPicker(kind) {
    const list = h("div", { class: "dd-chks one", "data-focus-group": "picker" });
    const title = { sort: "Ordenar", wsort: "Ordenar", genre: `Género (hasta ${MAX_GENRES})`, size: "Tamaño de la descarga" }[kind];
    const ok = h("button", { class: "sw-btn", "data-focus": "", onclick: () => closePicker() }, "Aceptar");
    const layer = h("div", { class: "sw-layer", "data-focus-trap": "" }, h("div", { class: "sw-dlg" }, h("div", { class: "sw-dlg-body" }, h("h2", { class: "sw-dlg-h" }, title), list), h("div", { class: "sw-dlg-foot" }, ok)));
    document.body.append(layer);
    picker = { kind, layer, list, prev: focus.current };
    fillPicker();
    focus.focus(list.querySelector(".dd-chk.on") || list.querySelector("[data-focus]"), { instant: true, silent: true });
    ejg.sound.play("open");
    hintsChanged();
  }

  function fillPicker() {
    if (!picker) return;
    const f = store.state.catalog.filters;
    const key = focus.current && picker.list.contains(focus.current) ? focus.current.dataset.key : null;
    const opt = (k, label, on, fn, radio) =>
      h("button", { class: "dd-chk" + (radio ? " radio" : "") + (on ? " on" : ""), "data-focus": "", "data-key": k, onclick: fn }, h("span", null, label), h("i", { html: I.check }));
    let items;
    if (picker.kind === "sort") items = SORTS.map((o) => opt(`p-${o.id}`, o.label, f.sort === o.id, () => (store.browse({ sort: o.id }), closePicker()), true));
    else if (picker.kind === "size") items = SIZES.map((o) => opt(`p-${o.gb ?? 0}`, o.label, (f.maxGb || null) === o.gb, () => (store.browse({ maxGb: o.gb }), closePicker()), true));
    else if (picker.kind === "wsort") items = WISH_SORTS.map((o) => opt(`p-${o.id}`, o.label, wishSort === o.id, () => ((wishSort = o.id), fillWishlist(), closePicker()), true));
    else
      items = GENRE_GROUPS.flatMap((grp) => {
        const list = store.state.genres.filter((g) => g.group === grp.id);
        return [
          h("h4", { class: "dd-sub" }, grp.label),
          ...list.map((g) =>
            opt(`p-g${g.id}`, g.name, f.genres.includes(g.id), () => {
              if (!store.toggleGenre(g.id)) ejg.ui.toast(`Como mucho ${MAX_GENRES} géneros a la vez`, "info");
            }),
          ),
        ];
      });
    picker.list.replaceChildren(...items);
    if (key) {
      const el = picker.list.querySelector(`[data-key="${key}"]`);
      if (el && el !== focus.current) focus.focus(el, { silent: true, noScroll: true });
    }
  }

  function closePicker() {
    if (!picker) return false;
    const { layer, kind } = picker;
    layer.remove();
    picker = null;
    const el = mainEl.querySelector(`[data-key="f-${kind}"]`);
    if (el) focus.focus(el, { silent: true, noScroll: true });
    hintsChanged();
    return true;
  }

  // ─────────────── búsqueda ───────────────
  let searchBox = null;
  const searchInput = h("input", {
    class: "es-input",
    placeholder: "Buscar por nombre",
    spellcheck: "false",
    "data-focus": "",
    oninput: debounce((e) => store.search(e.target.value), 60),
    onclick: () => ejg.input.source === "gamepad" && keyboardSearch(),
    onkeydown: (e) => {
      if (e.key === "Enter") store.search(e.target.value, 0);
    },
  });
  function searchPage() {
    searchInput.value = store.state.query;
    searchBox = resultsBox();
    searchBox.count = h("span", { class: "es-total" });
    const page = h(
      "div",
      { class: "es-page" },
      h("label", { class: "es-search" }, icon("search"), searchInput),
      section("Resultados", searchBox, searchBox.count),
    );
    fillResults();
    return page;
  }
  function fillResults() {
    if (!searchBox) return;
    const s = store.state;
    searchBox.fill({
      items: s.results,
      busy: s.searching,
      error: s.searchError,
      hasMore: s.page < s.pages,
      onMore: () => store.more(),
      none: s.query ? "No se ha encontrado ningún programa." : "Escribe el nombre de un juego.",
    });
    searchBox.count.textContent = s.total ? `${s.total} programas` : "";
  }
  async function keyboardSearch() {
    const q = await askQuery(ejg, store.state.query);
    if (q == null) return false;
    searchInput.value = q;
    store.search(q, 0);
    return true;
  }
  async function startSearch() {
    if (where() !== "shop") show("shop");
    view.name = "search";
    paint();
    if (await keyboardSearch()) {
      focus.focus(searchInput, { silent: true });
      return;
    }
    focus.focus(searchInput, { silent: true });
    searchInput.focus();
  }

  // ─────────────── ficha ───────────────
  async function openRepack(slug) {
    if (view.name !== "detail") {
      view.prev = view.name;
      view.scroll = mainEl.scrollTop;
    }
    view.name = "detail";
    view.slug = slug;
    view.detail = null;
    view.detailError = "";
    paint();
    mainEl.scrollTop = 0;
    try {
      view.detail = await store.details(slug);
    } catch (e) {
      view.detailError = e.message || String(e);
    }
    if (view.slug !== slug || view.name !== "detail") return;
    paint();
    focus.focus(mainEl.querySelector(".fi-buy") || mainEl.querySelector("[data-focus]"), { instant: true, silent: true });
  }

  function detailPage() {
    if (view.detailError) return empty("No se ha podido abrir la ficha", view.detailError);
    const d = view.detail;
    if (!d) return loading();
    const shots = d.screenshots.length ? d.screenshots : d.hero ? [{ thumb: d.hero, full: d.hero }] : [];
    const big = h("div", { class: "fi-big" }, shots[0] ? img(shots[0].full, { loading: "eager" }) : null);
    const strip =
      shots.length > 1
        ? h(
            "div",
            { class: "fi-strip", "data-focus-group": "shots" },
            ...shots.map((s, k) =>
              h(
                "button",
                {
                  class: "fi-thumb" + (k ? "" : " on"),
                  "data-focus": "",
                  onclick: (e) => {
                    big.replaceChildren(img(s.full, { loading: "eager" }));
                    strip.querySelectorAll(".fi-thumb").forEach((t) => t.classList.toggle("on", t === e.currentTarget));
                  },
                },
                img(s.thumb),
              ),
            ),
          )
        : null;
    const act = repackAction(d);
    const doAction = () => {
      if (act.id === "download") return openDialog(d);
      if (act.id === "install" && d.status.downloadId) return run(ejg.downloads.install(d.status.downloadId));
      if (act.id === "play" && d.status.gameId) return run(ejg.game.launch(d.status.gameId));
      openDownloads(d.status.downloadId ?? null, "shop");
    };
    const facts = [
      ["Tamaño de la descarga", sizeText(d.repackSize)],
      ["Tamaño original", sizeText(d.originalSize)],
      ["Espacio al instalar", sizeText(d.installSize)],
      ["Publicado", date(d.date)],
    ].filter((r) => r[1]);
    const info = [
      ["Géneros", d.genres.map(genreLabel).join(", ")],
      ["Compañías", d.companies],
      ["Idiomas", d.languages],
      ["Fecha de publicación", date(d.date)],
      ["Versión", d.version],
      ["Repack", d.number ? `#${d.number}` : null],
      ["Descarga selectiva", d.selective ? "Sí: idiomas y extras opcionales" : null],
      [HYPERVISOR.title, d.hypervisor ? "Sí: para jugar hay que desactivar un rato la seguridad de Windows" : null, "hv-row"],
    ].filter((r) => r[1]);
    let desc = null;
    if (d.description) {
      const text = h("div", { class: "fi-desc" }, d.description);
      desc = h("div", { class: "fi-card" }, h("h3", null, "Descripción"), text);
      if (d.description.length > 700) {
        text.classList.add("clamp");
        const more = pill("Leer más", "fi-more", () => {
          text.classList.toggle("clamp");
          more.textContent = text.classList.contains("clamp") ? "Leer más" : "Leer menos";
        });
        desc.append(more);
      } else desc.setAttribute("data-focus", "");
    }
    return h(
      "div",
      { class: "fi" },
      h(
        "div",
        { class: "fi-top" },
        h("div", { class: "fi-media" }, big, strip),
        h(
          "div",
          { class: "fi-side" },
          repackName(d, "h1"),
          d.companies ? h("div", { class: "fi-pub" }, d.companies) : null,
          chips(d),
          facts.length ? h("div", { class: "fi-facts" }, ...facts.map(([k, v]) => h("div", null, h("span", null, k), h("b", null, v)))) : null,
          // Como los avisos de la eShop (tarjeta clara con su icono): justo antes de Descargar.
          hypervisorInfo(ejg, d),
          h(
            "div",
            { class: "fi-actions", "data-focus-group": "fi-actions" },
            h("button", { class: "fi-buy" + (act.id === "downloads" ? " busy" : ""), "data-focus": "", "data-key": "buy", onclick: doAction }, act.label),
            act.hint ? h("p", { class: "fi-hint" }, act.hint) : null,
            wishButton(d),
            d.url ? h("button", { class: "fi-link", "data-focus": "", "data-key": "web", onclick: () => run(ejg.explore.openPage(d.slug)) }, icon("ext"), "Ver en FitGirl") : null,
          ),
        ),
      ),
      h(
        "div",
        { class: "fi-body" },
        h(
          "div",
          null,
          desc,
          d.features.length
            ? h("div", { class: "fi-card", "data-focus": "" }, h("h3", null, "Características del repack"), h("ul", { class: "fi-feat" }, ...d.features.map((f) => h("li", null, f))))
            : null,
        ),
        h("div", { class: "fi-card", "data-focus": "" }, h("h3", null, "Información"), ...info.map(([k, v, cls]) => h("div", { class: "fi-row" + (cls ? " " + cls : "") }, h("span", null, k), h("b", null, v)))),
      ),
      similarSec(d),
    );
  }

  /** Géneros de la ficha: los conocidos llevan a «Explorar» filtrado por ellos. */
  function chips(d) {
    const known = (d.tags || []).map((t) => store.state.genres.find((g) => g.id === t)).filter(Boolean);
    if (known.length) {
      return h(
        "div",
        { class: "fi-chips", "data-focus-group": "fi-chips" },
        ...known.slice(0, 5).map((g) => h("button", { class: "fi-chip", "data-focus": "", "data-key": `fg-${g.id}`, onclick: () => openCatalog({ genres: [g.id] }) }, g.name)),
      );
    }
    return d.genres.length ? h("div", { class: "fi-chips" }, ...d.genres.slice(0, 5).map((g) => h("span", null, genreLabel(g)))) : null;
  }

  function similarSec(d) {
    const row = h("div", { class: "es-row", "data-focus-group": "row-similar" }, spinner());
    const sec = h("div", { class: "fi-similar" }, section("Más como este", row));
    store.similar(d, 14).then((list) => {
      if (view.slug !== d.slug) return;
      if (!list.length) return sec.remove();
      row.replaceChildren();
      tiles(row, list);
    });
    return sec;
  }

  // ─────────────── lista de deseos ───────────────
  let wishSort = "added";
  let wishList = null; // filas de la página (null si no se ve)
  let wishTotal = null;
  let wishSortVal = null;
  let wishSig = "";
  const wishing = new Set(); // juegos con el cambio en marcha (un toque a la vez)

  /** Añade o quita de la lista (con su aviso) y repinta el botón de la ficha. */
  async function wish(r) {
    if (wishing.has(r.slug)) return;
    wishing.add(r.slug);
    const on = await toggleWish(ejg, r, "tu lista de deseos");
    wishing.delete(r.slug);
    const b = view.name === "detail" && view.slug === r.slug && mainEl.querySelector(".fi-wish");
    if (b) paintWish(b, on);
  }

  /** Botón de la ficha: corazón vacío o lleno. */
  function wishButton(d) {
    const b = h("button", { class: "fi-wish", "data-focus": "", "data-key": "wish", onclick: () => wish(d) });
    paintWish(b, ejg.explore.wishlist.has(d.slug));
    return b;
  }
  function paintWish(b, on) {
    b.classList.toggle("on", on);
    b.replaceChildren(icon(on ? "heartOn" : "heart"), on ? "En tu lista de deseos" : "Añadir a la lista de deseos");
  }

  // El estado de lo deseado, con el progreso de su descarga al día.
  function wishLive(r) {
    const d = ejg.downloads.all.find((x) => x.slug === r.slug);
    return d ? { ...r, status: { ...r.status, state: d.state, downloadId: d.id, progress: d.progress, gameId: d.gameId } } : r;
  }

  /** «Lista de deseos». */
  function openWishlist() {
    if (where() !== "shop") show("shop");
    view.name = "wishlist";
    paint();
    mainEl.scrollTop = 0;
    const el = mainEl.querySelector(".wl-item") || mainEl.querySelector("[data-focus]");
    focus.focus(el || side.querySelector('[data-menu="wishlist"]'), { silent: true });
  }

  function wishlistPage() {
    if (!ejg.explore.wishlist.items.length) {
      wishList = null;
      return h(
        "div",
        { class: "es-page" },
        h(
          "div",
          { class: "es-empty" },
          icon("heart", "dm-big wl-big"),
          h("h2", null, "Tu lista de deseos está vacía"),
          h("p", null, "Añade juegos desde su ficha con el botón del corazón. La lista se guarda en este PC, solo para este perfil."),
          pill("Explorar", "orange", () => openCatalog(), "w-browse"),
        ),
      );
    }
    wishSortVal = h("b");
    wishTotal = h("span", { class: "es-total" });
    wishList = h("div", { class: "wl-list", "data-focus-group": "wishlist" });
    wishSig = "";
    const sort = h(
      "div",
      { class: "es-set wl-sort", "data-focus-group": "w-sort" },
      h("button", { class: "es-setrow", "data-focus": "", "data-key": "f-wsort", onclick: () => openPicker("wsort") }, h("span", null, "Ordenar"), wishSortVal, icon("chev")),
    );
    const page = h("div", { class: "es-page" }, section("Lista de deseos", h("div", null, sort, wishList), wishTotal));
    fillWishlist();
    return page;
  }

  /** Una fila: arte, nombre, géneros, tamaño y fecha con su etiqueta de estado, y «Quitar». */
  function wishRow(r) {
    const artBox = h("div", { class: "wl-art" });
    let name = h("b");
    const info = h("span", { class: "wl-info" });
    const meta = h("span", { class: "wl-meta" });
    const tagBox = h("span", { class: "wl-tag" });
    const item = h(
      "button",
      { class: "wl-item", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug) },
      artBox,
      h("div", { class: "wl-main" }, name, info, h("div", { class: "wl-line" }, meta, tagBox)),
    );
    const del = h("button", { class: "wl-del", "data-focus": "", title: "Quitar de la lista de deseos", onclick: () => wish(el.__r) }, icon("heartOn"), h("span", null, "Quitar"));
    const el = h("div", { class: "wl-row" }, item, del);
    let sig = "";
    let cover;
    el.__upd = (r) => {
      el.__r = r;
      if (r.cover !== cover) {
        cover = r.cover;
        artBox.replaceChildren(art(r.cover, r.title));
      }
      const s = `${r.title}|${r.hypervisor}|${r.repackSize}|${r.date}|${tileSig(r)}`;
      if (s === sig) return;
      sig = s;
      item.title = r.title;
      // El nombre, con la etiqueta HV si la lleva.
      const n = repackName(r);
      name.replaceWith(n);
      name = n;
      info.textContent = (r.genres || []).slice(0, 3).map(genreLabel).join(", ");
      meta.textContent = [sizeText(r.repackSize), r.date ? `Publicado el ${date(r.date)}` : ""].filter(Boolean).join(" · ");
      const t = tag(r);
      tagBox.replaceChildren(...(t ? [t] : []));
    };
    el.__upd(r);
    return el;
  }

  /** Rellena la lista en su sitio (sin perder el foco ni el scroll). */
  function fillWishlist() {
    if (!wishList) return;
    const items = sortWishlist(ejg.explore.wishlist.items, wishSort).map(wishLive);
    wishTotal.textContent = items.length === 1 ? "1 programa" : `${items.length} programas`;
    wishSortVal.textContent = WISH_SORTS.find((o) => o.id === wishSort)?.label || "";
    // Mismos juegos en el mismo orden: solo cambian sus datos.
    const sig = items.map((r) => r.slug).join("\n");
    if (sig === wishSig) return items.forEach((r, k) => wishList.children[k]?.__upd(r));
    wishSig = sig;
    // Si se quita la fila enfocada, el foco pasa a la que ocupa su sitio.
    const cur = focus.current;
    const row = cur && wishList.contains(cur) ? cur.closest(".wl-row") : null;
    const at = row ? Array.prototype.indexOf.call(wishList.children, row) : -1;
    keyed(wishList, items, (r) => r.slug, (r, prev) => (prev ? (prev.__upd(r), prev) : wishRow(r)));
    if (row && !row.isConnected) {
      const next = wishList.children[Math.min(at, wishList.children.length - 1)];
      const el = next?.querySelector(cur.classList.contains("wl-del") ? ".wl-del" : ".wl-item");
      if (el) focus.focus(el, { silent: true });
    }
  }

  /** Pone o quita el corazón de los mosaicos a la vista. */
  function markWishes() {
    const on = new Set(ejg.explore.wishlist.items.map((w) => w.slug));
    for (const el of mainEl.querySelectorAll(".es-tile[data-slug], .es-feat[data-slug]")) {
      const box = el.firstElementChild;
      const mark = box.querySelector(".es-heart");
      if (on.has(el.dataset.slug) === !!mark) continue;
      if (mark) mark.remove();
      else box.append(heart());
    }
  }

  // Cambió la lista (aquí, en otro tema o en el host): contador, página, ficha y mosaicos.
  function onWish() {
    const n = ejg.explore.wishlist.items.length;
    wishCount.hidden = !n;
    wishCount.textContent = String(n);
    if (view.name === "wishlist") {
      // Se vació o dejó de estarlo: otra página; si no, en su sitio.
      if (!!wishList !== n > 0) paint(true);
      else fillWishlist();
    } else if (view.name === "detail" && view.detail) {
      const b = mainEl.querySelector(".fi-wish");
      if (b) paintWish(b, ejg.explore.wishlist.has(view.detail.slug));
    }
    markWishes();
  }
  ejg.explore.wishlist.onChange(onWish);
  onWish();

  // ─────────────── diálogos de sistema ───────────────
  function hintsChanged() {
    onHints();
  }

  async function openDialog(d) {
    closeDialog();
    const body = h("div", { class: "sw-dlg-body center" }, spinner(), h("p", null, "Buscando el torrent y su lista de archivos…"));
    const cancel = h("button", { class: "sw-btn", "data-focus": "", onclick: () => closeDialog() }, "Cancelar");
    const foot = h("div", { class: "sw-dlg-foot" }, cancel);
    const layer = h("div", { class: "sw-layer", "data-focus-trap": "" }, h("div", { class: "sw-dlg wide" }, body, foot));
    document.body.append(layer);
    dialog = { layer, slug: d.slug, prep: null, prev: focus.current };
    ejg.sound.play("open");
    focus.focus(cancel, { instant: true, silent: true });
    hintsChanged();
    let prep;
    try {
      prep = await ejg.downloads.prepare(d.slug);
    } catch (e) {
      if (dialog?.slug !== d.slug) return;
      body.replaceChildren(h("p", { class: "sw-err" }, e.message || String(e)));
      return;
    }
    if (dialog?.slug !== d.slug) return;
    dialog.prep = prep;
    const sel = fileSelection(prep);
    let dir = prep.dir ? { path: prep.dir, freeBytes: prep.freeBytes } : null;
    const need = h("b");
    const avail = h("b");
    const pathEl = h("b", { class: "dd-path" });
    const err = h("p", { class: "sw-err" });
    const ok = h("button", { class: "sw-btn", "data-focus": "" }, "Descargar");
    const upd = () => {
      need.textContent = bytes(sel.bytes);
      avail.textContent = dir?.freeBytes != null ? bytes(dir.freeBytes) : "—";
      pathEl.textContent = dir?.path || "Elige una carpeta";
      const problem = !dir ? "Elige dónde guardar la descarga." : sel.error || (!sel.fits(dir.freeBytes) ? "No hay espacio suficiente en ese disco." : "");
      err.textContent = problem;
      ok.disabled = !!problem;
    };
    const check = (f) =>
      h(
        "button",
        {
          class: "dd-chk" + (sel.isSelected(f.index) ? " on" : ""),
          "data-focus": "",
          onclick: (e) => {
            sel.toggle(f.index);
            e.currentTarget.classList.toggle("on", sel.isSelected(f.index));
            upd();
          },
        },
        h("span", null, f.label),
        h("small", null, bytes(f.size)),
        h("i", { html: I.check }),
      );
    const groups = [
      ["Idiomas", sel.languages],
      ["Contenido opcional", sel.optional],
    ].filter(([, l]) => l.length);
    body.className = "sw-dlg-body";
    body.replaceChildren(
      h(
        "div",
        { class: "dd-head" },
        h("div", { class: "dd-ico" }, art(d.cover, d.title)),
        h("div", null, repackName(d), h("span", null, [d.version, sizeText(d.repackSize)].filter(Boolean).join(" · "))),
      ),
      // Aviso del crack de hipervisor, como los avisos de la consola (círculo rojo con «!»).
      ...(prep.hypervisor ? [h("div", { class: "hv-warn" }, icon("alert", "ico hv-warn-ico"), h("p", null, HYPERVISOR.download))] : []),
      h("div", { class: "dd-space" }, h("div", null, h("span", null, "Espacio necesario"), need), h("div", null, h("span", null, "Espacio disponible"), avail)),
      h(
        "div",
        { class: "dd-loc" },
        icon("folder"),
        h("div", { class: "dd-loc-txt" }, h("small", null, "Guardar en"), pathEl),
        pill("Cambiar…", "", async () => {
          const p = await ejg.downloads.pickFolder(dir?.path).catch(() => null);
          if (p) {
            dir = p;
            upd();
          }
        }),
      ),
      ...groups.map(([title, list]) => h("div", { class: "dd-group" }, h("h4", null, title), h("div", { class: "dd-chks", "data-focus-group": "dd-" + title }, ...list.map(check)))),
      ...(groups.length ? [h("p", { class: "dd-note" }, "En el instalador, desmarca lo que no hayas descargado.")] : []),
      ...(prep.installSize
        ? [h("p", { class: "dd-note" }, `El juego instalado ocupará ${sizeText(prep.installSize)}${prep.installFreeBytes != null ? ` (quedan ${bytes(prep.installFreeBytes)} en ${prep.installDir})` : ""}.`)]
        : []),
      err,
    );
    ok.onclick = async () => {
      ok.disabled = true;
      ok.textContent = "Añadiendo…";
      try {
        await ejg.downloads.start(prep.token, sel.indices(), dir.path);
        closeDialog(true);
        ejg.ui.toast(`«${d.title}» se ha añadido a las descargas`, "ok");
        store.refresh();
        if (view.name === "detail" && view.slug === d.slug) openRepack(d.slug);
      } catch (e) {
        err.textContent = e.message || String(e);
        ok.disabled = false;
        ok.textContent = "Descargar";
      }
    };
    foot.replaceChildren(cancel, ok);
    upd();
    focus.focus(ok.disabled ? body.querySelector("[data-focus]") : ok, { instant: true, silent: true });
  }

  function closeDialog(done) {
    if (!dialog) return false;
    if (!dialog.prep && !done) ejg.downloads.cancelPrepare(dialog.slug).catch(() => {});
    dialog.layer.remove();
    const prev = dialog.prev;
    dialog = null;
    if (prev?.isConnected) focus.focus(prev, { silent: true, noScroll: true });
    else focus.first(where() === "dls" ? dlsEl : mainEl);
    hintsChanged();
    return true;
  }

  /** Pregunta con dos respuestas y Cancelar: true, false o null. */
  function ask(text, yes, no) {
    return new Promise((resolve) => {
      const prev = focus.current;
      const done = (v) => {
        layer.remove();
        askOpen = null;
        if (prev?.isConnected) focus.focus(prev, { silent: true, noScroll: true });
        hintsChanged();
        resolve(v);
      };
      const bCancel = h("button", { class: "sw-btn", "data-focus": "", onclick: () => done(null) }, "Cancelar");
      const layer = h(
        "div",
        { class: "sw-layer", "data-focus-trap": "" },
        h(
          "div",
          { class: "sw-dlg" },
          h("div", { class: "sw-dlg-body center" }, h("p", null, text)),
          h("div", { class: "sw-dlg-foot" }, bCancel, h("button", { class: "sw-btn", "data-focus": "", onclick: () => done(false) }, no), h("button", { class: "sw-btn", "data-focus": "", onclick: () => done(true) }, yes)),
        ),
      );
      document.body.append(layer);
      askOpen = () => done(null);
      ejg.sound.play("open");
      focus.focus(bCancel, { instant: true, silent: true });
      hintsChanged();
    });
  }

  async function removeDl(d) {
    if (d.filesDeleted) return run(ejg.downloads.remove(d.id, false));
    const text =
      d.state === "installed"
        ? `¿Quieres borrar también el repack de «${d.title}»? El juego instalado no se toca.`
        : `¿Quieres borrar también lo descargado de «${d.title}» (${bytes(d.doneBytes)})?`;
    const files = await ask(text, "Borrar archivos", "Conservarlos");
    if (files != null) run(ejg.downloads.remove(d.id, files));
  }

  // ─────────────── gestión de descargas ───────────────
  const dmSpeed = h("span", { class: "dm-speed" });
  const dmTools = h("div", { class: "dm-tools", "data-ejg-nodrag": "" });
  const dmList = h("div", { class: "dm-list" });
  dlsEl.append(
    h("header", { class: "dm-head", "data-ejg-drag": "" }, h("div", { class: "dm-title" }, icon("down", "dm-ico-h"), "Gestión de descargas"), dmSpeed, dmTools),
    dmList,
  );

  function sizeLine(d) {
    if (d.state === "installed") return d.totalBytes ? bytes(d.totalBytes) : "";
    return `${bytes(d.doneBytes)} / ${bytes(d.totalBytes)}`;
  }
  function stateLine(d) {
    if (d.state !== "downloading") return stateText(d);
    return [downloadLabel(d), d.eta ? `quedan ${eta(d.eta)}` : "", d.peers ? `${d.peers} fuentes` : ""].filter(Boolean).join(" · ");
  }
  function primary(d) {
    if (canInstall(d)) return pill("Instalar", "orange", () => run(ejg.downloads.install(d.id)), "act");
    if (d.pauseReason === "needs-folder") return pill("Elegir carpeta", "", () => run(ejg.downloads.locate(d.id)), "act");
    if (d.state === "installed" && d.gameId) return pill("Jugar", "cyan", () => openGame(d.gameId), "act");
    if (d.state === "error") return pill("Reintentar", "", () => run(ejg.downloads.resume(d.id)), "act");
    return null;
  }
  const ICON_OF = { downloading: "down", queued: "clock", paused: "pause", installing: "gear", error: "alert", seeding: "check", completed: "check", installed: "check" };

  const rows = new Map();
  function dmRow(d) {
    const name = h("b");
    const bar = h("i");
    const barBox = h("div", { class: "dm-bar" }, bar);
    const stateEl = h("span", { class: "dm-state" });
    const size = h("span", { class: "dm-size" });
    const badge = h("span", { class: "dm-badge" });
    const acts = h("div", { class: "dm-acts" });
    const item = h(
      "button",
      { class: "dm-item", "data-focus": "", onclick: () => openPanel(d.id) },
      h("div", { class: "dm-ico" }, art(d.cover || d.hero, d.title), badge),
      h("div", { class: "dm-main" }, name, barBox, stateEl),
      size,
    );
    const el = h("div", { class: "dm-row", "data-dl": d.id }, item, acts);
    let sig = "";
    const update = (d) => {
      name.textContent = d.title;
      bar.style.width = `${Math.round(d.progress * 1000) / 10}%`;
      barBox.hidden = d.state === "installed";
      stateEl.textContent = stateLine(d);
      size.textContent = sizeLine(d);
      const s = `${d.state}|${d.pauseReason}|${d.filesDeleted}|${d.gameId}|${d.checking}`;
      if (s === sig) return;
      sig = s;
      el.dataset.state = d.state;
      badge.innerHTML = I[ICON_OF[d.state]] || "";
      // El botón solo se cambia si cambia el estado (para no perder el foco).
      const btn = primary(d);
      const had = acts.contains(focus.current);
      acts.replaceChildren(...(btn ? [btn] : []));
      if (had) focus.focus(btn || item, { silent: true, noScroll: true });
    };
    update(d);
    return { el, item, update };
  }

  function paintTools() {
    const all = ejg.downloads.all;
    const down = all.filter((d) => d.state === "downloading").reduce((a, d) => a + d.downBps, 0);
    dmSpeed.textContent = all.some((d) => d.state === "downloading") ? speed(down) : "";
    const want = `${all.some(isActive)}|${all.some((d) => d.state === "paused")}`;
    if (dmTools.__sig === want) return;
    dmTools.__sig = want;
    const had = dmTools.contains(focus.current) ? focus.current.dataset.key : null;
    dmTools.replaceChildren(
      ...[
        all.some(isActive) ? pill("Pausar todo", "", () => run(ejg.downloads.pause()), "pause-all") : null,
        all.some((d) => d.state === "paused") ? pill("Reanudar todo", "", () => run(ejg.downloads.resume()), "resume-all") : null,
      ].filter(Boolean),
    );
    if (had) focus.focus(dmTools.querySelector("[data-focus]") || dmList.querySelector("[data-focus]"), { silent: true, noScroll: true });
  }

  let dlSig = "";
  const listSig = () => ejg.downloads.all.map((d) => `${d.id}:${d.state}:${d.state === "downloading" ? "" : d.pauseReason}`).join(",");

  function paintDownloads(keepFocus = false) {
    const prev = keepFocus ? focus.current : null;
    const prevId = prev?.closest?.("[data-dl]")?.dataset.dl;
    const prevKey = prev?.dataset?.key;
    const all = ejg.downloads.all;
    dlSig = listSig();
    paintTools();
    const groups = [
      ["En curso", all.filter((d) => d.state === "downloading" || d.state === "installing")],
      ["En espera", all.filter((d) => d.state === "queued" || d.state === "paused" || d.state === "error")],
      ["Listos para instalar", all.filter((d) => d.state === "seeding" || d.state === "completed")],
      ["Instalados", all.filter((d) => d.state === "installed")],
    ].filter(([, l]) => l.length);
    rows.clear();
    const out = groups.map(([label, list], k) => {
      const box = h("div", { class: "dm-group", "data-focus-group": "dm-" + k });
      for (const d of list) {
        const r = dmRow(d);
        rows.set(d.id, r);
        box.append(r.el);
      }
      return h("section", null, h("div", { class: "dm-h" }, h("span", null, label), h("span", null, String(list.length))), box);
    });
    if (!all.length)
      out.push(
        h(
          "div",
          { class: "es-empty" },
          icon("down", "dm-big"),
          h("h2", null, "No hay descargas"),
          h("p", null, "Busca un juego en Nintendo eShop y pulsa Descargar."),
          ejg.explore.enabled ? pill("Abrir Nintendo eShop", "orange", () => open("explore")) : null,
        ),
      );
    dmList.replaceChildren(...out);
    if (keepFocus && prev && !prev.isConnected) {
      const r = prevId && rows.get(Number(prevId));
      const again = r ? (prevKey === "act" && r.el.querySelector("[data-key='act']")) || r.item : null;
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else focus.first(dmList) || focus.first(dlsEl);
    }
  }

  function openDownloads(id = null, from) {
    closeAll();
    const w = where();
    if (w !== "dls") {
      dlBack = from || (w === "shop" ? "shop" : "home");
      dlFrom = focus.current;
      show("dls");
    }
    paintDownloads();
    dmList.scrollTop = 0;
    const r = id != null && rows.get(id);
    focus.focus(r ? r.item : dmList.querySelector("[data-focus]") || dlsEl.querySelector("[data-focus]"), { instant: true, silent: true });
    hintsChanged();
  }

  function leaveDownloads() {
    closePanel();
    if (dlBack === "shop") {
      show("shop");
      paint();
      focus.focus(side.querySelector('[data-menu="downloads"]'), { instant: true, silent: true });
      hintsChanged();
    } else show("home", dlFrom?.isConnected ? dlFrom : '[data-action="downloads"]');
  }

  // Panel de opciones de una descarga (como el de X en el HOME).
  function openPanel(id) {
    const d = ejg.downloads.byId(id);
    if (!d) return;
    closePanel();
    const sub = h("div", { class: "sub" });
    const bar = h("i");
    const barBox = h("div", { class: "dm-bar big" }, bar);
    const stats = h("div", { class: "stats" });
    const menuEl = h("div", { class: "menu" });
    const p = h(
      "div",
      { class: "panel", "data-focus-trap": "" },
      h("div", { class: "cover" }, d.hero || d.cover ? img(d.hero || d.cover, { loading: "eager" }) : null),
      h("h2", null, d.title),
      sub,
      barBox,
      stats,
      menuEl,
    );
    const layer = h("aside", { class: "side-layer", onclick: (e) => e.target === layer && closePanel() }, p);
    document.body.append(layer);
    const stat = (label, value) => h("div", { class: "stat" }, h("small", null, label), h("b", null, value));
    let sig = "";
    const update = (d) => {
      sub.textContent = stateLine(d);
      bar.style.width = `${Math.round(d.progress * 1000) / 10}%`;
      barBox.hidden = d.state === "installed";
      const dl = d.state === "downloading";
      stats.replaceChildren(
        ...[
          stat("Progreso", percent(d.progress)),
          stat("Descargado", sizeLine(d)),
          dl ? stat("Velocidad", speed(d.downBps)) : null,
          dl && d.eta ? stat("Tiempo restante", eta(d.eta)) : null,
          dl ? stat("Fuentes", String(d.peers)) : null,
          d.installSize ? stat("Espacio al instalar", sizeText(d.installSize)) : null,
        ].filter(Boolean),
      );
      const s = `${d.state}|${d.pauseReason}|${d.filesDeleted}|${d.gameId}`;
      if (s === sig) return;
      const first = !sig;
      sig = s;
      const idx = Array.prototype.indexOf.call(menuEl.children, focus.current);
      menuEl.replaceChildren(...menuItems(d));
      if (first) return;
      const target = menuEl.children[Math.max(0, Math.min(idx, menuEl.children.length - 1))];
      if (target) focus.focus(target, { silent: true, noScroll: true });
    };
    panel = { layer, id, update, prev: focus.current };
    update(d);
    focus.first(menuEl);
    ejg.sound.play("open");
    hintsChanged();
  }

  function menuItems(d) {
    const mi = (label, fn) => h("button", { class: "mi", "data-focus": "", onclick: fn }, label);
    const list = [];
    if (canInstall(d)) list.push(mi("Instalar", () => (closePanel(), run(ejg.downloads.install(d.id)))));
    if (d.pauseReason === "needs-folder") list.push(mi("Elegir dónde se instaló", () => (closePanel(), run(ejg.downloads.locate(d.id)))));
    if (d.state === "installed" && d.gameId) list.push(mi("Jugar", () => (closePanel(), openGame(d.gameId))));
    if (isActive(d)) list.push(mi("Pausar la descarga", () => run(ejg.downloads.pause(d.id))));
    if (d.state === "paused" || d.state === "error") list.push(mi(d.state === "error" ? "Reintentar la descarga" : "Reanudar la descarga", () => run(ejg.downloads.resume(d.id))));
    if (d.state === "queued") list.push(mi("Descargar primero", () => run(ejg.downloads.move(d.id, 0))));
    if (d.slug && ejg.explore.enabled) list.push(mi("Ver en Nintendo eShop", () => open("repack", d.slug)));
    if (!(d.state === "installed" && d.filesDeleted)) list.push(mi("Abrir la carpeta", () => run(ejg.downloads.openFolder(d.id))));
    if (d.state !== "installing") list.push(mi(d.state === "installed" ? "Quitar de la lista" : "Cancelar la descarga", () => removeDl(d)));
    return list;
  }

  function closePanel() {
    if (!panel) return false;
    panel.layer.remove();
    const { prev, id } = panel;
    panel = null;
    if (prev?.isConnected) focus.focus(prev, { silent: true, noScroll: true });
    else if (where() === "dls") rows.get(id) ? focus.focus(rows.get(id).item, { silent: true }) : focus.first(dmList);
    hintsChanged();
    return true;
  }

  function closeAll() {
    closePicker();
    askOpen?.();
    closeDialog();
    closePanel();
  }

  /** X: pausar o reanudar la descarga enfocada (fila, panel o icono del HOME). */
  function togglePause(el) {
    const id = panel?.id ?? Number(el?.closest?.("[data-dl]")?.dataset.dl ?? el?.dataset?.dlId);
    const d = id && ejg.downloads.byId(id);
    if (!d) return false;
    if (isActive(d)) run(ejg.downloads.pause(d.id));
    else if (d.state === "paused" || d.state === "error") run(ejg.downloads.resume(d.id));
    return true;
  }

  function onDownloads() {
    const all = ejg.downloads.all;
    const n = all.filter(pending).length;
    sideCount.hidden = !n;
    sideCount.textContent = String(n);
    if (panel) {
      const d = ejg.downloads.byId(panel.id);
      if (d) panel.update(d);
      else closePanel();
    }
    const w = where();
    if (w === "dls") {
      // Si solo cambió el progreso, se actualiza en su sitio (sin perder el foco).
      if (listSig() !== dlSig) paintDownloads(true);
      else {
        for (const d of all) rows.get(d.id)?.update(d);
        paintTools();
      }
      hintsChanged();
    } else if (w === "shop" && view.name === "detail" && view.detail) {
      // Botón de la ficha abierta.
      const mine = all.find((d) => d.slug === view.detail.slug);
      if (!mine) return;
      const st = { ...view.detail.status, state: mine.state, downloadId: mine.id, progress: mine.progress, gameId: mine.gameId };
      const changed = st.state !== view.detail.status.state;
      view.detail = { ...view.detail, status: st };
      if (changed) paint(true);
      else {
        const b = mainEl.querySelector(".fi-buy");
        if (b) b.textContent = repackAction(view.detail).label;
      }
    } else if (view.name === "wishlist") fillWishlist(); // etiquetas de estado de la lista
  }
  ejg.downloads.onChange(() => {
    onDownloads();
    onChange();
  });
  onDownloads();

  // ─────────────── pintar ───────────────
  function onStore() {
    if (where() !== "shop") return;
    if (view.name === "search") return fillResults();
    if (view.name === "catalog") return fillCatalog();
    if (view.name === "front" || view.name === "popular") {
      paint(true);
      if (view.auto && store.state.home && !mainEl.contains(focus.current)) focus.first(mainEl);
      if (store.state.home) view.auto = false;
    }
  }

  function paint(keepFocus = false) {
    const prev = keepFocus ? focus.current : null;
    const slug = prev?.closest?.("[data-slug]")?.dataset.slug;
    const key = prev?.dataset?.key;
    const detail = view.name === "detail";
    shopEl.classList.toggle("is-detail", detail);
    const on = detail ? view.prev : view.name;
    side.querySelectorAll(".es-mi").forEach((b) => b.classList.toggle("on", b.dataset.menu === on));
    if (view.name !== "search") searchBox = null;
    if (view.name !== "catalog") catBox = null;
    if (view.name !== "wishlist") wishList = null;
    const content = detail ? detailPage() : view.name === "search" ? searchPage() : view.name === "catalog" ? catalogPage() : view.name === "wishlist" ? wishlistPage() : view.name === "popular" ? popular() : front();
    mainEl.replaceChildren(content);
    if (keepFocus && prev && !prev.isConnected) {
      const again = (key && mainEl.querySelector(`[data-key="${key}"]`)) || (slug && mainEl.querySelector(`[data-slug="${CSS.escape(slug)}"]`));
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else focus.first(mainEl) || focus.first(side);
    }
    hintsChanged();
  }

  function back() {
    if (closePicker()) return true;
    if (askOpen) return askOpen(), true;
    if (closeDialog()) return true;
    if (closePanel()) return true;
    const w = where();
    if (w === "dls") return leaveDownloads(), true;
    if (w !== "shop") return false;
    if (view.name === "detail") {
      view.name = view.prev || "front";
      paint();
      mainEl.scrollTop = view.scroll;
      const el = view.slug && mainEl.querySelector(`[data-slug="${CSS.escape(view.slug)}"]`);
      if (el) focus.focus(el, { silent: true });
      else focus.first(mainEl) || focus.first(side);
      return true;
    }
    if (view.name !== "front") {
      const was = view.name;
      store.search("");
      view.name = "front";
      paint();
      mainEl.scrollTop = 0;
      focus.focus(side.querySelector(`[data-menu="${was}"]`), { silent: true });
      return true;
    }
    show("home", '[data-action="explore"]');
    return true;
  }

  /** Abre la eShop («explore»), una ficha («repack») o las descargas. */
  function open(name = "explore", slug) {
    closeAll();
    if (name === "downloads") return openDownloads(null);
    if (where() !== "shop") {
      show("shop");
      if (name !== "repack") view.name = "front";
    }
    store.loadHome();
    store.loadGenres();
    if (name === "repack" && slug) {
      if (view.name === "detail") view.name = view.prev || "front";
      return openRepack(slug);
    }
    view.name = "front";
    paint();
    mainEl.scrollTop = 0;
    if (!focus.first(mainEl)) {
      view.auto = true;
      focus.focus(side.querySelector('[data-menu="front"]'), { instant: true, silent: true });
    }
  }

  const busy = () => !!dialog || !!askOpen || !!picker;

  return {
    open,
    openRepack,
    back,
    closeAll,
    /** Pistas del mando según la vista. */
    hints() {
      if (busy()) return [["accept", "Aceptar"], ["back", "Cancelar"]];
      if (panel) {
        const d = ejg.downloads.byId(panel.id);
        return [["accept", "Aceptar"], ...(d && (isActive(d) || d.state === "paused") ? [["x", isActive(d) ? "Pausar" : "Reanudar"]] : []), ["back", "Cerrar"]];
      }
      if (where() === "dls") {
        const id = Number(focus.current?.closest?.("[data-dl]")?.dataset.dl);
        const d = id && ejg.downloads.byId(id);
        const all = ejg.downloads.all;
        return [
          ["accept", d ? "Opciones" : "Aceptar"],
          ...(d && (isActive(d) || d.state === "paused") ? [["x", isActive(d) ? "Pausar" : "Reanudar"]] : []),
          ...(all.some(isActive) ? [["y", "Pausar todo"]] : all.some((x) => x.state === "paused") ? [["y", "Reanudar todo"]] : []),
          ["back", "Atrás"],
        ];
      }
      if (view.name === "detail") return [["accept", "Aceptar"], ["y", "Buscar"], ["back", "Atrás"]];
      if (view.name === "wishlist" && focus.current?.closest?.(".wl-row")) {
        const del = focus.current.classList.contains("wl-del");
        return [["accept", del ? "Quitar" : "Ver ficha"], ...(del ? [] : [["x", "Quitar"]]), ["y", "Buscar"], ["lb", "Secciones"], ["back", "Atrás"]];
      }
      return [["accept", "Aceptar"], ["y", "Buscar"], ["lb", "Secciones"], ["back", "Atrás"]];
    },
    /** X (devuelve true si lo gestiona). */
    x(el) {
      if (busy()) return true;
      if (panel || where() === "dls" || el?.dataset?.dlId) return togglePause(el), true;
      // Lista de deseos: quitar el juego de la fila enfocada.
      const row = where() === "shop" && view.name === "wishlist" && el?.closest?.(".wl-row");
      if (row?.__r) return wish(row.__r), true;
      return false;
    },
    /** Y: buscar en la eShop o pausar/reanudar todo en las descargas. */
    y() {
      if (busy() || panel) return true;
      if (where() === "shop") return startSearch(), true;
      if (where() === "dls") {
        const all = ejg.downloads.all;
        if (all.some(isActive)) run(ejg.downloads.pause());
        else if (all.some((d) => d.state === "paused")) run(ejg.downloads.resume());
        return true;
      }
      return false;
    },
    /** LB/RB. */
    cycle(d) {
      if (busy() || panel) return true;
      if (where() !== "shop") return false;
      if (view.name !== "detail") cycle(d);
      return true;
    },
    // Iconos de descarga del HOME.
    railItems() {
      const list = ejg.downloads.all.filter(pending);
      const now = list.filter((d) => d.state === "downloading" || d.state === "installing");
      return [...now, ...list.filter((d) => !now.includes(d))];
    },
    railTile(d, prev) {
      if (prev?.__upd) return prev.__upd(d), prev;
      const bar = h("i");
      const pct = h("span", { class: "dlt-pct" });
      const ico = h("span", { class: "dlt-ico" });
      const label = h("span", { class: "dlt-tag" });
      const el = h(
        "button",
        { class: "stile dltile", "data-focus": "", "data-dl-id": d.id, onclick: () => openDownloads(d.id, "home"), title: d.title },
        h("div", { class: "art" }, art(d.cover || d.hero, d.title), label, h("div", { class: "dlt" }, ico, h("div", { class: "dlt-bar" }, bar), pct)),
      );
      let sig = "";
      el.__upd = (d) => {
        bar.style.width = `${Math.round(d.progress * 1000) / 10}%`;
        pct.textContent = percent(d.progress);
        const s = `${d.state}|${d.checking}`;
        if (s === sig) return;
        sig = s;
        el.dataset.state = d.state;
        ico.innerHTML = I[ICON_OF[d.state]] || "";
        const t = d.state === "downloading" ? (d.checking ? "Comprobando…" : "") : { queued: "En cola", paused: "En pausa", installing: "Instalando…", seeding: "Listo para instalar", completed: "Listo para instalar", error: "Error" }[d.state] || "";
        label.textContent = t;
        label.hidden = !t;
      };
      el.__upd(d);
      return el;
    },
    railState(d) {
      if (d.state === "downloading" && !d.checking) return [`Descargando… ${percent(d.progress)}`, d.downBps ? speed(d.downBps) : "", d.eta ? `quedan ${eta(d.eta)}` : ""].filter(Boolean).join(" · ");
      return stateText(d);
    },
    hasDialog: () => busy() || !!panel,
  };
}
