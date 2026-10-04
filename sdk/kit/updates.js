// Aviso «hay una versión nueva del repack» para la ficha de un juego instalado
// desde Descargas. Sale solo si el juego trae `repackUpdate`.
//   const note = repackUpdateNote(game);   // HTMLElement | null
//   if (note) ficha.append(note);
// Lleva su propio estilo (colores del tema por --ejg-accent); para dárselo tú,
// pasa { styled: false } y usa las clases .ejg-upd, .ejg-upd-txt y .ejg-upd-btn.

import { h } from "./dom.js";

const t = (s, v) => (window.ejg && window.ejg.t ? window.ejg.t(s, v) : s);

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const css = document.createElement("style");
  css.textContent =
    ".ejg-upd{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:12px 0;padding:10px 14px;border-radius:8px;" +
    "background:color-mix(in srgb,var(--ejg-accent,#4f8cff) 16%,transparent);border:1px solid color-mix(in srgb,var(--ejg-accent,#4f8cff) 45%,transparent);color:inherit;font:inherit}" +
    ".ejg-upd-txt{flex:1 1 220px;min-width:0}.ejg-upd-txt b{display:block}.ejg-upd-txt small{opacity:.75;overflow-wrap:anywhere}" +
    ".ejg-upd-btn{cursor:pointer;font:inherit;padding:6px 14px;border-radius:6px;border:1px solid currentColor;background:transparent;color:inherit}" +
    ".ejg-upd-btn.main{background:var(--ejg-accent,#4f8cff);border-color:transparent;color:#fff}";
  (document.head || document.documentElement).appendChild(css);
}

/**
 * @param {{id:number, title?:string, repackUpdate?: {slug:string, installed:string, latest:string}}} g
 * @param {{styled?: boolean, onOpen?: () => void, onDismiss?: () => void}} [opts]
 * @returns {HTMLElement|null}
 */
export function repackUpdateNote(g, opts = {}) {
  const u = g && g.repackUpdate;
  if (!u) return null;
  if (opts.styled !== false) injectStyle();
  const note = h(
    "div",
    { class: "ejg-upd", "data-focus-group": "repack-update" },
    h("div", { class: "ejg-upd-txt" }, h("b", null, t("Hay una versión nueva del repack")), h("small", null, `${u.installed}  →  ${u.latest}`)),
    h(
      "button",
      { class: "ejg-upd-btn main", "data-focus": "", onclick: opts.onOpen || (() => window.ejg.downloads.open("repack", u.slug)) },
      t("Ver en la tienda"),
    ),
    h(
      "button",
      {
        class: "ejg-upd-btn",
        "data-focus": "",
        onclick: () => {
          note.remove();
          (opts.onDismiss || (() => window.ejg.game.dismissRepackUpdate(g.id)))();
        },
      },
      t("Ocultar"),
    ),
  );
  return note;
}
