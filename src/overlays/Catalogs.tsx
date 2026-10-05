// Explorar → Catálogos: las fuentes que el usuario configura en
// config/catalog-sources.json (ejGames no trae ninguna). Fuentes con sus
// plataformas, selector de plataforma, catálogo por plataforma con filtros, búsqueda
// en todas las fuentes y la biblioteca de ROMs por plataforma.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Cpu, FileCog, Gamepad2 as Shelf, Library, LayoutGrid, RefreshCw, Search, Server, X } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { CatalogEntry, CatalogSourceInfo, Platform } from "../api/types";
import { CatalogCard, GameDetail, PlatformCatalog, PlatformIcon, PlatformSelector, RomLibrary } from "../components/catalog";
import { Button, Empty, Modal, Spinner, cx } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { platformName } from "../lib/catalog/platforms";
import { EMPTY_FILTERS, coveredPlatforms, entryKey, loadState, searchAll, sourcesFor, usable, type CatalogFilters } from "../lib/catalog/sources";
import { t } from "../lib/i18n";
import { useApp } from "../store/app";

type Tab = "sources" | "platforms" | "search" | "roms";

function SourceIcon({ s }: { s: CatalogSourceInfo }) {
  const icon = s.icon?.trim();
  if (icon && /^https:\/\//.test(icon)) return <img src={icon} alt="" className="h-10 w-10 rounded-lg object-cover" />;
  return <span className="grid h-10 w-10 place-items-center rounded-lg bg-surface-3 text-xl">{icon || <Server size={18} />}</span>;
}

export function Catalogs({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const state = useApp((s) => s.catalogState);
  const jobs = useApp((s) => s.catalogJobs);
  const set = useApp((s) => s.set);
  const [tab, setTab] = useState<Tab>((args?.tab as Tab) || "sources");
  const [platform, setPlatform] = useState<Platform | null>((args?.platform as Platform) || null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [open, setOpen] = useState<CatalogEntry | null>(null);
  const [search, setSearch] = useState<{ q: string; entries: CatalogEntry[]; errors: { sourceId: string; error: string }[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: () => (open ? setOpen(null) : platform && tab === "platforms" ? setPlatform(null) : onClose()) });

  const refresh = async (reload = false) => {
    try {
      set({ catalogState: await loadState(reload) });
      if (reload) toast("ok", t("Configuración de catálogos recargada"));
    } catch (e) {
      toast("error", errMsg(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const covered = useMemo(() => coveredPlatforms(state), [state]);
  const counts = useMemo(() => Object.fromEntries(covered.map((p) => [p, sourcesFor(state, p).length])) as Partial<Record<Platform, number>>, [state, covered]);
  const sourceName = (id: string) => state?.sources.find((s) => s.id === id)?.name ?? id;

  // Al elegir plataforma, la primera fuente que la tenga.
  const forPlatform = platform ? sourcesFor(state, platform) : [];
  useEffect(() => {
    if (platform && !forPlatform.some((s) => s.id === sourceId)) setSourceId(forPlatform[0]?.id ?? null);
  }, [platform, state]);

  const pickPlatform = (p: Platform, src?: string) => {
    setPlatform(p);
    setTab("platforms");
    setQuery("");
    setFilters(EMPTY_FILTERS);
    if (src) setSourceId(src);
  };

  const runSearch = async (q: string) => {
    if (!q.trim()) return setSearch(null);
    setSearching(true);
    try {
      const r = await searchAll(q, platform ? [platform] : []);
      setSearch({ q, entries: r.entries, errors: r.errors });
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setSearching(false);
    }
  };

  const editConfig = async (which: "sources" | "emulators") => {
    try {
      const path = await api.catalogsOpenConfig(which);
      toast("info", t("Editando {path}. Al guardar, pulsa «Recargar».", { path }));
      void refresh();
    } catch (e) {
      toast("error", errMsg(e));
    }
  };

  const active = Object.values(jobs).filter((j) => !["done", "error"].includes(j.phase)).length;
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "sources", label: t("Fuentes"), icon: <Server size={14} /> },
    { id: "platforms", label: t("Plataformas"), icon: <LayoutGrid size={14} /> },
    { id: "search", label: t("Buscar en todas"), icon: <Search size={14} /> },
    { id: "roms", label: t("Mis ROMs"), icon: <Shelf size={14} /> },
  ];

  const noSources = state && !state.sources.some(usable);
  const noOwn = state && !state.sources.some((s) => !s.builtin);

  return (
    <Modal
      ref={ref}
      title={
        <span className="flex items-center gap-2">
          <Library size={18} className="text-accent" /> {t("Catálogos")}
          {active > 0 && <span className="rounded-full bg-accent px-2 text-xs text-white">{active}</span>}
        </span>
      }
      headerExtra={
        <>
          <Button size="sm" variant="ghost" icon={<FileCog size={14} />} onClick={() => void editConfig("sources")}>
            {t("Editar fuentes")}
          </Button>
          <Button size="sm" variant="ghost" icon={<Cpu size={14} />} onClick={() => void editConfig("emulators")}>
            {t("Editar emuladores")}
          </Button>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void refresh(true)}>
            {t("Recargar")}
          </Button>
        </>
      }
      onClose={onClose}
      width="min(1240px, 96vw)"
    >
      <div className="relative flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          {tabs.map((x) => (
            <button
              key={x.id}
              data-nav
              data-tab
              data-autofocus={x.id === tab || undefined}
              aria-selected={x.id === tab}
              onClick={() => setTab(x.id)}
              className={cx("flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm cursor-pointer", x.id === tab ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-fg")}
            >
              {x.icon} {x.label}
            </button>
          ))}
        </div>

        {(state?.error || state?.emulatorsError) && (
          <div className="mx-5 mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{[state?.error, state?.emulatorsError].filter(Boolean).join(" · ")}</span>
          </div>
        )}

        {!state ? (
          <div className="grid flex-1 place-items-center">
            <Spinner size={26} />
          </div>
        ) : tab === "sources" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {(noSources || noOwn) && (
              <div className="mb-4 rounded-xl bg-accent/10 p-4 text-sm ring-1 ring-accent/30">
                <b className="mb-1 block">{t("Añade tus fuentes")}</b>
                <p className="text-muted">
                  {t("Además de las fuentes de serie, puedes añadir las tuyas: pulsa «Editar fuentes», copia una de ejemplo, pon sus direcciones y selectores, actívala, guarda y pulsa «Recargar».")}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-muted">{state.path}</p>
              </div>
            )}
            {state.sources.length === 0 ? (
              <Empty icon={<Server size={40} />} title={t("Sin fuentes configuradas")} />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {state.sources.map((s) => (
                  <div key={s.id} className={cx("flex flex-col gap-2 rounded-xl bg-surface-2 p-4 ring-1 ring-line", !usable(s) && "opacity-80")}>
                    <div className="flex items-center gap-3">
                      <SourceIcon s={s} />
                      <div className="min-w-0 flex-1">
                        <b className="block truncate">{s.name}</b>
                        <span className="block truncate text-xs text-muted">
                          {s.builtin ? t("De serie") : t("Tuya")} · {s.baseUrl} · {s.kind === "api" ? "API" : "HTML"}
                          {!s.enabled && ` · ${t("desactivada")}`}
                        </span>
                      </div>
                    </div>
                    {s.problems.length > 0 && (
                      <ul className="list-inside list-disc rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        {s.problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {s.platforms.map((p) => (
                        <button
                          key={p.id}
                          data-nav
                          disabled={!usable(s)}
                          onClick={() => pickPlatform(p.id, s.id)}
                          title={p.system ? (p.emulator ? t("Se juega con {emu}", { emu: p.emulator }) : t("Sin emulador instalado")) : t("Sin emulador")}
                          className="flex items-center gap-1.5 rounded-lg bg-surface-3 py-1 pl-1 pr-2 text-xs hover:brightness-125 disabled:pointer-events-none cursor-pointer"
                        >
                          <PlatformIcon platform={p.id} size={20} />
                          {p.name}
                          <span className={cx("text-[10px]", p.emulator ? "text-muted" : "text-amber-300/90")}>{p.system ? p.emulator || t("sin emulador") : "—"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === "platforms" ? (
          platform ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
                <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => setPlatform(null)}>
                  {t("Plataformas")}
                </Button>
                <PlatformIcon platform={platform} size={28} />
                <b>{platformName(platform)}</b>
                <div className="flex flex-wrap gap-1">
                  {forPlatform.map((s) => (
                    <button
                      key={s.id}
                      data-nav
                      onClick={() => setSourceId(s.id)}
                      className={cx("rounded-full px-3 py-1 text-xs cursor-pointer", s.id === sourceId ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-fg")}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                <label className="ml-auto flex h-8 min-w-[220px] items-center gap-2 rounded-full bg-surface-2 px-3 ring-1 ring-line">
                  <Search size={14} className="text-muted" />
                  <input data-nav value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Buscar en esta fuente")} className="w-full bg-transparent text-sm outline-none" />
                  {query && (
                    <button onClick={() => setQuery("")} aria-label={t("Borrar")}>
                      <X size={13} />
                    </button>
                  )}
                </label>
              </div>
              {sourceId ? (
                <PlatformCatalog key={`${sourceId}:${platform}`} sourceId={sourceId} platform={platform} query={query} filters={filters} onFilters={setFilters} onOpen={setOpen} />
              ) : (
                <Empty icon={<Server size={40} />} title={t("Ninguna fuente tiene esta plataforma")} />
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {covered.length ? (
                <PlatformSelector platforms={covered} info={state.allPlatforms} counts={counts} onSelect={(p) => pickPlatform(p)} />
              ) : (
                <Empty icon={<LayoutGrid size={40} />} title={t("Ninguna plataforma todavía")}>
                  {t("Las plataformas salen de las fuentes que configures.")}
                </Empty>
              )}
            </div>
          )
        ) : tab === "search" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <form
              className="flex flex-wrap items-center gap-2 px-5 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch(query);
              }}
            >
              <label className="flex h-10 min-w-[280px] flex-1 items-center gap-2 rounded-full bg-surface-2 px-4 ring-1 ring-line">
                <Search size={15} className="text-muted" />
                <input data-nav value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Buscar en todas las fuentes")} className="w-full bg-transparent text-sm outline-none" />
              </label>
              <select data-nav value={platform ?? ""} onChange={(e) => setPlatform((e.target.value || null) as Platform | null)} className="h-10 rounded-full bg-surface-2 px-3 text-sm ring-1 ring-line">
                <option value="">{t("Todas las plataformas")}</option>
                {covered.map((p) => (
                  <option key={p} value={p}>
                    {platformName(p)}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="primary" icon={searching ? <Spinner size={14} /> : <Search size={14} />} disabled={searching}>
                {t("Buscar")}
              </Button>
            </form>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              {search?.errors.map((e) => (
                <div key={e.sourceId} className="mb-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-200">
                  {sourceName(e.sourceId)}: {e.error}
                </div>
              ))}
              {!search ? (
                <Empty icon={<Search size={40} />} title={t("Busca un juego en todas tus fuentes a la vez")} />
              ) : !search.entries.length ? (
                <Empty icon={<Search size={40} />} title={t("Sin resultados para «{q}»", { q: search.q })} />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                  {search.entries.map((e) => (
                    <CatalogCard key={entryKey(e)} entry={e} job={jobs[entryKey(e)]} showSource={sourceName(e.sourceId)} onOpen={() => setOpen(e)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <RomLibrary />
          </div>
        )}

        {open && <GameDetail entry={open} sourceName={sourceName(open.sourceId)} onBack={() => setOpen(null)} />}
      </div>
    </Modal>
  );
}
