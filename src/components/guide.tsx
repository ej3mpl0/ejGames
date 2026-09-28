// Guías de Steam en React: lista con filtros, estantería (guardadas y «seguir
// leyendo») y lector con progreso. Las usan la ventana de reserva del host y
// los paneles del overlay; cada sitio las viste con sus variables CSS
// (--gd-fg, --gd-muted, --gd-accent, --gd-surface, --gd-line, --gd-radius, --gd-font).
//
// Con mando, el lector se lleva la navegación: arriba/abajo desplaza, LB/RB
// cambia de sección, Y guarda, X abre en Steam y Atrás vuelve a la lista.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errMsg } from "../api/tauri";
import type { Guide, GuideBlock, GuideItem, GuideShelf, GuideShelfItem, GuideSpan, NavAction } from "../api/types";
import { getGuide, openGuideInBrowser, openGuideLink } from "../host/guides";
import { openKeyboard } from "../host/downloads";
import { playSound } from "../host/sounds";
import { isTopNav, pushNav, type NavSource } from "../input/nav";
import { useApp } from "../store/app";
import { GUIDE_CATEGORIES, GUIDE_SORTS, langLabel, langTag, starsText } from "../../sdk/kit/guides.js";
import "./guide.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ─────────── texto y bloques ───────────

interface LinkOpts {
  onLink: (href: string) => void;
  onGuide: (id: string) => void;
  onImage?: (src: string) => void;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={cx("gd-spoiler", open && "is-open")} title="Spoiler: púlsalo para verlo" onClick={() => setOpen(true)}>
      {children}
    </span>
  );
}

export function GuideSpans({ spans, o }: { spans: GuideSpan[]; o: LinkOpts }) {
  return (
    <>
      {spans.map((s, i) => {
        const lines = s.text.split("\n");
        let node: ReactNode = lines.map((l, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {l}
          </span>
        ));
        if (s.href || s.guide) {
          node = (
            <button
              className={cx("gd-link", s.guide && "is-guide")}
              title={s.href || "Abrir esta guía"}
              onClick={(e) => {
                e.stopPropagation();
                if (s.guide) o.onGuide(s.guide);
                else if (s.href) o.onLink(s.href);
              }}
            >
              {node}
            </button>
          );
        }
        if (s.b) node = <b>{node}</b>;
        if (s.i) node = <i>{node}</i>;
        if (s.u) node = <u>{node}</u>;
        if (s.s) node = <s>{node}</s>;
        if (s.spoiler) node = <Spoiler>{node}</Spoiler>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

export function GuideBlocks({ blocks, o }: { blocks: GuideBlock[]; o: LinkOpts }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": {
            const Tag = (["h3", "h4", "h5"] as const)[b.level - 1] ?? "h5";
            return (
              <Tag key={i} className={cx("gd-h", `gd-h${b.level}`)}>
                <GuideSpans spans={b.spans} o={o} />
              </Tag>
            );
          }
          case "p":
            return (
              <p key={i} className="gd-p">
                <GuideSpans spans={b.spans} o={o} />
              </p>
            );
          case "quote":
            return (
              <blockquote key={i} className="gd-quote">
                <GuideSpans spans={b.spans} o={o} />
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} className="gd-code">
                {b.text}
              </pre>
            );
          case "hr":
            return <hr key={i} className="gd-hr" />;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className="gd-list">
                {b.items.map((it, j) => (
                  <li key={j} style={it.depth ? { marginLeft: `${it.depth * 1.4}em` } : undefined}>
                    <GuideSpans spans={it.spans} o={o} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} className="gd-table-wrap">
                <table className="gd-table">
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) =>
                          b.head && r === 0 ? (
                            <th key={c}>
                              <GuideSpans spans={cell} o={o} />
                            </th>
                          ) : (
                            <td key={c}>
                              <GuideSpans spans={cell} o={o} />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "img":
            return (
              <button key={i} className={cx("gd-img", b.thumb && "is-thumb")} onClick={() => o.onImage?.(b.src)}>
                <img src={b.src} alt="" loading="lazy" draggable={false} />
              </button>
            );
          case "video":
            return (
              <button key={i} className="gd-video" onClick={() => o.onLink(b.url)}>
                {b.thumb && <img src={b.thumb} alt="" loading="lazy" draggable={false} />}
                <span className="gd-video-play">▶</span>
                <span className="gd-video-label">Ver el vídeo en YouTube</span>
              </button>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

// ─────────── lista ───────────

interface ListState {
  appid?: number | null;
  items: GuideItem[];
  loading: boolean;
  error: string | null;
  total: number;
  next: number | null;
  filtered: boolean;
  sort: string;
  category: string;
  query: string;
  allLanguages: boolean;
}

const INITIAL: ListState = {
  appid: undefined,
  items: [],
  loading: true,
  error: null,
  total: 0,
  next: null,
  filtered: true,
  sort: "toprated",
  category: "",
  query: "",
  allLanguages: false,
};

export function useGuideList(gameId: number) {
  const [s, setS] = useState<ListState>(INITIAL);
  const [shelf, setShelf] = useState<GuideShelf>({ pinned: [], recent: [] });
  const seq = useRef(0);
  const cur = useRef(s);
  cur.current = s;

  const load = useCallback(
    async (patch: Partial<ListState> = {}, page = 1) => {
      const my = ++seq.current;
      const base = { ...cur.current, ...patch };
      setS({ ...base, loading: true, error: null, items: page === 1 ? [] : base.items });
      try {
        const r = await api.guidesList(gameId, {
          page,
          sort: base.sort as "toprated",
          category: base.category,
          query: base.query,
          allLanguages: base.allLanguages,
        });
        if (my !== seq.current) return;
        setS((x) => {
          const seen = new Set(page === 1 ? [] : x.items.map((i) => i.id));
          return {
            ...x,
            appid: r.appid ?? null,
            items: [...(page === 1 ? [] : x.items), ...r.items.filter((i) => !seen.has(i.id))],
            total: r.total,
            next: r.next ?? null,
            filtered: r.filtered,
            loading: false,
          };
        });
      } catch (e) {
        if (my !== seq.current) return;
        setS((x) => ({ ...x, loading: false, error: errMsg(e) }));
      }
    },
    [gameId],
  );

  const refreshShelf = useCallback(() => api.guidesShelf(gameId).then(setShelf).catch(() => {}), [gameId]);

  useEffect(() => {
    void load();
    void refreshShelf();
  }, [load, refreshShelf]);

  const cycle = <T extends { value: string }>(list: T[], value: string, d: number) => list[(list.findIndex((x) => x.value === value) + d + list.length) % list.length].value;

  return {
    s,
    shelf,
    refreshShelf,
    more: () => s.next && !s.loading && load({}, s.next),
    cycleSort: (d = 1) => load({ sort: cycle(GUIDE_SORTS, s.sort, d) }),
    cycleCategory: (d = 1) => load({ category: cycle(GUIDE_CATEGORIES, s.category, d) }),
    setQuery: (q: string) => load({ query: q.trim() }),
    toggleLanguages: () => load({ allLanguages: !s.allLanguages }),
    reload: () => load(),
  };
}

export function emptyText(s: ListState) {
  if (s.loading) return "";
  if (s.error) return s.error;
  if (s.appid === null) return "Este juego no está identificado en Steam, así que no hay guías que buscar. Búscalo en Editar → Coincidencia.";
  if (!s.items.length) {
    if (s.query) return `No hay guías que hablen de «${s.query}».`;
    if (s.filtered && s.total) return "No hay guías en español ni en inglés con estos filtros. Prueba con todos los idiomas.";
    return "Aún no hay guías de la comunidad para este juego.";
  }
  return "";
}

function Stars({ n }: { n?: number | null }) {
  if (n == null) return <span className="gd-stars is-none">Sin valorar</span>;
  return <span className="gd-stars">{starsText(n)}</span>;
}

function ShelfRow({ it, onOpen }: { it: GuideShelfItem; onOpen: (id: string) => void }) {
  return (
    <button data-nav className="gd-row is-shelf" onClick={() => onOpen(it.id)}>
      {it.preview ? <img className="gd-thumb" src={it.preview} alt="" draggable={false} /> : <span className="gd-thumb ph">📖</span>}
      <span className="gd-row-main">
        <span className="gd-row-title">{it.title}</span>
        <span className="gd-row-sub">
          {it.pinned ? "Guardada" : "Leída"}
          {it.author ? ` · ${it.author}` : ""}
          {it.progress && (it.progress.section > 0 || it.progress.scroll > 0.02) ? ` · sección ${it.progress.section + 1}` : ""}
        </span>
      </span>
    </button>
  );
}

export function GuideListView({ gameId, onOpen, list }: { gameId: number; onOpen: (id: string) => void; list: ReturnType<typeof useGuideList> }) {
  const { s, shelf } = list;
  const pad = useApp((st) => st.inputSource) === "gamepad";
  const sortLabel = GUIDE_SORTS.find((x: { value: string }) => x.value === s.sort)?.label;
  const catLabel = GUIDE_CATEGORIES.find((x: { value: string }) => x.value === s.category)?.label;
  const [draft, setDraft] = useState(s.query);
  useEffect(() => setDraft(s.query), [s.query]);
  const search = async () => {
    if (pad) {
      const q = await openKeyboard({ title: "Buscar guías", value: s.query, placeholder: "Por ejemplo: logros, jefe, final", maxLength: 80 });
      if (q !== null) void list.setQuery(q);
    }
  };
  const empty = emptyText(s);
  return (
    <div className="gd-listview" data-game={gameId}>
      <div className="gd-filters">
        <label className="gd-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <input
            data-nav
            value={draft}
            placeholder="Buscar en las guías"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void list.setQuery(draft)}
            onFocus={() => void search()}
          />
        </label>
        <button data-nav data-cycle className="gd-chip" onClick={() => void list.cycleSort(1)} {...cycleProps(list.cycleSort)}>
          {sortLabel}
        </button>
        <button data-nav data-cycle className="gd-chip" onClick={() => void list.cycleCategory(1)} {...cycleProps(list.cycleCategory)}>
          {catLabel === "Todas" ? "Todas las categorías" : catLabel}
        </button>
        <button data-nav className={cx("gd-chip", s.allLanguages && "is-on")} onClick={() => void list.toggleLanguages()}>
          {s.allLanguages ? "Todos los idiomas" : "Español e inglés"}
        </button>
      </div>

      {(shelf.pinned.length > 0 || shelf.recent.length > 0) && !s.query && (
        <div className="gd-shelf">
          {shelf.pinned.length > 0 && <div className="gd-sub">Guardadas</div>}
          {shelf.pinned.map((it) => (
            <ShelfRow key={it.id} it={it} onOpen={onOpen} />
          ))}
          {shelf.recent.length > 0 && <div className="gd-sub">Seguir leyendo</div>}
          {shelf.recent.map((it) => (
            <ShelfRow key={it.id} it={it} onOpen={onOpen} />
          ))}
          <div className="gd-sub">De la comunidad{s.total ? ` · ${s.total.toLocaleString("es")} guías` : ""}</div>
        </div>
      )}

      <div className="gd-rows">
        {s.items.map((it) => (
          <button key={it.id} data-nav className="gd-row" onClick={() => onOpen(it.id)}>
            {it.preview ? <img className="gd-thumb" src={it.preview} alt="" loading="lazy" draggable={false} /> : <span className="gd-thumb ph">📖</span>}
            <span className="gd-row-main">
              <span className="gd-row-title">
                {it.title}
                {langTag(it.lang) && it.lang !== "es" && (
                  <span className="gd-lang" title={langLabel(it.lang)}>
                    {langTag(it.lang)}
                  </span>
                )}
              </span>
              {it.desc && <span className="gd-row-desc">{it.desc}</span>}
              <span className="gd-row-sub">
                <Stars n={it.stars} />
                {it.author && <span> · {it.author}</span>}
              </span>
            </span>
          </button>
        ))}
        {s.loading && <div className="gd-loading">Cargando guías…</div>}
        {!s.loading && empty && <div className="gd-empty">{empty}</div>}
        {!s.loading && s.next && (
          <button data-nav className="gd-more" onClick={() => void list.more()}>
            Cargar más guías
          </button>
        )}
      </div>
    </div>
  );
}

/** Con mando, izquierda/derecha sobre un chip cambian su valor (data-cycle). */
function cycleProps(fn: (d: number) => unknown) {
  return {
    ref: (el: HTMLButtonElement | null) => {
      if (!el || (el as unknown as { __cy?: boolean }).__cy) return;
      (el as unknown as { __cy?: boolean }).__cy = true;
      el.addEventListener("cycle", (e) => void fn((e as CustomEvent<number>).detail));
    },
  };
}

// ─────────── lector ───────────

export function GuideReader({
  gameId,
  id,
  onClose,
  onGuide,
  onPinned,
  onMenu,
}: {
  gameId: number;
  id: string;
  onClose: () => void;
  /** Enlace a otra guía. */
  onGuide: (id: string) => void;
  /** Cambió «guardada» (para refrescar la estantería). */
  onPinned?: () => void;
  onMenu?: () => void;
}) {
  const [g, setG] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState(0);
  const [toc, setToc] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const saveTimer = useRef(0);
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    let alive = true;
    setG(null);
    setError(null);
    getGuide(id).then(
      (x) => {
        if (!alive) return;
        setG(x);
        setPinned(x.pinned);
      },
      (e) => alive && setError(errMsg(e)),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  const sections = () => Array.from(scroller.current?.querySelectorAll<HTMLElement>("[data-section]") ?? []);
  const where = useCallback(() => {
    const box = scroller.current;
    const list = sections();
    if (!box || !list.length) return { idx: 0, frac: 0 };
    const top = box.getBoundingClientRect().top + 8;
    let idx = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].getBoundingClientRect().top <= top) idx = i;
      else break;
    }
    const r = list[idx].getBoundingClientRect();
    return { idx, frac: r.height > 0 ? Math.min(1, Math.max(0, (top - r.top) / r.height)) : 0 };
  }, []);

  const save = useCallback(() => {
    if (!g) return;
    const { idx, frac } = where();
    void api.guidesProgress(gameId, g.id, g.title, g.authors[0] ?? "", g.preview ?? null, idx, frac).catch(() => {});
  }, [g, gameId, where]);

  // Volver a donde se dejó.
  useEffect(() => {
    if (!g) return;
    const p = g.progress;
    requestAnimationFrame(() => {
      const list = sections();
      const box = scroller.current;
      if (!box) return;
      if (p && list[p.section]) {
        const s = list[p.section];
        box.scrollTop = Math.max(0, s.offsetTop - box.offsetTop + s.offsetHeight * p.scroll - 8);
      }
      setSection(where().idx);
    });
    return () => {
      window.clearTimeout(saveTimer.current);
      save();
    };
  }, [g]);

  const onScroll = () => {
    setSection(where().idx);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(save, 900);
  };

  const goto = (idx: number) => {
    const list = sections();
    const box = scroller.current;
    const s = list[Math.max(0, Math.min(list.length - 1, idx))];
    if (!s || !box) return;
    box.scrollTo({ top: Math.max(0, s.offsetTop - box.offsetTop - 8), behavior: "smooth" });
    setToc(false);
  };

  const togglePin = async () => {
    if (!g) return;
    try {
      await api.guidesPin(gameId, g.id, g.title, g.authors[0] ?? "", g.preview ?? null, !pinned);
      setPinned(!pinned);
      playSound("select");
      onPinned?.();
    } catch (e) {
      toast("error", errMsg(e));
    }
  };

  const o = useMemo<LinkOpts>(
    () => ({
      onLink: (href) => void openGuideLink(href).catch((e) => toast("error", errMsg(e))),
      onGuide,
      onImage: (src) => setZoom(src),
    }),
    [onGuide, toast],
  );

  // Mando y teclado mientras se lee.
  const act = useRef<(a: NavAction) => void>(() => {});
  act.current = (a: NavAction) => {
    const box = scroller.current;
    if (zoom) {
      if (a === "back" || a === "accept") setZoom(null);
      return;
    }
    if (toc) {
      if (a === "back") setToc(false);
      else if (a === "up") setSection((x) => Math.max(0, x - 1));
      else if (a === "down") setSection((x) => Math.min((g?.sections.length ?? 1) - 1, x + 1));
      else if (a === "accept") goto(section);
      return;
    }
    switch (a) {
      case "up":
      case "down":
        box?.scrollBy({ top: (a === "down" ? 1 : -1) * 140, behavior: "smooth" });
        break;
      case "rt":
      case "lt":
        box?.scrollBy({ top: (a === "rt" ? 1 : -1) * box.clientHeight * 0.85, behavior: "smooth" });
        break;
      case "lb":
      case "rb":
        goto(where().idx + (a === "rb" ? 1 : -1));
        playSound("move");
        break;
      case "y":
        void togglePin();
        break;
      case "x":
        void openGuideInBrowser(id);
        break;
      case "accept":
      case "view":
        if (g?.sections.length) setToc(true);
        break;
      case "menu":
        onMenu?.();
        break;
      case "back":
        playSound("back");
        onClose();
        break;
    }
  };
  useEffect(() => {
    const handler = (a: NavAction, _r: boolean, _s: NavSource) => act.current(a);
    const pop = pushNav(handler);
    const onKey = (e: KeyboardEvent) => {
      if (!isTopNav(handler)) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const map: Record<string, NavAction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        PageUp: "lt",
        PageDown: "rt",
        Escape: "back",
        Backspace: "back",
        Enter: "accept",
        "[": "lb",
        "]": "rb",
      };
      const a = map[e.key];
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      act.current(a);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      pop();
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  if (error)
    return (
      <div className="gd-reader">
        <div className="gd-empty">
          {error}
          <div className="gd-actions">
            <button className="gd-btn" onClick={onClose}>
              Volver
            </button>
            <button className="gd-btn" onClick={() => void openGuideInBrowser(id)}>
              Abrir en Steam
            </button>
          </div>
        </div>
      </div>
    );
  if (!g)
    return (
      <div className="gd-reader">
        <div className="gd-loading">Abriendo la guía…</div>
      </div>
    );
  return (
    <div className="gd-reader">
      <header className="gd-head">
        <button className="gd-btn is-icon" title="Volver" onClick={onClose}>
          ‹
        </button>
        <div className="gd-head-main">
          <div className="gd-title">{g.title}</div>
          <div className="gd-meta">
            <Stars n={g.stars} />
            {g.ratings ? ` · ${g.ratings.toLocaleString("es")} valoraciones` : ""}
            {g.authors.length ? ` · ${g.authors.join(", ")}` : ""}
            {g.updated || g.published ? ` · ${g.updated ? "act. " + g.updated : g.published}` : ""}
          </div>
        </div>
        {g.sections.length > 1 && (
          <button className="gd-btn" onClick={() => setToc((v) => !v)} title="Índice">
            {section + 1} / {g.sections.length}
          </button>
        )}
        <button className={cx("gd-btn", pinned && "is-on")} onClick={() => void togglePin()} title="Guárdala: sale primero y se lee sin conexión">
          {pinned ? "★ Guardada" : "☆ Guardar"}
        </button>
        <button className="gd-btn" onClick={() => void openGuideInBrowser(g.id)} title="Abrir en la web de Steam">
          Steam ↗
        </button>
      </header>
      <div className="gd-body" ref={scroller} onScroll={onScroll}>
        {g.intro.length > 0 && (
          <div className="gd-intro">
            <GuideBlocks blocks={g.intro} o={o} />
          </div>
        )}
        {g.sections.map((s, i) => (
          <section key={s.id || i} data-section={i} className="gd-section">
            {s.title && <h2 className="gd-section-title">{s.title}</h2>}
            <GuideBlocks blocks={s.blocks} o={o} />
          </section>
        ))}
        <div className="gd-end">Fin de la guía · De la comunidad de Steam</div>
      </div>
      {toc && (
        <div className="gd-toc" onMouseDown={(e) => e.target === e.currentTarget && setToc(false)}>
          <div className="gd-toc-box">
            <div className="gd-sub">Índice</div>
            {g.sections.map((s, i) => (
              <button
                key={i}
                className={cx("gd-toc-item", i === section && "is-on")}
                ref={(el) => {
                  if (el && i === section) el.scrollIntoView({ block: "nearest" });
                }}
                onClick={() => goto(i)}
              >
                <span>{i + 1}</span>
                {s.title || `Sección ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}
      {zoom && (
        <div className="gd-zoom" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" draggable={false} />
        </div>
      )}
    </div>
  );
}

// ─────────── lista + lector ───────────

/** Guías de un juego: la lista y, al elegir una, el lector (con historial para los enlaces entre guías). */
export function GuidesPane({ gameId, initial, onMenu, onReading }: { gameId: number; initial?: string | null; onMenu?: () => void; onReading?: (reading: boolean) => void }) {
  const list = useGuideList(gameId);
  const [stack, setStack] = useState<string[]>(initial ? [initial] : []);
  const open = (id: string) => setStack((s) => [...s, id]);
  const close = () => {
    setStack((s) => s.slice(0, -1));
    void list.refreshShelf();
  };
  useEffect(() => onReading?.(stack.length > 0), [stack.length]);
  const id = stack[stack.length - 1];
  return (
    <div className="gd-pane">
      <div hidden={!!id} className="gd-pane-list">
        <GuideListView gameId={gameId} list={list} onOpen={open} />
      </div>
      {id && <GuideReader key={id} gameId={gameId} id={id} onClose={close} onGuide={open} onPinned={() => void list.refreshShelf()} onMenu={onMenu} />}
    </div>
  );
}
