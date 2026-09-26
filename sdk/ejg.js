/*!
 * ejGames Theme SDK v1 — se inyecta automáticamente en el <head> de cada tema.
 *
 * El tema corre en un iframe aislado (origen null, sin red). Todo lo que
 * necesita lo pide al host a través de `window.ejg`, que habla por postMessage.
 * Documentación: docs/THEMES.md · Tipos: /_sdk/ejg.d.ts
 */
(function () {
  "use strict";
  if (window.ejg) return;

  var parent = window.parent;
  var seq = 0;
  var pending = new Map();
  var listeners = new Map();
  var state = { init: null, settings: {}, library: [], collections: [], profile: null, running: [], input: { source: "mouse", pad: "xbox" } };
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
  function applySettings(values) {
    var schema = (state.init && state.init.theme && state.init.theme.settings) || [];
    var byKey = {};
    schema.forEach(function (d) { byKey[d.key] = d; });
    var merged = {};
    schema.forEach(function (d) { merged[d.key] = d["default"]; });
    Object.keys(values || {}).forEach(function (k) { merged[k] = values[k]; });
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
      root.setAttribute("data-mode", m.data.mode || "desktop");
      applyInput();
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
    var global = e.key === "F11" || e.key === "F5" || (e.ctrlKey && (e.key === "f" || e.key === "," || e.key === "p" || e.key === "k"));
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
      isRunning: function (id) { return state.running.some(function (r) { return r.gameId === id; }); },
      onState: function (fn) { return on("game-state", fn); },
    },
    profiles: {
      current: function () { return state.profile; },
      switch: function () { return call("ui.open", { name: "profiles" }); },
    },
    stats: {
      get: function (days) { return call("stats.get", { days: days }); },
      recent: function (limit) { return call("stats.recent", { limit: limit }); },
    },
    storage: {
      getAll: function () { return call("storage.get"); },
      get: function (key) { return call("storage.get").then(function (all) { return all ? all[key] : undefined; }); },
      set: function (key, value) { return call("storage.set", { key: key, value: value === undefined ? null : value }); },
    },
    ui: {
      /** settings | game | profiles | search | add-folder | stats | theme | collections | menu */
      open: function (name, args) { return call("ui.open", { name: name, args: args || null }); },
      toast: function (message, kind) { return call("ui.toast", { message: message, kind: kind || "info" }); },
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
