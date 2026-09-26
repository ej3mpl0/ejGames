// Llamadas de los temas → host. Solo lo que aparece aquí es accesible para un
// tema; cada parámetro se valida antes de tocar el núcleo.

import { api } from "../api/tauri";
import { useApp, activeTheme, type OverlayName } from "../store/app";
import { playSound } from "./sounds";
import { toggleBigPicture } from "./window";

const num = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("id no válido");
  return n;
};

const UI_NAMES: Record<string, OverlayName> = {
  settings: "settings",
  game: "game",
  profiles: "profiles",
  search: "search",
  "add-folder": "add-folder",
  stats: "stats",
  theme: "theme",
  collections: "collections",
  menu: "menu",
};

let launching = new Set<number>();

export async function handleThemeCall(method: string, params: any): Promise<unknown> {
  const st = useApp.getState();
  const theme = activeTheme(st);
  switch (method) {
    case "game.details":
      return api.getGameDetails(num(params?.id));
    case "game.achievements":
      return api.getAchievements(num(params?.id));
    case "game.launch": {
      const id = num(params?.id);
      if (launching.has(id)) return;
      launching.add(id);
      try {
        playSound("launch");
        await api.play(id);
      } catch (e) {
        playSound("error");
        throw e;
      } finally {
        setTimeout(() => launching.delete(id), 3000);
      }
      return;
    }
    case "game.favorite": {
      const id = num(params?.id);
      const g = st.games.find((x) => x.id === id);
      const value = typeof params?.value === "boolean" ? params.value : !g?.favorite;
      return api.setFavorite(id, value);
    }
    case "game.hide":
      return api.setHidden(num(params?.id), !!params?.value);
    case "game.rate":
      return api.setUserRating(num(params?.id), params?.value == null ? null : Math.max(0, Math.min(100, num(params.value))));
    case "game.folder":
      return api.openGameFolder(num(params?.id));
    case "stats.get":
      return api.getStats(params?.days ? num(params.days) : undefined);
    case "stats.recent":
      return api.recentSessions(params?.limit ? num(params.limit) : undefined);
    case "storage.get":
      return theme ? api.themeStorageGet(theme.id) : {};
    case "storage.set": {
      if (!theme) return;
      const key = String(params?.key ?? "");
      if (!key) throw new Error("clave vacía");
      return api.themeStorageSet(theme.id, key, params?.value ?? null);
    }
    case "ui.open": {
      const name = UI_NAMES[String(params?.name)];
      if (!name) throw new Error("overlay desconocido");
      playSound("open");
      const args = params?.args && typeof params.args === "object" ? params.args : null;
      if (name === "add-folder") st.open("settings", { tab: "library", addFolder: true });
      else if (name === "theme") st.open("settings", { tab: "appearance" });
      else st.open(name, args);
      return;
    }
    case "ui.toast":
      st.toast(["ok", "error", "info"].includes(params?.kind) ? params.kind : "info", String(params?.message ?? "").slice(0, 300));
      return;
    case "window": {
      const a = String(params);
      if (a === "fullscreen-on" || a === "fullscreen-off") return api.windowAction("fullscreen", a === "fullscreen-on");
      if (a === "tv") return toggleBigPicture();
      if (["minimize", "toggle-maximize", "close", "fullscreen", "drag"].includes(a)) return api.windowAction(a);
      throw new Error("acción de ventana no válida");
    }
    case "app.info":
      return { version: st.boot?.version, running: st.running, meta: [st.meta.done, st.meta.total] };
    default:
      throw new Error(`método desconocido: ${method}`);
  }
}
