// Explorar y Mis descargas del tema Cinema: cartelera con los populares del
// día, filas de capturas, top 10, filas por género (se cargan al llegar a
// ellas), la página de un género con su desplegable «Géneros», la lista de deseados
// (la lista de deseados: fila en la portada y su página), ficha en la hoja
// modal con «Más títulos similares», diálogo de descarga y la lista de
// descargas con su anillo de progreso. La lógica común está en
// /_sdk/kit/store.js.

import { h, img, debounce, hueOf } from "/_sdk/kit/dom.js";
import { year, relative } from "/_sdk/kit/format.js";
import {
  createExplore,
  createDownloads,
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

const I = {
  play: '<svg viewBox="0 0 24 24"><path d="M6 4v16l14-8z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  down: '<svg class="s" viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  box: '<svg class="s" viewBox="0 0 24 24"><path d="M12 3v10m0 0-4-4m4 4 4-4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  resume: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  ext: '<svg class="s" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 6v8M12 18h.01"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  disk: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h.01M11 15h6"/></svg>',
  caret: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M4 6h12M4 12h12M4 18h8M18 15v6M15 18h6"/></svg>',
};
const RING = '<svg viewBox="0 0 36 36"><circle class="rg-bg" cx="18" cy="18" r="15.5"/><circle class="rg-fg" cx="18" cy="18" r="15.5" pathLength="100"/></svg><i></i>';
const RING_ICON = { queued: I.clock, paused: I.pause, seeding: I.box, completed: I.box, installed: I.check, error: I.alert };

// Filas por género de la portada (ids de ejg.explore.genres()) y su título.
const GENRE_ROWS = [
  [55, "Juegos de acción"],
  [47, "Juegos de rol"],
  [54, "Terror"],
  [59, "Mundos abiertos"],
  [66, "Estrategia"],
  [65, "Supervivencia"],
  [56, "Disparos"],
  [51, "Aventuras"],
  [70, "Carreras"],
  [71, "Simulación"],
  [214, "Roguelikes"],
  [84, "Puzles"],
];

const TAG = {
  installed: "Instalado",
  library: "En tu biblioteca",
  queued: "En cola",
  paused: "En pausa",
  seeding: "Listo para instalar",
  completed: "Listo para instalar",
  installing: "Instalando",
  error: "Error",
};

export function createStore({ ejg, main, root, focus, searchBox, searchInput, goView, onUi, onQueue = () => {} }) {
  const store = createExplore(ejg, () => {
    if (view === "explore") paint(true);
  });
  const queue = createDownloads(ejg, () => onDownloads());
  let view = "home";
  // page: "front" | "catalog" | "search" | "wish" (lista de deseados).
  const sv = { page: "front", wishSort: "added" };
  // Filas por género de la portada: se piden al llegar a ellas y se guardan.
  const genreCache = new Map();
  let drop = null; // desplegable «Géneros» u «Ordenar»
  const known = new Map(); // slug → Repack, para abrir la ficha al instante
  const bb = { list: [], i: 0, timer: 0, el: null, label: "hoy" };
  let sheet = null;
  let dialog = null;
  let askOpen = null;
  // La lista de deseados del perfil (en este PC). «Mi lista» ya es la de la biblioteca.
  const wl = ejg.explore.wishlist;
  let wishSet = new Set(wl.items.map((x) => x.slug));
  let wishSig = ""; // los juegos de la lista ya pintados (para no repintar por nada)
  const wishBusy = new Set(); // añadiendo o quitando (sin dobles pulsaciones)

  const run = (p) => Promise.resolve(p).catch((e) => ejg.ui.toast(e.message || String(e), "error"));
  const remember = (list) => list.forEach((r) => known.set(r.slug, { ...known.get(r.slug), ...r }));
  const dedupe = (list) => list.filter((r, k) => list.findIndex((x) => x.slug === r.slug) === k);
  const wished = (slug) => !!slug && wishSet.has(slug);
  remember(wl.items);

  // ─────────────── estado de cada juego (en vivo con la cola) ───────────────
  function live(r) {
    const d = r.slug && ejg.downloads.all.find((x) => x.slug === r.slug);
    if (d) return { state: d.state, downloadId: d.id, gameId: d.gameId ?? r.status?.gameId ?? null, progress: d.progress };
    const s = r.status || { state: "none" };
    // Ya no está en la cola: vuelve a «Descargar».
    if (s.downloadId && s.state !== "installed" && s.state !== "library") return { state: "none" };
    return s;
  }
  const actionOf = (r) => repackAction({ status: live(r) });
  const actionIcon = (a) => (a.id === "play" ? I.play : a.id === "install" ? I.box : I.down);
  const actionHtml = (a) => `${actionIcon(a)}<span>${a.label}</span>`;

  function act(r) {
    const s = live(r);
    const a = repackAction({ status: s });
    if (a.id === "download") return openDialog(r);
    if (a.id === "install" && s.downloadId) return run(ejg.downloads.install(s.downloadId));
    if (a.id === "play" && s.gameId) return run(ejg.game.launch(s.gameId));
    closeSheet(true);
    goView("downloads");
  }

  function applyStatus(el, r) {
    const s = live(r);
    const tag = el.querySelector(".sc-tag");
    const bar = el.querySelector(".sc-bar");
    el.dataset.state = s.state;
    const text = s.state === "downloading" ? `Descargando ${percent(s.progress)}` : TAG[s.state] || "";
    tag.textContent = text;
    tag.hidden = !text;
    const dl = s.state === "downloading" || s.state === "queued" || s.state === "paused";
    bar.hidden = !dl;
    if (dl) bar.firstChild.style.width = `${Math.round((s.progress || 0) * 1000) / 10}%`;
  }

  // ─────────────── piezas ───────────────
  const placeholder = (title) => {
    const hue = hueOf(title);
    return h("div", { class: "sc-ph", style: { background: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 40) % 360} 45% 11%))` } });
  };

  /** Marca de «en tu lista de deseados» en las tarjetas (fuera de la propia lista). */
  const wishMark = (slug) => h("span", { class: "sc-wish", hidden: !wished(slug), html: I.check });

  /** `opts.wish`: tarjeta de la fila de deseados; `opts.mark: false`, sin la marca. */
  function card(r, opts = {}) {
    const el = h(
      "button",
      { class: "sc", "data-focus": "", "data-slug": r.slug, "data-wish": opts.wish ? r.slug : null, onclick: () => openRepack(r.slug), title: r.title },
      h("div", { class: "sc-art" }, r.hero ? img(r.hero) : r.cover ? img(r.cover, { class: "fit" }) : placeholder(r.title)),
      opts.fresh ? h("span", { class: "sc-new" }, "Novedad") : null,
      opts.wish || opts.mark === false ? null : wishMark(r.slug),
      h("span", { class: "sc-tag", hidden: true }),
      h(
        "div",
        { class: "sc-info" },
        repackName(r),
        h("span", null, [sizeText(r.repackSize), r.genres.slice(0, 3).map(genreLabel).join(" • ")].filter(Boolean).join("  ·  ")),
      ),
      h("div", { class: "sc-bar", hidden: true }, h("i")),
    );
    applyStatus(el, r);
    return el;
  }

  function row(id, title, list, opts = {}) {
    if (!list.length) return null;
    return h(
      "section",
      { class: "s-row", id: `s-${id}` },
      h(
        "div",
        { class: "s-row-h" },
        h("h2", null, title),
        // Con ratón, el enlace del título; con mando, la última tarjeta de la fila.
        opts.more ? h("button", { class: "s-all", onclick: opts.more, html: `<span>Ver todo</span>${I.chev}` }) : null,
      ),
      h(
        "div",
        { class: "track", "data-focus-group": `s-${id}` },
        ...list.map((r) => card(r, opts)),
        opts.more ? h("button", { class: "sc sc-more", "data-focus": "", "data-k": `more-${id}`, onclick: opts.more }, h("span", { html: I.chev }), h("b", null, "Ver todo")) : null,
      ),
    );
  }

  function top10(list) {
    if (!list.length) return null;
    const items = list.slice(0, 10).map((r, k) => {
      const el = h(
        "button",
        { class: "t10", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug), title: r.title },
        h("b", { class: "t10-n" + (k === 9 ? " ten" : "") }, String(k + 1)),
        h(
          "div",
          { class: "t10-art" },
          r.cover ? img(r.cover) : h("span", { class: "t10-ph" }, r.title),
          // Aquí no se ve el nombre: la etiqueta HV va sobre la carátula.
          hypervisorTag(r),
          wishMark(r.slug),
          h("span", { class: "sc-tag", hidden: true }),
          h("div", { class: "sc-bar", hidden: true }, h("i")),
        ),
      );
      applyStatus(el, r);
      return el;
    });
    return h(
      "section",
      { class: "s-row t10-row", id: "s-top" },
      h("div", { class: "s-row-h" }, h("h2", null, `Los 10 juegos más populares ${bb.label}`)),
      h("div", { class: "track", "data-focus-group": "s-top" }, ...items),
    );
  }

  // Cada fila pide su género al acercarse a la pantalla (no todas de golpe).
  const lazy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        lazy.unobserve(e.target);
        loadGenreRow(Number(e.target.dataset.genre));
      }
    },
    { root: main, rootMargin: "600px 0px" },
  );

  async function loadGenreRow(id) {
    if (genreCache.has(id)) return;
    genreCache.set(id, null);
    try {
      const r = await ejg.explore.browse({ genres: [id] }, 1);
      genreCache.set(id, r.items);
      remember(r.items);
    } catch {
      genreCache.set(id, []);
    }
    const sec = root.querySelector(`[data-genre="${id}"]`);
    if (sec && view === "explore" && sv.page === "front") sec.replaceWith(genreRow(id));
  }

  function genreRow(id) {
    const title = GENRE_ROWS.find((g) => g[0] === id)?.[1] || genreName(id);
    const items = genreCache.get(id);
    const more = () => openCatalog({ genres: [id] });
    if (items && !items.length) return h("section", { class: "s-row", hidden: true });
    if (items) {
      const sec = row(`g-${id}`, title, items.slice(0, 20), { more });
      sec.dataset.genre = id;
      return sec;
    }
    // Aún sin datos: la fila con tarjetas vacías del mismo tamaño.
    const sec = h(
      "section",
      { class: "s-row", "data-genre": id },
      h("div", { class: "s-row-h" }, h("h2", null, title)),
      h("div", { class: "track" }, ...Array.from({ length: 6 }, () => h("div", { class: "sc sc-skel" }))),
    );
    requestAnimationFrame(() => sec.isConnected && lazy.observe(sec));
    return sec;
  }

  // ─────────────── un género: la página con sus desplegables ───────────────
  const genreName = (id) => store.state.genres.find((g) => g.id === id)?.name || "";

  /** Página de un género (o de todos). `filters`: empezar con estos. */
  function openCatalog(filters = null) {
    if (view !== "explore") goView("explore");
    closeSheet(true);
    closeDrop(true);
    const c = store.state.catalog;
    store.loadGenres();
    if (filters) store.browse({ ...emptyFilters(), ...filters });
    else if (!c.page && !c.loading) store.browse({});
    searchInput.value = "";
    searchBox.classList.remove("open");
    sv.page = "catalog";
    stopBillboard();
    main.scrollTo({ top: 0, behavior: "instant" });
    paint();
    focus.focus(root.querySelector('[data-k="d-genre"]'), { silent: true, noScroll: true });
    onUi();
  }

  /** Cabecera de la página: «Juegos», el desplegable «Géneros» y «Deseados», como en las plataformas de series. */
  function pageHead(title, genres = true) {
    return h(
      "div",
      { class: "nf-head", "data-focus-group": "nf-head" },
      h("h1", null, title),
      genres
        ? h("button", { class: "nf-drop-btn", "data-focus": "", "data-k": "d-genre", onclick: (e) => openDrop("genre", e.currentTarget) }, h("span", null, "Géneros"), h("span", { html: I.caret }))
        : null,
      h(
        "button",
        { class: "nf-wish", "data-focus": "", "data-k": "mylist", onclick: () => openWishlist() },
        h("span", { html: I.list }),
        h("span", null, "Deseados"),
        h("span", { class: "nbadge", hidden: !wl.items.length }, String(wl.items.length)),
      ),
    );
  }

  function catalogPage() {
    const c = store.state.catalog;
    const f = c.filters;
    remember(c.items);
    const g = f.genres.length === 1 ? genreName(f.genres[0]) : "";
    const title = g ? g : f.genres.length ? f.genres.map(genreName).join(" · ") : "Todos los juegos";
    const sortLabel = SORTS.find((o) => o.id === f.sort)?.label || SORTS[0].label;
    const chip = (k, label, on, fn) => h("button", { class: "nf-chip" + (on ? " on" : ""), "data-focus": "", "data-k": k, onclick: fn }, label);
    return h(
      "div",
      { class: "s-results nf-cat" },
      h(
        "div",
        { class: "nf-cat-bar" },
        pageHead(title),
        h(
          "button",
          { class: "nf-sort", "data-focus": "", "data-k": "d-sort", onclick: (e) => openDrop("sort", e.currentTarget) },
          h("span", null, sortLabel),
          h("span", { html: I.caret }),
        ),
      ),
      h(
        "div",
        { class: "nf-chips", "data-focus-group": "nf-chips" },
        ...SIZES.filter((o) => o.gb).map((o) => chip(`z-${o.gb}`, o.label, f.maxGb === o.gb, () => store.browse({ maxGb: f.maxGb === o.gb ? null : o.gb }))),
        chip("owned", "Sin los que ya tengo", f.hideOwned, () => store.browse({ hideOwned: !f.hideOwned })),
        h("span", { class: "nf-total" }, c.loading && !c.items.length ? "" : `${c.filtered && c.page < c.pages ? "unos " : ""}${count(c.total)}`),
      ),
      c.error ? h("p", { class: "s-err" }, c.error) : null,
      !c.items.length && !c.loading && !c.error ? h("p", { class: "s-muted" }, "No hay nada que coincida con estos filtros.") : null,
      h("div", { class: "s-grid", "data-focus-group": "s-grid" }, ...c.items.map((r) => card(r))),
      c.loading ? h("div", { class: "spinner" }) : null,
      c.page && c.page < c.pages && !c.loading ? h("button", { class: "hbtn info s-more", "data-focus": "", "data-k": "more", onclick: () => store.browseMore() }, "Ver más") : null,
    );
  }

  // Más al llegar abajo (rueda o ratón).
  main.addEventListener(
    "scroll",
    () => {
      if (view === "explore" && sv.page === "catalog" && !sheet && main.scrollTop + main.clientHeight > main.scrollHeight - 700) store.browseMore();
    },
    { passive: true },
  );

  /** Desplegable negro con los géneros en columnas (o el orden: "sort" del catálogo, "wsort" de los deseados), bajo su botón. */
  function openDrop(kind, anchor) {
    closeDrop(true);
    store.loadGenres();
    const f = store.state.catalog.filters;
    const cur = sv.page === "catalog" && f.genres.length === 1 ? f.genres[0] : null;
    const one = kind !== "genre";
    const opt = (k, label, on, fn) => h("button", { class: "nf-opt" + (on ? " on" : ""), "data-focus": "", "data-k": k, onclick: fn }, label);
    const items =
      kind === "wsort"
        ? WISH_SORTS.map((o) => opt(`o-${o.id}`, o.label, sv.wishSort === o.id, () => (closeDrop(), (sv.wishSort = o.id), paint(true))))
        : kind === "sort"
          ? SORTS.map((o) => opt(`o-${o.id}`, o.label, f.sort === o.id, () => (closeDrop(), store.browse({ sort: o.id }))))
          : [
              opt("o-all", "Todos los géneros", sv.page === "catalog" && !f.genres.length, () => openCatalog({ sort: f.sort })),
              ...store.state.genres.map((g) => opt(`o-${g.id}`, g.name, cur === g.id, () => openCatalog({ genres: [g.id], sort: f.sort }))),
            ];
    const box = h("div", { class: "nf-drop" + (one ? " one" : ""), "data-focus-group": "nf-drop" }, ...items);
    const layer = h("div", { class: "nf-drop-layer", "data-focus-trap": "", onclick: (e) => e.target === layer && closeDrop() }, box);
    document.body.append(layer);
    const a = anchor.getBoundingClientRect();
    box.style.top = `${a.bottom + 4}px`;
    if (one) box.style.right = `${Math.max(12, innerWidth - a.right)}px`;
    else box.style.left = `${a.left}px`;
    box.style.maxHeight = `${innerHeight - a.bottom - 30}px`;
    drop = { layer, anchor, kind };
    focus.focus(box.querySelector(".nf-opt.on") || box.querySelector("[data-focus]"), { instant: true, silent: true });
    ejg.sound.play("open");
    onUi();
  }

  function closeDrop(silent) {
    if (!drop) return false;
    const { layer, kind } = drop;
    layer.remove();
    drop = null;
    if (!silent) {
      focus.focus(root.querySelector(`[data-k="d-${kind}"]`), { silent: true, noScroll: true });
      onUi();
    }
    return true;
  }

  // ─────────────── lista de deseados ───────────────
  const wishSigOf = () => wl.items.map((x) => x.slug).join(",");

  /** Añade o quita un juego (con su aviso); el repintado llega con onChange. */
  function wish(r) {
    if (!r?.slug || wishBusy.has(r.slug)) return;
    wishBusy.add(r.slug);
    toggleWish(ejg, r).finally(() => wishBusy.delete(r.slug));
  }

  /** «Añadido hace 3 días» */
  const addedText = (ts) => {
    if (!ts) return "";
    const t = relative(ts);
    return `Añadido ${t[0].toLowerCase()}${t.slice(1)}`;
  };

  /** Fila «Tu lista de deseados» de la portada (oculta mientras la lista esté vacía). */
  function wishRow() {
    const items = sortWishlist(wl.items, sv.wishSort).slice(0, 20);
    wishSig = wishSigOf();
    remember(items);
    return row("wish", "Tu lista de deseados", items, { wish: true, more: () => openWishlist() }) || h("section", { class: "s-row", id: "s-wish", hidden: true });
  }

  /** Página «Lista de deseados»: los juegos en tarjetas, con su orden. */
  function openWishlist() {
    if (view !== "explore") goView("explore");
    closeSheet(true);
    closeDrop(true);
    searchInput.value = "";
    searchBox.classList.remove("open");
    sv.page = "wish";
    stopBillboard();
    main.scrollTo({ top: 0, behavior: "instant" });
    paint();
    focus.focus(root.querySelector(".wl-grid [data-focus]") || root.querySelector("[data-focus]"), { silent: true, noScroll: true });
    onUi();
  }

  function wishPage() {
    const items = sortWishlist(wl.items, sv.wishSort);
    wishSig = wishSigOf();
    remember(items);
    const sortLabel = WISH_SORTS.find((o) => o.id === sv.wishSort)?.label || WISH_SORTS[0].label;
    return h(
      "div",
      { class: "s-results nf-cat wl-page" },
      h(
        "div",
        { class: "nf-cat-bar" },
        h("div", { class: "nf-head" }, h("h1", null, "Lista de deseados"), items.length ? h("span", { class: "wl-total" }, count(items.length)) : null),
        items.length
          ? h("button", { class: "nf-sort", "data-focus": "", "data-k": "d-wsort", onclick: (e) => openDrop("wsort", e.currentTarget) }, h("span", null, sortLabel), h("span", { html: I.caret }))
          : null,
      ),
      items.length
        ? h("div", { class: "s-grid wl-grid", "data-focus-group": "wl-grid" }, ...items.map(wishItem))
        : h(
            "div",
            { class: "d-empty wl-empty" },
            h("span", { class: "d-empty-ico", html: I.list }),
            h("h2", null, "Tu lista está vacía"),
            h("p", null, "Añade juegos con «+ Deseados» desde su ficha y los tendrás aquí a mano. La lista se guarda en este PC, solo para este perfil."),
            h("button", { class: "hbtn play", "data-focus": "", onclick: () => setQuery("") }, "Descubrir juegos"),
          ),
    );
  }

  /** Tarjeta de la página con su tamaño, fecha, cuándo se añadió y «Quitar». */
  function wishItem(r) {
    return h(
      "div",
      { class: "wl-item", "data-wish": r.slug },
      card(r, { mark: false }),
      h(
        "div",
        { class: "wl-foot" },
        h("div", { class: "wl-meta" }, h("span", null, [sizeText(r.repackSize), year(r.date)].filter(Boolean).join("  ·  ")), h("small", null, addedText(r.addedAt))),
        h("button", {
          class: "round wl-x",
          "data-focus": "",
          "data-k": `wx-${r.slug}`,
          title: "Quitar de la lista de deseados",
          "aria-label": "Quitar de la lista de deseados",
          onclick: () => wish(r),
          html: I.check + I.x,
        }),
      ),
    );
  }

  /** Si se va de la lista el juego con el foco (o el que abrió la ficha), pasa al de al lado. */
  function keepWishAnchor() {
    const cur = sheet ? sheet.prev : focus.current;
    const box = cur?.isConnected ? cur.closest("[data-wish]") : null;
    if (!box || wished(box.dataset.wish)) return;
    const sibs = [...box.parentNode.children];
    const i = sibs.indexOf(box);
    const next = [...sibs.slice(i + 1), ...sibs.slice(0, i).reverse()].find((x) => wished(x.dataset.wish));
    if (!next) return;
    const el = cur === box ? next : next.querySelector(cur.classList.contains("wl-x") ? ".wl-x" : ".sc");
    if (sheet) sheet.prev = el;
    else focus.focus(el, { silent: true, noScroll: true });
  }

  /** La fila de la portada, en su sitio (sin repintar lo demás). */
  function repaintWishRow() {
    const old = root.querySelector("#s-wish");
    if (!old) return;
    const cur = old.contains(focus.current) ? focus.current : null;
    const sec = wishRow();
    old.replaceWith(sec);
    if (!cur) return;
    const again = refind(cur) || root.querySelector(".s-rows [data-focus]");
    if (again) focus.focus(again, { silent: true, noScroll: true });
  }

  function onWish() {
    const items = wl.items;
    wishSet = new Set(items.map((x) => x.slug));
    remember(items);
    updateSheetWish();
    if (view !== "explore") return;
    keepWishAnchor();
    // Contador de la cabecera, marcas de las tarjetas y su estado (descargando, instalado…).
    const badge = root.querySelector('[data-k="mylist"] .nbadge');
    if (badge) {
      badge.hidden = !items.length;
      badge.textContent = String(items.length);
    }
    root.querySelectorAll(".sc-wish").forEach((m) => (m.hidden = !wished(m.closest("[data-slug]")?.dataset.slug)));
    for (const r of items) root.querySelectorAll(`[data-slug="${CSS.escape(r.slug)}"]`).forEach((el) => el.querySelector(".sc-tag") && applyStatus(el, known.get(r.slug)));
    if (wishSigOf() === wishSig) return;
    if (sv.page === "wish") {
      if (!items.length && drop?.kind === "wsort") closeDrop(true);
      paint(true);
    } else if (sv.page === "front") repaintWishRow();
  }
  wl.onChange(onWish);

  // ─────────────── cartelera ───────────────
  function billboard(list) {
    bb.list = list;
    if (!list.length) return (bb.el = null);
    bb.i %= list.length;
    bb.el = h(
      "section",
      { class: "bb" },
      h("div", { class: "bb-media" }),
      h("div", { class: "hero-fade" }),
      h("div", { class: "bb-info" }),
      list.length > 1 ? h("div", { class: "bb-dots" }, ...list.map(() => h("i"))) : null,
    );
    bbShow(bb.i, true);
    return bb.el;
  }

  function bbShow(i, instant) {
    const r = bb.list[i];
    if (!r || !bb.el) return;
    bb.i = i;
    const media = bb.el.querySelector(".bb-media");
    const layer = img(r.hero, { loading: "eager", class: "bb-img" });
    media.append(layer);
    const swap = () => {
      layer.classList.add("on");
      setTimeout(() => [...media.children].forEach((c) => c !== layer && c.remove()), instant ? 0 : 1100);
    };
    if (instant) swap();
    else layer.decode().catch(() => {}).then(() => requestAnimationFrame(swap));
    const had = bb.el.contains(focus.current) ? focus.current.dataset.k : null;
    const a = actionOf(r);
    bb.el.querySelector(".bb-info").replaceChildren(
      h("div", { class: "bb-rank" }, h("span", { class: "t10-badge", html: "TOP<b>10</b>" }), h("span", null, `N.º ${i + 1} en juegos ${bb.label}`)),
      repackName(r, "h1", { class: "bb-title" + (r.title.length > 34 ? " xl" : r.title.length > 18 ? " l" : "") }),
      h(
        "p",
        { class: "bb-desc" },
        r.genres.slice(0, 4).map(genreLabel).join(" • "),
        r.genres.length && r.repackSize ? h("i", null, "·") : null,
        r.repackSize ? h("span", null, `Descarga ${sizeText(r.repackSize)}`) : null,
      ),
      h(
        "div",
        { class: "hero-actions", "data-focus-group": "bb" },
        h("button", { class: "hbtn play", "data-focus": "", "data-k": "act", "data-act": a.id, onclick: () => act(r), html: actionHtml(a) }),
        h("button", { class: "hbtn info", "data-focus": "", "data-k": "info", onclick: () => openRepack(r.slug), html: `${I.info}<span>Más información</span>` }),
      ),
    );
    bb.el.querySelectorAll(".bb-dots i").forEach((d, k) => d.classList.toggle("on", k === i));
    if (had) focus.focus(bb.el.querySelector(`[data-k="${had}"]`), { silent: true, noScroll: true });
  }

  function startBillboard() {
    stopBillboard();
    if (bb.list.length < 2) return;
    bb.timer = setInterval(() => {
      // Quieta si no se ve o si se está usando.
      if (view !== "explore" || sv.page !== "front" || sheet || dialog || document.hidden || !bb.el?.isConnected) return;
      if (focus.current?.closest(".bb") || main.scrollTop > innerHeight * 0.4) return;
      bbShow((bb.i + 1) % bb.list.length);
    }, 9000);
  }
  function stopBillboard() {
    clearInterval(bb.timer);
    bb.timer = 0;
  }
  ejg.on("visibility", (v) => (v.visible && view === "explore" && sv.page === "front" ? startBillboard() : stopBillboard()));

  // ─────────────── portada de Explorar ───────────────
  function front() {
    const s = store.state;
    if (s.homeError) {
      return h(
        "div",
        { class: "s-empty" },
        h("h1", null, "No se pudo abrir Explorar"),
        h("p", null, s.homeError),
        h("button", { class: "hbtn play", "data-focus": "", onclick: () => store.loadHome(true) }, "Reintentar"),
      );
    }
    if (!s.home) return h("div", { class: "s-empty" }, h("div", { class: "spinner" }));
    const by = Object.fromEntries(s.home.sections.map((x) => [x.id, x]));
    s.home.sections.forEach((x) => remember(x.items));
    const today = by.today?.items || [];
    const week = by.week?.items || [];
    const month = by.month?.items || [];
    const latest = by.latest?.items || [];
    bb.label = today.length ? "hoy" : "esta semana";
    const top = dedupe([...today, ...week]).slice(0, 10);
    return h(
      "div",
      { class: "s-front" },
      // «Géneros» cuando ya estén; «Deseados», siempre.
      h("div", { class: "nf-over" }, pageHead("Juegos", store.state.genres.length > 0)),
      billboard((today.length ? today : week).filter((r) => r.hero).slice(0, 6)),
      h(
        "div",
        { class: "s-rows" },
        // La lista de deseados, la primera bajo la cartelera (como en las plataformas de series).
        wishRow(),
        top10(top),
        row("week", by.week?.title || "Populares de la semana", week),
        row("latest", "Novedades", latest, { fresh: true, more: () => openCatalog({ sort: "date" }) }),
        row("month", by.month?.title || "Populares del mes", month),
        ...GENRE_ROWS.map(([id]) => genreRow(id)),
      ),
    );
  }

  const count = (n) => `${n} ${n === 1 ? "título" : "títulos"}`;
  function results() {
    const s = store.state;
    const items = s.results;
    const busy = s.searching;
    const err = s.searchError;
    remember(items);
    return h(
      "div",
      { class: "s-results" },
      h(
        "div",
        { class: "s-res-h" },
        h("h1", null, h("span", null, "Resultados de "), `«${s.query}»`),
        items.length ? h("span", null, count(s.pages > 1 ? s.total : items.length)) : null,
      ),
      err ? h("p", { class: "s-err" }, err) : null,
      !items.length && !busy && !err
        ? h("p", { class: "s-muted" }, `No hay nada que coincida con «${s.query}». Prueba con otro nombre.`)
        : null,
      h("div", { class: "s-grid", "data-focus-group": "s-grid" }, ...items.map((r) => card(r))),
      busy ? h("div", { class: "spinner" }) : null,
      s.page < s.pages && !busy
        ? h("button", { class: "hbtn info s-more", "data-focus": "", onclick: () => store.more() }, "Ver más")
        : null,
    );
  }

  // ─────────────── búsqueda de la barra superior ───────────────
  function setQuery(q) {
    q = (q || "").trim();
    searchInput.value = q;
    searchBox.classList.toggle("open", !!q || document.activeElement === searchInput);
    if (view !== "explore") goView("explore");
    const was = sv.page;
    if (!q && was === "front" && !store.state.query) return onUi();
    sv.page = q ? "search" : "front";
    if (was !== sv.page) main.scrollTo({ top: 0, behavior: "instant" });
    // Sin texto, la portada se pinta ya (el aviso de createExplore llega al momento).
    store.search(q, q && was === "search" ? 350 : 0);
    if (!q && !root.contains(focus.current) && focus.current !== searchInput) focus.first(root);
    onUi();
  }
  searchInput.addEventListener(
    "input",
    debounce(() => setQuery(searchInput.value), 60),
  );
  // Intro: a los resultados (Esc lo gestiona back()).
  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || sv.page !== "search") return;
    const first = root.querySelector(".s-grid [data-focus]");
    if (first) focus.focus(first);
  });
  searchInput.addEventListener("focus", () => searchBox.classList.add("open"));
  searchInput.addEventListener("blur", () => searchBox.classList.toggle("open", !!searchInput.value.trim()));
  searchInput.addEventListener("click", () => {
    if (ejg.input.source === "gamepad") askSearch();
  });

  async function askSearch() {
    const q = await askQuery(ejg, store.state.query);
    if (q == null) return;
    setQuery(q);
    if (q.trim()) focus.focus(searchInput, { silent: true, noScroll: true });
  }

  /** Lupa de la barra (y Y): abre la caja; con mando, el teclado en pantalla. */
  async function openSearch() {
    if (view !== "explore") goView("explore");
    if (ejg.input.source === "gamepad") return askSearch();
    searchBox.classList.add("open");
    focus.focus(searchInput, { silent: true, noScroll: true });
    searchInput.focus();
  }

  // ─────────────── ficha (hoja modal) ───────────────
  async function openRepack(slug) {
    const prev = sheet ? sheet.prev : focus.current;
    closeSheet(true);
    const box = h("div", { class: "sheet s-sheet", "data-focus-trap": "" });
    const layer = h("div", { class: "s-modal", onclick: (e) => e.target === layer && closeSheet() }, box);
    document.body.append(layer);
    sheet = { slug, r: known.get(slug) || null, d: null, error: "", layer, box, prev };
    renderSheet(false);
    ejg.sound.play("open");
    onUi();
    try {
      const d = await store.details(slug);
      if (sheet?.slug !== slug) return;
      sheet.d = d;
      remember([d]);
    } catch (e) {
      if (sheet?.slug !== slug) return;
      sheet.error = e.message || String(e);
    }
    renderSheet(true);
  }

  function renderSheet(keep) {
    const { d, error, box } = sheet;
    const r = d || sheet.r;
    const had = keep && box.contains(focus.current) ? focus.current.dataset.k : null;
    const hvOpen = keep && !!box.querySelector(".hv.is-open");
    const close = h("button", { class: "close", "data-focus": "", "data-k": "close", onclick: () => closeSheet(), title: "Cerrar" }, "✕");
    if (!r) {
      box.replaceChildren(h("div", { class: "sheet-hero" }, close), error ? h("p", { class: "s-err s-pad" }, error) : h("div", { class: "spinner" }));
      focus.focus(close, { instant: true, silent: true });
      return;
    }
    const heroUrl = r.hero || d?.screenshots?.[0]?.full || r.coverFull || r.cover;
    const hero = h("div", { class: "sheet-hero", style: heroUrl ? { backgroundImage: `url("${heroUrl}")` } : {} });
    const a = actionOf(r);
    const btn = h("button", { class: "hbtn play", "data-focus": "", "data-k": "act", "data-act": a.id, onclick: () => act(r), html: actionHtml(a) });
    hero.append(
      close,
      h(
        "div",
        { class: "over" },
        repackName(r, "h1", { class: "hero-title s-title" }),
        h(
          "div",
          { class: "hero-actions", "data-focus-group": "s-sheet-act" },
          btn,
          setWishBtn(h("button", { class: "s-wishbtn", "data-focus": "", "data-k": "wish", onclick: () => wish(r) }), wished(r.slug)),
          r.url ? h("button", { class: "hbtn info", "data-focus": "", "data-k": "web", onclick: () => run(ejg.explore.openPage(r.slug)), html: `${I.ext}<span>Ver en FitGirl</span>` }) : null,
        ),
      ),
    );
    const act0 = actionOf(r);
    const meta = h(
      "div",
      { class: "hero-meta" },
      act0.hint ? h("span", { class: "match" }, act0.hint) : null,
      r.date ? h("span", null, year(r.date)) : null,
      r.number ? h("span", { class: "pill" }, `Repack n.º ${r.number}`) : null,
      r.selective ? h("span", { class: "pill" }, "Descarga selectiva") : null,
      r.version ? h("span", { class: "s-ver" }, r.version) : null,
    );
    // Crack de hipervisor: bajo los datos, donde las plataformas de series ponen
    // la clasificación por edades y sus advertencias (antes de darle a Descargar).
    const hv = hypervisorInfo(ejg, r, { open: hvOpen });
    if (hv) {
      hv.querySelector(".hv-foot").dataset.focusGroup = "s-hv";
      hv.querySelector(".hv-more").dataset.k = "hv-more";
      hv.querySelector(".hv-guide").dataset.k = "hv-guide";
    }
    // Sin descripción, las características ocupan su sitio.
    const feats = d?.features || [];
    const featsLeft = d && !d.description && feats.length;
    const featList = () => h("ul", { class: "s-feat" }, ...feats.map((f) => h("li", null, f)));
    const desc = h("div", { class: "s-desc" }, d ? d.description || (featsLeft ? featList() : "") : h("div", { class: "skel" }, h("i"), h("i"), h("i")));
    const known = (r.tags || []).map((t) => store.state.genres.find((g) => g.id === t)).filter(Boolean);
    const genreLinks = known.length
      ? known.slice(0, 5).flatMap((g, i) => [i ? ", " : null, h("button", { class: "s-glink", "data-focus": "", "data-k": `gl-${g.id}`, onclick: () => openCatalog({ genres: [g.id] }) }, g.name)]).filter(Boolean)
      : null;
    const facts = [
      ["Géneros", genreLinks ? null : r.genres.map(genreLabel).join(", ")],
      ["Compañías", r.companies],
      ["Idiomas", r.languages],
      ["Tamaño original", sizeText(r.originalSize)],
      ["Descarga", sizeText(r.repackSize)],
      ["Instalado", sizeText(d?.installSize)],
      ["Advertencias", r.hypervisor && HYPERVISOR.title, { class: "hv-fact", title: HYPERVISOR.tip }],
    ].filter((f) => f[1]);
    const shots = d?.screenshots || [];
    // Sin los huecos vacíos: replaceChildren pintaría «null».
    box.replaceChildren(
      ...[
      hero,
      h(
        "div",
        { class: "sheet-body" },
        h("div", null, meta, hv, desc),
        h(
          "div",
          { class: "side" },
          genreLinks ? h("div", { class: "s-glinks", "data-focus-group": "s-glinks" }, "Géneros: ", ...genreLinks) : null,
          ...facts.map(([k, v, p]) => h("div", p || null, `${k}: `, h("b", null, v))),
        ),
      ),
      shots.length ? h("h3", { class: "sec" }, "Capturas") : null,
      shots.length
        ? h(
            "div",
            { class: "s-shots", "data-focus-group": "s-shots" },
            ...shots.map((s, k) =>
              h(
                "button",
                {
                  class: "ep",
                  "data-focus": "",
                  "data-k": `shot-${k}`,
                  onclick: () => {
                    hero.style.backgroundImage = `url("${s.full}")`;
                    sheet?.layer.scrollTo({ top: 0, behavior: "smooth" });
                  },
                },
                img(s.thumb),
              ),
            ),
          )
        : null,
      feats.length && !featsLeft ? h("h3", { class: "sec" }, "Características del repack") : null,
      feats.length && !featsLeft ? h("div", { class: "s-feats" }, featList()) : null,
      d ? similarSec(d) : null,
      error ? h("p", { class: "s-err s-pad" }, error) : null,
      h("div", { class: "s-foot" }),
      ].filter(Boolean),
    );
    // Descripción larga: recortada con «Leer más».
    if (d?.description || featsLeft) {
      desc.classList.add("clamp");
      requestAnimationFrame(() => {
        if (desc.scrollHeight <= desc.clientHeight + 4) return desc.classList.remove("clamp");
        const more = h("button", { class: "s-readmore", "data-focus": "", "data-k": "more", onclick: () => (desc.classList.remove("clamp"), more.remove(), focus.focus(btn, { silent: true, noScroll: true })) }, "Leer más");
        desc.after(more);
      });
    }
    const again = had && box.querySelector(`[data-k="${had}"]`);
    focus.focus(again || btn, { instant: true, silent: true, noScroll: !!again });
  }

  /** «Más títulos similares»: tarjetas pequeñas dentro de la ficha. */
  function similarSec(d) {
    const grid = h("div", { class: "sim-grid", "data-focus-group": "sim" });
    const sec = h("div", { class: "sim" }, h("h3", { class: "sec" }, "Más títulos similares"), grid);
    store.similar(d, 9).then((list) => {
      if (sheet?.slug !== d.slug) return;
      if (!list.length) return sec.remove();
      remember(list);
      grid.replaceChildren(
        ...list.map((x) =>
          h(
            "button",
            { class: "sim-card", "data-focus": "", "data-k": `sim-${x.slug}`, onclick: () => openRepack(x.slug), title: x.title },
            h("div", { class: "sim-art" }, x.hero ? img(x.hero) : x.cover ? img(x.cover, { class: "fit" }) : placeholder(x.title)),
            h("div", { class: "sim-info" }, repackName(x), h("span", null, [sizeText(x.repackSize), year(x.date)].filter(Boolean).join("  ·  "))),
          ),
        ),
      );
    });
    return sec;
  }

  /** Botón redondo «+ Deseados» / «✓ En deseados» de la ficha. */
  function setWishBtn(b, on) {
    b.classList.toggle("on", on);
    b.setAttribute("aria-label", on ? "Quitar de la lista de deseados" : "Añadir a la lista de deseados");
    b.innerHTML = `<span class="round">${on ? I.check : I.plus}</span><span class="s-wish-lb">${on ? "En deseados" : "Deseados"}</span>`;
    return b;
  }

  function updateSheetWish() {
    const b = sheet?.box.querySelector('[data-k="wish"]');
    const on = wished(sheet?.slug);
    if (b && b.classList.contains("on") !== on) setWishBtn(b, on);
  }

  function updateSheetAction() {
    if (!sheet) return;
    const r = sheet.d || sheet.r;
    const btn = r && sheet.box.querySelector('[data-k="act"]');
    if (!btn) return;
    const a = actionOf(r);
    if (btn.dataset.act !== a.id) {
      btn.dataset.act = a.id;
      btn.innerHTML = actionHtml(a);
    } else btn.lastChild.textContent = a.label;
  }

  function closeSheet(silent) {
    if (!sheet) return false;
    const prev = sheet.prev;
    sheet.layer.remove();
    sheet = null;
    if (!silent) {
      // Si la vista se repintó debajo (p. ej. la de deseados), el mismo elemento en la nueva.
      const again = prev?.isConnected ? prev : refind(prev);
      if (again) focus.focus(again, { silent: true });
      else focus.first(root);
      onUi();
    }
    return true;
  }

  // ─────────────── diálogo de descarga ───────────────
  async function openDialog(r) {
    closeDialog();
    const cancel = h("button", { class: "hbtn info sm", "data-focus": "", onclick: () => closeDialog() }, "Cancelar");
    const body = h("div", { class: "dlg-body" }, h("div", { class: "spinner" }), h("p", { class: "s-muted center" }, "Buscando el torrent…"));
    const foot = h("div", { class: "dlg-foot" }, cancel);
    const box = h(
      "div",
      { class: "dlg" },
      h("div", { class: "dlg-hero", style: r.hero ? { backgroundImage: `url("${r.hero}")` } : {} }, h("div", { class: "dlg-t" }, h("small", null, "Descargar"), repackName(r))),
      body,
      foot,
    );
    const layer = h("div", { class: "s-modal dlg-layer", "data-focus-trap": "" }, box);
    document.body.append(layer);
    dialog = { layer, slug: r.slug, prep: null, prev: focus.current };
    ejg.sound.play("open");
    focus.focus(cancel, { instant: true, silent: true });
    onUi();
    let prep;
    try {
      prep = await ejg.downloads.prepare(r.slug);
    } catch (e) {
      if (dialog?.slug !== r.slug) return;
      body.replaceChildren(h("p", { class: "s-err center" }, e.message || String(e)));
      return;
    }
    if (dialog?.slug !== r.slug) return;
    dialog.prep = prep;
    const sel = fileSelection(prep);
    let dir = prep.dir ? { path: prep.dir, freeBytes: prep.freeBytes } : null;
    const need = h("b");
    const avail = h("b");
    const pathEl = h("span", { class: "dlg-path" });
    const err = h("p", { class: "s-err" });
    const go = h("button", { class: "hbtn play sm", "data-focus": "", html: `${I.down}<span>Descargar</span>` });
    const upd = () => {
      need.textContent = bytes(sel.bytes);
      avail.textContent = dir?.freeBytes != null ? bytes(dir.freeBytes) : "—";
      pathEl.textContent = dir?.path || "Elige una carpeta";
      const problem = !dir ? "Elige dónde guardar la descarga" : sel.error || (!sel.fits(dir.freeBytes) ? "No hay espacio suficiente en ese disco" : "");
      err.textContent = problem;
      go.disabled = !!problem;
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
      // Crack de hipervisor: el aviso, lo primero.
      ...(prep.hypervisor ? [h("div", { class: "hv-warn", role: "note" }, h("span", { class: "hv-tag", "aria-hidden": "true" }, HYPERVISOR.badge), h("p", null, HYPERVISOR.download))] : []),
      h("div", { class: "dlg-space" }, h("div", null, h("span", null, "Espacio necesario"), need), h("div", null, h("span", null, "Espacio disponible"), avail)),
      h(
        "div",
        { class: "dlg-loc" },
        h("span", { class: "ico", html: I.disk }),
        pathEl,
        h(
          "button",
          {
            class: "hbtn info xs",
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
        groups.length ? h("p", { class: "dlg-warn" }, "En el instalador, desmarca lo que no hayas descargado.") : null,
        prep.installSize
          ? h("p", { class: "s-muted small" }, `El juego instalado ocupará ${sizeText(prep.installSize)}${prep.installFreeBytes != null ? ` (quedan ${bytes(prep.installFreeBytes)} en ${prep.installDir})` : ""}.`)
          : null,
      ].filter(Boolean),
      err,
    );
    go.onclick = async () => {
      go.disabled = true;
      go.lastChild.textContent = "Añadiendo…";
      try {
        await ejg.downloads.start(prep.token, sel.indices(), dir.path);
        closeDialog(true);
        ejg.ui.toast(`«${r.title}» añadido a Mis descargas`, "ok");
        store.refresh();
        updateSheetAction();
      } catch (e) {
        err.textContent = e.message || String(e);
        go.disabled = false;
        go.lastChild.textContent = "Descargar";
      }
    };
    foot.replaceChildren(go, cancel);
    upd();
    focus.focus(go.disabled ? body.querySelector("[data-focus]") : go, { instant: true, silent: true });
  }

  function closeDialog(done) {
    if (!dialog) return false;
    if (!dialog.prep && !done) ejg.downloads.cancelPrepare(dialog.slug).catch(() => {});
    const prev = dialog.prev;
    dialog.layer.remove();
    dialog = null;
    if (prev?.isConnected) focus.focus(prev, { silent: true, noScroll: true });
    else focus.first(sheet ? sheet.box : root);
    onUi();
    return true;
  }

  /** Pregunta con dos respuestas y Cancelar: true, false o null. */
  function ask(title, text, yes, no) {
    return new Promise((resolve) => {
      const prev = focus.current;
      const done = (v) => {
        layer.remove();
        askOpen = null;
        if (prev?.isConnected) focus.focus(prev, { silent: true, noScroll: true });
        else focus.first(root);
        onUi();
        resolve(v);
      };
      const bYes = h("button", { class: "hbtn play sm", "data-focus": "", onclick: () => done(true) }, yes);
      const layer = h(
        "div",
        { class: "s-modal dlg-layer", "data-focus-trap": "" },
        h(
          "div",
          { class: "dlg small" },
          h("div", { class: "dlg-head" }, title),
          h("div", { class: "dlg-body" }, h("p", null, text)),
          h(
            "div",
            { class: "dlg-foot" },
            bYes,
            h("button", { class: "hbtn info sm", "data-focus": "", onclick: () => done(false) }, no),
            h("button", { class: "hbtn info sm ghost", "data-focus": "", onclick: () => done(null) }, "Cancelar"),
          ),
        ),
      );
      document.body.append(layer);
      askOpen = () => done(null);
      focus.focus(bYes, { instant: true, silent: true });
      onUi();
    });
  }

  // ─────────────── Mis descargas ───────────────
  const ORDER = { downloading: 0, installing: 1, queued: 2, paused: 3, error: 4 };
  const rows = new Map();

  function sizeLine(d) {
    if (d.state === "installed") return d.filesDeleted ? "Repack borrado" : `Repack de ${bytes(d.totalBytes)}`;
    if (d.state === "seeding" || d.state === "completed" || d.state === "installing")
      return [bytes(d.totalBytes), d.installSize && `instalado ocupará ${sizeText(d.installSize)}`].filter(Boolean).join(" · ");
    return `${bytes(d.doneBytes)} de ${bytes(d.totalBytes)}`;
  }
  function stateLine(d) {
    if (d.state === "installed") return d.installedAt ? `Instalado ${relative(d.installedAt)}` : "Instalado";
    const on = d.state === "downloading" && !d.checking;
    return [downloadLabel(d), on && d.eta ? `quedan ${eta(d.eta)}` : "", on && d.peers ? `${d.peers} fuentes` : ""].filter(Boolean).join(" · ");
  }

  function setRing(el, d) {
    const done = d.state === "installed" || d.state === "seeding" || d.state === "completed";
    const p = done ? 1 : d.progress || 0;
    el.dataset.state = d.state;
    el.querySelector(".rg-fg").style.strokeDashoffset = String(100 - Math.round(p * 1000) / 10);
    const inner = el.lastChild;
    if (d.state === "downloading" || d.state === "installing") {
      inner.dataset.k = "pct";
      inner.innerHTML = `${Math.floor(p * 100)}<small>%</small>`;
    } else if (inner.dataset.k !== d.state) {
      inner.dataset.k = d.state;
      inner.innerHTML = RING_ICON[d.state] || "";
    }
  }

  function dlRow(d) {
    const title = h("b");
    const meta = h("span", { class: "d-meta" });
    const state = h("span", { class: "d-state" });
    const ring = h("span", { class: "ring", html: RING });
    const bar = h("i");
    const btns = h("div", { class: "d-btns", "data-focus-group": `d-${d.id}` });
    const el = h(
      "div",
      { class: "d-row", "data-dl": d.id },
      h(
        "div",
        { class: "d-thumb", onclick: () => d.slug && openRepack(d.slug), title: d.slug ? "Ver la ficha" : "" },
        d.hero || d.cover ? img(d.hero || d.cover, { class: d.hero ? "" : "fit" }) : null,
        h("div", { class: "d-bar" }, bar),
      ),
      h("div", { class: "d-main" }, title, meta, state),
      btns,
      ring,
    );
    let sig = "";
    const update = (d) => {
      title.textContent = d.title;
      meta.textContent = sizeLine(d);
      state.textContent = stateLine(d);
      el.dataset.state = d.state;
      setRing(ring, d);
      bar.parentNode.hidden = d.state === "installed";
      bar.style.width = `${Math.round(d.progress * 1000) / 10}%`;
      // Botones solo si cambian (para no perder el foco).
      const s = `${d.state}|${d.pauseReason}|${d.filesDeleted}|${d.gameId}`;
      if (s === sig) return;
      sig = s;
      const round = (ico, label, fn) => h("button", { class: "round", "data-focus": "", title: label, "aria-label": label, onclick: fn, html: I[ico] });
      const list = [];
      if (canInstall(d)) list.push(h("button", { class: "hbtn play sm", "data-focus": "", onclick: () => run(ejg.downloads.install(d.id)), html: `${I.box}<span>Instalar</span>` }));
      if (d.pauseReason === "needs-folder") list.push(h("button", { class: "hbtn play sm", "data-focus": "", onclick: () => run(ejg.downloads.locate(d.id)) }, "Elegir carpeta"));
      if (d.state === "installed" && d.gameId) list.push(h("button", { class: "hbtn play sm", "data-focus": "", onclick: () => run(ejg.game.launch(d.gameId)), html: `${I.play}<span>Jugar</span>` }));
      if (isActive(d)) list.push(round("pause", "Pausar", () => run(ejg.downloads.pause(d.id))));
      if (d.state === "paused" || d.state === "error") list.push(round("resume", d.state === "error" ? "Reintentar" : "Reanudar", () => run(ejg.downloads.resume(d.id))));
      if (d.state === "queued") list.push(round("up", "Descargar primero", () => run(ejg.downloads.move(d.id, 0))));
      if (!(d.state === "installed" && d.filesDeleted)) list.push(round("folder", "Abrir carpeta", () => run(ejg.downloads.openFolder(d.id))));
      if (d.state !== "installing")
        list.push(
          round("x", "Quitar", async () => {
            d = ejg.downloads.all.find((x) => x.id === d.id) || d;
            if (d.filesDeleted) return run(ejg.downloads.remove(d.id, false));
            const keepGame = d.state === "installed";
            const files = await ask(
              "Quitar de Mis descargas",
              keepGame ? `¿Borrar también el repack de «${d.title}»? El juego instalado no se toca.` : `¿Borrar también lo descargado de «${d.title}» (${bytes(d.doneBytes)})?`,
              "Borrar archivos",
              "Conservarlos",
            );
            if (files != null) run(ejg.downloads.remove(d.id, files));
          }),
        );
      const had = btns.contains(focus.current);
      btns.replaceChildren(...list);
      if (had) focus.focus(btns.querySelector("[data-focus]"), { silent: true, noScroll: true });
    };
    update(d);
    return { el, update };
  }

  function summary() {
    const g = queue.groups();
    const now = g.all.filter((d) => d.state === "downloading");
    if (now.length) {
      const left = Math.max(0, g.total.size - g.total.done);
      const secs = g.total.speed ? left / g.total.speed : null;
      return [`${now.length === 1 ? "1 descarga" : `${now.length} descargas`} en curso`, speed(g.total.speed), eta(secs) && `quedan ${eta(secs)}`].filter(Boolean).join(" · ");
    }
    if (g.active.length) return "Instalando…";
    if (g.ready.length) return `${g.ready.length === 1 ? "1 juego listo" : `${g.ready.length} juegos listos`} para instalar`;
    if (g.waiting.length) return "Todo en pausa";
    return g.all.length ? "Nada descargándose ahora" : "";
  }

  function downloadsPage() {
    const g = queue.groups();
    const going = [...g.active, ...g.waiting, ...g.failed].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
    rows.clear();
    const section = (title, list, group) => {
      if (!list.length) return null;
      const box = h("div", { class: "d-list", "data-focus-group": group });
      for (const d of list) {
        const r = dlRow(d);
        rows.set(d.id, r);
        box.append(r.el);
      }
      return h("section", { class: "d-sec" }, h("h2", null, title, h("span", null, String(list.length))), box);
    };
    const all = [];
    if (g.all.some(isActive)) all.push(h("button", { class: "hbtn info sm", "data-focus": "", onclick: () => run(ejg.downloads.pause()), html: `${I.pause}<span>Pausar todo</span>` }));
    if (g.all.some((d) => d.state === "paused")) all.push(h("button", { class: "hbtn info sm", "data-focus": "", onclick: () => run(ejg.downloads.resume()), html: `${I.resume}<span>Reanudar todo</span>` }));
    return h(
      "div",
      { class: "d-page" },
      h(
        "div",
        { class: "d-head" },
        h("div", null, h("h1", null, "Mis descargas"), h("p", { class: "d-sum", id: "d-sum" }, summary())),
        all.length ? h("div", { class: "d-all", "data-focus-group": "d-all" }, ...all) : null,
      ),
      section("En curso", going, "d-going"),
      section("Listas para instalar", g.ready, "d-ready"),
      section("Instaladas", g.installed, "d-installed"),
      !g.all.length
        ? h(
            "div",
            { class: "d-empty" },
            h("span", { class: "d-empty-ico", html: I.down }),
            h("h2", null, "Aquí aparecerán tus descargas"),
            h("p", null, "Busca un juego en Explorar y pulsa Descargar: lo verás bajar aquí y podrás instalarlo al terminar."),
            ejg.explore.enabled ? h("button", { class: "hbtn play", "data-focus": "", onclick: () => goView("explore") }, "Buscar algo para descargar") : null,
          )
        : null,
    );
  }

  let dlSig = "";
  let dlSlugs = new Set();
  const listSig = () => ejg.downloads.all.map((d) => `${d.id}:${d.state}:${d.state === "downloading" ? "" : d.pauseReason}`).join(",");

  function onDownloads() {
    if (view === "downloads") {
      // Si solo cambió el progreso, se actualiza en su sitio (sin perder el foco).
      if (listSig() !== dlSig) paint(true);
      else {
        for (const d of ejg.downloads.all) rows.get(d.id)?.update(d);
        const sum = root.querySelector("#d-sum");
        if (sum) sum.textContent = summary();
      }
    } else if (view === "explore") {
      // Marcas de las tarjetas y botón de la cartelera.
      const now = new Set(ejg.downloads.all.map((d) => d.slug).filter(Boolean));
      for (const slug of new Set([...now, ...dlSlugs])) {
        const r = known.get(slug);
        if (r) root.querySelectorAll(`[data-slug="${CSS.escape(slug)}"]`).forEach((el) => el.querySelector(".sc-tag") && applyStatus(el, r));
      }
      dlSlugs = now;
      const cur = bb.list[bb.i];
      const b = bb.el?.querySelector('[data-k="act"]');
      if (cur && b) {
        const a = actionOf(cur);
        if (b.dataset.act !== a.id) (b.dataset.act = a.id), (b.innerHTML = actionHtml(a));
        else b.lastChild.textContent = a.label;
      }
    }
    updateSheetAction();
    onQueue();
  }

  // ─────────────── pintar ───────────────
  /** El mismo elemento tras repintar: por su data-k, el mismo juego (en su fila si sigue) o su descarga. */
  function refind(el) {
    if (!el) return null;
    const k = el.dataset?.k;
    const slug = el.closest?.("[data-slug]")?.dataset.slug;
    const dl = el.closest?.("[data-dl]")?.dataset.dl;
    const group = el.closest?.("[data-focus-group]")?.dataset.focusGroup;
    const s = slug && `[data-slug="${CSS.escape(slug)}"]`;
    return (
      (k && root.querySelector(`[data-k="${CSS.escape(k)}"]`)) ||
      (s && group && root.querySelector(`[data-focus-group="${CSS.escape(group)}"] ${s}`)) ||
      (s && root.querySelector(s)) ||
      (dl && root.querySelector(`[data-dl="${dl}"] [data-focus]`)) ||
      null
    );
  }

  function paint(keepFocus = false) {
    const prev = keepFocus ? focus.current : null;
    const wasEmpty = !root.querySelector("[data-focus]");
    const top = main.scrollTop;
    if (view === "downloads") {
      dlSig = listSig();
      root.replaceChildren(downloadsPage());
    } else if (view === "explore") {
      if (sv.page === "front") {
        root.replaceChildren(front());
        startBillboard();
      } else {
        stopBillboard();
        root.replaceChildren(sv.page === "catalog" ? catalogPage() : sv.page === "wish" ? wishPage() : results());
      }
    } else return;
    if (keepFocus) main.scrollTop = top;
    const free = !sheet && !dialog && !askOpen;
    if (keepFocus && prev && !prev.isConnected) {
      const again = refind(prev);
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else if (free) focus.first(root);
    } else if (wasEmpty && free && (!focus.current?.isConnected || focus.current.id === "nav-explore")) {
      // La portada acaba de cargar: el foco, a la cartelera.
      focus.first(root);
    }
  }

  function closeLayers() {
    closeDrop(true);
    if (askOpen) askOpen();
    if (dialog) closeDialog();
    closeSheet(true);
  }

  function back() {
    if (closeDrop()) return true;
    if (askOpen) return askOpen(), true;
    if (closeDialog()) return true;
    if (closeSheet()) return true;
    if (view === "explore" && (sv.page !== "front" || document.activeElement === searchInput)) {
      searchInput.blur();
      setQuery("");
      return true;
    }
    return false;
  }

  return {
    /** Cambia de vista: "home" (la del tema), "explore" o "downloads". */
    show(name) {
      closeLayers();
      view = name;
      if (name !== "explore") {
        stopBillboard();
        if (searchInput.value) {
          searchInput.value = "";
          searchBox.classList.remove("open");
          sv.page = "front";
          store.search("", 0);
        }
      }
      if (name === "home") {
        rows.clear();
        return root.replaceChildren();
      }
      if (name === "explore") {
        store.loadHome();
        store.loadGenres();
      }
      paint();
    },
    openRepack,
    /** Lupa de la barra y Y: buscar en Explorar (teclado en pantalla con mando). */
    search: openSearch,
    back,
    /** Capa abierta encima de la vista: "ask" | "dialog" | "sheet" | null. */
    layer: () => (drop ? "drop" : askOpen ? "ask" : dialog ? "dialog" : sheet ? "sheet" : null),
    /** Cola agrupada (createDownloads del kit), para el indicador de la barra. */
    groups: () => queue.groups(),
  };
}
