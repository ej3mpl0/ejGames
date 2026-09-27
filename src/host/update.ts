// Actualizaciones (como en ejFlix): una comprobación al abrir, la manual de
// Ajustes → Sistema, la descarga del instalador con progreso y el relevo.

import { create } from "zustand";
import { api, errMsg, on } from "../api/tauri";
import type { UpdateCheck } from "../api/types";
import { useApp } from "../store/app";

export type UpdatePhase = "idle" | "checking" | "downloading" | "installing";

interface UpdateState {
  check: UpdateCheck | null;
  phase: UpdatePhase;
  progress: { received: number; total: number } | null;
  checkError: string;
  installError: string;
}

export const useUpdate = create<UpdateState>(() => ({
  check: null,
  phase: "idle",
  progress: null,
  checkError: "",
  installError: "",
}));

const set = (p: Partial<UpdateState>) => useUpdate.setState(p);

async function run(force: boolean): Promise<UpdateCheck | null> {
  if (useUpdate.getState().phase !== "idle") return null;
  set({ phase: "checking", checkError: "" });
  try {
    const check = await api.updateCheck(force);
    set({ check });
    return check;
  } catch (e) {
    set({ checkError: errMsg(e) });
    return null;
  } finally {
    if (useUpdate.getState().phase === "checking") set({ phase: "idle" });
  }
}

let launched = false;
/** Al entrar: si está activado, espera un poco (que no compita con el arranque) y comprueba. */
export function checkOnLaunch() {
  if (launched) return;
  launched = true;
  setTimeout(async () => {
    if (useApp.getState().settings?.updateAuto === false) return;
    const c = await run(false);
    if (c?.available && !c.skipped) useApp.getState().open("update");
  }, 5000);
}

/** «Buscar ahora» (sin caché). Si hay versión nueva, abre el aviso. */
export async function checkNow() {
  const c = await run(true);
  if (c?.available) useApp.getState().open("update");
  return c;
}

/** Descarga el instalador y le pasa el relevo (ejGames se cierra). */
export async function downloadAndInstall() {
  const st = useUpdate.getState();
  if (st.phase !== "idle" || !st.check) return;
  set({ phase: "downloading", installError: "", progress: { received: 0, total: st.check.assetSize ?? 0 } });
  const un = await on("update:progress", (p) => set({ progress: p }));
  try {
    const file = await api.updateDownload();
    set({ phase: "installing" });
    await api.updateInstall(file.path);
    // ejGames se cierra justo después; si no, se puede reintentar.
  } catch (e) {
    set({ installError: errMsg(e), phase: "idle", progress: null });
  } finally {
    un();
  }
}

/** No volver a avisar de esta versión. */
export async function skipVersion() {
  const c = useUpdate.getState().check;
  if (!c) return;
  try {
    useApp.getState().set({ settings: await api.updateSettings({ updateSkipped: c.latest }) });
    set({ check: { ...c, skipped: true } });
  } catch {
    // No es grave: el aviso vuelve en el próximo arranque.
  }
}

export function openRelease() {
  const url = useUpdate.getState().check?.url || "https://github.com/ej3mpl0/ejGames/releases";
  void api.openExternal(url).catch(() => undefined);
}
