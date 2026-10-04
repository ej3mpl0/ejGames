/*!
 * ejGames Theme SDK v1 — se inyecta automáticamente en el <head> de cada tema.
 *
 * El tema corre en un iframe aislado (origen null, sin red). Todo lo que
 * necesita lo pide al host a través de `window.ejg`, que habla por postMessage.
 * Documentación: https://ej3mplo.mintlify.site/referencia/sdk · Tipos: /_sdk/ejg.d.ts
 */
(function () {
  "use strict";
  if (window.ejg) return;

  var parent = window.parent;
  var seq = 0;
  var pending = new Map();
  var listeners = new Map();
  var state = { init: null, settings: {}, library: [], collections: [], profile: null, running: [], input: { source: "mouse", pad: "xbox" }, downloads: [], wishlist: [], explore: true, page: null, eventMode: "auto", season: null, rawSettings: {}, lang: "es", strings: {} };
  var readyResolve;
  var readyPromise = new Promise(function (r) { readyResolve = r; });
  var initialized = false;

  function post(msg) {
    msg.__ejg = 1;
    // El host valida event.source; el origen del iframe es "null".
    parent.postMessage(msg, "*");
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      post({ type: "call", id: id, method: method, params: params === undefined ? null : params });
    });
  }

  function emit(name, data) {
    var set = listeners.get(name);
    if (!set) return;
    set.forEach(function (fn) {
      try { fn(data); } catch (e) { console.error("[ejg] listener " + name, e); }
    });
  }

  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return function () { listeners.get(name).delete(fn); };
  }

  // ───────────── ajustes → variables CSS y atributos ─────────────
  var root = document.documentElement;
  function cssValue(def, v) {
    if (v === null || v === undefined || v === "") return null;
    switch (def && def.type) {
      case "range":
      case "number":
        return def.unit ? v + def.unit : String(v);
      case "toggle":
        return v ? "1" : "0";
      case "image":
        return 'url("' + String(v).replace(/"/g, "") + '")';
      case "font":
        return String(v).indexOf(",") >= 0 ? String(v) : '"' + v + '", system-ui, sans-serif';
      default:
        return String(v);
    }
  }
  function kebab(k) { return k.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }); }
  /**
   * Evento de temporada (Halloween…): mientras dura, las opciones de color y el
   * fondo del tema toman los del evento (los del usuario vuelven al acabar).
   * Un tema puede afinarlo con `[data-season="<id>"]` en su CSS.
   */
  function seasonOverrides(schema, ev) {
    var o = {};
    if (!ev) return o;
    var pal = ev.palette || {};
    schema.forEach(function (d) {
      if (d.type === "color" && (d.key === "accent" || d.key === "bg" || d.key === "panel") && pal[d.key]) o[d.key] = pal[d.key];
      else if (d.type === "color" && d.key === "play" && pal.green) o.play = "#4fae2c";
      else if (d.type === "image" && d.key === "wallpaper" && ev.wallpaper) o.wallpaper = ev.wallpaper;
      else if (d.type === "toggle" && d.key === "dark") o.dark = true;
    });
    return o;
  }
  function applySettings(values) {
    state.rawSettings = values || {};
    var schema = (state.init && state.init.theme && state.init.theme.settings) || [];
    var byKey = {};
    schema.forEach(function (d) { byKey[d.key] = d; });
    var merged = {};
    schema.forEach(function (d) { merged[d.key] = d["default"]; });
    Object.keys(values || {}).forEach(function (k) { merged[k] = values[k]; });
    var so = seasonOverrides(schema, state.season);
    Object.keys(so).forEach(function (k) { merged[k] = so[k]; });
    state.settings = merged;
    Object.keys(merged).forEach(function (k) {
      var def = byKey[k];
      var v = cssValue(def, merged[k]);
      var name = "--ejg-" + kebab(k);
      if (v === null) root.style.removeProperty(name); else root.style.setProperty(name, v);
      if (def && (def.type === "toggle" || def.type === "select")) {
        root.setAttribute("data-" + kebab(k), def.type === "toggle" ? (merged[k] ? "on" : "off") : String(merged[k]));
      }
    });
  }
  /** Atributo, variables y la capa de ambiente del evento (/_sdk/events/<id>/season.css|js). */
  function applySeason() {
    var ev = state.season;
    var id = ev ? ev.id : null;
    if (root.getAttribute("data-season") === (id || null)) return;
    ["ejg-season-css", "ejg-season-js"].forEach(function (x) {
      var el = document.getElementById(x);
      if (el) el.parentNode.removeChild(el);
    });
    var layer = document.getElementById("ejg-season");
    if (layer) layer.parentNode.removeChild(layer);
    if (!ev) {
      root.removeAttribute("data-season");
      ["accent", "green", "violet", "bg", "panel", "text"].forEach(function (k) { root.style.removeProperty("--ejg-season-" + k); });
      return;
    }
    root.setAttribute("data-season", id);
    var pal = ev.palette || {};
    Object.keys(pal).forEach(function (k) { root.style.setProperty("--ejg-season-" + k, pal[k]); });
    var link = document.createElement("link");
    link.id = "ejg-season-css";
    link.rel = "stylesheet";
    link.href = "/_sdk/events/" + id + "/season.css";
    (document.head || root).appendChild(link);
    var sc = document.createElement("script");
    sc.id = "ejg-season-js";
    sc.type = "module";
    // Con ?t: un módulo ya cargado no se volvería a ejecutar al volver el evento.
    sc.src = "/_sdk/events/" + id + "/season.js?t=" + Date.now();
    (document.head || root).appendChild(sc);
  }
  function applyCss(css) {
    var el = document.getElementById("ejg-custom-css");
    if (!el) {
      el = document.createElement("style");
      el.id = "ejg-custom-css";
      (document.head || root).appendChild(el);
    }
    el.textContent = css || "";
    // Siempre el último, para ganar a las hojas del tema.
    if (el.parentNode && el !== el.parentNode.lastElementChild) el.parentNode.appendChild(el);
  }

  // ───────────── idioma ─────────────
  // La clave de cada texto es el propio texto en español; sin traducción se ve
  // el original. Las traducciones del tema van en <tema>/i18n/en.json.
  function t(s, vars) {
    var out = Object.prototype.hasOwnProperty.call(state.strings, s) ? state.strings[s] : s;
    if (vars) Object.keys(vars).forEach(function (k) { out = out.split("{" + k + "}").join(String(vars[k])); });
    return out;
  }
  function locale() { return state.lang === "en" ? "en-US" : "es-ES"; }
  /** Elementos con data-t: su texto y sus atributos placeholder/title/aria-label. */
  function translateDom(rootEl) {
    if (state.lang === "es") return;
    var list = (rootEl || document).querySelectorAll("[data-t]");
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el.children.length && el.textContent.trim()) {
        var key = el.getAttribute("data-t") || el.textContent.trim();
        el.setAttribute("data-t", key);
        el.textContent = t(key);
      }
      ["placeholder", "title", "aria-label", "alt"].forEach(function (a) {
        var k = "data-t-" + a, v = el.getAttribute(k) || el.getAttribute(a);
        if (v) { el.setAttribute(k, v); el.setAttribute(a, t(v)); }
      });
    }
  }

  // ───────────── mensajes del host ─────────────
  window.addEventListener("message", function (ev) {
    if (ev.source !== parent) return;
    var m = ev.data;
    if (!m || m.__ejg !== 1) return;
    if (m.type === "result") {
      var p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || "error"));
      return;
    }
    if (m.type === "init") {
      state.init = m.data;
      state.library = m.data.library || [];
      state.collections = m.data.collections || [];
      state.profile = m.data.profile;
      state.running = m.data.running || [];
      if (m.data.input) state.input = m.data.input;
      state.downloads = m.data.downloads || [];
      state.wishlist = m.data.wishlist || [];
      state.explore = m.data.explore !== false;
      state.page = m.data.page || null;
      state.eventMode = m.data.eventMode || "auto";
      state.season = m.data.season || null;
      state.lang = m.data.lang === "en" ? "en" : "es";
      state.strings = m.data.strings || {};
      root.setAttribute("lang", state.lang);
      translateDom();
      root.setAttribute("data-mode", m.data.mode || "desktop");
      applyInput();
      applySeason();
      applySettings(m.data.settings);
      applyCss(m.data.customCss);
      if (!initialized) {
        initialized = true;
        readyResolve(api);
        post({ type: "ready" });
      }
      return;
    }
    if (m.type === "event") {
      var d = m.data;
      if (m.name === "nav") {
        var nev = { action: d.action, source: d.source, repeat: !!d.repeat, handled: false, preventDefault: function () { nev.handled = true; } };
        emit("nav", nev);
        if (!nev.handled && nev.action === "back") post({ type: "nav-unhandled", action: "back" });
        return;
      }
      switch (m.name) {
        case "library":
          if (d.full) state.library = d.full;
          else {
            var byId = new Map(state.library.map(function (g) { return [g.id, g]; }));
            (d.changed || []).forEach(function (g) { byId.set(g.id, g); });
            (d.removed || []).forEach(function (id) { byId["delete"](id); });
            state.library = Array.from(byId.values()).sort(function (a, b) {
              return a.sortTitle < b.sortTitle ? -1 : a.sortTitle > b.sortTitle ? 1 : 0;
            });
          }
          break;
        case "settings": applySettings(d); break;
        case "css": applyCss(d); break;
        case "collections": state.collections = d; break;
        case "profile": state.profile = d; break;
        case "mode": root.setAttribute("data-mode", d); break;
        case "running": state.running = d; break;
        case "input": state.input = d; applyInput(); break;
        case "downloads": state.downloads = d || []; break;
        case "wishlist": state.wishlist = d || []; break;
        case "explore": state.explore = !!(d && d.enabled); break;
        case "season":
          state.eventMode = (d && d.mode) || "auto";
          state.season = (d && d.season) || null;
          applySeason();
          applySettings(state.rawSettings);
          emit("settings", state.rawSettings);
          break;
        case "page": state.page = d || null; break;
      }
      emit(m.name, d);
    }
  });

  // ───────────── dispositivo de entrada (para mostrar los glifos correctos) ─────────────
  // Con mando: sin cursor y sin :hover (el puntero quieto encima de algo no debe
  // parecer un segundo foco). El primer movimiento del ratón lo devuelve todo.
  var inputStyle = document.createElement("style");
  inputStyle.textContent =
    ':root[data-input="gamepad"], :root[data-input="gamepad"] * { cursor: none !important; }' +
    ':root[data-input="gamepad"] body { pointer-events: none; }';
  (document.head || root).appendChild(inputStyle);
  function applyInput() {
    root.setAttribute("data-input", state.input.source || "mouse");
    root.setAttribute("data-pad", state.input.pad || "xbox");
  }
  // Teclado o ratón dentro del tema: se avisa al host (que difunde el cambio).
  function localInput(source) {
    if (state.input.source === source) return;
    state.input = { source: source, pad: state.input.pad };
    applyInput();
    emit("input", state.input);
    post({ type: "input-source", source: source });
  }
  var lastMove = 0;
  window.addEventListener("mousemove", function () {
    var now = Date.now();
    if (now - lastMove < 250) return;
    lastMove = now;
    localInput("mouse");
  }, { passive: true });

  // ───────────── teclado → nav + atajos globales al host ─────────────
  var KEYMAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    Enter: "accept", " ": "accept", Escape: "back", Backspace: "back",
    PageUp: "lb", PageDown: "rb", Home: "lt", End: "rt", ContextMenu: "menu",
    e: "x", E: "x", f: "y", F: "y",
  };
  function isTyping(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  }
  window.addEventListener("keydown", function (e) {
    localInput("keyboard");
    var k = (e.key || "").toLowerCase();
    var global = e.key === "F11" || e.key === "F5" || (e.ctrlKey && (k === "f" || k === "," || k === "p" || k === "k" || k === "e" || k === "j"));
    if (global) {
      e.preventDefault();
      post({ type: "key", key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
      return;
    }
    if (isTyping(e.target) && e.key !== "Escape" && e.key !== "Enter" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (isTyping(e.target) && (e.key === " " || e.key === "Backspace")) return;
    if ((e.ctrlKey || e.altKey || e.metaKey) && e.key.length === 1) return;
    var action = KEYMAP[e.key];
    if (e.key === "Tab") action = e.shiftKey ? "lb" : "rb";
    if (!action) return;
    var ev = { action: action, source: "keyboard", repeat: e.repeat, handled: false, preventDefault: function () { ev.handled = true; } };
    emit("nav", ev);
    if (ev.handled || action !== "back") e.preventDefault();
    if (action === "back" && !ev.handled) post({ type: "nav-unhandled", action: "back" });
  }, true);

  // Arrastrar la ventana desde elementos marcados con data-ejg-drag.
  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    var t = e.target;
    while (t && t !== document) {
      if (t.hasAttribute && t.hasAttribute("data-ejg-nodrag")) return;
      if (t.hasAttribute && t.hasAttribute("data-ejg-drag")) {
        if (e.detail === 2) call("window", "toggle-maximize");
        else call("window", "drag");
        return;
      }
      t = t.parentNode;
    }
  });

  // Latido para el watchdog del host (un temporizador cada 5 s).
  setInterval(function () { post({ type: "heartbeat" }); }, 5000);
  window.addEventListener("error", function (e) { post({ type: "error", message: String(e.message || e) }); });
  window.addEventListener("unhandledrejection", function (e) { post({ type: "error", message: String(e.reason && e.reason.message || e.reason) }); });

  var api = {
    version: 1,
    /** Espera al host. Resuelve con `ejg` cuando ya hay datos. */
    ready: function () { return readyPromise; },
    on: on,
    get init() { return state.init; },
    get settings() { return state.settings; },
    get profile() { return state.profile; },
    get mode() { return root.getAttribute("data-mode") || "desktop"; },
    /** Idioma de la interfaz: "es" | "en". */
    get lang() { return state.lang; },
    /** Locale para Intl / toLocaleString ("es-ES" | "en-US"). */
    get locale() { return locale(); },
    /** Traduce un texto (la clave es el texto en español) y sustituye {nombre} por vars.nombre. */
    t: t,
    /** Singular o plural: tn(n, "{n} juego", "{n} juegos"). */
    tn: function (n, one, many, vars) {
      var v = { n: Number(n).toLocaleString(locale()) };
      Object.keys(vars || {}).forEach(function (k) { v[k] = vars[k]; });
      return t(n === 1 ? one : many, v);
    },
    /** Traduce los elementos con data-t de un trozo de DOM recién creado (o de todo el documento). */
    translate: translateDom,

    library: {
      /** Juegos visibles del perfil (copia en memoria, sin llamada). */
      get all() { return state.library; },
      get: function () { return Promise.resolve(state.library); },
      byId: function (id) { return state.library.find(function (g) { return g.id === id; }); },
      onChange: function (fn) { return on("library", fn); },
      get collections() { return state.collections; },
    },
    game: {
      details: function (id) { return call("game.details", { id: id }); },
      achievements: function (id) { return call("game.achievements", { id: id }); },
      launch: function (id) { return call("game.launch", { id: id }); },
      favorite: function (id, value) { return call("game.favorite", { id: id, value: value }); },
      hide: function (id, value) { return call("game.hide", { id: id, value: value }); },
      rate: function (id, value) { return call("game.rate", { id: id, value: value }); },
      edit: function (id) { return call("ui.open", { name: "game", args: { id: id } }); },
      openFolder: function (id) { return call("game.folder", { id: id }); },
      /** Crea el acceso directo del juego en el escritorio (abre ejGames con --play). Resuelve con la ruta del .lnk. */
      shortcut: function (id) { return call("game.shortcut", { id: id }); },
      /** Lo añade a Steam como juego que no es de Steam (con Steam cerrado). Resuelve con un mensaje. */
      addToSteam: function (id) { return call("game.addToSteam", { id: id }); },
      /** Cuánto dura según HowLongToBeat: {main, extra, complete} en horas, o null. */
      hltb: function (id) { return call("game.hltb", { id: id }); },
      /** Oculta el aviso de repack nuevo de un juego (vuelve si sale otra versión). */
      dismissRepackUpdate: function (id) { return call("game.repackDismiss", { id: id }); },
      /** Busca ya versiones nuevas de los repacks instalados; resuelve con cuántos juegos cambiaron. */
      checkRepackUpdates: function () { return call("game.repackCheck"); },
      /** Abre el diálogo «Desinstalar» del host (el usuario confirma). */
      uninstall: function (id) { return call("game.uninstall", { id: id }); },
      isRunning: function (id) { return state.running.some(function (r) { return r.gameId === id; }); },
      onState: function (fn) { return on("game-state", fn); },
    },
    profiles: {
      /** Perfil local activo: {id, name, avatar, color, themeId}. */
      current: function () { return state.profile; },
      /** Selector de perfiles del host. */
      switch: function () { return call("ui.open", { name: "profiles" }); },
      /** Tu perfil en corto (sin llamada): {id, name, avatarUrl, frame, background, backgroundImageUrl, color, level, xp, badges, featuredBadge}. */
      get me() { return state.page; },
      /** Cambió tu perfil: al guardar en el editor, al subir de nivel o al ganar una insignia. */
      onChange: function (fn) { return on("page", fn); },
      /** Tu perfil entero: lo de `me` y además profile (resumen, vitrinas…), summary (juegos y estadísticas),
       *  activity (partidas y logros) y presence (a qué juegas ahora). */
      view: function () { return call("profiles.view"); },
      /** Tu perfil en la ventana del host (o en el tema, si lo pinta). */
      open: function () { return call("ui.open", { name: "profile" }); },
      /** Página de insignias (nivel, experiencia y lo que falta para cada una). */
      badges: function () { return call("ui.open", { name: "badges" }); },
      /** Editor del perfil del host (avatar, marco, fondo, vitrinas…). */
      edit: function () { return call("ui.open", { name: "profile-editor" }); },
    },
    stats: {
      get: function (days) { return call("stats.get", { days: days }); },
      recent: function (limit) { return call("stats.recent", { limit: limit }); },
      /** Resumen de un año natural (por defecto el actual): horas, top de juegos, meses, rachas, logros… */
      year: function (year) { return call("stats.year", { year: year == null ? null : year }); },
    },
    storage: {
      getAll: function () { return call("storage.get"); },
      get: function (key) { return call("storage.get").then(function (all) { return all ? all[key] : undefined; }); },
      set: function (key, value) { return call("storage.set", { key: key, value: value === undefined ? null : value }); },
    },
    ui: {
      /** settings | game | profiles | search | add-folder | stats | theme | collections | menu | explore | downloads
       *  | guides, trainer, map ({id: gameId}) | profile | badges | profile-editor */
      open: function (name, args) { return call("ui.open", { name: name, args: args || null }); },
      toast: function (message, kind) { return call("ui.toast", { message: message, kind: kind || "info" }); },
      /** El host pide abrir una vista del tema: fn({view: "explore"|"downloads"|"repack"|"guides", slug?, gameId?, guideId?}). */
      onView: function (fn) { return on("ui:view", fn); },
      /** Teclado en pantalla del host (para escribir con el mando). Resuelve con el texto o null. */
      keyboard: function (opts) { return call("ui.keyboard", opts || {}); },
    },
    season: {
      /** Ajuste del usuario: "auto" (en sus fechas) | "on" | "off". */
      get mode() { return state.eventMode; },
      /** Evento activo ("halloween") o null. Datos y piezas: /_sdk/kit/events.js. */
      get id() { return state.season ? state.season.id : null; },
      /** El evento activo con su paleta y su arte, o null. */
      get event() { return state.season; },
      /** Empieza o acaba un evento (o cambia el ajuste): fn({mode, season}). */
      onChange: function (fn) { return on("season", fn); },
    },
    explore: {
      /** Explorar activado en los ajustes. */
      get enabled() { return state.explore; },
      onEnabled: function (fn) { return on("explore", function (d) { fn(!!(d && d.enabled)); }); },
      /** {sections: [{id, title, items}]}: populares (hoy, semana, mes) y novedades. */
      home: function () { return call("explore.home"); },
      /** {query, items, page, pages, total}. Sin texto: novedades. */
      search: function (query, page) { return call("explore.search", { query: query || "", page: page || 1 }); },
      /** Catálogo con filtros: {query, genres: [id], sort: "date"|"modified"|"title", maxGb, hideOwned}.
       *  Devuelve lo mismo que search; para la página siguiente, pide `page + 1` de la respuesta. */
      browse: function (filters, page) { return call("explore.browse", { filters: filters || {}, page: page || 1 }); },
      /** Géneros para filtrar: [{id, name, group: "genre"|"view"|"setting"}]. */
      genres: function () { return call("explore.genres"); },
      /** Ficha completa: capturas, características, descripción… */
      details: function (slug) { return call("explore.details", { slug: slug }); },
      /** Abre la ficha en la web oficial (navegador del sistema). */
      openPage: function (slug) { return call("explore.openPage", { slug: slug }); },
      /** Lista de deseados: los juegos de la tienda que el usuario quiere. Por perfil y solo en este PC. */
      wishlist: {
        /** [{...repack, addedAt}], la última añadida primero (con su estado al día). */
        get items() { return state.wishlist; },
        has: function (slug) { return state.wishlist.some(function (w) { return w.slug === slug; }); },
        add: function (slug) { return call("explore.wishlistAdd", { slug: slug }); },
        remove: function (slug) { return call("explore.wishlistRemove", { slug: slug }); },
        /** Añade o quita; resuelve con true si queda en la lista. */
        toggle: function (slug) {
          var on = this.has(slug);
          return (on ? this.remove(slug) : this.add(slug)).then(function () { return !on; });
        },
        onChange: function (fn) { return on("wishlist", fn); },
      },
    },
    guides: {
      /** Guías de la comunidad de Steam de un juego: {appid, items, page, pages, total, next, filtered}.
       *  query: {page, sort: "toprated"|"trend"|"mostrecent", query, category, allLanguages}. */
      list: function (gameId, query) { return call("guides.list", { gameId: gameId, query: query || {} }); },
      /** Una guía entera en bloques (sin HTML): {title, authors, intro, sections: [{title, blocks}], pinned, progress…}. */
      get: function (id) { return call("guides.get", { id: String(id) }); },
      /** Guardadas y leídas hace poco de un juego: {pinned, recent}. */
      shelf: function (gameId) { return call("guides.shelf", { gameId: gameId }); },
      /** Guardar (o no) una guía: sale primero y se puede leer sin conexión. */
      pin: function (gameId, guide, value) {
        return call("guides.pin", { gameId: gameId, id: String(guide.id), title: guide.title || "", author: guide.author || (guide.authors || [])[0] || "", preview: guide.preview || null, value: value !== false });
      },
      /** Por dónde vas (sección y 0..1 dentro de ella). */
      progress: function (gameId, guide, section, scroll) {
        return call("guides.progress", { gameId: gameId, id: String(guide.id), title: guide.title || "", author: guide.author || (guide.authors || [])[0] || "", preview: guide.preview || null, section: section || 0, scroll: scroll || 0 });
      },
      /** La guía en la web de Steam (navegador del sistema). */
      openInBrowser: function (id) { return call("guides.openInBrowser", { id: String(id) }); },
      /** Un enlace de una guía ya leída (span.href o el url de un vídeo). */
      openLink: function (href) { return call("guides.openLink", { href: href }); },
    },
    saves: {
      /** Partidas guardadas del juego: {paths: [{path, source, bytes, files}], snapshots: [{id, at, size, note}], known}. */
      info: function (gameId) { return call("saves.info", { id: gameId }); },
      /** Copia ahora; resuelve con la copia, o null si no hay cambios desde la última. */
      backup: function (gameId) { return call("saves.backup", { id: gameId }); },
      /** Restaura una copia (con el juego cerrado); resuelve con los archivos restaurados. */
      restore: function (gameId, snapshotId) { return call("saves.restore", { id: gameId, snapshot: snapshotId }); },
      onChange: function (fn) { return on("saves", fn); },
    },
    trainer: {
      /** Trainer de FLiNG instalado para el juego, o null:
       *  {name, title, options (cuántas), gameVersion, autoStart, present, anticheat}. */
      info: function (gameId) { return call("trainer.info", { gameId: gameId }); },
      /** Ventana de trucos del host: buscar, ver opciones, instalar (lo confirma
       *  el usuario) y gestionar. Durante la partida, se usan desde el overlay. */
      open: function (gameId) { return call("ui.open", { name: "trainer", args: { id: gameId } }); },
    },
    maps: {
      /** Mapa de Map Genie del juego: {game: {name, maps: [nombre]} | null, none}. */
      info: function (gameId) { return call("maps.info", { gameId: gameId }); },
      /** Abre el mapa en una ventana del host. */
      open: function (gameId) { return call("ui.open", { name: "map", args: { id: gameId } }); },
    },
    downloads: {
      /** Lista en memoria (se actualiza sola, como mucho una vez por segundo). */
      get all() { return state.downloads; },
      list: function () { return call("downloads.list"); },
      onChange: function (fn) { return on("downloads", fn); },
      byId: function (id) { return state.downloads.find(function (d) { return d.id === id; }); },
      /** {downloadDir, installDir, configured} */
      defaults: function () { return call("downloads.defaults"); },
      /** Pide la lista de archivos del torrent: {token, files, totalBytes, dir, freeBytes, …}. */
      prepare: function (slug) { return call("downloads.prepare", { slug: slug }); },
      cancelPrepare: function (key) { return call("downloads.cancelPrepare", { key: key }); },
      /** Empieza con los archivos elegidos (índices). `dir`: una carpeta de pickFolder(). */
      start: function (token, files, dir) { return call("downloads.start", { token: token, files: files, dir: dir || null }); },
      /** Sin id: todas. */
      pause: function (id) { return call("downloads.pause", { id: id == null ? null : id }); },
      resume: function (id) { return call("downloads.resume", { id: id == null ? null : id }); },
      move: function (id, pos) { return call("downloads.move", { id: id, pos: pos }); },
      remove: function (id, deleteFiles) { return call("downloads.remove", { id: id, deleteFiles: !!deleteFiles }); },
      /** Borra los archivos de un repack ya instalado. */
      deleteFiles: function (id) { return call("downloads.deleteFiles", { id: id }); },
      install: function (id) { return call("downloads.install", { id: id }); },
      /** Tras instalar, si no se supo dónde quedó el juego: elegir su carpeta. */
      locate: function (id) { return call("downloads.locate", { id: id }); },
      openFolder: function (id) { return call("downloads.openFolder", { id: id }); },
      /** Diálogo de carpeta del host: {path, freeBytes} o null. */
      pickFolder: function (current) { return call("downloads.pickFolder", { current: current || null }); },
      /** Abre las ventanas del host (para temas sin vistas propias). */
      open: function (view, slug) { return call("downloads.open", { view: view || "explore", slug: slug || null }); },
    },
    input: {
      /** fn({action, source, repeat, preventDefault}) — up/down/left/right/accept/back/x/y/lb/rb/lt/rt/menu/view */
      on: function (event, fn) { return on(event === "nav" ? "nav" : event, fn); },
      /** "mouse" | "keyboard" | "gamepad" */
      get source() { return state.input.source; },
      /** "xbox" | "playstation" | "nintendo" | "generic" */
      get pad() { return state.input.pad; },
    },
    sound: {
      play: function (name) { post({ type: "sound", name: name }); },
    },
    window: {
      minimize: function () { return call("window", "minimize"); },
      maximize: function () { return call("window", "toggle-maximize"); },
      close: function () { return call("window", "close"); },
      fullscreen: function (v) { return call("window", v === undefined ? "fullscreen" : v ? "fullscreen-on" : "fullscreen-off"); },
    },
    app: {
      info: function () { return call("app.info"); },
    },
    /** Media URL helper: devuelve la mejor URL disponible de un tipo. */
    art: function (game, kind, thumb) {
      var m = (game && game.media) || {};
      if (kind === "cover") return thumb ? m.coverThumb || m.cover : m.cover;
      if (kind === "hero") return thumb ? m.heroThumb || m.hero : m.hero;
      return m[kind];
    },
  };
  window.ejg = api;
  post({ type: "hello", sdk: 1 });
})();
