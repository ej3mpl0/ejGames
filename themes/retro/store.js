// SHOP y DOWNLOADS del tema Retro: menú de cartuchos con cursor ▶, «TODO» (el
// catálogo entero con opciones de recreativa: GÉNERO ◀ ROL ▶), «DESEADOS» (la
// lista de deseados, con ♥ en las filas), ficha a pantalla completa con «MÁS
// COMO ESTE», diálogo de RPG y cola con barras de bloques. La lógica común
// está en /_sdk/kit/store.js.

import { h, keyed } from "/_sdk/kit/dom.js";
import { date } from "/_sdk/kit/format.js";
import { glyph } from "/_sdk/kit/hints.js";
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
  SORTS,
  SIZES,
  WISH_SORTS,
  sortWishlist,
  toggleWish,
  HYPERVISOR,
  hypervisorInfo,
  hypervisorTag,
  repackName,
} from "/_sdk/kit/store.js";
import { seasonOf, seasonBanner, seasonPicks } from "/_sdk/kit/events.js";
import { pixelate } from "./pixel.js";

const SECTIONS = [
  ["today", "HOY", "POPULARES HOY", "★ POPULAR HOY"],
  ["week", "SEMANA", "POPULARES DE LA SEMANA", "★ TOP SEMANA"],
  ["month", "MES", "POPULARES DEL MES", "★ TOP MES"],
  ["latest", "NUEVOS", "NOVEDADES", "NEW!"],
  ["all", "TODO", "TODOS LOS JUEGOS", "CATÁLOGO"],
  ["wish", "DESEADOS", "LISTA DE DESEADOS", "♥ DESEADO"],
  ["search", "BUSCAR", "BUSCAR", "RESULTADO"],
];
const STATE = {
  downloading: "DESCARGANDO",
  queued: "EN COLA",
  paused: "PAUSA",
  seeding: "LISTO",
  completed: "LISTO",
  installing: "INSTALANDO",
  installed: "INSTALADO",
  error: "ERROR",
};
const up = (s) => String(s || "").toUpperCase();
/** Nombre del repack en mayúsculas con el sello «HV» detrás si es crack de hipervisor. */
const upName = (r, tag, props) => repackName({ ...r, title: up(r.title) }, tag, props);
const run = (p) => Promise.resolve(p).catch((e) => window.ejg.ui.toast(e.message || String(e), "error"));

/** Barra de bloques ▓▓▓▓░░░░ (n celdas). */
function blocks(n) {
  return h("span", { class: "bar" }, ...Array.from({ length: n }, () => h("i")));
}
function setBlocks(bar, p) {
  const cells = bar.children;
  const on = Math.floor(Math.max(0, Math.min(1, p || 0)) * cells.length);
  for (let k = 0; k < cells.length; k++) cells[k].className = k < on ? "on" : "";
}
function stateText(d) {
  if (d.state === "downloading" && d.checking) return "COMPROBANDO";
  return STATE[d.state] || up(d.state);
}

export function createStore({ ejg, root, screen, ficha, focus, hints, ticker, tab, goTab, onChange }) {
  const store = createExplore(ejg, () => {
    if (tab() !== "shop") return;
    fillOptions();
    fillList();
  });
  // Evento de temporada (Halloween…): su sección va delante y es la portada.
  const season = () => seasonOf(ejg);
  const sections = () => {
    const ev = season();
    return ev ? [["ev", "MIEDO", up(ev.title), "★ DE MIEDO"], ...SECTIONS] : SECTIONS;
  };
  const home = () => (season() ? "ev" : "today");
  const view = { sec: home(), ficha: null, detail: null, error: "", back: null, wishSort: "added" };
  const latest = { items: null, page: 1, pages: Infinity, loading: false, error: "" };
  let ui = null; // piezas de la pantalla SHOP
  let dialog = null;
  let askOpen = null;
  // Lista de deseados: por perfil y solo en este PC (la guarda el core).
  const wish = ejg.explore.wishlist;
  let wishSig = ""; // slugs de DESEADOS tal como están pintados
  let wishBusy = false;

  // Estado en vivo de un repack (la cola manda sobre lo que trajo la web).
  function live(r) {
    const d = r.slug && ejg.downloads.all.find((x) => x.slug === r.slug);
    if (!d) return r.status || { state: "none" };
    return { state: d.state, downloadId: d.id, gameId: d.gameId ?? r.status?.gameId, progress: d.progress };
  }
  function tag(r) {
    const s = live(r);
    switch (s.state) {
      case "installed":
        return ["✓ INSTALADO", "ok"];
      case "library":
        return ["EN BIBLIOTECA", "ok"];
      case "downloading":
        return [`▼ ${percent(s.progress)}`, "dl"];
      case "queued":
        return ["EN COLA", "dim"];
      case "paused":
        return ["PAUSA", "dim"];
      case "seeding":
      case "completed":
        return ["LISTO", "hi"];
      case "installing":
        return ["INSTALANDO", "hi"];
      case "error":
        return ["ERROR", "err"];
      default:
        return ["", ""];
    }
  }
  const shortSize = (s) => up(sizeText(s).replace(/^(desde|hasta)\s+/i, ""));
  const heart = () => h("span", { class: "s-heart" }, "♥");

  // ─────────────── SHOP ───────────────
  function sectionData() {
    const s = store.state;
    if (view.sec === "wish") {
      const items = sortWishlist(wish.items, view.wishSort);
      wishSig = items.map((r) => r.slug).join(",");
      return {
        items,
        title: "LISTA DE DESEADOS",
        total: items.length,
        empty: [
          h("p", null, "TU LISTA DE DESEADOS ESTÁ VACÍA"),
          h("p", { class: "dim" }, "EN LA FICHA DE UN JUEGO, PULSA «♡ AÑADIR A DESEADOS». SE GUARDA EN ESTE PC, SOLO PARA ESTE PERFIL."),
        ],
      };
    }
    if (view.sec === "all") {
      const c = s.catalog;
      const g = c.filters.genres.length ? c.filters.genres.map(genreName).join(" + ") : "";
      return {
        items: c.items,
        loading: c.loading,
        error: c.error,
        more: c.page > 0 && c.page < c.pages,
        title: g ? up(g) : "TODOS LOS JUEGOS",
        total: c.total,
        approx: c.filtered && c.page < c.pages,
        empty: "NINGÚN CARTUCHO CON ESAS OPCIONES",
      };
    }
    if (view.sec === "search") {
      return {
        items: s.results,
        loading: s.searching,
        error: s.searchError,
        more: s.page < s.pages,
        title: s.query ? `«${up(s.query)}»` : "BUSCAR",
        total: s.total,
        empty: s.query ? "NO HAY NADA CON ESE NOMBRE" : "ESCRIBE EL NOMBRE DE UN JUEGO",
      };
    }
    if (view.sec === "ev") {
      const ev = season();
      const p = seasonPicks(ejg, ev, s.home?.sections, () => tab() === "shop" && view.sec === "ev" && fillList());
      return { items: p.items, loading: p.loading, title: up(ev.title), all: ev.genre, empty: "NO HAY JUEGOS DE MIEDO" };
    }
    const meta = SECTIONS.find((x) => x[0] === view.sec);
    if (!s.home) return { items: [], loading: !s.homeError, error: s.homeError, title: meta[2], retry: true };
    const sec = s.home.sections.find((x) => x.id === view.sec);
    const items = view.sec === "latest" && latest.items ? latest.items : sec ? sec.items : [];
    return {
      items,
      title: meta[2],
      more: view.sec === "latest" && latest.page < latest.pages,
      loading: view.sec === "latest" && latest.loading,
      error: view.sec === "latest" ? latest.error : "",
      empty: "NO HAY JUEGOS AQUÍ",
    };
  }

  function item(r) {
    const [t, cls] = tag(r);
    const inWish = view.sec === "wish";
    // Nombre (con el sello HV si toca) y, fuera de DESEADOS, el ♥ delante.
    const name = repackName(r, "span", { class: "s-t" });
    if (!inWish && wish.has(r.slug)) name.prepend(heart());
    return h(
      "li",
      null,
      h(
        "button",
        { class: "item s-item", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug) },
        name,
        h("span", { class: "s-tag " + cls }, t),
        h("span", { class: "s-size" }, shortSize(r.repackSize)),
        // En DESEADOS, ✕ para quitarlo con el ratón (con mando o teclado, X).
        inWish ? h("span", { class: "s-x", title: "Quitar de deseados", onclick: (e) => (e.stopPropagation(), wishToggle(r)) }, "✕") : null,
      ),
    );
  }

  /** Etiqueta de estado y ♥ de una fila ya pintada. */
  function retag(el, r) {
    const [t, cls] = tag(r);
    const b = el.querySelector(".s-tag");
    if (b.textContent !== t) (b.textContent = t), (b.className = "s-tag " + cls);
    const s = el.querySelector(".s-t");
    const m = s.querySelector(".s-heart");
    const on = view.sec !== "wish" && wish.has(r.slug);
    if (on && !m) s.prepend(heart());
    else if (!on && m) m.remove();
  }
  function retagAll() {
    ui.list.querySelectorAll(".s-item").forEach((el) => {
      const r = bySlug.get(el.dataset.slug);
      if (r) retag(el, r);
    });
  }

  const bySlug = new Map();
  function fillList() {
    if (!ui) return;
    const d = sectionData();
    const before = ui.list.querySelector(".s-item");
    bySlug.clear();
    for (const r of d.items) bySlug.set(r.slug, r);
    ui.head.replaceChildren(
      h("span", null, d.title),
      h("span", null, d.loading && !d.items.length ? "CARGANDO…" : `${d.approx ? "~" : ""}${d.total || d.items.length} JUEGOS`),
    );
    keyed(ui.list, d.items, (r) => r.slug, (r, prev) => {
      if (prev) {
        retag(prev, r);
        return prev;
      }
      return item(r);
    });
    const extra = [];
    if (d.error) {
      extra.push(h("li", { class: "s-msg err" }, "ERROR: " + up(d.error)));
      if (d.retry) extra.push(h("li", null, h("button", { class: "item s-more", "data-focus": "", onclick: () => store.loadHome(true) }, "REINTENTAR")));
    } else if (d.loading) {
      extra.push(h("li", { class: "s-msg" }, "CARGANDO", h("span", { class: "dots" })));
    } else if (!d.items.length) {
      extra.push(h("li", { class: "s-msg" }, d.empty || ""));
    } else if (d.more) {
      extra.push(h("li", null, h("button", { class: "item s-more", "data-focus": "", onclick: () => more(d.items.length) }, "VER MÁS ▼")));
    }
    // Selección del evento: «VER TODO» abre TODO con su género.
    if (d.all && d.items.length) extra.push(h("li", null, h("button", { class: "item s-more", "data-focus": "", onclick: () => openAll({ genres: [d.all] }) }, "VER TODO ▶")));
    ui.list.append(...extra);
    const cur = focus.current;
    const items = ui.list.querySelectorAll(".s-item");
    if (jumpAfter && !store.state.searching) {
      // Búsqueda con el teclado en pantalla: el cursor baja a los resultados.
      jumpAfter = false;
      if (items.length) focus.focus(items[0], { instant: true });
    } else if (moreAt >= 0) {
      // «VER MÁS»: al llegar la página, el cursor salta al primero nuevo.
      if (items.length > moreAt) focus.focus(items[moreAt]), (moreAt = -1);
      else if (!d.loading) moreAt = -1;
      if (!focus.current?.isConnected && items.length) focus.focus(items[items.length - 1], { silent: true });
    } else if (!view.ficha && !dialog && (!cur || !cur.isConnected || !root.contains(cur) || (!before && items.length && cur.classList.contains("s-sec")))) {
      // Primera carga (o sección elegida): el cursor entra en la lista.
      const first = ui.list.querySelector("[data-focus]") || ui.secs.querySelector(".on");
      if (first) focus.focus(first, { instant: true, silent: true });
    }
    if (view.ficha) return;
    showCard(bySlug.get(focus.current?.dataset.slug) || d.items[0]);
  }

  let moreAt = -1;
  let jumpAfter = false;
  async function more(had) {
    moreAt = had;
    if (view.sec === "search") return store.more();
    if (view.sec === "all") return store.browseMore();
    if (latest.loading) return;
    latest.loading = true;
    latest.error = "";
    fillList();
    try {
      const next = latest.items ? latest.page + 1 : 2;
      const r = await ejg.explore.search("", next);
      const base = latest.items || store.state.home.sections.find((x) => x.id === "latest")?.items || [];
      latest.items = base.concat(r.items.filter((x) => !base.some((y) => y.slug === x.slug)));
      latest.page = r.page;
      latest.pages = r.pages;
    } catch (e) {
      latest.error = e.message || String(e);
    }
    latest.loading = false;
    if (tab() === "shop") fillList();
  }

  function showCard(r) {
    if (!ui) return;
    if (!r) {
      ui.card.classList.add("empty");
      return;
    }
    ui.card.classList.remove("empty");
    const meta = sections().find((x) => x[0] === view.sec);
    ui.badge.textContent = meta[3];
    pixelate(ui.hero, [r.hero, r.coverFull, r.cover], ui.heroBox.clientWidth / Math.max(1, ui.heroBox.clientHeight) || 2.4);
    pixelate(ui.cover, [r.cover, r.coverFull], 2 / 3);
    const [t] = tag(r);
    const row = (k, v) => (v ? h("div", null, h("span", null, k), h("b", null, v)) : null);
    ui.info.replaceChildren(
      upName(r, "h3", { class: "s-title" }),
      ...[
        row("VERSIÓN", up(r.version) || "—"),
        row("TAMAÑO", up(sizeText(r.repackSize)) || "¿?"),
        row("ORIGINAL", up(sizeText(r.originalSize))),
        row("GÉNEROS", up(r.genres.slice(0, 3).map(genreLabel).join(" / ")) || "???"),
        row("ESTADO", t || "DISPONIBLE"),
        row("DESEADO", r.addedAt ? up(date(r.addedAt * 1000)) : ""),
      ].filter(Boolean),
    );
    ticker([r.fullTitle, r.companies, r.languages].filter(Boolean).join(" · "));
  }

  // ─────────────── TODO: el catálogo con opciones de recreativa ───────────────
  const genreName = (id) => store.state.genres.find((g) => g.id === id)?.name || "";
  const cyc = (list, i, d) => list[(i + d + list.length) % list.length];

  /** Opciones: [clave, nombre, valor, cambiar(d)] (izquierda/derecha cambian el valor). */
  function options() {
    if (view.sec === "wish") {
      // DESEADOS: solo el orden (se queda mientras dure la sesión).
      const i = Math.max(0, WISH_SORTS.findIndex((o) => o.id === view.wishSort));
      const change = (d) => {
        view.wishSort = cyc(WISH_SORTS, i, d).id;
        fillOptions();
        fillList();
      };
      return [["wsort", "ORDEN", WISH_SORTS[i].label, change]];
    }
    const f = store.state.catalog.filters;
    const genres = [null, ...store.state.genres.map((g) => g.id)];
    const g0 = f.genres[0] ?? null;
    const sortI = Math.max(0, SORTS.findIndex((o) => o.id === f.sort));
    const sizeI = Math.max(0, SIZES.findIndex((o) => o.gb === (f.maxGb || null)));
    return [
      ["genre", "GÉNERO", g0 ? genreName(g0) : "TODOS", (d) => store.browse({ genres: [cyc(genres, genres.indexOf(g0), d)].filter((x) => x != null) })],
      ["sort", "ORDEN", SORTS[sortI].label, (d) => store.browse({ sort: cyc(SORTS, sortI, d).id })],
      ["size", "TAMAÑO", SIZES[sizeI].gb ? SIZES[sizeI].label.replace(/^Hasta /, "≤ ") : "CUALQUIERA", (d) => store.browse({ maxGb: cyc(SIZES, sizeI, d).gb })],
      ["owned", "OCULTAR LOS MÍOS", f.hideOwned ? "SÍ" : "NO", () => store.browse({ hideOwned: !f.hideOwned })],
    ];
  }

  const hasOpts = () => view.sec === "all" || view.sec === "wish";
  function fillOptions() {
    if (!ui) return;
    ui.opts.hidden = !hasOpts();
    if (!hasOpts()) return;
    const had = focus.current && ui.opts.contains(focus.current) ? focus.current.dataset.opt : null;
    ui.opts.replaceChildren(
      ...options().map(([k, label, value, change]) =>
        h(
          "button",
          { class: "s-opt", "data-focus": "", "data-opt": k, onclick: () => (k === "genre" ? pickGenre() : change(1)) },
          h("span", { class: "s-opt-k" }, label),
          h("span", { class: "s-opt-v" }, h("i", null, "◀"), h("b", null, up(value)), h("i", null, "▶")),
        ),
      ),
    );
    ui.opts.__change = (k, d) => options().find((o) => o[0] === k)?.[3](d);
    if (had) focus.focus(ui.opts.querySelector(`[data-opt="${had}"]`), { silent: true, noScroll: true });
  }

  /** A sobre GÉNERO: la lista entera en una ventana de RPG. */
  function pickGenre() {
    const cur = store.state.catalog.filters.genres[0] ?? null;
    const prev = focus.current;
    const done = (id) => {
      w.layer.remove();
      askOpen = null;
      if (id !== undefined) store.browse({ genres: id == null ? [] : [id] });
      if (prev?.isConnected) focus.focus(prev, { silent: true });
      refreshHints();
    };
    const btn = (id, label) => h("button", { class: "rpg-btn" + (id === cur ? " on" : ""), "data-focus": "", onclick: () => done(id) }, up(label));
    const w = rpgWindow("GÉNERO", h("div", { class: "rpg-genres" }, btn(null, "Todos"), ...store.state.genres.map((g) => btn(g.id, g.name))));
    askOpen = () => done(undefined);
    focus.focus(w.body.querySelector(".rpg-btn.on") || w.body.querySelector("[data-focus]"), { instant: true, silent: true });
    ejg.sound.play("open");
    refreshHints();
  }

  /** TODO con estas opciones (las demás, de serie). */
  function openAll(filters = null) {
    store.loadGenres();
    const c = store.state.catalog;
    if (filters) store.browse({ ...emptyFilters(), ...filters });
    else if (!c.page && !c.loading) store.browse({});
    if (view.ficha) closeFicha();
    if (tab() !== "shop") goTab("shop");
    setSection("all");
    focus.focus(ui.opts.querySelector("[data-focus]"), { instant: true });
  }

  function setSection(id, { toList = false } = {}) {
    view.sec = id;
    moreAt = -1;
    if (id === "all") {
      store.loadGenres();
      const c = store.state.catalog;
      if (!c.page && !c.loading) store.browse({});
    }
    if (!ui) return;
    ui.secs.querySelectorAll(".s-sec").forEach((b) => b.classList.toggle("on", b.dataset.sec === id));
    ui.search.hidden = id !== "search";
    if (ui.ev) ui.ev.hidden = id !== "ev";
    fillOptions();
    ui.list.replaceChildren();
    ui.list.scrollTop = 0;
    fillList();
    if (toList) {
      const first = id === "search" && !store.state.results.length ? ui.input : ui.list.querySelector("[data-focus]");
      if (first) focus.focus(first, { instant: true });
    }
    shopHints();
  }
  function stepSection(d) {
    const all = sections();
    const i = all.findIndex((x) => x[0] === view.sec);
    setSection(all[(i + d + all.length) % all.length][0], { toList: true });
  }

  async function openKeyboard() {
    const q = await askQuery(ejg, store.state.query, "BUSCAR JUEGOS");
    if (q == null) return false;
    ui.input.value = q;
    jumpAfter = !!q.trim();
    store.search(q, 0);
    return true;
  }
  /** Y o una letra: a BUSCAR (con mando, teclado en pantalla). */
  async function openSearch(letter) {
    if (view.sec !== "search") setSection("search");
    if (letter) {
      ui.input.value = letter;
      store.search(letter);
    }
    focus.focus(ui.input, { instant: true });
    ui.input.focus();
    if (!letter && ejg.input.source === "gamepad") openKeyboard();
  }

  function paintShop() {
    const secs = h(
      "div",
      { class: "s-secs", "data-focus-group": "secs" },
      h("span", { class: "s-arrow" }, "◀"),
      ...sections().map(([id, label]) =>
        h(
          "button",
          { class: "s-sec" + (view.sec === id ? " on" : ""), "data-focus": "", "data-sec": id, onclick: () => setSection(id, { toList: true }) },
          label,
          id === "wish" ? h("span", { class: "s-sec-n", hidden: !wish.items.length }, String(wish.items.length)) : null,
        ),
      ),
      h("span", { class: "s-arrow" }, "▶"),
      h("button", { class: "s-sec", "data-focus": "", onclick: () => ejg.ui.open("catalogs") }, "CATÁLOGOS"),
      h("button", { class: "s-sec", "data-focus": "", onclick: () => ejg.ui.open("software") }, "HOMEBREW"),
    );
    const input = h("input", {
      class: "s-input",
      "data-focus": "",
      spellcheck: "false",
      maxlength: "60",
      placeholder: "NOMBRE DEL JUEGO",
      value: store.state.query,
      oninput: (e) => store.search(e.target.value),
      onclick: (e) => {
        if (e.detail) return; // ratón: se escribe sin más
        if (ejg.input.source === "gamepad") return openKeyboard();
        const first = ui.list.querySelector(".s-item");
        if (first) focus.focus(first);
      },
    });
    const search = h("label", { class: "s-search", hidden: view.sec !== "search" }, h("span", null, "BUSCAR>"), input, h("span", { class: "s-caret" }, "█"));
    const opts = h("div", { class: "s-opts", "data-focus-group": "opts", hidden: !hasOpts() });
    const head = h("div", { class: "s-head" });
    const list = h("ol", { class: "list s-list", "data-focus-group": "shop-list" });
    const hero = h("canvas", { width: 16, height: 9 });
    const badge = h("span", { class: "s-badge" });
    const heroBox = h("div", { class: "s-hero" }, hero, badge);
    const cover = h("canvas", { width: 84, height: 126 });
    const info = h("div", { class: "info s-info" });
    const card = h(
      "div",
      { class: "s-card" },
      heroBox,
      h("div", { class: "s-mid" }, h("div", { class: "art s-art" }, cover), info),
      h("div", { class: "s-none" }, h("span", { class: "blink-slow" }, "INSERT CARTRIDGE")),
    );
    // Evento: su banner y su lema encima de la lista, solo en su sección.
    const sev = season();
    const ev = sev && h("div", { class: "s-ev", hidden: view.sec !== "ev" }, seasonBanner(sev, "s-ev-banner"), h("p", { class: "s-ev-sub" }, up(sev.subtitle)));
    ui = { secs, search, opts, input, head, list, hero, heroBox, badge, cover, info, card, ev };
    root.replaceChildren(h("div", { class: "shop" + (sev ? " ev ev-" + sev.id : "") }, h("div", { class: "s-left" }, ev, secs, search, opts, head, list), card));
    fillOptions();
    fillList();
    const first = list.querySelector("[data-focus]") || secs.querySelector(".on");
    if (first) focus.focus(first, { instant: true, silent: true });
  }

  function shopHints() {
    if (askOpen) return hints.set([["accept", "ELEGIR"], ["back", "CANCELAR"]]);
    if (dialog) return hints.set([["accept", "MARCAR"], ["back", "CANCELAR"]]);
    if (view.ficha) return hints.set([["accept", "ELEGIR"], ...(view.detail ? [["x", wishHint(view.detail.slug)]] : []), ["back", "VOLVER"]]);
    if (focus.current === ui?.input)
      return hints.set([["accept", ejg.input.source === "gamepad" ? "TECLADO" : "RESULTADOS"], ["down", "LISTA"], ["back", "SALIR"]]);
    const r = bySlug.get(focus.current?.dataset.slug);
    hints.set([["accept", "VER"], ...(r ? [["x", wishHint(r.slug)]] : []), ["y", "BUSCAR"], ["right", "SECCIÓN"], ["lb", "PESTAÑA"], ["back", "SALIR"]]);
  }

  // ─────────────── DESEADOS ───────────────
  const wishHint = (slug) => (wish.has(slug) ? "♥ QUITAR" : "♥ DESEAR");

  /** Añade o quita (con su aviso); lo que se ve cambia con wish.onChange. */
  function wishToggle(r) {
    if (wishBusy) return;
    wishBusy = true;
    toggleWish(ejg, r).finally(() => (wishBusy = false));
  }

  /** X: el juego de la ficha o el de la fila con el cursor, a DESEADOS o fuera. */
  function wishKey() {
    const r = view.ficha ? view.detail : bySlug.get(focus.current?.dataset.slug);
    if (!r) return false;
    ejg.sound.play("select");
    wishToggle(r);
    return true;
  }

  /** Botón de la ficha: dice lo que hará y se enciende si ya está en la lista. */
  function paintWish(b, slug) {
    const on = wish.has(slug);
    b.classList.toggle("on", on);
    b.textContent = on ? "♥ QUITAR DE DESEADOS" : "♡ AÑADIR A DESEADOS";
  }

  /** Repinta DESEADOS; si se fue el juego del cursor, pasa al de al lado. */
  function refillWish() {
    const rowsOf = () => [...ui.list.querySelectorAll(".s-item")];
    const anchor = view.ficha ? view.back && root.querySelector(`[data-slug="${CSS.escape(view.back)}"]`) : focus.current;
    const at = anchor ? rowsOf().indexOf(anchor) : -1;
    fillList();
    if (at < 0 || anchor.isConnected) return;
    const left = rowsOf();
    const next = left[Math.min(at, left.length - 1)];
    // Con la ficha abierta, el cursor vuelve ahí al cerrarla.
    if (view.ficha) view.back = next?.dataset.slug || null;
    else if (next) focus.focus(next, { silent: true });
  }

  /** La lista cambió (aquí, en otro tema o en el host): contador, filas, ♥ y ficha. */
  function onWish() {
    if (tab() !== "shop" || !ui) return;
    const n = wish.items.length;
    const c = ui.secs.querySelector(".s-sec-n");
    if (c) (c.hidden = !n), (c.textContent = String(n));
    if (view.sec === "wish") {
      const items = sortWishlist(wish.items, view.wishSort);
      if (items.map((r) => r.slug).join(",") !== wishSig) refillWish();
      else {
        // Solo cambió el estado (descargando, instalado…): en su sitio.
        for (const r of items) bySlug.set(r.slug, r);
        retagAll();
      }
    } else retagAll();
    const b = view.ficha && ficha.querySelector(".f-wish");
    if (b) paintWish(b, view.ficha);
    shopHints();
  }
  wish.onChange(onWish);

  // Empieza o acaba el evento: su sección entra o sale (y pasa a ser la portada).
  ejg.season.onChange(() => {
    if (view.sec === "ev" || view.sec === "today") view.sec = home();
    if (tab() === "shop" && ui && !view.ficha && !dialog && !askOpen) paintShop(), shopHints();
  });

  // ─────────────── ficha ───────────────
  async function openRepack(slug) {
    view.back = focus.current?.dataset.slug || view.back;
    view.ficha = slug;
    view.detail = null;
    view.error = "";
    ficha.hidden = false;
    document.documentElement.dataset.ficha = "";
    paintFicha();
    ejg.sound.play("open");
    try {
      view.detail = await store.details(slug);
    } catch (e) {
      view.error = e.message || String(e);
    }
    if (view.ficha !== slug) return;
    paintFicha();
  }

  function closeFicha() {
    if (!view.ficha) return false;
    view.ficha = null;
    view.detail = null;
    ficha.hidden = true;
    delete document.documentElement.dataset.ficha;
    ficha.replaceChildren();
    const el = view.back && root.querySelector(`[data-slug="${CSS.escape(view.back)}"]`);
    // Si su fila ya no está (p. ej. quitado de DESEADOS), a la lista o a la sección.
    const alt = ui && (ui.list.querySelector("[data-focus]") || ui.secs.querySelector(".on"));
    if (el) focus.focus(el, { silent: true });
    else if (alt?.isConnected) focus.focus(alt, { silent: true });
    else focus.first(root);
    view.back = null;
    shopHints();
    return true;
  }

  function doAction(d, act) {
    const st = live(d);
    if (act.id === "download") return openDialog(d);
    if (act.id === "install" && st.downloadId) return run(ejg.downloads.install(st.downloadId));
    if (act.id === "play" && st.gameId) return run(ejg.game.launch(st.gameId));
    closeFicha();
    goTab("downloads");
  }

  function paintFicha() {
    const d = view.detail;
    const back = h("button", { class: "pbtn", "data-focus": "", onclick: closeFicha }, "◀ VOLVER");
    if (!d) {
      ficha.replaceChildren(
        h(
          "div",
          { class: "f-wait" },
          view.error ? h("p", { class: "err" }, "ERROR: " + up(view.error)) : h("p", null, "CARGANDO", h("span", { class: "dots" })),
          back,
        ),
      );
      focus.focus(back, { instant: true, silent: true });
      shopHints();
      return;
    }
    const act = repackAction({ ...d, status: live(d) });
    const btn = h("button", { class: "cart-btn", "data-focus": "", onclick: () => doAction(d, act) }, h("span", { class: "cart-lbl" }, up(act.label)));
    const wishBtn = h("button", { class: "pbtn wide f-wish", "data-focus": "", onclick: () => wishToggle(d) });
    paintWish(wishBtn, d.slug);
    const cover = h("canvas", { width: 84, height: 126 });
    const screenC = h("canvas", { width: 16, height: 9 });
    const shots = d.screenshots.slice(0, 8);
    const show = (k) => {
      pixelate(screenC, [shots[k].full, shots[k].thumb], 16 / 9);
      thumbs.querySelectorAll(".f-thumb").forEach((t, j) => t.classList.toggle("on", j === k));
    };
    const thumbs = h(
      "div",
      { class: "f-thumbs", "data-focus-group": "shots", style: { gridTemplateColumns: `repeat(${Math.ceil(shots.length / Math.ceil(shots.length / 6))}, minmax(0, 1fr))` } },
      ...shots.map((s, k) => {
        const c = h("canvas", { width: 16, height: 9 });
        const b = h("button", { class: "f-thumb" + (k ? "" : " on"), "data-focus": "", onclick: () => show(k), onfocus: () => show(k) }, c);
        requestAnimationFrame(() => pixelate(c, s.thumb, 16 / 9));
        return b;
      }),
    );
    const row = (k, v) => (v ? h("tr", null, h("th", null, k), h("td", null, v)) : null);
    const table = h(
      "table",
      { class: "f-table" },
      h(
        "tbody",
        null,
        ...[
          row("GÉNEROS", up(d.genres.map(genreLabel).join(", "))),
          row("COMPAÑÍAS", up(d.companies)),
          row("IDIOMAS", up(d.languages)),
          row("PUBLICADO", up(date(d.date))),
          row("REPACK", d.number ? `#${d.number}` : null),
          row("ORIGINAL", up(sizeText(d.originalSize))),
          row("DESCARGA", up(sizeText(d.repackSize))),
          row("INSTALADO", up(sizeText(d.installSize))),
          row("SELECTIVA", d.selective ? "SÍ · IDIOMAS Y EXTRAS" : null),
          d.hypervisor ? h("tr", { class: "hv-row", title: HYPERVISOR.tip }, h("th", null, "CRACK"), h("td", null, hypervisorTag(d), " HIPERVISOR")) : null,
          row("ESTADO", tag(d)[0] || "DISPONIBLE"),
        ].filter(Boolean),
      ),
    );
    const desc = h("div", { class: "f-desc" });
    for (const block of String(d.description || "").split(/\n{2,}/)) {
      const lines = block.split("\n").filter((l) => l.trim());
      if (!lines.length) continue;
      if (lines.every((l) => l.startsWith("• "))) desc.append(h("ul", { class: "f-feat" }, ...lines.map((l) => h("li", null, l.slice(2)))));
      else lines.forEach((l) => desc.append(l.startsWith("• ") ? h("ul", { class: "f-feat" }, h("li", null, l.slice(2))) : h("p", null, l)));
    }
    // Crack de hipervisor: pantalla de «WARNING» de recreativa encima de los datos,
    // a la altura del botón de descarga. Los botones, como los demás de la ficha.
    const hv = hypervisorInfo(ejg, d, {
      labels: { moreLabel: "▼ PASOS Y RIESGOS", lessLabel: "▲ OCULTAR DETALLES", guideLabel: up(HYPERVISOR.guideLabel) },
    });
    hv?.querySelectorAll(".hv-more, .hv-guide").forEach((b) => b.classList.add("pbtn"));
    hv?.setAttribute("data-focus-group", "hv");
    ficha.replaceChildren(
      h("div", { class: "f-head" }, h("div", { class: "f-titles" }, upName(d, "h2"), d.version ? h("div", { class: "f-ver" }, up(d.version)) : null), back),
      h(
        "div",
        { class: "f-grid" },
        h(
          "div",
          { class: "f-side", "data-focus-group": "buy" },
          h("div", { class: "art f-art" }, cover),
          btn,
          act.hint ? h("p", { class: "f-hint" }, up(act.hint)) : null,
          wishBtn,
          d.url ? h("button", { class: "pbtn wide", "data-focus": "", onclick: () => ejg.explore.openPage(d.slug) }, "VER EN FITGIRL ↗") : null,
          ...(d.tags || [])
            .map((t) => store.state.genres.find((g) => g.id === t && g.group === "genre"))
            .filter(Boolean)
            .slice(0, 3)
            .map((g) => h("button", { class: "pbtn wide", "data-focus": "", onclick: () => openAll({ genres: [g.id] }) }, `MÁS DE ${up(g.name)} ▶`)),
        ),
        h("div", { class: "f-data" }, hv, h("h3", { class: "f-h" }, "▶ DATOS"), table),
        shots.length ? h("div", { class: "f-shots" }, h("h3", { class: "f-h" }, `▶ CAPTURAS (${shots.length})`), h("div", { class: "f-screen" }, screenC), thumbs) : null,
      ),
      h(
        "div",
        { class: "f-bottom" },
        d.features.length ? h("div", null, h("h3", { class: "f-h" }, "▶ CARACTERÍSTICAS"), h("ul", { class: "f-feat" }, ...d.features.map((f) => h("li", null, f)))) : null,
        d.description ? h("div", null, h("h3", { class: "f-h" }, "▶ DESCRIPCIÓN"), desc) : null,
        similarList(d),
      ),
    );
    requestAnimationFrame(() => {
      pixelate(cover, [d.coverFull, d.cover], 2 / 3);
      if (shots.length) pixelate(screenC, [shots[0].full, shots[0].thumb], 16 / 9);
    });
    ficha.scrollTop = 0;
    focus.focus(btn, { instant: true, silent: true });
    ticker([d.fullTitle, d.companies, d.languages].filter(Boolean).join(" · "));
    shopHints();
  }

  /** «MÁS COMO ESTE»: una lista de cartuchos como la de la tienda. */
  function similarList(d) {
    const list = h("ol", { class: "list f-similar", "data-focus-group": "similar" }, h("li", { class: "s-msg" }, "CARGANDO", h("span", { class: "dots" })));
    const box = h("div", null, h("h3", { class: "f-h" }, "▶ MÁS COMO ESTE"), list);
    store.similar(d, 10).then((items) => {
      if (view.ficha !== d.slug) return;
      if (!items.length) return box.remove();
      list.replaceChildren(
        ...items.map((r) =>
          h(
            "li",
            null,
            h("button", { class: "item s-item", "data-focus": "", onclick: () => openRepack(r.slug) }, repackName(r, "span", { class: "s-t" }), h("span", { class: "s-size" }, shortSize(r.repackSize))),
          ),
        ),
      );
    });
    return box;
  }

  // ─────────────── diálogo de RPG ───────────────
  function rpgWindow(title, ...content) {
    const body = h("div", { class: "rpg-body" }, ...content);
    const win = h("div", { class: "rpg" }, h("div", { class: "rpg-title" }, title), body);
    const layer = h("div", { class: "rpg-layer", "data-focus-trap": "" }, win);
    screen.append(layer);
    return { layer, body, win };
  }
  const lead = (k, v) => h("div", { class: "lead" }, h("span", null, k), h("i"), v);

  async function openDialog(d) {
    closeDialog();
    const wait = h("p", { class: "rpg-wait" }, "BUSCANDO EL TORRENT", h("span", { class: "dots" }));
    const cancel = h("button", { class: "rpg-btn", "data-focus": "", onclick: () => closeDialog() }, "CANCELAR");
    const foot = h("div", { class: "rpg-foot" }, cancel);
    const w = rpgWindow("DESCARGAR", upName(d, "p", { class: "rpg-name" }), wait, foot);
    dialog = { layer: w.layer, slug: d.slug, prep: null, prev: focus.current };
    ejg.sound.play("open");
    focus.focus(cancel, { instant: true, silent: true });
    shopHints();
    let prep;
    try {
      prep = await ejg.downloads.prepare(d.slug);
    } catch (e) {
      if (dialog?.slug !== d.slug) return;
      wait.replaceWith(h("p", { class: "err" }, "ERROR: " + up(e.message || String(e))));
      return;
    }
    if (dialog?.slug !== d.slug) return;
    dialog.prep = prep;
    const sel = fileSelection(prep);
    let dir = prep.dir ? { path: prep.dir, freeBytes: prep.freeBytes } : null;
    const need = h("b");
    const avail = h("b");
    const pathEl = h("span", { class: "rpg-path" });
    const err = h("p", { class: "err" });
    const ok = h("button", { class: "rpg-btn", "data-focus": "" }, "DESCARGAR");
    const upd = () => {
      need.textContent = bytes(sel.bytes);
      avail.textContent = dir?.freeBytes != null ? bytes(dir.freeBytes) : "—";
      pathEl.textContent = dir?.path || "ELIGE UNA CARPETA";
      const problem = !dir ? "Elige dónde guardar la descarga" : sel.error || (!sel.fits(dir.freeBytes) ? "No hay espacio suficiente en ese disco" : "");
      err.textContent = problem ? "! " + up(problem) : "";
      ok.disabled = !!problem;
    };
    const check = (f) =>
      h(
        "button",
        {
          class: "chk",
          "data-focus": "",
          onclick: (e) => {
            sel.toggle(f.index);
            e.currentTarget.querySelector(".box").textContent = sel.isSelected(f.index) ? "[X]" : "[ ]";
            upd();
          },
        },
        h("span", { class: "box" }, sel.isSelected(f.index) ? "[X]" : "[ ]"),
        h("span", { class: "lbl" }, up(f.label)),
        h("span", { class: "sz" }, bytes(f.size)),
      );
    const groups = [
      ["IDIOMAS", sel.languages],
      ["EXTRAS OPCIONALES", sel.optional],
    ].filter(([, l]) => l.length);
    const base = sel.required.reduce((a, f) => a + f.size, 0);
    const body = [
      // Crack de hipervisor: aviso con el sello HV antes de todo lo demás.
      prep.hypervisor
        ? h("div", { class: "hv-warn", role: "note" }, h("span", { class: "hv-warn-k", "aria-hidden": "true" }, HYPERVISOR.badge), h("p", null, HYPERVISOR.download))
        : null,
      lead("ESPACIO NECESARIO", need),
      lead("ESPACIO LIBRE", avail),
      h(
        "div",
        { class: "rpg-dir" },
        h("span", null, "CARPETA:"),
        pathEl,
        h(
          "button",
          {
            class: "pbtn",
            "data-focus": "",
            onclick: async () => {
              const p = await ejg.downloads.pickFolder(dir?.path).catch(() => null);
              if (p) {
                dir = p;
                upd();
              }
            },
          },
          "CAMBIAR…",
        ),
      ),
      h(
        "div",
        { class: "rpg-group" },
        h("h4", null, "OBLIGATORIO"),
        h("div", { class: "chk locked" }, h("span", { class: "box" }, "[■]"), h("span", { class: "lbl" }, `JUEGO BASE · ${sel.required.length} ARCHIVOS`), h("span", { class: "sz" }, bytes(base))),
      ),
      ...groups.map(([title, list]) => h("div", { class: "rpg-group", "data-focus-group": "chk-" + title }, h("h4", null, title), ...list.map(check))),
      groups.length ? h("p", { class: "rpg-note" }, "* EN EL INSTALADOR, DESMARCA LO QUE NO HAYAS DESCARGADO.") : null,
      prep.installSize
        ? h(
            "p",
            { class: "rpg-note" },
            `* EL JUEGO INSTALADO OCUPARÁ ${up(sizeText(prep.installSize))}${prep.installFreeBytes != null && prep.installDir ? ` (QUEDAN ${bytes(prep.installFreeBytes)} EN ${prep.installDir})` : ""}.`,
          )
        : null,
      err,
    ].filter(Boolean);
    wait.replaceWith(...body);
    ok.onclick = async () => {
      ok.disabled = true;
      ok.textContent = "AÑADIENDO…";
      try {
        await ejg.downloads.start(prep.token, sel.indices(), dir.path);
        closeDialog(true);
        ejg.ui.toast(`«${d.title}» añadido a Descargas`, "ok");
        store.refresh();
        if (view.ficha === d.slug) openRepack(d.slug);
      } catch (e) {
        err.textContent = "! " + up(e.message || String(e));
        ok.disabled = false;
        ok.textContent = "DESCARGAR";
      }
    };
    foot.replaceChildren(ok, cancel);
    upd();
    focus.focus(ok.disabled ? w.body.querySelector(".chk[data-focus], .pbtn") : ok, { instant: true, silent: true });
  }

  function closeDialog(done) {
    if (!dialog) return false;
    if (!dialog.prep && !done) ejg.downloads.cancelPrepare(dialog.slug).catch(() => {});
    dialog.layer.remove();
    const prev = dialog.prev;
    dialog = null;
    if (prev?.isConnected) focus.focus(prev, { silent: true });
    else focus.first(view.ficha ? ficha : root);
    refreshHints();
    return true;
  }

  /** Pregunta de RPG con opciones en columna: devuelve el valor elegido (o null). */
  function ask(title, text, options) {
    return new Promise((resolve) => {
      const prev = focus.current;
      const done = (v) => {
        w.layer.remove();
        askOpen = null;
        if (prev?.isConnected) focus.focus(prev, { silent: true });
        else focus.first(root);
        refreshHints();
        resolve(v);
      };
      const btns = options.map(([label, v]) => h("button", { class: "rpg-btn", "data-focus": "", onclick: () => done(v) }, label));
      const w = rpgWindow(title, h("p", null, text), h("div", { class: "rpg-choices" }, ...btns, h("button", { class: "rpg-btn", "data-focus": "", onclick: () => done(null) }, "CANCELAR")));
      w.win.classList.add("small");
      askOpen = () => done(null);
      focus.focus(btns[0], { instant: true, silent: true });
      ejg.sound.play("open");
      refreshHints();
    });
  }

  // ─────────────── DOWNLOADS ───────────────
  function actions(d) {
    const a = [];
    if (canInstall(d)) a.push(["accept", "INSTALAR", () => run(ejg.downloads.install(d.id))]);
    else if (d.pauseReason === "needs-folder") a.push(["accept", "ELEGIR CARPETA", () => run(ejg.downloads.locate(d.id))]);
    else if (d.state === "installed" && d.gameId) a.push(["accept", "JUGAR", () => run(ejg.game.launch(d.gameId))]);
    else if (isActive(d)) a.push(["accept", "PAUSAR", () => run(ejg.downloads.pause(d.id))]);
    else if (d.state === "paused" || d.state === "error") a.push(["accept", d.state === "error" ? "REINTENTAR" : "REANUDAR", () => run(ejg.downloads.resume(d.id))]);
    if (d.state === "queued") a.push(["rt", "SUBIR", () => run(ejg.downloads.move(d.id, 0))]);
    if (!(d.state === "installed" && d.filesDeleted)) a.push(["y", "CARPETA", () => run(ejg.downloads.openFolder(d.id))]);
    if (d.state !== "installing") a.push(["x", "QUITAR", () => removeDl(d)]);
    return a;
  }

  async function removeDl(d) {
    if (d.filesDeleted) return run(ejg.downloads.remove(d.id, false));
    const keepGame = d.state === "installed";
    const files = await ask(
      "QUITAR",
      keepGame ? `¿BORRAR TAMBIÉN EL REPACK DE «${up(d.title)}»? EL JUEGO INSTALADO NO SE TOCA.` : `¿BORRAR TAMBIÉN LO DESCARGADO DE «${up(d.title)}» (${bytes(d.doneBytes)})?`,
      [
        ["BORRAR ARCHIVOS", true],
        ["CONSERVARLOS", false],
      ],
    );
    if (files != null) run(ejg.downloads.remove(d.id, files));
  }

  function meta(d) {
    const size = `${bytes(d.doneBytes)} / ${bytes(d.totalBytes)}`;
    switch (d.state) {
      case "downloading":
        if (d.checking || !d.downBps) return [size, up(downloadLabel(d))];
        return [size, speed(d.downBps), d.eta ? `QUEDAN ${up(eta(d.eta))}` : "", d.peers ? `${d.peers} FUENTES` : ""];
      case "queued":
      case "paused":
        // «En cola» / «En pausa» ya los dice el estado; el motivo, si es otro.
        return [size, /^(queue|user)?$/.test(d.pauseReason || "") ? "" : up(downloadLabel(d))];
      case "seeding":
      case "completed":
        return [bytes(d.totalBytes), up(downloadLabel(d))];
      case "installing":
        return ["INSTALANDO…"];
      case "installed":
        return [d.filesDeleted ? "REPACK BORRADO" : `REPACK EN DISCO · ${bytes(d.totalBytes)}`];
      case "error":
        return [size, up(d.error || "ERROR")];
      default:
        return [size];
    }
  }

  const rows = new Map();
  function dlRow(d) {
    const cv = h("canvas", { width: 44, height: 66 });
    const title = h("b", { class: "d-t" });
    const st = h("span", { class: "d-st" });
    const bar = blocks(20);
    const pct = h("span", { class: "d-pct" });
    const info = h("span", { class: "d-meta" });
    const keys = h("div", { class: "d-keys" });
    const r = { d, acts: actions(d) };
    const el = h(
      "button",
      {
        class: "d-row",
        "data-focus": "",
        "data-dl": d.id,
        // Con mando/teclado (accept) hace la acción principal; con ratón, las teclas de la fila.
        onclick: (e) => {
          if (e.detail) return;
          const a = r.acts.find((x) => x[0] === "accept");
          if (a) a[2]();
        },
      },
      h("div", { class: "d-art" }, cv),
      h("div", { class: "d-main" }, h("div", { class: "d-line" }, title, st), h("div", { class: "d-line2" }, bar, pct, info), keys),
    );
    r.el = el;
    r.keys = () =>
      keys.replaceChildren(
        ...r.acts.map(([k, label, fn]) =>
          h(
            "span",
            {
              class: "d-key",
              onclick: (e) => {
                e.stopPropagation();
                fn();
              },
            },
            glyph(k),
            label,
          ),
        ),
      );
    r.update = (d) => {
      r.d = d;
      title.textContent = up(d.title);
      st.textContent = stateText(d);
      el.className = `d-row s-${d.state}${el.classList.contains("is-focused") ? " is-focused" : ""}`;
      setBlocks(bar, d.progress);
      pct.textContent = d.state === "installed" ? "" : percent(d.progress);
      info.textContent = meta(d).filter(Boolean).join(" · ");
    };
    r.update(d);
    r.keys();
    pixelate(cv, [d.cover, d.hero], 2 / 3);
    return r;
  }

  const groupsOf = (all) => [
    ["EN CURSO", all.filter((d) => d.state === "downloading" || d.state === "installing")],
    ["EN COLA", all.filter((d) => d.state === "queued" || d.state === "paused" || d.state === "error")],
    ["LISTOS PARA INSTALAR", all.filter((d) => d.state === "seeding" || d.state === "completed")],
    ["INSTALADOS", all.filter((d) => d.state === "installed")],
  ];
  const totals = (all) => all.filter((d) => d.state === "downloading").reduce((a, d) => a + d.downBps, 0);
  function summary(all) {
    const n = (f) => all.filter(f).length;
    return [
      ["DESCARGANDO", "DESCARGANDO", n((d) => d.state === "downloading")],
      ["EN COLA", "EN COLA", n((d) => d.state === "queued" || d.state === "paused")],
      ["LISTO", "LISTOS", n(canInstall)],
      ["ERROR", "ERRORES", n((d) => d.state === "error")],
    ]
      .filter(([, , v]) => v)
      .map(([one, many, v]) => `${v} ${v === 1 ? one : many}`)
      .join(" · ");
  }

  let dlSig = "";
  const listSig = () => {
    const all = ejg.downloads.all;
    return (
      all.map((d) => `${d.id}:${d.state}:${d.pauseReason}:${d.filesDeleted}:${d.gameId}`).join(",") +
      `|${all.some(isActive)}|${all.some((d) => d.state === "paused")}`
    );
  };
  let dlTop = null;

  function paintDownloads(keepFocus = false) {
    const all = ejg.downloads.all;
    const prevId = keepFocus ? focus.current?.closest?.("[data-dl]")?.dataset.dl : null;
    dlSig = listSig();
    rows.clear();
    dlTop = { sum: h("span", { class: "d-sum" }), speed: h("span", { class: "d-speed" }) };
    const top = h(
      "div",
      { class: "d-top", "data-focus-group": "dl-top" },
      dlTop.sum,
      dlTop.speed,
      h(
        "div",
        { class: "d-all" },
        all.some(isActive) ? h("button", { class: "pbtn", "data-focus": "", onclick: () => run(ejg.downloads.pause()) }, "❚❚ PAUSAR TODO") : null,
        all.some((d) => d.state === "paused") ? h("button", { class: "pbtn", "data-focus": "", onclick: () => run(ejg.downloads.resume()) }, "▶ REANUDAR TODO") : null,
      ),
    );
    const list = h("div", { class: "d-list", "data-focus-group": "dl" });
    for (const [label, items] of groupsOf(all)) {
      if (!items.length) continue;
      list.append(h("div", { class: "d-h" }, `${label} (${items.length})`));
      for (const d of items) {
        const r = dlRow(d);
        rows.set(d.id, r);
        list.append(r.el);
      }
    }
    if (!all.length) {
      list.append(
        h(
          "div",
          { class: "s-msg d-empty" },
          h("p", null, "NO HAY DESCARGAS"),
          h("p", { class: "dim" }, "BUSCA UN JUEGO EN SHOP Y PULSA «DESCARGAR»."),
          ejg.explore.enabled ? h("button", { class: "pbtn", "data-focus": "", onclick: () => goTab("shop") }, "▶ IR A SHOP") : null,
        ),
      );
    }
    root.replaceChildren(h("div", { class: "dls" }, top, list));
    updateTop();
    const again = prevId && list.querySelector(`[data-dl="${prevId}"]`);
    if (again) focus.focus(again, { silent: true, noScroll: true });
    else if (!keepFocus || !focus.current?.isConnected) focus.first(list.querySelector("[data-focus]") ? list : root);
    dlHints();
  }
  function updateTop() {
    if (!dlTop) return;
    const all = ejg.downloads.all;
    dlTop.sum.textContent = summary(all) || (all.length ? "NADA EN MARCHA" : "COLA VACÍA");
    const s = totals(all);
    dlTop.speed.textContent = s ? `▼ ${speed(s)}` : "";
  }

  function dlHints() {
    if (askOpen) return hints.set([["accept", "ELEGIR"], ["back", "CANCELAR"]]);
    const id = focus.current?.dataset.dl;
    const r = id && rows.get(Number(id));
    if (!r) return hints.set([["accept", "ELEGIR"], ["lb", "PESTAÑA"], ["back", "SALIR"]]);
    const order = ["accept", "y", "x", "rt"];
    hints.set([...r.acts.slice().sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([k, l]) => [k, l]), ["lb", "PESTAÑA"]]);
  }

  function onDownloads() {
    const t = tab();
    if (t === "downloads") {
      // Solo progreso: se actualiza en su sitio (sin perder el foco).
      if (listSig() !== dlSig) return paintDownloads(true);
      for (const d of ejg.downloads.all) rows.get(d.id)?.update(d);
      updateTop();
    } else if (t === "shop") {
      if (view.ficha && view.detail) {
        const b = ficha.querySelector(".cart-lbl");
        const act = repackAction({ ...view.detail, status: live(view.detail) });
        if (b && b.textContent !== up(act.label)) {
          const had = focus.current?.classList.contains("cart-btn");
          const top = ficha.scrollTop;
          paintFicha();
          ficha.scrollTop = top;
          if (!had) focus.first(ficha);
        }
      }
      if (ui) retagAll();
    }
  }
  ejg.downloads.onChange(() => {
    onDownloads();
    onChange();
  });
  // Los glifos de las teclas cambian con el mando.
  ejg.on("input", () => {
    if (tab() === "downloads") rows.forEach((r) => r.keys());
    else if (focus.current === ui?.input) shopHints();
  });

  // ─────────────── indicador de la pantalla principal ───────────────
  let st = null;
  function status(el) {
    const all = ejg.downloads.all;
    const cur = all.find((d) => d.state === "downloading") || all.find((d) => d.state === "installing");
    const ready = all.filter(canInstall).length;
    const queued = all.filter((d) => d.state === "queued").length;
    if (!cur && !ready) return void (el.hidden = true);
    if (!st || !el.contains(st.bar)) {
      st = { ico: h("span", { class: "st-ico" }), label: h("span", { class: "st-l" }), title: h("span", { class: "st-t" }), bar: blocks(12), pct: h("span", { class: "st-p" }), meta: h("span", { class: "st-m" }) };
      el.replaceChildren(st.ico, st.label, st.title, st.bar, st.pct, st.meta);
    }
    el.hidden = false;
    if (cur) {
      st.ico.textContent = cur.state === "installing" ? "⚙" : "▼";
      st.label.textContent = cur.state === "installing" ? "INSTALANDO" : "DESCARGANDO";
      st.title.textContent = up(cur.title);
      st.bar.hidden = false;
      setBlocks(st.bar, cur.progress);
      st.pct.textContent = percent(cur.progress);
    } else {
      st.ico.textContent = "★";
      st.label.textContent = "LISTO PARA INSTALAR";
      st.title.textContent = up(all.find(canInstall).title);
      st.bar.hidden = true;
      st.pct.textContent = "";
    }
    st.meta.textContent = [
      cur?.state === "downloading" && cur.downBps ? speed(cur.downBps) : "",
      cur?.state === "downloading" && cur.eta ? `QUEDAN ${up(eta(cur.eta))}` : "",
      queued ? `+${queued} EN COLA` : "",
      cur && ready ? `${ready} LISTO${ready === 1 ? "" : "S"}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function refreshHints() {
    if (tab() === "downloads") dlHints();
    else if (tab() === "shop") shopHints();
  }

  return {
    render() {
      if (view.ficha) closeFicha();
      store.loadGenres();
      if (tab() === "downloads") {
        ui = null;
        paintDownloads();
        ticker("DOWNLOADS · ELIGE UNA FILA Y PULSA LAS TECLAS QUE MUESTRA · LB/RB PARA CAMBIAR DE PESTAÑA");
      } else {
        store.loadHome();
        paintShop();
        ticker("GAME SHOP · ELIGE UN CARTUCHO Y PULSA A");
        shopHints();
      }
    },
    /** Cambio de foco: tarjeta del juego y pistas. */
    onFocus(el) {
      if (tab() === "shop" && el.dataset.slug && !view.ficha) showCard(bySlug.get(el.dataset.slug));
      refreshHints();
    },
    nav(dir) {
      if (tab() !== "shop" || view.ficha || dialog || askOpen) return false;
      const c = focus.current;
      if (c?.dataset.opt && ui?.opts.__change) {
        ejg.sound.play("move");
        ui.opts.__change(c.dataset.opt, dir === "left" ? -1 : 1);
        return true;
      }
      if (!c || !(c.classList.contains("s-item") || c.classList.contains("s-more"))) return false;
      stepSection(dir === "left" ? -1 : 1);
      return true;
    },
    key(a) {
      if (dialog || askOpen) return true;
      if (tab() === "shop") {
        if (a === "y" && !view.ficha) return openSearch(), true;
        if (a === "x") return wishKey();
        return false;
      }
      const id = focus.current?.dataset.dl;
      const r = id && rows.get(Number(id));
      const act = r && r.acts.find((x) => x[0] === a);
      if (!act) return false;
      ejg.sound.play("select");
      act[2]();
      return true;
    },
    /** Letra con el teclado físico en la tienda: empieza a buscar. */
    typeKey(e) {
      if (dialog || askOpen || view.ficha || !ui || !/^[a-df-z0-9]$/i.test(e.key)) return;
      e.preventDefault();
      openSearch(e.key);
    },
    openRepack,
    back() {
      if (askOpen) return askOpen(), true;
      if (closeDialog()) return true;
      if (closeFicha()) return true;
      if (tab() === "shop" && view.sec !== home()) return setSection(home(), { toList: true }), true;
      return false;
    },
    hasDialog: () => !!dialog || !!askOpen,
    /** Al cambiar de pestaña: cierra ficha y diálogos sin mover el foco. */
    leave() {
      if (askOpen) askOpen();
      closeDialog();
      if (!view.ficha) return;
      view.ficha = null;
      view.detail = null;
      ficha.hidden = true;
      delete document.documentElement.dataset.ficha;
      ficha.replaceChildren();
    },
    /** Paleta o pixelado cambiados: volver a pintar las imágenes. */
    redraw() {
      if (tab() === "downloads") paintDownloads(true);
      else if (view.ficha) paintFicha();
      else if (ui && focus.current?.dataset.slug) showCard(bySlug.get(focus.current.dataset.slug));
    },
    status,
  };
}
