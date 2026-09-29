// Tienda y Descargas del tema Steam: portada con destacados y categorías, la
// búsqueda con filtros (el catálogo entero, como la de Steam), página de
// producto con su caja de compra y «Más como este», la lista de deseados,
// diálogo «Instalar» y el gestor de descargas con la gráfica de red. La lógica común está en
// /_sdk/kit/store.js.

import { h, img, keyed, debounce } from "/_sdk/kit/dom.js";
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
} from "/_sdk/kit/store.js";

const I = {
  search: '<svg viewBox="0 0 24 24"><path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  disk: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h.01M11 15h6"/></svg>',
  win: '<svg viewBox="0 0 24 24" class="win-ico"><path d="M3 5.5 10.5 4.5v7H3Zm8.5-1.1L21 3v8.5h-9.5ZM3 12.5h7.5v7L3 18.5Zm8.5 0H21V21l-9.5-1.4Z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z"/></svg>',
  caret: '<svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6.2 5 5 0 0 1 21.2 11c-2.2 4.6-9.2 9-9.2 9Z"/></svg>',
};

/** Categorías de la portada («Explora por categoría»): id del género y su tono. */
const CATEGORIES = [
  [55, 4],
  [47, 262],
  [59, 150],
  [54, 350],
  [66, 205],
  [65, 95],
  [51, 32],
  [56, 18],
  [71, 190],
  [70, 48],
  [214, 290],
  [84, 170],
];
const icon = (n) => h("span", { class: "ico", html: I[n] });

export function createStore({ ejg, main, focus, openGame, goTab, onChange, onNavigate = () => {} }) {
  const store = createExplore(ejg, () => {
    if (active() === "store" && view.name !== "detail") paint(true);
  });
  const view = { name: "front", slug: null, detail: null, detailError: "", scroll: 0 };
  // Catálogo: menú «Ordenar por» abierto y géneros desplegados («Mostrar todos»).
  let sortOpen = false;
  const expanded = new Set();
  let tabRef = () => "library";
  let carousel = { i: 0, timer: 0 };
  let dialog = null;
  // Lista de deseados: orden y filtro de su página.
  let wishSort = "added";
  let wishQuery = "";
  const wished = (slug) => ejg.explore.wishlist.has(slug);
  const active = () => tabRef();

  // ─────────────── piezas ───────────────
  const cover = (r, cls = "") => h("div", { class: "st-art " + cls }, r.cover ? img(r.cover, { loading: "lazy" }) : h("div", { class: "st-ph" }, r.title));
  /** Cápsula horizontal, la «header» de Steam. Si el juego no está en Steam (o aún
   *  no ha llegado su arte), la carátula sobre un fondo hecho con ella misma. */
  const wide = (r, cls = "", big = false) => {
    const art = big ? r.capsuleBig || r.capsule : r.capsule;
    if (art) return h("div", { class: "st-art wide " + cls }, img(art, { loading: "lazy" }));
    if (r.cover) return h("div", { class: "st-art wide cov " + cls, style: { backgroundImage: `url("${r.cover}")` } }, img(r.cover, { loading: "lazy", class: "cov-img" }));
    return h("div", { class: "st-art wide " + cls }, h("div", { class: "st-ph" }, r.title));
  };
  const genres = (r, n = 4) => r.genres.slice(0, n).map(genreLabel).join(", ");

  function badge(r) {
    const s = r.status?.state;
    if (!s || s === "none") return wished(r.slug) ? h("span", { class: "owned wish" }, "EN TU LISTA DE DESEADOS") : null;
    const text = {
      installed: "EN LA BIBLIOTECA",
      library: "EN LA BIBLIOTECA",
      downloading: `DESCARGANDO ${percent(r.status.progress)}`,
      queued: "EN COLA",
      paused: "EN PAUSA",
      seeding: "DESCARGADO",
      completed: "DESCARGADO",
      installing: "INSTALANDO",
      error: "ERROR",
    }[s];
    return text ? h("span", { class: "owned" + (s === "installed" || s === "library" ? "" : " dl") }, text) : null;
  }
  /** Lo que en Steam es el precio: el tamaño de la descarga. */
  const price = (r) => h("span", { class: "price" }, sizeText(r.repackSize) || "—");

  // Capturas de una ficha (para el carrusel y la vista previa), sin pedirlas dos veces.
  const shots = new Map();
  function withShots(r, fn) {
    if (shots.has(r.slug)) return fn(shots.get(r.slug));
    store
      .details(r.slug)
      .then((d) => {
        shots.set(r.slug, d.screenshots || []);
        fn(d.screenshots || []);
      })
      .catch(() => fn([]));
  }

  // ─────────────── barra de la tienda (se crea una vez: el buscador no pierde el foco) ───────────────
  let shell = null;
  let content = null;
  let navInput = null;
  const links = {};
  function ensureShell() {
    if (!shell) {
      navInput = h("input", {
        placeholder: "buscar",
        spellcheck: "false",
        "data-focus": "",
        oninput: debounce((e) => {
          if (view.name !== "catalog") openCatalog({ ...store.state.catalog.filters, query: e.target.value });
          else store.browse({ query: e.target.value }, 350);
        }, 50),
        onkeydown: (e) => {
          if (e.key === "Enter") {
            if (view.name !== "catalog") openCatalog({ ...store.state.catalog.filters, query: e.target.value });
            else store.browse({ query: e.target.value });
          }
          if (e.key === "Escape") {
            e.target.value = "";
            e.target.blur();
            // Sin más filtros, vuelve a la portada; con filtros, solo quita el texto.
            if (!filterCount(store.state.catalog.filters)) goFront();
            else store.browse({ query: "" });
          }
        },
      });
      const link = (id, label, fn) => (links[id] = h("button", { class: "sn-link", "data-focus": "", onclick: fn }, label));
      const nav = h(
        "div",
        { class: "store-nav" },
        h(
          "div",
          { class: "sn-links" },
          link("front", "Tu tienda", () => goFront()),
          link("catalog", "Explorar", () => openCatalog()),
          link("week", "Populares", () => openList("week")),
          link("month", "Top del mes", () => openList("month")),
        ),
        h("label", { class: "sn-search" }, navInput, h("span", { class: "sn-go", html: I.search, onclick: () => openCatalog({ ...store.state.catalog.filters, query: navInput.value }) })),
      );
      // Como en Steam: «Lista de deseados (N)» encima de la barra, a la derecha.
      links.wish = h("button", { class: "sn-wish", "data-focus": "", onclick: () => openWish() }, "Lista de deseados", h("span", { class: "sn-wish-n" }));
      content = h("div", { class: "store-content" });
      shell = h("div", { class: "store" }, h("div", { class: "store-top" }, h("div", { class: "store-over" }, links.wish), nav), content);
    }
    wishCount();
    if (main.firstChild !== shell || main.childNodes.length !== 1) main.replaceChildren(shell);
    const on = view.name === "detail" ? view.prev : view.name === "list" ? view.list : view.name;
    for (const [id, el] of Object.entries(links)) el.classList.toggle("on", id === on);
    if (document.activeElement !== navInput) navInput.value = view.name === "catalog" || view.prev === "catalog" ? store.state.catalog.filters.query || "" : "";
  }

  /** El número de la lista en el botón de la barra. */
  function wishCount() {
    const n = ejg.explore.wishlist.items.length;
    links.wish?.querySelector(".sn-wish-n")?.replaceChildren(n ? ` (${n})` : "");
  }

  function openWish() {
    view.name = "wish";
    paint();
    main.scrollTop = 0;
    focus.first(main.querySelector(".wish-page") || main);
  }

  function goFront() {
    view.name = "front";
    sortOpen = false;
    navInput.value = "";
    paint();
    main.scrollTop = 0;
  }

  /** Listas completas de populares; las novedades son el catálogo. */
  function openList(list) {
    if (list === "latest") return openCatalog({ sort: "date" });
    view.name = "list";
    view.list = list;
    paint();
    main.scrollTop = 0;
  }

  /** El catálogo con filtros. `filters`: empezar con estos (los demás, vacíos). */
  function openCatalog(filters = null) {
    view.name = "catalog";
    sortOpen = false;
    const c = store.state.catalog;
    store.loadGenres();
    if (filters) store.browse({ ...emptyFilters(), ...filters }, filters.query ? 350 : 0);
    else if (!c.page && !c.loading) store.browse({});
    paint();
    main.scrollTop = 0;
  }

  // ─────────────── portada ───────────────
  function heroCarousel(items) {
    const list = items.filter((r) => r.capsuleBig || r.hero).slice(0, 10);
    if (!list.length) return null;
    const i = carousel.i % list.length;
    const r = list[i];
    const mainArt = r.capsuleBig || r.hero;
    const bigImg = img(mainArt, { loading: "eager" });
    const grid = h("div", { class: "car-shots" }, ...[0, 1, 2, 3].map(() => h("div", { class: "car-shot empty" })));
    withShots(r, (list) => {
      grid.replaceChildren(
        ...list.slice(0, 4).map((s) => {
          const el = h("div", { class: "car-shot" }, img(s.thumb, { loading: "eager" }));
          el.addEventListener("mouseenter", () => (bigImg.src = s.full || s.thumb));
          el.addEventListener("mouseleave", () => (bigImg.src = mainArt));
          return el;
        }),
      );
    });
    const card = h(
      "button",
      { class: "car-main", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug) },
      h("div", { class: "car-img" }, bigImg),
      h(
        "div",
        { class: "car-side" },
        h("h3", null, r.title),
        grid,
        h("div", { class: "car-reason" }, h("b", null, "Ya disponible"), h("span", null, "Popular hoy")),
        h("div", { class: "car-tags" }, ...r.genres.slice(0, 4).map((g) => h("span", null, genreLabel(g)))),
        h("div", { class: "car-foot" }, h("span", { class: "plat", html: I.win }), badge(r) || price(r)),
      ),
    );
    const step = (d) => {
      carousel.i = (i + d + list.length) % list.length;
      restartCarousel();
      paint(true);
    };
    return h(
      "section",
      { class: "carousel st-sec", "data-focus-group": "carousel" },
      h("h2", { class: "store-h" }, "Destacados y recomendados"),
      h(
        "div",
        { class: "car-wrap" },
        h("button", { class: "car-arrow", "data-focus": "", onclick: () => step(-1), "aria-label": "Anterior" }, icon("left")),
        card,
        h("button", { class: "car-arrow", "data-focus": "", onclick: () => step(1), "aria-label": "Siguiente" }, icon("right")),
      ),
      h("div", { class: "car-dots" }, ...list.map((_, k) => h("i", { class: k === i ? "on" : "", onclick: () => step(k - i) }))),
    );
  }

  function restartCarousel() {
    clearInterval(carousel.timer);
    carousel.timer = setInterval(() => {
      // Solo si se ve la portada y no se está usando el carrusel ni escribiendo.
      if (active() !== "store" || view.name !== "front" || document.hidden) return;
      if (focus.current?.closest(".carousel") || document.activeElement === navInput || dialog) return;
      carousel.i++;
      paint(true);
    }, 8000);
  }

  /** Fila de cápsulas grandes por páginas, con flechas y puntos (como «Ofertas especiales»). */
  const pages = new Map();
  function bigCap(r) {
    return h(
      "button",
      { class: "bigcap", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug), title: r.title },
      wide(r),
      h("div", { class: "bigcap-info" }, h("b", null, r.title), h("div", { class: "bigcap-foot" }, h("span", { class: "bigcap-tags" }, genres(r, 2)), badge(r) || price(r))),
    );
  }
  function pagedRow(id, title, items, per = 4, render = bigCap, more = () => openList(id), moreLabel = "Ver más") {
    const total = Math.max(1, Math.ceil(items.length / per));
    let p = Math.min(pages.get(id) || 0, total - 1);
    const box = h("div", { class: "pg-items", "data-focus-group": `pg-${id}` });
    const dots = h("div", { class: "car-dots" });
    const show = () => {
      box.replaceChildren(...items.slice(p * per, p * per + per).map(render));
      dots.replaceChildren(...Array.from({ length: total }, (_, k) => h("i", { class: k === p ? "on" : "", onclick: () => go(k - p) })));
    };
    const go = (d) => {
      const inside = box.contains(focus.current);
      p = (p + d + total) % total;
      pages.set(id, p);
      show();
      if (inside) focus.focus(box.querySelector("[data-focus]"), { silent: true, noScroll: true });
      ejg.sound.play("move");
    };
    show();
    return h(
      "section",
      { class: "st-sec" },
      h("div", { class: "store-h-row" }, h("h2", { class: "store-h" }, title), h("button", { class: "btn-more", "data-focus": "", onclick: more }, moreLabel)),
      h(
        "div",
        { class: "car-wrap pg-wrap" },
        h("button", { class: "car-arrow", "data-focus": "", onclick: () => go(-1), "aria-label": "Anterior" }, icon("left")),
        box,
        h("button", { class: "car-arrow", "data-focus": "", onclick: () => go(1), "aria-label": "Siguiente" }, icon("right")),
      ),
      dots,
    );
  }

  /** Lista con pestañas y vista previa a la derecha («Novedades populares», «Más vendidos»…). */
  let tabSel = "month";
  function tabbed(byId) {
    const tabs = [
      ["month", "Populares del mes"],
      ["latest", "Novedades"],
      ["today", "Populares hoy"],
    ].filter(([id]) => byId[id]?.items.length);
    if (!tabs.length) return null;
    if (!byId[tabSel]) tabSel = tabs[0][0];
    const items = byId[tabSel].items.slice(0, 10);
    const preview = h("div", { class: "tab-preview" });
    const showPreview = (r) => {
      if (!r || preview.dataset.slug === r.slug) return;
      preview.dataset.slug = r.slug;
      const box = h("div", { class: "tp-shots" });
      preview.replaceChildren(
        h("h4", null, r.title),
        h("div", { class: "tp-meta" }, r.version ? h("span", null, r.version) : null, h("span", null, `Descarga: ${sizeText(r.repackSize) || "—"}`)),
        h("div", { class: "tp-tags" }, ...r.genres.slice(0, 5).map((g) => h("span", null, genreLabel(g)))),
        box,
      );
      withShots(r, (list) => {
        if (preview.dataset.slug !== r.slug) return;
        const src = list.length ? list.slice(0, 4).map((s) => s.full || s.thumb) : [r.hero].filter(Boolean);
        box.replaceChildren(...src.map((u) => h("div", { class: "tp-shot" }, img(u, { loading: "lazy" }))));
      });
    };
    const rows = h("div", { class: "tab-rows", "data-focus-group": "tab-rows" });
    for (const r of items) {
      const el = h(
        "button",
        { class: "trow", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug), onmouseenter: () => showPreview(r) },
        wide(r, "trow-cap"),
        h("div", { class: "trow-main" }, h("b", null, r.title), h("span", { class: "trow-plat", html: I.win }), h("span", { class: "trow-tags" }, genres(r))),
        h("div", { class: "trow-price" }, badge(r) || price(r)),
      );
      el.addEventListener("ejg-focus", () => showPreview(r));
      rows.append(el);
    }
    showPreview(items[0]);
    return h(
      "section",
      { class: "st-sec tabbed" },
      h(
        "div",
        { class: "tab-heads", "data-focus-group": "tab-heads" },
        ...tabs.map(([id, label]) =>
          h(
            "button",
            {
              class: "tab-head" + (id === tabSel ? " on" : ""),
              "data-focus": "",
              onclick: () => {
                tabSel = id;
                paint(true);
              },
            },
            label,
          ),
        ),
        h("button", { class: "btn-more", "data-focus": "", onclick: () => openList(tabSel) }, "Ver más"),
      ),
      h("div", { class: "tab-body" }, rows, preview),
    );
  }

  /** Arte de cada categoría: un juego popular de ese género (sin repetir juego). */
  function categoryArt() {
    const pool = store.state.home?.sections.flatMap((x) => x.items).filter((r) => r.capsule || r.hero) || [];
    const used = new Set();
    const art = new Map();
    for (const [id] of CATEGORIES) {
      const r = pool.find((x) => x.tags?.includes(id) && !used.has(x.slug));
      if (r) {
        used.add(r.slug);
        art.set(id, r.capsule || r.hero);
      }
    }
    return art;
  }
  let catArt = new Map();

  /** Losa de una categoría: el arte de un juego popular de ese género tintado con su color. */
  function categoryTile([id, hue]) {
    const g = store.state.genres.find((x) => x.id === id);
    const pick = catArt.get(id);
    return h(
      "button",
      { class: "cat-tile", "data-focus": "", "data-key": `cat-${id}`, style: `--h: ${hue}`, onclick: () => openCatalog({ genres: [id] }) },
      pick ? img(pick, { loading: "lazy" }) : null,
      h("span", { class: "cat-tile-name" }, g ? g.name : ""),
    );
  }

  function front() {
    const s = store.state;
    if (s.homeError) {
      return h(
        "div",
        { class: "store-empty" },
        h("h2", null, "No se pudo abrir la tienda"),
        h("p", null, s.homeError),
        h("button", { class: "btn-blue", "data-focus": "", onclick: () => store.loadHome(true) }, "Reintentar"),
      );
    }
    if (!s.home) return h("div", { class: "store-empty" }, h("div", { class: "spinner" }), h("p", null, "Cargando la tienda…"));
    const byId = Object.fromEntries(s.home.sections.map((x) => [x.id, x]));
    const out = [];
    const today = byId.today || byId.week;
    if (today) out.push(heroCarousel(today.items));
    if (byId.week) out.push(pagedRow("week", "Populares de la semana", byId.week.items));
    catArt = categoryArt();
    if (s.genres.length) out.push(pagedRow("cats", "Explora por categoría", CATEGORIES, 4, categoryTile, () => openCatalog({}), "Todo el catálogo"));
    out.push(tabbed(byId));
    return h("div", { class: "store-front" }, ...out.filter(Boolean));
  }

  // ─────────────── resultados y listas completas ───────────────
  function resultRow(r) {
    return h(
      "button",
      { class: "srow", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug) },
      wide(r, "srow-cap"),
      h("div", { class: "srow-main" }, h("b", null, r.title), h("span", { class: "trow-plat", html: I.win })),
      h("span", { class: "srow-date" }, date(r.date)),
      h("span", { class: "srow-size" }, badge(r) || price(r)),
    );
  }

  function results() {
    const sec = store.state.home?.sections.find((x) => x.id === view.list);
    const items = sec?.items ?? [];
    const list = h("div", { class: "srows", "data-focus-group": "results" });
    keyed(list, items, (r) => r.slug, (r) => resultRow(r));
    return h(
      "div",
      { class: "store-results" },
      h("div", { class: "store-h-row" }, h("h2", { class: "store-h" }, sec ? sec.title : "Populares"), items.length ? h("span", { class: "muted" }, `${items.length} juegos`) : null),
      h("div", { class: "srow-head" }, h("span", null, "Nombre"), h("span", null, "Publicado"), h("span", null, "Descarga")),
      list,
    );
  }

  // ─────────────── catálogo: la búsqueda de Steam con sus filtros ───────────────
  const genreName = (id) => store.state.genres.find((g) => g.id === id)?.name || "";

  function toggleGenre(id) {
    if (!store.toggleGenre(id)) ejg.ui.toast(`Como mucho ${MAX_GENRES} géneros a la vez`, "info");
  }

  /** Casilla de la barra lateral (la misma que en el diálogo «Instalar»). */
  const check = (key, label, on, fn, extra = null) =>
    h("button", { class: "chk" + (on ? " on" : ""), "data-focus": "", "data-key": key, onclick: fn }, h("i"), h("span", null, label), extra);

  function sortMenu(f) {
    const cur = SORTS.find((o) => o.id === f.sort) || SORTS[0];
    return h(
      "div",
      { class: "cat-sort" },
      h("span", null, "Ordenar por"),
      h(
        "button",
        {
          class: "cat-sort-btn" + (sortOpen ? " open" : ""),
          "data-focus": "",
          "data-key": "sort",
          onclick: () => {
            sortOpen = !sortOpen;
            paint(true);
            if (sortOpen) focus.focus(main.querySelector(`[data-key="sort-${cur.id}"]`), { silent: true, noScroll: true });
          },
        },
        h("span", null, cur.label),
        icon("caret"),
      ),
      sortOpen
        ? h(
            "div",
            { class: "cat-sort-menu", "data-focus-trap": "" },
            ...SORTS.map((o) =>
              h(
                "button",
                {
                  class: "cat-sort-opt" + (o.id === cur.id ? " on" : ""),
                  "data-focus": "",
                  "data-key": `sort-${o.id}`,
                  onclick: () => {
                    sortOpen = false;
                    store.browse({ sort: o.id });
                    focus.focus(main.querySelector('[data-key="sort"]'), { silent: true, noScroll: true });
                  },
                },
                o.label,
              ),
            ),
          )
        : null,
    );
  }

  function filterSide(f) {
    const genres = store.state.genres;
    const box = (title, ...children) => h("div", { class: "cat-box" }, h("h4", null, title), h("div", { class: "cat-box-body" }, ...children));
    const groups = GENRE_GROUPS.map(({ id, label }) => {
      const all = genres.filter((g) => g.group === id);
      if (!all.length) return null;
      // Los diez primeros y los que estén marcados; el resto, al desplegar.
      const open = expanded.has(id) || all.length <= 12;
      const list = open ? all : all.filter((g, i) => i < 10 || f.genres.includes(g.id));
      return box(
        id === "genre" ? "Filtrar por género" : label,
        ...list.map((g) => check(`g-${g.id}`, g.name, f.genres.includes(g.id), () => toggleGenre(g.id))),
        !open
          ? h(
              "button",
              {
                class: "cat-more",
                "data-focus": "",
                "data-key": `more-${id}`,
                onclick: () => {
                  expanded.add(id);
                  paint(true);
                },
              },
              `Mostrar todos (${all.length})`,
            )
          : null,
      );
    });
    return h(
      "aside",
      { class: "cat-side", "data-focus-group": "cat-side" },
      box(
        "Filtrar por tamaño de descarga",
        ...SIZES.map((o) => check(`size-${o.gb ?? 0}`, o.label, (f.maxGb || null) === o.gb, () => store.browse({ maxGb: o.gb }))),
      ),
      box("Filtrar", check("owned", "Ocultar los que ya tengo", f.hideOwned, () => store.browse({ hideOwned: !f.hideOwned }))),
      ...groups,
    );
  }

  function catalogPage() {
    const c = store.state.catalog;
    const f = c.filters;
    const chips = [
      f.query ? ["q", `«${f.query}»`, () => (navInput.value = "", store.browse({ query: "" }))] : null,
      ...f.genres.map((id) => [`chip-${id}`, genreName(id), () => toggleGenre(id)]),
      f.maxGb ? ["chip-size", SIZES.find((o) => o.gb === f.maxGb)?.label || `Hasta ${f.maxGb} GB`, () => store.browse({ maxGb: null })] : null,
      f.hideOwned ? ["chip-owned", "Sin los que ya tengo", () => store.browse({ hideOwned: false })] : null,
    ].filter(Boolean);
    const count = c.loading && !c.items.length ? "Buscando…" : `${c.filtered && c.page < c.pages ? "Unos " : ""}${c.total.toLocaleString("es")} resultados coinciden con tus filtros`;
    const list = h("div", { class: "srows", "data-focus-group": "results" });
    keyed(list, c.items, (r) => r.slug, (r) => resultRow(r));
    const more = c.page > 0 && c.page < c.pages;
    return h(
      "div",
      { class: "store-results cat-page" },
      h(
        "div",
        { class: "cat-main" },
        h("div", { class: "cat-bar" }, h("span", { class: "cat-count" }, count), sortMenu(f)),
        chips.length
          ? h(
              "div",
              { class: "cat-chips", "data-focus-group": "chips" },
              ...chips.map(([key, label, fn]) => h("button", { class: "cat-chip", "data-focus": "", "data-key": key, onclick: fn }, h("span", null, label), icon("x"))),
              h("button", { class: "cat-clear", "data-focus": "", "data-key": "clear", onclick: () => ((navInput.value = ""), store.clearFilters()) }, "Quitar filtros"),
            )
          : null,
        h("div", { class: "srow-head" }, h("span", null, "Nombre"), h("span", null, "Publicado"), h("span", null, "Descarga")),
        c.error ? h("p", { class: "err" }, c.error, " ", h("button", { class: "btn-steam-sm", "data-focus": "", onclick: () => store.browse({}) }, "Reintentar")) : null,
        !c.items.length && !c.loading && !c.error
          ? h(
              "div",
              { class: "cat-empty" },
              h("p", null, "No hay juegos que coincidan con tus filtros."),
              chips.length ? h("button", { class: "btn-blue", "data-focus": "", onclick: () => ((navInput.value = ""), store.clearFilters()) }, "Quitar filtros") : null,
            )
          : null,
        list,
        c.loading ? h("div", { class: "spinner" }) : null,
        more && !c.loading ? h("button", { class: "btn-blue more-btn", "data-focus": "", "data-key": "more", onclick: () => store.browseMore() }, "Ver más resultados") : null,
      ),
      filterSide(f),
    );
  }

  // Más resultados al llegar al final (con ratón o rueda).
  main.addEventListener(
    "scroll",
    () => {
      if (active() !== "store" || view.name !== "catalog") return;
      if (main.scrollTop + main.clientHeight > main.scrollHeight - 600) store.browseMore();
    },
    { passive: true },
  );

  // ─────────────── página de producto ───────────────
  async function openRepack(slug) {
    view.scroll = main.scrollTop;
    view.prev = view.name === "detail" ? view.prev : view.name;
    view.name = "detail";
    view.slug = slug;
    view.detail = null;
    view.detailError = "";
    paint();
    main.scrollTop = 0;
    try {
      view.detail = await store.details(slug);
    } catch (e) {
      view.detailError = e.message || String(e);
    }
    if (view.slug === slug && view.name === "detail") {
      paint();
      const b = main.querySelector(".buy-btn");
      if (b) focus.focus(b, { instant: true, silent: true });
    }
  }

  /** Lo que hace el botón principal de una ficha (descargar, instalar, jugar…). */
  function runAction(r) {
    const act = repackAction(r);
    if (act.id === "download") return openDialog(r);
    if (act.id === "install" && r.status.downloadId) return ejg.downloads.install(r.status.downloadId).catch((e) => ejg.ui.toast(e.message, "error"));
    if (act.id === "play" && r.status.gameId) return ejg.game.launch(r.status.gameId).catch((e) => ejg.ui.toast(e.message, "error"));
    goTab("downloads");
  }

  /** «Añadir a tu lista de deseados» / «En tu lista de deseados», como el de Steam. */
  function wishButton(r) {
    const on = wished(r.slug);
    return h(
      "button",
      { class: "btn-wish" + (on ? " on" : ""), "data-focus": "", "data-key": "wish", onclick: () => toggleWish(ejg, r) },
      on ? h("span", { class: "ico", html: I.check }) : null,
      on ? "En tu lista de deseados" : "Añadir a tu lista de deseados",
    );
  }

  // ─────────────── lista de deseados ───────────────
  const addedDate = (t) => new Date(t * 1000).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
  function wishRow(r) {
    const act = repackAction(r);
    return h(
      "div",
      { class: "wrow", "data-slug": r.slug },
      h("button", { class: "wrow-cap", "data-focus": "", onclick: () => openRepack(r.slug), title: r.title }, wide(r)),
      h(
        "div",
        { class: "wrow-main" },
        h("button", { class: "wrow-title", "data-focus": "", onclick: () => openRepack(r.slug) }, r.title),
        h("div", { class: "wrow-meta" }, h("span", { class: "trow-plat", html: I.win }), h("span", null, `Publicado: ${date(r.date)}`)),
        r.genres.length ? h("div", { class: "wrow-tags" }, ...r.genres.slice(0, 5).map((g) => h("span", null, genreLabel(g)))) : null,
      ),
      h(
        "div",
        { class: "wrow-side" },
        h(
          "div",
          { class: "wrow-buy" },
          // En la lista no hace falta decir que está en la lista: su estado o su tamaño.
          h("span", { class: "wrow-price" }, (r.status?.state && r.status.state !== "none" ? badge(r) : null) || sizeText(r.repackSize) || "—"),
          h("button", { class: "buy-btn" + (act.id === "downloads" ? " blue" : ""), "data-focus": "", onclick: () => runAction(r) }, act.label),
        ),
        h(
          "div",
          { class: "wrow-added" },
          `Añadido el ${addedDate(r.addedAt)} `,
          h("button", { class: "wrow-rm", "data-focus": "", onclick: () => toggleWish(ejg, r) }, "(quitar)"),
        ),
      ),
    );
  }

  function wishPage() {
    const all = ejg.explore.wishlist.items;
    const q = wishQuery.trim().toLowerCase();
    const items = sortWishlist(all, wishSort).filter((r) => !q || r.title.toLowerCase().includes(q) || r.genres.some((g) => genreLabel(g).toLowerCase().includes(q)));
    const name = ejg.profile?.name || "";
    const search = h("input", {
      class: "wish-search",
      placeholder: "Buscar por nombre o etiqueta",
      spellcheck: "false",
      "data-focus": "",
      "data-key": "wish-q",
      value: wishQuery,
      oninput: debounce((e) => {
        wishQuery = e.target.value;
        paint(true);
      }, 120),
    });
    const list = h("div", { class: "wrows", "data-focus-group": "wish" });
    keyed(list, items, (r) => r.slug, (r) => wishRow(r));
    return h(
      "div",
      { class: "wish-page" },
      h("div", { class: "wish-head" }, h("h2", null, name ? `Lista de deseados de ${name}` : "Tu lista de deseados"), h("span", { class: "muted" }, "Se guarda en este PC, solo para este perfil.")),
      all.length
        ? h(
            "div",
            { class: "wish-tools" },
            search,
            h(
              "div",
              { class: "wish-sorts" },
              h("span", { class: "muted" }, "Ordenar por:"),
              ...WISH_SORTS.map((o) =>
                h(
                  "button",
                  {
                    class: "wish-sort" + (wishSort === o.id ? " on" : ""),
                    "data-focus": "",
                    "data-key": `wsort-${o.id}`,
                    onclick: () => {
                      wishSort = o.id;
                      paint(true);
                    },
                  },
                  o.label,
                ),
              ),
            ),
          )
        : null,
      all.length
        ? items.length
          ? list
          : h("div", { class: "store-empty small" }, h("p", null, "Ningún juego de tu lista coincide con la búsqueda."))
        : h(
            "div",
            { class: "store-empty" },
            h("span", { class: "wish-empty-ico", html: I.heart }),
            h("h2", null, "Tu lista de deseados está vacía"),
            h("p", null, "Añade juegos con «Añadir a tu lista de deseados» en su página. La lista se guarda en este PC, solo para este perfil."),
            h("button", { class: "btn-steam-sm", "data-focus": "", onclick: () => openCatalog({}) }, "Explorar la tienda"),
          ),
    );
  }

  function detailPage() {
    if (view.detailError) return h("div", { class: "store-empty" }, h("h2", null, "No se pudo abrir la ficha"), h("p", null, view.detailError));
    const d = view.detail;
    if (!d) return h("div", { class: "store-empty" }, h("div", { class: "spinner" }));
    let shot = 0;
    const big = h("div", { class: "pv-big" }, d.screenshots[0] ? img(d.screenshots[0].full, { loading: "eager" }) : d.hero ? img(d.hero) : null);
    const strip = h(
      "div",
      { class: "pv-strip", "data-focus-group": "shots" },
      ...d.screenshots.map((s, k) =>
        h(
          "button",
          {
            class: "pv-thumb" + (k === 0 ? " on" : ""),
            "data-focus": "",
            onclick: () => {
              shot = k;
              big.replaceChildren(img(s.full, { loading: "eager" }));
              strip.querySelectorAll(".pv-thumb").forEach((t, j) => t.classList.toggle("on", j === shot));
            },
          },
          img(s.thumb, { loading: "lazy" }),
        ),
      ),
    );
    const act = repackAction(d);
    const short = (d.description || "").replace(/\s+/g, " ").trim();
    const doAction = () => runAction(d);
    const glance = [
      ["Publicado", date(d.date)],
      ["Compañías", d.companies],
      ["Repack", d.number ? `#${d.number}` : null],
    ].filter((r) => r[1]);
    const langs = (d.languages || "")
      .split(/[,/]/)
      .map((x) => x.trim())
      .filter(Boolean);
    // Géneros conocidos: botones que abren el catálogo filtrado por ellos.
    const known = (d.tags || []).map((t) => store.state.genres.find((g) => g.id === t)).filter(Boolean);
    const tags = known.length
      ? known.slice(0, 8).map((g) => h("button", { class: "app-tag", "data-focus": "", onclick: () => openCatalog({ genres: [g.id] }) }, g.name))
      : d.genres.slice(0, 8).map((g) => h("span", null, genreLabel(g)));
    const main1 = known.find((g) => g.group === "genre");
    const similar = h("div", { class: "pg-items similar" });
    store.similar(d, 8).then((list) => {
      if (view.slug !== d.slug) return;
      if (!list.length) return similar.parentElement?.remove();
      similar.replaceChildren(...list.map(bigCap));
    });
    return h(
      "div",
      { class: "app-page" },
      h("div", { class: "app-bg", style: d.hero ? { backgroundImage: `url("${d.hero}")` } : {} }),
      h(
        "div",
        { class: "app-inner" },
        h(
          "div",
          { class: "crumbs" },
          h("button", { class: "crumb", "data-focus": "", onclick: () => openCatalog({}) }, "Todos los juegos"),
          h("span", null, " > "),
          main1
            ? h("button", { class: "crumb", "data-focus": "", onclick: () => openCatalog({ genres: [main1.id] }) }, main1.name)
            : h("span", null, d.genres[0] ? genreLabel(d.genres[0]) : "Juegos"),
          h("span", null, " > "),
          h("span", null, d.title),
        ),
        h(
          "div",
          { class: "app-head" },
          h("h1", { class: "app-title" }, d.title),
          h("div", { class: "app-head-acts" }, wishButton(d), d.url ? h("button", { class: "btn-steam-sm", "data-focus": "", onclick: () => ejg.explore.openPage(d.slug) }, "Ver la ficha en FitGirl") : null),
        ),
        h(
          "div",
          { class: "app-top" },
          h("div", { class: "pv" }, big, strip),
          h(
            "div",
            { class: "app-side" },
            wide(d, "app-cap"),
            short ? h("p", { class: "app-short" }, short.length > 260 ? short.slice(0, 257).trimEnd() + "…" : short) : null,
            ...glance.map(([k, v]) => h("div", { class: "app-row" }, h("span", null, k + ":"), h("span", null, v))),
            h("div", { class: "app-tags-h" }, "Etiquetas populares de este producto:"),
            h("div", { class: "app-tags" }, ...tags),
          ),
        ),
        h(
          "div",
          { class: "app-body" },
          h(
            "div",
            null,
            h(
              "div",
              { class: "buy" },
              h("span", { class: "buy-plat", html: I.win }),
              h("h2", null, act.id === "play" ? `Jugar a ${d.title}` : `Descargar ${d.title}`),
              h("div", { class: "buy-meta" }, [d.version && `Versión ${d.version}`, d.selective ? "Descarga selectiva" : null].filter(Boolean).join(" · ")),
              h(
                "div",
                { class: "buy-box" },
                h("span", { class: "buy-price" }, act.hint || sizeText(d.repackSize) || ""),
                h("button", { class: "buy-btn" + (act.id === "downloads" ? " blue" : ""), "data-focus": "", onclick: doAction }, act.label),
              ),
            ),
            d.description ? h("div", { class: "app-sec" }, h("h3", null, "Acerca de este juego"), h("div", { class: "app-desc" }, d.description)) : null,
            d.features.length ? h("div", { class: "app-sec" }, h("h3", null, "Características del repack"), h("ul", { class: "feat" }, ...d.features.map((f) => h("li", null, f)))) : null,
          ),
          h(
            "div",
            { class: "app-right" },
            h(
              "div",
              { class: "side-box cats" },
              h("div", { class: "cat" }, icon("win"), h("span", null, "Windows")),
              d.selective ? h("div", { class: "cat" }, icon("check"), h("span", null, "Descarga selectiva")) : null,
              h("div", { class: "cat" }, icon("down"), h("span", null, "Torrent integrado")),
            ),
            h(
              "div",
              { class: "side-box" },
              h("h4", null, "Tamaño"),
              h("div", { class: "app-row" }, h("span", null, "Original:"), h("span", null, sizeText(d.originalSize) || "—")),
              h("div", { class: "app-row" }, h("span", null, "Descarga:"), h("span", null, sizeText(d.repackSize) || "—")),
              h("div", { class: "app-row" }, h("span", null, "En disco:"), h("span", null, sizeText(d.installSize) || "—")),
            ),
            langs.length
              ? h("div", { class: "side-box" }, h("h4", null, "Idiomas"), h("div", { class: "langs" }, ...langs.slice(0, 16).map((l) => h("div", { class: "lang" }, icon("globe"), h("span", null, l)))))
              : null,
          ),
        ),
        h("div", { class: "app-sec similar-sec" }, h("h3", null, "Más como este"), similar),
      ),
    );
  }

  // ─────────────── diálogo «Instalar» ───────────────
  async function openDialog(d) {
    closeDialog();
    const box = h("div", { class: "dlg" }, h("div", { class: "dlg-head" }, `Instalar - ${d.title}`), h("div", { class: "dlg-body" }, h("div", { class: "spinner" }), h("p", { class: "muted center" }, "Buscando el torrent y su lista de archivos…")));
    const layer = h("div", { class: "dlg-layer", "data-focus-trap": "" }, box);
    document.body.append(layer);
    dialog = { layer, slug: d.slug, prep: null };
    ejg.sound.play("open");
    const cancel = h("button", { class: "btn-gray", "data-focus": "", onclick: closeDialog }, "Cancelar");
    box.append(h("div", { class: "dlg-foot" }, cancel));
    focus.focus(cancel, { instant: true, silent: true });
    let prep;
    try {
      prep = await ejg.downloads.prepare(d.slug);
    } catch (e) {
      if (dialog?.slug !== d.slug) return;
      box.querySelector(".dlg-body").replaceChildren(h("p", { class: "err center" }, e.message || String(e)));
      return;
    }
    if (dialog?.slug !== d.slug) return;
    dialog.prep = prep;
    const sel = fileSelection(prep);
    let dir = prep.dir ? { path: prep.dir, freeBytes: prep.freeBytes } : null;
    const body = box.querySelector(".dlg-body");
    const foot = box.querySelector(".dlg-foot");
    const need = h("b");
    const avail = h("b");
    const pathEl = h("span", { class: "dlg-path" });
    const err = h("p", { class: "err" });
    const next = h("button", { class: "btn-blue", "data-focus": "" }, "Siguiente");
    const upd = () => {
      need.textContent = bytes(sel.bytes);
      avail.textContent = dir?.freeBytes != null ? bytes(dir.freeBytes) : "—";
      pathEl.textContent = dir?.path || "Elige una carpeta";
      const problem = !dir ? "Elige dónde guardar la descarga" : sel.error || (!sel.fits(dir.freeBytes) ? "No hay espacio suficiente en ese disco" : "");
      err.textContent = problem;
      next.disabled = !!problem;
    };
    const check = (f) =>
      h(
        "button",
        {
          class: "chk" + (sel.isSelected(f.index) ? " on" : ""),
          "data-focus": "",
          onclick: (e) => {
            sel.toggle(f.index);
            e.currentTarget.classList.toggle("on", sel.isSelected(f.index));
            upd();
          },
        },
        h("i"),
        h("span", null, f.label),
        h("small", null, bytes(f.size)),
      );
    const groups = [
      ["Idiomas", sel.languages],
      ["Contenido opcional", sel.optional],
    ].filter(([, l]) => l.length);
    body.replaceChildren(
      h("div", { class: "dlg-space" }, h("div", null, h("span", null, "Espacio necesario"), need), h("div", null, h("span", null, "Espacio disponible"), avail)),
      h(
        "div",
        { class: "dlg-loc" },
        h("span", { class: "ico", html: I.disk }),
        pathEl,
        h(
          "button",
          {
            class: "btn-gray",
            "data-focus": "",
            onclick: async () => {
              const p = await ejg.downloads.pickFolder(dir?.path);
              if (p) {
                dir = p;
                upd();
              }
            },
          },
          "Cambiar…",
        ),
      ),
      ...groups.map(([title, list]) => h("div", { class: "dlg-group" }, h("h4", null, title), h("div", { class: "chks", "data-focus-group": "chk-" + title }, ...list.map(check)))),
      ...[
        groups.length ? h("p", { class: "muted small" }, "En el instalador, desmarca lo que no hayas descargado.") : null,
        prep.installSize ? h("p", { class: "muted small" }, `El juego instalado ocupará ${sizeText(prep.installSize)}${prep.installFreeBytes != null ? ` (quedan ${bytes(prep.installFreeBytes)} en ${prep.installDir})` : ""}.`) : null,
      ].filter(Boolean),
      err,
    );
    next.onclick = async () => {
      next.disabled = true;
      next.textContent = "Añadiendo…";
      try {
        await ejg.downloads.start(prep.token, sel.indices(), dir.path);
        closeDialog(true);
        ejg.ui.toast(`«${d.title}» añadido a Descargas`, "ok");
        store.refresh();
        if (view.slug === d.slug) openRepack(d.slug);
      } catch (e) {
        err.textContent = e.message || String(e);
        next.disabled = false;
        next.textContent = "Siguiente";
      }
    };
    foot.replaceChildren(next, cancel);
    upd();
    focus.focus(next.disabled ? body.querySelector("[data-focus]") : next, { instant: true, silent: true });
  }

  /** Pregunta con dos respuestas y Cancelar: true, false o null. */
  function ask(title, text, yes, no) {
    return new Promise((resolve) => {
      const prev = focus.current;
      const done = (v) => {
        layer.remove();
        askOpen = null;
        if (prev?.isConnected) focus.focus(prev, { silent: true });
        else focus.first(main);
        resolve(v);
      };
      const bYes = h("button", { class: "btn-blue", "data-focus": "", onclick: () => done(true) }, yes);
      const layer = h(
        "div",
        { class: "dlg-layer", "data-focus-trap": "" },
        h(
          "div",
          { class: "dlg small" },
          h("div", { class: "dlg-head" }, title),
          h("div", { class: "dlg-body" }, h("p", null, text)),
          h("div", { class: "dlg-foot" }, bYes, h("button", { class: "btn-gray", "data-focus": "", onclick: () => done(false) }, no), h("button", { class: "btn-gray", "data-focus": "", onclick: () => done(null) }, "Cancelar")),
        ),
      );
      document.body.append(layer);
      askOpen = () => done(null);
      focus.focus(bYes, { instant: true, silent: true });
    });
  }
  let askOpen = null;

  function closeDialog(done) {
    if (!dialog) return false;
    if (!dialog.prep && !done) ejg.downloads.cancelPrepare(dialog.slug).catch(() => {});
    dialog.layer.remove();
    dialog = null;
    focus.restore?.() || focus.first(main);
    return true;
  }

  // ─────────────── gestor de descargas ───────────────
  const graph = { samples: [], peak: 0, canvas: null };
  function sample() {
    const all = ejg.downloads.all;
    const down = all.filter((d) => d.state === "downloading").reduce((a, d) => a + d.downBps, 0);
    graph.samples.push(down);
    if (graph.samples.length > 120) graph.samples.shift();
    graph.peak = Math.max(graph.peak, down);
    drawGraph();
  }
  function drawGraph() {
    const c = graph.canvas;
    if (!c || !c.isConnected) return;
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const hgt = (c.height = c.clientHeight * devicePixelRatio);
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, w, hgt);
    const max = Math.max(graph.peak, 1024 * 1024);
    const n = 120;
    const xOf = (k) => ((k + n - graph.samples.length) / (n - 1)) * w;
    if (!graph.samples.length) return;
    ctx.beginPath();
    ctx.moveTo(xOf(0), hgt);
    graph.samples.forEach((v, k) => ctx.lineTo(xOf(k), hgt - (v / max) * hgt * 0.92));
    ctx.lineTo(xOf(graph.samples.length - 1), hgt);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, hgt);
    grad.addColorStop(0, "rgba(26,159,255,0.55)");
    grad.addColorStop(1, "rgba(26,159,255,0.04)");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "#1a9fff";
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.beginPath();
    graph.samples.forEach((v, k) => {
      const x = xOf(k);
      const y = hgt - (v / max) * hgt * 0.92;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  const rows = new Map();
  function dlRow(d) {
    const title = h("b");
    const sub = h("span", { class: "dl-sub" });
    const bar = h("i");
    const pct = h("span", { class: "dl-pct" });
    const btns = h("div", { class: "dl-btns" });
    const el = h(
      "div",
      { class: "dl-row", "data-dl": d.id },
      wide(d, "dl-cap"),
      h("div", { class: "dl-main" }, title, sub, h("div", { class: "dl-bar" }, bar), pct),
      btns,
    );
    let sig = "";
    const update = (d) => {
      title.textContent = d.title;
      sub.textContent = [downloadLabel(d), d.state === "downloading" && d.eta ? `quedan ${eta(d.eta)}` : "", d.state === "downloading" && d.peers ? `${d.peers} fuentes` : ""]
        .filter(Boolean)
        .join(" · ");
      bar.style.width = `${Math.round(d.progress * 1000) / 10}%`;
      el.classList.toggle("paused", d.state !== "downloading" && d.state !== "installing");
      pct.textContent = d.state === "installed" ? (d.filesDeleted ? "Repack borrado" : "") : `${bytes(d.doneBytes)} / ${bytes(d.totalBytes)}`;
      // Botones solo si cambian (para no perder el foco).
      const s = `${d.state}|${d.pauseReason}|${d.filesDeleted}|${d.gameId}`;
      if (s === sig) return;
      sig = s;
      const b = (ico, label, fn, cls = "") => h("button", { class: "dl-btn " + cls, "data-focus": "", title: label, onclick: fn }, icon(ico));
      const run = (p) => p.catch((e) => ejg.ui.toast(e.message || String(e), "error"));
      const list = [];
      if (canInstall(d)) list.push(h("button", { class: "btn-green", "data-focus": "", onclick: () => run(ejg.downloads.install(d.id)) }, "INSTALAR"));
      if (d.pauseReason === "needs-folder") list.push(h("button", { class: "btn-blue", "data-focus": "", onclick: () => run(ejg.downloads.locate(d.id)) }, "ELEGIR CARPETA"));
      if (d.state === "installed" && d.gameId) list.push(h("button", { class: "btn-green", "data-focus": "", onclick: () => openGame(d.gameId) }, "JUGAR"));
      if (isActive(d)) list.push(b("pause", "Pausar", () => run(ejg.downloads.pause(d.id))));
      if (d.state === "paused" || d.state === "error") list.push(b("play", d.state === "error" ? "Reintentar" : "Reanudar", () => run(ejg.downloads.resume(d.id))));
      if (d.state === "queued") list.push(b("up", "Descargar primero", () => run(ejg.downloads.move(d.id, 0))));
      if (!(d.state === "installed" && d.filesDeleted)) list.push(b("folder", "Abrir carpeta", () => run(ejg.downloads.openFolder(d.id))));
      if (d.state !== "installing")
        list.push(
          b("x", "Quitar", async () => {
            if (d.filesDeleted) return run(ejg.downloads.remove(d.id, false));
            const keepGame = d.state === "installed";
            const files = await ask(
              "Quitar de Descargas",
              keepGame ? `¿Borrar también el repack de «${d.title}»? El juego instalado no se toca.` : `¿Borrar también lo descargado de «${d.title}» (${bytes(d.doneBytes)})?`,
              "Borrar archivos",
              "Conservarlos",
            );
            if (files != null) run(ejg.downloads.remove(d.id, files));
          }),
        );
      const had = btns.contains(focus.current);
      btns.replaceChildren(...list);
      if (had) focus.focus(btns.querySelector("[data-focus]") || el, { silent: true, noScroll: true });
    };
    update(d);
    return { el, update };
  }

  function downloadsPage() {
    const all = ejg.downloads.all;
    const current = all.find((d) => d.state === "downloading") || all.find((d) => d.state === "installing");
    const up = all.filter((d) => d !== current && ["queued", "paused", "downloading", "error"].includes(d.state));
    const done = all.filter((d) => ["seeding", "completed", "installing"].includes(d.state) && d !== current);
    const installed = all.filter((d) => d.state === "installed");
    graph.canvas = h("canvas", { class: "net" });
    const total = all.filter((d) => d.state === "downloading").reduce((a, d) => a + d.downBps, 0);
    const head = h(
      "div",
      { class: "dl-head" },
      current
        ? h(
            "div",
            { class: "dl-now" },
            h("div", { class: "dl-now-img", style: current.capsule || current.cover ? { backgroundImage: `url("${current.capsule || current.cover}")` } : {} }),
            h("div", { class: "dl-now-cap" }, wide(current)),
            h(
              "div",
              { class: "dl-now-info" },
              h("small", null, current.state === "installing" ? "INSTALANDO" : "DESCARGANDO"),
              h("b", null, current.title),
              h("span", { id: "dl-now-sub" }, downloadLabel(current)),
            ),
          )
        : h("div", { class: "dl-now idle" }, h("div", { class: "dl-now-info" }, h("small", null, "DESCARGAS"), h("b", null, all.length ? "Nada descargándose ahora" : "No hay descargas"))),
      h(
        "div",
        { class: "dl-graph" },
        graph.canvas,
        h(
          "div",
          { class: "dl-rates" },
          h("div", null, h("small", null, "ACTUAL"), h("b", { id: "rate-now" }, speed(total))),
          h("div", null, h("small", null, "MÁXIMA"), h("b", { id: "rate-peak" }, speed(graph.peak))),
          h(
            "div",
            { class: "dl-all" },
            all.some(isActive) ? h("button", { class: "btn-gray", "data-focus": "", onclick: () => ejg.downloads.pause() }, "Pausar todo") : null,
            all.some((d) => d.state === "paused") ? h("button", { class: "btn-gray", "data-focus": "", onclick: () => ejg.downloads.resume() }, "Reanudar todo") : null,
          ),
        ),
      ),
    );
    rows.clear();
    const section = (label, list, group) => {
      if (!list.length) return null;
      const box = h("div", { class: "dl-list", "data-focus-group": group });
      for (const d of list) {
        const r = dlRow(d);
        rows.set(d.id, r);
        box.append(r.el);
      }
      return h("section", null, h("div", { class: "dl-h" }, h("span", null, label), h("span", null, `${list.length} ${list.length === 1 ? "elemento" : "elementos"}`)), box);
    };
    const body = h(
      "div",
      { class: "dl-body" },
      current ? section("En curso", [current], "dl-now") : null,
      section("En cola", up, "dl-up"),
      section("Listos para instalar", done, "dl-done"),
      section("Instalados", installed, "dl-installed"),
      !all.length
        ? h(
            "div",
            { class: "store-empty" },
            h("p", null, "Busca un juego en la tienda y pulsa Descargar."),
            ejg.explore.enabled ? h("button", { class: "btn-blue", "data-focus": "", onclick: () => goTab("store") }, "Ir a la tienda") : null,
          )
        : null,
    );
    requestAnimationFrame(drawGraph);
    return h("div", { class: "dl-page" }, head, body);
  }

  let dlSig = "";
  const listSig = () =>
    ejg.downloads.all.map((d) => `${d.id}:${d.state}:${d.state === "downloading" ? "" : d.pauseReason}`).join(",");

  function onDownloads() {
    sample();
    if (active() === "downloads") {
      // Si solo cambió el progreso, se actualiza en su sitio (sin perder el foco).
      const s = listSig();
      if (s !== dlSig) return paint(true);
      for (const d of ejg.downloads.all) rows.get(d.id)?.update(d);
      const total = ejg.downloads.all.filter((d) => d.state === "downloading").reduce((a, d) => a + d.downBps, 0);
      const n = document.getElementById("rate-now");
      if (n) n.textContent = speed(total);
      const p = document.getElementById("rate-peak");
      if (p) p.textContent = speed(graph.peak);
      const cur = ejg.downloads.all.find((d) => d.state === "downloading");
      const sub = document.getElementById("dl-now-sub");
      if (sub && cur) sub.textContent = downloadLabel(cur);
    } else if (active() === "store" && view.name === "detail" && view.detail) {
      // Estado del botón de la ficha abierta.
      const mine = ejg.downloads.all.find((d) => d.slug === view.detail.slug);
      const st = mine ? mine.state : null;
      if (st && st !== view.detail.status.state) {
        view.detail = { ...view.detail, status: { ...view.detail.status, state: st, downloadId: mine.id, progress: mine.progress, gameId: mine.gameId } };
        paint(true);
      }
    }
  }
  ejg.downloads.onChange(() => {
    onDownloads();
    onChange();
  });
  ejg.explore.wishlist.onChange(() => {
    wishCount();
    if (active() !== "store") return;
    if (view.name === "detail") {
      // Solo el botón: la página del juego no se repinta (se perdería la captura elegida).
      const old = main.querySelector(".btn-wish");
      if (old && view.detail) {
        const was = focus.current === old;
        const next = wishButton(view.detail);
        old.replaceWith(next);
        if (was) focus.focus(next, { silent: true, noScroll: true });
      }
    } else paint(true);
  });

  // ─────────────── pintar ───────────────
  function paint(keepFocus = false) {
    const tab = active();
    const prevFocus = keepFocus ? focus.current : null;
    const slug = prevFocus?.closest?.("[data-slug]")?.dataset.slug;
    const dl = prevFocus?.closest?.("[data-dl]")?.dataset.dl;
    const key = prevFocus?.closest?.("[data-key]")?.dataset.key;
    if (tab === "downloads") {
      dlSig = listSig();
      main.replaceChildren(downloadsPage());
    } else {
      ensureShell();
      content.replaceChildren(view.name === "detail" ? detailPage() : view.name === "front" ? front() : view.name === "catalog" ? catalogPage() : view.name === "wish" ? wishPage() : results());
    }
    if (keepFocus && prevFocus && !prevFocus.isConnected) {
      const again =
        (key && main.querySelector(`[data-key="${key}"]`)) ||
        (slug && main.querySelector(`[data-slug="${slug}"]`)) ||
        (dl && main.querySelector(`[data-dl="${dl}"] [data-focus]`)) ||
        null;
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else focus.first(main);
    }
    onNavigate();
  }

  function back() {
    if (askOpen) return askOpen(), true;
    if (closeDialog()) return true;
    if (active() === "store" && sortOpen) {
      sortOpen = false;
      paint(true);
      focus.focus(main.querySelector('[data-key="sort"]'), { silent: true, noScroll: true });
      return true;
    }
    if (active() === "store" && view.name === "detail") {
      view.name = view.prev || "front";
      paint();
      main.scrollTop = view.scroll;
      const el = view.slug && main.querySelector(`[data-slug="${view.slug}"]`);
      if (el) focus.focus(el, { silent: true });
      else focus.first(main);
      return true;
    }
    if (active() === "store" && view.name !== "front") {
      goFront();
      focus.first(main);
      return true;
    }
    return false;
  }

  return {
    bindTab(fn) {
      tabRef = fn;
    },
    render() {
      if (active() === "store") {
        store.loadHome();
        store.loadGenres();
        restartCarousel();
      }
      paint();
    },
    openRepack,
    back,
    /** Hay algo a lo que volver (para la flecha «Atrás» de la barra superior). */
    canBack: () => active() === "store" && (!!dialog || !!askOpen || view.name !== "front"),
    /** Y en la tienda: buscar (teclado en pantalla con mando). */
    async search() {
      const f = store.state.catalog.filters;
      const q = await askQuery(ejg, f.query);
      if (q == null) {
        ensureShell();
        focus.focus(navInput);
        navInput.focus();
        return;
      }
      openCatalog({ ...f, query: q });
    },
    hasDialog: () => !!dialog || !!askOpen,
  };
}
