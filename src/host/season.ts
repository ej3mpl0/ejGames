// Evento de temporada (Halloween…): el host decide si está activo (fechas y
// ajuste «Modo Halloween») y lo aplica a sus pantallas y a los temas. Los datos
// del evento son los del kit de temas.

import { useEffect, useState } from "react";
// @ts-ignore módulo JS del kit
import { activeEvent } from "../../sdk/kit/events.js";
import { useApp } from "../store/app";

export interface SeasonEvent {
  id: string;
  name: string;
  banner: string;
  video?: string;
  wallpaper?: string;
  wallpaperAlt?: string;
  palette: { accent: string; green: string; violet: string; bg: string; panel: string; text: string };
  genre: number;
  title: string;
  subtitle: string;
}

/** Los temas se sirven aquí; el arte del evento está en su /_sdk. */
export const SEASON_ORIGIN = "http://ejg-theme.localhost";

export function currentSeason(): SeasonEvent | null {
  const mode = useApp.getState().settings?.eventMode ?? "auto";
  return (activeEvent(mode) as SeasonEvent | null) ?? null;
}

/** El evento activo; se vuelve a mirar al cambiar el ajuste y cada media hora (el día en que empieza o acaba). */
export function useSeason(): SeasonEvent | null {
  const mode = useApp((s) => s.settings?.eventMode ?? "auto");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const [ev, setEv] = useState<SeasonEvent | null>(() => activeEvent(mode));
  useEffect(() => {
    const next = activeEvent(mode) as SeasonEvent | null;
    setEv((prev) => (prev?.id === next?.id ? prev : next));
  }, [mode, tick]);
  return ev;
}

/** <html data-season> y los colores del host (acento, superficies) del evento. */
export function useHostSeason() {
  const ev = useSeason();
  useEffect(() => {
    const root = document.documentElement;
    if (!ev) {
      delete root.dataset.season;
      root.style.removeProperty("--season-wallpaper");
      return;
    }
    root.dataset.season = ev.id;
    if (ev.wallpaperAlt) root.style.setProperty("--season-wallpaper", `url("${SEASON_ORIGIN}${ev.wallpaperAlt}")`);
  }, [ev]);
  return ev;
}
