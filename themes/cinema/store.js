// Explorar y Mis descargas del tema Cinema: cartelera con los populares del
// día, filas de capturas, top 10, ficha en la hoja modal, diálogo de descarga
// y la lista de descargas con su anillo de progreso. La lógica común está en
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
};
const RING = '<svg viewBox="0 0 36 36"><circle class="rg-bg" cx="18" cy="18" r="15.5"/><circle class="rg-fg" cx="18" cy="18" r="15.5" pathLength="100"/></svg><i></i>';
const RING_ICON = { queued: I.clock, paused: I.pause, seeding: I.box, completed: I.box, installed: I.check, error: I.alert };

// Géneros de la web (en inglés) que merecen fila propia.
const GENRES = {
  Action: "Acción",
  Adventure: "Aventuras",
  RPG: "Rol",
  "Open world": "Mundo abierto",
  Shooter: "Disparos",
  Strategy: "Estrategia",
  Horror: "Terror",
  Racing: "Conducción",
  Simulation: "Simulación",
  Survival: "Supervivencia",
  Fighting: "Lucha",
  Platformer: "Plataformas",
  Sports: "Deportes",
  Puzzle: "Puzles",
};

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
  const sv = { page: "front", latest: null };
  const known = new Map(); // slug → Repack, para abrir la ficha al instante
  const bb = { list: [], i: 0, timer: 0, el: null, label: "hoy" };
  let sheet = null;
  let dialog = null;
  let askOpen = null;

  const run = (p) => Promise.resolve(p).catch((e) => ejg.ui.toast(e.message || String(e), "error"));
  const remember = (list) => list.forEach((r) => known.set(r.slug, { ...known.get(r.slug), ...r }));
  const dedupe = (list) => list.filter((r, k) => list.findIndex((x) => x.slug === r.slug) === k);

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

  function card(r, opts = {}) {
    const el = h(
      "button",
      { class: "sc", "data-focus": "", "data-slug": r.slug, onclick: () => openRepack(r.slug), title: r.title },
      h("div", { class: "sc-art" }, r.hero ? img(r.hero) : r.cover ? img(r.cover, { class: "fit" }) : placeholder(r.title)),
      opts.fresh ? h("span", { class: "sc-new" }, "Novedad") : null,
      h("span", { class: "sc-tag", hidden: true }),
      h(
        "div",
        { class: "sc-info" },
        h("b", null, r.title),
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
        opts.more ? h("button", { class: "sc sc-more", "data-focus": "", onclick: opts.more }, h("span", { html: I.chev }), h("b", null, "Ver todo")) : null,
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

  function genreRows(list, used) {
    const count = new Map();
    for (const r of list) for (const g of r.genres) if (GENRES[g]) count.set(g, (count.get(g) || 0) + 1);
    return [...count.entries()]
      .filter(([, n]) => n >= 6)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g]) => {
        // Sin repetir lo que ya sale en otras filas, si se puede.
        const all = list.filter((r) => r.genres.includes(g));
        const fresh = all.filter((r) => !used.has(r.slug));
        return row(`g-${g}`, `Juegos de ${GENRES[g].toLowerCase()}`, (fresh.length >= 6 ? fresh : all).slice(0, 20));
      });
  }

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
      h("h1", { class: "bb-title" + (r.title.length > 34 ? " xl" : r.title.length > 18 ? " l" : "") }, r.title),
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
    const used = new Set([...top, ...week, ...latest].map((r) => r.slug));
    return h(
      "div",
      { class: "s-front" },
      billboard((today.length ? today : week).filter((r) => r.hero).slice(0, 6)),
      h(
        "div",
        { class: "s-rows" },
        top10(top),
        row("week", by.week?.title || "Populares de la semana", week),
        row("latest", "Novedades", latest, { fresh: true, more: () => browseLatest() }),
        row("month", by.month?.title || "Populares del mes", month),
        ...genreRows(dedupe([...month, ...week]), used),
      ),
    );
  }

  // «Novedades»: la búsqueda sin texto devuelve lo último publicado.
  async function browseLatest(page = 1) {
    if (sv.page !== "latest") {
      sv.page = "latest";
      sv.latest = null;
      stopBillboard();
      main.scrollTo({ top: 0, behavior: "instant" });
    }
    sv.latest = { ...(sv.latest || { items: [], page: 0, pages: 0 }), loading: true, error: "" };
    paint(page > 1);
    if (page === 1) focus.first(root);
    try {
      const r = await ejg.explore.search("", page);
      sv.latest = { items: page > 1 ? sv.latest.items.concat(r.items) : r.items, page: r.page, pages: r.pages, loading: false };
    } catch (e) {
      sv.latest = { ...sv.latest, loading: false, error: e.message || String(e) };
    }
    if (sv.page === "latest" && view === "explore") {
      const empty = !root.querySelector(".s-grid [data-focus]");
      paint(true);
      if (empty && !sheet) focus.first(root.querySelector(".s-grid") || root);
    }
  }

  const count = (n) => `${n} ${n === 1 ? "título" : "títulos"}`;
  function results() {
    const latest = sv.page === "latest";
    const s = latest ? sv.latest || { items: [], page: 0, pages: 0, loading: true } : store.state;
    const items = latest ? s.items : s.results;
    const busy = latest ? s.loading : s.searching;
    const err = latest ? s.error : s.searchError;
    remember(items);
    return h(
      "div",
      { class: "s-results" },
      h(
        "div",
        { class: "s-res-h" },
        latest ? h("h1", null, "Novedades") : h("h1", null, h("span", null, "Resultados de "), `«${s.query}»`),
        !latest && items.length ? h("span", null, count(s.pages > 1 ? s.total : items.length)) : null,
      ),
      err ? h("p", { class: "s-err" }, err) : null,
      !items.length && !busy && !err
        ? h("p", { class: "s-muted" }, latest ? "No hay novedades ahora mismo." : `No hay nada que coincida con «${s.query}». Prueba con otro nombre.`)
        : null,
      h("div", { class: "s-grid", "data-focus-group": "s-grid" }, ...items.map((r) => card(r, { fresh: latest }))),
      busy ? h("div", { class: "spinner" }) : null,
      s.page < s.pages && !busy
        ? h("button", { class: "hbtn info s-more", "data-focus": "", onclick: () => (latest ? browseLatest(s.page + 1) : store.more()) }, "Ver más")
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
        h("h1", { class: "hero-title s-title" }, r.title),
        h(
          "div",
          { class: "hero-actions", "data-focus-group": "s-sheet-act" },
          btn,
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
    // Sin descripción, las características ocupan su sitio.
    const feats = d?.features || [];
    const featsLeft = d && !d.description && feats.length;
    const featList = () => h("ul", { class: "s-feat" }, ...feats.map((f) => h("li", null, f)));
    const desc = h("div", { class: "s-desc" }, d ? d.description || (featsLeft ? featList() : "") : h("div", { class: "skel" }, h("i"), h("i"), h("i")));
    const facts = [
      ["Géneros", r.genres.map(genreLabel).join(", ")],
      ["Compañías", r.companies],
      ["Idiomas", r.languages],
      ["Tamaño original", sizeText(r.originalSize)],
      ["Descarga", sizeText(r.repackSize)],
      ["Instalado", sizeText(d?.installSize)],
    ].filter((f) => f[1]);
    const shots = d?.screenshots || [];
    box.replaceChildren(
      hero,
      h(
        "div",
        { class: "sheet-body" },
        h("div", null, meta, desc),
        h("div", { class: "side" }, ...facts.map(([k, v]) => h("div", null, `${k}: `, h("b", null, v)))),
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
      error ? h("p", { class: "s-err s-pad" }, error) : null,
      h("div", { class: "s-foot" }),
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
      if (prev?.isConnected) focus.focus(prev, { silent: true });
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
      h("div", { class: "dlg-hero", style: r.hero ? { backgroundImage: `url("${r.hero}")` } : {} }, h("div", { class: "dlg-t" }, h("small", null, "Descargar"), h("b", null, r.title))),
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
  function paint(keepFocus = false) {
    const prev = keepFocus ? focus.current : null;
    const slug = prev?.closest?.("[data-slug]")?.dataset.slug;
    const dl = prev?.closest?.("[data-dl]")?.dataset.dl;
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
        root.replaceChildren(results());
      }
    } else return;
    if (keepFocus) main.scrollTop = top;
    const free = !sheet && !dialog && !askOpen;
    if (keepFocus && prev && !prev.isConnected) {
      const again = (slug && root.querySelector(`[data-slug="${CSS.escape(slug)}"]`)) || (dl && root.querySelector(`[data-dl="${dl}"] [data-focus]`)) || null;
      if (again) focus.focus(again, { silent: true, noScroll: true });
      else if (free) focus.first(root);
    } else if (wasEmpty && free && (!focus.current?.isConnected || focus.current.id === "nav-explore")) {
      // La portada acaba de cargar: el foco, a la cartelera.
      focus.first(root);
    }
  }

  function closeLayers() {
    if (askOpen) askOpen();
    if (dialog) closeDialog();
    closeSheet(true);
  }

  function back() {
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
        if (sv.page === "latest") sv.page = "front";
        store.loadHome();
      }
      paint();
    },
    openRepack,
    /** Lupa de la barra y Y: buscar en Explorar (teclado en pantalla con mando). */
    search: openSearch,
    back,
    /** Capa abierta encima de la vista: "ask" | "dialog" | "sheet" | null. */
    layer: () => (askOpen ? "ask" : dialog ? "dialog" : sheet ? "sheet" : null),
    /** Cola agrupada (createDownloads del kit), para el indicador de la barra. */
    groups: () => queue.groups(),
  };
}
