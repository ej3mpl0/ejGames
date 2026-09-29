// PlayStation: como el centro de control. El juego sigue visible arriba; abajo,
// una fila de tarjetas y otra de iconos redondos. Una tarjeta se abre en un
// panel a la derecha (como la de trofeos).

import { useRef, useState, type ReactNode } from "react";
import { Activity, BookOpen, Download, Gamepad2, Image as ImageIcon, MapIcon, Music2, NotebookPen, Power, Users, Volume2, WandSparkles } from "lucide-react";
import { GuidesPane } from "../../components/guide";
import { MapPane } from "../../components/map";
import { SocialPane } from "../../components/social";
import { TrainerPane } from "../../components/trainer";
import { Hints } from "../../components/Hints";
import { focusNav, useOverlayNav } from "../../input/nav";
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
  VolumeControls,
  type AchFilter,
} from "./blocks";
import type { Panel } from "./model";
import { BatteryIcon, clock, cls, CupIcon, downloadLine, dur, hoursLabel, Img, pctNum, shortDate } from "./parts";
import "./playstation.css";

type Sheet = "game" | "trophies" | "friends" | "help" | "cheats" | "map" | "shots" | "music" | "notes" | "perf" | "dl";

type Grade = "platinum" | "gold" | "silver" | "bronze";
const GRADES: Grade[] = ["platinum", "gold", "silver", "bronze"];
const GRADE_NAME: Record<Grade, string> = { platinum: "Platino", gold: "Oro", silver: "Plata", bronze: "Bronce" };

/** Grado del trofeo por rareza (como en los avisos). */
function grade(pct?: number | null): Grade {
  if (pct == null) return "bronze";
  return pct < 10 ? "gold" : pct < 35 ? "silver" : "bronze";
}

function Cup({ g, className }: { g: Grade; className?: string }) {
  return <CupIcon className={cls("ps5-cup", `g-${g}`, className)} />;
}

function gradeCounts(p: Panel) {
  const c: Record<Grade, number> = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
  for (const a of p.ach.unlocked) c[grade(a.globalPct)]++;
  if (p.ach.total > 0 && p.ach.got >= p.ach.total) c.platinum = 1;
  return c;
}

/** Al abrir un panel, el foco va a lo primero que tenga. */
const focusFirst = (el: HTMLElement | null) => {
  if (el) requestAnimationFrame(() => focusNav(el.querySelector<HTMLElement>("[data-nav]")));
};

function Card({ id, open, title, children, className }: { id: Sheet; open: (s: Sheet) => void; title: string; children: ReactNode; className?: string }) {
  return (
    <button data-nav className={cls("ps5-card", className)} onClick={() => open(id)}>
      <span className="ps5-card-title">{title}</span>
      {children}
    </button>
  );
}

function Trophies({ p }: { p: Panel }) {
  const [filter, setFilter] = useState<AchFilter>("all");
  if (!p.ach.total) return <NoAchievements k="ps5" />;
  const counts = gradeCounts(p);
  return (
    <>
      <div className="ps5-tro-head">
        <div className="ps5-tro-pct">{p.ach.pct} %</div>
        <div className="ps5-tro-bar">
          <i style={{ width: `${p.ach.pct}%` }} />
        </div>
        <div className="ps5-tro-counts">
          {GRADES.map((g) => (
            <span key={g} title={GRADE_NAME[g]}>
              <Cup g={g} /> {counts[g]}
            </span>
          ))}
        </div>
      </div>
      <div className="ps5-tabs">
        {(
          [
            ["all", "Todos"],
            ["unlocked", "Conseguidos"],
            ["locked", "Sin conseguir"],
          ] as [AchFilter, string][]
        ).map(([id, label]) => (
          <button key={id} data-nav className={cls("ps5-tab", filter === id && "is-on")} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <AchRows
        k="ps5"
        list={achList(p, filter)}
        side={(a) => (
          <span className="ps5-tro-side">
            <Cup g={grade(a.globalPct)} />
            <span>{a.unlockedAt ? shortDate(a.unlockedAt) : a.globalPct != null ? `${pctNum(a.globalPct)} %` : ""}</span>
          </span>
        )}
      />
    </>
  );
}

export function PlayStationPanel({ p }: { p: Panel }) {
  const [sheet, setSheetState] = useState<Sheet | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  // Al cerrar un panel, el foco vuelve a la tarjeta o el icono que lo abrió.
  const opener = useRef<HTMLElement | null>(null);
  const setSheet = (s: Sheet | null) => {
    if (s) opener.current = document.querySelector<HTMLElement>(".pn-ps5 .is-focused");
    else requestAnimationFrame(() => focusNav(opener.current));
    setSheetState(s);
  };
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => (p.confirmQuit ? p.actions.cancelQuit() : viewer != null ? setViewer(null) : sheet ? setSheet(null) : p.actions.close()),
    extra: { x: p.actions.screenshot, y: p.actions.launcher, menu: p.actions.close },
  });
  const d = p.data;
  const a = p.ach;
  const counts = gradeCounts(p);
  const dl = p.downloads.items[0];
  const noteLines = p.note.split("\n").filter((l) => l.trim()).slice(0, 4);
  const lastShot = d.captures[0];

  const SHEETS: Record<Sheet, { title: string; body: ReactNode }> = {
    game: {
      title: d.title,
      body: (
        <div className="ps5-game">
          <Img src={p.art.hero} className="ps5-game-art" />
          <dl className="ps5-facts">
            <dt>Esta sesión</dt>
            <dd>{dur(p.session)}</dd>
            <dt>Tiempo de juego</dt>
            <dd>{hoursLabel(p.total)}</dd>
            <dt>Partidas</dt>
            <dd>{d.launchCount}</dd>
            {d.developer && (
              <>
                <dt>Desarrollador</dt>
                <dd>{d.developer}</dd>
              </>
            )}
            {d.releaseYear && (
              <>
                <dt>Lanzamiento</dt>
                <dd>{d.releaseYear}</dd>
              </>
            )}
          </dl>
          <div className="ps5-sheet-actions">
            <button data-nav className="ps5-btn is-primary" onClick={p.actions.close}>
              Volver al juego
            </button>
            <button data-nav className="ps5-btn" onClick={p.actions.askQuit}>
              Cerrar el juego
            </button>
          </div>
        </div>
      ),
    },
    trophies: { title: "Trofeos", body: <Trophies p={p} /> },
    help: {
      title: "Ayuda del juego",
      body: (
        <div className="pn-guides">
          <GuidesPane gameId={d.gameId} onMenu={p.actions.close} />
        </div>
      ),
    },
    friends: {
      title: "Amigos",
      body: (
        <div className="pn-guides">
          <SocialPane inPanel layout="ps5" />
        </div>
      ),
    },
    cheats: {
      title: "Trucos",
      body: (
        <div className="pn-guides">
          <TrainerPane gameId={d.gameId} gameTitle={d.title} inGame />
        </div>
      ),
    },
    map: {
      title: "Mapa",
      body: (
        <div className="pn-guides">
          <MapPane gameId={d.gameId} gameTitle={d.title} inGame />
        </div>
      ),
    },
    shots: {
      title: "Capturas",
      body: (
        <>
          <div className="ps5-sheet-actions">
            <button data-nav className="ps5-btn is-primary" onClick={p.actions.screenshot}>
              Hacer captura{d.screenshotHotkey ? ` (${keyLabel(d.screenshotHotkey)})` : ""}
            </button>
            <button data-nav className="ps5-btn" onClick={p.actions.openCaptures}>
              Abrir la carpeta
            </button>
          </div>
          <CaptureGrid k="ps5" p={p} onOpen={setViewer} />
        </>
      ),
    },
    music: {
      title: "Música y sonido",
      body: (
        <>
          <NowPlaying k="ps5" p={p} />
          <div className="ps5-label">Volumen</div>
          <VolumeControls k="ps5" p={p} gameLabel={d.title} masterLabel="Sistema" />
        </>
      ),
    },
    notes: { title: "Notas del juego", body: <NotesEditor k="ps5" p={p} /> },
    perf: { title: "Rendimiento", body: <PerfTiles k="ps5" p={p} /> },
    dl: { title: "Descargas", body: <DownloadList k="ps5" p={p} /> },
  };

  const icon = (label: string, node: ReactNode, fn: () => void, extra?: string) => (
    <button data-nav className={cls("ps5-icon", extra)} onClick={fn} aria-label={label}>
      {node}
      <span className="ps5-icon-label">{label}</span>
    </button>
  );

  return (
    <div ref={ref} className="pn-ps5">
      <div className="ps5-shade" onMouseDown={() => (sheet ? setSheet(null) : p.actions.close())} />

      {sheet && (
        <section className={cls("ps5-sheet", (sheet === "help" || sheet === "cheats" || sheet === "map" || sheet === "friends") && "is-wide")} data-focus-trap key={sheet} ref={focusFirst}>
          <header className="ps5-sheet-head">
            <h2>{SHEETS[sheet].title}</h2>
            <Hints items={[["back", "Atrás"]]} />
          </header>
          <div className="ps5-sheet-body">{SHEETS[sheet].body}</div>
          {viewer != null && <CaptureViewer k="ps5" list={d.captures} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
        </section>
      )}

      <div className="ps5-center">
        <div className="ps5-cards">
          <Card id="game" open={setSheet} title="Juego actual" className="is-game">
            <Img src={p.art.hero} className="ps5-card-bg" />
            <span className="ps5-card-game">
              <span className="ps5-card-big">{d.title}</span>
              <span className="ps5-card-sub">
                {dur(p.session)} esta sesión · {hoursLabel(p.total)}
              </span>
            </span>
          </Card>
          <Card id="trophies" open={setSheet} title="Trofeos">
            {a.total ? (
              <>
                <span className="ps5-card-big">{a.pct} %</span>
                <span className="ps5-tro-bar">
                  <i style={{ width: `${a.pct}%` }} />
                </span>
                <span className="ps5-tro-counts">
                  {GRADES.map((g) => (
                    <span key={g}>
                      <Cup g={g} /> {counts[g]}
                    </span>
                  ))}
                </span>
              </>
            ) : (
              <span className="ps5-card-sub">Sin trofeos detectados</span>
            )}
          </Card>
          <Card id="help" open={setSheet} title="Ayuda del juego" className="is-help">
            <BookOpen className="ps5-card-icon" />
            <span className="ps5-card-sub is-bottom">Guías de la comunidad de Steam</span>
          </Card>
          <Card id="shots" open={setSheet} title="Capturas" className="is-shots">
            {lastShot ? <img src={lastShot.thumb} className="ps5-card-bg" alt="" draggable={false} /> : null}
            <span className="ps5-card-sub is-bottom">{d.captures.length ? `${d.captures.length} capturas` : "Ninguna todavía"}</span>
          </Card>
          <Card id="music" open={setSheet} title="Música">
            {p.media ? (
              <span className="ps5-card-music">
                {p.media.art ? <img src={p.media.art} alt="" draggable={false} /> : <Music2 />}
                <span>
                  <span className="ps5-card-line">{p.media.title}</span>
                  <span className="ps5-card-sub">{p.media.artist || p.media.app}</span>
                </span>
                <span className="ps5-card-play">
                  <PlayIcon playing={p.media.playing} />
                </span>
              </span>
            ) : (
              <span className="ps5-card-sub">No suena nada</span>
            )}
          </Card>
          <Card id="notes" open={setSheet} title="Notas">
            {noteLines.length ? (
              <span className="ps5-card-notes">
                {noteLines.map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </span>
            ) : (
              <span className="ps5-card-sub">Apunta lo que no quieras olvidar</span>
            )}
          </Card>
          {dl ? (
            <Card id="dl" open={setSheet} title="Descargas">
              <span className="ps5-card-line">{dl.title}</span>
              <span className="ps5-tro-bar">
                <i style={{ width: `${Math.floor(dl.progress * 100)}%` }} />
              </span>
              <span className="ps5-card-sub">{downloadLine(dl)}</span>
            </Card>
          ) : (
            <Card id="perf" open={setSheet} title="Rendimiento">
              <span className="ps5-card-perf">
                <span>
                  <b>{p.perf ? `${Math.round(p.perf.cpu)} %` : "—"}</b>CPU
                </span>
                <span>
                  <b>{p.perf?.gpu != null ? `${Math.round(p.perf.gpu)} %` : "—"}</b>GPU
                </span>
              </span>
            </Card>
          )}
        </div>

        <nav className="ps5-bar">
          <div className="ps5-icons">
            {icon("Abrir ejGames", <Gamepad2 />, p.actions.launcher)}
            {icon("Hacer captura", <ImageIcon />, p.actions.screenshot)}
            {icon("Amigos", <Users />, () => setSheet("friends"))}
            {icon("Ayuda del juego", <BookOpen />, () => setSheet("help"))}
            {icon("Trucos", <WandSparkles />, () => setSheet("cheats"))}
            {icon("Mapa", <MapIcon />, () => setSheet("map"))}
            {icon("Música", <Music2 />, () => setSheet("music"))}
            {icon("Sonido", <Volume2 />, () => setSheet("music"))}
            {icon("Notas", <NotebookPen />, () => setSheet("notes"))}
            {icon("Rendimiento", <Activity />, () => setSheet("perf"))}
            {icon("Descargas", <Download />, () => setSheet("dl"))}
            {icon("Cerrar el juego", <Power />, p.actions.askQuit, "is-power")}
          </div>
          <div className="ps5-clock">
            {p.live.pad && <BatteryIcon level={p.live.pad.level} charging={p.live.pad.state === "charging"} className="ps5-bat" />}
            {p.live.battery && <BatteryIcon level={p.live.battery.level} charging={p.live.battery.charging} className="ps5-bat" />}
            <span>{clock(p.now)}</span>
          </div>
        </nav>
      </div>
      <Message k="ps5" p={p} />
      <QuitConfirm k="ps5" p={p} />
    </div>
  );
}
