// PlayStation Store y Descargas del tema PS5: portada con el fondo del juego
// enfocado, búsqueda, ficha, diálogo de descarga y la lista de descargas.
// La lógica común está en /_sdk/kit/store.js.

import { h, img, keyed } from "/_sdk/kit/dom.js";
import { date } from "/_sdk/kit/format.js";
import { createExplore, fileSelection, bytes, speed, eta, percent, sizeText, downloadLabel, canInstall, isActive, repackAction, askQuery, genreLabel } from "/_sdk/kit/store.js";

const I = {
  search: '<svg viewBox="0 0 24 24"><path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8.5 5v14M15.5 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  disk: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h.01M11 15h6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
const icon = (n) => h("span", { class: "si", html: I[n] });
const spinner = () => h("div", { class: "ps-spin" });
// Estados de una descarga que aún no ha terminado (pendientes).
const DL = new Set(["queued", "downloading", "paused", "seeding", "completed", "installing", "error"]);

export function createStore({ ejg, root, layer, focus, bg, openViewer, setTab, focusView, onChange, onView }) {
  const store = createExplore(ejg, () => onState());
  const view = { name: "front", slug: null, detail: null, error: "", prev: "front", scroll: 0, from: null };
  const bySlug = new Map();
  const secTitle = {};
  let shown = false;
  let panel = false;
  let panelPrev = null;
  let frontEl = null;
  let frontFor = null;
  let frontFocus = null;
  let info = null;
  let infoSlug = null;
  let wantFocus = false;
  let bgTimer = 0;
  let dialog = null;
  let askOpen = null;
  let menuOpen = null;
  let det = null;

  const remember = (list) => list.forEach((r) => bySlug.set(r.slug, r));
  const run = (p) => Promise.resolve(p).catch((e) => ejg.ui.toast(e.message || String(e), "error"));
  const pendingCount = () => ejg.downloads.all.filter((d) => DL.has(d.state)).length;

  // Fondo del juego enfocado (con una pequeña espera por si se sigue moviendo).
  let lastBg = null;
  function setBg(url) {
    lastBg = url;
    clearTimeout(bgTimer);
    bgTimer = setTimeout(() => bg.set(url || ejg.settings.wallpaper || null), 150);
  }

  // Estado real según la cola (el de la portada puede estar desfasado).
  function live(r) {
    const d = r.slug && ejg.downloads.all.find((x) => x.slug === r.slug);
    if (d) return { state: d.state, downloadId: d.id, gameId: d.gameId, progress: d.progress };
    const s = r.status || { state: "none" };
    return DL.has(s.state) ? { state: "none" } : s;
  }

  function statusText(st) {
    switch (st.state) {
      case "installed":
        return "Instalado";
      case "library":
        return "En tu biblioteca";
      case "downloading":
        return `Descargando · ${percent(st.progress)}`;
      case "queued":
        return "En cola";
      case "paused":
        return `En pausa · ${percent(st.progress)}`;
      case "seeding":
      case "completed":
        return "Listo para instalar";
      case "installing":
        return "Instalando…";
      case "error":
        return "Error en la descarga";
    }
    return "";
  }

  // ─────────────── piezas ───────────────
  function tile(r, sec, caption = true) {
    const sub = h("span", { class: "st-sub" });
    const mark = h("span", { class: "st-mark" });
    const el = h(
      "button",
      { class: "st-tile", "data-focus": "", "data-slug": r.slug, "data-sec": sec, title: r.title, onclick: () => openRepack(r.slug) },
      h("div", { class: "st-art" }, r.cover ? img(r.cover) : h("span", { class: "st-ph" }, r.title), mark),
      caption ? h("div", { class: "st-cap" }, h("b", null, r.title), sub) : null,
    );
    el.__r = r;
    el.__sub = sub;
    el.__mark = mark;
    applyStatus(el);
    return el;
  }

  function applyStatus(el) {
    const r = el.__r;
    const st = live(r);
    const key = `${st.state}|${Math.floor((st.progress || 0) * 100)}`;
    if (el.__st === key) return;
    el.__st = key;
    const t = statusText(st);
    el.__sub.textContent = t || sizeText(r.repackSize) || "";
    el.__sub.classList.toggle("on", !!t);
    el.__mark.className = "st-mark " + st.state;
    const bar = st.state === "downloading" || st.state === "paused" || st.state === "queued";
    el.__mark.replaceChildren(
      ...(st.state === "installed" || st.state === "library" ? [icon("check")] : st.state === "error" ? [icon("alert")] : bar ? [h("i", { style: { width: `${(st.progress || 0) * 100}%` } })] : []),
    );
  }

  const row = (items, sec, caption = true) => h("div", { class: "st-row", "data-focus-group": "row-" + sec }, ...items.map((r) => tile(r, sec, caption)));

  function allTile() {
    return h(
      "button",
      { class: "st-tile all", "data-focus": "", "data-key": "all-latest", onclick: () => openSearch(false) },
      h("div", { class: "st-art" }, h("span", { html: I.grid }), h("b", null, "Ver todo")),
      h("div", { class: "st-cap" }, h("b", null, "Novedades"), h("span", { class: "st-sub" }, "Todo lo publicado")),
    );
  }

  function menu(active) {
    const mi = (key, label, ico, fn, extra) =>
      h("button", { class: "st-mi" + (active === key ? " on" : ""), "data-focus": "", "data-key": "m-" + key, onclick: fn }, ico ? icon(ico) : null, h("span", null, label), extra);
    const n = pendingCount();
    return h(
      "nav",
      { class: "st-menu", "data-focus-group": "st-menu" },
      mi("front", "Descubrir", null, goFront),
      mi("search", "Buscar", "search", () => openSearch(true)),
      mi("downloads", "Descargas", "download", openDownloads, h("span", { class: "st-count", hidden: !n }, String(n))),
    );
  }

  function updateCounts() {
    const n = pendingCount();
    for (const c of root.querySelectorAll(".st-count")) {
      c.hidden = !n;
      c.textContent = String(n);
    }
  }

  const empty = (title, text, ...btns) => h("div", { class: "st-empty" }, h("h2", null, title), text ? h("p", null, text) : null, ...btns);

  // ─────────────── portada ───────────────
  function frontPage() {
    const s = store.state;
    const wrap = h("div", { class: "st-front" }, menu("front"));
    info = null;
    infoSlug = null;
    if (s.homeError) {
      wrap.append(
        empty("No se pudo abrir PlayStation Store", s.homeError, h("button", { class: "ps-btn primary", "data-focus": "", "data-key": "retry", onclick: () => store.loadHome(true) }, "Reintentar")),
      );
      return wrap;
    }
    if (!s.home) {
      wrap.append(h("div", { class: "st-empty" }, spinner(), h("p", null, "Cargando PlayStation Store…")));
      return wrap;
    }
    const byId = {};
    for (const x of s.home.sections) {
      byId[x.id] = x;
      secTitle[x.id] = x.title;
      remember(x.items);
    }
    const top = byId.today || byId.week;
    if (top) {
      info = h("div", { class: "st-info" });
      wrap.append(h("section", { class: "st-hero" }, info, h("div", { class: "st-feat" }, h("h2", { class: "st-h" }, top.title), row(top.items, top.id, false))));
    }
    for (const id of ["week", "month", "latest"]) {
      const sec = byId[id];
      if (!sec || sec === top || !sec.items.length) continue;
      const r = row(sec.items.slice(0, 36), id);
      if (id === "latest") r.append(allTile());
      wrap.append(h("section", { class: "st-sec" }, h("h2", { class: "st-h" }, sec.title), r));
    }
    if (top?.items[0]) showInfo(top.items[0], top.id);
    return wrap;
  }

  function showInfo(r, sec) {
    if (!info || infoSlug === r.slug) return;
    infoSlug = r.slug;
    const st = live(r);
    const t = statusText(st);
    const fact = (k, v) => (v ? h("div", null, h("b", null, v), k) : null);
    setBg(r.hero);
    info.replaceChildren(
      ...[
        h(
          "div",
          { class: "st-kicker" },
          h("span", null, secTitle[sec] || (sec === "search" ? "Resultado de la búsqueda" : "PlayStation Store")),
          t ? h("span", { class: "st-state " + st.state }, icon(st.state === "installed" || st.state === "library" ? "check" : st.state === "error" ? "alert" : "download"), t) : null,
        ),
        h("h1", { class: "st-title" }, r.title),
        h("div", { class: "st-ver" }, [r.version, r.companies].filter(Boolean).join("  ·  ")),
        r.genres.length ? h("div", { class: "st-tags" }, ...r.genres.slice(0, 5).map((g) => h("span", null, genreLabel(g)))) : null,
        h("div", { class: "st-facts" }, fact("Descarga", sizeText(r.repackSize)), fact("Tamaño original", sizeText(r.originalSize)), fact("Idiomas", r.languages), fact("Publicado", date(r.date))),
      ].filter(Boolean),
    );
  }

  // ─────────────── búsqueda ───────────────
  let searchEl = null;
  let input, results, resTitle, resNote, resEmpty, resSpin, resMore;
  let latest = null;
  let focusResults = false;
  let moreFrom = null;

  function searchPage() {
    input = h("input", {
      placeholder: "Buscar juegos",
      value: store.state.query,
      spellcheck: "false",
      "data-focus": "",
      "data-key": "search-input",
      onclick: () => {
        const src = ejg.input.source;
        if (src === "gamepad") keyboard();
        else if (src === "keyboard" && input.value && results.firstChild) focus.focus(results.firstChild);
      },
      oninput: () => {
        store.search(input.value);
        if (!input.value.trim() && !latest) loadLatest();
        renderResults();
      },
    });
    searchEl = h(
      "div",
      { class: "st-search" },
      menu("search"),
      h("div", { class: "st-sbar-wrap" }, h("label", { class: "st-sbar" }, icon("search"), input)),
      h("div", { class: "st-res-head" }, (resTitle = h("h2", { class: "st-h big" })), (resNote = h("span", { class: "st-note" }))),
      (resEmpty = h("p", { class: "st-note pad", hidden: true })),
      (results = h("div", { class: "st-grid", "data-focus-group": "results" })),
      (resSpin = spinner()),
      (resMore = h("button", { class: "ps-btn st-more", "data-focus": "", "data-key": "more", onclick: more }, "Ver más resultados")),
    );
    renderResults();
    return searchEl;
  }

  function renderResults() {
    if (!searchEl) return;
    const s = store.state;
    const q = s.query;
    const l = latest || { items: [], loading: true };
    const items = q ? s.results : l.items;
    const loading = q ? s.searching : l.loading;
    const error = q ? s.searchError : l.error;
    const hasMore = q ? s.page < s.pages : l.page < l.pages;
    remember(items);
    resTitle.textContent = q ? `Resultados de «${q}»` : "Novedades";
    resNote.textContent = q && s.total ? `${s.total} ${s.total === 1 ? "resultado" : "resultados"}` : "";
    keyed(
      results,
      items,
      (r) => r.slug,
      (r, prev) => (prev ? (applyStatus(prev), prev) : tile(r, q ? "search" : "latest")),
    );
    resEmpty.hidden = !(error || (!items.length && !loading));
    resEmpty.textContent = error || "No hay ningún juego con ese nombre.";
    resEmpty.classList.toggle("err", !!error);
    resSpin.hidden = !loading;
    resMore.hidden = !hasMore || loading;
    if (loading) return;
    if (moreFrom != null) {
      const el = results.children[moreFrom];
      moreFrom = null;
      if (el && (!focus.current || focus.current === resMore || !focus.current.isConnected)) focus.focus(el, { silent: true });
    }
    if (focusResults && items.length) {
      focusResults = false;
      focus.focus(results.firstChild, { silent: true });
    }
  }

  // «Novedades»: la búsqueda sin texto devuelve lo último publicado.
  async function loadLatest(page = 1) {
    if (latest?.loading && page > 1) return;
    latest = { items: latest?.items || [], page: latest?.page || 0, pages: latest?.pages || 0, loading: true, error: "" };
    renderResults();
    try {
      const r = await ejg.explore.search("", page);
      latest = { items: page > 1 ? latest.items.concat(r.items) : r.items, page: r.page, pages: r.pages, loading: false, error: "" };
    } catch (e) {
      latest = { ...latest, loading: false, error: e.message || String(e) };
    }
    if (!store.state.query) renderResults();
  }

  function more() {
    moreFrom = results.children.length;
    if (store.state.query) store.more();
    else loadLatest((latest?.page || 1) + 1);
  }

  function openSearch(focusInput = true) {
    view.name = "search";
    paint();
    root.scrollTop = 0;
    if (!store.state.query && !latest) loadLatest();
    if (focusInput) focus.focus(input, { silent: true });
    else {
      focusResults = true;
      renderResults();
    }
    onView();
  }

  async function keyboard() {
    const q = await askQuery(ejg, store.state.query);
    if (q == null) return;
    if (view.name !== "search") openSearch(false);
    input.value = q;
    store.search(q, 0);
    focusResults = true;
    if (!q.trim() && !latest) loadLatest();
    renderResults();
  }

  // ─────────────── ficha ───────────────
  async function openRepack(slug) {
    if (view.name !== "detail") {
      view.prev = view.name;
      view.scroll = root.scrollTop;
      const cur = focus.current;
      view.from = cur && root.contains(cur) ? cur : null;
    }
    view.name = "detail";
    view.slug = slug;
    view.detail = null;
    view.error = "";
    paint();
    root.scrollTop = 0;
    focusDefault();
    onView();
    try {
      view.detail = await store.details(slug);
    } catch (e) {
      view.error = e.message || String(e);
    }
    if (view.name === "detail" && view.slug === slug) paint();
  }

  function detailPage() {
    const d = view.detail || bySlug.get(view.slug);
    det = null;
    if (view.error && !view.detail) {
      return h("div", { class: "pd" }, empty("No se pudo abrir la ficha", view.error, h("button", { class: "ps-btn", "data-focus": "", "data-key": "pd-back", onclick: back }, "Volver")));
    }
    if (!d) return h("div", { class: "pd" }, h("div", { class: "st-empty" }, spinner()));
    remember([d]);
    setBg(d.hero || d.screenshots?.[0]?.full);
    const full = !!view.detail;
    const shots = d.screenshots || [];
    const btn = h("button", { class: "pd-main", "data-focus": "", "data-key": "pd-main", onclick: () => doAction(d) }, "Descargar");
    const hint = h("div", { class: "pd-hint", hidden: true });
    const bar = h("i");
    const txt = h("span");
    const pct = h("b");
    const prog = h("div", { class: "pd-prog", hidden: true }, h("div", { class: "pd-prog-t" }, txt, pct), h("div", { class: "pd-bar" }, bar));
    det = { d, btn, hint, prog, bar, txt, pct };
    const round = (ico, label, key, fn) => h("button", { class: "pd-round", "data-focus": "", "data-key": key, "aria-label": label, title: label, onclick: fn }, icon(ico));
    const fact = (k, v) => (v ? h("div", null, h("b", null, v), k) : null);
    const facts = [
      ["Géneros", d.genres.map(genreLabel).join(", ")],
      ["Compañías", d.companies],
      ["Idiomas", d.languages],
      ["Publicado", date(d.date)],
      ["Repack", d.number ? `#${d.number}` : null],
      ["Tamaño original", sizeText(d.originalSize)],
      ["Descarga", sizeText(d.repackSize)],
      ["Instalado", sizeText(d.installSize)],
      ["Descarga selectiva", d.selective ? "Sí: idiomas y extras opcionales" : null],
    ].filter((r) => r[1]);
    const desc = d.description ? h("div", { class: "pd-desc" }, d.description) : null;
    const descCard = desc
      ? h(
          "div",
          { class: "pd-card", "data-focus": "", "data-key": "pd-desc", onclick: () => descCard.classList.toggle("open") },
          h("h3", null, "Acerca de este juego"),
          desc,
          h("span", { class: "pd-more-t" }, "Leer más"),
        )
      : null;
    const page = h(
      "div",
      { class: "pd" },
      h(
        "section",
        { class: "pd-top" },
        h(
          "div",
          { class: "pd-col" },
          h("div", { class: "st-kicker" }, d.companies || "PlayStation Store"),
          h("h1", { class: "st-title pd-title" }, d.title),
          d.version ? h("div", { class: "st-ver" }, d.version) : null,
          d.genres.length ? h("div", { class: "st-tags" }, ...d.genres.slice(0, 6).map((g) => h("span", null, genreLabel(g)))) : null,
          h("div", { class: "st-facts" }, fact("Descarga", sizeText(d.repackSize)), fact("Instalado", sizeText(d.installSize) || (full ? "" : "…")), fact("Tamaño original", sizeText(d.originalSize))),
          hint,
          h(
            "div",
            { class: "pd-btns", "data-focus-group": "pd-btns" },
            btn,
            round("download", "Descargas", "pd-dl", openDownloads),
            d.url ? round("ext", "Ver en FitGirl", "pd-web", () => run(ejg.explore.openPage(d.slug))) : null,
          ),
          prog,
        ),
        h(
          "div",
          { class: "pd-media" },
          shots.length ? h("h2", { class: "st-h" }, "Capturas") : null,
          shots.length
            ? h(
                "div",
                { class: "st-row pd-shots", "data-focus-group": "pd-shots" },
                ...shots.map((s, i) =>
                  h(
                    "button",
                    {
                      class: "pd-shot",
                      "data-focus": "",
                      "data-key": "shot-" + i,
                      onclick: () =>
                        openViewer(
                          shots.map((x) => ({ url: x.full })),
                          i,
                        ),
                    },
                    img(s.thumb),
                  ),
                ),
              )
            : !full
              ? h("div", { class: "pd-loading" }, spinner())
              : null,
        ),
      ),
      full
        ? h(
            "section",
            { class: "pd-more" },
            h(
              "div",
              { class: "pd-left" },
              descCard,
              d.features.length
                ? h(
                    "div",
                    { class: "pd-card", "data-focus": "", "data-key": "pd-feat" },
                    h("h3", null, "Características del repack"),
                    h("ul", { class: "pd-feat" }, ...d.features.map((f) => h("li", null, f))),
                  )
                : null,
            ),
            h(
              "div",
              { class: "pd-right" },
              h(
                "div",
                { class: "pd-card", "data-focus": "", "data-key": "pd-info" },
                h("h3", null, "Información"),
                ...facts.map(([k, v]) => h("div", { class: "pd-row" }, h("span", null, k), h("span", null, v))),
              ),
            ),
          )
        : null,
    );
    updateDetail();
    if (descCard) requestAnimationFrame(() => descCard.classList.toggle("long", desc.scrollHeight > desc.clientHeight + 4));
    return page;
  }

  function doAction(d) {
    const st = live(d);
    const act = repackAction({ ...d, status: st });
    if (act.id === "download") return openDialog(d);
    if (act.id === "install" && st.downloadId) return run(ejg.downloads.install(st.downloadId));
    if (act.id === "play" && st.gameId) return run(ejg.game.launch(st.gameId));
    openDownloads();
  }

  // Botón y progreso de la ficha, en su sitio.
  function updateDetail() {
    if (!det) return;
    const st = live(det.d);
    const act = repackAction({ ...det.d, status: st });
    det.btn.textContent = act.label;
    for (const id of ["download", "install", "play", "downloads"]) det.btn.classList.toggle(id, act.id === id);
    det.hint.textContent = act.hint || "";
    det.hint.hidden = !act.hint;
    const dl = st.downloadId != null ? ejg.downloads.byId(st.downloadId) : null;
    const show = !!dl && ["downloading", "queued", "paused", "installing", "error"].includes(dl.state);
    det.prog.hidden = !show;
    if (!show) return;
    det.prog.classList.toggle("paused", dl.state !== "downloading" && dl.state !== "installing");
    det.bar.style.width = `${Math.round(dl.progress * 1000) / 10}%`;
    det.txt.textContent = [downloadLabel(dl), dl.state === "downloading" && dl.eta ? `quedan ${eta(dl.eta)}` : ""].filter(Boolean).join(" · ");
    det.pct.textContent = dl.state === "installing" ? "" : percent(dl.progress);
  }

  // ─────────────── diálogo de descarga ───────────────
  function dlgLayer(box) {
    const l = h("div", { class: "dg-layer", "data-focus-trap": "" }, box);
    document.body.append(l);
    document.body.classList.add("has-dlg");
    return l;
  }
  function dlgClosed() {
    if (!dialog && !askOpen) document.body.classList.remove("has-dlg");
    onView();
  }

  async function openDialog(d) {
    closeDialog();
    const body = h("div", { class: "dg-body" }, h("div", { class: "dg-wait" }, spinner(), h("p", null, "Buscando el torrent y su lista de archivos…")));
    const foot = h("div", { class: "dg-foot" });
    const box = h("div", { class: "dg" }, h("div", { class: "dg-head" }, h("small", null, "Descargar"), h("h2", null, d.title), d.version ? h("span", null, d.version) : null), body, foot);
    dialog = { layer: dlgLayer(box), slug: d.slug, prep: null, prev: focus.current };
    ejg.sound.play("open");
    const cancel = h("button", { class: "ps-btn", "data-focus": "", onclick: () => closeDialog() }, "Cancelar");
    foot.append(cancel);
    focus.focus(cancel, { silent: true });
    onView();
    let prep;
    try {
      prep = await ejg.downloads.prepare(d.slug);
    } catch (e) {
      if (dialog?.slug !== d.slug) return;
      body.replaceChildren(h("div", { class: "dg-wait" }, h("span", { class: "dg-bad", html: I.alert }), h("p", { class: "err" }, e.message || String(e))));
      return;
    }
    if (dialog?.slug !== d.slug) return;
    dialog.prep = prep;
    const sel = fileSelection(prep);
    let dir = prep.dir ? { path: prep.dir, freeBytes: prep.freeBytes } : null;
    const need = h("b");
    const avail = h("b");
    const pathEl = h("span", { class: "dg-path" });
    const err = h("p", { class: "err" });
    const ok = h("button", { class: "ps-btn primary", "data-focus": "" }, "Descargar");
    const upd = () => {
      need.textContent = bytes(sel.bytes);
      avail.textContent = dir?.freeBytes != null ? bytes(dir.freeBytes) : "—";
      pathEl.textContent = dir?.path || "Elige una carpeta";
      const problem = !dir ? "Elige dónde guardar la descarga" : sel.error || (!sel.fits(dir.freeBytes) ? "No hay espacio suficiente en ese disco" : "");
      err.textContent = problem;
      ok.disabled = !!problem;
    };
    const check = (f) =>
      h(
        "button",
        {
          class: "dg-chk" + (sel.isSelected(f.index) ? " on" : ""),
          "data-focus": "",
          role: "checkbox",
          onclick: (e) => {
            sel.toggle(f.index);
            e.currentTarget.classList.toggle("on", sel.isSelected(f.index));
            upd();
          },
        },
        h("i", { html: I.check }),
        h("span", null, f.label),
        h("small", null, bytes(f.size)),
      );
    const groups = [
      ["Idiomas", sel.languages],
      ["Contenido opcional", sel.optional],
    ].filter(([, l]) => l.length);
    body.replaceChildren(
      ...[
        h("div", { class: "dg-space" }, h("div", null, h("span", null, "Espacio necesario"), need), h("div", null, h("span", null, "Espacio disponible"), avail)),
        h(
          "div",
          { class: "dg-loc" },
          icon("disk"),
          h("div", { class: "dg-loc-t" }, h("small", null, "Guardar en"), pathEl),
          h(
            "button",
            {
              class: "ps-btn small",
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
        ...groups.map(([title, list]) => h("div", { class: "dg-group" }, h("h4", null, title), h("div", { class: "dg-chks", "data-focus-group": "chk-" + title }, ...list.map(check)))),
        groups.length ? h("p", { class: "dg-note" }, "En el instalador, desmarca lo que no hayas descargado.") : null,
        prep.installSize
          ? h(
              "p",
              { class: "dg-note" },
              `El juego instalado ocupará ${sizeText(prep.installSize)}${prep.installFreeBytes != null ? ` (quedan ${bytes(prep.installFreeBytes)} en ${prep.installDir})` : ""}.`,
            )
          : null,
        err,
      ].filter(Boolean),
    );
    ok.onclick = async () => {
      ok.disabled = true;
      ok.textContent = "Añadiendo…";
      try {
        await ejg.downloads.start(prep.token, sel.indices(), dir.path);
        closeDialog(true);
        ejg.ui.toast(`«${d.title}» se ha añadido a Descargas`, "ok");
        store.refresh();
        updateDetail();
      } catch (e) {
        err.textContent = e.message || String(e);
        ok.disabled = false;
        ok.textContent = "Descargar";
      }
    };
    foot.replaceChildren(cancel, ok);
    upd();
    focus.focus(ok.disabled ? body.querySelector("[data-focus]") : ok, { silent: true });
  }

  function closeDialog(done) {
    if (!dialog) return false;
    if (!dialog.prep && !done) ejg.downloads.cancelPrepare(dialog.slug).catch(() => {});
    const { layer: l, prev } = dialog;
    l.remove();
    dialog = null;
    if (prev?.isConnected) focus.focus(prev, { silent: true });
    else focusDefault();
    dlgClosed();
    return true;
  }

  /** Pregunta con dos respuestas y Cancelar: true, false o null. */
  function ask(title, text, yes, no) {
    return new Promise((resolve) => {
      const prev = focus.current;
      const done = (v) => {
        l.remove();
        askOpen = null;
        if (prev?.isConnected) focus.focus(prev, { silent: true });
        else focusPanel();
        dlgClosed();
        resolve(v);
      };
      const bYes = h("button", { class: "ps-btn primary", "data-focus": "", onclick: () => done(true) }, yes);
      const l = dlgLayer(
        h(
          "div",
          { class: "dg small" },
          h("div", { class: "dg-head" }, h("h2", null, title)),
          h("div", { class: "dg-body" }, h("p", { class: "dg-text" }, text)),
          h(
            "div",
            { class: "dg-foot" },
            h("button", { class: "ps-btn", "data-focus": "", onclick: () => done(null) }, "Cancelar"),
            h("button", { class: "ps-btn", "data-focus": "", onclick: () => done(false) }, no),
            bYes,
          ),
        ),
      );
      askOpen = () => done(null);
      ejg.sound.play("open");
      focus.focus(bYes, { silent: true });
      onView();
    });
  }

  // Menú de opciones (···) de una descarga.
  function optionsMenu(anchor, items) {
    closeMenu();
    const prev = focus.current;
    const list = h(
      "div",
      { class: "om" },
      ...items.map(([label, fn, cls]) =>
        h(
          "button",
          {
            class: "om-item" + (cls ? " " + cls : ""),
            "data-focus": "",
            onclick: () => {
              closeMenu();
              fn();
            },
          },
          label,
        ),
      ),
    );
    const l = h("div", { class: "om-layer", "data-focus-trap": "", onclick: (e) => e.target === l && closeMenu() }, list);
    document.body.append(l);
    const a = anchor.getBoundingClientRect();
    let top = a.bottom + 10;
    if (top + list.offsetHeight > innerHeight - 16) top = a.top - list.offsetHeight - 10;
    list.style.top = `${Math.max(16, top)}px`;
    list.style.left = `${Math.max(16, Math.min(innerWidth - list.offsetWidth - 16, a.right - list.offsetWidth))}px`;
    menuOpen = { layer: l, prev };
    ejg.sound.play("open");
    focus.focus(list.querySelector("[data-focus]"), { silent: true });
    onView();
  }
  function closeMenu() {
    if (!menuOpen) return false;
    const { layer: l, prev } = menuOpen;
    l.remove();
    menuOpen = null;
    if (prev?.isConnected) focus.focus(prev, { silent: true });
    onView();
    return true;
  }

  // ─────────────── descargas ───────────────
  const rows = new Map();
  let dqSig = "";
  let sumEl = null;
  const listSig = () => ejg.downloads.all.map((d) => `${d.id}:${d.state}:${d.state === "downloading" ? "" : d.pauseReason}:${d.filesDeleted}`).join(",");

  function dqCard(d) {
    const title = h("b", { class: "dq-title" });
    const pct = h("span", { class: "dq-pct" });
    const sub = h("span", { class: "dq-sub" });
    const left = h("span", { class: "dq-left" });
    const bar = h("i");
    const size = h("span", { class: "dq-size" });
    const btns = h("div", { class: "dq-btns", "data-focus-group": "dq-" + d.id });
    const el = h(
      "div",
      { class: "dq-card", "data-dl": d.id },
      h("div", { class: "dq-thumb" }, d.cover || d.hero ? img(d.cover || d.hero) : h("span", { html: I.download })),
      h("div", { class: "dq-main" }, h("div", { class: "dq-line" }, title, pct), h("div", { class: "dq-line" }, sub, left), h("div", { class: "dq-bar" }, bar), size),
      btns,
    );
    let sig = "";
    const update = (d) => {
      title.textContent = d.title;
      const going = d.state === "downloading";
      sub.textContent = [downloadLabel(d), going && d.peers ? `${d.peers} fuentes` : ""].filter(Boolean).join(" · ");
      left.textContent = going && d.eta ? `Quedan ${eta(d.eta)}` : "";
      pct.textContent = d.state === "installed" || d.state === "installing" ? "" : percent(d.progress);
      bar.style.width = `${Math.round(d.progress * 1000) / 10}%`;
      el.classList.toggle("paused", !going && d.state !== "installing");
      el.classList.toggle("error", d.state === "error");
      el.classList.toggle("done", d.state === "installed");
      size.textContent = d.state === "installed" ? (d.filesDeleted ? "Repack borrado" : `Repack de ${bytes(d.totalBytes)} en disco`) : `${bytes(d.doneBytes)} de ${bytes(d.totalBytes)}`;
      // Botones solo si cambian (para no perder el foco).
      const s = `${d.state}|${d.pauseReason}|${d.filesDeleted}|${d.gameId}`;
      if (s === sig) return;
      sig = s;
      const list = [];
      const pill = (label, key, fn) => h("button", { class: "ps-btn primary small", "data-focus": "", "data-key": key, onclick: fn }, label);
      const round = (ico, label, key, fn) => h("button", { class: "dq-round", "data-focus": "", "data-key": key, title: label, "aria-label": label, onclick: fn }, icon(ico));
      if (canInstall(d)) list.push(pill("Instalar", "install", () => run(ejg.downloads.install(d.id))));
      if (d.pauseReason === "needs-folder") list.push(pill("Elegir carpeta", "locate", () => run(ejg.downloads.locate(d.id))));
      if (d.state === "installed" && d.gameId) list.push(pill("Jugar", "play", () => run(ejg.game.launch(d.gameId))));
      if (isActive(d)) list.push(round("pause", "Pausar", "pause", () => run(ejg.downloads.pause(d.id))));
      if (d.state === "paused" || d.state === "error") list.push(round("play", d.state === "error" ? "Reintentar" : "Reanudar", "resume", () => run(ejg.downloads.resume(d.id))));
      list.push(round("dots", "Opciones", "opts", (e) => optionsMenu(e.currentTarget, options(d))));
      const had = btns.contains(focus.current);
      const key = had && focus.current.dataset.key;
      btns.replaceChildren(...list);
      if (had) focus.focus(btns.querySelector(`[data-key="${key}"]`) || btns.querySelector("[data-focus]"), { silent: true, noScroll: true });
    };
    update(d);
    return { el, update };
  }

  function options(d) {
    const out = [];
    if (canInstall(d)) out.push(["Instalar", () => run(ejg.downloads.install(d.id))]);
    if (d.state === "installed" && d.gameId) out.push(["Jugar", () => run(ejg.game.launch(d.gameId))]);
    if (d.state === "queued") out.push(["Descargar primero", () => run(ejg.downloads.move(d.id, 0))]);
    if (isActive(d)) out.push(["Pausar", () => run(ejg.downloads.pause(d.id))]);
    if (d.state === "paused") out.push(["Reanudar", () => run(ejg.downloads.resume(d.id))]);
    if (d.state === "error") out.push(["Reintentar", () => run(ejg.downloads.resume(d.id))]);
    if (d.slug && ejg.explore.enabled) out.push(["Ver en PlayStation Store", () => (closeDownloads(), setTab("store"), openRepack(d.slug))]);
    if (!(d.state === "installed" && d.filesDeleted)) out.push(["Abrir carpeta", () => run(ejg.downloads.openFolder(d.id))]);
    if (d.state !== "installing") {
      const label = d.state === "installed" ? (d.filesDeleted ? "Quitar de la lista" : "Borrar el repack…") : isActive(d) || d.state === "paused" ? "Cancelar descarga…" : "Quitar de Descargas…";
      out.push([label, () => removeDl(d), "bad"]);
    }
    return out;
  }

  async function removeDl(d) {
    if (d.filesDeleted) return run(ejg.downloads.remove(d.id, false));
    const keepGame = d.state === "installed";
    const files = await ask(
      keepGame ? "Borrar el repack" : isActive(d) || d.state === "paused" ? "Cancelar descarga" : "Quitar de Descargas",
      keepGame ? `¿Borrar también los archivos del repack de «${d.title}»? El juego instalado no se toca.` : `¿Borrar también lo descargado de «${d.title}» (${bytes(d.doneBytes)})?`,
      "Borrar archivos",
      "Conservarlos",
    );
    if (files != null) run(ejg.downloads.remove(d.id, files));
  }

  function summary() {
    const all = ejg.downloads.all;
    const going = all.filter((d) => d.state === "downloading");
    const inst = all.find((d) => d.state === "installing");
    const wait = all.filter((d) => d.state === "queued" || d.state === "paused").length;
    const ready = all.filter(canInstall).length;
    const bad = all.filter((d) => d.state === "error").length;
    const total = going.reduce((a, d) => a + d.downBps, 0);
    return [
      going.length ? `${going.length === 1 ? "1 descarga" : `${going.length} descargas`} en curso · ${speed(total)}` : inst ? `Instalando ${inst.title}` : all.length ? "Nada descargándose ahora" : "",
      wait ? `${wait} en espera` : "",
      ready ? `${ready} ${ready === 1 ? "lista" : "listas"} para instalar` : "",
      bad ? `${bad} con error` : "",
    ]
      .filter(Boolean)
      .join("  ·  ");
  }

  function paintDownloads() {
    const prev = focus.current;
    const inside = prev && layer.contains(prev);
    const prevDl = inside && prev.closest("[data-dl]")?.dataset.dl;
    const prevKey = inside && prev.dataset.key;
    const all = ejg.downloads.all;
    dqSig = listSig();
    rows.clear();
    const section = (label, list, g) =>
      list.length
        ? h(
            "section",
            { class: "dq-sec" },
            h("h2", null, label, h("span", null, String(list.length))),
            h(
              "div",
              { class: "dq-list", "data-focus-group": g },
              ...list.map((d) => {
                const r = dqCard(d);
                rows.set(d.id, r);
                return r.el;
              }),
            ),
          )
        : null;
    const btn = (label, key, fn) => h("button", { class: "ps-btn small", "data-focus": "", "data-key": key, onclick: fn }, label);
    sumEl = h("span", { class: "dq-sum" }, summary());
    const head = h(
      "header",
      { class: "dq-head" },
      h("div", { class: "dq-titles" }, h("h1", null, "Descargas"), sumEl),
      h(
        "div",
        { class: "dq-all", "data-focus-group": "dq-all" },
        all.some(isActive) ? btn("Pausar todo", "pause-all", () => run(ejg.downloads.pause())) : null,
        all.some((d) => d.state === "paused") ? btn("Reanudar todo", "resume-all", () => run(ejg.downloads.resume())) : null,
        h("button", { class: "dq-round", "data-focus": "", "data-key": "close", title: "Cerrar", "aria-label": "Cerrar", onclick: closeDownloads }, icon("x")),
      ),
    );
    const body = h(
      "div",
      { class: "dq-body" },
      section(
        "En curso",
        all.filter((d) => d.state === "downloading" || d.state === "installing"),
        "dq-now",
      ),
      section(
        "En espera",
        all.filter((d) => d.state === "queued" || d.state === "paused" || d.state === "error"),
        "dq-wait",
      ),
      section(
        "Listas para instalar",
        all.filter((d) => d.state === "seeding" || d.state === "completed"),
        "dq-ready",
      ),
      section(
        "Instalados",
        all.filter((d) => d.state === "installed"),
        "dq-done",
      ),
      !all.length
        ? h(
            "div",
            { class: "dq-empty" },
            h("span", { class: "dq-empty-ico", html: I.download }),
            h("h2", null, "No hay descargas"),
            h("p", null, "Busca un juego en PlayStation Store y pulsa Descargar."),
            ejg.explore.enabled
              ? h("button", { class: "ps-btn primary", "data-focus": "", "data-key": "go-store", onclick: () => (closeDownloads(), setTab("store")) }, "Ir a PlayStation Store")
              : null,
          )
        : null,
    );
    layer.replaceChildren(h("div", { class: "dq" }, head, body));
    if (inside && !prev.isConnected) {
      const card = prevDl && layer.querySelector(`[data-dl="${prevDl}"]`);
      const again = (card && (card.querySelector(`[data-key="${prevKey}"]`) || card.querySelector("[data-focus]"))) || (prevKey && layer.querySelector(`[data-key="${prevKey}"]`));
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else focusPanel();
    }
  }

  function focusPanel() {
    if (!panel) return focusDefault();
    const el = layer.querySelector(".dq-list [data-focus]") || layer.querySelector(".dq-empty [data-focus]") || layer.querySelector("[data-focus]");
    if (el) focus.focus(el, { silent: true });
  }

  function openDownloads() {
    closeMenu();
    if (!panel) {
      panel = true;
      const cur = focus.current;
      panelPrev = cur && !layer.contains(cur) ? cur : panelPrev;
      layer.hidden = false;
      document.documentElement.dataset.panel = "downloads";
      ejg.sound.play("open");
    }
    paintDownloads();
    focusPanel();
    onView();
  }

  function closeDownloads() {
    if (!panel) return false;
    panel = false;
    layer.hidden = true;
    layer.replaceChildren();
    rows.clear();
    delete document.documentElement.dataset.panel;
    const p = panelPrev;
    panelPrev = null;
    if (p?.isConnected && !p.closest("[hidden]")) focus.focus(p, { silent: true });
    else focusView();
    onView();
    return true;
  }

  function onDownloads() {
    if (panel) {
      // Si solo cambió el progreso, se actualiza en su sitio (sin perder el foco).
      if (listSig() !== dqSig) paintDownloads();
      else {
        for (const d of ejg.downloads.all) rows.get(d.id)?.update(d);
        if (sumEl) sumEl.textContent = summary();
      }
    }
    if (shown) {
      updateDetail();
      updateCounts();
      for (const el of root.querySelectorAll(".st-tile[data-slug]")) applyStatus(el);
    }
    onChange();
  }
  ejg.downloads.onChange(onDownloads);

  // ─────────────── pintar y foco ───────────────
  function onState() {
    if (!shown) return;
    if (view.name === "search") return renderResults();
    if (view.name !== "front") return;
    const s = store.state;
    if (frontEl && frontFor === s.home && s.home) return;
    paint();
  }

  function paint() {
    const prev = focus.current;
    const inside = prev && root.contains(prev);
    const key = inside && (prev.dataset.key || (prev.dataset.slug && "slug:" + prev.dataset.slug));
    if (view.name !== "front" && frontEl?.contains(prev)) frontFocus = prev;
    let el;
    if (view.name === "detail") el = detailPage();
    else if (view.name === "search") el = searchEl || searchPage();
    else {
      const s = store.state;
      if (!(frontEl && frontFor === s.home && s.home)) {
        frontEl = frontPage();
        frontFor = s.home;
      }
      el = frontEl;
    }
    if (root.firstChild !== el) root.replaceChildren(el);
    if (view.name === "search") renderResults();
    requestAnimationFrame(updateDeep);
    updateCounts();
    for (const t of el.querySelectorAll(".st-tile[data-slug]")) applyStatus(t);
    if (inside && !prev.isConnected) {
      const again = byKey(key);
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else focusDefault();
    }
    // Recién cargada la portada: el foco va a la fila destacada.
    if (wantFocus && view.name === "front" && store.state.home && frontEl.querySelector(".st-tile")) {
      wantFocus = false;
      if (!focus.current || !focus.current.isConnected || focus.current.closest(".st-menu")) focusDefault();
    }
  }

  function byKey(k) {
    if (!k) return null;
    if (k.startsWith("slug:")) return root.querySelector(`[data-slug="${CSS.escape(k.slice(5))}"]`);
    return root.querySelector(`[data-key="${k}"]`);
  }

  function focusDefault() {
    if (panel) return focusPanel();
    let el = null;
    if (view.name === "detail") el = root.querySelector(".pd-main") || root.querySelector("[data-focus]");
    else if (view.name === "search") el = input;
    else el = (frontFocus?.isConnected && root.contains(frontFocus) && frontFocus) || root.querySelector(".st-feat .st-tile") || root.querySelector(".st-tile") || root.querySelector("[data-focus]");
    if (el) focus.focus(el, { silent: true });
  }

  function goFront() {
    const was = view.name;
    view.name = "front";
    paint();
    if (was !== "front") {
      root.scrollTop = 0;
      focusDefault();
    }
    onView();
  }

  // Qué hacer al enfocar algo de la tienda o de las descargas.
  function onFocus(el, pointer = false) {
    // Con el ratón solo se cambian el fondo y los datos (nada se desplaza).
    if (layer.contains(el)) return pointer || (el.closest(".dq-card") || el).scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (!root.contains(el)) return;
    const r = el.dataset.slug && bySlug.get(el.dataset.slug);
    const r0 = el.closest(".st-row");
    if (view.name === "front") {
      if (r0) frontFocus = el;
      if (r) showInfo(r, el.dataset.sec);
    } else if (view.name === "search" && r?.hero) setBg(r.hero);
    if (pointer) return;
    if (r0) scrollRow(r0, el);
    if (view.name === "front") {
      const sec = el.closest(".st-sec");
      root.scrollTo({ top: sec ? sec.offsetTop - 24 : 0, behavior: "smooth" });
    } else if (view.name === "search") {
      if (el.closest(".st-menu, .st-sbar")) root.scrollTo({ top: 0, behavior: "smooth" });
      else el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else if (el.closest(".pd-more")) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    else root.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Fondo más oscuro al bajar de la primera pantalla (también con la rueda).
  let deepRaf = 0;
  function updateDeep() {
    deepRaf = 0;
    const top = root.querySelector(".st-hero, .pd-top");
    const deep = shown && (view.name === "search" || (!!top && root.scrollTop > top.offsetHeight * 0.4));
    document.body.classList.toggle("store-deep", deep);
  }
  root.addEventListener("scroll", () => (deepRaf ||= requestAnimationFrame(updateDeep)), { passive: true });

  // Fila horizontal: desplaza lo justo para que se vea el elemento enfocado.
  function scrollRow(row, el) {
    const pad = parseFloat(getComputedStyle(row).paddingLeft) || 0;
    const l = el.offsetLeft - pad;
    const r = el.offsetLeft + el.offsetWidth + pad - row.clientWidth;
    if (row.scrollLeft > l) row.scrollTo({ left: l, behavior: "smooth" });
    else if (row.scrollLeft < r) row.scrollTo({ left: r, behavior: "smooth" });
  }

  function back() {
    if (askOpen) return (askOpen(), true);
    if (closeMenu()) return true;
    if (closeDialog()) return true;
    if (closeDownloads()) return true;
    if (!shown) return false;
    if (view.name === "detail") {
      view.name = view.prev === "detail" ? "front" : view.prev || "front";
      det = null;
      paint();
      root.scrollTop = view.scroll;
      const el = (view.from?.isConnected && root.contains(view.from) && view.from) || root.querySelector(`[data-slug="${CSS.escape(view.slug)}"]`);
      if (el) focus.focus(el, { silent: true });
      else focusDefault();
      onView();
      return true;
    }
    if (view.name === "search") return (goFront(), true);
    // En la portada, desde las filas de abajo se vuelve a la destacada.
    const cur = focus.current;
    if (cur && root.contains(cur) && cur.closest(".st-sec")) {
      frontFocus = null;
      focusDefault();
      return true;
    }
    return false;
  }

  function hintsFor() {
    if (dialog || askOpen || menuOpen)
      return [
        ["accept", "Seleccionar"],
        ["back", "Cancelar"],
      ];
    if (panel)
      return [
        ["accept", "Seleccionar"],
        ["back", "Cerrar"],
      ];
    if (view.name === "detail")
      return [
        ["accept", "Seleccionar"],
        ["back", "Atrás"],
        ["y", "Buscar"],
      ];
    if (view.name === "search")
      return [
        ["accept", "Seleccionar"],
        ["y", "Teclado"],
        ["back", "Atrás"],
        ["lb", "Pestañas"],
      ];
    return [
      ["accept", "Seleccionar"],
      ["y", "Buscar"],
      ["back", "Atrás"],
      ["lb", "Pestañas"],
      ["menu", "Menú"],
    ];
  }

  return {
    /** Se muestra la pestaña de la tienda. */
    show() {
      shown = true;
      if (!store.state.home) wantFocus = true;
      store.loadHome();
      paint();
      focusDefault();
      if (lastBg) setBg(lastBg);
    },
    hide() {
      shown = false;
      clearTimeout(bgTimer);
      document.body.classList.remove("store-deep");
    },
    front() {
      if (view.name !== "front") goFront();
    },
    openRepack,
    openDownloads,
    closeDownloads,
    back,
    onFocus,
    owns: (el) => root.contains(el) || layer.contains(el) || !!el.closest(".dg-layer, .om-layer"),
    /** Y: buscar (teclado en pantalla con mando). */
    search() {
      if (ejg.input.source === "gamepad") return keyboard();
      openSearch(true);
    },
    hints: hintsFor,
    get panelOpen() {
      return panel;
    },
    hasDialog: () => !!dialog || !!askOpen || !!menuOpen || panel,
    pendingCount,
  };
}
