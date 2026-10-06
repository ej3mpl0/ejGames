// Ordenar, filtrar, agrupar y buscar juegos.

/** Normaliza para búsqueda: minúsculas, sin acentos ni símbolos. */
export function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Puntuación difusa (0 = no coincide). Prioriza prefijos e iniciales. */
export function fuzzyScore(query, text) {
  const q = norm(query);
  const t = norm(text);
  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return 300 - idx;
  const initials = t.split(" ").map((w) => w[0]).join("");
  if (initials.startsWith(q.replace(/ /g, ""))) return 250;
  // Subsecuencia.
  let qi = 0;
  let score = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += i > 0 && t[i - 1] === " " ? 6 : 2;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

export function search(games, query, limit = 50) {
  if (!query) return games;
  return games
    .map((g) => [g, Math.max(fuzzyScore(query, g.title), fuzzyScore(query, g.developer || "") * 0.3)])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([g]) => g);
}

/**
 * Juegos visibles: sin ocultos ni desaparecidos (salvo que se pida). Los emuladores
 * (`software`) y los juegos de consola (`roms`) no salen: van en Homebrew.
 * installed: "all" (defecto) | "installed" | "uninstalled". Desde la 0.5.0
 * todos los juegos de la biblioteca están instalados; se mantiene por compatibilidad.
 */
export function visible(games, { hidden = false, missing = false, installed = "all", software: sw = false, roms: rm = false } = {}) {
  return games.filter(
    (g) =>
      (sw || !isSoftware(g)) &&
      (rm || !isRom(g)) &&
      (hidden || !g.hidden) &&
      (missing || !g.missing) &&
      (installed === "all" || (installed === "installed" ? g.installed !== false : g.installed === false)),
  );
}

export const isInstalled = (g) => g.installed !== false;

/** Programas de la biblioteca (emuladores instalados desde Tienda → Homebrew): no son juegos y van en Homebrew. */
export const isSoftware = (g) => g.source === "emulator";
/** Los programas de la biblioteca, por nombre. */
export const software = (games) => games.filter((g) => isSoftware(g) && !g.missing).sort((a, b) => a.title.localeCompare(b.title));

/** Nombre de cada sistema de consola (`g.platform`), como en Ajustes → Emuladores. */
export const SYSTEMS = {
  nes: "NES", snes: "Super Nintendo", gb: "Game Boy", gbc: "Game Boy Color", gba: "Game Boy Advance",
  nds: "Nintendo DS", "3ds": "Nintendo 3DS", n64: "Nintendo 64", gc: "GameCube", wii: "Wii", wiiu: "Wii U",
  switch: "Nintendo Switch", sms: "Master System", genesis: "Mega Drive / Genesis", gg: "Game Gear",
  saturn: "Sega Saturn", dreamcast: "Dreamcast", pce: "PC Engine", psx: "PlayStation", ps2: "PlayStation 2",
  psp: "PSP", vita: "PS Vita", ps3: "PlayStation 3", arcade: "Arcade", wonderswan: "WonderSwan", xbox: "Xbox", xbox360: "Xbox 360",
};
export const systemName = (id) => SYSTEMS[id] || id || "";

/** Juegos de consola (ROMs propias y homebrew): se juegan con un emulador y van en Homebrew. */
export const isRom = (g) => !!g.platform && !isSoftware(g);
/** Los juegos de consola visibles, por nombre. */
export const roms = (games) => visible(games, { roms: true }).filter(isRom).sort((a, b) => (a.sortTitle < b.sortTitle ? -1 : a.sortTitle > b.sortTitle ? 1 : 0));
/** Los juegos de consola agrupados por sistema: [{ id, name, games }], por nombre del sistema. */
export function romsBySystem(games) {
  const by = new Map();
  for (const g of roms(games)) {
    if (!by.has(g.platform)) by.set(g.platform, []);
    by.get(g.platform).push(g);
  }
  return [...by.entries()].map(([id, list]) => ({ id, name: systemName(id), games: list })).sort((a, b) => a.name.localeCompare(b.name));
}
/** «Requiere emulador: Eden» (o que falta uno) en texto; "" en los de PC. Para la ficha, `emulatorNote` de kit/emulator.js. */
export function emulatorLabel(g) {
  if (!isRom(g)) return "";
  return g.emulator ? `Requiere emulador: ${g.emulator}` : `Requiere emulador (instálalo en Tienda → Homebrew) · ${systemName(g.platform)}`;
}
/** Lo leído de la ROM, por partes (cada una en su elemento, para que se traduzca):
 *  ["ID 0100…", "v1.2", "Europa", "2 DLC"]. */
export function romParts(g) {
  const r = g.rom;
  if (!r) return [];
  const ex = r.extras || [];
  const upd = ex.filter((e) => e.kind === "update").length;
  const dlc = ex.filter((e) => e.kind === "dlc").length;
  return [
    r.titleId && `ID ${r.titleId}`,
    r.version && `v${String(r.version).replace(/^v/i, "")}`,
    r.region,
    upd && (upd === 1 ? "1 actualización" : `${upd} actualizaciones`),
    dlc && `${dlc} DLC`,
  ].filter(Boolean);
}
/** Lo mismo en una línea: «ID 0100… · v1.2 · Europa · 2 DLC». */
export const romNote = (g) => romParts(g).join(" · ");

/** Si `ejg.game.uninstall(id)` sirve para este juego: todos los que siguen en su sitio. */
export const canUninstall = (g) => !g.missing && !g.platform && !isSoftware(g);

export const SORTS = {
  title: { label: "Nombre", fn: (a, b) => (a.sortTitle < b.sortTitle ? -1 : a.sortTitle > b.sortTitle ? 1 : 0) },
  recent: { label: "Jugado recientemente", fn: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || SORTS.title.fn(a, b) },
  playtime: { label: "Horas jugadas", fn: (a, b) => b.playtime - a.playtime || SORTS.title.fn(a, b) },
  added: { label: "Añadido recientemente", fn: (a, b) => b.addedAt - a.addedAt },
  release: { label: "Fecha de lanzamiento", fn: (a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")) },
  rating: { label: "Valoración", fn: (a, b) => (b.userRating ?? b.rating ?? 0) - (a.userRating ?? a.rating ?? 0) },
};

export function sort(games, key = "title") {
  return [...games].sort((SORTS[key] || SORTS.title).fn);
}

export function recent(games, n = 12) {
  return sort(games.filter((g) => g.lastPlayed), "recent").slice(0, n);
}

/** Primero los instalados; luego el resto (para listas mezcladas). */
export function installedFirst(games) {
  return [...games.filter((g) => g.installed !== false), ...games.filter((g) => g.installed === false)];
}

export function favorites(games) {
  return games.filter((g) => g.favorite);
}

/** Agrupa por género principal: [{ name, games }], ordenado por tamaño. */
export function byGenre(games, min = 2) {
  const map = new Map();
  for (const g of games) {
    const k = (g.genres && g.genres[0]) || "Otros";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(g);
  }
  return [...map.entries()]
    .filter(([, v]) => v.length >= min)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, gs]) => ({ name, games: gs }));
}

/** Aplica una colección (manual o inteligente) a la biblioteca. */
export function inCollection(games, col) {
  if (!col) return games;
  if (col.kind !== "smart") {
    const ids = new Set(col.gameIds);
    return games.filter((g) => ids.has(g.id));
  }
  const r = col.rules || {};
  return games.filter((g) => {
    if (r.genre && !(g.genres || []).includes(r.genre)) return false;
    if (r.source && g.source !== r.source) return false;
    if (r.platform && g.platform !== r.platform) return false;
    if (r.favorite && !g.favorite) return false;
    if (r.unplayed && g.playtime > 0) return false;
    if (r.minHours && g.playtime < r.minHours * 3600) return false;
    if (r.text && !norm(g.title).includes(norm(r.text))) return false;
    return true;
  });
}

export function allGenres(games) {
  const set = new Map();
  for (const g of games) for (const x of g.genres || []) set.set(x, (set.get(x) || 0) + 1);
  return [...set.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}
