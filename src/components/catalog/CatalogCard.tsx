// Tarjeta de una entrada de catálogo, con su estado de descarga.

import { CheckCircle2, ImageOff } from "lucide-react";
import type { CatalogEntry, CatalogJob } from "../../api/types";
import { CATEGORY_LABELS } from "../../lib/catalog/sources";
import { platformName } from "../../lib/catalog/platforms";
import { bytes } from "../../lib/format";
import { t } from "../../lib/i18n";
import { cx } from "../ui";
import { PlatformIcon } from "./PlatformSelector";

export function JobBar({ job }: { job: CatalogJob }) {
  const pct = job.phase === "download" && job.total ? Math.min(100, (job.received / job.total) * 100) : null;
  return (
    <div className="w-full">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className={cx("h-full bg-accent", pct === null && "animate-pulse")} style={{ width: pct === null ? "100%" : `${pct}%` }} />
      </div>
      <div className="mt-1 truncate text-[11px] text-muted">
        {job.phase === "queued"
          ? t("En cola")
          : job.phase === "download"
            ? `${t("Descargando…")} ${bytes(job.received)}${job.total ? ` / ${bytes(job.total)}` : ""}`
            : job.phase === "extract"
              ? t("Descomprimiendo…")
              : t("Ordenando y añadiendo a la biblioteca…")}
      </div>
    </div>
  );
}

export function CatalogCard({ entry, job, showSource, onOpen }: { entry: CatalogEntry; job?: CatalogJob; showSource?: string; onOpen: () => void }) {
  const busy = job && !["done", "error"].includes(job.phase);
  return (
    <button data-nav onClick={onOpen} className="group flex flex-col overflow-hidden rounded-xl bg-surface-2 text-left ring-1 ring-line transition hover:ring-accent cursor-pointer">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-surface-3">
        {entry.coverUrl ? (
          <img src={entry.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
        ) : (
          <div className="grid h-full place-items-center text-muted">
            <ImageOff size={28} />
          </div>
        )}
        <span className="absolute left-2 top-2">
          <PlatformIcon platform={entry.platform} size={28} />
        </span>
        {entry.category !== "game" && (
          <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">{t(CATEGORY_LABELS[entry.category])}</span>
        )}
        {entry.installedGameId && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            <CheckCircle2 size={11} /> {t("En tu biblioteca")}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 p-2.5">
        <span className="line-clamp-2 text-sm font-semibold leading-tight">{entry.title}</span>
        <span className="truncate text-[11px] text-muted">
          {[entry.platform ? platformName(entry.platform) : t("Plataforma desconocida"), entry.region, entry.size].filter(Boolean).join(" · ")}
        </span>
        {showSource && <span className="truncate text-[11px] text-muted">{showSource}</span>}
        {busy && (
          <div className="mt-1">
            <JobBar job={job!} />
          </div>
        )}
        {job?.phase === "error" && <span className="mt-1 line-clamp-2 text-[11px] text-red-300">{job.message}</span>}
      </div>
    </button>
  );
}
