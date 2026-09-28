// Trucos con los trainers de FLiNG, en React. Los usan la ventana del host
// (buscar, instalar y gestionar el trainer de un juego) y los paneles del
// overlay (activar opciones durante la partida). Visten con las mismas
// variables que las guías (--gd-*), así que cada panel ya les da su aspecto.
//
// Nada se descarga sin confirmar: antes de instalar se enseña de dónde viene,
// cuánto pesa, para qué versión del juego es y los avisos (antivirus, online).

import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errMsg } from "../api/tauri";
import type { TrainerCandidate, TrainerDownload, TrainerFound, TrainerInstalled, TrainerLive, TrainerOption, TrainerPage } from "../api/types";
import { openKeyboard } from "../host/downloads";
import { useApp } from "../store/app";
import "./guide.css";
import "./tools.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const NO_LIVE: TrainerLive = { state: "none", on: [], visible: false, elevated: false };

/** Estado del trainer durante la partida (lo manda el núcleo con `trainer:state`). */
export function useTrainerLive(enabled = true) {
  const [live, setLive] = useState<TrainerLive>(NO_LIVE);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void api.trainerStatus().then((s) => alive && setLive(s)).catch(() => {});
    const un = listen<TrainerLive>("trainer:state", (e) => alive && setLive(e.payload));
    return () => {
      alive = false;
      void un.then((u) => u());
    };
  }, [enabled]);
  return [live, setLive] as const;
}

/** Opciones agrupadas como en la ficha ("Edit Player Stats"…). */
function grouped(options: TrainerOption[]) {
  const out: { group: string | null; items: TrainerOption[] }[] = [];
  for (const o of options) {
    const g = o.group ?? null;
    const last = out[out.length - 1];
    if (last && last.group === g) last.items.push(o);
    else out.push({ group: g, items: [o] });
  }
  return out;
}

function kb(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

const STATE_TEXT: Record<TrainerLive["state"], string> = {
  none: "Sin trainer",
  idle: "Listo para abrir",
  waiting: "Esperando a que el juego cargue…",
  starting: "Abriendo el trainer…",
  running: "Activo",
  stopped: "Cerrado",
  error: "No se pudo abrir",
};

function Keys({ k }: { k: string }) {
  return (
    <span className="tt-keys">
      {k.split(/\+(?!$)/).map((p, i) => (
        <kbd key={i}>{p}</kbd>
      ))}
    </span>
  );
}

// ─────────── buscar e instalar ───────────

function Warnings({ page }: { page: Pick<TrainerPage, "anticheat"> }) {
  return (
    <ul className="tt-warn">
      {page.anticheat && (
        <li className="is-strong">
          Este juego usa {page.anticheat === "antitrampas" ? "un antitrampas" : page.anticheat}. Úsalo solo sin conexión: en partidas online puede
          acabar en un baneo. Lee las notas del autor.
        </li>
      )}
      <li>Es un programa de terceros que cambia la memoria del juego mientras juegas. Úsalo en partidas de un jugador.</li>
      <li>Los antivirus suelen marcar los trainers como amenaza (es habitual en este tipo de programas). Si Windows Defender lo bloquea, tú decides si permitirlo.</li>
      <li>ejGames lo abre sin permisos de administrador al empezar la partida, lo esconde y lo cierra al salir del juego.</li>
    </ul>
  );
}

function OptionPreview({ options }: { options: TrainerOption[] }) {
  return (
    <div className="tt-preview">
      {grouped(options).map((g, i) => (
        <div key={i} className="tt-group">
          {g.group && <div className="gd-sub">{g.group}</div>}
          {g.items.map((o) => (
            <div key={o.keys} className="tt-prow">
              <span>{o.label}</span>
              <Keys k={o.keys} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Finder({ gameId, gameTitle, onInstalled, onCancel }: { gameId: number; gameTitle: string; onInstalled: (t: TrainerInstalled) => void; onCancel?: () => void }) {
  const [query, setQuery] = useState<string | null>(null);
  const [found, setFound] = useState<TrainerFound | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<TrainerCandidate | null>(null);
  const [page, setPage] = useState<TrainerPage | null>(null);
  const [dl, setDl] = useState<TrainerDownload | null>(null);
  const [installing, setInstalling] = useState(false);
  const pad = useApp((s) => s.inputSource) === "gamepad";

  const search = async (q: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const f = await api.trainerFind(gameId, q ?? undefined);
      setFound(f);
      // Si el primero coincide de verdad, directo a su ficha.
      if (!q && f.candidates[0] && f.candidates[0].score >= 0.95) void open(f.candidates[0]);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void search(null);
  }, [gameId]);

  const open = async (c: TrainerCandidate) => {
    setPick(c);
    setPage(null);
    setDl(null);
    setError(null);
    try {
      const p = await api.trainerDetails(c.url);
      setPage(p);
      setDl(p.downloads[0] ?? null);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const install = async () => {
    if (!page || !dl) return;
    setInstalling(true);
    setError(null);
    try {
      onInstalled(await api.trainerInstall(gameId, page.url, dl.url));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setInstalling(false);
    }
  };

  const typeQuery = async () => {
    const q = await openKeyboard({ title: "Buscar trainer", placeholder: "Nombre del juego", value: query ?? gameTitle, maxLength: 80 });
    if (q && q.trim()) {
      setQuery(q.trim());
      setPick(null);
      void search(q.trim());
    }
  };

  if (pick) {
    return (
      <div className="tt-detail">
        <div className="tt-head">
          <button data-nav className="gd-chip" onClick={() => (setPick(null), setPage(null))}>
            ‹ Otros resultados
          </button>
          <div className="tt-title">
            <b>{pick.title}</b>
            <small>Trainer de FLiNG · flingtrainer.com</small>
          </div>
        </div>
        {!page && !error && <div className="gd-loading">Leyendo la ficha del trainer…</div>}
        {page && (
          <>
            <div className="tt-facts">
              <span>{page.options.length} opciones</span>
              {page.gameVersion && <span>Versión del juego: {page.gameVersion}</span>}
              {page.updated && <span>Actualizado: {page.updated}</span>}
            </div>
            {page.downloads.length > 1 && (
              <>
                <div className="gd-sub">Versión del trainer</div>
                <div className="tt-chips">
                  {page.downloads.map((d, i) => (
                    <button key={d.url} data-nav className={cx("gd-chip", dl?.url === d.url && "is-on")} onClick={() => setDl(d)}>
                      {i === 0 ? "La más reciente" : d.date.slice(0, 10)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {page.options.length > 0 ? (
              <>
                <div className="gd-sub">Opciones</div>
                <OptionPreview options={page.options} />
              </>
            ) : (
              <div className="gd-empty">ejGames no ha sabido leer las opciones de este trainer. Podrás usarlo con sus teclas.</div>
            )}
            {page.notes.length > 0 && (
              <>
                <div className="gd-sub">Notas del autor</div>
                <div className="tt-notes">
                  {page.notes.map((n, i) => (
                    <p key={i}>{n}</p>
                  ))}
                </div>
              </>
            )}
            {dl ? (
              <div className="tt-confirm">
                <p>
                  Vas a descargar <b>{dl.name}</b>
                  {dl.size ? ` (${dl.size})` : ""} de flingtrainer.com.
                </p>
                <Warnings page={page} />
                <div className="tt-actions">
                  <button data-nav data-autofocus className="gd-chip is-primary" disabled={installing} onClick={() => void install()}>
                    {installing ? "Descargando…" : "Instalar trainer"}
                  </button>
                  <button data-nav className="gd-chip" onClick={() => void api.openExternal(page.url).catch(() => {})}>
                    Ver en la web
                  </button>
                </div>
              </div>
            ) : (
              <div className="gd-empty">Esta ficha no tiene descargas.</div>
            )}
          </>
        )}
        {error && <div className="tt-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="tt-finder">
      <div className="tt-head">
        <div className="tt-title">
          <b>Trucos para {gameTitle}</b>
          <small>Trainers de FLiNG para juegos de un jugador</small>
        </div>
        {onCancel && (
          <button data-nav className="gd-chip" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
      <div className="gd-filters">
        {pad ? (
          <button data-nav className="gd-search" onClick={() => void typeQuery()}>
            <span>{query ?? gameTitle}</span>
          </button>
        ) : (
          <label className="gd-search">
            <input
              data-nav
              defaultValue={query ?? gameTitle}
              placeholder="Nombre del juego"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const q = (e.target as HTMLInputElement).value.trim();
                  if (q) {
                    setQuery(q);
                    void search(q);
                  }
                }
              }}
            />
          </label>
        )}
      </div>
      {busy && <div className="gd-loading">Buscando en flingtrainer.com…</div>}
      {error && <div className="tt-error">{error}</div>}
      {!busy && found && found.candidates.length === 0 && (
        <div className="gd-empty">No hay trainers de FLiNG con «{found.query}». Prueba con otro nombre (en inglés, sin la edición).</div>
      )}
      {!busy && found && found.candidates.length > 0 && (
        <div className="gd-rows">
          {found.candidates.map((c, i) => (
            <button key={c.url} data-nav data-autofocus={i === 0 ? "" : undefined} className="gd-row" onClick={() => void open(c)}>
              <div className="gd-row-main">
                <div className="gd-row-title">
                  {c.title}
                  {c.score >= 0.95 && <span className="gd-lang">Este juego</span>}
                </div>
                <div className="gd-row-sub">Actualizado el {c.updated}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────── instalado ───────────

function OptionRow({ o, live, inGame, onTrigger }: { o: TrainerOption; live: TrainerLive; inGame: boolean; onTrigger: (o: TrainerOption) => void }) {
  const running = inGame && live.state === "running";
  const on = live.on.includes(o.keys);
  if (!inGame) {
    return (
      <div className="tt-prow">
        <span>{o.label}</span>
        <Keys k={o.keys} />
      </div>
    );
  }
  return (
    <button
      data-nav
      disabled={!running}
      className={cx("tt-opt", `is-${o.kind}`, on && "is-on")}
      aria-pressed={o.kind === "action" ? undefined : on}
      onClick={() => onTrigger(o)}
    >
      <span className="tt-switch" aria-hidden>
        {o.kind === "action" ? "▶" : <i />}
      </span>
      <span className="tt-opt-main">
        <span className="tt-opt-label">{o.label}</span>
        {o.kind === "value" && <small>El valor se cambia en la ventana del trainer</small>}
      </span>
      <Keys k={o.keys} />
    </button>
  );
}

export function TrainerPane({ gameId, gameTitle, inGame = false }: { gameId: number; gameTitle: string; inGame?: boolean }) {
  const [info, setInfo] = useState<TrainerInstalled | null | undefined>(undefined);
  const [finding, setFinding] = useState(false);
  const [live, setLive] = useTrainerLive(inGame);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = () =>
    api
      .trainerInfo(gameId)
      .then(setInfo)
      .catch((e) => (setInfo(null), setMsg(errMsg(e))));
  useEffect(() => {
    void load();
  }, [gameId]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);

  const run = (p: Promise<TrainerLive | void>) =>
    void p
      .then((s) => {
        if (s) setLive(s);
      })
      .catch((e) => setMsg(errMsg(e)));

  const trigger = (o: TrainerOption) => {
    // Alt+Num escribiría caracteres en un campo con el foco.
    (document.activeElement as HTMLElement | null)?.blur?.();
    run(api.trainerTrigger(o.keys));
  };

  const groups = useMemo(() => (info ? grouped(info.options) : []), [info]);
  const thisGame = !inGame || live.gameId === gameId;

  if (info === undefined) return <div className="gd-pane tt-pane"><div className="gd-loading">Cargando…</div></div>;

  if (!info || finding) {
    return (
      <div className="gd-pane tt-pane">
        <div className="gd-pane-list">
          <Finder
            gameId={gameId}
            gameTitle={gameTitle}
            onCancel={info ? () => setFinding(false) : undefined}
            onInstalled={(t) => {
              setInfo(t);
              setFinding(false);
              setMsg(inGame ? "Trainer instalado. Ábrelo desde aquí." : "Trainer instalado: se abrirá solo al jugar.");
            }}
          />
        </div>
        {msg && <div className="tt-toast">{msg}</div>}
      </div>
    );
  }

  const state = thisGame ? live.state : "idle";
  return (
    <div className="gd-pane tt-pane">
      <div className="gd-pane-list">
        <div className="tt-head">
          <div className="tt-title">
            <b>{info.title || gameTitle}</b>
            <small>
              {info.options.length} opciones
              {info.gameVersion ? ` · juego ${info.gameVersion}` : ""} · FLiNG · {kb(info.size)}
            </small>
          </div>
          {inGame && (
            <span className={cx("tt-state", `is-${state}`)}>
              <i />
              {STATE_TEXT[state]}
            </span>
          )}
        </div>

        {!info.present && (
          <div className="tt-error">
            No se encuentra el archivo del trainer. Windows Defender puede haberlo puesto en cuarentena: restáuralo desde Seguridad de Windows o vuelve a
            instalarlo.
          </div>
        )}
        {inGame && live.message && <div className="tt-note">{live.message}</div>}
        {info.anticheat && <div className="tt-note">Este juego usa {info.anticheat}: el trainer solo es para jugar sin conexión.</div>}

        <div className="tt-actions">
          {inGame && (state === "idle" || state === "stopped" || state === "error" || state === "waiting") && (
            <button data-nav data-autofocus className="gd-chip is-primary" onClick={() => run(api.trainerStart(gameId))}>
              {state === "stopped" || state === "error" ? "Volver a abrir" : "Abrir ahora"}
            </button>
          )}
          {inGame && state === "running" && !live.elevated && (
            <button data-nav className="gd-chip" onClick={() => run(api.trainerShow(!live.visible))}>
              {live.visible ? "Ocultar el trainer" : "Ver la ventana del trainer"}
            </button>
          )}
          {inGame && state === "running" && live.on.length > 0 && (
            <button data-nav className="gd-chip" title="Si el trainer y ejGames no coinciden" onClick={() => run(api.trainerReset())}>
              Desmarcar todo
            </button>
          )}
          <button
            data-nav
            className={cx("gd-chip", info.autoStart && "is-on")}
            aria-pressed={info.autoStart}
            onClick={() => {
              const on = !info.autoStart;
              setInfo({ ...info, autoStart: on });
              run(api.trainerAuto(gameId, on));
            }}
          >
            {info.autoStart ? "✓ " : ""}Abrir con el juego
          </button>
        </div>

        {inGame && state === "running" && <div className="tt-hint">Actívalas aquí o con sus teclas en el juego. ejGames recuerda lo que activas desde aquí.</div>}
        {!inGame && <div className="tt-hint">Durante la partida, actívalas desde el overlay (pestaña Trucos) o con sus teclas.</div>}

        <div className={cx("tt-opts", !inGame && "tt-preview")}>
          {groups.map((g, i) => (
            <div key={i} className="tt-group">
              {g.group && <div className="gd-sub">{g.group}</div>}
              {g.items.map((o) => (
                <OptionRow key={o.keys} o={o} live={thisGame ? live : NO_LIVE} inGame={inGame} onTrigger={trigger} />
              ))}
            </div>
          ))}
        </div>

        {info.notes.length > 0 && (
          <>
            <div className="gd-sub">Notas del autor</div>
            <div className="tt-notes">
              {info.notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          </>
        )}

        <div className="tt-actions is-foot">
          <button data-nav className="gd-chip" onClick={() => setFinding(true)}>
            Otra versión
          </button>
          <button data-nav className="gd-chip" onClick={() => void api.openExternal(info.pageUrl).catch(() => {})}>
            Ver en la web
          </button>
          {confirmRemove ? (
            <>
              <button
                data-nav
                className="gd-chip is-danger"
                onClick={() => {
                  setConfirmRemove(false);
                  void api
                    .trainerRemove(gameId)
                    .then(() => setInfo(null))
                    .catch((e) => setMsg(errMsg(e)));
                }}
              >
                Sí, quitarlo
              </button>
              <button data-nav className="gd-chip" onClick={() => setConfirmRemove(false)}>
                No
              </button>
            </>
          ) : (
            <button data-nav className="gd-chip" onClick={() => setConfirmRemove(true)}>
              Quitar trainer
            </button>
          )}
        </div>
      </div>
      {msg && <div className="tt-toast">{msg}</div>}
    </div>
  );
}
