// Xbox: como la Guía. Panel a la izquierda que entra deslizándose, pestañas de
// iconos arriba, listas de rectángulos y el foco blanco y grueso de la consola.

import { useState, type CSSProperties, type ReactNode } from "react";
import { Activity, BookOpen, Download, Gamepad2, House, Image as ImageIcon, MapIcon, Music2, NotebookPen, Trophy, WandSparkles } from "lucide-react";
import { GuidesPane } from "../../components/guide";
import { MapPane } from "../../components/map";
import { TrainerPane } from "../../components/trainer";
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
  VolumeControls,
  type AchFilter,
} from "./blocks";
import type { Panel } from "./model";
import { BatteryIcon, clock, cls, dur, hoursLabel, Img, PadIcon, pctNum, shortDate } from "./parts";
import "./xbox.css";

type Tab = "home" | "ach" | "guides" | "trainer" | "map" | "shots" | "media" | "notes" | "perf" | "dl";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Inicio", icon: <House /> },
  { id: "ach", label: "Logros", icon: <Trophy /> },
  { id: "guides", label: "Guías", icon: <BookOpen /> },
  { id: "trainer", label: "Trucos", icon: <WandSparkles /> },
  { id: "map", label: "Mapa", icon: <MapIcon /> },
  { id: "shots", label: "Capturas", icon: <ImageIcon /> },
  { id: "media", label: "Música y audio", icon: <Music2 /> },
  { id: "notes", label: "Notas", icon: <NotebookPen /> },
  { id: "perf", label: "Rendimiento", icon: <Activity /> },
  { id: "dl", label: "Descargas", icon: <Download /> },
];

/** La "G" de los puntos, en su círculo. */
const G = () => <span className="xb-g">G</span>;

function Home({ p, go }: { p: Panel; go: (t: Tab) => void }) {
  const a = p.ach;
  return (
    <div className="xb-home">
      <div className="xb-hero">
        <Img src={p.art.hero} className="xb-hero-art" />
        <div className="xb-hero-shade" />
        {p.art.logo ? <Img src={p.art.logo} className="xb-hero-logo" alt={p.data.title} /> : <div className="xb-hero-title">{p.data.title}</div>}
      </div>
      <div className="xb-stats">
        <button data-nav className="xb-stat" onClick={() => go("ach")}>
          <span className="xb-stat-label">Logros</span>
          <span className="xb-stat-value">{a.total ? `${a.got}/${a.total}` : "—"}</span>
        </button>
        <button data-nav className="xb-stat" onClick={() => go("ach")}>
          <span className="xb-stat-label">Puntuación</span>
          <span className="xb-stat-value">
            <G /> {a.total ? `${a.score}/${a.scoreTotal}` : "—"}
          </span>
        </button>
        <div data-nav tabIndex={-1} className="xb-stat">
          <span className="xb-stat-label">Tiempo de juego</span>
          <span className="xb-stat-value">{hoursLabel(p.total)}</span>
        </div>
      </div>
      {a.total > 0 && (
        <div className="xb-meter">
          <i style={{ width: `${a.pct}%` }} />
        </div>
      )}
      <div className="xb-actions">
        <button data-nav className="xb-action is-green" onClick={p.actions.close}>
          Volver al juego
        </button>
        <button data-nav className="xb-action" onClick={p.actions.screenshot}>
          Hacer captura{p.data.screenshotHotkey ? <span className="xb-key">{keyLabel(p.data.screenshotHotkey)}</span> : null}
        </button>
        <button data-nav className="xb-action" onClick={p.actions.launcher}>
          Abrir ejGames
        </button>
        <button data-nav className="xb-action" onClick={p.actions.askQuit}>
          Salir del juego
        </button>
      </div>
      {p.media && (
        <>
          <div className="xb-label">Reproduciendo</div>
          <NowPlaying k="xb" p={p} compact />
        </>
      )}
      {p.downloads.items.length > 0 && (
        <>
          <div className="xb-label">Cola</div>
          <DownloadList k="xb" p={p} compact />
        </>
      )}
    </div>
  );
}

function Achievements({ p }: { p: Panel }) {
  const [filter, setFilter] = useState<AchFilter>("locked");
  const a = p.ach;
  if (!a.total) return <NoAchievements k="xb" />;
  return (
    <>
      <div className="xb-ach-head">
        <div className="xb-ach-sum">
          <span>
            {a.got}/{a.total} logros
          </span>
          <span>
            <G /> {a.score}/{a.scoreTotal}
          </span>
        </div>
        <div className="xb-meter">
          <i style={{ width: `${a.pct}%` }} />
        </div>
        <div className="xb-pills">
          {(
            [
              ["locked", "Por conseguir"],
              ["unlocked", "Conseguidos"],
              ["all", "Todos"],
            ] as [AchFilter, string][]
          ).map(([id, label]) => (
            <button key={id} data-nav className={cls("xb-pill", filter === id && "is-on")} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <AchRows
        k="xb"
        list={achList(p, filter)}
        side={(x) => (
          <>
            {x.score != null && (
              <span className="xb-ach-score">
                <G /> {x.score}
              </span>
            )}
            <span className="xb-ach-when">{x.unlockedAt ? shortDate(x.unlockedAt) : x.globalPct != null ? `${pctNum(x.globalPct)} %` : ""}</span>
          </>
        )}
      />
    </>
  );
}

export function XboxPanel({ p }: { p: Panel }) {
  const [tab, setTab] = useState<Tab>("home");
  const [viewer, setViewer] = useState<number | null>(null);
  // Leyendo una guía, la Guía se ensancha.
  const [reading, setReading] = useState(false);
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => (p.confirmQuit ? p.actions.cancelQuit() : viewer != null ? setViewer(null) : tab !== "home" ? setTab("home") : p.actions.close()),
    extra: { x: p.actions.screenshot, y: p.actions.launcher, menu: p.actions.close },
  });
  const d = p.data;
  const style = d.look.accent ? ({ "--xb-accent": d.look.accent } as CSSProperties) : undefined;
  const current = TABS.find((t) => t.id === tab)!;

  let body: ReactNode;
  switch (tab) {
    case "home":
      body = <Home p={p} go={setTab} />;
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
    case "trainer":
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
    case "shots":
      body = (
        <>
          <div className="xb-row-btns">
            <button data-nav className="xb-action is-green" onClick={p.actions.screenshot}>
              Hacer captura
            </button>
            <button data-nav className="xb-action" onClick={p.actions.openCaptures}>
              Abrir carpeta
            </button>
          </div>
          <CaptureGrid k="xb" p={p} onOpen={setViewer} />
        </>
      );
      break;
    case "media":
      body = (
        <>
          <NowPlaying k="xb" p={p} />
          <div className="xb-label">Volumen</div>
          <VolumeControls k="xb" p={p} gameLabel={d.title} masterLabel="Volumen del sistema" />
        </>
      );
      break;
    case "notes":
      body = <NotesEditor k="xb" p={p} />;
      break;
    case "perf":
      body = <PerfTiles k="xb" p={p} />;
      break;
    case "dl":
      body = <DownloadList k="xb" p={p} />;
      break;
  }

  return (
    <div ref={ref} className="pn-xbox" style={style} onMouseDown={(e) => e.target === e.currentTarget && p.actions.close()}>
      <aside className={cls("xb-guide", (tab === "guides" || tab === "trainer" || tab === "map") && "is-guides", ((tab === "guides" && reading) || tab === "map") && "is-reading")}>
        <header className="xb-top">
          <div className="xb-me">
            {p.art.icon ? <Img src={p.art.icon} className="xb-me-pic" /> : <Gamepad2 className="xb-me-pic ph" />}
            <div className="xb-me-txt">
              <div className="xb-me-name">{d.title}</div>
              <div className="xb-me-sub">En partida · {dur(p.session)}</div>
            </div>
          </div>
          <div className="xb-sys">
            {p.live.pad && (
              <span className="xb-sys-pad" title={p.live.pad.name}>
                <PadIcon />
                <BatteryIcon level={p.live.pad.level} charging={p.live.pad.state === "charging"} />
              </span>
            )}
            {p.live.battery && <BatteryIcon level={p.live.battery.level} charging={p.live.battery.charging} className="xb-sys-bat" />}
            <span>{clock(p.now)}</span>
          </div>
        </header>
        <nav className="xb-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-nav
              data-tab
              aria-selected={tab === t.id}
              aria-label={t.label}
              className={cls("xb-tab", tab === t.id && "is-on")}
              onClick={() => {
                setTab(t.id);
                setViewer(null);
              }}
            >
              {t.icon}
            </button>
          ))}
        </nav>
        <h2 className="xb-title">{current.label}</h2>
        <div className="xb-body">{body}</div>
        <footer className="xb-foot">
          <Hints
            items={[
              ["accept", "Seleccionar"],
              ["back", tab === "home" ? "Volver al juego" : "Atrás"],
              ["lb", "Pestañas"],
            ]}
          />
        </footer>
        {viewer != null && <CaptureViewer k="xb" list={d.captures} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
      </aside>
      <Message k="xb" p={p} />
      <QuitConfirm k="xb" p={p} />
    </div>
  );
}
