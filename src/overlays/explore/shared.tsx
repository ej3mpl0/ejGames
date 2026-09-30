// Piezas comunes de Explorar y Descargas (ventanas del host).

import { useState } from "react";
import { ChevronDown, ExternalLink, ShieldAlert } from "lucide-react";
import { api } from "../../api/tauri";
import type { DownloadItem, Repack } from "../../api/types";
import { Button, cx } from "../../components/ui";
// @ts-ignore módulo JS del kit
import { downloadLabel as kitDownloadLabel, percent, sizeText as kitSizeText, HYPERVISOR } from "../../../sdk/kit/store.js";

export const downloadLabel = kitDownloadLabel as (d: DownloadItem) => string;
export const pct = percent as (p: number) => string;
/** "from 18 GB" → "desde 18 GB". */
export const sizeText = kitSizeText as (s?: string | null) => string;

/** Textos del crack de hipervisor (HV), los mismos que usan los temas. */
export const HV = HYPERVISOR as {
  badge: string;
  tip: string;
  title: string;
  summary: string;
  download: string;
  sections: { id: string; title: string; items: string[]; ordered?: boolean; note?: string }[];
  guide: string;
  guideLabel: string;
  moreLabel: string;
  lessLabel: string;
};

/** Etiqueta «HV» junto al nombre de un repack con crack de hipervisor. */
export function HvTag({ className }: { className?: string }) {
  return (
    <span title={HV.tip} className={cx("inline-block rounded-[4px] bg-red-600 px-1.5 align-middle text-[10px] font-bold leading-4 tracking-wide text-white", className)}>
      {HV.badge}
    </span>
  );
}

/** Explicación del HV en la ficha: el resumen y, al desplegar, requisitos, cambios, pasos y riesgos. */
export function HypervisorPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className="mb-5 rounded-[var(--h-radius)] bg-red-500/[0.08] p-4 ring-1 ring-red-400/30">
      <div className="flex gap-3">
        <ShieldAlert size={22} className="mt-0.5 shrink-0 text-red-300" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{HV.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-fg/85">{HV.summary}</p>
        </div>
      </div>
      {open && (
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-red-400/20 pt-4">
          {HV.sections.map((s) => {
            const List = s.ordered ? "ol" : "ul";
            return (
              <div key={s.id}>
                <h4 className={cx("mb-1.5 text-xs font-semibold uppercase tracking-wide", s.id === "risks" ? "text-red-300" : "text-muted")}>{s.title}</h4>
                {s.note && <p className="mb-1.5 text-xs italic text-muted">{s.note}</p>}
                <List className={cx("flex flex-col gap-1 pl-4 text-[13px] leading-snug text-fg/85", s.ordered ? "list-decimal" : "list-disc")}>
                  {s.items.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </List>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="soft" icon={<ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} />} onClick={() => setOpen(!open)}>
          {open ? HV.lessLabel : HV.moreLabel}
        </Button>
        <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void api.openExternal(`https://fitgirl-repacks.site/${HV.guide}/`)}>
          {HV.guideLabel}
        </Button>
      </div>
    </section>
  );
}

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
