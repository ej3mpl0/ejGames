// ejGames: el de los temas sin plataforma (y de terceros). Sobrio, con los
// colores, el radio y la fuente del tema: un carril con las secciones y lo
// importante a la vista, y el contenido al lado.

import { useState, type CSSProperties, type ReactNode } from "react";
import { GuidesPane } from "../../components/guide";
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
} from "./blocks";
import type { Panel } from "./model";
import { BatteryIcon, clock, cls, dayLabel, dur, hoursLabel } from "./parts";
import "./ejgames.css";

type Sec = "ach" | "guides" | "shots" | "notes" | "music" | "perf" | "dl";

export function EjGamesPanel({ p }: { p: Panel }) {
  const d = p.data;
  const [sec, setSec] = useState<Sec>(p.ach.total ? "ach" : "shots");
  const [filter, setFilter] = useState<AchFilter>("all");
  const [viewer, setViewer] = useState<number | null>(null);
  const pad = useApp((s) => s.inputSource) === "gamepad";
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => (p.confirmQuit ? p.actions.cancelQuit() : viewer != null ? setViewer(null) : p.actions.close()),
    extra: { x: p.actions.screenshot, y: p.actions.launcher, menu: p.actions.close },
  });

  const look = d.look;
  const vars: Record<string, string> = {};
  if (look.accent) vars["--ej-accent"] = look.accent;
  if (look.surface) vars["--ej-surface"] = look.surface;
  if (look.text) vars["--ej-text"] = look.text;
  if (look.radius) vars["--ej-radius"] = look.radius;
  if (look.font) vars["--ej-font"] = look.font;

  const secs: { id: Sec; label: string; info: string }[] = [
    { id: "ach", label: "Logros", info: p.ach.total ? `${p.ach.got}/${p.ach.total}` : "—" },
    { id: "guides", label: "Guías", info: "" },
    { id: "shots", label: "Capturas", info: d.captures.length ? String(d.captures.length) : "" },
    { id: "notes", label: "Notas", info: p.note.trim() ? `${p.note.trim().split("\n").length} líneas` : "" },
    { id: "music", label: "Música y sonido", info: p.media ? (p.media.playing ? "Sonando" : "En pausa") : "" },
    { id: "perf", label: "Rendimiento", info: p.perf ? `${Math.round(p.perf.cpu)} % CPU` : "" },
    { id: "dl", label: "Descargas", info: p.downloads.items.length ? String(p.downloads.items.length) : "" },
  ];

  let body: ReactNode;
  let actions: ReactNode = null;
  switch (sec) {
    case "ach":
      body = p.ach.total ? (
        <>
          <div className="ej-bar">
            <i style={{ width: `${p.ach.pct}%` }} />
          </div>
          <AchRows k="ej" list={achList(p, filter)} side={(a) => unlockText(a)} />
        </>
      ) : (
        <NoAchievements k="ej" />
      );
      if (p.ach.total)
        actions = (
          <div className="ej-seg">
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
        <div className="ej-seg">
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

  return (
    <div ref={ref} className={cls("pn-ejgames", !look.dark && "is-light")} style={vars as CSSProperties}>
      <aside className="ej-rail">
        <div className="ej-when">
          <span className="ej-clock">{clock(p.now)}</span>
          <span className="ej-day">{dayLabel(p.now)}</span>
          {p.live.pad && <BatteryIcon level={p.live.pad.level} charging={p.live.pad.state === "charging"} className="ej-bat" />}
          {p.live.battery && <BatteryIcon level={p.live.battery.level} charging={p.live.battery.charging} className="ej-bat" />}
        </div>
        <h1 className="ej-title">{d.title}</h1>
        <dl className="ej-facts">
          <div>
            <dt>Esta sesión</dt>
            <dd>{dur(p.session)}</dd>
          </div>
          <div>
            <dt>En total</dt>
            <dd>{hoursLabel(p.total)}</dd>
          </div>
        </dl>
        <nav className="ej-nav">
          {secs.map((s) => (
            <button
              key={s.id}
              data-nav
              data-tab
              aria-selected={sec === s.id}
              className={cls("ej-nav-item", sec === s.id && "is-on")}
              onClick={() => {
                setSec(s.id);
                setViewer(null);
              }}
            >
              <span>{s.label}</span>
              <small>{s.info}</small>
            </button>
          ))}
        </nav>
        <div className="ej-rail-foot">
          <button data-nav className="ej-btn is-primary" onClick={p.actions.close}>
            Volver al juego
          </button>
          <button data-nav className="ej-btn" onClick={p.actions.launcher}>
            Abrir ejGames
          </button>
          <button data-nav className="ej-btn is-quiet" onClick={p.actions.askQuit}>
            Cerrar el juego
          </button>
          {pad && (
            <Hints
              className="ej-hints"
              items={[
                ["lb", "Secciones"],
                ["back", "Volver"],
              ]}
            />
          )}
        </div>
      </aside>

      <section className="ej-main" key={sec}>
        <header className="ej-main-head">
          <h2>{secs.find((s) => s.id === sec)!.label}</h2>
          {actions}
        </header>
        <div className={cls("ej-main-body", sec === "guides" && "is-guides")}>{body}</div>
        {viewer != null && <CaptureViewer k="ej" list={d.captures} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
      </section>
      <Message k="ej" p={p} />
      <QuitConfirm k="ej" p={p} />
    </div>
  );
}
