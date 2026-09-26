// Navegación espacial para mando/teclado.
//
// Marca los elementos navegables con `data-focus`. Agrupa filas/columnas con
// `data-focus-group` (se recuerda el último foco de cada grupo) y encierra
// diálogos con `data-focus-trap`.
//
// Con ratón, pasar por encima enfoca el elemento y al salir se le quita la
// marca visual (`is-focused`), para que no se quede "pegado". El foco se
// recuerda: con teclado o mando vuelve a verse donde estaba.

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function visible(el) {
  if (!el.isConnected || el.hasAttribute("disabled") || el.closest("[hidden],[inert]")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * `onChange(el, prev, { pointer })`: `pointer` es true si el foco llegó al pasar
 * el ratón (no conviene desplazar ni seleccionar nada en ese caso: el elemento
 * se movería de debajo del cursor).
 *
 * @param {{ root?: HTMLElement, selector?: string, onChange?: (el: HTMLElement, prev: HTMLElement|null, info: { pointer: boolean }) => void,
 *           hover?: boolean, scroll?: "nearest"|"center"|"none", sound?: boolean }} [opts]
 */
export function createFocus(opts = {}) {
  const root = opts.root || document.body;
  const selector = opts.selector || "[data-focus]";
  const scrollMode = opts.scroll || "nearest";
  /** @type {HTMLElement|null} */
  let current = null;

  function scope() {
    const trap = current && current.closest("[data-focus-trap]");
    const traps = Array.from(root.querySelectorAll("[data-focus-trap]")).filter(visible);
    return trap || traps[traps.length - 1] || root;
  }

  function candidates() {
    return /** @type {HTMLElement[]} */ (Array.from(scope().querySelectorAll(selector))).filter(visible);
  }

  function mouseMode() {
    // Los temas lo marcan en <html> (SDK); el host, también en <body>.
    return (document.documentElement.getAttribute("data-input") || document.body?.getAttribute("data-input")) === "mouse";
  }

  /** Vuelve a pintar el foco actual (tras quitarlo al salir el ratón). */
  function show() {
    if (current && current.isConnected && !current.classList.contains("is-focused")) {
      current.classList.add("is-focused");
      current.setAttribute("data-focused", "");
    }
  }

  function focus(el, o = {}) {
    if (el && el === current) {
      show();
      return false;
    }
    if (!el) return false;
    const prev = current;
    if (prev) {
      prev.classList.remove("is-focused");
      prev.removeAttribute("data-focused");
    }
    current = el;
    el.classList.add("is-focused");
    el.setAttribute("data-focused", "");
    const group = el.closest("[data-focus-group]");
    if (group) /** @type {any} */ (group).__ejgLast = el;
    // Con el ratón no se mueve el foco del navegador: arrastraría :focus-visible
    // (anillos) de un elemento a otro sin que el usuario haya usado el teclado.
    if (!o.pointer) {
      try {
        el.focus({ preventScroll: true });
      } catch {}
    }
    if (!o.noScroll && scrollMode !== "none") {
      el.scrollIntoView({ block: scrollMode, inline: scrollMode, behavior: o.instant ? "auto" : "smooth" });
    }
    if (opts.onChange) opts.onChange(el, prev, { pointer: !!o.pointer });
    if (opts.sound !== false && prev && !o.silent && window.ejg) window.ejg.sound.play("move");
    return true;
  }

  function move(dir) {
    const d = DIRS[dir];
    if (!d) return false;
    // Con teclado/mando el foco se ve siempre.
    show();
    const list = candidates();
    if (!current || !current.isConnected || !visible(current)) return focus(list[0] || null);
    const a = current.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const curGroup = current.closest("[data-focus-group]");
    let best = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === current) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      let primary, secondary, overlap;
      if (d[0] !== 0) {
        primary = d[0] > 0 ? b.left - a.right : a.left - b.right;
        if (primary < -a.width / 2) continue;
        overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
        secondary = Math.abs(by - ay);
      } else {
        primary = d[1] > 0 ? b.top - a.bottom : a.top - b.bottom;
        if (primary < -a.height / 2) continue;
        overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;
        secondary = Math.abs(bx - ax);
      }
      const score = Math.max(primary, 0) + secondary * (overlap ? 0.5 : 2.5);
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return false;
    // Al entrar en otro grupo, volver al último elemento que tuvo foco allí.
    const g = best.closest("[data-focus-group]");
    if (g && g !== curGroup) {
      const last = /** @type {any} */ (g).__ejgLast;
      if (last && last.isConnected && visible(last)) best = last;
    }
    return focus(best);
  }

  function first(within) {
    const el = /** @type {HTMLElement|null} */ ((within || scope()).querySelector(selector));
    return el ? focus(el, { instant: true }) : false;
  }

  function onPointer(e) {
    const el = /** @type {HTMLElement} */ (e.target).closest?.(selector);
    if (el && root.contains(el)) focus(/** @type {HTMLElement} */ (el), { noScroll: true, silent: true, pointer: true });
  }
  function onPointerOut(e) {
    if (!current || !mouseMode()) return;
    const from = /** @type {HTMLElement} */ (e.target).closest?.(selector);
    const to = /** @type {Node|null} */ (e.relatedTarget);
    if (from === current && !(to && current.contains(to))) {
      current.classList.remove("is-focused");
      current.removeAttribute("data-focused");
    }
  }
  // Al volver al teclado o al mando, el foco reaparece.
  const unInput = window.ejg?.on?.("input", (d) => {
    if (d && d.source !== "mouse") show();
  });
  if (opts.hover !== false) {
    root.addEventListener("pointerover", onPointer);
    root.addEventListener("pointerout", onPointerOut);
  }

  return {
    get current() {
      return current;
    },
    focus,
    move,
    first,
    /** Vuelve a enfocar el actual (p. ej. tras cerrar un overlay del host). */
    restore() {
      if (current && current.isConnected) {
        if (!mouseMode()) show();
        try {
          current.focus({ preventScroll: true });
        } catch {}
      } else first();
    },
    reset() {
      current = null;
    },
    destroy() {
      root.removeEventListener("pointerover", onPointer);
      root.removeEventListener("pointerout", onPointerOut);
      if (typeof unInput === "function") unInput();
    },
  };
}

/**
 * Conecta la navegación a `ejg.input`: flechas/stick mueven, accept hace click.
 * Devuelve la función para desconectar.
 */
export function bindNav(focus, handlers = {}) {
  return window.ejg.input.on("nav", (e) => {
    if (handlers[e.action] && handlers[e.action](e) !== false) {
      e.preventDefault();
      return;
    }
    if (e.action in DIRS) {
      if (focus.move(e.action)) e.preventDefault();
      else if (handlers.edge) handlers.edge(e.action, e);
      return;
    }
    if (e.action === "accept" && focus.current) {
      e.preventDefault();
      window.ejg.sound.play("select");
      focus.current.click();
    }
  });
}
