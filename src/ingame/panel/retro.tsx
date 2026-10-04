// Retro: la pausa de una recreativa. Marcador arriba, «PAUSA» parpadeando, un
// menú con cursor ▶ y cada opción en su propia pantalla. Paletas del tema.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GuidesPane } from "../../components/guide";
import { MapPane } from "../../components/map";
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
  QuitConfirm,
  VolumeControls,
  type AchFilter,
  SavesBlock,
} from "./blocks";
import type { Panel } from "./model";
import { clock, cls, CupIcon, hms, pctNum, shortDate } from "./parts";
import type { Achievement } from "../../api/types";
import "./retro.css";

type View = "menu" | "ach" | "guides" | "cheats" | "map" | "shots" | "notes" | "saves" | "music" | "system" | "dl";

/** El icono a 16 × 16 y ampliado sin suavizar, como un sprite. */
function Sprite({ a }: { a: Achievement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [broken, setBroken] = useState(false);
  const src = a.unlockedAt ? a.icon : a.iconGray || a.icon;
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => ref.current?.getContext("2d")?.drawImage(img, 0, 0, 16, 16);
    img.onerror = () => setBroken(true);
    img.src = src;
  }, [src]);
  if (!src || broken)
    return (
      <span className="rt-ach-icon ph">
        <CupIcon />
      </span>
    );
  return <canvas ref={ref} className="rt-ach-icon" width={16} height={16} />;
}

/** Barra de bloques: ▮▮▮▮▯▯▯▯ */
function Blocks({ value, of = 10 }: { value: number; of?: number }) {
  const n = Math.round(Math.max(0, Math.min(1, value)) * of);
  return (
    <span className="rt-blocks" aria-hidden="true">
      {"█".repeat(n)}
      <span>{"░".repeat(of - n)}</span>
    </span>
  );
}

const TITLES: Record<Exclude<View, "menu">, string> = {
  ach: "Logros",
  guides: "Guías",
  cheats: "Trucos",
  map: "Mapa",
  shots: "Álbum",
  saves: "Partidas",
  notes: "Notas",
  music: "Música",
  system: "Sistema",
  dl: "Descargas",
};

export function RetroPanel({ p }: { p: Panel }) {
  const [view, setViewState] = useState<View>("menu");
  const [filter, setFilter] = useState<AchFilter>("all");
  const [viewer, setViewer] = useState<number | null>(null);
  const last = useRef<string>("");
  const menuRef = useRef<HTMLDivElement>(null);
  const setView = (v: View) => {
    if (v !== "menu") last.current = view === "menu" ? v : last.current;
    setViewState(v);
  };
  // Al volver al menú, el cursor vuelve a la opción de la que se salió.
  useEffect(() => {
    if (view === "menu" && last.current) {
      requestAnimationFrame(() => focusNav(menuRef.current?.querySelector<HTMLElement>(`[data-v="${last.current}"]`) ?? null));
    } else if (view !== "menu") {
      requestAnimationFrame(() => focusNav(document.querySelector<HTMLElement>(".rt-screen [data-nav]")));
    }
  }, [view]);
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () =>
      p.confirmQuit ? p.actions.cancelQuit() : viewer != null ? setViewer(null) : view !== "menu" ? setView("menu") : p.actions.close(),
    extra: { x: p.actions.screenshot, y: p.actions.launcher, menu: p.actions.close },
  });
  const d = p.data;
  const pal = d.look.palette || "arcade";

  const item = (v: View | null, label: string, value: ReactNode, fn: () => void, extra?: string) => (
    <button data-nav data-v={v ?? label} className={cls("rt-item", extra)} onClick={fn}>
      <span className="rt-cursor">▶</span>
      <span className="rt-item-label">{label}</span>
      <span className="rt-item-value">{value}</span>
    </button>
  );

  let screen: ReactNode = null;
  switch (view) {
    case "ach":
      screen = p.ach.total ? (
        <>
          <div className="rt-tabs">
            {(
              [
                ["all", "Todos"],
                ["unlocked", "Hechos"],
                ["locked", "Faltan"],
              ] as [AchFilter, string][]
            ).map(([id, label]) => (
              <button key={id} data-nav className={cls("rt-tab", filter === id && "is-on")} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="rt-list">
            <AchRows
              k="rt"
              list={achList(p, filter)}
              icon={(a) => <Sprite a={a} />}
              side={(a) => (a.unlockedAt ? shortDate(a.unlockedAt) : a.globalPct != null ? `${pctNum(a.globalPct)}%` : "")}
            />
          </div>
        </>
      ) : (
        <NoAchievements k="rt" />
      );
      break;
    case "shots":
      screen = (
        <>
          <div className="rt-tabs">
            <button data-nav className="rt-tab is-on" onClick={p.actions.screenshot}>
              ● Capturar{d.screenshotHotkey ? ` [${keyLabel(d.screenshotHotkey)}]` : ""}
            </button>
            <button data-nav className="rt-tab" onClick={p.actions.openCaptures}>
              Abrir carpeta
            </button>
          </div>
          <div className="rt-list">
            <CaptureGrid k="rt" p={p} onOpen={setViewer} />
          </div>
        </>
      );
      break;
    case "guides":
      screen = (
        <div className="pn-guides">
          <GuidesPane gameId={d.gameId} onMenu={p.actions.close} />
        </div>
      );
      break;
    case "cheats":
      screen = (
        <div className="pn-guides">
          <TrainerPane gameId={d.gameId} gameTitle={d.title} inGame />
        </div>
      );
      break;
    case "map":
      screen = (
        <div className="pn-guides">
          <MapPane gameId={d.gameId} gameTitle={d.title} inGame />
        </div>
      );
      break;
    case "saves":
      screen = <SavesBlock k="rt" p={p} />;
      break;
    case "notes":
      screen = <NotesEditor k="rt" p={p} placeholder="ESCRIBE AQUÍ TUS PISTAS…" />;
      break;
    case "music":
      screen = (
        <>
          <NowPlaying k="rt" p={p} empty="SIN MÚSICA" />
          <VolumeControls k="rt" p={p} gameLabel="Juego" masterLabel="Sistema" />
        </>
      );
      break;
    case "system":
      screen = <PerfTiles k="rt" p={p} spark={false} />;
      break;
    case "dl":
      screen = <DownloadList k="rt" p={p} />;
      break;
  }

  return (
    <div ref={ref} className={cls("pn-retro", `pal-${pal}`)}>
      <div className="rt-crt" />
      <header className="rt-hud">
        <span>
          <b>1P</b> {hms(p.session)}
        </span>
        <span>
          <b>TOTAL</b> {Math.floor(p.total / 3600)}H {String(Math.floor((p.total % 3600) / 60)).padStart(2, "0")}M
        </span>
        <span>
          {p.live.pad?.level != null && (
            <>
              <b>PAD</b> <Blocks value={p.live.pad.level / 100} of={4} />{" "}
            </>
          )}
          {clock(p.now)}
        </span>
      </header>

      <main className={cls("rt-box", (view === "guides" || view === "cheats" || view === "map") && "is-guides")}>
        {view === "menu" ? (
          <div ref={menuRef} className="rt-menu">
            <div className="rt-game">{d.title}</div>
            <h1 className="rt-pause">PAUSA</h1>
            <div className="rt-items">
              {item(null, "Continuar", "", p.actions.close, "is-first")}
              {p.ach.total > 0 && item("ach", "Logros", `${p.ach.got}/${p.ach.total}`, () => setView("ach"))}
              {item("guides", "Guías", "", () => setView("guides"))}
              {item("cheats", "Trucos", "", () => setView("cheats"))}
              {item("map", "Mapa", "", () => setView("map"))}
              {item("shots", "Álbum", d.captures.length || "", () => setView("shots"))}
              {item("saves", "Partidas", "", () => setView("saves"))}
              {item("notes", "Notas", p.note.trim() ? "●" : "", () => setView("notes"))}
              {item("music", "Música", p.media ? (p.media.playing ? "♪" : "II") : "", () => setView("music"))}
              {item("system", "Sistema", p.perf ? `CPU ${Math.round(p.perf.cpu)}%` : "", () => setView("system"))}
              {p.downloads.items.length > 0 && item("dl", "Descargas", p.downloads.items.length, () => setView("dl"))}
              {item(null, "Salir a ejGames", "", p.actions.launcher)}
              {item(null, "Apagar juego", "", p.actions.askQuit, "is-danger")}
            </div>
            {p.ach.total > 0 && (
              <div className="rt-progress">
                <span>COMPLETADO</span> <Blocks value={p.ach.got / p.ach.total} of={16} /> <span>{p.ach.pct}%</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rt-screen">
            <h2 className="rt-screen-title">
              <span>{TITLES[view]}</span>
              {view === "ach" && (
                <span>
                  {p.ach.got}/{p.ach.total}
                </span>
              )}
            </h2>
            {screen}
            {viewer != null && <CaptureViewer k="rt" list={d.captures} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
          </div>
        )}
      </main>

      <footer className="rt-foot">
        <Hints
          items={[
            ["accept", "Elegir"],
            ["back", view === "menu" ? "Continuar" : "Volver"],
          ]}
        />
        <span className="rt-insert">INSERT COIN</span>
      </footer>
      <Message k="rt" p={p} />
      <QuitConfirm k="rt" p={p} />
    </div>
  );
}
