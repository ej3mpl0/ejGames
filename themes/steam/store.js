// Tienda y Descargas del tema Steam: portada con destacados, búsqueda, página
// de producto con su caja de compra, diálogo «Instalar» y el gestor de
// descargas con la gráfica de red. La lógica común está en /_sdk/kit/store.js.

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
};
const icon = (n) => h("span", { class: "ico", html: I[n] });

export function createStore({ ejg, main, focus, openGame, goTab, onChange, onNavigate = () => {} }) {
  const store = createExplore(ejg, () => {
    if (active() === "store" && view.name !== "detail") paint(true);
  });
  const view = { name: "front", slug: null, detail: null, detailError: "", scroll: 0 };
  let tabRef = () => "library";
  let carousel = { i: 0, timer: 0 };
  let dialog = null;
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
    if (!s || s === "none") return null;
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
          view.name = e.target.value.trim() ? "search" : "front";
          store.search(e.target.value);
          if (view.name === "front") paint();
        }, 50),
        onkeydown: (e) => {
          if (e.key === "Enter") {
            view.name = e.target.value.trim() ? "search" : "front";
            store.search(e.target.value, 0);
            paint();
          }
          if (e.key === "Escape") {
            e.target.value = "";
            view.name = "front";
            store.search("");
            e.target.blur();
            paint();
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
          link("latest", "Novedades", () => browse("latest")),
          link("week", "Populares", () => browse("week")),
          link("month", "Top del mes", () => browse("month")),
        ),
        h("label", { class: "sn-search" }, navInput, h("span", { class: "sn-go", html: I.search, onclick: () => (view.name = navInput.value.trim() ? "search" : "front", store.search(navInput.value, 0), paint()) })),
      );
      content = h("div", { class: "store-content" });
      shell = h("div", { class: "store" }, h("div", { class: "store-top" }, nav), content);
    }
    if (main.firstChild !== shell || main.childNodes.length !== 1) main.replaceChildren(shell);
    const on = view.name === "detail" ? view.prev : view.name === "list" ? view.list : view.name;
    for (const [id, el] of Object.entries(links)) el.classList.toggle("on", id === on);
    if (document.activeElement !== navInput) navInput.value = view.name === "search" ? store.state.query : "";
  }

  function goFront() {
    view.name = "front";
    navInput.value = "";
    store.search("");
    paint();
    main.scrollTop = 0;
  }

  // «Novedades» (la búsqueda sin texto) y las listas completas de populares.
  let latestPage = null;
  async function browse(list, page = 1) {
    view.name = "list";
    view.list = list;
    paint();
    main.scrollTop = 0;
    if (list !== "latest") return;
    try {
      const r = await ejg.explore.search("", page);
      latestPage = page > 1 && latestPage ? { ...r, items: latestPage.items.concat(r.items) } : r;
    } catch (e) {
      latestPage = { items: [], page: 1, pages: 1, error: e.message || String(e) };
    }
    if (view.name === "list" && view.list === "latest") paint(true);
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
  function pagedRow(id, title, items, per = 4) {
    const total = Math.max(1, Math.ceil(items.length / per));
    let p = Math.min(pages.get(id) || 0, total - 1);
    const box = h("div", { class: "pg-items", "data-focus-group": `pg-${id}` });
    const dots = h("div", { class: "car-dots" });
    const show = () => {
      box.replaceChildren(...items.slice(p * per, p * per + per).map(bigCap));
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
      h("div", { class: "store-h-row" }, h("h2", { class: "store-h" }, title), h("button", { class: "btn-more", "data-focus": "", onclick: () => browse(id) }, "Ver más")),
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
        h("button", { class: "btn-more", "data-focus": "", onclick: () => browse(tabSel) }, "Ver más"),
      ),
      h("div", { class: "tab-body" }, rows, preview),
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
    const home = store.state.home;
    const sec = view.name === "list" && view.list !== "latest" ? home?.sections.find((x) => x.id === view.list) : null;
    const s =
      view.name === "list"
        ? sec
          ? { items: sec.items, page: 1, pages: 1, total: sec.items.length }
          : { ...(latestPage || { items: [] }), searching: !latestPage, query: "" }
        : store.state;
    const title = view.name === "list" ? (sec ? sec.title : "Novedades") : s.query ? `Resultados de «${s.query}»` : "Buscar";
    const items = s.results ?? s.items ?? [];
    const list = h("div", { class: "srows", "data-focus-group": "results" });
    keyed(list, items, (r) => r.slug, (r) => resultRow(r));
    const more = s.page < s.pages;
    return h(
      "div",
      { class: "store-results" },
      h("div", { class: "store-h-row" }, h("h2", { class: "store-h" }, title), s.total ? h("span", { class: "muted" }, `${s.total} resultados`) : null),
      h("div", { class: "srow-head" }, h("span", null, "Nombre"), h("span", null, "Publicado"), h("span", null, "Descarga")),
      s.searchError || s.error ? h("p", { class: "err" }, s.searchError || s.error) : null,
      !items.length && !s.searching && !(s.searchError || s.error) ? h("p", { class: "muted pad" }, "No hay nada con ese nombre.") : null,
      list,
      s.searching ? h("div", { class: "spinner" }) : null,
      more && !s.searching
        ? h("button", { class: "btn-blue more-btn", "data-focus": "", onclick: () => (view.name === "list" ? browse("latest", s.page + 1) : store.more()) }, "Ver más resultados")
        : null,
    );
  }

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
    const doAction = () => {
      if (act.id === "download") return openDialog(d);
      if (act.id === "install" && d.status.downloadId) return ejg.downloads.install(d.status.downloadId).catch((e) => ejg.ui.toast(e.message, "error"));
      if (act.id === "play" && d.status.gameId) return ejg.game.launch(d.status.gameId).catch((e) => ejg.ui.toast(e.message, "error"));
      goTab("downloads");
    };
    const glance = [
      ["Publicado", date(d.date)],
      ["Compañías", d.companies],
      ["Repack", d.number ? `#${d.number}` : null],
    ].filter((r) => r[1]);
    const langs = (d.languages || "")
      .split(/[,/]/)
      .map((x) => x.trim())
      .filter(Boolean);
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
          h("button", { class: "crumb", "data-focus": "", onclick: back }, "Todos los juegos"),
          h("span", null, " > "),
          h("span", null, d.genres[0] ? genreLabel(d.genres[0]) : "Juegos"),
          h("span", null, " > "),
          h("span", null, d.title),
        ),
        h("div", { class: "app-head" }, h("h1", { class: "app-title" }, d.title), d.url ? h("button", { class: "btn-steam-sm", "data-focus": "", onclick: () => ejg.explore.openPage(d.slug) }, "Ver la ficha en FitGirl") : null),
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
            h("div", { class: "app-tags" }, ...d.genres.slice(0, 8).map((g) => h("span", null, genreLabel(g)))),
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

  // ─────────────── pintar ───────────────
  function paint(keepFocus = false) {
    const tab = active();
    const prevFocus = keepFocus ? focus.current : null;
    const slug = prevFocus?.closest?.("[data-slug]")?.dataset.slug;
    const dl = prevFocus?.closest?.("[data-dl]")?.dataset.dl;
    if (tab === "downloads") {
      dlSig = listSig();
      main.replaceChildren(downloadsPage());
    } else {
      ensureShell();
      content.replaceChildren(view.name === "detail" ? detailPage() : view.name === "front" ? front() : results());
    }
    if (keepFocus && prevFocus && !prevFocus.isConnected) {
      const again =
        (slug && main.querySelector(`[data-slug="${slug}"]`)) || (dl && main.querySelector(`[data-dl="${dl}"] [data-focus]`)) || null;
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else focus.first(main);
    }
    onNavigate();
  }

  function back() {
    if (askOpen) return askOpen(), true;
    if (closeDialog()) return true;
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
      const q = await askQuery(ejg, store.state.query);
      if (q == null) {
        ensureShell();
        focus.focus(navInput);
        navInput.focus();
        return;
      }
      view.name = q.trim() ? "search" : "front";
      store.search(q, 0);
      paint();
    },
    hasDialog: () => !!dialog || !!askOpen,
  };
}
