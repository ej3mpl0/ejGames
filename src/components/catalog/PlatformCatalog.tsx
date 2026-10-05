// Catálogo de una plataforma en una fuente: la lista de la web (populares o
// novedades, con búsqueda y páginas) y los filtros cruzados de región, idioma y
// tipo, que se aplican sobre lo cargado.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Gamepad2, RefreshCw } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { CatalogCategory, CatalogEntry, Platform } from "../../api/types";
import { CATEGORY_LABELS, SORT_LABELS, applyFilters, entryKey, facet, modeForSort, type CatalogFilters, type CatalogSort } from "../../lib/catalog/sources";
import { t } from "../../lib/i18n";
import { useApp } from "../../store/app";
import { Button, Empty, Spinner, cx } from "../ui";
import { CatalogCard } from "./CatalogCard";

function Chips<T extends string>({ label, all, value, names, onChange }: { label: string; all: T[]; value: T[]; names?: Record<string, string>; onChange: (v: T[]) => void }) {
  if (all.length < 2 && !value.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">{label}:</span>
      {all.map((v) => {
        const on = value.includes(v);
        return (
          <button
            key={v}
            data-nav
            onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}
            className={cx("rounded-full px-2.5 py-0.5 ring-1 cursor-pointer", on ? "bg-accent text-white ring-accent" : "bg-surface-2 text-muted ring-line hover:text-fg")}
          >
            {names?.[v] ? t(names[v]) : v}
          </button>
        );
      })}
    </div>
  );
}

export function PlatformCatalog({
  sourceId,
  platform,
  query = "",
  filters,
  onFilters,
  onOpen,
}: {
  sourceId: string;
  platform: Platform | null;
  query?: string;
  filters: CatalogFilters;
  onFilters: (f: CatalogFilters) => void;
  onOpen: (e: CatalogEntry) => void;
}) {
  const jobs = useApp((s) => s.catalogJobs);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const mode = query.trim() ? "search" : platform && filters.sort !== "newest" ? "platform" : modeForSort(filters.sort);

  const load = async (p: number, force = false) => {
    const my = ++seq.current;
    setLoading(true);
    if (p === 1) setError("");
    try {
      const r = await api.catalogBrowse({ sourceId, mode, query, platform, page: p, force });
      if (my !== seq.current) return;
      setEntries((old) => (p === 1 ? r.entries : [...old, ...r.entries.filter((e) => !old.some((o) => o.id === e.id))]));
      setMore(r.hasMore);
      setPage(p);
      if (r.error) setError(r.error);
    } catch (e) {
      if (my === seq.current) setError(errMsg(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    setEntries([]);
    const id = setTimeout(() => void load(1), query ? 300 : 0);
    return () => clearTimeout(id);
  }, [sourceId, platform, query, mode]);
  // Al terminar una descarga, se vuelve a pedir para marcarla «En tu biblioteca».
  const done = Object.values(jobs).filter((j) => j.phase === "done").length;
  useEffect(() => {
    if (done && entries.length) void load(1);
  }, [done]);

  const regions = useMemo(() => facet(entries, "region"), [entries]);
  const langs = useMemo(() => facet(entries, "language"), [entries]);
  const cats = useMemo(() => [...new Set(entries.map((e) => e.category))] as CatalogCategory[], [entries]);
  const shown = useMemo(() => applyFilters(entries, filters), [entries, filters]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2">
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted">{t("Orden")}:</span>
          {(Object.keys(SORT_LABELS) as CatalogSort[]).map((k) => (
            <button key={k} data-nav onClick={() => onFilters({ ...filters, sort: k })} className={cx("rounded-lg px-2 py-0.5 cursor-pointer", filters.sort === k ? "text-accent" : "text-muted hover:text-fg")}>
              {t(SORT_LABELS[k])}
            </button>
          ))}
        </div>
        <Chips label={t("Tipo")} all={cats} value={filters.category} names={CATEGORY_LABELS} onChange={(category) => onFilters({ ...filters, category })} />
        <Chips label={t("Región")} all={regions} value={filters.region} onChange={(region) => onFilters({ ...filters, region })} />
        <Chips label={t("Idioma")} all={langs} value={filters.language} onChange={(language) => onFilters({ ...filters, language })} />
        <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw size={13} />} onClick={() => void load(1, true)}>
          {t("Recargar")}
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
        {!entries.length && loading ? (
          <div className="grid h-40 place-items-center">
            <Spinner size={26} />
          </div>
        ) : !shown.length ? (
          <Empty icon={<Gamepad2 size={40} />} title={t("Nada por aquí")}>
            {entries.length ? t("Ningún resultado con estos filtros.") : t("Prueba con otra búsqueda, plataforma o fuente.")}
          </Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {shown.map((e) => (
              <CatalogCard key={e.id} entry={e} job={jobs[entryKey(e)]} onOpen={() => onOpen(e)} />
            ))}
          </div>
        )}
        {more && entries.length > 0 && (
          <div className="mt-4 flex justify-center">
            <Button icon={loading ? <Spinner size={14} /> : <ChevronDown size={15} />} disabled={loading} onClick={() => void load(page + 1)}>
              {t("Cargar más")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
