// Explorar y Descargas desde el host: abrir la vista (la del tema si la pinta
// él, si no la del host), carpetas, avisos y el teclado en pantalla.

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errMsg } from "../api/tauri";
import type { DownloadItem } from "../api/types";
import { activeTheme, useApp } from "../store/app";

export type ExploreView = "explore" | "downloads" | "repack";

/** ¿El tema activo pinta su propia tienda y cola? */
export function themeHasExplore() {
  return !!activeTheme(useApp.getState())?.features?.explore;
}

/** Abre Explorar, Descargas o una ficha (`{ slug }`). */
export function openExplore(view: ExploreView, args?: Record<string, unknown>) {
  const st = useApp.getState();
  if (view !== "downloads" && st.settings?.exploreEnabled === false) {
    st.toast("info", "Explorar está desactivado. Actívalo en Ajustes → Descargas.");
    return;
  }
  if (themeHasExplore()) {
    st.closeAll();
    window.dispatchEvent(new CustomEvent("ejg:ui-view", { detail: { view, ...(args ?? {}) } }));
  } else {
    st.open(view === "downloads" ? "downloads" : "explore", { view, ...(args ?? {}) });
  }
}

const order = (a: DownloadItem, b: DownloadItem) => a.queuePos - b.queuePos || a.id - b.id;

export function setDownloads(list: DownloadItem[]) {
  useApp.getState().set({ downloads: [...list].sort(order) });
}

/** Progreso en vivo: solo trae las activas; el resto se queda como está. */
export function mergeProgress(list: DownloadItem[]) {
  const map = new Map(useApp.getState().downloads.map((d) => [d.id, d]));
  for (const d of list) map.set(d.id, d);
  setDownloads([...map.values()]);
}

/** Selector de carpeta con el espacio libre de su disco. */
export async function pickFolder(title: string, current?: string | null): Promise<{ path: string; freeBytes?: number | null } | null> {
  const path = await openDialog({ directory: true, multiple: false, title, defaultPath: current || undefined });
  if (typeof path !== "string") return null;
  const { freeBytes } = await api.diskSpace(path).catch(() => ({ freeBytes: null }));
  return { path, freeBytes };
}

export async function installDownload(id: number) {
  try {
    await api.downloadsInstall(id);
  } catch (e) {
    useApp.getState().toast("error", errMsg(e));
  }
}

/** El instalador terminó pero no se supo dónde quedó el juego. */
export async function locateInstall(id: number) {
  const pick = await pickFolder("Carpeta donde se instaló el juego");
  if (!pick) return;
  try {
    await api.downloadsFinishInstall(id, pick.path);
  } catch (e) {
    useApp.getState().toast("error", errMsg(e));
  }
}

// ───────────────────────────── teclado en pantalla ─────────────────────────────

export interface KeyboardOptions {
  title?: string;
  value?: string;
  placeholder?: string;
  maxLength?: number;
}

let resolver: ((v: string | null) => void) | null = null;

/** Pide un texto con el teclado en pantalla (para escribir con el mando). */
export function openKeyboard(opts: KeyboardOptions): Promise<string | null> {
  resolver?.(null);
  return new Promise((resolve) => {
    resolver = resolve;
    useApp.getState().open("keyboard", { ...opts });
  });
}

export function resolveKeyboard(v: string | null) {
  const r = resolver;
  resolver = null;
  r?.(v);
}
