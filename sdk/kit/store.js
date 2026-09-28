// Explorar y Descargas para temas: estado de la tienda, cola viva, selección
// de archivos y formatos. El tema solo pinta; aquí va la lógica común.
//
//   import { createExplore, createDownloads, fileSelection, bytes, speed } from "/_sdk/kit/store.js";

// ───────────────────────────── formatos ─────────────────────────────

const nf1 = new Intl.NumberFormat("es", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("es", { maximumFractionDigits: 2 });

/** 19327352832 → "18 GB"; 536870912 → "512 MB" */
export function bytes(n) {
  const b = Math.max(0, n || 0);
  if (b >= 1024 ** 4) return `${nf2.format(b / 1024 ** 4)} TB`;
  if (b >= 1024 ** 3) return `${nf1.format(b / 1024 ** 3)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

/** Bytes por segundo → "12,3 MB/s" */
export function speed(bps) {
  const b = Math.max(0, bps || 0);
  if (b >= 1024 ** 2) return `${nf1.format(b / 1024 ** 2)} MB/s`;
  return `${Math.round(b / 1024)} KB/s`;
}

/** Segundos → "1 h 20 min" ("" si no se sabe). */
export function eta(s) {
  if (s == null || !isFinite(s) || s <= 0) return "";
  if (s < 60) return "menos de 1 min";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h >= 48) return `${Math.round(h / 24)} días`;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Tamaños tal y como vienen de la ficha, en español: "from 18 GB" → "desde 18 GB", "up to 26.7 GB" → "hasta 26,7 GB". */
export function sizeText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\bfrom\s+/gi, "desde ")
    .replace(/\bup to\s+/gi, "hasta ")
    .replace(/\bduring installation\b/gi, "al instalar")
    .replace(/\bafter installation\b/gi, "tras instalar")
    .replace(/~/g, "≈")
    .replace(/(\d)\.(\d)/g, "$1,$2");
}

const GENRES = {
  action: "Acción", adventure: "Aventura", arcade: "Arcade", "beat 'em up": "Beat 'em up", "board game": "Juego de mesa",
  building: "Construcción", "card game": "Cartas", casual: "Casual", "city builder": "Construcción de ciudades",
  "co-op": "Cooperativo", comedy: "Comedia", crafting: "Fabricación", detective: "Detectives", driving: "Conducción",
  exploration: "Exploración", fantasy: "Fantasía", fighting: "Lucha", "first-person": "Primera persona",
  "hack and slash": "Hack and slash", horror: "Terror", "hidden object": "Objetos ocultos", indie: "Indie",
  management: "Gestión", "metroidvania": "Metroidvania", multiplayer: "Multijugador", music: "Música",
  mystery: "Misterio", "open world": "Mundo abierto", platformer: "Plataformas", "point & click": "Point & click",
  "point-and-click": "Point & click", puzzle: "Puzles", racing: "Carreras", "real-time": "Tiempo real",
  "roguelike": "Roguelike", "roguelite": "Roguelite", rpg: "Rol", "action rpg": "Rol de acción", "jrpg": "JRPG",
  sandbox: "Sandbox", "sci-fi": "Ciencia ficción", shooter: "Disparos", simulation: "Simulación", simulator: "Simulación",
  "soulslike": "Soulslike", space: "Espacio", sport: "Deportes", sports: "Deportes", stealth: "Sigilo",
  strategy: "Estrategia", survival: "Supervivencia", "survival horror": "Survival horror", tactical: "Táctico",
  "third-person": "Tercera persona", "top-down": "Vista cenital", "turn-based": "Por turnos", "visual novel": "Novela visual",
  war: "Bélico", western: "Western", "2d": "2D", "3d": "3D", "isometric": "Isométrico", "anime": "Anime",
};

/** Género de la ficha (en inglés) en español: "Open world" → "Mundo abierto". */
export function genreLabel(g) {
  return GENRES[String(g || "").trim().toLowerCase()] || g;
}

/** 0.4321 → "43 %" */
export function percent(p) {
  return `${Math.floor(Math.max(0, Math.min(1, p || 0)) * 100)} %`;
}

const REASONS = {
  playing: "En pausa mientras juegas",
  install: "En pausa mientras se instala otro juego",
  queue: "En cola",
  user: "En pausa",
};

/** Texto corto del estado de una descarga ("Descargando · 12 MB/s", "Listo para instalar"…). */
export function downloadLabel(d) {
  if (!d) return "";
  switch (d.state) {
    case "downloading":
      if (d.checking) return "Comprobando archivos…";
      if (!d.downBps) return d.peers ? "Conectando…" : "Buscando fuentes…";
      return `Descargando · ${speed(d.downBps)}`;
    case "queued":
      return REASONS[d.pauseReason] || "En cola";
    case "paused":
      return "En pausa";
    case "seeding":
      return d.pauseReason ? "Listo para instalar" : "Listo para instalar · compartiendo";
    case "completed":
      if (d.pauseReason === "needs-folder") return "Elige dónde se instaló";
      return d.error ? `Listo para instalar (${d.error})` : "Listo para instalar";
    case "installing":
      return "Instalando…";
    case "installed":
      return "Instalado";
    case "error":
      return d.error ? `Error: ${d.error}` : "Error";
    default:
      return d.state;
  }
}

/** ¿Se puede pulsar «Instalar»? */
export function canInstall(d) {
  return !!d && (d.state === "seeding" || d.state === "completed") && !d.filesDeleted && d.pauseReason !== "needs-folder";
}

/** ¿Está en marcha o esperando turno? (para pausar) */
export function isActive(d) {
  return !!d && (d.state === "downloading" || d.state === "queued");
}

/** Texto del botón principal de una ficha según su estado. */
export function repackAction(r) {
  const s = r && r.status ? r.status.state : "none";
  switch (s) {
    case "installed":
      return { id: "play", label: "Jugar" };
    case "library":
      return { id: "download", label: "Descargar", hint: "Ya tienes un juego con este nombre" };
    case "downloading":
      return { id: "downloads", label: `Descargando ${percent(r.status.progress)}` };
    case "queued":
      return { id: "downloads", label: "En cola" };
    case "paused":
      return { id: "downloads", label: "En pausa" };
    case "seeding":
    case "completed":
      return { id: "install", label: "Instalar" };
    case "installing":
      return { id: "downloads", label: "Instalando…" };
    case "error":
      return { id: "downloads", label: "Ver descarga" };
    default:
      return { id: "download", label: "Descargar" };
  }
}

// ───────────────────────────── catálogo ─────────────────────────────

/** Órdenes del catálogo. */
export const SORTS = [
  { id: "date", label: "Novedades" },
  { id: "modified", label: "Actualizados hace poco" },
  { id: "title", label: "De la A a la Z" },
];

/** Tamaños máximos de descarga (null = cualquiera). */
export const SIZES = [
  { gb: null, label: "Cualquier tamaño" },
  { gb: 5, label: "Hasta 5 GB" },
  { gb: 10, label: "Hasta 10 GB" },
  { gb: 25, label: "Hasta 25 GB" },
  { gb: 50, label: "Hasta 50 GB" },
];

/** Grupos de géneros, en el orden en que conviene enseñarlos. */
export const GENRE_GROUPS = [
  { id: "genre", label: "Género" },
  { id: "view", label: "Perspectiva" },
  { id: "setting", label: "Ambientación" },
];

/** Máximo de géneros a la vez (salen los juegos que los tienen todos). */
export const MAX_GENRES = 4;

export const emptyFilters = () => ({ query: "", genres: [], sort: "date", maxGb: null, hideOwned: false });

/** Cuántos filtros hay puestos (sin contar el texto ni el orden). */
export function filterCount(f) {
  return (f.genres?.length || 0) + (f.maxGb ? 1 : 0) + (f.hideOwned ? 1 : 0);
}

/** "Rol · Mundo abierto · Hasta 25 GB" (vacío si no hay filtros). */
export function describeFilters(f, genres = []) {
  const names = (f.genres || []).map((id) => genres.find((g) => g.id === id)?.name).filter(Boolean);
  const size = SIZES.find((s) => s.gb === (f.maxGb || null));
  return [...names, f.maxGb && size ? size.label : "", f.hideOwned ? "Sin los que ya tienes" : ""].filter(Boolean).join(" · ");
}

// ───────────────────────────── tienda ─────────────────────────────

/**
 * Estado de Explorar: portada, búsqueda (con espera al escribir), páginas y
 * fichas en caché. `onChange(state)` se llama en cada cambio.
 */
export function createExplore(ejg, onChange = () => {}) {
  const state = {
    home: null,
    homeLoading: false,
    homeError: "",
    query: "",
    results: [],
    page: 0,
    pages: 0,
    total: 0,
    searching: false,
    searchError: "",
    /** Géneros para filtrar (se piden una vez con loadGenres). */
    genres: [],
    /** Catálogo con filtros (browse). */
    catalog: { filters: emptyFilters(), items: [], page: 0, pages: 0, total: 0, filtered: false, loading: false, error: "" },
  };
  const details = new Map();
  const similarCache = new Map();
  let seq = 0;
  let timer = 0;
  let catSeq = 0;
  let catTimer = 0;
  const emit = () => onChange(state);

  async function loadHome(force = false) {
    if ((state.home && !force) || state.homeLoading) return state.home;
    state.homeLoading = true;
    state.homeError = "";
    emit();
    try {
      state.home = await ejg.explore.home();
    } catch (e) {
      state.homeError = e.message || String(e);
    }
    state.homeLoading = false;
    emit();
    return state.home;
  }

  async function run(q, page) {
    const my = ++seq;
    state.searching = true;
    state.searchError = "";
    emit();
    try {
      const r = await ejg.explore.search(q, page);
      if (my !== seq) return;
      state.results = page > 1 ? state.results.concat(r.items) : r.items;
      state.page = r.page;
      state.pages = r.pages;
      state.total = r.total;
    } catch (e) {
      if (my !== seq) return;
      state.searchError = e.message || String(e);
      if (page <= 1) state.results = [];
    }
    state.searching = false;
    emit();
  }

  /** Busca `q` (espera `delay` ms por si se sigue escribiendo). "" vuelve a la portada. */
  function search(q, delay = 350) {
    q = (q || "").trim();
    state.query = q;
    clearTimeout(timer);
    if (!q) {
      seq++;
      state.results = [];
      state.page = state.pages = state.total = 0;
      state.searching = false;
      state.searchError = "";
      emit();
      return;
    }
    timer = setTimeout(() => run(q, 1), delay);
  }

  /** Siguiente página de resultados. */
  function more() {
    if (state.searching || !state.query || state.page >= state.pages) return;
    run(state.query, state.page + 1);
  }

  async function get(slug) {
    if (details.has(slug)) return details.get(slug);
    const d = await ejg.explore.details(slug);
    details.set(slug, d);
    return d;
  }

  async function loadGenres() {
    if (state.genres.length) return state.genres;
    try {
      state.genres = (await ejg.explore.genres()) || [];
      emit();
    } catch {}
    return state.genres;
  }

  async function runCatalog(page) {
    const my = ++catSeq;
    const c = state.catalog;
    c.loading = true;
    c.error = "";
    emit();
    try {
      const r = await ejg.explore.browse(c.filters, page);
      if (my !== catSeq) return;
      // Sin repetir (una ficha actualizada puede cambiar de página entre peticiones).
      const seen = new Set(page > 1 ? c.items.map((x) => x.slug) : []);
      c.items = page > 1 ? c.items.concat(r.items.filter((x) => !seen.has(x.slug))) : r.items;
      c.page = r.page;
      c.pages = r.pages;
      c.total = r.total;
      c.filtered = !!r.filtered;
    } catch (e) {
      if (my !== catSeq) return;
      c.error = e.message || String(e);
      if (page <= 1) c.items = [];
    }
    c.loading = false;
    emit();
  }

  /**
   * Catálogo: cambia los filtros (se mezclan con los que hay) y vuelve a la
   * primera página. `delay`: espera por si se sigue escribiendo el texto.
   */
  function browse(patch = {}, delay = 0) {
    const c = state.catalog;
    c.filters = { ...c.filters, ...patch };
    c.filters.genres = [...new Set(c.filters.genres || [])].slice(0, MAX_GENRES);
    c.items = [];
    c.page = c.pages = c.total = 0;
    catSeq++;
    c.loading = true;
    c.error = "";
    emit();
    clearTimeout(catTimer);
    catTimer = setTimeout(() => runCatalog(1), delay);
  }

  /** Siguiente página del catálogo (para el scroll infinito). */
  function browseMore() {
    const c = state.catalog;
    if (c.loading || !c.page || c.page >= c.pages) return;
    runCatalog(c.page + 1);
  }

  /** Pone o quita un género (máx. MAX_GENRES). false si ya hay demasiados. */
  function toggleGenre(id) {
    const g = state.catalog.filters.genres || [];
    if (g.includes(id)) browse({ genres: g.filter((x) => x !== id) });
    else if (g.length >= MAX_GENRES) return false;
    else browse({ genres: [...g, id] });
    return true;
  }

  /** Quita los filtros (deja el orden). */
  function clearFilters() {
    browse({ ...emptyFilters(), sort: state.catalog.filters.sort });
  }

  /** Juegos parecidos a una ficha (comparten sus dos primeros géneros conocidos). */
  async function similar(r, limit = 12) {
    if (similarCache.has(r.slug)) return similarCache.get(r.slug);
    await loadGenres();
    const known = (r.tags || []).filter((t) => state.genres.some((g) => g.id === t && g.group === "genre")).slice(0, 2);
    if (!known.length) return [];
    try {
      const res = await ejg.explore.browse({ genres: known, sort: "date" }, 1);
      const list = res.items.filter((x) => x.slug !== r.slug).slice(0, limit);
      similarCache.set(r.slug, list);
      return list;
    } catch {
      return [];
    }
  }

  /** Vuelve a pedir las páginas del catálogo ya cargadas (salen de la caché) sin perder el sitio. */
  async function refreshCatalog() {
    const c = state.catalog;
    if (!c.page || c.loading) return;
    const my = ++catSeq;
    const upto = c.page;
    let items = [];
    let last = null;
    try {
      for (let p = 1; p <= upto; ) {
        const r = await ejg.explore.browse(c.filters, p);
        if (my !== catSeq) return;
        const seen = new Set(items.map((x) => x.slug));
        items = items.concat(r.items.filter((x) => !seen.has(x.slug)));
        last = r;
        if (r.page >= r.pages) break;
        p = r.page + 1;
      }
    } catch {
      return;
    }
    if (!last) return;
    c.items = items;
    c.page = last.page;
    c.pages = last.pages;
    c.total = last.total;
    c.filtered = !!last.filtered;
    emit();
  }

  // Llegó arte de Steam (cápsulas): se vuelve a pedir lo que se está viendo.
  let artTimer = 0;
  ejg.on?.("explore-art", () => {
    details.clear();
    similarCache.clear();
    clearTimeout(artTimer);
    artTimer = setTimeout(() => {
      if (state.home) loadHome(true);
      if (state.query) run(state.query, 1);
      refreshCatalog();
    }, 600);
  });

  /** Olvida las fichas guardadas (su estado cambia al descargar/instalar). */
  function refresh() {
    details.clear();
    similarCache.clear();
  }

  return { state, loadHome, search, more, details: get, refresh, loadGenres, browse, browseMore, toggleGenre, clearFilters, similar };
}

/**
 * Pide el texto de búsqueda: con mando abre el teclado en pantalla del host;
 * con teclado o ratón devuelve null (usa tu <input>).
 */
export async function askQuery(ejg, current = "", title = "Buscar juegos") {
  if (ejg.input.source !== "gamepad") return null;
  return ejg.ui.keyboard({ title, value: current, placeholder: "Nombre del juego" });
}

// ───────────────────────────── cola ─────────────────────────────

/**
 * Cola de descargas agrupada y viva. `onChange(groups)` con
 * {all, active, waiting, ready, installed, failed, busy}.
 */
export function createDownloads(ejg, onChange = () => {}) {
  const groups = () => {
    const all = ejg.downloads.all || [];
    return {
      all,
      active: all.filter((d) => d.state === "downloading" || d.state === "installing"),
      waiting: all.filter((d) => d.state === "queued" || d.state === "paused"),
      ready: all.filter((d) => d.state === "seeding" || d.state === "completed"),
      installed: all.filter((d) => d.state === "installed"),
      failed: all.filter((d) => d.state === "error"),
      /** Descargando o instalando algo ahora mismo. */
      busy: all.some((d) => d.state === "downloading" || d.state === "installing"),
      /** Progreso y velocidad totales de lo que se está bajando. */
      total: all
        .filter((d) => d.state === "downloading")
        .reduce((a, d) => ({ done: a.done + d.doneBytes, size: a.size + d.totalBytes, speed: a.speed + d.downBps }), { done: 0, size: 0, speed: 0 }),
    };
  };
  const off = ejg.downloads.onChange(() => onChange(groups()));
  return { groups, off };
}

// ───────────────────────────── archivos ─────────────────────────────

/**
 * Selección de archivos de una descarga preparada (`ejg.downloads.prepare`).
 * Lo obligatorio no se puede quitar; idiomas y extras sí.
 */
export function fileSelection(prepared) {
  const files = prepared.files || [];
  const selected = new Set(files.filter((f) => f.selected || f.required).map((f) => f.index));
  const langs = files.filter((f) => f.kind === "selective");
  const api = {
    files,
    required: files.filter((f) => f.required),
    languages: langs,
    optional: files.filter((f) => f.kind === "optional"),
    extra: files.filter((f) => f.kind === "extra"),
    isSelected: (i) => selected.has(i),
    toggle(i) {
      const f = files.find((x) => x.index === i);
      if (!f || f.required) return false;
      if (selected.has(i)) selected.delete(i);
      else selected.add(i);
      return true;
    },
    set(i, on) {
      const f = files.find((x) => x.index === i);
      if (!f || f.required) return;
      if (on) selected.add(i);
      else selected.delete(i);
    },
    get bytes() {
      return files.filter((f) => selected.has(f.index)).reduce((a, f) => a + f.size, 0);
    },
    /** Mensaje si la selección no vale ("" si vale). */
    get error() {
      if (langs.length && !langs.some((f) => selected.has(f.index))) return "Elige al menos un idioma";
      return "";
    },
    indices: () => [...selected].sort((a, b) => a - b),
    /** ¿Cabe en el disco? (con 512 MB de margen) */
    fits(freeBytes) {
      return freeBytes == null || freeBytes >= api.bytes + 512 * 1024 * 1024;
    },
  };
  return api;
}
