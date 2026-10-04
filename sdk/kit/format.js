// Formato de tiempos, fechas y descripciones.

import { h } from "./dom.js";

/** 45296 → "12 h 34 min"; 300 → "5 min"; 0 → "Sin jugar" */
export function playtime(seconds, { empty = "Sin jugar", short = false } = {}) {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return s > 0 ? "< 1 min" : empty;
  const hrs = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  if (short) return hrs >= 1 ? `${(s / 3600).toFixed(hrs >= 10 ? 0 : 1)} h` : `${min} min`;
  if (hrs === 0) return `${min} min`;
  return min ? `${hrs} h ${min} min` : `${hrs} h`;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

/** Timestamp Unix (s) → "hace 3 días", "ayer", "hoy". */
export function relative(ts) {
  if (!ts) return "Nunca";
  const diff = ts - Date.now() / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "Ahora mismo";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

/** "2022-02-24" → "24 feb 2022" */
export function date(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

export function year(iso) {
  return iso ? String(iso).slice(0, 4) : "";
}

/** Texto "markdown-lite" (## títulos, - viñetas, párrafos) → nodos DOM seguros. */
export function description(text) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  let list = null;
  for (const block of String(text).split(/\n{2,}/)) {
    const lines = block.split("\n");
    if (lines.every((l) => l.startsWith("- "))) {
      list = h("ul", null, lines.map((l) => h("li", null, l.slice(2))));
      frag.append(list);
      continue;
    }
    for (const l of lines) {
      if (l.startsWith("## ")) frag.append(h("h3", null, l.slice(3)));
      else if (l.startsWith("- ")) frag.append(h("ul", null, h("li", null, l.slice(2))));
      else if (l.trim()) frag.append(h("p", null, l));
    }
  }
  return frag;
}

export const SOURCE_LABEL = {
  folder: "Carpeta local",
  manual: "Añadido a mano",
  repack: "Descargado",
  rom: "ROM",
};
