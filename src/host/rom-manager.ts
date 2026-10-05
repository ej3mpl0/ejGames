// Biblioteca de ROMs: los juegos de consola agrupados por plataforma (con los ids
// de los catálogos), su emulador y sus DLC/actualizaciones. Los datos salen de la
// biblioteca normal (`useApp.games`); el núcleo los registra al importar o al bajar
// de un catálogo (catalogs/pipeline.rs).

import type { LibGame, Platform } from "../api/types";
import { fromSystem, PLATFORMS } from "../lib/catalog/platforms";
import { romLibrary } from "../store/app";

export interface RomGroup {
  platform: Platform | null;
  /** Id de ejGames («psx»). */
  system: string;
  name: string;
  /** Emulador con que se abren ("" si ninguno). */
  emulator: string;
  roms: LibGame[];
}

/** ROMs de la biblioteca por plataforma, en el orden de la tabla de plataformas. */
export function romGroups(games: LibGame[]): RomGroup[] {
  const map = romLibrary({ games });
  const order = (sys: string) => {
    const i = PLATFORMS.findIndex((p) => p.system === sys);
    return i < 0 ? 999 : i;
  };
  return [...map.entries()]
    .map(([system, roms]) => {
      const platform = fromSystem(system);
      return {
        platform,
        system,
        name: PLATFORMS.find((p) => p.id === platform)?.name ?? system,
        emulator: roms.find((r) => r.emulator)?.emulator ?? "",
        roms: [...roms].sort((a, b) => a.sortTitle.localeCompare(b.sortTitle)),
      };
    })
    .sort((a, b) => order(a.system) - order(b.system) || a.name.localeCompare(b.name));
}

/** DLC y actualizaciones enganchados a un juego. */
export const romExtras = (g: LibGame) => g.rom?.extras ?? [];

/** Nombre del emulador de una plataforma según la biblioteca ("" si no hay ROMs o emulador). */
export function emulatorForPlatform(games: LibGame[], platform: Platform): string {
  const sys = PLATFORMS.find((p) => p.id === platform)?.system;
  return games.find((g) => g.platform === sys && g.emulator)?.emulator ?? "";
}
