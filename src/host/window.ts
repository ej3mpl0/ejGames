import { api } from "../api/tauri";
import { activeTheme, useApp } from "../store/app";

/** Vuelve a leer los temas de la carpeta: temas nuevos y cambios de theme.json. */
export async function refreshThemes() {
  const prev = activeTheme(useApp.getState());
  let themes;
  try {
    themes = await api.listThemes();
  } catch {
    return;
  }
  // Un theme.json a medio escribir (JSON roto) deja fuera al tema: mientras
  // tanto se queda con el manifiesto anterior en vez de saltar al tema Steam.
  if (prev && !themes.some((t) => t.id === prev.id)) themes.push(prev);
  useApp.getState().set({ themes });
}

/** Recarga el tema activo (F5, botón o al guardar en modo desarrollador). */
export async function reloadTheme() {
  await refreshThemes();
  const st = useApp.getState();
  st.set({ themeReload: st.themeReload + 1 });
}

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
  if (k.key === "F5") return void reloadTheme();
  if (!k.ctrl) return;
  const key = k.key.toLowerCase();
  if (key === "f") st.open("search");
  else if (key === ",") st.open("settings");
  else if (key === "p") st.open("profiles");
  else if (key === "k") st.open("menu");
}
