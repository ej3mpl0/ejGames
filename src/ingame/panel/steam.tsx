// Steam: como su overlay (Mayús+Tab). El juego se oscurece, arriba el nombre y
// el tiempo, en medio una ventana con la herramienta elegida y abajo la barra
// de herramientas. A la derecha, lo que suena y cómo va el PC.

import { useState, type ReactNode } from "react";
import { Activity, BookOpen, Download, Gamepad2, Image as ImageIcon, MapIcon, Music2, NotebookPen, Power, Trophy, Users, WandSparkles } from "lucide-react";
import { GuidesPane } from "../../components/guide";
import { MapPane } from "../../components/map";
import { SocialPane } from "../../components/social";
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
  rarityText,
  VolumeControls,
  type AchFilter,
} from "./blocks";
import type { Panel } from "./model";
import { BatteryIcon, clock, cls, dur, hoursLabel, Img, PadIcon, pctNum, shortDate } from "./parts";
import "./steam.css";

type Tab = "ach" | "friends" | "guides" | "trainer" | "map" | "shots" | "notes" | "music" | "perf" | "dl";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "ach", label: "Logros", icon: <Trophy /> },
  { id: "friends", label: "Amigos", icon: <Users /> },
  { id: "guides", label: "Guías", icon: <BookOpen /> },
  { id: "trainer", label: "Trucos", icon: <WandSparkles /> },
  { id: "map", label: "Mapa", icon: <MapIcon /> },
  { id: "shots", label: "Capturas", icon: <ImageIcon /> },
  { id: "notes", label: "Notas", icon: <NotebookPen /> },
  { id: "music", label: "Música", icon: <Music2 /> },
  { id: "perf", label: "Rendimiento", icon: <Activity /> },
  { id: "dl", label: "Descargas", icon: <Download /> },
];

function Window({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="sx-win">
      <header className="sx-win-bar">
        <span>{title}</span>
        {actions}
      </header>
      <div className="sx-win-body">{children}</div>
    </section>
  );
}

function Achievements({ p }: { p: Panel }) {
  const [filter, setFilter] = useState<AchFilter>("all");
  const a = p.ach;
  if (!a.total) return <NoAchievements k="sx" />;
  const list = achList(p, filter);
  return (
    <>
      <div className="sx-ach-head">
        <div className="sx-ach-count">
          Has desbloqueado <b>{a.got}</b> de <b>{a.total}</b> logros <span>({a.pct} %)</span>
        </div>
        <div className="sx-progress">
          <i style={{ width: `${a.pct}%` }} />
        </div>
        <div className="sx-seg" role="tablist">
          {(
            [
              ["all", "Todos"],
              ["unlocked", `Desbloqueados (${a.got})`],
              ["locked", `Por conseguir (${a.total - a.got})`],
            ] as [AchFilter, string][]
          ).map(([id, label]) => (
            <button key={id} data-nav className={cls(filter === id && "is-on")} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="sx-scroll">
        {filter === "all" && a.next.length > 0 && (
          <>
            <div className="sx-sub">Los siguientes más fáciles</div>
            <AchRows k="sx" list={a.next} side={(x) => <Rarity pct={x.globalPct} />} hiddenSummary={false} />
            <div className="sx-sub">Todos los logros</div>
          </>
        )}
        <AchRows
          k="sx"
          list={list}
          side={(x) =>
            x.unlockedAt ? <span className="sx-when">Desbloqueado el {shortDate(x.unlockedAt)}</span> : <Rarity pct={x.globalPct} />
          }
        />
      </div>
    </>
  );
}

/** Porcentaje de jugadores con su barrita, como en la página de logros de Steam. */
function Rarity({ pct }: { pct?: number | null }) {
  if (pct == null) return null;
  return (
    <span className="sx-rarity" title={rarityText({ globalPct: pct } as never)}>
      <span>{pctNum(pct)} %</span>
      <i>
        <b style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </i>
    </span>
  );
}

export function SteamPanel({ p }: { p: Panel }) {
  const [tab, setTab] = useState<Tab>(p.ach.total ? "ach" : "shots");
  const [viewer, setViewer] = useState<number | null>(null);
  const pad = useApp((s) => s.inputSource) === "gamepad";
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => (p.confirmQuit ? p.actions.cancelQuit() : viewer != null ? setViewer(null) : p.actions.close()),
    extra: { x: p.actions.screenshot, y: p.actions.launcher, menu: p.actions.close },
  });
  const d = p.data;
  const bat = p.live.battery;
  const padPower = p.live.pad;

  let body: ReactNode;
  switch (tab) {
    case "ach":
      body = (
        <Window title="Logros">
          <Achievements p={p} />
        </Window>
      );
      break;
    case "guides":
      body = (
        <Window title="Guías de la comunidad">
          <div className="pn-guides">
            <GuidesPane gameId={d.gameId} onMenu={p.actions.close} />
          </div>
        </Window>
      );
      break;
    case "friends":
      body = (
        <Window title="Amigos">
          <div className="pn-guides">
            <SocialPane inPanel layout="steam" />
          </div>
        </Window>
      );
      break;
    case "trainer":
      body = (
        <Window title="Trucos">
          <div className="pn-guides">
            <TrainerPane gameId={d.gameId} gameTitle={d.title} inGame />
          </div>
        </Window>
      );
      break;
    case "map":
      body = (
        <Window title="Mapa">
          <div className="pn-guides">
            <MapPane gameId={d.gameId} gameTitle={d.title} inGame />
          </div>
        </Window>
      );
      break;
    case "shots":
      body = (
        <Window
          title="Capturas"
          actions={
            <div className="sx-win-actions">
              <button data-nav className="sx-btn is-primary" onClick={p.actions.screenshot}>
                Hacer captura{d.screenshotHotkey ? ` (${keyLabel(d.screenshotHotkey)})` : ""}
              </button>
              <button data-nav className="sx-btn" onClick={p.actions.openCaptures}>
                Abrir carpeta
              </button>
            </div>
          }
        >
          <div className="sx-scroll">
            <CaptureGrid k="sx" p={p} onOpen={setViewer} />
          </div>
          {viewer != null && <CaptureViewer k="sx" list={d.captures} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
        </Window>
      );
      break;
    case "notes":
      body = (
        <Window title={`Notas · ${d.title}`}>
          <NotesEditor k="sx" p={p} />
        </Window>
      );
      break;
    case "music":
      body = (
        <Window title="Música y sonido">
          <NowPlaying k="sx" p={p} />
          <div className="sx-sub">Volumen</div>
          <VolumeControls k="sx" p={p} gameLabel={d.title} />
        </Window>
      );
      break;
    case "perf":
      body = (
        <Window title="Rendimiento">
          <PerfTiles k="sx" p={p} />
          <p className="sx-foot">Lo que gasta el juego ahora mismo. Los FPS no se pueden medir sin entrar en el juego.</p>
        </Window>
      );
      break;
    case "dl":
      body = (
        <Window title="Descargas">
          <div className="sx-scroll">
            <DownloadList k="sx" p={p} />
          </div>
        </Window>
      );
      break;
  }

  return (
    <div ref={ref} className="pn-steam">
      <header className="sx-top">
        <div className="sx-game">
          {p.art.icon ? <Img src={p.art.icon} className="sx-game-icon" /> : <Gamepad2 className="sx-game-icon ph" />}
          <div>
            <div className="sx-game-title">{d.title}</div>
            <div className="sx-game-sub">
              Sesión actual: {dur(p.session)} · {hoursLabel(p.total)} en total
            </div>
          </div>
        </div>
        <div className="sx-status">
          {padPower && (
            <span className="sx-stat" title={padPower.name}>
              <PadIcon className="sx-stat-pad" />
              <BatteryIcon level={padPower.level} charging={padPower.state === "charging"} className="sx-stat-bat" />
            </span>
          )}
          {bat && (
            <span className="sx-stat">
              <BatteryIcon level={bat.level} charging={bat.charging} className="sx-stat-bat" />
              {bat.level} %
            </span>
          )}
          <span className="sx-clock">{clock(p.now)}</span>
        </div>
      </header>

      <main className="sx-stage">
        <div className="sx-main">{body}</div>
        <aside className="sx-side">
          {p.media && (
            <section className="sx-widget">
              <div className="sx-widget-title">Sonando ahora</div>
              <NowPlaying k="sx" p={p} compact />
            </section>
          )}
          <section className="sx-widget">
            <div className="sx-widget-title">Este juego</div>
            {p.art.header && <Img src={p.art.header} className="sx-widget-art" />}
            <dl className="sx-facts">
              <dt>Logros</dt>
              <dd>{p.ach.total ? `${p.ach.got} / ${p.ach.total}` : "—"}</dd>
              <dt>Jugado</dt>
              <dd>{hoursLabel(p.total)}</dd>
              <dt>Procesador</dt>
              <dd>{p.perf ? `${Math.round(p.perf.cpu)} %` : "—"}</dd>
              <dt>Gráfica</dt>
              <dd>{p.perf?.gpu != null ? `${Math.round(p.perf.gpu)} %` : "—"}</dd>
            </dl>
          </section>
          {p.downloads.items.length > 0 && (
            <section className="sx-widget">
              <div className="sx-widget-title">Descargas</div>
              <DownloadList k="sx" p={p} compact />
            </section>
          )}
        </aside>
      </main>

      <nav className="sx-bar">
        <div className="sx-tabs">
          {TABS.map((t) => (
            <button key={t.id} data-nav data-tab aria-selected={tab === t.id} className={cls("sx-tab", tab === t.id && "is-on")} onClick={() => setTab(t.id)}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        {pad && (
          <Hints
            className="sx-hints"
            items={[
              ["lb", "Herramientas"],
              ["x", "Captura"],
              ["back", "Volver al juego"],
            ]}
          />
        )}
        <div className="sx-tabs">
          <button data-nav className="sx-tab" onClick={p.actions.launcher}>
            <Gamepad2 />
            <span>Abrir ejGames</span>
          </button>
          <button data-nav className="sx-tab is-quit" onClick={p.actions.askQuit}>
            <Power />
            <span>Cerrar juego</span>
          </button>
        </div>
      </nav>
      <Message k="sx" p={p} />
      <QuitConfirm k="sx" p={p} />
    </div>
  );
}
