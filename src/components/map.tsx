// Mapas interactivos de Map Genie (mapgenie.io), con sus puntos de interés.
// En la ventana del host el mapa es un iframe normal. En el overlay hay un solo
// iframe (MapHost, en la raíz): la pestaña Mapa solo reserva el hueco y el
// iframe se coloca encima; al anclarlo pasa a una esquina, semitransparente y
// sin coger clics. Así no se recarga al cambiar de pestaña ni al anclarlo.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { create } from "zustand";
import { api, errMsg } from "../api/tauri";
import type { GameMaps, MapGame, OverlayPin } from "../api/types";
import { openKeyboard } from "../host/downloads";
import { useApp } from "../store/app";
import "./guide.css";
import "./tools.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** `embed`: el modo para incrustar de Map Genie (solo el mapa, sin barras). */
export const mapUrl = (game: string, map: string, embed = false) => `https://mapgenie.io/${game}/maps/${map}${embed ? "?embed=light" : ""}`;

/** El iframe: Map Genie sin poder navegar la ventana de ejGames ni abrir otras. */
const FRAME = { sandbox: "allow-scripts allow-same-origin allow-forms", referrerPolicy: "no-referrer" as const };

// ─────────── mapa anclado (overlay) ───────────

export interface PinPrefs {
  size: "s" | "m" | "l";
  /** 0.4 .. 0.9 */
  opacity: number;
  corner: "tl" | "tr" | "bl" | "br";
}

const PREFS_KEY = "ejg.mapPin";
const DEFAULT_PREFS: PinPrefs = { size: "m", opacity: 0.8, corner: "tr" };

function loadPrefs(): PinPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (v && typeof v === "object") return { ...DEFAULT_PREFS, ...v };
  } catch {
    /* sin almacenamiento */
  }
  return DEFAULT_PREFS;
}

interface MapHostState {
  /** Mapa elegido en la pestaña del panel. */
  url: string | null;
  /** Hueco de la pestaña (null: otra pestaña o panel cerrado). */
  slot: DOMRect | null;
  pin: OverlayPin | null;
  prefs: PinPrefs;
}

export const useMapHost = create<MapHostState>(() => ({ url: null, slot: null, pin: null, prefs: loadPrefs() }));

export function setPinPrefs(p: Partial<PinPrefs>) {
  const prefs = { ...useMapHost.getState().prefs, ...p };
  prefs.opacity = Math.min(0.9, Math.max(0.4, Math.round(prefs.opacity * 10) / 10));
  useMapHost.setState({ prefs });
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* sin almacenamiento */
  }
}

/** Hueco del mapa dentro de la pestaña: MapHost pone el iframe encima. */
function MapSlot({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    useMapHost.setState({ url });
  }, [url]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const prev = useMapHost.getState().slot;
      if (!prev || prev.left !== r.left || prev.top !== r.top || prev.width !== r.width || prev.height !== r.height) useMapHost.setState({ slot: r });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    // Durante la animación de entrada del panel el hueco se mueve.
    let n = 0;
    let raf = 0;
    const tick = () => {
      update();
      if (++n < 40) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      cancelAnimationFrame(raf);
      useMapHost.setState({ slot: null });
    };
  }, []);
  return <div ref={ref} className="mp-slot" />;
}

const PIN_WIDTH = { s: 0.24, m: 0.32, l: 0.42 };

/** El iframe del overlay (en la raíz, fuera del panel). */
export function MapHost({ panelOpen }: { panelOpen: boolean }) {
  const { url, slot, pin, prefs } = useMapHost();
  const src = pin?.url ?? url;
  if (!src || (!panelOpen && !pin)) return null;
  let style: CSSProperties;
  if (panelOpen) {
    style = slot
      ? { left: slot.left, top: slot.top, width: slot.width, height: slot.height }
      : { left: 0, top: 0, width: 320, height: 240, visibility: "hidden" };
  } else {
    const w = Math.round(window.innerWidth * PIN_WIDTH[prefs.size]);
    const h = Math.round(w * 0.7);
    const m = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.03);
    style = {
      width: w,
      height: h,
      opacity: prefs.opacity,
      left: prefs.corner.endsWith("l") ? m : window.innerWidth - w - m,
      top: prefs.corner.startsWith("t") ? m : window.innerHeight - h - m,
    };
  }
  return <iframe className={cx("mp-frame", !panelOpen && "is-pinned")} src={src} style={style} title="Mapa" {...FRAME} />;
}

// ─────────── elegir el juego de Map Genie ───────────

function Chooser({ gameId, gameTitle, maps, onChosen, onCancel }: { gameId: number; gameTitle: string; maps: GameMaps; onChosen: (m: GameMaps) => void; onCancel?: () => void }) {
  const [query, setQuery] = useState(gameTitle);
  const [results, setResults] = useState<MapGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pad = useApp((s) => s.inputSource) === "gamepad";

  const search = (q: string) => {
    setError(null);
    setResults(null);
    api
      .mapsSearch(q)
      .then(setResults)
      .catch((e) => setError(errMsg(e)));
  };
  useEffect(() => search(gameTitle), [gameTitle]);

  const choose = (slug: string | null) =>
    api
      .mapsChoose(gameId, slug)
      .then(onChosen)
      .catch((e) => setError(errMsg(e)));

  const type = async () => {
    const q = await openKeyboard({ title: "Buscar en Map Genie", value: query, maxLength: 80 });
    if (q && q.trim()) {
      setQuery(q.trim());
      search(q.trim());
    }
  };

  return (
    <div className="mp-chooser">
      <div className="tt-head">
        <div className="tt-title">
          <b>{maps.none ? "Sin mapa" : maps.game ? "Cambiar de juego" : "Mapa del juego"}</b>
          <small>
            {maps.none
              ? `Dijiste que «${gameTitle}» no tiene mapa.`
              : maps.game
                ? `Ahora: ${maps.game.name}`
                : `No hemos encontrado «${gameTitle}» en Map Genie. Búscalo por su nombre en inglés.`}
          </small>
        </div>
        {onCancel && (
          <button data-nav className="gd-chip" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
      <div className="gd-filters">
        {pad ? (
          <button data-nav className="gd-search" onClick={() => void type()}>
            <span>{query}</span>
          </button>
        ) : (
          <label className="gd-search">
            <input
              data-nav
              defaultValue={query}
              placeholder="Juego en Map Genie"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const q = (e.target as HTMLInputElement).value.trim();
                  if (q) {
                    setQuery(q);
                    search(q);
                  }
                }
              }}
            />
          </label>
        )}
      </div>
      {error && <div className="tt-error">{error}</div>}
      {!results && !error && <div className="gd-loading">Buscando…</div>}
      {results && results.length === 0 && <div className="gd-empty">Map Genie no tiene «{query}». Tiene unos 250 juegos, casi todos de mundo abierto.</div>}
      {results && results.length > 0 && (
        <div className="gd-rows">
          {results.map((g, i) => (
            <button key={g.slug} data-nav data-autofocus={i === 0 ? "" : undefined} className="gd-row" onClick={() => void choose(g.slug)}>
              <div className="gd-row-main">
                <div className="gd-row-title">{g.name}</div>
                <div className="gd-row-sub">{g.maps.map((m) => m.name).join(" · ")}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="tt-actions is-foot">
        {!maps.none && (
          <button data-nav className="gd-chip" onClick={() => void choose("")}>
            Este juego no tiene mapa
          </button>
        )}
        {maps.manual && (
          <button data-nav className="gd-chip" onClick={() => void choose(null)}>
            Que lo busque ejGames
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────── pestaña / ventana ───────────

export function MapPane({ gameId, gameTitle, inGame = false }: { gameId: number; gameTitle: string; inGame?: boolean }) {
  const [maps, setMaps] = useState<GameMaps | null | undefined>(undefined);
  const [map, setMap] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pin = useMapHost((s) => s.pin);
  const prefs = useMapHost((s) => s.prefs);
  const pad = useApp((s) => s.inputSource) === "gamepad";

  const apply = (m: GameMaps) => {
    setMaps(m);
    const first = m.game?.maps[0]?.slug ?? null;
    const pinned = pin && pin.gameId === gameId && m.game ? m.game.maps.find((x) => pin.url === mapUrl(m.game!.slug, x.slug, true))?.slug : null;
    setMap(pinned ?? m.lastMap ?? first);
  };
  useEffect(() => {
    setError(null);
    api
      .mapsFor(gameId)
      .then(apply)
      .catch((e) => (setMaps(null), setError(errMsg(e))));
  }, [gameId]);

  if (maps === undefined) return <div className="gd-pane tt-pane"><div className="gd-loading">Cargando mapas…</div></div>;
  if (maps === null)
    return (
      <div className="gd-pane tt-pane">
        <div className="tt-error">{error}</div>
      </div>
    );

  if (!maps.game || choosing) {
    return (
      <div className="gd-pane tt-pane">
        <div className="gd-pane-list">
          <Chooser
            gameId={gameId}
            gameTitle={gameTitle}
            maps={maps}
            onCancel={maps.game ? () => setChoosing(false) : undefined}
            onChosen={(m) => {
              setChoosing(false);
              apply(m);
            }}
          />
        </div>
      </div>
    );
  }

  const game = maps.game;
  // En el overlay, solo el mapa (cabe mejor y se ve bien anclado en una esquina).
  const url = map ? mapUrl(game.slug, map, inGame) : null;
  const pinned = !!pin && pin.gameId === gameId;
  const pick = (slug: string) => {
    setMap(slug);
    void api.mapsLast(gameId, slug).catch(() => {});
    if (pinned) void api.overlayPin(mapUrl(game.slug, slug, true)).catch((e) => setError(errMsg(e)));
  };

  return (
    <div className="gd-pane tt-pane mp-pane">
      <div className="mp-bar">
        <div className="tt-chips">
          {game.maps.map((m) => (
            <button key={m.slug} data-nav className={cx("gd-chip", map === m.slug && "is-on")} onClick={() => pick(m.slug)}>
              {m.name}
            </button>
          ))}
        </div>
        <div className="tt-chips">
          {inGame && url && (
            <button
              data-nav
              className={cx("gd-chip", pinned ? "is-on" : "is-primary")}
              onClick={() => void api.overlayPin(pinned ? null : url).catch((e) => setError(errMsg(e)))}
            >
              {pinned ? "Desanclar" : "Anclar encima del juego"}
            </button>
          )}
          <button data-nav className="gd-chip" onClick={() => setChoosing(true)}>
            Cambiar de juego
          </button>
          {map && (
            <button data-nav className="gd-chip" onClick={() => void api.openExternal(mapUrl(game.slug, map)).catch(() => {})}>
              Abrir en el navegador
            </button>
          )}
        </div>
      </div>
      {inGame && (
        <div className="mp-pinbar">
          <span>Anclado:</span>
          {(["s", "m", "l"] as const).map((s) => (
            <button key={s} data-nav className={cx("gd-chip", prefs.size === s && "is-on")} onClick={() => setPinPrefs({ size: s })}>
              {{ s: "Pequeño", m: "Mediano", l: "Grande" }[s]}
            </button>
          ))}
          <button data-nav className="gd-chip" onClick={() => setPinPrefs({ opacity: prefs.opacity - 0.1 })}>
            −
          </button>
          <span className="mp-op">{Math.round(prefs.opacity * 100)} %</span>
          <button data-nav className="gd-chip" onClick={() => setPinPrefs({ opacity: prefs.opacity + 0.1 })}>
            +
          </button>
          <button
            data-nav
            className="gd-chip"
            onClick={() => setPinPrefs({ corner: ({ tr: "br", br: "bl", bl: "tl", tl: "tr" } as const)[prefs.corner] })}
          >
            Esquina: {{ tl: "arriba izq.", tr: "arriba dcha.", bl: "abajo izq.", br: "abajo dcha." }[prefs.corner]}
          </button>
        </div>
      )}
      {error && <div className="tt-error">{error}</div>}
      <div className="mp-body">
        {url && (inGame ? <MapSlot url={url} /> : <iframe className="mp-inline" src={url} title={`Mapa de ${game.name}`} {...FRAME} />)}
      </div>
      <div className="mp-foot">
        Mapa de Map Genie · {game.name}
        {inGame && pad ? " · El mapa se mueve con el ratón" : ""}
      </div>
    </div>
  );
}
