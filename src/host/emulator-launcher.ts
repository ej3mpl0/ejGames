// Lanzador de emuladores: lo pesado (buscar el emulador, armar la línea de órdenes,
// contar el tiempo de juego, overlay y copias de partidas) lo hace el núcleo
// (emulation::prepare_in + launcher::play). Aquí: elegir y recordar el emulador
// preferido de cada plataforma y lanzar una ROM de la biblioteca o un archivo suelto.

import { api, errMsg } from "../api/tauri";
import type { EmulatorCfg, EmulatorOption, Platform } from "../api/types";
import { t } from "../lib/i18n";
import { toSystem } from "../lib/catalog/platforms";
import { useApp } from "../store/app";

export interface LaunchConfig {
  /** Juego de la biblioteca (lo normal). */
  gameId?: number;
  /** O un archivo suelto: se añade a la biblioteca y se juega. */
  romPath?: string;
  platform?: Platform | string;
}

/** Juega una ROM. Si no hay emulador, lleva a Tienda → Homebrew para instalar uno. */
export async function launchRom(config: LaunchConfig): Promise<void> {
  const { toast, open } = useApp.getState();
  try {
    if (config.gameId != null) await api.romLaunch(config.gameId);
    else if (config.romPath && config.platform) await api.romLaunchFile(config.romPath, config.platform);
    else throw new Error(t("Falta la ROM o su plataforma"));
  } catch (e) {
    const msg = errMsg(e);
    toast("error", msg, /emulador/i.test(msg) ? { label: t("Instalar emulador"), run: () => open("software") } : undefined);
    throw e;
  }
}

/** Emuladores que pueden abrir una plataforma (de Ajustes, de emulators.json, instalados y detectados). */
export async function emulatorOptions(platform: string): Promise<EmulatorOption[]> {
  if (!toSystem(platform) && !platform) return [];
  return api.emulatorOptions(platform);
}

/** Guarda el emulador preferido de una plataforma en Ajustes (null = automático). */
export async function setPreferredEmulator(platform: string, cfg: EmulatorCfg | null): Promise<void> {
  const system = toSystem(platform) ?? platform;
  const st = useApp.getState();
  const settings = st.settings ?? (await api.getSettings());
  const emulators = settings.emulators.filter((e) => e.platform !== system);
  if (cfg) emulators.push({ ...cfg, platform: system });
  const next = await api.updateSettings({ emulators });
  st.set({ settings: next });
}
