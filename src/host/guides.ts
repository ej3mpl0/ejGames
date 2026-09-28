// Guías de Steam desde el host: lo que comparten el puente de los temas, la
// ventana de reserva y el overlay (enlaces que se pueden abrir, abrir en el
// navegador y ventana de reserva para los temas que no pintan su lector).

import { api, errMsg } from "../api/tauri";
import type { Guide, GuideBlock, GuideSpan } from "../api/types";
import { activeTheme, useApp } from "../store/app";

/** Enlaces que han salido en guías servidas: los únicos que se pueden abrir. */
const links = new Set<string>();

function collectSpans(spans: GuideSpan[]) {
  for (const s of spans) if (s.href) links.add(s.href);
}

function collectBlocks(blocks: GuideBlock[]) {
  for (const b of blocks) {
    if (b.t === "h" || b.t === "p" || b.t === "quote") collectSpans(b.spans);
    else if (b.t === "list") b.items.forEach((i) => collectSpans(i.spans));
    else if (b.t === "table") b.rows.forEach((r) => r.forEach(collectSpans));
    else if (b.t === "video") links.add(b.url);
  }
}

/** Pide una guía y apunta sus enlaces. */
export async function getGuide(id: string): Promise<Guide> {
  const g = await api.guidesGet(id);
  collectBlocks(g.intro);
  g.sections.forEach((s) => collectBlocks(s.blocks));
  if (links.size > 20000) links.clear();
  return g;
}

export const validGuideId = (v: unknown): string => {
  const s = String(v ?? "");
  if (!/^\d{1,20}$/.test(s)) throw new Error("guía no válida");
  return s;
};

/** Abre en el navegador un enlace de una guía ya leída. */
export async function openGuideLink(href: string) {
  if (!links.has(href)) throw new Error("Ese enlace no es de ninguna guía");
  await api.openExternal(href);
}

/** La guía en la web de Steam (la URL se construye aquí). */
export function openGuideInBrowser(id: string) {
  return api.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${validGuideId(id)}`);
}

/** ¿El tema activo pinta sus propias guías? */
export function themeHasGuides() {
  return !!activeTheme(useApp.getState())?.features?.guides;
}

/** Guías de un juego: las del tema o, si no las pinta, la ventana del host. */
export function openGuides(gameId: number, guideId?: string) {
  const st = useApp.getState();
  if (themeHasGuides()) {
    st.closeAll();
    window.dispatchEvent(new CustomEvent("ejg:ui-view", { detail: { view: "guides", gameId, guideId: guideId ?? null } }));
  } else {
    st.open("guides", { id: gameId, guide: guideId ?? null });
  }
}

export function guideError(e: unknown) {
  useApp.getState().toast("error", errMsg(e));
}
