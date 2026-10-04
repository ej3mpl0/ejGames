// Estadísticas del perfil: una cifra principal, tarjetas y gráficos de una
// sola serie (color de acento, marcas finas, tooltip al pasar, vista tabla).

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { Stats } from "../api/types";
import { Button, Cycle, Modal, Spinner, cx } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { hours, playtime, relative } from "../lib/format";
import { useApp } from "../store/app";
import { locale, t } from "../lib/i18n";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Columnas de una serie. Valores en horas. */
function Columns({ data, height = 180, label }: { data: { key: string; label: string; value: number; tip: string }[]; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Por debajo de una hora, el eje va en minutos (si no, todo serían "0.1 h").
  const peak = Math.max(...data.map((d) => d.value), 0);
  const minutes = peak < 1;
  const scale = minutes ? 60 : 1;
  const max = niceMax(Math.max(peak * scale, minutes ? 5 : 1)) / scale;
  const ticks = [0, max / 2, max];
  const fmt = (h: number) =>
    minutes ? `${Math.round(h * 60)} min` : h >= 10 || h === 0 || Number.isInteger(h) ? `${Math.round(h)} h` : `${h.toFixed(1)} h`;
  return (
    <figure className="relative" aria-label={label}>
      <div className="flex" style={{ height }}>
        <div className="relative w-10 shrink-0 text-right text-[11px] text-muted">
          {ticks.map((t) => (
            <span key={t} className="absolute right-2 -translate-y-1/2 tabular-nums" style={{ top: `${100 - (t / max) * 100}%` }}>
              {fmt(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-line" style={{ top: `${100 - (t / max) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
            {data.map((d, i) => (
              <div
                key={d.key}
                className="flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setHover(i)}
              >
                <div
                  className={cx("w-full max-w-6 rounded-t-[4px] bg-accent transition-opacity", hover !== null && hover !== i && "opacity-45")}
                  style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-black/85 px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${((hover + 0.5) / data.length) * 100}%`, top: `${100 - (data[hover].value / max) * 100}%`, marginTop: -6 }}
            >
              <div className="text-muted">{data[hover].label}</div>
              <div className="font-medium text-fg">{data[hover].tip}</div>
            </div>
          )}
        </div>
      </div>
      <div className="ml-10 mt-1.5 flex gap-[2px] text-[10px] text-muted">
        {data.map((d, i) => (
          <span key={d.key} className="flex-1 truncate text-center">
            {data.length <= 12 || i % Math.ceil(data.length / 10) === 0 ? d.label : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Barras horizontales con etiqueta a la izquierda y valor en la punta. */
function Bars({ rows }: { rows: { key: string; label: string; value: number; text: string; sub?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,14rem)_1fr] items-center gap-4" title={`${r.label}: ${r.text}`}>
          <div className="min-w-0">
            <div className="truncate text-sm">{r.label}</div>
            {r.sub && <div className="truncate text-[11px] text-muted">{r.sub}</div>}
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3.5 rounded-r-[4px] bg-accent" style={{ width: `${Math.max((r.value / max) * 85, 0.8)}%` }} />
            <span className="shrink-0 text-xs tabular-nums text-muted">{r.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[var(--h-radius)] bg-surface-2/80 p-4 ring-1 ring-line">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function StatsOverlay({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState("30");
  const [s, setS] = useState<Stats | null>(null);
  const [table, setTable] = useState(false);
  const toast = useApp((x) => x.toast);
  const profile = useApp((x) => x.profile);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });

  useEffect(() => {
    api.getStats(Number(days)).then(setS).catch((e) => toast("error", errMsg(e)));
  }, [days]);

  const daily = useMemo(
    () =>
      (s?.byDay ?? []).map((d) => {
        const date = new Date(d.day + "T12:00:00");
        return {
          key: d.day,
          label: date.toLocaleDateString(locale(), { day: "numeric", month: "short" }),
          value: d.seconds / 3600,
          tip: playtime(d.seconds, "0 min"),
        };
      }),
    [s],
  );

  return (
    <Modal ref={ref} title={`Estadísticas de ${profile?.name ?? ""}`} onClose={onClose} width="min(1180px, 95vw)" height="min(820px, 92vh)"
      headerExtra={
        <div className="flex items-center gap-2">
          <div className="w-72">
            <Cycle label="" value={days} onChange={setDays} options={[{ value: "7", label: "Últimos 7 días" }, { value: "30", label: "Últimos 30 días" }, { value: "90", label: "Últimos 90 días" }, { value: "365", label: "Último año" }]} />
          </div>
          <Button size="sm" variant="ghost" onClick={() => useApp.getState().open("year-review", {})}>
            {t("Tu año")}
          </Button>
          <Button size="sm" variant="ghost" icon={table ? <BarChart3 size={14} /> : <Table2 size={14} />} onClick={() => setTable(!table)}>
            {table ? "Gráficos" : "Tabla"}
          </Button>
        </div>
      }
    >
      {!s ? (
        <div className="grid h-full place-items-center">
          <Spinner size={28} />
        </div>
      ) : (
        <div className="h-full overflow-y-auto p-6">
          <div className="mb-6 flex items-end gap-10">
            <div>
              <div className="text-sm text-muted">Tiempo total jugado</div>
              <div className="text-6xl font-semibold tracking-tight">{hours(s.totalSeconds)}</div>
            </div>
            <div className="grid flex-1 grid-cols-3 gap-3 xl:grid-cols-6">
              <Tile label="Juegos jugados" value={`${s.gamesPlayed}`} sub={`de ${s.librarySize}`} />
              <Tile label="Sesiones" value={`${s.sessions}`} />
              <Tile label="Media por sesión" value={playtime(s.avgSession, "—")} />
              <Tile label="Sesión más larga" value={playtime(s.longestSession, "—")} />
              <Tile label="Racha actual" value={`${s.currentStreak} d`} />
              <Tile label="Mejor racha" value={`${s.bestStreak} d`} />
            </div>
          </div>

          {table ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">Día</th>
                  <th className="py-2 text-right font-medium">Tiempo</th>
                </tr>
              </thead>
              <tbody>
                {[...daily].reverse().map((d) => (
                  <tr key={d.key} className="border-t border-line">
                    <td className="py-1.5">{d.key}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.tip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <section className="mb-6 rounded-[var(--h-radius)] bg-surface-2/60 p-5 ring-1 ring-line">
                <h3 className="mb-4 text-sm font-semibold">Horas por día</h3>
                {s.trackedSeconds === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">Aún no hay partidas registradas con ejGames. ¡Lanza un juego!</p>
                ) : (
                  <Columns data={daily} label="Horas jugadas por día" />
                )}
              </section>

              <div className="mb-6 grid grid-cols-2 gap-6">
                <section className="rounded-[var(--h-radius)] bg-surface-2/60 p-5 ring-1 ring-line">
                  <h3 className="mb-4 text-sm font-semibold">Por día de la semana</h3>
                  <Columns
                    height={130}
                    label="Horas por día de la semana"
                    data={s.byWeekday.map((v, i) => ({ key: String(i), label: WEEKDAYS[i], value: v / 3600, tip: playtime(v, "0 min") }))}
                  />
                </section>
                <section className="rounded-[var(--h-radius)] bg-surface-2/60 p-5 ring-1 ring-line">
                  <h3 className="mb-4 text-sm font-semibold">Por hora del día</h3>
                  <Columns
                    height={130}
                    label="Horas por hora del día"
                    data={s.byHour.map((v, i) => ({ key: String(i), label: `${i}h`, value: v / 3600, tip: `${i}:00 · ${playtime(v, "0 min")}` }))}
                  />
                </section>
              </div>
            </>
          )}

          <div className="grid grid-cols-5 gap-6">
            <section className="col-span-3 rounded-[var(--h-radius)] bg-surface-2/60 p-5 ring-1 ring-line">
              <h3 className="mb-4 text-sm font-semibold">Más jugados</h3>
              {s.topGames.length === 0 ? (
                <p className="text-sm text-muted">Sin datos todavía.</p>
              ) : (
                <Bars
                  rows={s.topGames.slice(0, 10).map((g) => ({
                    key: String(g.gameId),
                    label: g.title,
                    value: g.seconds,
                    text: hours(g.seconds),
                    sub: `${g.sessions} sesiones · ${relative(g.lastPlayed)}`,
                  }))}
                />
              )}
            </section>
            <section className="col-span-2 rounded-[var(--h-radius)] bg-surface-2/60 p-5 ring-1 ring-line">
              <h3 className="mb-4 text-sm font-semibold">Géneros</h3>
              {s.byGenre.length === 0 ? (
                <p className="text-sm text-muted">Sin datos todavía.</p>
              ) : (
                <Bars rows={s.byGenre.map(([g, v]) => ({ key: g, label: g, value: v, text: hours(v) }))} />
              )}
              <p className="mt-5 text-xs text-muted">{s.neverPlayed} juegos de tu biblioteca aún sin estrenar.</p>
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
