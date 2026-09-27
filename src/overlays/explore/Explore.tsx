// Explorar (ventana del host, para temas sin tienda propia): portada con
// populares y novedades, búsqueda y fichas.

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Compass, Download, ExternalLink, Play, RefreshCw, Search } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { ExploreHome, ExplorePage, Repack, RepackDetails } from "../../api/types";
import { Button, Empty, Modal, Spinner, cx } from "../../components/ui";
import { installDownload, openExplore, openKeyboard } from "../../host/downloads";
import { useOverlayNav } from "../../input/nav";
import { useApp } from "../../store/app";
import { DownloadDialog } from "./DownloadDialog";
import { Cover, StatusBadge, sizeText } from "./shared";
// @ts-ignore módulo JS del kit
import { repackAction } from "../../../sdk/kit/store.js";

function Card({ r, onOpen }: { r: Repack; onOpen: (r: Repack) => void }) {
  return (
    <button data-nav onClick={() => onOpen(r)} className="group flex w-40 shrink-0 flex-col gap-1.5 rounded-[calc(var(--h-radius)*0.7)] p-1.5 text-left hover:bg-surface-3/50 cursor-pointer">
      <Cover src={r.cover} title={r.title} className="aspect-[3/4] w-full" />
      <span className="line-clamp-2 text-[13px] leading-tight">{r.title}</span>
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
        {r.repackSize && <span className="truncate">{sizeText(r.repackSize)}</span>}
        <StatusBadge r={r} />
      </span>
    </button>
  );
}

export function ExploreOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const source = useApp((s) => s.inputSource);
  const [home, setHome] = useState<ExploreHome | null>(null);
  const [homeError, setHomeError] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState<ExplorePage | null>(null);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<RepackDetails | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RepackDetails | null>(null);
  const seq = useRef(0);
  const timer = useRef<number>(0);

  const loadHome = () => {
    setHomeError("");
    api.exploreHome().then(setHome).catch((e) => setHomeError(errMsg(e)));
  };
  useEffect(loadHome, []);
  useEffect(() => {
    if (typeof args?.slug === "string") void open(args.slug);
  }, []);

  function search(text: string, pageNo = 1) {
    setQ(text);
    clearTimeout(timer.current);
    if (!text.trim()) {
      seq.current++;
      setPage(null);
      setSearching(false);
      return;
    }
    timer.current = window.setTimeout(async () => {
      const my = ++seq.current;
      setSearching(true);
      try {
        const r = await api.exploreSearch(text, pageNo);
        if (my !== seq.current) return;
        setPage((prev) => (pageNo > 1 && prev ? { ...r, items: [...prev.items, ...r.items] } : r));
      } catch (e) {
        if (my === seq.current) toast("error", errMsg(e));
      }
      if (my === seq.current) setSearching(false);
    }, pageNo > 1 ? 0 : 350);
  }

  async function open(slug: string) {
    setLoadingSlug(slug);
    try {
      setDetail(await api.exploreDetails(slug));
    } catch (e) {
      toast("error", errMsg(e));
    }
    setLoadingSlug(null);
  }

  async function action(d: RepackDetails) {
    const a = repackAction(d) as { id: string };
    if (a.id === "download") setDialog(d);
    else if (a.id === "install" && d.status.downloadId) void installDownload(d.status.downloadId);
    else if (a.id === "play" && d.status.gameId) {
      onClose();
      api.play(d.status.gameId).catch((e) => toast("error", errMsg(e)));
    } else openExplore("downloads");
  }

  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => (dialog ? setDialog(null) : detail ? setDetail(null) : onClose()),
    extra: {
      y: async () => {
        const v = await openKeyboard({ title: "Buscar juegos", value: q, placeholder: "Nombre del juego" });
        if (v != null) {
          setDetail(null);
          search(v);
        }
      },
    },
  });

  const header = (
    <div className="flex flex-1 items-center gap-3">
      <div className="flex h-9 w-[min(420px,40vw)] items-center gap-2 rounded-full bg-surface-3/70 px-3 ring-1 ring-line focus-within:ring-2 focus-within:ring-accent">
        <Search size={15} className="text-muted" />
        <input
          data-nav
          value={q}
          onChange={(e) => {
            setDetail(null);
            search(e.target.value);
          }}
          placeholder="Buscar juegos…"
          className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
        {searching && <Spinner size={14} />}
      </div>
      <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={() => openExplore("downloads")}>
        Descargas
      </Button>
    </div>
  );

  return (
    <Modal
      ref={ref}
      title={
        <span className="flex items-center gap-2">
          <Compass size={18} className="text-accent" /> Explorar
        </span>
      }
      headerExtra={header}
      onClose={onClose}
      width="min(1280px, 96vw)"
      height="min(860px, 92vh)"
      hints={[
        ["accept", "Abrir"],
        ["y", "Buscar"],
        ["back", detail ? "Volver" : "Cerrar"],
      ]}
    >
      <div className="relative h-full overflow-y-auto">
        {detail ? (
          <DetailView d={detail} onBack={() => setDetail(null)} onAction={() => action(detail)} />
        ) : page ? (
          <div className="p-5">
            <p className="mb-3 text-sm text-muted">
              {page.total ? `${page.total} resultados para «${page.query}»` : `Nada con «${page.query}»`}
            </p>
            <div className="flex flex-wrap gap-2">
              {page.items.map((r) => (
                <Card key={r.slug} r={r} onOpen={(x) => open(x.slug)} />
              ))}
            </div>
            {page.page < page.pages && (
              <div className="mt-4 flex justify-center">
                <Button onClick={() => search(q, page.page + 1)} disabled={searching}>
                  Ver más
                </Button>
              </div>
            )}
          </div>
        ) : homeError ? (
          <Empty icon={<Compass size={40} />} title="No se pudo cargar Explorar">
            <p>{homeError}</p>
            <Button className="mt-4" icon={<RefreshCw size={15} />} onClick={loadHome}>
              Reintentar
            </Button>
          </Empty>
        ) : !home ? (
          <div className="grid h-full place-items-center text-muted">
            <Spinner size={28} />
          </div>
        ) : (
          <div className="flex flex-col gap-6 py-5">
            {home.sections.map((s) => (
              <section key={s.id}>
                <h3 className="mb-2 px-5 text-base font-semibold">{s.title}</h3>
                <div className="flex gap-2 overflow-x-auto px-4 pb-2">
                  {s.items.map((r) => (
                    <Card key={`${s.id}-${r.slug}`} r={r} onOpen={(x) => open(x.slug)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {loadingSlug && (
          <div className="absolute inset-0 grid place-items-center bg-black/30">
            <Spinner size={28} />
          </div>
        )}
        {source === "gamepad" && !detail && !q && home && (
          <p className="pb-4 text-center text-xs text-muted">Pulsa Y para buscar con el teclado en pantalla.</p>
        )}
      </div>
      {dialog && (
        <DownloadDialog
          slug={dialog.slug}
          title={dialog.title}
          onClose={() => setDialog(null)}
          onStarted={() => {
            setDialog(null);
            void open(dialog.slug);
          }}
        />
      )}
    </Modal>
  );
}

function DetailView({ d, onBack, onAction }: { d: RepackDetails; onBack: () => void; onAction: () => void }) {
  const a = repackAction(d) as { id: string; label: string; hint?: string };
  const [shot, setShot] = useState<string | null>(null);
  const facts: [string, string | null | undefined][] = [
    ["Géneros", d.genres.join(", ")],
    ["Compañías", d.companies],
    ["Idiomas", d.languages],
    ["Tamaño original", sizeText(d.originalSize)],
    ["Descarga", sizeText(d.repackSize)],
    ["Instalado", sizeText(d.installSize)],
  ];
  return (
    <div>
      <div className="relative h-72 overflow-hidden">
        {d.hero && <img src={d.hero} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--h-surface)] via-[color-mix(in_srgb,var(--h-surface)_40%,transparent)] to-transparent" />
        <button data-nav onClick={onBack} className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-sm hover:bg-black/60 cursor-pointer">
          <ArrowLeft size={15} /> Volver
        </button>
        <div className="absolute bottom-4 left-5 right-5 flex items-end gap-5">
          <Cover src={d.coverFull || d.cover} title={d.title} className="aspect-[3/4] w-36 shrink-0 shadow-2xl" />
          <div className="min-w-0 flex-1 pb-1">
            <h2 className="text-2xl font-semibold leading-tight">{d.title}</h2>
            {d.version && <p className="mt-1 text-sm text-muted">{d.version}</p>}
            <div className="mt-3 flex items-center gap-3">
              <Button variant="primary" size="lg" data-autofocus icon={a.id === "play" ? <Play size={18} /> : <Download size={18} />} onClick={onAction}>
                {a.label}
              </Button>
              {d.url && (
                <Button variant="ghost" icon={<ExternalLink size={15} />} onClick={() => api.openExternal(d.url)}>
                  Ver en FitGirl
                </Button>
              )}
              {a.hint && <span className="text-xs text-muted">{a.hint}</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_300px] gap-6 p-5">
        <div className="min-w-0">
          {d.screenshots.length > 0 && (
            <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
              {d.screenshots.map((s) => (
                <button key={s.thumb} data-nav onClick={() => setShot(s.full)} className="shrink-0 overflow-hidden rounded-lg cursor-pointer">
                  <img src={s.thumb} alt="" loading="lazy" className="h-28 w-auto object-cover" />
                </button>
              ))}
            </div>
          )}
          {d.description && <p className="whitespace-pre-line text-sm leading-relaxed text-fg/90">{d.description}</p>}
        </div>
        <aside className="flex flex-col gap-4">
          <dl className="rounded-[var(--h-radius)] bg-surface-2/70 p-4 text-sm ring-1 ring-line">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="mb-2 last:mb-0">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {d.features.length > 0 && (
            <ul className="rounded-[var(--h-radius)] bg-surface-2/70 p-4 text-xs leading-relaxed text-muted ring-1 ring-line">
              {d.features.map((f) => (
                <li key={f} className="mb-1.5 last:mb-0">
                  • {f}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      {shot && (
        <button className={cx("fixed inset-0 z-[46] grid place-items-center bg-black/85 cursor-zoom-out")} onClick={() => setShot(null)}>
          <img src={shot} alt="" className="max-h-[90vh] max-w-[92vw] rounded-lg" />
        </button>
      )}
    </div>
  );
}
