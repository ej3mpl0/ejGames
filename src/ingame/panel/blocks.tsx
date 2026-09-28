// Bloques de contenido del panel. La estructura es común; cada plataforma les
// pone su prefijo de clases (`k`) y los viste con su CSS. Los elementos que se
// pueden elegir con mando o teclado llevan `data-nav`.

import { useEffect, useState, type ReactNode } from "react";
import type { Achievement, Capture } from "../../api/types";
import { autoNav } from "../../input/nav";
import { useApp } from "../../store/app";
import type { Panel } from "./model";
import { AchIcon, CupIcon, LockIcon, cls, downloadLine, gb, pctNum, Spark, trackTime, whenLabel } from "./parts";

type K = { k: string };

// ─────────── logros ───────────

export type AchFilter = "all" | "unlocked" | "locked";

export function achList(p: Panel, f: AchFilter) {
  if (f === "unlocked") return p.ach.unlocked;
  if (f === "locked") return p.ach.locked;
  return p.ach.all;
}

/** Filas de logros. `side`: lo de la derecha (fecha, rareza, puntos…). */
export function AchRows({
  k,
  list,
  side,
  icon,
  hiddenSummary = true,
  limit,
}: K & {
  list: Achievement[];
  side?: (a: Achievement) => ReactNode;
  icon?: (a: Achievement) => ReactNode;
  hiddenSummary?: boolean;
  limit?: number;
}) {
  // Los ocultos que faltan se agrupan en una sola línea (no dicen nada).
  const shown = hiddenSummary ? list.filter((a) => !(a.hidden && !a.unlockedAt)) : list;
  const hidden = list.length - shown.length;
  const items = limit ? shown.slice(0, limit) : shown;
  return (
    <div className={`${k}-ach-list`}>
      {items.map((a) => (
        <div key={a.apiName} data-nav tabIndex={-1} className={cls(`${k}-ach`, a.unlockedAt ? "is-done" : "is-locked")}>
          {icon ? icon(a) : <AchIcon a={a} className={`${k}-ach-icon`} fallback={<CupIcon />} />}
          <div className={`${k}-ach-txt`}>
            <div className={`${k}-ach-name`}>{a.name}</div>
            {a.description && <div className={`${k}-ach-desc`}>{a.description}</div>}
          </div>
          {side && <div className={`${k}-ach-side`}>{side(a)}</div>}
        </div>
      ))}
      {hidden > 0 && (
        <div data-nav tabIndex={-1} className={cls(`${k}-ach`, `${k}-ach-hidden`, "is-locked")}>
          <span className={cls(`${k}-ach-icon`, "ph")}>
            <LockIcon />
          </span>
          <div className={`${k}-ach-txt`}>
            <div className={`${k}-ach-name`}>{hidden === 1 ? "1 logro oculto" : `${hidden} logros ocultos`}</div>
            <div className={`${k}-ach-desc`}>Se desvelan al conseguirlos.</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Texto de rareza de un logro ("Lo tiene el 12,3 % de los jugadores"). */
export const rarityText = (a: Achievement) => (a.globalPct == null ? "" : `${pctNum(a.globalPct)} % de los jugadores`);

/** Fecha o rareza, lo que toque. */
export const unlockText = (a: Achievement) => (a.unlockedAt ? whenLabel(a.unlockedAt) : rarityText(a));

export function NoAchievements({ k }: K) {
  return (
    <div className={`${k}-empty`}>
      <CupIcon className={`${k}-empty-icon`} />
      <div className={`${k}-empty-title`}>Este juego no tiene logros detectados</div>
      <p>
        ejGames lee los de Steam y los de los juegos sueltos que guardan <code>achievements.ini</code> o <code>achievements.json</code>. Si los
        tiene, aparecerán al desbloquear el primero.
      </p>
    </div>
  );
}

// ─────────── capturas ───────────

export function CaptureGrid({ k, p, onOpen, limit }: K & { p: Panel; onOpen: (i: number) => void; limit?: number }) {
  const list = limit ? p.data.captures.slice(0, limit) : p.data.captures;
  if (!list.length) {
    return (
      <div className={`${k}-empty`}>
        <div className={`${k}-empty-title`}>Aún no hay capturas de este juego</div>
        <p>{p.data.screenshotHotkey ? `Pulsa ${keyLabel(p.data.screenshotHotkey)} durante la partida o usa el botón de captura.` : "Usa el botón de captura."}</p>
      </div>
    );
  }
  return (
    <div className={`${k}-shots`}>
      {list.map((c, i) => (
        <button key={c.id} data-nav className={`${k}-shot`} onClick={() => onOpen(i)}>
          <img src={c.thumb} alt="" draggable={false} loading="lazy" />
        </button>
      ))}
    </div>
  );
}

/** Una captura en grande; izquierda/derecha para pasar. */
export function CaptureViewer({ k, list, index, onIndex, onClose }: K & { list: Capture[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const c = list[index];
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
      if (e.key === "ArrowRight") onIndex(Math.min(list.length - 1, index + 1));
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [index, list.length, onIndex]);
  if (!c) return null;
  return (
    <div className={`${k}-viewer`} data-focus-trap>
      <img src={c.url} alt="" draggable={false} />
      <div className={`${k}-viewer-bar`}>
        <span>
          {whenLabel(c.takenAt)} · {c.width} × {c.height}
        </span>
        <span className={`${k}-viewer-count`}>
          {index + 1} / {list.length}
        </span>
        <button data-nav ref={autoNav} onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

export const keyLabel = (k: string) =>
  k
    .split("+")
    .map((p) => (p.trim().toLowerCase() === "shift" ? "Mayús" : p.trim()))
    .join(" + ");

// ─────────── notas ───────────

export function NotesEditor({ k, p, placeholder = "Apunta lo que quieras: códigos, dónde lo dejaste, qué te falta…" }: K & { p: Panel; placeholder?: string }) {
  const pad = useApp((s) => s.inputSource) === "gamepad";
  return (
    <div className={`${k}-notes`}>
      <textarea
        data-nav
        className={`${k}-notes-area`}
        value={p.note}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => p.actions.setNote(e.target.value)}
      />
      <div className={`${k}-notes-bar`}>
        <span>Se guardan solas, solo para este juego.</span>
        <button data-nav className={cls(`${k}-btn`, pad && "is-primary")} onClick={() => void p.actions.addNoteLine()}>
          Escribir con el mando
        </button>
      </div>
    </div>
  );
}

// ─────────── música y sonido ───────────

export function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7.5 4.8v14.4L19 12z" />
    </svg>
  );
}

export function SkipIcon({ back }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={back ? { transform: "scaleX(-1)" } : undefined}>
      <path fill="currentColor" d="M5.5 5.5v13l9.2-6.5zM16 5.5h2.6v13H16z" />
    </svg>
  );
}

export function NowPlaying({ k, p, compact, empty = "No suena nada en el PC." }: K & { p: Panel; compact?: boolean; empty?: string }) {
  const m = p.media;
  // La barra avanza sola entre muestras.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!m?.playing) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [m?.playing, m?.title]);
  useEffect(() => setTick(0), [m?.position]);
  if (!m) return <div className={cls(`${k}-np`, "is-empty")}>{empty}</div>;
  const pos = m.position != null ? Math.min(m.duration ?? 0, m.position + (m.playing ? tick : 0)) : null;
  return (
    <div className={cls(`${k}-np`, compact && "is-compact", m.playing && "is-playing")}>
      <div className={`${k}-np-art`}>{m.art ? <img src={m.art} alt="" draggable={false} /> : <span className="ph">♪</span>}</div>
      <div className={`${k}-np-info`}>
        <div className={`${k}-np-title`}>{m.title}</div>
        <div className={`${k}-np-artist`}>{[m.artist, m.app].filter(Boolean).join(" · ")}</div>
        {!compact && pos != null && m.duration ? (
          <div className={`${k}-np-time`}>
            <div className={`${k}-np-bar`}>
              <i style={{ width: `${(pos / m.duration) * 100}%` }} />
            </div>
            <span>{trackTime(pos, m.duration)}</span>
          </div>
        ) : null}
      </div>
      <div className={`${k}-np-ctl`}>
        <button data-nav disabled={!m.canPrev} onClick={() => p.actions.media("prev")} aria-label="Anterior">
          <SkipIcon back />
        </button>
        <button data-nav className="is-main" onClick={() => p.actions.media("toggle")} aria-label={m.playing ? "Pausa" : "Reproducir"}>
          <PlayIcon playing={m.playing} />
        </button>
        <button data-nav disabled={!m.canNext} onClick={() => p.actions.media("next")} aria-label="Siguiente">
          <SkipIcon />
        </button>
      </div>
    </div>
  );
}

export function SpeakerIcon({ muted }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 9.2h3.6L12.5 5v14l-4.9-4.2H4z" />
      {muted ? (
        <path d="m16 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M15.5 8.6a4.8 4.8 0 0 1 0 6.8M17.9 6.2a8.2 8.2 0 0 1 0 11.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

function VolumeRow({ k, p, which, label }: K & { p: Panel; which: "game" | "master"; label: string }) {
  const v = p.volume!;
  const level = which === "game" ? v.game : v.master;
  const muted = which === "game" ? v.gameMuted : v.masterMuted;
  const off = level == null;
  return (
    <div className={cls(`${k}-vol`, muted && "is-muted", off && "is-off")}>
      <button data-nav disabled={off} className={`${k}-vol-mute`} onClick={() => p.actions.toggleMute(which)} aria-label={muted ? "Quitar silencio" : "Silenciar"}>
        <SpeakerIcon muted={muted || off} />
      </button>
      <div className={`${k}-vol-main`}>
        <div className={`${k}-vol-label`}>
          <span>{label}</span>
          <span>{off ? "Sin sonido aún" : muted ? "Silenciado" : `${Math.round((level ?? 0) * 100)} %`}</span>
        </div>
        <input
          data-nav
          type="range"
          min={0}
          max={100}
          step={2}
          disabled={off}
          value={Math.round((level ?? 0) * 100)}
          style={{ ["--v" as string]: `${Math.round((level ?? 0) * 100)}%` }}
          onChange={(e) => p.actions.setVolume(which, Number(e.target.value) / 100)}
          className={`${k}-vol-range`}
        />
      </div>
    </div>
  );
}

export function VolumeControls({ k, p, gameLabel = "Juego", masterLabel = "Sistema" }: K & { p: Panel; gameLabel?: string; masterLabel?: string }) {
  if (!p.volume) return <div className={cls(`${k}-vols`, "is-empty")}>No se pudo leer el sonido del PC.</div>;
  return (
    <div className={`${k}-vols`}>
      <VolumeRow k={k} p={p} which="game" label={gameLabel} />
      <VolumeRow k={k} p={p} which="master" label={masterLabel} />
    </div>
  );
}

// ─────────── rendimiento ───────────

export function PerfTiles({ k, p, spark = true }: K & { p: Panel; spark?: boolean }) {
  const f = p.perf;
  if (!f) return <div className={cls(`${k}-perf`, "is-empty")}>Midiendo…</div>;
  const ramMax = Math.max(f.sysRamTotal, 1);
  const tiles: { id: string; label: string; value: string; sub: string; hist?: number[]; max?: number }[] = [
    { id: "cpu", label: "Procesador", value: `${Math.round(f.cpu)} %`, sub: `Sistema: ${Math.round(f.sysCpu)} %`, hist: p.history.cpu, max: 100 },
    {
      id: "gpu",
      label: "Gráfica",
      value: f.gpu == null ? "—" : `${Math.round(f.gpu)} %`,
      sub: f.vram ? `${gb(f.vram)} de vídeo` : "Memoria de vídeo: —",
      hist: p.history.gpu,
      max: 100,
    },
    { id: "ram", label: "Memoria", value: gb(f.ram), sub: `Sistema: ${gb(f.sysRamUsed)} de ${gb(f.sysRamTotal)}`, hist: p.history.ram, max: ramMax },
  ];
  return (
    <div className={`${k}-perf`}>
      {tiles.map((t) => (
        <div key={t.id} data-nav tabIndex={-1} className={cls(`${k}-perf-tile`, `is-${t.id}`)}>
          <div className={`${k}-perf-label`}>{t.label}</div>
          <div className={`${k}-perf-value`}>{t.value}</div>
          <div className={`${k}-perf-sub`}>{t.sub}</div>
          {spark && t.hist && <Spark className={`${k}-perf-spark`} values={t.hist} max={t.id === "ram" ? Math.max(...t.hist, 1) * 1.25 : t.max} />}
        </div>
      ))}
    </div>
  );
}

// ─────────── descargas ───────────

export function DownloadList({ k, p, compact }: K & { p: Panel; compact?: boolean }) {
  const d = p.downloads;
  if (!d.items.length) return <div className={cls(`${k}-dl`, "is-empty")}>No hay descargas.</div>;
  return (
    <div className={cls(`${k}-dl`, compact && "is-compact")}>
      {(d.pausedForGame || d.allowed) && (
        <div className={`${k}-dl-note`}>
          <span>{d.allowed ? "Se descarga mientras juegas." : "Las descargas esperan a que acabes de jugar."}</span>
          <button data-nav className={`${k}-btn`} onClick={() => p.actions.downloads(!d.allowed)}>
            {d.allowed ? "Pausar hasta que acabe" : "Seguir descargando"}
          </button>
        </div>
      )}
      {d.items.map((x) => (
        <div key={x.id} data-nav tabIndex={-1} className={`${k}-dl-item`}>
          {!compact && (x.capsule || x.cover) && <img className={`${k}-dl-art`} src={(x.capsule || x.cover)!} alt="" draggable={false} />}
          <div className={`${k}-dl-info`}>
            <div className={`${k}-dl-title`}>{x.title}</div>
            <div className={`${k}-dl-bar`}>
              <i style={{ width: `${Math.floor(x.progress * 100)}%` }} />
            </div>
            <div className={`${k}-dl-sub`}>{downloadLine(x)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────── cerrar el juego ───────────

export function QuitConfirm({ k, p }: K & { p: Panel }) {
  if (!p.confirmQuit) return null;
  return (
    <div className={`${k}-modal-bg`} onMouseDown={(e) => e.target === e.currentTarget && p.actions.cancelQuit()}>
      <div className={`${k}-modal`} data-focus-trap role="dialog">
        <div className={`${k}-modal-title`}>¿Cerrar {p.data.title}?</div>
        <p className={`${k}-modal-body`}>El juego se cerrará de golpe: perderás lo que no hayas guardado.</p>
        <div className={`${k}-modal-actions`}>
          <button data-nav className={cls(`${k}-btn`, "is-danger")} onClick={p.actions.quit}>
            Cerrar el juego
          </button>
          <button data-nav ref={autoNav} className={`${k}-btn`} onClick={p.actions.cancelQuit}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mensaje de error corto (volumen que no se pudo cambiar…). */
export function Message({ k, p }: K & { p: Panel }) {
  return p.message ? <div className={`${k}-msg`}>{p.message}</div> : null;
}
