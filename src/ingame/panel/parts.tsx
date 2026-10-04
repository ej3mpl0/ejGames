// Piezas y formatos que comparten los paneles de todas las plataformas.

import { useState, type ReactNode } from "react";
import { locale } from "../../lib/i18n";
import type { Achievement } from "../../api/types";

export const cls = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ─────────── formatos ───────────

const two = (n: number) => String(n).padStart(2, "0");

/** 21:34 */
export const clock = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;

/** "sábado, 27 de septiembre" */
export const dayLabel = (d: Date) => d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });

/** 1523 → "25 min"; 7300 → "2 h 1 min" */
export function dur(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return "< 1 min";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** 1523 → "00:25:23" */
export function hms(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

/** Horas con un decimal por debajo de 10: "3,4 h", "126 h". */
export function hoursLabel(seconds: number) {
  const h = seconds / 3600;
  if (h < 1) return dur(seconds);
  return `${h.toLocaleString(locale(), { maximumFractionDigits: h < 10 ? 1 : 0 })} h`;
}

export function gb(bytes?: number | null) {
  const b = Math.max(0, bytes || 0);
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toLocaleString(locale(), { maximumFractionDigits: 1 })} GB`;
  return `${Math.round(b / 1024 ** 2)} MB`;
}

export function speed(bps?: number | null) {
  const b = Math.max(0, bps || 0);
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toLocaleString(locale(), { maximumFractionDigits: 1 })} MB/s`;
  return `${Math.round(b / 1024)} KB/s`;
}

/** 12.345 → "12,3" (una cifra decimal por debajo de 10). */
export const pctNum = (p: number) => p.toLocaleString(locale(), { maximumFractionDigits: p < 10 ? 1 : 0 });

/** Fecha de un desbloqueo: "27 sept 2026". */
export const shortDate = (ts: number) => new Date(ts * 1000).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });

/** "hoy a las 21:04", "ayer a las 9:10", "12 sept 2026". */
export function whenLabel(ts: number) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return `hoy a las ${clock(d)}`;
  if (days === 1) return `ayer a las ${clock(d)}`;
  return shortDate(ts);
}

/** Lo que dice una descarga en una línea. */
export function downloadLine(d: { state: string; pauseReason?: string | null; progress: number; downBps: number }) {
  const p = `${Math.floor(d.progress * 100)} %`;
  if (d.pauseReason === "playing") return `${p} · en pausa mientras juegas`;
  switch (d.state) {
    case "downloading":
      return d.downBps ? `${p} · ${speed(d.downBps)}` : `${p} · conectando`;
    case "queued":
      return `${p} · en cola`;
    case "paused":
      return `${p} · en pausa`;
    case "seeding":
    case "completed":
      return "Lista para instalar";
    case "installing":
      return "Instalándose";
    case "error":
      return "Con un error";
    default:
      return p;
  }
}

/** Posición de la canción: "1:24 / 3:30". */
export function trackTime(pos?: number | null, len?: number | null) {
  if (pos == null || !len) return "";
  const f = (s: number) => `${Math.floor(s / 60)}:${two(Math.floor(s % 60))}`;
  return `${f(pos)} / ${f(len)}`;
}

// ─────────── piezas ───────────

/** Icono de un logro (gris si no se tiene); si no hay o falla, `fallback`. */
export function AchIcon({ a, className, fallback }: { a: Achievement; className?: string; fallback: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const src = a.unlockedAt ? a.icon : a.iconGray || a.icon;
  if (src && !broken) return <img className={className} src={src} alt="" draggable={false} onError={() => setBroken(true)} />;
  return <span className={cls(className, "ph")}>{fallback}</span>;
}

/** Imagen que desaparece si no carga. */
export function Img({ src, className, alt = "" }: { src?: string | null; className?: string; alt?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return <img className={className} src={src} alt={alt} draggable={false} onError={() => setBroken(true)} />;
}

/** Gráfica de línea de los últimos valores (0..max). Usa currentColor. */
export function Spark({ values, max = 100, className, fill = true }: { values: number[]; max?: number; className?: string; fill?: boolean }) {
  const n = 60;
  const w = 120;
  const h = 32;
  const pts = values.slice(-n).map((v, i, arr) => {
    const x = w - (arr.length - 1 - i) * (w / (n - 1));
    const y = h - Math.min(1, Math.max(0, v / (max || 1))) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {pts.length > 1 && fill && <polygon points={`${pts[0].split(",")[0]},${h} ${pts.join(" ")} ${w},${h}`} fill="currentColor" opacity="0.16" />}
      {pts.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Pila con su nivel (mando o portátil). */
export function BatteryIcon({ level, charging, className }: { level?: number | null; charging?: boolean; className?: string }) {
  const l = level == null ? null : Math.max(0, Math.min(100, level));
  const low = l != null && l <= 15;
  return (
    <svg className={className} viewBox="0 0 26 14" aria-hidden="true">
      <rect x="0.75" y="0.75" width="21.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="23" y="4.5" width="2.25" height="5" rx="1" fill="currentColor" />
      {l != null && <rect x="3" y="3" width={Math.max(1.5, 17 * (l / 100))} height="8" rx="1" fill={low ? "#ff5d55" : "currentColor"} />}
      {charging && <path d="M12.6 1.8 8.4 7.6h3.2l-1.4 4.6 4.6-6.1h-3.3Z" fill="currentColor" stroke="rgba(0,0,0,.55)" strokeWidth=".8" />}
    </svg>
  );
}

/** Mando (para la batería del mando). */
export function PadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.2 6.5h9.6a4.9 4.9 0 0 1 4.8 5.9l-.9 4.2a2.4 2.4 0 0 1-4.2 1.1l-1.8-2.2H9.3l-1.8 2.2a2.4 2.4 0 0 1-4.2-1.1l-.9-4.2a4.9 4.9 0 0 1 4.8-5.9Zm.6 3v1.6H6.2v1.5h1.6v1.6h1.5v-1.6h1.6v-1.5H9.3V9.5H7.8Zm8.4.1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-2 2.1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
      />
    </svg>
  );
}

/** Copa (logros sin icono). */
export function CupIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.5 3h11v5.2a5.5 5.5 0 0 1-4.6 5.43V16.5h3.3v3.5H7.8v-3.5h3.3v-2.87A5.5 5.5 0 0 1 6.5 8.2V3Zm-4 1.2h3v1.9H4.4v.7a2.8 2.8 0 0 0 2 2.68l-.5 1.84A4.7 4.7 0 0 1 2.5 6.8V4.2Zm15.99 0h3V6.8a4.7 4.7 0 0 1-3.4 4.53l-.5-1.84a2.8 2.8 0 0 0 2-2.69v-.7h-1.1V4.2Z"
      />
    </svg>
  );
}

/** Candado (logro oculto). */
export function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 10V7.5a5 5 0 0 1 10 0V10h1.2c.7 0 1.3.6 1.3 1.3v8.4c0 .7-.6 1.3-1.3 1.3H5.8c-.7 0-1.3-.6-1.3-1.3v-8.4c0-.7.6-1.3 1.3-1.3H7Zm2.2 0h5.6V7.5a2.8 2.8 0 0 0-5.6 0V10Z" />
    </svg>
  );
}

/** Rótulo del mando o del portátil con su batería ("Mando 80 %"). */
export function batteryText(level?: number | null, state?: string) {
  if (state === "wired") return "Con cable";
  if (state === "charging") return level != null ? `Cargando · ${level} %` : "Cargando";
  if (level != null) return `${level} %`;
  return "";
}
