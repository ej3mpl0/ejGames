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
};
const icon = (n) => h("span", { class: "ico", html: I[n] });

export function createStore({ ejg, main, focus, openGame, goTab, onChange }) {
  const store = createExplore(ejg, () => {
    if (active() === "store" && view.name !== "detail") paint();
  });
  const view = { name: "front", slug: null, detail: null, detailError: "", scroll: 0 };
  let tabRef = () => "home";
  let carousel = { i: 0, timer: 0 };
  let dialog = null;
  const active = () => tabRef();

  // ─────────────── piezas ───────────────
  const cover = (r, cls = "") =>
    h("div", { class: "cap-art " + cls }, r.cover ? img(r.cover, { loading: "lazy" }) : h("div", { class: "cap-ph" }, r.title));

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

  function capsule(r) {
    return h(
      "button",
      { class: "capsule", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug), title: r.title },
      cover(r),
      h("div", { class: "cap-info" }, h("b", null, r.title), h("span", null, sizeText(r.repackSize) || "—"), badge(r)),
    );
  }

  function listRow(r) {
    return h(
      "button",
      { class: "srow", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug) },
      cover(r, "small"),
      h("div", { class: "srow-main" }, h("b", null, r.title), h("span", null, [r.version, r.genres.slice(0, 4).map(genreLabel).join(", ")].filter(Boolean).join(" · "))),
      h("span", { class: "srow-date" }, date(r.date)),
      h("span", { class: "srow-size" }, badge(r) || sizeText(r.repackSize)),
    );
  }

  // ─────────────── portada ───────────────
  function storeNav() {
    const input = h("input", {
      placeholder: "buscar en la tienda",
      value: store.state.query,
      spellcheck: "false",
      "data-focus": "",
      oninput: debounce((e) => {
        view.name = e.target.value.trim() ? "search" : "front";
        store.search(e.target.value);
      }, 50),
      onkeydown: (e) => {
        if (e.key === "Escape") {
          e.target.value = "";
          view.name = "front";
          store.search("");
          e.target.blur();
        }
      },
    });
    return h(
      "div",
      { class: "store-nav" },
      h(
        "div",
        { class: "sn-links" },
        h("button", { class: "sn-link" + (view.name === "front" ? " on" : ""), "data-focus": "", onclick: () => ((view.name = "front"), store.search(""), paint()) }, "Destacados"),
        h("button", { class: "sn-link" + (view.name === "latest" ? " on" : ""), "data-focus": "", onclick: () => browseLatest() }, "Novedades"),
        h("button", { class: "sn-link", "data-focus": "", onclick: () => goTab("downloads") }, "Descargas"),
      ),
      h("label", { class: "sn-search" }, input, icon("search")),
    );
  }

  // «Novedades»: la búsqueda sin texto devuelve lo último publicado.
  let latestPage = null;
  async function browseLatest(page = 1) {
    view.name = "latest";
    paint();
    try {
      const r = await ejg.explore.search("", page);
      latestPage = page > 1 && latestPage ? { ...r, items: latestPage.items.concat(r.items) } : r;
    } catch (e) {
      latestPage = { items: [], page: 1, pages: 1, error: e.message || String(e) };
    }
    if (view.name === "latest") paint();
  }

  function heroCarousel(items) {
    const list = items.filter((r) => r.hero).slice(0, 10);
    if (!list.length) return null;
    const i = carousel.i % list.length;
    const r = list[i];
    const main = h(
      "button",
      { class: "car-main", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug) },
      h("div", { class: "car-img" }, img(r.hero, { loading: "eager" })),
      h(
        "div",
        { class: "car-side" },
        h("h3", null, r.title),
        r.version ? h("div", { class: "car-ver" }, r.version) : null,
        h("div", { class: "car-cover" }, r.coverFull || r.cover ? img(r.coverFull || r.cover) : null),
        h("div", { class: "car-status" }, "Popular hoy"),
        h("div", { class: "car-tags" }, ...r.genres.slice(0, 4).map((g) => h("span", null, genreLabel(g)))),
        h("div", { class: "car-price" }, badge(r) || h("span", null, sizeText(r.repackSize) || "")),
      ),
    );
    const step = (d) => {
      carousel.i = (i + d + list.length) % list.length;
      restartCarousel();
      paint(true);
    };
    return h(
      "section",
      { class: "carousel", "data-focus-group": "carousel" },
      h("h2", { class: "store-h" }, "Destacados y recomendados"),
      h(
        "div",
        { class: "car-wrap" },
        h("button", { class: "car-arrow", "data-focus": "", onclick: () => step(-1), "aria-label": "Anterior" }, icon("left")),
        main,
        h("button", { class: "car-arrow", "data-focus": "", onclick: () => step(1), "aria-label": "Siguiente" }, icon("right")),
      ),
      h("div", { class: "car-dots" }, ...list.map((_, k) => h("i", { class: k === i ? "on" : "" }))),
    );
  }

  function restartCarousel() {
    clearInterval(carousel.timer);
    carousel.timer = setInterval(() => {
      // Solo si se ve la portada y no se está usando el carrusel.
      if (active() !== "store" || view.name !== "front" || document.hidden) return;
      if (focus.current?.closest(".carousel")) return;
      carousel.i++;
      paint(true);
    }, 8000);
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
    for (const id of ["week", "month"]) {
      const sec = byId[id];
      if (!sec) continue;
      const row = h("div", { class: "cap-row", "data-focus-group": `row-${id}` });
      keyed(row, sec.items, (r) => r.slug, (r) => capsule(r));
      out.push(h("section", null, h("h2", { class: "store-h" }, sec.title), row));
    }
    if (byId.latest) {
      const list = h("div", { class: "srows", "data-focus-group": "latest" });
      keyed(list, byId.latest.items.slice(0, 12), (r) => r.slug, (r) => listRow(r));
      out.push(
        h(
          "section",
          null,
          h("div", { class: "store-h-row" }, h("h2", { class: "store-h" }, "Novedades"), h("button", { class: "btn-text", "data-focus": "", onclick: () => browseLatest() }, "Ver más")),
          list,
        ),
      );
    }
    return h("div", { class: "store-front" }, ...out.filter(Boolean));
  }

  function results() {
    const s = view.name === "latest" ? { ...(latestPage || { items: [] }), searching: !latestPage, query: "" } : store.state;
    const title = view.name === "latest" ? "Novedades" : s.query ? `Resultados de «${s.query}»` : "Buscar";
    const list = h("div", { class: "srows", "data-focus-group": "results" });
    keyed(list, s.results ?? s.items ?? [], (r) => r.slug, (r) => listRow(r));
    const items = s.results ?? s.items ?? [];
    const more = s.page < s.pages;
    return h(
      "div",
      { class: "store-results" },
      h("div", { class: "store-h-row" }, h("h2", { class: "store-h" }, title), s.total ? h("span", { class: "muted" }, `${s.total} resultados`) : null),
      s.searchError || s.error ? h("p", { class: "err" }, s.searchError || s.error) : null,
      !items.length && !(s.searching) && !(s.searchError || s.error) ? h("p", { class: "muted pad" }, "No hay nada con ese nombre.") : null,
      list,
      s.searching ? h("div", { class: "spinner" }) : null,
      more && !s.searching
        ? h("button", { class: "btn-blue more-btn", "data-focus": "", onclick: () => (view.name === "latest" ? browseLatest(s.page + 1) : store.more()) }, "Ver más resultados")
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
    const info = [
      ["Géneros", d.genres.map(genreLabel).join(", ")],
      ["Compañías", d.companies],
      ["Idiomas", d.languages],
      ["Publicado", date(d.date)],
      ["Repack", d.number ? `#${d.number}` : null],
    ].filter((r) => r[1]);
    const doAction = () => {
      if (act.id === "download") return openDialog(d);
      if (act.id === "install" && d.status.downloadId) return ejg.downloads.install(d.status.downloadId).catch((e) => ejg.ui.toast(e.message, "error"));
      if (act.id === "play" && d.status.gameId) return ejg.game.launch(d.status.gameId).catch((e) => ejg.ui.toast(e.message, "error"));
      goTab("downloads");
    };
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
          h("button", { class: "btn-text", "data-focus": "", onclick: back }, "Tienda"),
          h("span", null, " › "),
          h("span", null, d.genres[0] ? genreLabel(d.genres[0]) : "Juegos"),
          h("span", null, " › "),
          h("span", null, d.title),
        ),
        h("h1", { class: "app-title" }, d.title),
        h(
          "div",
          { class: "app-top" },
          h("div", { class: "pv" }, big, strip),
          h(
            "div",
            { class: "app-side" },
            h("div", { class: "app-cap" }, d.coverFull || d.cover ? img(d.coverFull || d.cover) : null),
            h("p", { class: "app-short" }, d.version ? `Versión ${d.version}` : "", d.selective ? h("span", { class: "sel" }, "Descarga selectiva") : null),
            ...info.map(([k, v]) => h("div", { class: "app-row" }, h("span", null, k + ":"), h("span", null, v))),
            h(
              "div",
              { class: "app-tags" },
              ...d.genres.slice(0, 6).map((g) => h("span", null, genreLabel(g))),
            ),
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
              h("h2", null, act.id === "play" ? `Jugar a ${d.title}` : `Descargar ${d.title}`),
              h(
                "div",
                { class: "buy-line" },
                h("span", { class: "buy-meta" }, [sizeText(d.repackSize) && `Descarga ${sizeText(d.repackSize)}`, d.installSize && `Instalado ${sizeText(d.installSize)}`].filter(Boolean).join(" · ")),
                h(
                  "div",
                  { class: "buy-box" },
                  act.hint ? h("span", { class: "buy-hint" }, act.hint) : null,
                  h("button", { class: "buy-btn" + (act.id === "downloads" ? " blue" : ""), "data-focus": "", onclick: doAction }, act.label),
                ),
              ),
            ),
            d.description ? h("div", { class: "app-sec" }, h("h3", null, "Acerca de este juego"), h("div", { class: "app-desc" }, d.description)) : null,
            d.features.length
              ? h("div", { class: "app-sec" }, h("h3", null, "Características del repack"), h("ul", { class: "feat" }, ...d.features.map((f) => h("li", null, f))))
              : null,
          ),
          h(
            "div",
            null,
            h(
              "div",
              { class: "side-box" },
              h("h4", null, "Tamaño"),
              h("div", { class: "app-row" }, h("span", null, "Original:"), h("span", null, sizeText(d.originalSize) || "—")),
              h("div", { class: "app-row" }, h("span", null, "Descarga:"), h("span", null, sizeText(d.repackSize) || "—")),
              h("div", { class: "app-row" }, h("span", null, "En disco:"), h("span", null, sizeText(d.installSize) || "—")),
            ),
            d.url
              ? h("button", { class: "side-link", "data-focus": "", onclick: () => ejg.explore.openPage(d.slug) }, icon("ext"), "Ver la ficha en FitGirl")
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
      groups.length ? h("p", { class: "muted small" }, "En el instalador, desmarca lo que no hayas descargado.") : null,
      prep.installSize ? h("p", { class: "muted small" }, `El juego instalado ocupará ${sizeText(prep.installSize)}${prep.installFreeBytes != null ? ` (quedan ${bytes(prep.installFreeBytes)} en ${prep.installDir})` : ""}.`) : null,
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
      h("div", { class: "dl-cap" }, d.hero || d.cover ? img(d.hero || d.cover, { loading: "lazy" }) : null),
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
            h("div", { class: "dl-now-img", style: current.hero ? { backgroundImage: `url("${current.hero}")` } : {} }),
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
      const content = view.name === "detail" ? detailPage() : view.name === "front" ? front() : results();
      main.replaceChildren(h("div", { class: "store" }, view.name === "detail" ? null : storeNav(), content));
    }
    if (keepFocus && prevFocus && !prevFocus.isConnected) {
      const again =
        (slug && main.querySelector(`[data-slug="${slug}"]`)) || (dl && main.querySelector(`[data-dl="${dl}"] [data-focus]`)) || null;
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else focus.first(main);
    }
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
      view.name = "front";
      store.search("");
      paint();
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
    /** Y en la tienda: buscar (teclado en pantalla con mando). */
    async search() {
      const q = await askQuery(ejg, store.state.query);
      if (q == null) {
        const input = main.querySelector(".sn-search input");
        if (input) (focus.focus(input), input.focus());
        return;
      }
      view.name = q.trim() ? "search" : "front";
      store.search(q, 0);
      paint();
    },
    hasDialog: () => !!dialog || !!askOpen,
  };
}
