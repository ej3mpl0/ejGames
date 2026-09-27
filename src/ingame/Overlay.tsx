// Overlay dentro del juego (ventana transparente encima del juego).
// - Avisos: pila en una esquina (logros desbloqueados, pista del atajo), con
//   el aspecto de la plataforma del tema (ver notices.tsx).
// - Panel: logros, tiempo de sesión y reloj. Se abre con el atajo o el botón
//   Guía; el núcleo manda la navegación del mando (el Gamepad API no sirve
//   cuando el foco lo tiene el juego).
// Cuando no queda nada que enseñar se avisa al núcleo y la ventana se destruye.

import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Clock3, Lock, Trophy } from "lucide-react";
import { api } from "../api/tauri";
import type { Achievement, NavAction, OverlayNotice, OverlayPanel } from "../api/types";
import { Hints } from "../components/Hints";
import { padTypeOf } from "../input/gamepad";
import { playtime } from "../lib/format";
import { useApp } from "../store/app";
import "./ingame.css";
import { isRare, LEAVE_MS, noticeMs, NoticeStack, NoticeView } from "./notices";

const MAX_VISIBLE = 3;

type Shown = OverlayNotice & { leaving?: boolean };

function rarityLabel(p?: number | null) {
  if (p == null) return null;
  const pct = p.toLocaleString("es", { maximumFractionDigits: p < 10 ? 1 : 0 });
  if (p < 5) return { cls: "ultra", text: `Ultra raro · ${pct} %` };
  if (p < 15) return { cls: "very", text: `Muy raro · ${pct} %` };
  if (p < 35) return { cls: "rare", text: `Raro · ${pct} %` };
  return { cls: "common", text: `${pct} % de jugadores` };
}

function TrophyIcon({ src, size = 64, locked }: { src?: string | null; size?: number; locked?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img className="ig-icon" src={src} width={size} height={size} alt="" onError={() => setBroken(true)} />;
  }
  return (
    <span className={`ig-icon ig-icon-fallback ${locked ? "locked" : ""}`} style={{ width: size, height: size }}>
      {locked ? <Lock size={size * 0.4} /> : <Trophy size={size * 0.46} />}
    </span>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sortItems(items: Achievement[]) {
  const unlocked = items.filter((a) => a.unlockedAt).sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0));
  // Bloqueados: primero los más comunes (los más fáciles de conseguir).
  const locked = items.filter((a) => !a.unlockedAt).sort((a, b) => (b.globalPct ?? -1) - (a.globalPct ?? -1));
  return [...unlocked, ...locked];
}

function Panel({ data, nav }: { data: OverlayPanel; nav: { action: NavAction; seq: number } | null }) {
  const now = useNow(true);
  const list = data.achievements;
  const items = useMemo(() => sortItems(list?.items ?? []), [list]);
  // Foco: -2 = "Volver al juego", -1 = "Abrir ejGames", 0.. = logros.
  const [focus, setFocus] = useState(-2);
  const listRef = useRef<HTMLDivElement>(null);
  const pct = list && list.total ? Math.round((list.unlocked / list.total) * 100) : 0;
  const elapsed = data.startedAt ? Math.max(0, Math.floor(now / 1000 - data.startedAt)) : 0;
  const clock = new Date(now);

  const close = () => void api.overlayPanel(false, true);
  const launcher = () => void api.overlayAction("launcher");

  function move(action: NavAction) {
    const max = items.length - 1;
    if (action === "back" || action === "home") return close();
    if (action === "y") return launcher();
    if (action === "accept") {
      if (focus === -2) return close();
      if (focus === -1) return launcher();
      return;
    }
    setFocus((f) => {
      if (action === "down") return f < 0 ? (items.length ? 0 : f) : Math.min(max, f + 1);
      if (action === "up") return f <= 0 ? -2 : f - 1;
      if (action === "left" || action === "right") return f === -2 ? -1 : f === -1 ? -2 : f;
      if (action === "rb") return Math.min(max, Math.max(0, f) + 6);
      if (action === "lb") return Math.max(0, f - 6);
      return f;
    });
  }

  useEffect(() => {
    if (nav) move(nav.action);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav?.seq]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, NavAction> = {
        Escape: "back", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "accept",
        PageDown: "rb", PageUp: "lb", f: "y", F: "y",
      };
      const a = map[e.key];
      if (a) {
        e.preventDefault();
        useApp.getState().set({ inputSource: "keyboard" });
        move(a);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (focus >= 0) listRef.current?.querySelector(`[data-i="${focus}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const art = data.media.hero || data.media.header || data.media.cover;
  const hiddenLeft = items.filter((a) => a.hidden && !a.unlockedAt).length;

  return (
    <div className="ig-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="ig-panel">
        <header className="ig-top">
          <div className="flex min-w-0 items-center gap-4">
            {data.media.logo ? <img src={data.media.logo} className="ig-logo" alt={data.title} /> : <h1 className="ig-game-title">{data.title}</h1>}
          </div>
          <div className="ig-clock">
            <div className="ig-time">{clock.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</div>
            <div className="ig-date">{capitalize(clock.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }))}</div>
          </div>
        </header>

        <div className="ig-body-grid">
          <aside className="ig-side">
            {art && <div className="ig-art" style={{ backgroundImage: `url("${art}")` }} />}
            <div className="ig-stat">
              <Clock3 size={18} />
              <div>
                <div className="ig-stat-label">En partida</div>
                <div className="ig-stat-value">{playtime(elapsed, "Recién empezada")}</div>
              </div>
            </div>
            {list && list.total > 0 && (
              <div className="ig-stat">
                <Trophy size={18} />
                <div>
                  <div className="ig-stat-label">Logros</div>
                  <div className="ig-stat-value">
                    {list.unlocked} / {list.total} <span className="ig-muted">· {pct} %</span>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-auto flex flex-col gap-2">
              <button data-nav className={`ig-btn primary ${focus === -2 ? "is-focused" : ""}`} onClick={close} onMouseEnter={() => setFocus(-2)}>
                Volver al juego
              </button>
              <button data-nav className={`ig-btn ${focus === -1 ? "is-focused" : ""}`} onClick={launcher} onMouseEnter={() => setFocus(-1)}>
                Abrir ejGames
              </button>
            </div>
          </aside>

          <section className="ig-main">
            {list && list.total > 0 ? (
              <>
                <div className="ig-progress-head">
                  <h2>Logros</h2>
                  <span className="ig-muted">
                    {list.unlocked} de {list.total}
                    {hiddenLeft > 0 && ` · ${hiddenLeft} ocultos por descubrir`}
                  </span>
                </div>
                <div className="ig-progress">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="ig-list" ref={listRef}>
                  {items.map((a, i) => {
                    const r = rarityLabel(a.globalPct);
                    return (
                      <div key={a.apiName} data-i={i} className={`ig-row ${a.unlockedAt ? "done" : "locked"} ${focus === i ? "is-focused" : ""}`} onMouseEnter={() => setFocus(i)}>
                        <TrophyIcon src={a.unlockedAt ? a.icon : a.iconGray || a.icon} size={52} locked={!a.unlockedAt && !a.iconGray && !a.icon} />
                        <div className="min-w-0 flex-1">
                          <div className="ig-row-title">{a.name}</div>
                          {a.description && <div className="ig-row-desc">{a.description}</div>}
                        </div>
                        <div className="ig-row-side">
                          {a.unlockedAt ? (
                            <span>{new Date(a.unlockedAt * 1000).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</span>
                          ) : (
                            r && <span className={`ig-rarity ${r.cls}`}>{r.text}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="ig-empty">
                <Trophy size={40} />
                <h2>Sin logros detectados</h2>
                <p>
                  ejGames lee los logros de Steam y los de los juegos sueltos que guardan <code>achievements.ini</code> o <code>achievements.json</code> (con su{" "}
                  <code>steam_appid.txt</code>). Si este juego los tiene, aparecerán aquí al desbloquear el primero.
                </p>
              </div>
            )}
          </section>
        </div>

        <footer className="ig-footer">
          <Hints
            items={[
              ["up", "Moverse"],
              ["accept", "Aceptar"],
              ["back", "Volver al juego"],
              ["y", "Abrir ejGames"],
            ]}
          />
          {data.hotkey && <span className="ig-muted">{data.hotkey.replace(/shift/i, "Mayús")} también cierra el panel</span>}
        </footer>
      </div>
    </div>
  );
}

export function Overlay() {
  const [queue, setQueue] = useState<OverlayNotice[]>([]);
  const [shown, setShown] = useState<Shown[]>([]);
  const [panel, setPanel] = useState<OverlayPanel | null>(null);
  const [nav, setNav] = useState<{ action: NavAction; seq: number } | null>(null);
  const [ready, setReady] = useState(false);
  const panelRef = useRef<OverlayPanel | null>(null);
  panelRef.current = panel;

  useEffect(() => {
    const subs = [
      listen<OverlayNotice>("overlay:notice", (e) => setQueue((q) => [...q, e.payload])),
      listen<OverlayPanel | null>("overlay:panel", (e) => openPanel(e.payload)),
      listen<NavAction>("overlay:nav", (e) => {
        useApp.getState().set({ inputSource: "gamepad" });
        setNav((n) => ({ action: e.payload, seq: (n?.seq ?? 0) + 1 }));
      }),
    ];
    Promise.all(subs).then(async () => {
      const init = await api.overlayReady();
      if (init.notices.length) setQueue((q) => [...q, ...init.notices]);
      if (init.panel) openPanel(init.panel);
      setReady(true);
    });
    // Sin foco con el panel abierto (Alt+Tab, clic en otra ventana): cerrarlo.
    let unBlur: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && panelRef.current) void api.overlayPanel(false, false);
      })
      .then((u) => (unBlur = u));
    return () => {
      subs.forEach((p) => p.then((u) => u()));
      unBlur?.();
    };
  }, []);

  function openPanel(p: OverlayPanel | null) {
    // Cada apertura empieza sin acción pendiente del mando (si no, el panel
    // repetiría la última al montarse, p. ej. "atrás" y se cerraría solo).
    setNav(null);
    if (p) {
      const pads = navigator.getGamepads?.().filter(Boolean) ?? [];
      useApp.getState().set({ inputSource: p.pad ? "gamepad" : "keyboard", padType: pads[0] ? padTypeOf(pads[0].id) : "xbox" });
    }
    setPanel(p);
  }

  // Cola → visibles (máx. 3) con su temporizador.
  useEffect(() => {
    if (!queue.length) return;
    const visible = shown.filter((s) => !s.leaving).length;
    if (visible >= MAX_VISIBLE) return;
    const take = queue.slice(0, MAX_VISIBLE - visible);
    setQueue((q) => q.slice(take.length));
    setShown((s) => [...s, ...take]);
    for (const n of take) {
      // El sonido, a la vez que la animación de entrada.
      if (n.kind !== "info") void api.overlayChime(isRare(n)).catch(() => {});
      setTimeout(() => setShown((s) => s.map((x) => (x.id === n.id ? { ...x, leaving: true } : x))), noticeMs(n));
      setTimeout(() => setShown((s) => s.filter((x) => x.id !== n.id)), noticeMs(n) + LEAVE_MS);
    }
  }, [queue, shown]);

  // Nada que enseñar: el núcleo destruye la ventana.
  useEffect(() => {
    if (!ready || queue.length || shown.length || panel) return;
    const t = setTimeout(() => void api.overlayIdle(), 400);
    return () => clearTimeout(t);
  }, [ready, queue.length, shown.length, panel]);

  return (
    <div className="ig-root">
      {panel && <Panel data={panel} nav={nav} />}
      {shown.length > 0 && (
        <NoticeStack corner={shown[shown.length - 1].look.corner}>
          {shown.map((n) => (
            <NoticeView key={n.id} n={n} leaving={n.leaving} />
          ))}
        </NoticeStack>
      )}
    </div>
  );
}
