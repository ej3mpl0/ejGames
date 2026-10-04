// «Requiere emulador» para la ficha de un juego de consola (ROMs propias y
// homebrew): con qué emulador se abre, lo leído de la ROM (TitleID, versión,
// región) y su DLC y actualizaciones. Si no hay emulador, un botón a Software.
//   ficha.append(emulatorNote(game));   // en los juegos de PC no sale nada
// Lleva su propio estilo (--ejg-accent); { styled: false } para ponerlo tú
// (clases .ejg-emu, .ejg-emu-name, .ejg-emu-chips, .ejg-emu-go).

import { h } from "./dom.js";
import { isRom, systemName } from "./library.js";

const t = (s, v) => (window.ejg && window.ejg.t ? window.ejg.t(s, v) : s.replace(/\{(\w+)\}/g, (_, k) => (v && k in v ? v[k] : `{${k}}`)));

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const css = document.createElement("style");
  css.textContent =
    ".ejg-emu{margin:12px 0;padding:10px 14px;border-radius:8px;background:rgba(127,127,127,.14);color:inherit;font:inherit;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}" +
    ".ejg-emu-name b{color:var(--ejg-accent,#4f8cff)}.ejg-emu.missing .ejg-emu-name b{color:#f0b429}" +
    ".ejg-emu-chips{display:flex;flex-wrap:wrap;gap:6px}.ejg-emu-chips span{padding:2px 8px;border-radius:99px;background:rgba(127,127,127,.2);font-size:.85em}" +
    ".ejg-emu-go{margin-left:auto;padding:5px 12px;border:0;border-radius:6px;background:var(--ejg-accent,#4f8cff);color:#fff;font:inherit;cursor:pointer}";
  (document.head || document.documentElement).appendChild(css);
}

/** Partes de lo leído de la ROM, ya traducidas. */
export function romChips(g) {
  const r = g.rom;
  if (!r) return [];
  const ex = r.extras || [];
  const upd = ex.filter((e) => e.kind === "update");
  const dlc = ex.filter((e) => e.kind === "dlc").length;
  const last = upd.map((u) => u.version).filter(Boolean).sort((a, b) => Number(b) - Number(a) || String(b).localeCompare(String(a)))[0];
  return [
    r.serial && r.serial !== r.titleId ? r.serial : null,
    r.titleId ? `ID ${r.titleId}` : null,
    r.version ? `v${String(r.version).replace(/^v/i, "")}` : null,
    r.region ? t(r.region) : null,
    upd.length ? (last ? t("Actualización v{v}", { v: last }) : t("Actualización")) : null,
    dlc ? t("{n} DLC", { n: dlc }) : null,
  ].filter(Boolean);
}

/**
 * @param {{platform?:string, emulator?:string, source?:string, rom?:object}} g
 * @param {{styled?: boolean}} [opts]
 * @returns {HTMLElement}
 */
export function emulatorNote(g, opts = {}) {
  if (!g || !isRom(g)) return h("div", { class: "ejg-emu", hidden: true });
  if (opts.styled !== false) injectStyle();
  const has = !!g.emulator;
  const chips = romChips(g);
  return h(
    "div",
    { class: "ejg-emu" + (has ? "" : " missing") },
    h(
      "span",
      { class: "ejg-emu-name" },
      has ? t("Requiere emulador:") + " " : t("Requiere emulador para {system}", { system: systemName(g.platform) }),
      has ? h("b", { "data-no-t": "" }, g.emulator) : null,
    ),
    chips.length ? h("span", { class: "ejg-emu-chips" }, ...chips.map((c) => h("span", null, c))) : null,
    has ? null : h("button", { class: "ejg-emu-go", "data-focus": "", onclick: () => window.ejg?.ui.open("software") }, t("Instalar emulador")),
  );
}
