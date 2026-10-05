// Explorar → Homebrew: software libre o redistribuible para Switch (hb-appstore),
// PS Vita (VitaDB) y 3DS (Universal-DB). Se instala con un clic y se juega con el
// emulador del sistema. Todos los temas abren esta ventana desde su tienda.

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Cpu, Download, ExternalLink, Gamepad2, Play, RefreshCw, Search, Trash2, X } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, errMsg } from "../api/tauri";
import type { HomebrewEntry, HomebrewPage, HomebrewSystem } from "../api/types";
import { Button, Empty, Modal, Spinner, cx } from "../components/ui";
import { dismissHomebrewJob, installHomebrew } from "../host/downloads";
import { useOverlayNav } from "../input/nav";
import { bytes } from "../lib/format";
import { t } from "../lib/i18n";
import { useApp } from "../store/app";

const SYSTEMS: { id: HomebrewSystem; label: string; source: string; emulators: string }[] = [
  { id: "switch", label: "Nintendo Switch", source: "hb-appstore (Switchbru)", emulators: "Eden / Ryujinx" },
  { id: "vita", label: "PS Vita", source: "VitaDB", emulators: "Vita3K" },
  { id: "3ds", label: "Nintendo 3DS", source: "Universal-DB", emulators: "Azahar" },
];
const CATS: Record<string, string> = { all: "Todo", game: "Juegos", emulator: "Emuladores", tool: "Utilidades", other: "Otros" };
const SORTS: Record<string, string> = { popular: "Populares", recent: "Recientes", name: "Nombre" };

export function HomebrewStore({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const jobs = useApp((s) => s.homebrewJobs);
  const cached = useApp((s) => s.homebrewCatalog);
  const set = useApp((s) => s.set);
  const [system, setSystem] = useState<HomebrewSystem>(((args?.system as HomebrewSystem) || "switch") as HomebrewSystem);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("popular");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HomebrewPage | null>(cached[system] ?? null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<HomebrewEntry | null>(null);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: () => (open ? setOpen(null) : onClose()) });
  const seq = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const load = async (force = false) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const p = await api.homebrewCatalog({ system, query, category, sort, page, force });
      if (my !== seq.current) return;
      setData(p);
      if (!query && category === "all" && sort === "popular" && page === 1) set({ homebrewCatalog: { ...useApp.getState().homebrewCatalog, [system]: p } });
      scroller.current?.scrollTo({ top: 0 });
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };
  // Al escribir, se espera un poco antes de buscar.
  useEffect(() => {
    const id = setTimeout(() => void load(), query ? 250 : 0);
    return () => clearTimeout(id);
  }, [system, query, category, sort, page]);
  // Al terminar una instalación, la tarjeta pasa a «Jugar».
  const doneCount = Object.keys(jobs).length;
  useEffect(() => {
    if (data) void load();
  }, [doneCount]);

  const sys = SYSTEMS.find((s) => s.id === system)!;
  const pick = (s: HomebrewSystem) => {
    setSystem(s);
    setPage(1);
    setCategory("all");
    setData(cached[s] ?? null);
  };

  const play = (e: HomebrewEntry) => {
    const id = e.installed?.gameId;
    if (id) void api.romLaunch(id).catch((err) => toast("error", errMsg(err)));
  };
  const remove = async (e: HomebrewEntry) => {
    const ok = await ask(t("Se borrará «{name}» de la carpeta de ejGames y de tu biblioteca.", { name: e.name }), {
      title: t("Quitar {name}", { name: e.name }),
      kind: "warning",
      okLabel: t("Quitar"),
      cancelLabel: t("Cancelar"),
    });
    if (!ok) return;
    try {
      await api.homebrewUninstall(e.id);
      void load();
    } catch (err) {
      toast("error", errMsg(err));
    }
  };

  const actions = (e: HomebrewEntry, big = false) => {
    const job = jobs[e.id];
    if (job && job.phase !== "error") {
      const pct = job.phase === "download" && job.total ? Math.min(100, (job.received / job.total) * 100) : null;
      return (
        <div className="w-full">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className={cx("h-full bg-accent", pct === null && "animate-pulse")} style={{ width: pct === null ? "100%" : `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-muted">
            {job.phase === "queued"
              ? t("En cola")
              : job.phase === "download"
                ? `${t("Descargando…")} ${bytes(job.received)}${job.total ? ` / ${bytes(job.total)}` : ""}`
                : t("Instalando…")}
          </div>
        </div>
      );
    }
    const size = big ? undefined : "sm";
    return (
      <div className="flex flex-wrap gap-2">
        {e.installed?.gameId ? (
          <Button size={size} variant="primary" icon={<Play size={14} />} onClick={() => play(e)}>
            {t("Jugar")}
          </Button>
        ) : e.runnable ? (
          <Button size={size} variant="primary" icon={<Download size={14} />} onClick={() => installHomebrew(e)}>
            {t("Instalar")}
          </Button>
        ) : null}
        {e.installed && e.update && (
          <Button size={size} icon={<Download size={14} />} onClick={() => installHomebrew(e)}>
            {t("Actualizar")}
          </Button>
        )}
        {e.installed && (
          <Button size={size} variant="ghost" icon={<Trash2 size={14} />} onClick={() => void remove(e)}>
            {t("Quitar")}
          </Button>
        )}
        {big && e.site && (
          <Button size={size} variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void api.openExternal(e.site!)}>
            {t("Web")}
          </Button>
        )}
        {job?.phase === "error" && (
          <button className="text-xs text-red-300 underline" onClick={() => dismissHomebrewJob(e.id)} title={job.message ?? ""}>
            {t("Falló: quitar aviso")}
          </button>
        )}
      </div>
    );
  };

  /** «Se juega con Eden», o por qué no. */
  const runsWith = (e: HomebrewEntry) =>
    !e.runnable ? (
      <span className="text-amber-300/90">{t("Para la consola real (no se juega con emulador)")}</span>
    ) : data?.emulator ? (
      <span>{t("Se juega con {emu}", { emu: data.emulator })}</span>
    ) : (
      <span className="text-amber-300/90">{t("Requiere emulador: {emu}", { emu: sys.emulators })}</span>
    );

  return (
    <Modal
      ref={ref}
      title={
        <span className="flex items-center gap-2">
          <Gamepad2 size={18} className="text-accent" /> {t("Homebrew")}
        </span>
      }
      headerExtra={
        <>
          <Button size="sm" variant="ghost" icon={<Cpu size={14} />} onClick={() => useApp.getState().open("software")}>
            {t("Homebrew")}
          </Button>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load(true)}>
            {t("Actualizar catálogo")}
          </Button>
        </>
      }
      onClose={onClose}
      width="min(1180px, 96vw)"
    >
      <div className="relative flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          {SYSTEMS.map((s) => (
            <button
              key={s.id}
              data-nav
              data-tab
              data-autofocus={s.id === system || undefined}
              aria-selected={s.id === system}
              onClick={() => pick(s.id)}
              className={cx("rounded-full px-4 py-1.5 text-sm cursor-pointer", s.id === system ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-fg")}
            >
              {s.label}
            </button>
          ))}
          <label className="ml-auto flex h-9 min-w-[220px] items-center gap-2 rounded-full bg-surface-2 px-3 ring-1 ring-line">
            <Search size={15} className="text-muted" />
            <input
              data-nav
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder={t("Buscar homebrew")}
              className="w-full bg-transparent text-sm outline-none"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label={t("Borrar")}>
                <X size={14} />
              </button>
            )}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm">
          {Object.entries(CATS)
            .filter(([k]) => k === "all" || data?.categories.some(([c]) => c === k))
            .map(([k, label]) => (
              <button
                key={k}
                data-nav
                onClick={() => {
                  setCategory(k);
                  setPage(1);
                }}
                className={cx("rounded-lg px-3 py-1 cursor-pointer", category === k ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}
              >
                {t(label)}
                {k !== "all" && <span className="ml-1 text-xs text-muted">{data?.categories.find(([c]) => c === k)?.[1]}</span>}
              </button>
            ))}
          <span className="ml-auto text-xs text-muted">{t("Orden")}:</span>
          {Object.entries(SORTS).map(([k, label]) => (
            <button key={k} data-nav onClick={() => setSort(k)} className={cx("rounded-lg px-2 py-1 cursor-pointer", sort === k ? "text-accent" : "text-muted hover:text-fg")}>
              {t(label)}
            </button>
          ))}
        </div>
        <div className="mx-5 mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-muted">
          <span>{t("Catálogo: {source}", { source: sys.source })}</span>
          <span>·</span>
          {data?.emulator ? (
            <span>{t("Emulador: {emu}", { emu: data.emulator })}</span>
          ) : (
            <span className="text-amber-300/90">
              {t("Sin emulador para {system}: instálalo en Homebrew ({emu})", { system: sys.label, emu: sys.emulators })}
            </span>
          )}
          {data?.error && <span className="text-red-300">· {t("Sin conexión con el catálogo; se muestra el último guardado.")}</span>}
        </div>

        <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {!data ? (
            <div className="grid h-40 place-items-center">
              <Spinner size={26} />
            </div>
          ) : data.items.length === 0 ? (
            <Empty icon={<Gamepad2 size={40} />} title={t("Nada por aquí")}>
              {data.error ? data.error : t("Prueba con otra búsqueda o categoría.")}
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.items.map((e) => (
                <div key={e.id} className="flex gap-3 rounded-xl bg-surface-2 p-3 ring-1 ring-line">
                  <button data-nav onClick={() => setOpen(e)} className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-3 cursor-pointer" aria-label={e.name}>
                    {e.icon ? <img src={e.icon} alt="" loading="lazy" className="h-full w-full object-cover" style={{ imageRendering: system === "3ds" ? "pixelated" : undefined }} /> : null}
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <button onClick={() => setOpen(e)} className="truncate text-left font-semibold hover:underline cursor-pointer">
                      {e.name}
                    </button>
                    <div className="truncate text-xs text-muted">
                      {e.author || "—"}
                      {e.version && ` · ${e.version}`}
                      {e.size ? ` · ${bytes(e.size)}` : ""}
                    </div>
                    <p className="line-clamp-2 text-xs text-muted">{e.description}</p>
                    <div className="text-[11px] text-muted">{runsWith(e)}</div>
                    <div className="mt-auto pt-1">{actions(e)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {loading && data && (
            <div className="pointer-events-none absolute right-6 top-2">
              <Spinner size={16} />
            </div>
          )}
        </div>
        {data && data.pages > 1 && (
          <div className="flex items-center justify-center gap-3 border-t border-line py-2 text-sm">
            <Button size="sm" variant="ghost" icon={<ChevronLeft size={14} />} disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
              {t("Anterior")}
            </Button>
            <span className="text-muted">{t("Página {n} de {total}", { n: data.page, total: data.pages })}</span>
            <Button size="sm" variant="ghost" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>
              {t("Siguiente")} <ChevronRight size={14} />
            </Button>
          </div>
        )}

        {open && (
          <div className="absolute inset-0 z-10 flex flex-col bg-surface/95 backdrop-blur">
            <div className="flex items-center gap-3 border-b border-line px-5 py-3">
              <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => setOpen(null)} data-autofocus>
                {t("Volver")}
              </Button>
              <b className="truncate">{open.name}</b>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="flex gap-4">
                {open.icon && <img src={open.icon} alt="" className="h-28 w-28 shrink-0 rounded-xl object-cover" />}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-sm text-muted">
                    {open.author || "—"}
                    {open.version && ` · ${t("Versión {v}", { v: open.version })}`}
                    {open.updated && ` · ${open.updated}`}
                    {open.license && ` · ${open.license}`}
                    {open.size ? ` · ${bytes(open.size)}` : ""}
                  </div>
                  <div className="text-sm">{runsWith(open)}</div>
                  {actions(open, true)}
                </div>
              </div>
              {open.screens.length > 0 && (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                  {open.screens.map((s) => (
                    <img key={s} src={s} alt="" loading="lazy" className="h-44 shrink-0 rounded-lg object-contain ring-1 ring-line" />
                  ))}
                </div>
              )}
              {open.requirements && (
                <div className="mt-4 whitespace-pre-line rounded-lg bg-amber-500/10 p-3 text-sm">
                  <b className="mb-1 block text-xs uppercase tracking-wide">{t("Necesita")}</b>
                  {open.requirements}
                </div>
              )}
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted">{open.details || open.description}</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
