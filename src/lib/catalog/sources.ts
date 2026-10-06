// Fuentes de catálogos: el estado que da el núcleo (lo que hay en
// config/catalog-sources.json), filtros y orden de las listas, y la búsqueda en
// todas las fuentes. Las fuentes se editan en el JSON, no aquí.

import { api } from "../../api/tauri";
import type { CatalogCategory, CatalogDetail, CatalogEntry, CatalogInstallRequest, CatalogPage, CatalogSourceInfo, CatalogState, Platform } from "../../api/types";

export type CatalogSort = "popular" | "newest" | "name" | "size";

export interface CatalogFilters {
  region: string[];
  language: string[];
  category: CatalogCategory[];
  sort: CatalogSort;
}

export const EMPTY_FILTERS: CatalogFilters = { region: [], language: [], category: [], sort: "popular" };

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  game: "Juegos",
  dlc: "DLC",
  update: "Actualizaciones",
  homebrew: "Homebrew",
  emulator: "Emuladores",
};

export const SORT_LABELS: Record<CatalogSort, string> = { popular: "Populares", newest: "Novedades", name: "Nombre", size: "Tamaño" };

export async function loadState(reload = false): Promise<CatalogState> {
  return reload ? api.catalogsReload() : api.catalogsState();
}

/** Fuentes que se pueden usar (activas y sin nada pendiente en el JSON). */
export const usable = (s: CatalogSourceInfo) => s.enabled && s.problems.length === 0;

/** Fuentes que cubren una plataforma. */
export const sourcesFor = (state: CatalogState | null, platform: Platform) => (state?.sources ?? []).filter((s) => usable(s) && s.platforms.some((p) => p.id === platform));

/** Plataformas con al menos una fuente usable, en el orden de la tabla. */
export function coveredPlatforms(state: CatalogState | null): Platform[] {
  const set = new Set<Platform>();
  for (const s of state?.sources ?? []) if (usable(s)) for (const p of s.platforms) set.add(p.id);
  return state ? state.allPlatforms.map((p) => p.id).filter((p) => set.has(p)) : [];
}

/** El modo de lista según el orden: popular y novedades piden otra lista a la web; nombre y tamaño ordenan lo cargado. */
export const modeForSort = (sort: CatalogSort): "popular" | "newest" => (sort === "newest" ? "newest" : "popular");

/** Valores distintos de un campo con varias etiquetas («USA, Europe»). */
export function facet(entries: CatalogEntry[], key: "region" | "language"): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const v of (e[key] ?? "").split(",")) if (v.trim()) set.add(v.trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Aplica los filtros cruzados y el orden local. */
export function applyFilters(entries: CatalogEntry[], f: CatalogFilters): CatalogEntry[] {
  const has = (v: string | null | undefined, wanted: string[]) => !wanted.length || (v ?? "").split(",").some((x) => wanted.includes(x.trim()));
  const list = entries.filter((e) => has(e.region, f.region) && has(e.language, f.language) && (!f.category.length || f.category.includes(e.category)));
  if (f.sort === "name") return [...list].sort((a, b) => a.title.localeCompare(b.title));
  if (f.sort === "size") return [...list].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  return list;
}

/** Búsqueda en todas las fuentes: una lista con la fuente en cada entrada y los errores aparte. */
export async function searchAll(query: string, platforms: Platform[] = [], page = 1): Promise<{ entries: CatalogEntry[]; errors: { sourceId: string; error: string }[]; pages: CatalogPage[] }> {
  const pages = await api.catalogSearchAll(query, platforms, page);
  return {
    pages,
    entries: pages.flatMap((p) => p.entries),
    errors: pages.filter((p) => p.error).map((p) => ({ sourceId: p.sourceId, error: p.error! })),
  };
}

/** Clave de una entrada (la misma que usa el núcleo para sus descargas). */
export const entryKey = (e: Pick<CatalogEntry, "sourceId" | "id">) => `${e.sourceId}|${e.id}`;

/** Lo que se manda al núcleo para bajar e instalar una entrada con uno de sus enlaces. */
export function requestFor(e: CatalogEntry, url: string, d?: CatalogDetail | null): CatalogInstallRequest {
  const x = d ?? e;
  return {
    sourceId: e.sourceId,
    gameId: e.id,
    title: x.title,
    platform: x.platform ?? e.platform,
    category: x.category,
    cover: x.coverOriginal ?? e.coverOriginal ?? null,
    description: x.description ?? null,
    region: x.region ?? null,
    version: x.version ?? null,
    url,
  };
}
