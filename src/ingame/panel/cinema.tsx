// Cine: la partida como una película en pausa en una plataforma de series.
// «Estás jugando a», el título en grande, los botones de siempre, la barra de
// progreso (los logros) y abajo una fila de pestañas como la de episodios.

import { useState, type CSSProperties, type ReactNode } from "react";
import { GuidesPane } from "../../components/guide";
import { MapPane } from "../../components/map";
import { TrainerPane } from "../../components/trainer";
import { Hints } from "../../components/Hints";
import { useOverlayNav } from "../../input/nav";
import { useApp } from "../../store/app";
import {
  achList,
  AchRows,
  CaptureGrid,
  CaptureViewer,
  DownloadList,
  keyLabel,
  Message,
  NoAchievements,
  NotesEditor,
  NowPlaying,
  PerfTiles,
  PlayIcon,
  QuitConfirm,
  unlockText,
  VolumeControls,
  type AchFilter,
  SavesBlock,
} from "./blocks";
import type { Panel } from "./model";
import { BatteryIcon, clock, cls, dur, hms, hoursLabel, Img } from "./parts";
import "./cinema.css";

type Row = "ach" | "guides" | "cheats" | "map" | "shots" | "notes" | "saves" | "music" | "perf" | "dl";

export function CinemaPanel({ p }: { p: Panel }) {
  const d = p.data;
  const rows: { id: Row; label: string }[] = [
    ...(p.ach.total ? [{ id: "ach" as Row, label: "Logros" }] : []),
    { id: "guides", label: "Guías" },
    { id: "cheats", label: "Trucos" },
    { id: "map", label: "Mapa" },
    { id: "shots", label: "Capturas" },
    { id: "saves", label: "Partidas" },
    { id: "notes", label: "Notas" },
    { id: "music", label: "Música" },
    { id: "perf", label: "Rendimiento" },
    ...(p.downloads.items.length ? [{ id: "dl" as Row, label: "Descargas" }] : []),
  ];
  const [row, setRow] = useState<Row>(rows[0].id);
  const [filter, setFilter] = useState<AchFilter>("locked");
  const [viewer, setViewer] = useState<number | null>(null);
  const pad = useApp((s) => s.inputSource) === "gamepad";
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => (p.confirmQuit ? p.actions.cancelQuit() : viewer != null ? setViewer(null) : p.actions.close()),
    extra: { x: p.actions.screenshot, y: p.actions.launcher, menu: p.actions.close },
  });
  const style = d.look.accent ? ({ "--cn-accent": d.look.accent } as CSSProperties) : undefined;
  const meta = [d.releaseYear, d.developer, `${hoursLabel(p.total)} jugadas`].filter(Boolean);

  let rail: ReactNode;
  switch (row) {
    case "ach":
      rail = p.ach.total ? (
        <>
          <div className="cn-filters">
            {(
              [
                ["locked", "Por conseguir"],
                ["unlocked", "Conseguidos"],
                ["all", "Todos"],
              ] as [AchFilter, string][]
            ).map(([id, label]) => (
              <button key={id} data-nav className={cls("cn-chip", filter === id && "is-on")} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <AchRows k="cn" list={achList(p, filter)} side={(a) => unlockText(a)} />
        </>
      ) : (
        <NoAchievements k="cn" />
      );
      break;
    case "guides":
      rail = (
        <div className="pn-guides">
          <GuidesPane gameId={d.gameId} onMenu={p.actions.close} />
        </div>
      );
      break;
    case "cheats":
      rail = (
        <div className="pn-guides">
          <TrainerPane gameId={d.gameId} gameTitle={d.title} inGame />
        </div>
      );
      break;
    case "map":
      rail = (
        <div className="pn-guides">
          <MapPane gameId={d.gameId} gameTitle={d.title} inGame />
        </div>
      );
      break;
    case "shots":
      rail = (
        <div className="cn-shots-row">
          <button data-nav className="cn-shot-new" onClick={p.actions.screenshot}>
            <span className="cn-plus">+</span>
            <span>Hacer captura</span>
            {d.screenshotHotkey && <small>{keyLabel(d.screenshotHotkey)}</small>}
          </button>
          <CaptureGrid k="cn" p={p} onOpen={setViewer} />
          {d.captures.length > 0 && (
            <button data-nav className="cn-shot-new is-folder" onClick={p.actions.openCaptures}>
              <span>Abrir la carpeta</span>
            </button>
          )}
        </div>
      );
      break;
    case "saves":
      rail = <SavesBlock k="cn" p={p} />;
      break;
    case "notes":
      rail = <NotesEditor k="cn" p={p} />;
      break;
    case "music":
      rail = (
        <div className="cn-music">
          <NowPlaying k="cn" p={p} />
          <VolumeControls k="cn" p={p} gameLabel="Juego" masterLabel="Sistema" />
        </div>
      );
      break;
    case "perf":
      rail = <PerfTiles k="cn" p={p} />;
      break;
    case "dl":
      rail = <DownloadList k="cn" p={p} />;
      break;
  }

  return (
    <div ref={ref} className={cls("pn-cinema", (row === "guides" || row === "cheats" || row === "map") && "is-guides")} style={style}>
      {/* El «fotograma congelado» es el propio juego: solo se oscurece. */}
      <div className="cn-shade" />

      <header className="cn-top">
        <span className="cn-paused">
          <PlayIcon playing /> En pausa
        </span>
        <span className="cn-status">
          {p.live.pad && <BatteryIcon level={p.live.pad.level} charging={p.live.pad.state === "charging"} className="cn-bat" />}
          {p.live.battery && <BatteryIcon level={p.live.battery.level} charging={p.live.battery.charging} className="cn-bat" />}
          {clock(p.now)}
        </span>
      </header>

      <section className="cn-info">
        <div className="cn-kicker">Estás jugando a</div>
        {p.art.logo ? <Img src={p.art.logo} className="cn-logo" alt={d.title} /> : <h1 className="cn-title">{d.title}</h1>}
        <div className="cn-meta">
          {meta.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
        <div className="cn-actions">
          <button data-nav className="cn-btn is-play" onClick={p.actions.close}>
            <PlayIcon playing={false} /> Reanudar
          </button>
          <button data-nav className="cn-btn" onClick={p.actions.screenshot}>
            Hacer captura
          </button>
          <button data-nav className="cn-btn" onClick={p.actions.launcher}>
            Abrir ejGames
          </button>
          <button data-nav className="cn-btn is-ghost" onClick={p.actions.askQuit}>
            Salir del juego
          </button>
        </div>
        <div className="cn-scrub">
          <span className="cn-scrub-time">{hms(p.session)}</span>
          <div className="cn-scrub-bar">
            <i style={{ width: `${p.ach.total ? p.ach.pct : 0}%` }} />
          </div>
          <span className="cn-scrub-time">{p.ach.total ? `${p.ach.got} de ${p.ach.total} logros` : dur(p.session)}</span>
        </div>
      </section>

      <section className="cn-rails">
        <nav className="cn-tabs">
          {rows.map((r) => (
            <button
              key={r.id}
              data-nav
              data-tab
              aria-selected={row === r.id}
              className={cls("cn-tab", row === r.id && "is-on")}
              onClick={() => {
                setRow(r.id);
                setViewer(null);
              }}
            >
              {r.label}
            </button>
          ))}
          {pad && (
            <Hints
              className="cn-hints"
              items={[
                ["lb", "Cambiar"],
                ["back", "Reanudar"],
              ]}
            />
          )}
        </nav>
        <div className={cls("cn-rail", `is-${row}`, (row === "cheats" || row === "map") && "is-guides")}>{rail}</div>
      </section>

      {viewer != null && <CaptureViewer k="cn" list={d.captures} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
      <Message k="cn" p={p} />
      <QuitConfirm k="cn" p={p} />
    </div>
  );
}
