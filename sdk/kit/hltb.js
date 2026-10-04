// «Cuánto dura» (HowLongToBeat) para la ficha de un juego: historia, extras y
// completarlo, con una barra de lo que llevas jugado.
//   ficha.append(howLongNote(game));   // se rellena solo; si no hay dato, desaparece
// Lleva su propio estilo (--ejg-accent); { styled: false } para ponerlo tú
// (clases .ejg-hl, .ejg-hl-row, .ejg-hl-bar).

import { h } from "./dom.js";

const t = (s, v) => (window.ejg && window.ejg.t ? window.ejg.t(s, v) : s);

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const css = document.createElement("style");
  css.textContent =
    ".ejg-hl{margin:12px 0;padding:10px 14px;border-radius:8px;background:rgba(127,127,127,.14);color:inherit;font:inherit}" +
    ".ejg-hl[hidden]{display:none}.ejg-hl b{display:block;margin-bottom:6px}" +
    ".ejg-hl-row{display:flex;gap:22px;flex-wrap:wrap}.ejg-hl-row span{display:flex;flex-direction:column}" +
    ".ejg-hl-row em{font-style:normal;font-size:1.25em;font-weight:600}.ejg-hl-row small{opacity:.7}" +
    ".ejg-hl-bar{height:5px;border-radius:3px;margin-top:10px;background:rgba(127,127,127,.3);overflow:hidden}" +
    ".ejg-hl-bar i{display:block;height:100%;background:var(--ejg-accent,#4f8cff)}";
  (document.head || document.documentElement).appendChild(css);
}

const hours = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString(window.ejg?.locale || "es-ES") + " h";

/**
 * @param {{id:number, playtime?:number, title?:string}} g
 * @param {{styled?: boolean}} [opts]
 * @returns {HTMLElement}
 */
export function howLongNote(g, opts = {}) {
  if (opts.styled !== false) injectStyle();
  const el = h("div", { class: "ejg-hl", hidden: true });
  if (!window.ejg || !window.ejg.game || !window.ejg.game.hltb) return el;
  window.ejg.game
    .hltb(g.id)
    .then((r) => {
      if (!r || !(r.main || r.extra || r.complete)) return;
      const cell = (label, v) => (v ? h("span", null, h("em", null, hours(v)), h("small", null, label)) : null);
      const played = (g.playtime || 0) / 3600;
      const goal = r.main || r.extra || r.complete;
      el.append(
        h("b", null, t("Cuánto dura")),
        h("div", { class: "ejg-hl-row" }, cell(t("Historia"), r.main), cell(t("Con extras"), r.extra), cell(t("Completista"), r.complete)),
        played > 0 ? h("div", { class: "ejg-hl-bar", title: t("Llevas {h} jugadas", { h: hours(played) }) }, h("i", { style: { width: Math.min(100, (played / goal) * 100) + "%" } })) : null,
      );
      el.hidden = false;
    })
    .catch(() => {});
  return el;
}
