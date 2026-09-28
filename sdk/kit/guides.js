// Guías de la comunidad de Steam para temas: estado de la lista (orden,
// categoría, búsqueda, idioma y páginas), pintado de los bloques de una guía y
// un lector que recuerda por dónde vas. El tema solo decide el aspecto: todas
// las piezas llevan clases `g-…` que puede vestir (o cambiar con `cls`).
//
//   import { createGuides, renderGuide, createReader, GUIDE_CATEGORIES } from "/_sdk/kit/guides.js";

import { h, img } from "./dom.js";

export const GUIDE_SORTS = [
  { value: "toprated", label: "Mejor valoradas" },
  { value: "trend", label: "Populares" },
  { value: "mostrecent", label: "Más recientes" },
];

/** Categorías de Steam (value es lo que entiende su filtro). */
export const GUIDE_CATEGORIES = [
  { value: "", label: "Todas" },
  { value: "Achievements", label: "Logros" },
  { value: "Walkthroughs", label: "Paso a paso" },
  { value: "Gameplay Basics", label: "Lo básico" },
  { value: "Secrets", label: "Secretos" },
  { value: "Maps or Levels", label: "Mapas y niveles" },
  { value: "Characters", label: "Personajes" },
  { value: "Classes", label: "Clases" },
  { value: "Weapons", label: "Armas" },
  { value: "Loot", label: "Botín" },
  { value: "Crafting", label: "Fabricación" },
  { value: "Story or Lore", label: "Historia" },
  { value: "Game Modes", label: "Modos de juego" },
  { value: "Co-op", label: "Cooperativo" },
  { value: "Multiplayer", label: "Multijugador" },
  { value: "Modding or Configuration", label: "Mods y ajustes" },
  { value: "Trading", label: "Intercambios" },
  { value: "Workshop", label: "Workshop" },
];

const LANGS = {
  es: "Español", en: "Inglés", pt: "Portugués", fr: "Francés", de: "Alemán", it: "Italiano", pl: "Polaco", tr: "Turco",
  ru: "Ruso", uk: "Ucraniano", zh: "Chino", ja: "Japonés", ko: "Coreano", th: "Tailandés",
};

/** "ru" → "Ruso" ("" si no se sabe). */
export const langLabel = (code) => LANGS[code] || "";

/** Código corto para una etiqueta pequeña ("ES", "EN"…; "" si no se sabe). */
export const langTag = (code) => (code && code !== "xx" ? code.toUpperCase() : "");

/** 4 → "★★★★☆"; sin valorar → "". */
export const starsText = (n) => (n == null ? "" : "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n)));

// ───────────────────────────── lista ─────────────────────────────

/**
 * Lista de guías de un juego con filtros y «cargar más».
 * `onChange(state)` en cada cambio. state: {gameId, appid, items, shelf,
 * loading, error, total, next, sort, category, query, allLanguages, filtered}.
 */
export function createGuides(ejg, gameId, onChange = () => {}) {
  const state = {
    gameId,
    appid: undefined,
    items: [],
    shelf: { pinned: [], recent: [] },
    loading: false,
    error: null,
    total: 0,
    next: null,
    filtered: true,
    sort: "toprated",
    category: "",
    query: "",
    allLanguages: false,
  };
  let seq = 0;
  const emit = () => onChange(state);

  async function load(page = 1) {
    const my = ++seq;
    state.loading = true;
    state.error = null;
    if (page === 1) state.items = [];
    emit();
    try {
      const r = await ejg.guides.list(gameId, { page, sort: state.sort, category: state.category, query: state.query, allLanguages: state.allLanguages });
      if (my !== seq) return;
      state.appid = r.appid ?? null;
      const seen = new Set(state.items.map((i) => i.id));
      state.items = [...state.items, ...r.items.filter((i) => !seen.has(i.id))];
      state.total = r.total;
      state.next = r.next ?? null;
      state.filtered = r.filtered;
    } catch (e) {
      if (my !== seq) return;
      state.error = String(e?.message || e);
    }
    state.loading = false;
    emit();
  }

  async function refreshShelf() {
    try {
      state.shelf = await ejg.guides.shelf(gameId);
      emit();
    } catch {}
  }

  return {
    state,
    load: () => (refreshShelf(), load(1)),
    more: () => (state.next && !state.loading ? load(state.next) : Promise.resolve()),
    refreshShelf,
    setSort: (v) => ((state.sort = v), load(1)),
    setCategory: (v) => ((state.category = v), load(1)),
    setQuery: (v) => ((state.query = String(v || "").trim()), load(1)),
    setAllLanguages: (v) => ((state.allLanguages = !!v), load(1)),
    /** Siguiente orden / categoría (para botones que rotan con el mando). */
    cycleSort: (d = 1) => {
      const i = GUIDE_SORTS.findIndex((s) => s.value === state.sort);
      state.sort = GUIDE_SORTS[(i + d + GUIDE_SORTS.length) % GUIDE_SORTS.length].value;
      return load(1);
    },
    cycleCategory: (d = 1) => {
      const i = GUIDE_CATEGORIES.findIndex((c) => c.value === state.category);
      state.category = GUIDE_CATEGORIES[(i + d + GUIDE_CATEGORIES.length) % GUIDE_CATEGORIES.length].value;
      return load(1);
    },
    /** Guarda o quita una guía (de la lista, de la estantería o una ya abierta). */
    pin: async (guide, value) => {
      await ejg.guides.pin(gameId, guide, value);
      await refreshShelf();
    },
    isPinned: (id) => state.shelf.pinned.some((p) => p.id === id),
  };
}

/** Texto de por qué no hay guías (o "" si las hay). */
export function emptyText(state) {
  if (state.loading) return "";
  if (state.error) return state.error;
  if (state.appid === null) return "Este juego no está identificado en Steam, así que no hay guías que buscar. Búscalo en Editar → Coincidencia.";
  if (!state.items.length) {
    if (state.query) return `No hay guías que hablen de «${state.query}».`;
    if (state.filtered && state.total) return "No hay guías en español ni en inglés con estos filtros. Prueba con todos los idiomas.";
    return "Aún no hay guías de la comunidad para este juego.";
  }
  return "";
}

// ───────────────────────────── bloques ─────────────────────────────

/**
 * Pinta los trozos de texto. opts: {onLink(href), onGuide(id), cls}
 * Los enlaces son <button> (así se enfocan con el mando si llevan data-focus).
 */
export function renderSpans(spans, opts = {}) {
  const c = opts.cls || "g-";
  const frag = document.createDocumentFragment();
  for (const s of spans || []) {
    const parts = String(s.text).split("\n");
    let node;
    const text = [];
    parts.forEach((p, i) => {
      if (i) text.push(h("br"));
      if (p) text.push(p);
    });
    if (s.href || s.guide) {
      node = h(
        "button",
        {
          class: `${c}link` + (s.guide ? ` ${c}link-guide` : ""),
          "data-focus": opts.focusLinks === false ? null : "",
          title: s.href || "Abrir esta guía",
          onclick: (e) => {
            e.stopPropagation();
            if (s.guide) opts.onGuide?.(s.guide);
            else opts.onLink?.(s.href);
          },
        },
        text,
      );
    } else node = text.length === 1 && typeof text[0] === "string" ? document.createTextNode(text[0]) : h("span", null, text);
    if (s.b) node = h("b", null, node);
    if (s.i) node = h("i", null, node);
    if (s.u) node = h("u", null, node);
    if (s.s) node = h("s", null, node);
    if (s.spoiler) {
      const sp = h("span", { class: `${c}spoiler`, title: "Spoiler: púlsalo para verlo", onclick: () => sp.classList.add("is-open") }, node);
      node = sp;
    }
    frag.append(node);
  }
  return frag;
}

/**
 * Pinta una lista de bloques. opts: {onLink, onGuide, onImage(src, all),
 * cls, focusImages} → DocumentFragment.
 */
export function renderBlocks(blocks, opts = {}) {
  const c = opts.cls || "g-";
  const frag = document.createDocumentFragment();
  const images = (blocks || []).filter((b) => b.t === "img").map((b) => b.src);
  for (const b of blocks || []) {
    switch (b.t) {
      case "h":
        frag.append(h(`h${Math.min(6, b.level + 2)}`, { class: `${c}h ${c}h${b.level}` }, renderSpans(b.spans, opts)));
        break;
      case "p":
        frag.append(h("p", { class: `${c}p` }, renderSpans(b.spans, opts)));
        break;
      case "quote":
        frag.append(h("blockquote", { class: `${c}quote` }, renderSpans(b.spans, opts)));
        break;
      case "code":
        frag.append(h("pre", { class: `${c}code` }, b.text));
        break;
      case "hr":
        frag.append(h("hr", { class: `${c}hr` }));
        break;
      case "list": {
        const list = h(b.ordered ? "ol" : "ul", { class: `${c}list` });
        for (const it of b.items) list.append(h("li", { class: `${c}li`, style: it.depth ? `margin-left: ${it.depth * 1.4}em` : null }, renderSpans(it.spans, opts)));
        frag.append(list);
        break;
      }
      case "table": {
        const table = h("table", { class: `${c}table` });
        b.rows.forEach((row, i) => {
          const th = b.head && i === 0;
          table.append(h("tr", null, row.map((cell) => h(th ? "th" : "td", null, renderSpans(cell, opts)))));
        });
        frag.append(h("div", { class: `${c}table-wrap` }, table));
        break;
      }
      case "img": {
        const el = img(b.src, { class: `${c}img` + (b.thumb ? ` ${c}img-thumb` : "") });
        frag.append(
          opts.onImage
            ? h("button", { class: `${c}img-btn` + (b.thumb ? ` ${c}img-thumb` : ""), "data-focus": opts.focusImages ? "" : null, onclick: () => opts.onImage(b.src, images) }, el)
            : el,
        );
        break;
      }
      case "video":
        frag.append(
          h(
            "button",
            { class: `${c}video`, "data-focus": "", title: "Ver en YouTube", onclick: () => opts.onLink?.(b.url) },
            b.thumb ? img(b.thumb) : null,
            h("span", { class: `${c}video-play` }, "▶"),
            h("span", { class: `${c}video-label` }, "Ver el vídeo en YouTube"),
          ),
        );
        break;
    }
  }
  return frag;
}

/**
 * La guía entera: intro + una <section> por sección (con data-section = índice).
 * Devuelve {el, sections: HTMLElement[], toc: [{title, index}]}.
 */
export function renderGuide(guide, opts = {}) {
  const c = opts.cls || "g-";
  const el = h("div", { class: `${c}doc` });
  if (guide.intro?.length) el.append(h("div", { class: `${c}intro` }, renderBlocks(guide.intro, opts)));
  const sections = guide.sections.map((s, i) =>
    h(
      "section",
      { class: `${c}section`, "data-section": i },
      s.title ? h("h2", { class: `${c}section-title`, "data-focus": opts.focusTitles ? "" : null, tabindex: "-1" }, s.title) : null,
      renderBlocks(s.blocks, opts),
    ),
  );
  el.append(...sections);
  return { el, sections, toc: guide.sections.map((s, i) => ({ title: s.title || `Sección ${i + 1}`, index: i })) };
}

// ───────────────────────────── lector ─────────────────────────────

/**
 * Lector con progreso: recuerda la sección y la posición (se guarda sola al
 * leer) y se maneja con el mando.
 *   const r = createReader({ ejg, gameId, guide, scroller, sections, onSection });
 *   r.restore();           // vuelve a donde lo dejaste
 *   r.scroll(1)            // abajo/arriba (una pantalla ≈ 85 %)
 *   r.jump(1)              // sección siguiente/anterior
 *   r.destroy()
 */
export function createReader({ ejg, gameId, guide, scroller, sections, onSection = () => {} }) {
  let current = -1;
  let saveTimer = 0;
  let target = null;
  let targetTimer = 0;
  const where = () => {
    const top = scroller.getBoundingClientRect().top + 8;
    let idx = 0;
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= top) idx = i;
      else break;
    }
    const s = sections[idx];
    const r = s ? s.getBoundingClientRect() : null;
    const frac = r && r.height > 0 ? Math.min(1, Math.max(0, (top - r.top) / r.height)) : 0;
    return { idx, frac };
  };
  const onScroll = () => {
    const { idx, frac } = where();
    if (idx !== current) {
      current = idx;
      onSection(idx);
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ejg.guides.progress(gameId, guide, idx, frac).catch(() => {}), 800);
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });

  const to = (idx, frac = 0, smooth = false) => {
    const s = sections[Math.max(0, Math.min(sections.length - 1, idx))];
    if (!s) return;
    const top = s.offsetTop + s.offsetHeight * frac - (sections[0]?.offsetTop ?? 0) * 0;
    scroller.scrollTo({ top: Math.max(0, top - 8), behavior: smooth ? "smooth" : "auto" });
  };
  return {
    restore() {
      const p = guide.progress;
      if (p && (p.section > 0 || p.scroll > 0.02)) requestAnimationFrame(() => to(p.section, p.scroll));
      else onScroll();
    },
    scroll(dir) {
      scroller.scrollBy({ top: dir * scroller.clientHeight * 0.85, behavior: "smooth" });
    },
    /** Paso corto (flechas / cruceta). */
    step(dir) {
      scroller.scrollBy({ top: dir * 120, behavior: "smooth" });
    },
    jump(dir) {
      // Con saltos seguidos, se cuenta desde el destino anterior (el
      // desplazamiento suave aún no ha llegado).
      const base = target ?? where().idx;
      target = Math.max(0, Math.min(sections.length - 1, base + dir));
      clearTimeout(targetTimer);
      targetTimer = setTimeout(() => (target = null), 700);
      to(target, 0, true);
    },
    goto(idx) {
      to(idx, 0, true);
    },
    get section() {
      return Math.max(0, current);
    },
    destroy() {
      clearTimeout(saveTimer);
      scroller.removeEventListener("scroll", onScroll);
      const { idx, frac } = where();
      ejg.guides.progress(gameId, guide, idx, frac).catch(() => {});
    },
  };
}

// ───────────────────────────── vista completa ─────────────────────────────

/**
 * Lista + lector de guías listos para montar en un contenedor del tema. El
 * tema pone el sitio, el aspecto (CSS sobre las clases `g-…` y las variables
 * de /_sdk/kit/guides.css) y le pasa la navegación:
 *
 *   const view = createGuideView({ ejg, root, focus, gameId, onExit: cerrar, onChange: pistas });
 *   bindNav(focus, { …, back: () => view.nav("back") || …, y: () => view.nav("y") });
 *   hintBar.set(view.hints());
 *   view.destroy();   // al salir (guarda por dónde ibas)
 *
 * `layout`: "list" (filas) | "grid" (tarjetas). `guide`: abrir directamente esa guía.
 * `nav(action)` devuelve true si la ha usado (si no, que la use el tema).
 */
export function createGuideView({ ejg, root, focus, gameId, gameTitle = "", cls = "g-", layout = "list", guide: startId = null, labels = {}, onExit = () => {}, onChange = () => {} }) {
  const c = cls;
  const L = {
    title: "Guías de la comunidad",
    saved: "Guardadas",
    continue: "Seguir leyendo",
    community: "De la comunidad",
    more: "Cargar más guías",
    loading: "Cargando guías…",
    opening: "Abriendo la guía…",
    pin: "☆ Guardar",
    pinned: "★ Guardada",
    browser: "Abrir en Steam",
    back: "Volver",
    search: "Buscar en las guías",
    index: "Índice",
    end: "Fin de la guía · de la comunidad de Steam",
    count: (n) => `${n.toLocaleString("es")} guías`,
    ...labels,
  };
  const guides = createGuides(ejg, gameId, () => paintList());
  const listEl = h("div", { class: `${c}view ${c}listview ${c}layout-${layout}` });
  const readerEl = h("div", { class: `${c}view ${c}readerview`, hidden: true, "data-focus-trap": "" });
  root.replaceChildren(listEl, readerEl);
  let mode = "list";
  // Abierta directamente en una guía (desde la ficha): al cerrarla se sale.
  let direct = !!startId;
  const stack = [];
  let reader = null;
  let current = null;
  let toc = null;
  let zoom = null;
  let destroyed = false;
  const changed = () => !destroyed && onChange(api);

  // ─── lista ───
  const header = h("div", { class: `${c}head` }, h("h2", { class: `${c}title` }, L.title), gameTitle ? h("div", { class: `${c}subtitle` }, gameTitle) : null);
  const filters = h("div", { class: `${c}filters`, "data-focus-group": "guide-filters" });
  const shelfEl = h("div", { class: `${c}shelf`, "data-focus-group": "guide-shelf" });
  const items = h("div", { class: `${c}items`, "data-focus-group": "guide-items" });
  const status = h("div", { class: `${c}status` });
  const moreBtn = h("button", { class: `${c}more`, "data-focus": "", hidden: true, onclick: () => guides.more() }, L.more);
  listEl.append(header, filters, shelfEl, items, status, moreBtn);

  const chip = (key, label, on, fn) => h("button", { class: `${c}chip` + (on ? " is-on" : ""), "data-focus": "", "data-key": key, onclick: fn }, label);

  async function search() {
    const s = guides.state;
    if (ejg.input.source === "gamepad") {
      const q = await ejg.ui.keyboard({ title: L.search, value: s.query, placeholder: "Por ejemplo: logros, jefe final…", maxLength: 80 });
      if (q !== null) guides.setQuery(q);
      return;
    }
    const input = h("input", { class: `${c}search-input`, value: s.query, placeholder: L.search, spellcheck: "false" });
    const done = (apply) => {
      if (!input.isConnected) return;
      if (apply) guides.setQuery(input.value);
      else paintFilters();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      }
    });
    input.addEventListener("blur", () => setTimeout(() => done(input.value.trim() !== s.query), 120));
    filters.querySelector(`[data-key="search"]`)?.replaceWith(input);
    input.focus();
  }

  function paintFilters() {
    const s = guides.state;
    const sort = GUIDE_SORTS.find((x) => x.value === s.sort)?.label;
    const cat = GUIDE_CATEGORIES.find((x) => x.value === s.category)?.label;
    const had = focus.current && filters.contains(focus.current) ? focus.current.dataset.key : null;
    filters.replaceChildren(
      chip("search", s.query ? `🔍 «${s.query}»` : `🔍 ${L.search}`, !!s.query, search),
      chip("sort", sort, false, () => guides.cycleSort(1)),
      chip("cat", s.category ? cat : "Todas las categorías", !!s.category, () => guides.cycleCategory(1)),
      chip("lang", s.allLanguages ? "Todos los idiomas" : "Español e inglés", s.allLanguages, () => guides.setAllLanguages(!s.allLanguages)),
    );
    if (had) {
      const again = filters.querySelector(`[data-key="${had}"]`);
      if (again) focus.focus(again, { noScroll: true, silent: true });
    }
  }

  function row(it, kind) {
    const pinned = guides.isPinned(it.id);
    const meta = [];
    if (kind === "item") meta.push(h("span", { class: `${c}stars` + (it.stars == null ? " is-none" : "") }, it.stars == null ? "Sin valorar" : starsText(it.stars)));
    else meta.push(h("span", null, it.pinned ? "Guardada" : "Leída"));
    if (it.author) meta.push(h("span", { class: `${c}author` }, it.author));
    if (it.progress && (it.progress.section > 0 || it.progress.scroll > 0.02)) meta.push(h("span", null, `sección ${it.progress.section + 1}`));
    const tag = kind === "item" && it.lang !== "es" ? langTag(it.lang) : "";
    return h(
      "button",
      { class: `${c}item ${c}item-${kind}` + (pinned ? " is-pinned" : ""), "data-focus": "", "data-key": `${kind}:${it.id}`, "data-guide": it.id, onclick: () => open(it.id) },
      h("span", { class: `${c}thumb` }, it.preview ? img(it.preview) : h("span", { class: `${c}thumb-ph` }, "📖")),
      h(
        "span",
        { class: `${c}item-main` },
        h("span", { class: `${c}item-title` }, it.title, tag ? h("span", { class: `${c}lang`, title: langLabel(it.lang) }, tag) : null, pinned ? h("span", { class: `${c}pin-mark` }, "★") : null),
        it.desc ? h("span", { class: `${c}item-desc` }, it.desc) : null,
        h("span", { class: `${c}item-meta` }, meta),
      ),
    );
  }

  function paintList() {
    if (destroyed) return;
    const s = guides.state;
    paintFilters();
    const sh = s.shelf;
    const showShelf = !s.query && (sh.pinned.length || sh.recent.length);
    shelfEl.hidden = !showShelf;
    if (showShelf) {
      shelfEl.replaceChildren(
        sh.pinned.length ? h("div", { class: `${c}label` }, L.saved) : "",
        ...sh.pinned.map((it) => row(it, "shelf")),
        sh.recent.length ? h("div", { class: `${c}label` }, L.continue) : "",
        ...sh.recent.map((it) => row(it, "shelf")),
        h("div", { class: `${c}label` }, L.community + (s.total ? ` · ${L.count(s.total)}` : "")),
      );
    }
    const had = focus.current && (items.contains(focus.current) || shelfEl.contains(focus.current)) ? focus.current.dataset.key : null;
    items.replaceChildren(...s.items.map((it) => row(it, "item")));
    if (had) {
      const again = listEl.querySelector(`[data-key="${had}"]`);
      if (again) focus.focus(again, { noScroll: true, silent: true });
    }
    status.textContent = s.loading ? L.loading : emptyText(s);
    status.hidden = !status.textContent;
    moreBtn.hidden = !s.next || s.loading;
    // El foco entra en la lista si se había quedado fuera (en algo que ya no está).
    if (mode === "list" && (!focus.current || !focus.current.isConnected || !root.contains(focus.current))) focus.first(listEl);
    changed();
  }

  // ─── lector ───
  let returnKey = null;
  async function open(id, push = true) {
    if (push) stack.push(id);
    // Al volver a la lista, el foco vuelve a la guía que se abrió.
    if (mode === "list") returnKey = focus.current && listEl.contains(focus.current) ? focus.current.dataset.key : null;
    mode = "reader";
    listEl.hidden = true;
    readerEl.hidden = false;
    reader?.destroy();
    reader = null;
    readerEl.replaceChildren(h("div", { class: `${c}status` }, L.opening));
    changed();
    let g;
    try {
      g = await ejg.guides.get(id);
    } catch (e) {
      if (stack[stack.length - 1] !== id || destroyed) return;
      readerEl.replaceChildren(
        h("div", { class: `${c}status is-error` }, String(e?.message || e)),
        h(
          "div",
          { class: `${c}rbar` },
          h("button", { class: `${c}rbtn`, "data-focus": "", onclick: close }, `‹ ${L.back}`),
          h("button", { class: `${c}rbtn`, "data-focus": "", onclick: () => ejg.guides.openInBrowser(id) }, L.browser),
        ),
      );
      focus.first(readerEl);
      changed();
      return;
    }
    if (stack[stack.length - 1] !== id || destroyed) return;
    current = g;
    const opts = {
      cls: c,
      focusLinks: false,
      onLink: (href) => ejg.guides.openLink(href).catch((e) => ejg.ui.toast(String(e.message || e), "error")),
      onGuide: (gid) => open(gid),
      onImage: (src) => showZoom(src),
    };
    const doc = renderGuide(g, opts);
    const body = h("div", { class: `${c}rbody` }, doc.el, h("div", { class: `${c}end` }, L.end));
    const secBtn = g.sections.length > 1 ? h("button", { class: `${c}rbtn ${c}rbtn-toc`, "data-focus": "", onclick: openToc }, `1 / ${g.sections.length}`) : null;
    const pinBtn = h("button", { class: `${c}rbtn ${c}rbtn-pin` + (g.pinned ? " is-on" : ""), "data-focus": "", onclick: togglePin }, g.pinned ? L.pinned : L.pin);
    const meta = [g.stars != null ? starsText(g.stars) : null, g.ratings ? `${g.ratings.toLocaleString("es")} valoraciones` : null, g.authors.join(", ") || null, g.updated ? `act. ${g.updated}` : g.published]
      .filter(Boolean)
      .join(" · ");
    readerEl.replaceChildren(
      h(
        "div",
        { class: `${c}rbar` },
        h("button", { class: `${c}rbtn ${c}rbtn-back`, "data-focus": "", onclick: close }, `‹ ${L.back}`),
        h("div", { class: `${c}rtitle` }, h("b", null, g.title), h("small", null, meta)),
        secBtn,
        pinBtn,
        h("button", { class: `${c}rbtn`, "data-focus": "", onclick: () => ejg.guides.openInBrowser(g.id) }, L.browser),
      ),
      body,
    );
    reader = createReader({
      ejg,
      gameId,
      guide: g,
      scroller: body,
      sections: doc.sections,
      onSection: (i) => secBtn && (secBtn.textContent = `${i + 1} / ${g.sections.length}`),
    });
    reader.restore();
    focus.focus(secBtn || pinBtn, { instant: true, silent: true, noScroll: true });
    changed();
  }

  function close() {
    closeToc();
    closeZoom();
    reader?.destroy();
    reader = null;
    current = null;
    stack.pop();
    if (stack.length) return open(stack[stack.length - 1], false);
    mode = "list";
    readerEl.hidden = true;
    readerEl.replaceChildren();
    listEl.hidden = false;
    if (direct) {
      direct = false;
      changed();
      return onExit();
    }
    guides.refreshShelf();
    const back = returnKey && listEl.querySelector(`[data-key="${returnKey}"]`);
    if (back) focus.focus(back, { silent: true });
    else focus.first(listEl);
    changed();
  }

  async function togglePin() {
    if (!current) return;
    const value = !current.pinned;
    try {
      await ejg.guides.pin(gameId, current, value);
      current.pinned = value;
      const b = readerEl.querySelector(`.${c}rbtn-pin`);
      if (b) {
        b.textContent = value ? L.pinned : L.pin;
        b.classList.toggle("is-on", value);
      }
      ejg.sound.play("select");
      changed();
    } catch (e) {
      ejg.ui.toast(String(e.message || e), "error");
    }
  }

  function openToc() {
    if (!current || !reader) return;
    closeToc();
    toc = h(
      "div",
      { class: `${c}toc`, "data-focus-trap": "", onclick: (e) => e.target === toc && closeToc() },
      h(
        "div",
        { class: `${c}toc-box` },
        h("div", { class: `${c}label` }, L.index),
        current.sections.map((s, i) =>
          h(
            "button",
            { class: `${c}toc-item` + (i === reader.section ? " is-on" : ""), "data-focus": "", onclick: () => (closeToc(), reader.goto(i)) },
            h("span", null, String(i + 1)),
            s.title || `Sección ${i + 1}`,
          ),
        ),
      ),
    );
    readerEl.append(toc);
    const on = toc.querySelector(".is-on") || toc.querySelector("[data-focus]");
    if (on) focus.focus(on, { instant: true, silent: true });
    changed();
  }

  function closeToc() {
    if (!toc) return;
    toc.remove();
    toc = null;
    const b = readerEl.querySelector(`.${c}rbtn-toc`);
    if (b) focus.focus(b, { silent: true, noScroll: true });
    changed();
  }

  function showZoom(src) {
    closeZoom();
    zoom = h("div", { class: `${c}zoom`, "data-focus-trap": "", onclick: closeZoom }, img(src), h("button", { class: `${c}zoom-close`, "data-focus": "" }, "✕"));
    readerEl.append(zoom);
    focus.first(zoom);
    changed();
  }

  function closeZoom() {
    if (!zoom) return;
    zoom.remove();
    zoom = null;
    const b = readerEl.querySelector(`.${c}rbtn-toc, .${c}rbtn-pin`);
    if (b) focus.focus(b, { silent: true, noScroll: true });
    changed();
  }

  const api = {
    get mode() {
      return mode;
    },
    /** Acción de mando/teclado: true si la ha usado. */
    nav(a) {
      if (mode === "reader") {
        if (zoom) {
          if (a === "back" || a === "accept") closeZoom();
          return true;
        }
        if (toc) {
          if (a === "back") {
            closeToc();
            return true;
          }
          return false;
        }
        if (!reader) {
          if (a === "back") {
            close();
            return true;
          }
          return false;
        }
        switch (a) {
          case "up":
          case "down":
            reader.step(a === "down" ? 1 : -1);
            return true;
          case "lt":
          case "rt":
            reader.scroll(a === "rt" ? 1 : -1);
            return true;
          case "lb":
          case "rb":
            reader.jump(a === "rb" ? 1 : -1);
            ejg.sound.play("move");
            return true;
          case "y":
            togglePin();
            return true;
          case "x":
            ejg.guides.openInBrowser(current.id);
            return true;
          case "view":
            openToc();
            return true;
          case "back":
            ejg.sound.play("back");
            close();
            return true;
        }
        return false;
      }
      if (a === "back") {
        onExit();
        return true;
      }
      if (a === "x") {
        search();
        return true;
      }
      if (a === "y") {
        const id = focus.current?.dataset?.guide;
        const s = guides.state;
        const it = id && (s.items.find((x) => x.id === id) || s.shelf.pinned.find((x) => x.id === id) || s.shelf.recent.find((x) => x.id === id));
        if (it) guides.pin(it, !guides.isPinned(id));
        return !!it;
      }
      return false;
    },
    /** Pistas para la barra del tema. */
    hints() {
      if (mode === "reader") {
        if (zoom) return [["back", "Cerrar"]];
        if (toc) return [["accept", "Ir"], ["back", "Cerrar"]];
        return [["up", "Leer"], ["lb", "Sección"], ["y", current?.pinned ? "Quitar de guardadas" : "Guardar"], ["x", "Steam"], ["back", "Volver"]];
      }
      return [["accept", "Leer"], ["x", "Buscar"], ["y", "Guardar"], ["back", "Atrás"]];
    },
    /** Con el foco en la última guía de la lista: cargar más. */
    near() {
      if (mode === "list" && focus.current && items.lastElementChild === focus.current) guides.more();
    },
    reload: () => guides.load(),
    destroy() {
      destroyed = true;
      reader?.destroy();
      reader = null;
      root.replaceChildren();
    },
  };
  if (startId) open(startId);
  guides.load();
  return api;
}
