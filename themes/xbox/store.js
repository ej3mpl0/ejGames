// Tienda y Cola del tema Xbox: portada con «spotlight» y filas de mosaicos,
// «Explorar» (todo el catálogo con sus desplegables de filtros), búsqueda,
// ficha a pantalla completa con «Más como este», panel lateral de descarga,
// «Lista de deseos» y «Administrar cola». La lógica común está en /_sdk/kit/store.js.

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
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  top: '<svg viewBox="0 0 24 24"><path d="M5 4h14M12 20V9m0 0-5 5m5-5 5 5"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  queue: '<svg viewBox="0 0 24 24"><path d="M4 6h10M4 11h10M4 16h6m8-8v10m0 0-3-3m3 3 3-3"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  install: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v7m0 0-3-3m3 3 3-3"/></svg>',
  disk: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 14h.01M11 14h6"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>',
  caret: '<svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5 3.9 12.4A4.9 4.9 0 0 1 12 6.6a4.9 4.9 0 0 1 8.1 5.8Z"/></svg>',
  heartOn: '<svg viewBox="0 0 24 24"><path d="M12 20.5 3.9 12.4A4.9 4.9 0 0 1 12 6.6a4.9 4.9 0 0 1 8.1 5.8Z" fill="currentColor"/></svg>',
};

/** Géneros de la portada (id y color de la losa). */
const GENRE_TILES = [
  [55, "#b3261e"],
  [47, "#5b3fa8"],
  [51, "#b36b00"],
  [59, "#1f7a3a"],
  [54, "#3a3a3a"],
  [66, "#0f5a8a"],
  [65, "#5f6b1d"],
  [56, "#8a2c0f"],
  [71, "#146d6d"],
  [70, "#a3007a"],
  [214, "#44318c"],
  [84, "#0e7a6f"],
];
const icon = (n) => h("span", { class: "ico", html: I[n] });

// Los géneros llegan en inglés desde la fuente.
const GENRES = {
  action: "Acción", adventure: "Aventura", rpg: "Rol", "action rpg": "Rol de acción", jrpg: "Rol japonés", "open world": "Mundo abierto",
  shooter: "Disparos", driving: "Conducción", racing: "Carreras", simulation: "Simulación", simulator: "Simulación", horror: "Terror",
  strategy: "Estrategia", puzzle: "Puzles", platformer: "Plataformas", sports: "Deportes", fighting: "Lucha", stealth: "Sigilo",
  survival: "Supervivencia", "first-person": "Primera persona", "third-person": "Tercera persona", "top-down": "Vista cenital",
  "side view": "Vista lateral", side: "Vista lateral", isometric: "Isométrico", management: "Gestión", "turn-based": "Por turnos", tactics: "Táctica",
  "real-time": "Tiempo real", "visual novel": "Novela visual", "point-and-click": "Aventura gráfica", building: "Construcción",
  exploration: "Exploración", arcade: "Arcade", music: "Música", "hack and slash": "Hack and slash", "beat 'em up": "Beat 'em up",
  "shoot 'em up": "Matamarcianos", "vehicular combat": "Combate de vehículos", flight: "Vuelo", "card game": "Cartas", cards: "Cartas",
  "survival horror": "Survival horror", mystery: "Misterio", detective: "Detectives", comedy: "Comedia", fantasy: "Fantasía",
  "sci-fi": "Ciencia ficción", military: "Militar", war: "Bélico", zombies: "Zombis", "post-apocalyptic": "Postapocalíptico",
  multiplayer: "Multijugador", "co-op": "Cooperativo", coop: "Cooperativo", family: "Familiar", farming: "Granja", "city builder": "Ciudades",
};
const genre = (g) => GENRES[String(g).toLowerCase()] || g;
const genres = (r, n) => (r.genres || []).slice(0, n).map(genre);

const LABEL = {
  installed: "Instalado",
  library: "En tu colección",
  queued: "En cola",
  paused: "En pausa",
  seeding: "Listo para instalar",
  completed: "Listo para instalar",
  installing: "Instalando…",
  error: "Error",
};
const DL_STATES = new Set(["queued", "downloading", "paused", "seeding", "completed", "installing", "error"]);

export function createStore({ ejg, focus, pages, setView, openImage, onChange }) {
  const store = createExplore(ejg, () => {
    if (view === "store") paintBody();
  });
  let view = null; // "store" | "queue" | null (no se ve)
  // name: "front" | "catalog" | "search" | "wish"
  const st = { name: "front", moreFrom: null, focusResults: false, autoFocus: false, wishSort: "added" };
  const rp = { open: false, slug: null, detail: null, error: "", from: null };
  let dialog = null;
  let askOpen = null;
  let flyout = null;
  const run = (p) => Promise.resolve(p).catch((e) => ejg.ui.toast(e.message || String(e), "error"));

  /** El repack con el estado de su descarga al día (la portada se cachea). */
  function live(r) {
    const d = r.slug && ejg.downloads.all.find((x) => x.slug === r.slug);
    if (d) return { ...r, status: { state: d.state, downloadId: d.id, progress: d.progress, gameId: d.gameId } };
    if (r.status && DL_STATES.has(r.status.state)) return { ...r, status: { state: "none" } };
    return r;
  }

  function act(r) {
    const a = repackAction(r);
    if (a.id === "download") return openDialog(r);
    if (a.id === "install" && r.status.downloadId) return run(ejg.downloads.install(r.status.downloadId));
    if (a.id === "play" && r.status.gameId) return run(ejg.game.launch(r.status.gameId));
    setView("queue");
  }

  const dots = () => h("div", { class: "xb-dots" }, h("i"), h("i"), h("i"), h("i"), h("i"));

  // ─────────────── piezas ───────────────
  function badge(r) {
    const s = r.status?.state;
    if (!s || s === "none") return null;
    return h("span", { class: "st-badge " + s }, s === "downloading" ? `Descargando ${percent(r.status.progress)}` : LABEL[s]);
  }
  function progress(r) {
    const s = r.status?.state;
    if (s !== "downloading" && s !== "queued" && s !== "paused") return null;
    return h("span", { class: "st-prog" }, h("i", { style: { width: `${(r.status.progress || 0) * 100}%` } }));
  }
  const tileSig = (r) => `${r.status?.state}:${Math.floor((r.status?.progress || 0) * 100)}`;

  // Lista de deseos: los slugs, para marcar los mosaicos sin recorrerla cada vez.
  let wishes = new Set(ejg.explore.wishlist.items.map((w) => w.slug));
  const heart = () => h("span", { class: "st-heart", html: I.heartOn });
  const wishMark = (r) => (wishes.has(r.slug) ? heart() : null);

  function wideTile(r) {
    const lr = live(r);
    const el = h(
      "button",
      { class: "st-wide", "data-focus": "", "data-slug": r.slug, title: r.title, onclick: () => openRepack(r.slug) },
      img(r.hero || r.cover, { loading: "lazy" }),
      h("span", { class: "st-cap" }, h("b", null, r.title), h("small", null, [genres(r, 2).join(" · "), sizeText(r.repackSize)].filter(Boolean).join("  •  "))),
      badge(lr),
      progress(lr),
      wishMark(r),
    );
    el.__r = r;
    el.__sig = tileSig(lr);
    return el;
  }

  function boxTile(r) {
    const lr = live(r);
    const el = h(
      "button",
      { class: "st-box", "data-focus": "", "data-slug": r.slug, title: r.title, onclick: () => openRepack(r.slug) },
      h("span", { class: "st-art" }, r.cover ? img(r.cover, { loading: "lazy" }) : h("span", { class: "st-ph" }, r.title), badge(lr), progress(lr), wishMark(r)),
      h("b", null, r.title),
      h("small", null, sizeText(r.repackSize) || genres(r, 1)[0] || "—"),
    );
    el.__r = r;
    el.__sig = tileSig(lr);
    return el;
  }

  // Marcas de estado en su sitio (sin repintar la portada).
  function refreshTiles() {
    for (const el of pages.store.querySelectorAll("[data-slug]")) {
      if (!el.__r) continue;
      const lr = live(el.__r);
      const sig = tileSig(lr);
      if (sig === el.__sig) continue;
      el.__sig = sig;
      const box = el.querySelector(".st-art") || el;
      box.querySelectorAll(":scope > .st-badge, :scope > .st-prog").forEach((n) => n.remove());
      box.append(...[badge(lr), progress(lr)].filter(Boolean));
    }
    spot.label?.();
  }

  // Corazones en su sitio (también en «Más como este» de la ficha).
  function refreshHearts() {
    for (const el of [...pages.store.querySelectorAll(".st-box[data-slug], .st-wide[data-slug]"), ...pages.repack.querySelectorAll(".st-box[data-slug]")]) {
      const box = el.querySelector(".st-art") || el;
      const mark = box.querySelector(":scope > .st-heart");
      const on = wishes.has(el.dataset.slug);
      if (on && !mark) box.append(heart());
      else if (!on && mark) mark.remove();
    }
  }

  // ─────────────── cabecera de la tienda ───────────────
  const input = h("input", {
    class: "st-input",
    placeholder: "Buscar juegos",
    spellcheck: "false",
    "data-focus": "",
    oninput: debounce(() => {
      const q = input.value.trim();
      st.name = q ? "search" : "front";
      store.search(q);
    }, 60),
    onkeydown: (e) => {
      if (e.key === "Enter" && input.value.trim()) store.search(input.value, 0);
    },
    onclick: () => {
      if (ejg.input.source === "gamepad") search();
    },
  });
  const pill = (id, label, fn) => h("button", { class: "st-pill", "data-focus": "", "data-st": id, onclick: fn }, label);
  const qCount = h("span", { class: "st-count" });
  const wCount = h("span", { class: "st-count soft" });
  const paintWishCount = () => (wCount.textContent = ejg.explore.wishlist.items.length ? String(ejg.explore.wishlist.items.length) : "");
  paintWishCount();
  const head = h(
    "div",
    { class: "st-head", "data-focus-group": "st-head" },
    pill("front", "Destacados", () => goFront()),
    pill("catalog", "Explorar", () => openCatalog()),
    h("button", { class: "st-pill st-wish", "data-focus": "", "data-st": "wish", onclick: () => openWish() }, icon("heart"), "Lista de deseos", wCount),
    h("label", { class: "st-search" }, icon("search"), input),
    h("button", { class: "st-queue", "data-focus": "", onclick: () => setView("queue") }, icon("queue"), "Cola", qCount),
  );
  const body = h("div", { class: "st-body" });
  pages.store.append(head, body);

  function goFront() {
    st.name = "front";
    input.value = "";
    store.search(""); // pinta la portada
    pages.store.scrollTop = 0;
    focus.first(body);
    onChange();
  }

  /** «Explorar»: todo el catálogo. `filters`: empezar con estos (los demás, vacíos). */
  function openCatalog(filters = null) {
    const c = store.state.catalog;
    st.name = "catalog";
    input.value = "";
    store.loadGenres();
    if (filters) store.browse({ ...emptyFilters(), ...filters });
    else if (!c.page && !c.loading) store.browse({});
    paintBody(false);
    pages.store.scrollTop = 0;
    focus.focus(body.querySelector('[data-k="f-sort"]') || head.firstElementChild, { silent: true });
    onChange();
  }

  /** «Lista de deseos»: los juegos guardados por este perfil en este PC. */
  function openWish() {
    st.name = "wish";
    input.value = "";
    paintBody(false);
    pages.store.scrollTop = 0;
    focus.focus(body.querySelector(".wl-open") || body.querySelector("[data-focus]") || head.querySelector('[data-st="wish"]'), { silent: true });
    onChange();
  }

  // ─────────────── spotlight ───────────────
  const spot = { list: [], i: 0, timer: 0, set: null, label: null };

  function spotlight(kicker, items) {
    const list = items.filter((r) => r.hero).slice(0, 6);
    spot.set = spot.label = null;
    if (!list.length) return null;
    spot.list = list;
    spot.i %= list.length;
    const layers = [h("img", { class: "spot-img", alt: "", decoding: "async" }), h("img", { class: "spot-img", alt: "", decoding: "async" })];
    let front = 0;
    const title = h("h1", { class: "spot-title" });
    const meta = h("div", { class: "spot-meta" });
    const cur = () => spot.list[spot.i];
    const go = h("button", { class: "xb-btn green spot-go", "data-focus": "", onclick: () => act(live(cur())) });
    const more = h("button", { class: "xb-btn spot-more", "data-focus": "", onclick: () => openRepack(cur().slug) }, "Más información");
    const thumbs = list.map((r, k) =>
      h(
        "button",
        { class: "spot-thumb", "data-focus": "", "data-spot": k, title: r.title, onclick: () => openRepack(r.slug) },
        img(r.hero, { loading: "eager" }),
        h("i"),
      ),
    );
    spot.label = () => {
      const a = repackAction(live(cur()));
      if (go.__label === a.label) return;
      go.__label = a.label;
      go.replaceChildren(icon({ download: "download", install: "install", play: "play" }[a.id] || "queue"), a.label);
      go.classList.toggle("green", a.id !== "downloads");
    };
    function show(k) {
      spot.i = (k + list.length) % list.length;
      const r = cur();
      const layer = layers[1 - front];
      front = 1 - front;
      layer.classList.remove("on");
      layer.src = r.hero;
      const on = () => {
        if (layers[front] !== layer) return;
        layer.classList.add("on");
        layers[1 - front].classList.remove("on");
      };
      layer.decode().then(on, on);
      title.textContent = r.title;
      meta.textContent = [genres(r, 3).join(" · "), sizeText(r.repackSize)].filter(Boolean).join("   •   ");
      spot.label();
      thumbs.forEach((t, j) => t.classList.toggle("on", j === spot.i));
    }
    spot.set = show;
    show(spot.i);
    return h(
      "section",
      { class: "spot", "data-focus-group": "spot", onclick: (e) => e.target.closest("button") || openRepack(cur().slug) },
      ...layers,
      h("div", { class: "spot-shade" }),
      h("div", { class: "spot-info" }, h("small", { class: "spot-kicker" }, kicker), title, meta, h("div", { class: "spot-actions" }, go, more)),
      h("div", { class: "spot-rail" }, ...thumbs),
    );
  }

  function startSpot() {
    stopSpot();
    if (!spot.set || view !== "store" || st.name !== "front" || rp.open || document.hidden) return;
    spot.timer = setInterval(() => {
      if (document.hidden || focus.current?.closest(".spot")) return;
      spot.set?.(spot.i + 1);
    }, 8000);
  }
  function stopSpot() {
    clearInterval(spot.timer);
    spot.timer = 0;
  }
  ejg.on("visibility", (d) => (d && d.visible === false ? stopSpot() : startSpot()));

  // ─────────────── portada y resultados ───────────────
  function row(title, items, tile, id, extra) {
    const track = h("div", { class: "track st-track", "data-focus-group": "st-" + id });
    keyed(track, items, (r) => r.slug, tile);
    if (extra) track.append(extra);
    return h("section", { class: "row st-row" }, h("h2", null, title), track);
  }

  function empty(title, text, ...extra) {
    return h("div", { class: "st-empty" }, h("h1", null, title), text ? h("p", null, text) : null, ...extra);
  }

  function front() {
    const s = store.state;
    if (s.homeError) return empty("No se pudo abrir la Tienda", s.homeError, h("button", { class: "xb-btn green", "data-focus": "", onclick: () => store.loadHome(true) }, "Reintentar"));
    if (!s.home) return h("div", { class: "st-loading" }, dots(), h("p", null, "Cargando la Tienda…"));
    const by = Object.fromEntries(s.home.sections.map((x) => [x.id, x]));
    const today = by.today || by.week;
    const seeAll = h(
      "button",
      { class: "st-box st-all", "data-focus": "", "data-k": "all", onclick: () => openCatalog({ sort: "date" }) },
      h("span", { class: "st-art" }, icon("right"), h("b", null, "Ver todo")),
      h("b", null, "Novedades"),
      h("small", null, "Lo último publicado"),
    );
    return h(
      "div",
      { class: "st-front" },
      today ? spotlight(today.title, today.items) : null,
      by.week ? row(by.week.title, by.week.items, wideTile, "week") : null,
      s.genres.length ? genreRow() : null,
      by.month ? row(by.month.title, by.month.items, boxTile, "month") : null,
      by.latest ? row("Novedades", by.latest.items.slice(0, 15), boxTile, "latest", seeAll) : null,
    );
  }

  /** Losas de colores de los géneros, como las categorías de la Tienda. */
  function genreRow() {
    const track = h("div", { class: "track st-track", "data-focus-group": "st-genres" });
    for (const [id, color] of GENRE_TILES) {
      const g = store.state.genres.find((x) => x.id === id);
      if (!g) continue;
      track.append(h("button", { class: "st-genre", "data-focus": "", "data-k": `g-${id}`, style: `--c: ${color}`, onclick: () => openCatalog({ genres: [id] }) }, h("b", null, g.name)));
    }
    return h("section", { class: "row st-row" }, h("h2", null, "Explorar por género"), track);
  }

  // ─────────────── explorar: filtros en desplegables ───────────────
  const genreName = (id) => store.state.genres.find((g) => g.id === id)?.name || "";

  function toggleGenre(id) {
    if (!store.toggleGenre(id)) ejg.ui.toast(`Como mucho ${MAX_GENRES} géneros a la vez`, "info");
  }

  /** Opciones de cada desplegable: [{k, label, on, run, group?}] y si se cierra al elegir. */
  function flyItems(kind) {
    const f = store.state.catalog.filters;
    if (kind === "sort") return { close: true, items: SORTS.map((o) => ({ k: `o-sort-${o.id}`, label: o.label, on: f.sort === o.id, run: () => store.browse({ sort: o.id }) })) };
    if (kind === "size") return { close: true, items: SIZES.map((o) => ({ k: `o-size-${o.gb ?? 0}`, label: o.label, on: (f.maxGb || null) === o.gb, run: () => store.browse({ maxGb: o.gb }) })) };
    if (kind === "wsort") return { close: true, items: WISH_SORTS.map((o) => ({ k: `o-wsort-${o.id}`, label: o.label, on: st.wishSort === o.id, run: () => setWishSort(o.id) })) };
    const items = [];
    for (const grp of GENRE_GROUPS) {
      const list = store.state.genres.filter((g) => g.group === grp.id);
      list.forEach((g, i) => items.push({ k: `o-g-${g.id}`, label: g.name, on: f.genres.includes(g.id), run: () => toggleGenre(g.id), group: i === 0 ? grp.label : null }));
    }
    return { close: false, items };
  }

  function openFlyout(kind) {
    closeFlyout(true);
    const menu = h("div", { class: "xf-menu" + (kind === "genre" ? " multi" : ""), "data-focus-group": "xf" });
    const l = h("div", { class: "xf-layer", "data-focus-trap": "", onclick: (e) => e.target === l && closeFlyout() }, menu);
    document.body.append(l);
    flyout = { kind, layer: l, menu, prev: focus.current };
    paintFlyout();
    const on = menu.querySelector(".xf-opt.on") || menu.querySelector("[data-focus]");
    focus.focus(on, { silent: true });
    ejg.sound.play("open");
    onChange();
  }

  function paintFlyout() {
    if (!flyout) return;
    const { kind, menu, layer } = flyout;
    const anchor = body.querySelector(`[data-k="f-${kind}"]`);
    const key = focus.current && menu.contains(focus.current) ? focus.current.dataset.k : null;
    const { close, items } = flyItems(kind);
    menu.replaceChildren(
      ...items.flatMap((it) => [
        it.group ? h("div", { class: "xf-group" }, it.group) : null,
        h(
          "button",
          {
            class: "xf-opt" + (it.on ? " on" : ""),
            "data-focus": "",
            "data-k": it.k,
            role: close ? "menuitemradio" : "menuitemcheckbox",
            onclick: () => {
              it.run();
              if (close) closeFlyout();
            },
          },
          h("span", { class: "xf-mark", html: it.on ? I.check : "" }),
          h("span", null, it.label),
        ),
      ]).filter(Boolean),
    );
    if (anchor) {
      const a = anchor.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(a.left, window.innerWidth - 340))}px`;
      menu.style.top = `${a.bottom + 6}px`;
      menu.style.maxHeight = `${Math.max(200, window.innerHeight - a.bottom - 30)}px`;
    }
    if (key) {
      const el = menu.querySelector(`[data-k="${key}"]`);
      if (el && el !== focus.current) focus.focus(el, { silent: true, noScroll: true });
    }
    layer.hidden = false;
  }

  function closeFlyout(silent) {
    if (!flyout) return false;
    const { layer, kind } = flyout;
    layer.remove();
    flyout = null;
    if (!silent) {
      const a = body.querySelector(`[data-k="f-${kind}"]`);
      if (a) focus.focus(a, { silent: true });
      onChange();
    }
    return true;
  }

  /** Desplegable de la barra de filtros (abre su menú flotante). */
  const drop = (kind, label, value, active) =>
    h("button", { class: "st-drop" + (active ? " on" : ""), "data-focus": "", "data-k": `f-${kind}`, onclick: () => openFlyout(kind) }, h("small", null, label), h("span", null, value), icon("caret"));

  function catalogBody() {
    const c = store.state.catalog;
    const f = c.filters;
    const sortLabel = SORTS.find((o) => o.id === f.sort)?.label || SORTS[0].label;
    const genresLabel = f.genres.length ? f.genres.map(genreName).join(", ") : "Todos";
    const sizeLabel = SIZES.find((o) => o.gb === (f.maxGb || null))?.label || "";
    const count = c.loading && !c.items.length ? "Buscando…" : `${c.filtered && c.page < c.pages ? "Unos " : ""}${c.total.toLocaleString("es")} juegos`;
    const grid = h("div", { class: "st-grid", "data-focus-group": "st-results" });
    keyed(grid, c.items, (r) => r.slug, boxTile);
    return h(
      "div",
      { class: "st-results" },
      h("div", { class: "st-rhead" }, h("h1", null, f.query ? `Explorar «${f.query}»` : "Todos los juegos"), h("span", null, count)),
      h(
        "div",
        { class: "st-filters", "data-focus-group": "st-filters" },
        drop("sort", "Ordenar por", sortLabel, false),
        drop("genre", "Género", genresLabel, f.genres.length > 0),
        drop("size", "Tamaño", sizeLabel, !!f.maxGb),
        h(
          "button",
          { class: "st-toggle" + (f.hideOwned ? " on" : ""), "data-focus": "", "data-k": "f-owned", role: "switch", "aria-checked": String(!!f.hideOwned), onclick: () => store.browse({ hideOwned: !f.hideOwned }) },
          h("i"),
          "Ocultar los que ya tengo",
        ),
        filterCount(f) || f.query ? h("button", { class: "st-clear", "data-focus": "", "data-k": "f-clear", onclick: () => store.clearFilters() }, "Quitar filtros") : null,
      ),
      c.error ? h("p", { class: "st-err" }, c.error) : null,
      !c.items.length && !c.loading && !c.error ? h("p", { class: "st-muted" }, "No hay juegos que coincidan con estos filtros.") : null,
      grid,
      c.loading ? dots() : null,
      c.page && c.page < c.pages && !c.loading
        ? h(
            "button",
            {
              class: "xb-btn st-moreres",
              "data-focus": "",
              "data-k": "more",
              onclick: () => {
                st.moreFrom = c.items.length;
                store.browseMore();
              },
            },
            "Ver más",
          )
        : null,
    );
  }

  // Más al llegar abajo (rueda o ratón).
  pages.store.addEventListener(
    "scroll",
    () => {
      const el = pages.store;
      if (view === "store" && st.name === "catalog" && !rp.open && el.scrollTop + el.clientHeight > el.scrollHeight - 700) store.browseMore();
    },
    { passive: true },
  );

  function results() {
    const s = { ...store.state, items: store.state.results };
    const err = s.searchError;
    const items = s.items || [];
    const grid = h("div", { class: "st-grid", "data-focus-group": "st-results" });
    keyed(grid, items, (r) => r.slug, boxTile);
    return h(
      "div",
      { class: "st-results" },
      h("div", { class: "st-rhead" }, h("h1", null, `Resultados de «${s.query}»`), s.total ? h("span", null, `${s.total} resultados`) : null),
      err ? h("p", { class: "st-err" }, err) : null,
      !items.length && !s.searching && !err ? h("p", { class: "st-muted" }, "No hay ningún juego con ese nombre.") : null,
      grid,
      s.searching ? dots() : null,
      s.page < s.pages && !s.searching
        ? h(
            "button",
            {
              class: "xb-btn st-moreres",
              "data-focus": "",
              "data-k": "more",
              onclick: () => {
                st.moreFrom = items.length;
                store.more();
              },
            },
            "Ver más resultados",
          )
        : null,
    );
  }

  // ─────────────── lista de deseos ───────────────
  // Lo que se pintó (para no repintar si solo llega la misma lista).
  let wishSig = "";
  const wishSigOf = () => ejg.explore.wishlist.items.map((w) => `${w.slug}:${w.status?.state}`).join(",");

  function setWishSort(id) {
    st.wishSort = id;
    ejg.storage.set("wishSort", id).catch(() => {});
    paintBody();
  }
  ejg.storage.get("wishSort").then((v) => {
    if (!WISH_SORTS.some((o) => o.id === v) || v === st.wishSort) return;
    st.wishSort = v;
    if (view === "store" && st.name === "wish") paintBody();
  }, () => {});

  /** Añade o quita (con aviso). Resuelve con true si queda en la lista; sin dobles pulsaciones. */
  async function wishToggle(r, btn) {
    if (btn.__busy) return wishes.has(r.slug);
    btn.__busy = true;
    const on = await toggleWish(ejg, r, "tu lista de deseos");
    btn.__busy = false;
    return on;
  }

  /** Fila de la lista: arte con su estado, nombre, tamaño y fechas; abre la ficha o se quita. */
  function wishRow(r) {
    const lr = live(r);
    const art = r.capsule || r.hero || r.cover;
    const open = h(
      "button",
      { class: "wl-open", "data-focus": "", "data-slug": r.slug, title: r.title, onclick: () => openRepack(r.slug) },
      h("span", { class: "st-art wl-art" }, art ? img(art, { loading: "lazy" }) : h("span", { class: "st-ph" }, r.title), badge(lr), progress(lr)),
      h(
        "span",
        { class: "wl-txt" },
        h("b", null, r.title),
        h("small", null, genres(r, 3).join(" · ") || "—"),
        h(
          "span",
          { class: "wl-meta" },
          [sizeText(r.repackSize), r.date ? `Publicado el ${date(r.date)}` : "", r.addedAt ? `Añadido el ${date(r.addedAt * 1000)}` : ""].filter(Boolean).join("  •  "),
        ),
      ),
    );
    open.__r = r;
    open.__sig = tileSig(lr);
    const tip = "Quitar de la lista de deseos";
    const rm = h("button", { class: "q-sq wl-rm", "data-focus": "", "data-k": `wrm-${r.slug}`, "data-tip": tip, "aria-label": tip, onclick: () => wishToggle(r, rm) }, icon("heartOn"));
    return h("div", { class: "wl-row", "data-wish": r.slug }, open, rm);
  }

  function wishBody() {
    const all = ejg.explore.wishlist.items;
    wishSig = wishSigOf();
    const n = all.length;
    const title = h("div", { class: "st-rhead" }, h("h1", null, "Lista de deseos"), n ? h("span", null, `${n} ${n === 1 ? "juego" : "juegos"}`) : null);
    if (!n)
      return h(
        "div",
        { class: "st-results" },
        title,
        h(
          "div",
          { class: "q-empty wl-empty" },
          icon("heart"),
          h("h2", null, "Tu lista de deseos está vacía"),
          h("p", null, "Añade juegos desde su página con el botón del corazón. La lista se guarda en este PC, solo para este perfil."),
          h("button", { class: "xb-btn green", "data-focus": "", "data-k": "w-explore", onclick: () => openCatalog() }, "Explorar juegos"),
        ),
      );
    const sortLabel = WISH_SORTS.find((o) => o.id === st.wishSort)?.label || WISH_SORTS[0].label;
    return h(
      "div",
      { class: "st-results" },
      title,
      h("div", { class: "st-filters", "data-focus-group": "st-filters" }, drop("wsort", "Ordenar por", sortLabel, false)),
      h("div", { class: "wl-list", "data-focus-group": "st-wish" }, ...sortWishlist(all, st.wishSort).map((r) => wishRow(r))),
      h("p", { class: "wl-note" }, icon("info"), "La lista se guarda en este PC, solo para este perfil."),
    );
  }

  /** Tras quitar un juego: la fila que ocupa su sitio (el mismo botón). */
  function wishNear(at, prev) {
    const rows = body.querySelectorAll(".wl-row");
    if (at < 0 || !rows.length) return null;
    return rows[Math.min(at, rows.length - 1)].querySelector(prev.classList.contains("wl-rm") ? ".wl-rm" : ".wl-open");
  }

  function paintBody(keep = true) {
    if (view !== "store") return;
    const prev = keep ? focus.current : null;
    const inBody = !!prev && body.contains(prev);
    const group = inBody && prev.closest("[data-focus-group]")?.dataset.focusGroup;
    const slug = inBody && prev.closest("[data-slug]")?.dataset.slug;
    const k = inBody && prev.dataset.k;
    const wRow = inBody && prev.closest(".wl-row");
    const wAt = wRow ? [...wRow.parentNode.children].indexOf(wRow) : -1;
    body.replaceChildren(st.name === "front" ? front() : st.name === "catalog" ? catalogBody() : st.name === "wish" ? wishBody() : results());
    paintFlyout();
    head.querySelectorAll(".st-pill").forEach((p) => p.classList.toggle("on", p.dataset.st === st.name));
    if (st.name === "front") startSpot();
    else stopSpot();
    const searching = st.name === "catalog" ? store.state.catalog.loading : store.state.searching;
    const grid = body.querySelector(".st-grid");
    if (!searching && grid && st.moreFrom != null && grid.children[st.moreFrom]) {
      focus.focus(grid.children[st.moreFrom], { silent: true });
      st.moreFrom = null;
    } else if (!searching && grid && st.focusResults && grid.firstElementChild) {
      st.focusResults = false;
      focus.focus(grid.firstElementChild, { instant: true, silent: true });
    } else if (st.autoFocus && store.state.home && focus.current === head.firstElementChild) {
      st.autoFocus = false;
      focus.first(body);
    } else if (inBody && !prev.isConnected) {
      const q = (sel) => (group && body.querySelector(`[data-focus-group="${group}"] ${sel}`)) || body.querySelector(sel);
      const again =
        (slug && q(`[data-slug="${CSS.escape(slug)}"]`)) ||
        (k && body.querySelector(`[data-k="${CSS.escape(k)}"]`)) ||
        (st.moreFrom != null && grid?.children[st.moreFrom - 1]) ||
        wishNear(wAt, prev);
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else focus.first(body) || focus.first(head);
    }
    onChange();
  }

  // ─────────────── ficha ───────────────
  async function openRepack(slug) {
    if (!slug) return;
    if (!rp.open) rp.from = focus.current;
    Object.assign(rp, { open: true, slug, detail: null, error: "" });
    stopSpot();
    pages.repack.hidden = false;
    pages.repack.scrollTop = 0;
    paintRepack();
    ejg.sound.play("open");
    onChange();
    try {
      rp.detail = await store.details(slug);
    } catch (e) {
      rp.error = e.message || String(e);
    }
    if (rp.slug !== slug || !rp.open) return;
    paintRepack();
    const b = pages.repack.querySelector(".rp-main");
    if (b) focus.focus(b, { instant: true, silent: true });
  }

  function closeRepack(silent) {
    if (!rp.open) return false;
    const back = rp.from;
    Object.assign(rp, { open: false, slug: null, detail: null, error: "", from: null });
    pages.repack.hidden = true;
    pages.repack.replaceChildren();
    if (silent) return true;
    startSpot();
    // Si el mosaico se repintó mientras tanto, el mismo juego si sigue ahí.
    const again = back && !back.isConnected && back.dataset.slug ? body.querySelector(`[data-slug="${CSS.escape(back.dataset.slug)}"]`) : null;
    // Si se abrió desde fuera (onView), el foco estaba en la cabecera: mejor, a la portada.
    if (back?.isConnected && !head.contains(back)) focus.focus(back, { silent: true });
    else if (again) focus.focus(again, { silent: true });
    else focus.first(view === "queue" ? pages.queue : (st.name === "wish" && body.querySelector(".wl-list")) || body) || focus.first(head);
    // La lista de deseos cambió con la ficha abierta: se repinta ahora (el foco sigue en su fila).
    if (view === "store" && st.name === "wish" && wishSigOf() !== wishSig) paintBody();
    onChange();
    return true;
  }

  function setWish(btn, on) {
    const tip = on ? "En tu lista de deseos" : "Añadir a la lista de deseos";
    btn.classList.toggle("on", on);
    btn.dataset.tip = tip;
    btn.setAttribute("aria-label", tip);
    btn.setAttribute("aria-pressed", String(on));
    btn.replaceChildren(icon(on ? "heartOn" : "heart"));
  }

  function refreshWish() {
    const b = rp.open && pages.repack.querySelector(".rp-wish");
    if (b && !b.__busy) setWish(b, wishes.has(rp.slug));
  }

  function setMain(btn, r) {
    const a = repackAction(r);
    const p = r.status?.progress;
    btn.replaceChildren(
      ...[
        icon({ download: "download", install: "install", play: "play" }[a.id] || "queue"),
        h("span", null, a.label),
        a.id === "downloads" && p ? h("i", { class: "rp-prog", style: { width: `${p * 100}%` } }) : null,
      ].filter(Boolean),
    );
    btn.classList.toggle("green", a.id !== "downloads");
    btn.__sig = `${r.status?.state}:${Math.floor((p || 0) * 100)}`;
    const hint = pages.repack.querySelector(".rp-hint");
    if (hint) hint.textContent = a.hint || "";
  }

  // La portada grande a veces no está: se cae a la miniatura.
  function coverImg(d) {
    const el = img(d.coverFull || d.cover, { class: "rp-cover", loading: "eager" });
    if (d.coverFull && d.cover && d.cover !== d.coverFull)
      el.addEventListener("error", () => {
        el.classList.remove("img-error");
        el.src = d.cover;
      }, { once: true });
    return el;
  }

  function paintRepack() {
    const L = pages.repack;
    const back = h("button", { class: "rp-back", "data-focus": "", onclick: () => closeRepack() }, icon("back"), "Tienda");
    const d = rp.detail;
    if (!d) {
      L.replaceChildren(
        h("div", { class: "rp-bg" }),
        back,
        rp.error ? h("div", { class: "rp-empty" }, h("h1", null, "No se pudo abrir la ficha"), h("p", null, rp.error)) : h("div", { class: "rp-empty" }, dots()),
      );
      focus.focus(back, { instant: true, silent: true });
      return;
    }
    const r = live(d);
    const bg = d.hero || d.screenshots[0]?.full;
    const main = h("button", { class: "xb-btn green rp-main", "data-focus": "", onclick: () => act(live(rp.detail)) });
    const wish = h("button", { class: "xb-sq rp-wish", "data-focus": "", onclick: () => wishToggle(d, wish).then((on) => wish.isConnected && setWish(wish, on)) });
    setWish(wish, wishes.has(d.slug));
    const sq = (ico, tip, fn) => h("button", { class: "xb-sq", "data-focus": "", "data-tip": tip, "aria-label": tip, onclick: fn }, icon(ico));
    const fact = (k, v) => (v ? h("div", { class: "rp-fact" }, h("small", null, k), h("b", null, v)) : null);
    const shots = d.screenshots.map((s) => s.full);
    const desc = d.description
      ? h(
          "div",
          {
            class: "rp-card rp-desc-card",
            "data-focus": "",
            onclick: (e) => {
              const c = e.currentTarget;
              c.classList.toggle("open");
              c.querySelector(".rp-toggle").textContent = c.classList.contains("open") ? "Mostrar menos" : "Leer más";
            },
          },
          h("h3", null, "Descripción"),
          h("div", { class: "rp-desc" }, d.description),
          h("span", { class: "rp-toggle" }, "Leer más"),
        )
      : null;
    const details = [
      ["Géneros", genres(d, 8).join(", ")],
      ["Compañías", d.companies],
      ["Idiomas", d.languages],
      ["Publicado", date(d.date)],
      ["Versión", d.version],
      ["Repack", d.number ? `#${d.number}` : null],
      ["Tamaño original", sizeText(d.originalSize)],
      ["Descarga", sizeText(d.repackSize)],
      ["En disco", sizeText(d.installSize)],
    ].filter((x) => x[1]);
    L.replaceChildren(
      h("div", { class: "rp-bg", style: bg ? { backgroundImage: `url("${bg}")` } : {} }),
      back,
      h(
        "div",
        { class: "rp-hero" },
        h(
          "div",
          { class: "rp-panel" },
          h(
            "div",
            { class: "rp-id" },
            d.coverFull || d.cover ? coverImg(d) : null,
            h("div", null, h("h1", { class: "rp-title" }, d.title), d.companies ? h("div", { class: "rp-by" }, d.companies) : null),
          ),
          h("div", { class: "rp-chips", "data-focus-group": "rp-chips" }, ...chips(d), d.selective ? h("span", { class: "sel" }, "Descarga selectiva") : null),
          h("div", { class: "rp-facts" }, fact("Descarga", sizeText(d.repackSize)), fact("Instalado", sizeText(d.installSize)), fact("Versión", d.version)),
          h(
            "div",
            { class: "rp-actions", "data-focus-group": "rp-actions" },
            main,
            wish,
            sq("queue", "Administrar cola", () => setView("queue")),
            d.url ? sq("ext", "Ver en FitGirl", () => run(ejg.explore.openPage(d.slug))) : null,
          ),
          h("div", { class: "rp-hint" }),
        ),
      ),
      h(
        "div",
        { class: "rp-more" },
        shots.length
          ? h(
              "section",
              { class: "rp-sec" },
              h("h2", null, "Capturas"),
              h(
                "div",
                { class: "track rp-shots", "data-focus-group": "rp-shots" },
                ...d.screenshots.map((s, k) => h("button", { class: "rp-shot", "data-focus": "", onclick: () => openImage(s.full, shots, k) }, img(s.thumb, { loading: "lazy" }))),
              ),
            )
          : null,
        h(
          "div",
          { class: "rp-cols" },
          h("div", null, desc),
          h(
            "div",
            null,
            h("div", { class: "rp-card", "data-focus": "" }, h("h3", null, "Detalles"), h("dl", { class: "rp-dl" }, ...details.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]))),
            d.features.length ? h("div", { class: "rp-card", "data-focus": "" }, h("h3", null, "Características del repack"), h("ul", { class: "rp-feat" }, ...d.features.map((f) => h("li", null, f)))) : null,
          ),
        ),
        similarSec(d),
      ),
    );
    setMain(main, r);
  }

  /** Géneros de la ficha: los conocidos llevan a Explorar filtrado por ellos. */
  function chips(d) {
    const known = (d.tags || []).map((t) => store.state.genres.find((g) => g.id === t)).filter(Boolean);
    if (!known.length) return genres(d, 5).map((g) => h("span", null, g));
    return known.slice(0, 5).map((g) =>
      h(
        "button",
        {
          class: "rp-chip",
          "data-focus": "",
          onclick: () => {
            closeRepack(true);
            openCatalog({ genres: [g.id] });
          },
        },
        g.name,
      ),
    );
  }

  function similarSec(d) {
    const track = h("div", { class: "track rp-similar", "data-focus-group": "rp-similar" }, dots());
    const sec = h("section", { class: "rp-sec" }, h("h2", null, "Más como este"), track);
    store.similar(d, 16).then((list) => {
      if (rp.slug !== d.slug) return;
      if (!list.length) return sec.remove();
      track.replaceChildren(...list.map(boxTile));
    });
    return sec;
  }

  function refreshRepack() {
    const b = rp.open && rp.detail && pages.repack.querySelector(".rp-main");
    if (!b) return;
    const r = live(rp.detail);
    if (b.__sig !== `${r.status?.state}:${Math.floor((r.status?.progress || 0) * 100)}`) setMain(b, r);
  }

  // ─────────────── panel de descarga ───────────────
  async function openDialog(r) {
    closeDialog();
    const box = h("div", { class: "xd-body" }, dots(), h("p", { class: "xd-wait" }, "Buscando el torrent…"));
    const cancel = h("button", { class: "xb-btn", "data-focus": "", onclick: () => closeDialog() }, "Cancelar");
    const foot = h("div", { class: "xd-foot" }, cancel);
    const layer = h(
      "div",
      { class: "xd-layer", "data-focus-trap": "", onclick: (e) => e.target === layer && closeDialog() },
      h(
        "aside",
        { class: "xd" },
        h("div", { class: "xd-head" }, h("small", null, "Descargar"), h("h2", null, r.title), r.version ? h("span", null, r.version) : null),
        box,
        foot,
      ),
    );
    document.body.append(layer);
    requestAnimationFrame(() => layer.classList.add("in"));
    dialog = { layer, slug: r.slug, prep: null, from: focus.current };
    ejg.sound.play("open");
    focus.focus(cancel, { instant: true, silent: true });
    onChange();
    let prep;
    try {
      prep = await ejg.downloads.prepare(r.slug);
    } catch (e) {
      if (dialog?.slug !== r.slug) return;
      box.replaceChildren(h("p", { class: "xd-err" }, e.message || String(e)));
      return;
    }
    if (dialog?.slug !== r.slug) return;
    dialog.prep = prep;
    const sel = fileSelection(prep);
    let dir = prep.dir ? { path: prep.dir, freeBytes: prep.freeBytes } : null;
    const need = h("b");
    const free = h("b");
    const bar = h("i");
    const pathEl = h("span", { class: "xd-path" });
    const err = h("p", { class: "xd-err" });
    const go = h("button", { class: "xb-btn green", "data-focus": "" });
    const upd = () => {
      need.textContent = bytes(sel.bytes);
      free.textContent = dir?.freeBytes != null ? bytes(dir.freeBytes) : "—";
      bar.style.width = dir?.freeBytes ? `${Math.min(100, (sel.bytes / dir.freeBytes) * 100)}%` : "0";
      pathEl.textContent = dir?.path || "Elige una carpeta";
      const problem = !dir ? "Elige dónde guardar la descarga" : sel.error || (!sel.fits(dir.freeBytes) ? "No hay espacio suficiente en ese disco" : "");
      err.textContent = problem;
      go.disabled = !!problem;
      go.replaceChildren(icon("download"), `Descargar · ${bytes(sel.bytes)}`);
    };
    const check = (f) =>
      h(
        "button",
        {
          class: "xd-chk" + (sel.isSelected(f.index) ? " on" : ""),
          "data-focus": "",
          role: "checkbox",
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
    const base = sel.required.reduce((a, f) => a + f.size, 0);
    const groups = [
      ["Idiomas", sel.languages],
      ["Contenido opcional", sel.optional],
    ].filter(([, l]) => l.length);
    box.replaceChildren(
      h(
        "div",
        null,
        h("section", { class: "xd-sec" }, h("h3", null, "Juego"), h("div", { class: "xd-chk on locked" }, h("i"), h("span", null, "Juego base (obligatorio)"), h("small", null, bytes(base)))),
        ...groups.map(([t, list]) => h("section", { class: "xd-sec" }, h("h3", null, t), h("div", { class: "xd-list", "data-focus-group": "xd-" + t }, ...list.map(check)))),
        groups.length ? h("p", { class: "xd-note" }, icon("info"), "En el instalador, desmarca lo que no hayas descargado.") : null,
        h(
          "section",
          { class: "xd-sec" },
          h("h3", null, "Guardar en"),
          h(
            "div",
            { class: "xd-loc" },
            icon("disk"),
            pathEl,
            h(
              "button",
              {
                class: "xb-btn",
                "data-focus": "",
                onclick: async () => {
                  const p = await ejg.downloads.pickFolder(dir?.path).catch(() => null);
                  if (p) {
                    dir = p;
                    upd();
                  }
                },
              },
              "Cambiar…",
            ),
          ),
        ),
        prep.installSize
          ? h("p", { class: "xd-note" }, icon("install"), `El juego instalado ocupará ${sizeText(prep.installSize)}${prep.installFreeBytes != null ? ` (quedan ${bytes(prep.installFreeBytes)} en ${prep.installDir})` : ""}.`)
          : null,
      ),
    );
    go.onclick = async () => {
      go.disabled = true;
      go.textContent = "Añadiendo a la cola…";
      try {
        await ejg.downloads.start(prep.token, sel.indices(), dir.path);
        closeDialog(true);
        ejg.ui.toast(`«${r.title}» se ha añadido a la cola`, "ok");
        store.refresh();
        refreshRepack();
        refreshTiles();
      } catch (e) {
        upd();
        err.textContent = e.message || String(e);
      }
    };
    // Espacio y errores, siempre a la vista junto al botón.
    foot.replaceChildren(
      h("div", { class: "xd-space" }, h("div", { class: "xd-nums" }, h("span", null, "Necesario", need), h("span", null, "Disponible", free)), h("div", { class: "xd-bar" }, bar)),
      err,
      go,
      cancel,
    );
    upd();
    focus.focus(go.disabled ? box.querySelector("[data-focus]") || cancel : go, { instant: true, silent: true });
  }

  function closeDialog(done) {
    if (!dialog) return false;
    if (!dialog.prep && !done) ejg.downloads.cancelPrepare(dialog.slug).catch(() => {});
    const { layer, from } = dialog;
    dialog = null;
    layer.remove();
    if (from?.isConnected) focus.focus(from, { silent: true, noScroll: true });
    else focus.first(rp.open ? pages.repack : view === "queue" ? pages.queue : body);
    onChange();
    return true;
  }

  /** Pregunta al estilo Xbox: true, false o null (Volver). */
  function ask(title, text, yes, no) {
    return new Promise((resolve) => {
      const prev = focus.current;
      const done = (v) => {
        layer.remove();
        askOpen = null;
        if (prev?.isConnected) focus.focus(prev, { silent: true, noScroll: true });
        else focus.first(view === "queue" ? pages.queue : body);
        onChange();
        resolve(v);
      };
      const bYes = h("button", { class: "xb-btn", "data-focus": "", onclick: () => done(true) }, yes);
      const layer = h(
        "div",
        { class: "xa-layer", "data-focus-trap": "" },
        h(
          "div",
          { class: "xa" },
          h("h2", null, title),
          h("p", null, text),
          h("div", { class: "xa-btns" }, bYes, h("button", { class: "xb-btn", "data-focus": "", onclick: () => done(false) }, no), h("button", { class: "xb-btn", "data-focus": "", onclick: () => done(null) }, "Volver")),
        ),
      );
      document.body.append(layer);
      askOpen = () => done(null);
      ejg.sound.play("open");
      focus.focus(bYes, { instant: true, silent: true });
      onChange();
    });
  }

  // ─────────────── administrar cola ───────────────
  const rows = new Map();

  function queueRow(d) {
    const title = h("b");
    const pct = h("span", { class: "q-pct" });
    const bar = h("i");
    const sub = h("span", { class: "q-sub" });
    const meta = h("span", { class: "q-meta" });
    const acts = h("div", { class: "q-acts" });
    const el = h(
      "div",
      { class: "q-row", "data-dl": d.id },
      h("div", { class: "q-ico" }, d.cover || d.hero ? img(d.cover || d.hero, { loading: "lazy" }) : null),
      h("div", { class: "q-main" }, title, pct, h("div", { class: "q-bar" }, bar), sub, meta),
      acts,
    );
    let sig = "";
    const update = (d) => {
      const going = d.state === "downloading";
      title.textContent = d.title;
      pct.textContent = d.state === "installed" ? "" : percent(d.progress);
      bar.style.width = `${Math.round(d.progress * 1000) / 10}%`;
      el.classList.toggle("idle", !going && d.state !== "installing");
      el.classList.toggle("bad", d.state === "error");
      el.classList.toggle("done", d.state === "installed");
      sub.textContent = downloadLabel(d);
      meta.textContent =
        d.state === "installed"
          ? d.filesDeleted
            ? "Repack borrado"
            : `${bytes(d.totalBytes)} en disco`
          : [`${bytes(d.doneBytes)} de ${bytes(d.totalBytes)}`, going && d.eta ? `quedan ${eta(d.eta)}` : "", going && d.peers ? `${d.peers} fuentes` : ""].filter(Boolean).join("  •  ");
      // Botones solo si cambian (para no perder el foco).
      const s = `${d.state}|${d.pauseReason}|${d.filesDeleted}|${d.gameId}`;
      if (s === sig) return;
      sig = s;
      const text = (slot, ico, label, fn, cls = "") => h("button", { class: "xb-btn " + cls, "data-focus": "", "data-slot": slot, onclick: fn }, icon(ico), label);
      const sq = (slot, ico, tip, fn) => h("button", { class: "q-sq", "data-focus": "", "data-slot": slot, "data-tip": tip, "aria-label": tip, onclick: fn }, icon(ico));
      let first = null;
      if (canInstall(d)) first = text("main", "install", "Instalar", () => run(ejg.downloads.install(d.id)), "green");
      else if (d.pauseReason === "needs-folder") first = text("main", "folder", "Elegir carpeta", () => run(ejg.downloads.locate(d.id)), "green");
      else if (d.state === "installed" && d.gameId) first = text("main", "play", "Jugar", () => run(ejg.game.launch(d.gameId)), "green");
      else if (isActive(d)) first = text("main", "pause", "Pausar", () => run(ejg.downloads.pause(d.id)));
      else if (d.state === "paused") first = text("main", "play", "Reanudar", () => run(ejg.downloads.resume(d.id)));
      else if (d.state === "error") first = text("main", "retry", "Reintentar", () => run(ejg.downloads.resume(d.id)));
      const list = [
        first || h("span"),
        d.state === "queued" ? sq("top", "top", "Descargar primero", () => run(ejg.downloads.move(d.id, 0))) : h("span"),
        !(d.state === "installed" && d.filesDeleted) ? sq("folder", "folder", "Abrir carpeta", () => run(ejg.downloads.openFolder(d.id))) : h("span"),
        d.state !== "installing"
          ? sq("remove", "x", d.state === "installed" ? "Quitar de la lista" : canInstall(d) ? "Quitar" : "Cancelar descarga", async () => {
              if (d.filesDeleted) return run(ejg.downloads.remove(d.id, false));
              const keepGame = d.state === "installed";
              const files = await ask(
                keepGame || canInstall(d) ? "¿Quitar de la cola?" : "¿Cancelar la descarga?",
                keepGame ? `¿Borrar también el repack de «${d.title}»? El juego instalado no se toca.` : `¿Borrar también lo descargado de «${d.title}» (${bytes(d.doneBytes)})?`,
                "Borrar archivos",
                "Conservarlos",
              );
              if (files != null) run(ejg.downloads.remove(d.id, files));
            })
          : h("span"),
      ];
      const had = acts.contains(focus.current) ? focus.current.dataset.slot : null;
      acts.replaceChildren(...list);
      if (had) focus.focus(acts.querySelector(`[data-slot="${had}"]`) || acts.querySelector("[data-focus]") || el, { silent: true, noScroll: true });
    };
    update(d);
    return { el, update };
  }

  const totalSpeed = () => ejg.downloads.all.filter((d) => d.state === "downloading").reduce((a, d) => a + d.downBps, 0);

  function queuePage() {
    const all = ejg.downloads.all;
    const groups = [
      ["Descargando", all.filter((d) => d.state === "downloading" || d.state === "installing"), "q-now"],
      ["En cola", all.filter((d) => d.state === "queued" || d.state === "paused" || d.state === "error"), "q-up"],
      ["Listos para instalar", all.filter((d) => d.state === "seeding" || d.state === "completed"), "q-ready"],
      ["Instalados", all.filter((d) => d.state === "installed"), "q-done"],
    ];
    rows.clear();
    const btn = (label, ico, fn) => h("button", { class: "xb-btn", "data-focus": "", "data-slot": "all-" + ico, onclick: fn }, icon(ico), label);
    const pend = all.filter((d) => d.state !== "installed").length;
    const head = h(
      "div",
      { class: "q-head", "data-focus-group": "q-head" },
      h("div", null, h("h1", null, "Administrar cola"), h("p", null, pend ? `${pend} ${pend === 1 ? "elemento pendiente" : "elementos pendientes"}` : "No hay nada pendiente")),
      all.some((d) => d.state === "downloading") ? h("div", { class: "q-rate" }, h("small", null, "Velocidad"), h("b", { id: "q-rate" }, speed(totalSpeed()))) : h("div", { class: "q-rate" }),
      all.some(isActive) ? btn("Pausar todo", "pause", () => run(ejg.downloads.pause())) : null,
      all.some((d) => d.state === "paused") ? btn("Reanudar todo", "play", () => run(ejg.downloads.resume())) : null,
    );
    const sections = groups
      .filter(([, list]) => list.length)
      .map(([label, list, id]) => {
        const box = h("div", { class: "q-list", "data-focus-group": id });
        for (const d of list) {
          const r = queueRow(d);
          rows.set(d.id, r);
          box.append(r.el);
        }
        return h("section", { class: "q-sec" }, h("h2", null, label, h("span", null, String(list.length))), box);
      });
    return h(
      "div",
      { class: "q-page" },
      head,
      ...sections,
      !all.length
        ? h(
            "div",
            { class: "q-empty" },
            icon("queue"),
            h("h2", null, "La cola está vacía"),
            h("p", null, "Busca un juego en la Tienda y pulsa Descargar."),
            ejg.explore.enabled ? h("button", { class: "xb-btn green", "data-focus": "", onclick: () => setView("store") }, "Ir a la Tienda") : null,
          )
        : null,
    );
  }

  let qSig = "";
  const listSig = () => ejg.downloads.all.map((d) => `${d.id}:${d.state}:${d.state === "downloading" ? "" : d.pauseReason}`).join(",");

  function paintQueue(keep = true) {
    if (view !== "queue") return;
    const prev = keep ? focus.current : null;
    const inQ = !!prev && pages.queue.contains(prev);
    const dl = inQ && prev.closest("[data-dl]")?.dataset.dl;
    const slot = inQ && prev.dataset.slot;
    qSig = listSig();
    pages.queue.replaceChildren(queuePage());
    if (inQ && !prev.isConnected) {
      const again =
        (dl && (pages.queue.querySelector(`[data-dl="${dl}"] [data-slot="${slot}"]`) || pages.queue.querySelector(`[data-dl="${dl}"] [data-focus]`))) ||
        (slot && pages.queue.querySelector(`.q-head [data-slot="${slot}"]`));
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else focus.first(pages.queue.querySelector(".q-sec") || pages.queue);
    }
  }

  ejg.downloads.onChange(() => {
    const pend = ejg.downloads.all.filter((d) => d.state !== "installed").length;
    qCount.textContent = pend ? String(pend) : "";
    if (view === "queue") {
      // Si solo cambió el progreso, se actualiza en su sitio (sin perder el foco).
      if (listSig() !== qSig) paintQueue();
      else {
        for (const d of ejg.downloads.all) rows.get(d.id)?.update(d);
        const r = document.getElementById("q-rate");
        if (r) r.textContent = speed(totalSpeed());
      }
    } else if (view === "store") refreshTiles();
    refreshRepack();
  });
  qCount.textContent = String(ejg.downloads.all.filter((d) => d.state !== "installed").length || "");

  // Lista de deseos (cambia desde aquí, otro tema o el host): contador, corazones,
  // botón de la ficha y la propia lista. Con la ficha abierta, la lista espera a cerrarla.
  ejg.explore.wishlist.onChange(() => {
    wishes = new Set(ejg.explore.wishlist.items.map((w) => w.slug));
    paintWishCount();
    refreshHearts();
    refreshWish();
    if (view === "store" && st.name === "wish" && !rp.open && wishSigOf() !== wishSig) paintBody();
  });

  // ─────────────── vistas ───────────────
  function closeOverlays() {
    closeFlyout(true);
    if (askOpen) askOpen();
    closeDialog();
    closeRepack(true);
  }

  async function search() {
    if (view !== "store" || rp.open || dialog || askOpen) return false;
    const q = await askQuery(ejg, store.state.query);
    if (q == null) {
      if (ejg.input.source !== "gamepad") {
        focus.focus(input);
        input.focus();
      }
      return true;
    }
    input.value = q.trim();
    st.name = q.trim() ? "search" : "front";
    st.focusResults = !!q.trim();
    store.search(q, 0);
    onChange();
    return true;
  }

  return {
    /** Muestra la tienda o la cola (lo llama setView del tema). */
    show(v) {
      closeOverlays();
      view = v;
      if (v === "queue") {
        paintQueue(false);
        focus.first(pages.queue.querySelector(".q-sec") || pages.queue);
        return;
      }
      store.loadHome();
      store.loadGenres();
      paintBody(false);
      pages.store.scrollTop = 0;
      if (!focus.first(body)) {
        st.autoFocus = true;
        focus.first(head);
      }
    },
    /** Se deja de ver: fuera temporizadores y capas. */
    hide() {
      closeOverlays();
      stopSpot();
      view = null;
    },
    /** Foco nuevo (onChange de createFocus): con mando, la miniatura enfocada pasa al «spotlight». */
    focused(el, info) {
      if (info.pointer || !el.dataset.spot || !spot.set) return;
      const k = Number(el.dataset.spot);
      if (k !== spot.i) spot.set(k);
    },
    openRepack,
    closeOverlays,
    search,
    back() {
      if (closeFlyout()) return true;
      if (askOpen) return askOpen(), true;
      if (closeDialog()) return true;
      if (closeRepack()) return true;
      if (view === "store" && st.name !== "front") return goFront(), true;
      return false;
    },
    /** Hay una capa encima (diálogo o ficha): LB/RB no cambian de sección. */
    busy: () => !!dialog || !!askOpen || !!flyout || rp.open,
    hints() {
      if (flyout) return [["accept", flyout.kind === "genre" ? "Marcar" : "Elegir"], ["back", "Cerrar"]];
      if (askOpen) return [["accept", "Elegir"], ["back", "Volver"]];
      if (dialog) return [["accept", "Marcar"], ["back", "Cancelar"]];
      if (rp.open) return [["accept", "Elegir"], ["back", "Volver"]];
      if (view === "store") return [["accept", "Seleccionar"], ["y", "Buscar"], ["back", st.name === "front" ? "Inicio" : "Volver"], ["lb", "Secciones"], ["menu", "Menú"]];
      if (view === "queue") return [["accept", "Elegir"], ["back", "Volver"], ["lb", "Secciones"], ["menu", "Menú"]];
      return null;
    },
  };
}
