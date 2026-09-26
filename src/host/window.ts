import { api } from "../api/tauri";
import { useApp } from "../store/app";

/** Big Picture: pantalla completa + modo TV para los temas. */
export async function setBigPicture(on: boolean) {
  useApp.getState().set({ mode: on ? "tv" : "desktop" });
  await api.windowAction("fullscreen", on);
}

export async function toggleBigPicture() {
  await setBigPicture(useApp.getState().mode !== "tv");
}

/** Atajos globales (del host o reenviados por el tema). */
export function globalKey(k: { key: string; ctrl?: boolean; shift?: boolean }) {
  const st = useApp.getState();
  if (k.key === "F11") return void api.windowAction("fullscreen");
  if (k.key === "F5") return st.set({ themeReload: st.themeReload + 1 });
  if (!k.ctrl) return;
  const key = k.key.toLowerCase();
  if (key === "f") st.open("search");
  else if (key === ",") st.open("settings");
  else if (key === "p") st.open("profiles");
  else if (key === "k") st.open("menu");
}
