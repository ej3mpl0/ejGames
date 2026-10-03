// Explorar (ventana del host, para temas sin tienda propia): portada con
// populares, novedades y géneros; el catálogo entero con filtros (géneros,
// orden, tamaño y los que ya tienes), fichas con «Más como este» y la lista
// de deseados (por perfil, solo en este PC).

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronsUpDown, Compass, Download, ExternalLink, Heart, Play, RefreshCw, Search, X } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { BrowseFilters, ExploreHome, ExplorePage, Genre, Repack, RepackDetails, WishItem } from "../../api/types";
import { Button, Empty, Modal, Spinner, cx } from "../../components/ui";
import { installDownload, openExplore, openKeyboard } from "../../host/downloads";
import { useOverlayNav } from "../../input/nav";
import { useApp } from "../../store/app";
import { DownloadDialog } from "./DownloadDialog";
import { SEASON_ORIGIN, useSeason } from "../../host/season";
import { Cover, HvTag, HypervisorPanel, StatusBadge, sizeText } from "./shared";
// @ts-ignore módulo JS del kit
import { repackAction, sortWishlist, SORTS as KIT_SORTS, SIZES as KIT_SIZES, GENRE_GROUPS as KIT_GROUPS, MAX_GENRES, WISH_SORTS } from "../../../sdk/kit/store.js";

const SORTS = KIT_SORTS as { id: NonNullable<BrowseFilters["sort"]>; label: string }[];
const SIZES = KIT_SIZES as { gb: number | null; label: string }[];
const GROUPS = KIT_GROUPS as { id: Genre["group"]; label: string }[];

type Filters = Required<Omit<BrowseFilters, "maxGb">> & { maxGb: number | null };
const EMPTY: Filters = { query: "", genres: [], sort: "date", maxGb: null, hideOwned: false };

/** Géneros de la portada. */
const FRONT_GENRES = [55, 47, 51, 59, 54, 66, 65, 56, 71, 70, 214, 84];

const wishSorts = WISH_SORTS as { id: string; label: string }[];

/** Añade o quita un juego de la lista de deseados, con su aviso. */
async function toggleWish(r: Repack) {
  const { wishlist, toast } = useApp.getState();
  const on = wishlist.some((w) => w.slug === r.slug);
  try {
    await (on ? api.wishlistRemove(r.slug) : api.wishlistAdd(r.slug));
    toast(on ? "info" : "ok", on ? `«${r.title}» ya no está en tu lista de deseados` : `«${r.title}» está en tu lista de deseados`);
  } catch (e) {
    toast("error", errMsg(e));
  }
}

function Card({ r, onOpen }: { r: Repack; onOpen: (r: Repack) => void }) {
  const wished = useApp((s) => s.wishlist.some((w) => w.slug === r.slug));
  return (
    <button data-nav onClick={() => onOpen(r)} className="group relative flex w-40 shrink-0 flex-col gap-1.5 rounded-[calc(var(--h-radius)*0.7)] p-1.5 text-left hover:bg-surface-3/50 cursor-pointer">
      <Cover src={r.cover} title={r.title} className="aspect-[3/4] w-full" />
      {wished && (
        <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-accent" title="En tu lista de deseados">
          <Heart size={14} fill="currentColor" />
        </span>
      )}
      <span className="line-clamp-2 text-[13px] leading-tight">
        {r.hypervisor && <HvTag className="mr-1 -mt-px" />}
        {r.title}
      </span>
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
        {r.repackSize && <span className="truncate">{sizeText(r.repackSize)}</span>}
        <StatusBadge r={r} />
      </span>
    </button>
  );
}

/** Selector compacto: clic o izquierda/derecha para pasar de una opción a otra. */
function Pick<T>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const step = (d: number) => onChange(options[(idx + d + options.length) % options.length].value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fn = (e: Event) => step((e as CustomEvent<number>).detail);
    el.addEventListener("cycle", fn);
    return () => el.removeEventListener("cycle", fn);
  });
  return (
    <button
      ref={ref}
      data-nav
      data-cycle
      onClick={() => step(1)}
      className="flex h-9 items-center gap-2 rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/70 px-3 text-sm ring-1 ring-line hover:bg-surface-3 cursor-pointer"
    >
      <span className="text-muted">{label}</span>
      <span className="font-medium">{options[idx]?.label}</span>
      <ChevronsUpDown size={14} className="text-muted" />
    </button>
  );
}

function Chip({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      data-nav
      onClick={onClick}
      className={cx(
        "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] ring-1 cursor-pointer",
        on ? "bg-accent text-accent-contrast ring-accent" : "bg-surface-3/50 text-fg/85 ring-line hover:bg-surface-3",
      )}
    >
      {children}
    </button>
  );
}

export function ExploreOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const source = useApp((s) => s.inputSource);
  const [home, setHome] = useState<ExploreHome | null>(null);
  // Evento de temporada (Halloween…): su banner y lo popular de su género arriba.
  const season = useSeason();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seasonItems = season && home ? [...new Map(home.sections.flatMap((s) => s.items).filter((r) => r.tags?.includes(season.genre)).map((r) => [r.slug, r])).values()] : [];
  const [homeError, setHomeError] = useState("");
  const [genres, setGenres] = useState<Genre[]>([]);
  // Catálogo: null = portada.
  const [filters, setFilters] = useState<Filters | null>(null);
  const [page, setPage] = useState<ExplorePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [allGenres, setAllGenres] = useState(false);
  const [detail, setDetail] = useState<RepackDetails | null>(null);
  const [similar, setSimilar] = useState<Repack[] | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RepackDetails | null>(null);
  // Lista de deseados: abierta y su orden.
  const wishlist = useApp((s) => s.wishlist);
  const [wishOpen, setWishOpen] = useState(args?.view === "wishlist");
  const [wishSort, setWishSort] = useState("added");
  const seq = useRef(0);
  const timer = useRef<number>(0);
  const scroller = useRef<HTMLDivElement>(null);

  const loadHome = () => {
    setHomeError("");
    api.exploreHome().then(setHome).catch((e) => setHomeError(errMsg(e)));
  };
  useEffect(() => {
    loadHome();
    api.exploreGenres().then(setGenres).catch(() => {});
    if (typeof args?.slug === "string") void open(args.slug);
  }, []);

  const genreName = (id: number) => genres.find((g) => g.id === id)?.name ?? "";

  /** Pide una página del catálogo (con espera si se está escribiendo). */
  function browse(f: Filters | null, pageNo = 1, delay = 0) {
    clearTimeout(timer.current);
    setFilters(f);
    if (!f) {
      seq.current++;
      setPage(null);
      setLoading(false);
      return;
    }
    if (pageNo === 1) {
      setPage(null);
      scroller.current?.scrollTo({ top: 0 });
    }
    setLoading(true);
    setError("");
    timer.current = window.setTimeout(async () => {
      const my = ++seq.current;
      try {
        const r = await api.exploreBrowse(f, pageNo);
        if (my !== seq.current) return;
        setPage((prev) => {
          if (pageNo === 1 || !prev) return r;
          const seen = new Set(prev.items.map((x) => x.slug));
          return { ...r, items: [...prev.items, ...r.items.filter((x) => !seen.has(x.slug))] };
        });
      } catch (e) {
        if (my === seq.current) setError(errMsg(e));
      }
      if (my === seq.current) setLoading(false);
    }, delay);
  }
  const change = (patch: Partial<Filters>, delay = 0) => browse({ ...(filters ?? EMPTY), ...patch }, 1, delay);
  const more = () => {
    if (filters && page && page.page < page.pages && !loading) browse(filters, page.page + 1);
  };
  function toggleGenre(id: number) {
    const g = filters?.genres ?? [];
    if (g.includes(id)) change({ genres: g.filter((x) => x !== id) });
    else if (g.length >= MAX_GENRES) toast("info", `Como mucho ${MAX_GENRES} géneros a la vez`);
    else change({ genres: [...g, id] });
  }

  async function open(slug: string) {
    setLoadingSlug(slug);
    setSimilar(null);
    try {
      const d = await api.exploreDetails(slug);
      setDetail(d);
      // «Más como este»: sus dos primeros géneros conocidos.
      const known = (d.tags ?? []).filter((t) => genres.some((g) => g.id === t && g.group === "genre")).slice(0, 2);
      if (known.length)
        api
          .exploreBrowse({ genres: known }, 1)
          .then((r) => setSimilar(r.items.filter((x) => x.slug !== d.slug).slice(0, 12)))
          .catch(() => setSimilar([]));
      else setSimilar([]);
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
    onBack: () => (dialog ? setDialog(null) : detail ? setDetail(null) : wishOpen ? setWishOpen(false) : filters ? browse(null) : onClose()),
    extra: {
      y: async () => {
        const v = await openKeyboard({ title: "Buscar juegos", value: filters?.query ?? "", placeholder: "Nombre del juego" });
        if (v != null) {
          setDetail(null);
          change({ query: v });
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
          value={filters?.query ?? ""}
          onChange={(e) => {
            setDetail(null);
            setWishOpen(false);
            change({ query: e.target.value }, 350);
          }}
          placeholder="Buscar juegos…"
          className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
        {loading && <Spinner size={14} />}
      </div>
      <Button size="sm" variant="ghost" icon={<Compass size={15} />} onClick={() => (setDetail(null), setWishOpen(false), change({}))}>
        Todo el catálogo
      </Button>
      <Button size="sm" variant={wishOpen && !detail ? "primary" : "ghost"} icon={<Heart size={15} />} onClick={() => (setDetail(null), setWishOpen(true))}>
        Lista de deseados{wishlist.length ? ` (${wishlist.length})` : ""}
      </Button>
      <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={() => openExplore("downloads")}>
        Descargas
      </Button>
    </div>
  );

  const f = filters;
  const shownGenres = (group: Genre["group"]) => {
    const list = genres.filter((g) => g.group === group);
    return allGenres ? list : list.filter((g, i) => i < 10 || f?.genres.includes(g.id));
  };

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
        ["back", detail || f ? "Volver" : "Cerrar"],
      ]}
    >
      <div
        ref={scroller}
        className="relative h-full overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (!detail && f && el.scrollTop + el.clientHeight > el.scrollHeight - 500) more();
        }}
      >
        {detail ? (
          <DetailView
            d={detail}
            genres={genres}
            similar={similar}
            onBack={() => setDetail(null)}
            onAction={() => action(detail)}
            wished={wishlist.some((w) => w.slug === detail.slug)}
            onWish={() => void toggleWish(detail)}
            onGenre={(id) => (setDetail(null), browse({ ...EMPTY, genres: [id] }))}
            onOpen={(slug) => open(slug)}
          />
        ) : wishOpen ? (
          <WishView items={sortWishlist(wishlist, wishSort) as WishItem[]} sort={wishSort} onSort={setWishSort} onOpen={(slug) => open(slug)} onBrowse={() => (setWishOpen(false), change({}))} />
        ) : f ? (
          <div className="p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Pick label="Orden" value={f.sort} options={SORTS.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => change({ sort: v })} />
              <Pick label="Tamaño" value={f.maxGb} options={SIZES.map((o) => ({ value: o.gb, label: o.label }))} onChange={(v) => change({ maxGb: v })} />
              <Chip on={f.hideOwned} onClick={() => change({ hideOwned: !f.hideOwned })}>
                Ocultar los que ya tengo
              </Chip>
              {(f.genres.length > 0 || f.maxGb || f.hideOwned || f.query) && (
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => browse({ ...EMPTY, sort: f.sort })}>
                  Quitar filtros
                </Button>
              )}
              <span className="ml-auto text-sm text-muted">
                {loading && !page
                  ? "Buscando…"
                  : page
                    ? `${page.filtered && page.page < page.pages ? "Unos " : ""}${page.total.toLocaleString("es")} juegos${f.query ? ` con «${f.query}»` : ""}`
                    : ""}
              </span>
            </div>
            {GROUPS.map(({ id, label }) => (
              <div key={id} className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="w-24 shrink-0 text-xs text-muted">{label}</span>
                {shownGenres(id).map((g) => (
                  <Chip key={g.id} on={f.genres.includes(g.id)} onClick={() => toggleGenre(g.id)}>
                    {g.name}
                  </Chip>
                ))}
                {id === "genre" && !allGenres && (
                  <Button size="sm" variant="ghost" onClick={() => setAllGenres(true)}>
                    Más géneros
                  </Button>
                )}
              </div>
            ))}
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            {page && !page.items.length && !loading && !error && <p className="mt-6 text-sm text-muted">No hay juegos que coincidan con estos filtros.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {page?.items.map((r) => (
                <Card key={r.slug} r={r} onOpen={(x) => open(x.slug)} />
              ))}
            </div>
            {loading && (
              <div className="grid place-items-center py-6">
                <Spinner size={24} />
              </div>
            )}
            {page && page.page < page.pages && !loading && (
              <div className="mt-4 flex justify-center">
                <Button onClick={more}>Ver más</Button>
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
            {genres.length > 0 && (
              <section className="px-5">
                <h3 className="mb-2 text-base font-semibold">Géneros</h3>
                <div className="flex flex-wrap gap-1.5">
                  {FRONT_GENRES.map((id) => (
                    <Chip key={id} onClick={() => browse({ ...EMPTY, genres: [id] })}>
                      {genreName(id)}
                    </Chip>
                  ))}
                  <Chip onClick={() => browse({ ...EMPTY })}>Todo el catálogo</Chip>
                </div>
              </section>
            )}
            {season && (
              <section>
                <video
                  className="mx-5 mb-3 block w-[calc(100%-2.5rem)] rounded-[calc(var(--h-radius)*0.7)] object-cover ring-1 ring-line"
                  style={{ aspectRatio: "2000 / 297" }}
                  src={season.video ? SEASON_ORIGIN + season.video : undefined}
                  poster={SEASON_ORIGIN + season.banner}
                  autoPlay={!reduceMotion}
                  muted
                  loop
                  playsInline
                />
                {seasonItems.length > 0 && (
                  <>
                    <h3 className="flex items-center justify-between px-5 text-base font-semibold">
                      {season.title}
                      <Chip onClick={() => browse({ ...EMPTY, genres: [season.genre] })}>Ver todo</Chip>
                    </h3>
                    <p className="mb-2 px-5 text-xs text-muted">{season.subtitle}</p>
                    <div className="flex gap-2 overflow-x-auto px-4 pb-2">
                      {seasonItems.map((r) => (
                        <Card key={`ev-${r.slug}`} r={r} onOpen={(x) => open(x.slug)} />
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
            {wishlist.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 px-5 text-base font-semibold">
                  <Heart size={15} className="text-accent" /> Tu lista de deseados
                </h3>
                <div className="flex gap-2 overflow-x-auto px-4 pb-2">
                  {wishlist.map((r) => (
                    <Card key={`wish-${r.slug}`} r={r} onOpen={(x) => open(x.slug)} />
                  ))}
                </div>
              </section>
            )}
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
        {source === "gamepad" && !detail && !f && home && <p className="pb-4 text-center text-xs text-muted">Pulsa Y para buscar con el teclado en pantalla.</p>}
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

function DetailView({
  d,
  genres,
  similar,
  onBack,
  onAction,
  onGenre,
  onOpen,
  wished,
  onWish,
}: {
  d: RepackDetails;
  genres: Genre[];
  similar: Repack[] | null;
  onBack: () => void;
  onAction: () => void;
  wished: boolean;
  onWish: () => void;
  onGenre: (id: number) => void;
  onOpen: (slug: string) => void;
}) {
  const a = repackAction(d) as { id: string; label: string; hint?: string };
  const [shot, setShot] = useState<string | null>(null);
  const known = (d.tags ?? []).map((t) => genres.find((g) => g.id === t)).filter((g): g is Genre => !!g);
  const facts: [string, string | null | undefined][] = [
    ["Géneros", known.length ? null : d.genres.join(", ")],
    ["Compañías", d.companies],
    ["Idiomas", d.languages],
    ["Tamaño original", sizeText(d.originalSize)],
    ["Descarga", sizeText(d.repackSize)],
    ["Instalado", sizeText(d.installSize)],
    ["Crack", d.hypervisor ? "Hipervisor (HV)" : null],
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
            <h2 className="text-2xl font-semibold leading-tight">
              {d.title}
              {d.hypervisor && <HvTag className="ml-2 -mt-1 px-2 text-[12px] leading-5" />}
            </h2>
            {d.version && <p className="mt-1 text-sm text-muted">{d.version}</p>}
            <div className="mt-3 flex items-center gap-3">
              <Button variant="primary" size="lg" data-autofocus icon={a.id === "play" ? <Play size={18} /> : <Download size={18} />} onClick={onAction}>
                {a.label}
              </Button>
              <Button variant={wished ? "primary" : "ghost"} icon={<Heart size={15} fill={wished ? "currentColor" : "none"} />} onClick={onWish}>
                {wished ? "En tu lista de deseados" : "Añadir a la lista de deseados"}
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
          {d.hypervisor && <HypervisorPanel />}
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
          {known.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {known.slice(0, 8).map((g) => (
                <Chip key={g.id} onClick={() => onGenre(g.id)}>
                  {g.name}
                </Chip>
              ))}
            </div>
          )}
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
      {similar && similar.length > 0 && (
        <section className="pb-6">
          <h3 className="mb-2 px-5 text-base font-semibold">Más como este</h3>
          <div className="flex gap-2 overflow-x-auto px-4 pb-2">
            {similar.map((r) => (
              <Card key={r.slug} r={r} onOpen={(x) => onOpen(x.slug)} />
            ))}
          </div>
        </section>
      )}
      {shot && (
        <button className={cx("fixed inset-0 z-[46] grid place-items-center bg-black/85 cursor-zoom-out")} onClick={() => setShot(null)}>
          <img src={shot} alt="" className="max-h-[90vh] max-w-[92vw] rounded-lg" />
        </button>
      )}
    </div>
  );
}

/** La lista de deseados: los juegos con su estado, en el orden elegido. */
function WishView({ items, sort, onSort, onOpen, onBrowse }: { items: WishItem[]; sort: string; onSort: (s: string) => void; onOpen: (slug: string) => void; onBrowse: () => void }) {
  if (!items.length)
    return (
      <Empty icon={<Heart size={40} />} title="Tu lista de deseados está vacía">
        <p>Añade juegos con «Añadir a la lista de deseados» en su ficha. Se guarda en este PC, solo para este perfil.</p>
        <Button className="mt-4" icon={<Compass size={15} />} onClick={onBrowse}>
          Explorar el catálogo
        </Button>
      </Empty>
    );
  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h3 className="mr-2 text-base font-semibold">Tu lista de deseados</h3>
        <span className="text-sm text-muted">
          {items.length} {items.length === 1 ? "juego" : "juegos"} · se guarda en este PC, solo para este perfil
        </span>
        <span className="ml-auto" />
        {wishSorts.map((o) => (
          <Chip key={o.id} on={sort === o.id} onClick={() => onSort(o.id)}>
            {o.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((r) => (
          <div key={r.slug} className="flex flex-col">
            <Card r={r} onOpen={(x) => onOpen(x.slug)} />
            <button data-nav onClick={() => void toggleWish(r)} className="mx-1.5 rounded-md py-1 text-xs text-muted hover:bg-surface-3/60 hover:text-fg cursor-pointer">
              Quitar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
