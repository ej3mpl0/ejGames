// Piezas comunes de Explorar y Descargas (ventanas del host).

import type { DownloadItem, Repack } from "../../api/types";
import { cx } from "../../components/ui";
// @ts-ignore módulo JS del kit
import { downloadLabel as kitDownloadLabel, percent, sizeText as kitSizeText } from "../../../sdk/kit/store.js";

export const downloadLabel = kitDownloadLabel as (d: DownloadItem) => string;
export const pct = percent as (p: number) => string;
/** "from 18 GB" → "desde 18 GB". */
export const sizeText = kitSizeText as (s?: string | null) => string;

export function Cover({ src, title, className }: { src?: string | null; title: string; className?: string }) {
  return (
    <div className={cx("relative overflow-hidden rounded-[calc(var(--h-radius)*0.6)] bg-surface-3", className)}>
      {src ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center p-2 text-center text-xs text-muted">{title}</div>
      )}
    </div>
  );
}

export function Progress({ value, className, muted }: { value: number; className?: string; muted?: boolean }) {
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-surface-3", className)}>
      <div
        className={cx("h-full rounded-full transition-[width] duration-700", muted ? "bg-muted/60" : "bg-accent")}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

const BADGE: Partial<Record<Repack["status"]["state"], string>> = {
  installed: "Instalado",
  library: "En tu biblioteca",
  downloading: "Descargando",
  queued: "En cola",
  paused: "En pausa",
  seeding: "Descargado",
  completed: "Descargado",
  installing: "Instalando",
  error: "Error",
};

export function StatusBadge({ r }: { r: Repack }) {
  const label = BADGE[r.status.state];
  if (!label) return null;
  const good = r.status.state === "installed" || r.status.state === "seeding" || r.status.state === "completed";
  return (
    <span
      className={cx(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        good ? "bg-emerald-500/20 text-emerald-300" : r.status.state === "error" ? "bg-red-500/20 text-red-300" : "bg-accent/20 text-accent",
      )}
    >
      {label}
      {(r.status.state === "downloading" || r.status.state === "queued") && r.status.progress != null && ` ${pct(r.status.progress)}`}
    </span>
  );
}
