// Mini helpers de DOM sin dependencias.

/**
 * Hyperscript: h("div", { class: "card", onclick: fn, "data-id": 3 }, "texto", otroNodo)
 * @param {string} tag
 * @param {Record<string, any>|null} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class" || k === "className") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "html") el.innerHTML = v;
      else if (k in el && typeof v !== "string") /** @type {any} */ (el)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Imagen perezosa con fallback: si falla, añade la clase "img-error". */
export function img(src, props = {}) {
  const el = h("img", { decoding: "async", loading: "lazy", draggable: "false", alt: "", ...props });
  if (src) el.src = src;
  else el.classList.add("img-empty");
  el.addEventListener("error", () => el.classList.add("img-error"), { once: true });
  el.addEventListener("load", () => el.classList.add("img-loaded"), { once: true });
  return el;
}

/** Iniciales para tarjetas sin portada ("Hollow Knight" → "HK"). */
export function initials(title) {
  return String(title || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/** Color estable a partir de un texto (para placeholders). */
export function hueOf(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Reconciliación por clave: reutiliza nodos existentes (rápido con cientos de juegos). */
export function keyed(container, items, key, render) {
  const old = new Map();
  for (const n of Array.from(container.children)) {
    const k = /** @type {any} */ (n).__key;
    if (k !== undefined) old.set(k, n);
  }
  const next = items.map((it) => {
    const k = key(it);
    const prev = old.get(k);
    const node = render(it, prev);
    /** @type {any} */ (node).__key = k;
    return node;
  });
  container.replaceChildren(...next);
  return next;
}
