export function playtime(seconds: number, empty = "Sin jugar") {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return s > 0 ? "< 1 min" : empty;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function hours(seconds: number) {
  const h = seconds / 3600;
  return h >= 100 ? `${Math.round(h)} h` : h >= 10 ? `${h.toFixed(0)} h` : `${h.toFixed(1)} h`;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
export function relative(ts?: number | null) {
  if (!ts) return "Nunca";
  const diff = ts - Date.now() / 1000;
  const a = Math.abs(diff);
  if (a < 60) return "Ahora mismo";
  if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (a < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

export const SOURCE_LABEL: Record<string, string> = {
  steam: "Steam",
  epic: "Epic Games",
  gog: "GOG",
  ubisoft: "Ubisoft Connect",
  ea: "EA app",
  folder: "Carpeta local",
  manual: "Manual",
};

export const PROFILE_COLORS = ["#4f8cff", "#8b5cf6", "#ec4899", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#ef4444", "#64748b"];
