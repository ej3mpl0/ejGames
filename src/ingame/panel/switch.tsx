// Switch: un menú rápido a la derecha, claro u oscuro como la consola, con la
// fila de iconos redondos de colores del menú HOME y el borde cian que late.

import { useState, type CSSProperties, type ReactNode } from "react";
import { Activity, BookOpen, Download, Image as ImageIcon, Music2, NotebookPen, Power, Trophy } from "lucide-react";
import { GuidesPane } from "../../components/guide";
import { Hints } from "../../components/Hints";
import { useOverlayNav } from "../../input/nav";
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
import { BatteryIcon, clock, cls, dur, hoursLabel, Img } from "./parts";
import "./switch.css";

type Sec = "album" | "ach" | "guides" | "notes" | "music" | "system" | "dl";

const SECTIONS: { id: Sec; label: string; icon: ReactNode; color: string }[] = [
  { id: "album", label: "Álbum", icon: <ImageIcon />, color: "#2e9bf0" },
  { id: "ach", label: "Logros", icon: <Trophy />, color: "#f2a516" },
  { id: "guides", label: "Guías", icon: <BookOpen />, color: "#8c5ae8" },
  { id: "notes", label: "Notas", icon: <NotebookPen />, color: "#3cbf6a" },
  { id: "music", label: "Música", icon: <Music2 />, color: "#ef5c8e" },
  { id: "system", label: "Sistema", icon: <Activity />, color: "#8f8f95" },
  { id: "dl", label: "Descargas", icon: <Download />, color: "#f76e0b" },
];

function Achievements({ p }: { p: Panel }) {
  const [filter, setFilter] = useState<AchFilter>("all");
  if (!p.ach.total) return <NoAchievements k="sw" />;
  return (
    <>
      <div className="sw-ach-head">
        <span className="sw-ach-big">
          {p.ach.got}
          <small>/{p.ach.total}</small>
        </span>
        <div className="sw-meter">
          <i style={{ width: `${p.ach.pct}%` }} />
        </div>
      </div>
      <div className="sw-seg">
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
      <AchRows k="sw" list={achList(p, filter)} side={(a) => unlockText(a)} />
    </>
  );
}

export function SwitchPanel({ p }: { p: Panel }) {
  const [sec, setSec] = useState<Sec>(p.ach.total ? "ach" : "album");
  const [viewer, setViewer] = useState<number | null>(null);
  // Leyendo una guía, el menú se ensancha.
  const [reading, setReading] = useState(false);
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => (p.confirmQuit ? p.actions.cancelQuit() : viewer != null ? setViewer(null) : p.actions.close()),
    extra: { x: p.actions.screenshot, y: p.actions.launcher, menu: p.actions.close },
  });
  const d = p.data;
  const dark = d.look.dark;
  const style = d.look.accent ? ({ "--sw-accent": d.look.accent } as CSSProperties) : undefined;
  const current = SECTIONS.find((s) => s.id === sec)!;

  let body: ReactNode;
  switch (sec) {
    case "album":
      body = (
        <>
          <div className="sw-row-btns">
            <button data-nav className="sw-btn is-primary" onClick={p.actions.screenshot}>
              Hacer captura{d.screenshotHotkey ? ` (${keyLabel(d.screenshotHotkey)})` : ""}
            </button>
            <button data-nav className="sw-btn" onClick={p.actions.openCaptures}>
              Abrir carpeta
            </button>
          </div>
          <CaptureGrid k="sw" p={p} onOpen={setViewer} />
        </>
      );
      break;
    case "ach":
      body = <Achievements p={p} />;
      break;
    case "guides":
      body = (
        <div className="pn-guides">
          <GuidesPane gameId={d.gameId} onMenu={p.actions.close} onReading={setReading} />
        </div>
      );
      break;
    case "notes":
      body = <NotesEditor k="sw" p={p} />;
      break;
    case "music":
      body = (
        <>
          <NowPlaying k="sw" p={p} />
          <div className="sw-label">Volumen</div>
          <VolumeControls k="sw" p={p} gameLabel={d.title} masterLabel="Consola" />
        </>
      );
      break;
    case "system":
      body = <PerfTiles k="sw" p={p} />;
      break;
    case "dl":
      body = <DownloadList k="sw" p={p} />;
      break;
  }

  return (
    <div ref={ref} className={cls("pn-switch", dark && "is-dark")} style={style} onMouseDown={(e) => e.target === e.currentTarget && p.actions.close()}>
      <aside className={cls("sw-panel", sec === "guides" && "is-guides", sec === "guides" && reading && "is-reading")}>
        <header className="sw-top">
          <span className="sw-time">{clock(p.now)}</span>
          <span className="sw-status">
            {p.live.pad && <BatteryIcon level={p.live.pad.level} charging={p.live.pad.state === "charging"} className="sw-bat" />}
            {p.live.battery && (
              <>
                <BatteryIcon level={p.live.battery.level} charging={p.live.battery.charging} className="sw-bat" />
                {p.live.battery.level} %
              </>
            )}
          </span>
        </header>

        <div className="sw-game">
          <div className="sw-game-art">{p.art.cover ? <Img src={p.art.cover} /> : null}</div>
          <div className="sw-game-txt">
            <div className="sw-game-kicker">Jugando ahora</div>
            <div className="sw-game-title">{d.title}</div>
            <div className="sw-game-sub">
              {dur(p.session)} hoy · {hoursLabel(p.total)} en total
            </div>
          </div>
        </div>

        <nav className="sw-icons">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              data-nav
              data-tab
              aria-selected={sec === s.id}
              className={cls("sw-icon", sec === s.id && "is-on")}
              style={{ "--c": s.color } as CSSProperties}
              onClick={() => {
                setSec(s.id);
                setViewer(null);
              }}
            >
              <span className="sw-icon-disc">{s.icon}</span>
              <span className="sw-icon-label">{s.label}</span>
            </button>
          ))}
        </nav>

        <section className="sw-body">
          <h2 className="sw-title">{current.label}</h2>
          {body}
        </section>

        <div className="sw-bottom">
          <button data-nav className="sw-btn" onClick={p.actions.launcher}>
            Abrir ejGames
          </button>
          <button data-nav className="sw-btn is-power" onClick={p.actions.askQuit} aria-label="Cerrar el programa">
            <Power />
            Cerrar el programa
          </button>
        </div>
        <footer className="sw-hints">
          <Hints
            items={[
              ["back", "Volver"],
              ["accept", "OK"],
            ]}
          />
        </footer>
        {viewer != null && <CaptureViewer k="sw" list={d.captures} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
      </aside>
      <Message k="sw" p={p} />
      <QuitConfirm k="sw" p={p} />
    </div>
  );
}
