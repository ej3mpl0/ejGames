// Datos y acciones del panel del overlay, comunes a todos los estilos: cada
// plataforma solo decide cómo se ve.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, errMsg } from "../../api/tauri";
import type { Achievement, OverlayLive, OverlayPanel } from "../../api/types";
import { openKeyboard } from "../../host/downloads";

export type Perf = NonNullable<OverlayLive["perf"]>;
export type Media = NonNullable<OverlayLive["media"]>;

/** Últimos 60 s de rendimiento (para las gráficas). */
export interface PerfHistory {
  cpu: number[];
  gpu: number[];
  ram: number[];
  fps: number[];
}

export interface AchGroups {
  all: Achievement[];
  unlocked: Achievement[];
  locked: Achievement[];
  /** Los tres bloqueados más fáciles (los que más gente tiene), sin ocultos. */
  next: Achievement[];
  /** El más raro de los conseguidos. */
  rarest?: Achievement;
  hiddenLeft: number;
  total: number;
  got: number;
  pct: number;
  /** Puntos conseguidos y totales (1000 por juego). */
  score: number;
  scoreTotal: number;
}

function groups(list: OverlayPanel["achievements"]): AchGroups {
  const items = list?.items ?? [];
  const unlocked = items.filter((a) => a.unlockedAt).sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0));
  const locked = items.filter((a) => !a.unlockedAt).sort((a, b) => (b.globalPct ?? -1) - (a.globalPct ?? -1));
  const next = locked.filter((a) => !a.hidden).slice(0, 3);
  const rarest = [...unlocked].filter((a) => a.globalPct != null).sort((a, b) => (a.globalPct ?? 100) - (b.globalPct ?? 100))[0];
  const total = list?.total ?? 0;
  const got = list?.unlocked ?? 0;
  return {
    all: [...unlocked, ...locked],
    unlocked,
    locked,
    next,
    rarest,
    hiddenLeft: locked.filter((a) => a.hidden).length,
    total,
    got,
    pct: total ? Math.floor((got / total) * 100) : 0,
    score: unlocked.reduce((s, a) => s + (a.score ?? 0), 0),
    scoreTotal: items.reduce((s, a) => s + (a.score ?? 0), 0),
  };
}

export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export type Panel = ReturnType<typeof usePanel>;

export function usePanel(data: OverlayPanel, live: OverlayLive) {
  const now = useNow();
  const session = data.startedAt ? Math.max(0, Math.floor(now / 1000 - data.startedAt)) : 0;
  const ach = useMemo(() => groups(data.achievements), [data.achievements]);

  // Historial de rendimiento (llega un dato por segundo con el panel abierto).
  const hist = useRef<PerfHistory>({ cpu: [], gpu: [], ram: [], fps: [] });
  const [, bump] = useState(0);
  useEffect(() => {
    const p = live.perf;
    if (!p) return;
    const h = hist.current;
    const push = (arr: number[], v: number) => {
      arr.push(v);
      if (arr.length > 60) arr.shift();
    };
    push(h.cpu, p.cpu);
    push(h.gpu, p.gpu ?? 0);
    push(h.ram, p.ram);
    push(h.fps, p.fps?.fps ?? 0);
    bump((x) => x + 1);
  }, [live.perf]);

  // Aviso corto dentro del panel (errores de una acción).
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);
  const run = (p: Promise<unknown>) => void p.catch((e) => setMessage(errMsg(e)));

  // Cerrar el juego pide confirmación.
  const [confirmQuit, setConfirmQuit] = useState(false);

  // Notas: se guardan solas al dejar de escribir.
  const [note, setNoteState] = useState(data.note);
  const saved = useRef(data.note);
  const timer = useRef(0);
  useEffect(() => {
    // Otra apertura del panel (o de otro juego): la nota guardada manda.
    setNoteState(data.note);
    saved.current = data.note;
  }, [data.gameId, data.note]);
  const flush = (text: string) => {
    window.clearTimeout(timer.current);
    if (text === saved.current) return;
    saved.current = text;
    run(api.overlayNote(text));
  };
  const setNote = (text: string) => {
    setNoteState(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(text), 700);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Volumen: se mueve al instante en la página y se aplica sin inundar al núcleo.
  const [vol, setVol] = useState<{ game?: number | null; master?: number | null }>({});
  const volTimer = useRef<Record<string, number>>({});
  useEffect(() => setVol({}), [live.volume?.game, live.volume?.master]);
  const setVolume = (which: "game" | "master", level: number) => {
    setVol((v) => ({ ...v, [which]: level }));
    window.clearTimeout(volTimer.current[which]);
    volTimer.current[which] = window.setTimeout(() => run(api.overlayVolume(which, level)), 60);
  };

  const actions = {
    close: () => {
      flush(note);
      void api.overlayPanel(false, true);
    },
    launcher: () => {
      flush(note);
      void api.overlayAction("launcher");
    },
    screenshot: () => run(api.overlayAction("screenshot")),
    openCaptures: () => run(api.overlayAction("open-captures")),
    askQuit: () => setConfirmQuit(true),
    cancelQuit: () => setConfirmQuit(false),
    quit: () => {
      setConfirmQuit(false);
      flush(note);
      run(api.overlayAction("quit-game"));
    },
    media: (cmd: "toggle" | "next" | "prev") => run(api.overlayMedia(cmd)),
    setVolume,
    toggleMute: (which: "game" | "master") => {
      const v = live.volume;
      if (!v) return;
      run(api.overlayVolume(which, null, which === "game" ? !v.gameMuted : !v.masterMuted));
    },
    downloads: (resume: boolean) => run(api.overlayAction(resume ? "downloads-resume" : "downloads-pause")),
    setNote,
    /** Añadir una línea a las notas con el teclado en pantalla (mando). */
    addNoteLine: async () => {
      const line = await openKeyboard({ title: "Añadir a las notas", placeholder: "Escribe una nota", maxLength: 200 });
      if (line && line.trim()) {
        const text = note.trim() ? `${note.replace(/\s+$/, "")}\n${line.trim()}` : line.trim();
        setNoteState(text);
        flush(text);
      }
    },
  };

  const volume = live.volume
    ? {
        ...live.volume,
        game: vol.game ?? live.volume.game,
        master: vol.master ?? live.volume.master,
      }
    : null;

  return {
    data,
    live,
    now: new Date(now),
    session,
    /** Tiempo total contando esta partida. */
    total: data.playtime + session,
    ach,
    perf: live.perf ?? null,
    history: hist.current,
    media: live.media ?? null,
    volume,
    downloads: live.downloads,
    note,
    message,
    confirmQuit,
    actions,
    art: {
      hero: data.media.hero || data.media.header || data.media.cover || null,
      logo: data.media.logo || null,
      cover: data.media.cover || data.media.header || null,
      header: data.media.header || data.media.hero || null,
      icon: data.media.icon || null,
    },
  };
}
