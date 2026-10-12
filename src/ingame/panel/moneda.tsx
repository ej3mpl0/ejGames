// Moneda: el panel del tema de la casa. Arriba el juego y la hora; abajo, un
// dock de botones redondos (la ranura roja marca el abierto) y, encima de él,
// lo que se ha elegido. Los bloques (logros, capturas, guías…) son los comunes.

import { useState, type ReactNode } from "react";
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
  QuitConfirm,
  unlockText,
  VolumeControls,
  type AchFilter,
  SavesBlock,
} from "./blocks";
import type { Panel } from "./model";
import { BatteryIcon, clock, cls, dayLabel, dur, hoursLabel } from "./parts";
import "./ejgames.css";
import "./moneda.css";

type Sec = "ach" | "guides" | "cheats" | "map" | "shots" | "saves" | "notes" | "music" | "perf" | "dl";

const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {d}
  </svg>
);
const ICONS: Record<Sec, ReactNode> = {
  ach: I(
    <>
      <path d="M8 4.5h8v4.5a4 4 0 0 1-8 0Z" />
      <path d="M8 6.5H5.5a2.5 2.5 0 0 0 2.6 3M16 6.5h2.5a2.5 2.5 0 0 1-2.6 3M12 13v4M8.5 19.5h7" />
    </>,
  ),
  guides: I(
    <>
      <path d="M5 4.5h10.5L19 8v11.5H5z" />
      <path d="M9 11h6M9 15h4" />
    </>,
  ),
  cheats: I(
    <>
      <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
      <circle cx="12" cy="12" r="3" />
    </>,
  ),
  map: I(
    <>
      <path d="m3.5 6.5 5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </>,
  ),
  shots: I(
    <>
      <path d="M4.5 8h3l1.8-2.5h5.4L16.5 8h3v10.5h-15z" />
      <circle cx="12" cy="13" r="3.2" />
    </>,
  ),
  saves: I(
    <>
      <path d="M5 4.5h11l3 3v12H5z" />
      <path d="M8.5 4.5v5h7v-5M8.5 19.5v-5h7v5" />
    </>,
  ),
  notes: I(
    <>
      <path d="M6 4.5h12v15H6z" />
      <path d="M9.5 9h5M9.5 13h3.5" />
    </>,
  ),
  music: I(
    <>
      <path d="M9 17.5V6l10-2v11.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </>,
  ),
  perf: I(<path d="M4 15.5 8.5 11l3 3 6.5-7M14 7h4v4" />),
  dl: I(<path d="M12 5v11m0 0-4-4m4 4 4-4M6 19.5h12" />),
};

export function MonedaPanel({ p }: { p: Panel }) {
  const d = p.data;
  const [sec, setSec] = useState<Sec>(p.ach.total ? "ach" : "shots");
  const [filter, setFilter] = useState<AchFilter>("all");
  const [viewer, setViewer] = useState<number | null>(null);
  const pad = useApp((s) => s.inputSource) === "gamepad";
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => (p.confirmQuit ? p.actions.cancelQuit() : viewer != null ? setViewer(null) : p.actions.close()),
    extra: { x: p.actions.screenshot, y: p.actions.launcher, menu: p.actions.close },
  });

  const dlActive = p.downloads.items.find((x) => x.state === "downloading");
  const secs: { id: Sec; label: string; info?: string }[] = [
    { id: "ach", label: "Logros", info: p.ach.total ? `${p.ach.got}/${p.ach.total}` : "" },
    { id: "guides", label: "Guías" },
    { id: "cheats", label: "Trucos" },
    { id: "map", label: "Mapa" },
    { id: "shots", label: "Capturas", info: d.captures.length ? String(d.captures.length) : "" },
    { id: "saves", label: "Partidas" },
    { id: "notes", label: "Notas" },
    { id: "music", label: "Música y sonido" },
    { id: "perf", label: "Rendimiento" },
    { id: "dl", label: "Descargas", info: p.downloads.items.length ? String(p.downloads.items.length) : "" },
  ];

  let body: ReactNode;
  let actions: ReactNode = null;
  switch (sec) {
    case "ach":
      body = p.ach.total ? <AchRows k="ej" list={achList(p, filter)} side={(a) => unlockText(a)} /> : <NoAchievements k="ej" />;
      if (p.ach.total)
        actions = (
          <div className="mo-seg">
            {(
              [
                ["all", "Todos"],
                ["unlocked", "Conseguidos"],
                ["locked", "Pendientes"],
              ] as [AchFilter, string][]
            ).map(([id, label]) => (
              <button key={id} data-nav className={cls(filter === id && "is-on")} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
        );
      break;
    case "shots":
      body = <CaptureGrid k="ej" p={p} onOpen={setViewer} />;
      actions = (
        <div className="mo-seg">
          <button data-nav onClick={p.actions.screenshot}>
            Hacer captura{d.screenshotHotkey ? ` · ${keyLabel(d.screenshotHotkey)}` : ""}
          </button>
          <button data-nav onClick={p.actions.openCaptures}>
            Abrir carpeta
          </button>
        </div>
      );
      break;
    case "guides":
      body = (
        <div className="pn-guides">
          <GuidesPane gameId={d.gameId} onMenu={p.actions.close} />
        </div>
      );
      break;
    case "cheats":
      body = (
        <div className="pn-guides">
          <TrainerPane gameId={d.gameId} gameTitle={d.title} inGame />
        </div>
      );
      break;
    case "map":
      body = (
        <div className="pn-guides">
          <MapPane gameId={d.gameId} gameTitle={d.title} inGame />
        </div>
      );
      break;
    case "saves":
      body = <SavesBlock k="ej" p={p} />;
      break;
    case "notes":
      body = <NotesEditor k="ej" p={p} />;
      break;
    case "music":
      body = (
        <>
          <NowPlaying k="ej" p={p} />
          <VolumeControls k="ej" p={p} gameLabel={d.title} masterLabel="Sistema" />
        </>
      );
      break;
    case "perf":
      body = <PerfTiles k="ej" p={p} />;
      break;
    case "dl":
      body = <DownloadList k="ej" p={p} />;
      break;
  }

  const cover = d.media.coverThumb || d.media.cover;
  const achPct = p.ach.total ? p.ach.got / p.ach.total : 0;
  const ring = (pct: number, live = false) => (
    <svg className={cls("mo-ring", live && "is-live")} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, pct * 100))} 100`} />
    </svg>
  );

  return (
    <div ref={ref} className="pn-ejgames pn-moneda">
      <header className="mo-top">
        <div className="mo-game">
          {cover && <img className="mo-cover" src={cover} alt="" />}
          <div>
            <h1 className="mo-title">{d.title}</h1>
            <div className="mo-chips">
              <span className="is-strong">{dur(p.session)}</span>
              <span>{hoursLabel(p.total)} en total</span>
              {p.perf?.fps?.fps ? <span>{Math.round(p.perf.fps.fps)} FPS</span> : null}
              {p.perf ? <span>CPU {Math.round(p.perf.cpu)} %</span> : null}
            </div>
            {pad && (
              <Hints
                className="mo-hints"
                items={[
                  ["lb", "Secciones"],
                  ["back", "Volver al juego"],
                ]}
              />
            )}
          </div>
        </div>
        <div className="mo-when">
          {p.live.pad && <BatteryIcon level={p.live.pad.level} charging={p.live.pad.state === "charging"} className="mo-bat" />}
          {p.live.battery && <BatteryIcon level={p.live.battery.level} charging={p.live.battery.charging} className="mo-bat" />}
          <div className="mo-clock">
            <b>{clock(p.now)}</b>
            <small>{dayLabel(p.now)}</small>
          </div>
        </div>
      </header>

      <section className={cls("mo-sheet", (sec === "guides" || sec === "cheats" || sec === "map") && "is-tall")} key={sec}>
        <header className="mo-sheet-head">
          <h2>{secs.find((s) => s.id === sec)!.label}</h2>
          {actions}
        </header>
        <div className={cls("mo-sheet-body", (sec === "guides" || sec === "cheats" || sec === "map") && "is-guides")}>{body}</div>
        {viewer != null && <CaptureViewer k="ej" list={d.captures} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
      </section>

      <nav className="mo-dock" aria-label="Herramientas">
        {secs.map((s) => (
          <button
            key={s.id}
            data-nav
            data-tab
            aria-selected={sec === s.id}
            aria-label={s.label}
            className={cls("mo-act", sec === s.id && "is-on")}
            onClick={() => {
              setSec(s.id);
              setViewer(null);
            }}
          >
            <span className="mo-act-ico">
              {s.id === "ach" && p.ach.total ? ring(achPct) : null}
              {s.id === "dl" && dlActive ? ring(dlActive.progress, true) : null}
              {ICONS[s.id]}
            </span>
            <span className="mo-act-label">{s.label}</span>
          </button>
        ))}
      </nav>

      <div className="mo-foot-l">
        <button data-nav className="mo-btn is-light" onClick={p.actions.close}>
          Volver al juego
        </button>
        <button data-nav className="mo-btn" onClick={p.actions.launcher}>
          Abrir ejGames
        </button>
      </div>
      <button data-nav className="mo-btn is-danger mo-quit" onClick={p.actions.askQuit}>
        Cerrar el juego
      </button>
      <Message k="ej" p={p} />
      <QuitConfirm k="ej" p={p} />
    </div>
  );
}
