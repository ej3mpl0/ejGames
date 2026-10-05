// Plataformas de los catálogos: nombre, familia, color de su tarjeta y el id que
// usa el resto de ejGames («ps1» → «psx»). La misma tabla que
// src-tauri/src/catalogs/platforms.rs (allí está la detección en las webs).

import type { Platform } from "../../api/types";

export interface PlatformDef {
  id: Platform;
  name: string;
  /** Texto corto para el icono. */
  short: string;
  family: "nintendo" | "sony" | "microsoft" | "sega" | "otros" | "pc";
  /** Id de ejGames (`g.platform` de la biblioteca); null si no se emula. */
  system: string | null;
  /** Color de la tarjeta (tono HSL). */
  hue: number;
}

export const PLATFORMS: PlatformDef[] = [
  { id: "switch", name: "Nintendo Switch", short: "NSW", family: "nintendo", system: "switch", hue: 356 },
  { id: "wii-u", name: "Wii U", short: "WiiU", family: "nintendo", system: "wiiu", hue: 195 },
  { id: "wii", name: "Wii", short: "Wii", family: "nintendo", system: "wii", hue: 200 },
  { id: "gamecube", name: "GameCube", short: "GC", family: "nintendo", system: "gc", hue: 262 },
  { id: "n64", name: "Nintendo 64", short: "N64", family: "nintendo", system: "n64", hue: 140 },
  { id: "snes", name: "Super Nintendo", short: "SNES", family: "nintendo", system: "snes", hue: 280 },
  { id: "nes", name: "NES", short: "NES", family: "nintendo", system: "nes", hue: 0 },
  { id: "3ds", name: "Nintendo 3DS", short: "3DS", family: "nintendo", system: "3ds", hue: 350 },
  { id: "ds", name: "Nintendo DS", short: "DS", family: "nintendo", system: "nds", hue: 210 },
  { id: "gba", name: "Game Boy Advance", short: "GBA", family: "nintendo", system: "gba", hue: 250 },
  { id: "gbc", name: "Game Boy Color", short: "GBC", family: "nintendo", system: "gbc", hue: 50 },
  { id: "gb", name: "Game Boy", short: "GB", family: "nintendo", system: "gb", hue: 90 },
  { id: "ps1", name: "PlayStation", short: "PS1", family: "sony", system: "psx", hue: 220 },
  { id: "ps2", name: "PlayStation 2", short: "PS2", family: "sony", system: "ps2", hue: 225 },
  { id: "ps3", name: "PlayStation 3", short: "PS3", family: "sony", system: "ps3", hue: 230 },
  { id: "ps4", name: "PlayStation 4", short: "PS4", family: "sony", system: null, hue: 235 },
  { id: "psp", name: "PSP", short: "PSP", family: "sony", system: "psp", hue: 215 },
  { id: "ps-vita", name: "PS Vita", short: "Vita", family: "sony", system: "vita", hue: 205 },
  { id: "xbox", name: "Xbox", short: "XB", family: "microsoft", system: "xbox", hue: 120 },
  { id: "xbox-360", name: "Xbox 360", short: "360", family: "microsoft", system: "xbox360", hue: 110 },
  { id: "xbox-one", name: "Xbox One", short: "One", family: "microsoft", system: null, hue: 130 },
  { id: "genesis", name: "Mega Drive / Genesis", short: "MD", family: "sega", system: "genesis", hue: 10 },
  { id: "saturn", name: "Sega Saturn", short: "SAT", family: "sega", system: "saturn", hue: 30 },
  { id: "dreamcast", name: "Dreamcast", short: "DC", family: "sega", system: "dreamcast", hue: 25 },
  { id: "master-system", name: "Master System", short: "SMS", family: "sega", system: "sms", hue: 5 },
  { id: "game-gear", name: "Game Gear", short: "GG", family: "sega", system: "gg", hue: 15 },
  { id: "neo-geo", name: "Neo Geo", short: "NEO", family: "otros", system: "arcade", hue: 45 },
  { id: "arcade", name: "Arcade", short: "ARC", family: "otros", system: "arcade", hue: 300 },
  { id: "mame", name: "MAME", short: "MAME", family: "otros", system: "arcade", hue: 310 },
  { id: "pc-engine", name: "PC Engine", short: "PCE", family: "otros", system: "pce", hue: 60 },
  { id: "turbografx", name: "TurboGrafx-16", short: "TG16", family: "otros", system: "pce", hue: 65 },
  { id: "wonderswan", name: "WonderSwan", short: "WS", family: "otros", system: "wonderswan", hue: 170 },
  { id: "pc", name: "PC", short: "PC", family: "pc", system: null, hue: 0 },
  { id: "dos", name: "MS-DOS", short: "DOS", family: "pc", system: null, hue: 0 },
  { id: "windows", name: "Windows", short: "WIN", family: "pc", system: null, hue: 0 },
];

export const FAMILIES: { id: PlatformDef["family"]; label: string }[] = [
  { id: "nintendo", label: "Nintendo" },
  { id: "sony", label: "Sony" },
  { id: "microsoft", label: "Microsoft" },
  { id: "sega", label: "Sega" },
  { id: "otros", label: "Otros" },
  { id: "pc", label: "PC" },
];

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

export function platformDef(id: string | null | undefined): PlatformDef | undefined {
  if (!id) return undefined;
  return BY_ID.get(id as Platform) ?? PLATFORMS.find((p) => p.system === id);
}

export const platformName = (id: string | null | undefined) => platformDef(id)?.name ?? id ?? "";

/** Id de ejGames de una plataforma de catálogo («ps1» → «psx»). */
export const toSystem = (id: string | null | undefined) => platformDef(id)?.system ?? null;

/** Id de catálogo de un sistema de la biblioteca («psx» → «ps1»). */
export const fromSystem = (system: string | null | undefined): Platform | null => (system ? (PLATFORMS.find((p) => p.system === system)?.id ?? null) : null);

/** ¿Se puede jugar con emulador desde ejGames? */
export const isEmulated = (id: string | null | undefined) => !!toSystem(id);
