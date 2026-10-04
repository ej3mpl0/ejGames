import { locale } from "./i18n";

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

const rtf = () => new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
export function relative(ts?: number | null) {
  if (!ts) return "Nunca";
  const diff = ts - Date.now() / 1000;
  const a = Math.abs(diff);
  if (a < 60) return "Ahora mismo";
  if (a < 3600) return rtf().format(Math.round(diff / 60), "minute");
  if (a < 86400) return rtf().format(Math.round(diff / 3600), "hour");
  if (a < 86400 * 30) return rtf().format(Math.round(diff / 86400), "day");
  if (a < 86400 * 365) return rtf().format(Math.round(diff / (86400 * 30)), "month");
  return rtf().format(Math.round(diff / (86400 * 365)), "year");
}

export const SOURCE_LABEL: Record<string, string> = {
  folder: "Carpeta local",
  manual: "Manual",
  repack: "Repack",
  rom: "ROM",
};

/** Bytes → "18,4 GB" / "512 MB". */
export function bytes(n?: number | null) {
  const b = Math.max(0, n || 0);
  if (b >= 1024 ** 4) return `${(b / 1024 ** 4).toLocaleString(locale(), { maximumFractionDigits: 2 })} TB`;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toLocaleString(locale(), { maximumFractionDigits: 1 })} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

/** Bytes/s → "12,3 MB/s". */
export function speed(bps?: number | null) {
  const b = Math.max(0, bps || 0);
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toLocaleString(locale(), { maximumFractionDigits: 1 })} MB/s`;
  return `${Math.round(b / 1024)} KB/s`;
}

/** Segundos que faltan → "1 h 20 min". */
export function eta(s?: number | null) {
  if (s == null || !isFinite(s) || s <= 0) return "";
  if (s < 60) return "menos de 1 min";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h >= 48) return `${Math.round(h / 24)} días`;
  return h ? `${h} h ${m} min` : `${m} min`;
}

export const PROFILE_COLORS = ["#4f8cff", "#8b5cf6", "#ec4899", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#ef4444", "#64748b"];
