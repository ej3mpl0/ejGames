// «Tu año en ejGames»: un repaso de horas, juegos, rachas y logros del año, en
// tarjetas que se pasan con las flechas, el mando o los botones.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { YearReview } from "../api/types";
import { Button, Modal, Spinner, cx } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { locale, t, tn } from "../lib/i18n";
import { useApp } from "../store/app";

const hoursOf = (s: number) => Math.round(s / 3600).toLocaleString(locale());

function Bars({ items, max, hot }: { items: { label: string; value: number; text: string }[]; max: number; hot?: number }) {
  return (
    <div className="flex w-full flex-col gap-2">
      {items.map((it, i) => (
        <div key={it.label} className="flex items-center gap-3 text-sm">
          <span className="w-44 shrink-0 truncate text-right">{it.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (it.value / Math.max(max, 1)) * 100)}%`, background: i === (hot ?? 0) ? "var(--h-accent)" : "color-mix(in srgb, var(--h-accent) 55%, transparent)" }} />
          </div>
          <span className="w-20 shrink-0 text-muted">{it.text}</span>
        </div>
      ))}
    </div>
  );
}

function Big({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="text-6xl font-semibold tracking-tight" style={{ color: "var(--h-accent)" }}>
        {value}
      </span>
      <span className="mt-1 text-muted">{label}</span>
    </div>
  );
}

export function YearReviewOverlay({ onClose, year }: { onClose: () => void; year?: number }) {
  const toast = useApp((s) => s.toast);
  const profile = useApp((s) => s.profile);
  const [y, setY] = useState<YearReview | null>(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    api.getYearReview(year).then(setY).catch((e) => toast("error", errMsg(e)));
  }, [year]);

  const slides = useMemo(() => {
    if (!y) return [];
    const month = (m: number) => new Date(2000, m, 1).toLocaleDateString(locale(), { month: "long" });
    const weekday = (d: number) => new Date(2024, 0, 1 + d).toLocaleDateString(locale(), { weekday: "long" });
    const out: { id: string; node: ReactNode }[] = [];
    out.push({
      id: "intro",
      node: (
        <>
          <p className="text-sm uppercase tracking-widest text-muted">{t("Tu {year} en ejGames", { year: y.year })}</p>
          <Big value={hoursOf(y.totalSeconds)} label={t("horas jugadas")} />
          <p className="text-muted">
            {tn(y.gamesPlayed, "{n} juego", "{n} juegos")} · {tn(y.sessions, "{n} partida", "{n} partidas")} · {tn(y.daysPlayed, "{n} día distinto", "{n} días distintos")}
          </p>
        </>
      ),
    });
    if (y.topGames.length) {
      const max = y.topGames[0].seconds;
      out.push({
        id: "top",
        node: (
          <>
            <h2 className="text-2xl font-semibold">{t("Tus juegos del año")}</h2>
            <Bars items={y.topGames.map((g) => ({ label: g.title, value: g.seconds, text: `${hoursOf(g.seconds)} h` }))} max={max} />
            <p className="text-muted">{t("{title} fue tu favorito: {h} horas.", { title: y.topGames[0].title, h: hoursOf(y.topGames[0].seconds) })}</p>
          </>
        ),
      });
    }
    out.push({
      id: "months",
      node: (
        <>
          <h2 className="text-2xl font-semibold">{y.topMonth != null ? t("Tu mes fue {month}", { month: month(y.topMonth) }) : t("Mes a mes")}</h2>
          <div className="flex h-44 w-full items-end gap-2">
            {y.byMonth.map((s, m) => (
              <div key={m} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t"
                  style={{ height: `${Math.max(2, (s / Math.max(...y.byMonth, 1)) * 100)}%`, background: m === y.topMonth ? "var(--h-accent)" : "color-mix(in srgb, var(--h-accent) 45%, transparent)" }}
                  title={`${month(m)}: ${hoursOf(s)} h`}
                />
                <span className="text-xs text-muted">{month(m).slice(0, 3)}</span>
              </div>
            ))}
          </div>
        </>
      ),
    });
    out.push({
      id: "habits",
      node: (
        <>
          <h2 className="text-2xl font-semibold">{t("Tus costumbres")}</h2>
          <div className="grid w-full grid-cols-2 gap-8">
            {y.favoriteHour != null && <Big value={`${y.favoriteHour}:00`} label={t("tu hora favorita para jugar")} />}
            {y.favoriteWeekday != null && <Big value={weekday(y.favoriteWeekday)} label={t("tu día favorito")} />}
            <Big value={String(y.bestStreak)} label={t("días seguidos, tu mejor racha")} />
            <Big value={`${(y.longestSession / 3600).toFixed(1)} h`} label={y.longestSessionGame ? t("tu partida más larga, en {title}", { title: y.longestSessionGame }) : t("tu partida más larga")} />
          </div>
        </>
      ),
    });
    if (y.genres.length) {
      out.push({
        id: "genres",
        node: (
          <>
            <h2 className="text-2xl font-semibold">{t("Lo que más juegas")}</h2>
            <Bars items={y.genres.map(([g, s]) => ({ label: g, value: s, text: `${hoursOf(s)} h` }))} max={y.genres[0][1]} />
          </>
        ),
      });
    }
    out.push({
      id: "ach",
      node: (
        <>
          <h2 className="text-2xl font-semibold">{t("Logros")}</h2>
          <Big value={String(y.achievements)} label={t("logros desbloqueados")} />
          {y.rarest && (
            <p className="max-w-md text-center text-muted">
              {t("El más raro: «{name}» de {game}, que solo tiene el {pct} % de los jugadores.", { name: y.rarest.name, game: y.rarest.game, pct: y.rarest.pct.toFixed(1) })}
            </p>
          )}
        </>
      ),
    });
    out.push({
      id: "end",
      node: (
        <>
          <h2 className="text-2xl font-semibold">{t("Y al otro año…")}</h2>
          <Big value={String(y.newGames)} label={t("juegos nuevos en tu biblioteca")} />
          {y.firstGame && <p className="text-muted">{t("Empezaste el año con {title}.", { title: y.firstGame })}</p>}
        </>
      ),
    });
    return out;
  }, [y]);

  const go = (d: number) => setI((n) => Math.min(Math.max(n + d, 0), Math.max(slides.length - 1, 0)));
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose, extra: { left: () => go(-1), right: () => go(1) } });

  return (
    <Modal ref={ref} title={t("Tu año en ejGames")} onClose={onClose} width="min(900px, 95vw)" height="min(620px, 90vh)">
      {!y ? (
        <div className="grid h-full place-items-center">
          <Spinner size={28} />
        </div>
      ) : y.sessions === 0 ? (
        <div className="grid h-full place-items-center p-8 text-center text-muted">
          {t("No hay partidas registradas en {year} para {name}.", { year: y.year, name: profile?.name ?? "" })}
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div key={slides[i]?.id} className="panel-enter flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-10 text-center">
            {slides[i]?.node}
          </div>
          <div className="flex items-center gap-4 border-t border-line px-5 py-3">
            <Button data-nav size="sm" variant="ghost" icon={<ArrowLeft size={15} />} disabled={i === 0} onClick={() => go(-1)}>
              {t("Anterior")}
            </Button>
            <div className="flex flex-1 justify-center gap-2">
              {slides.map((s, n) => (
                <span key={s.id} className={cx("h-2 w-2 rounded-full", n === i ? "bg-accent" : "bg-surface-3")} />
              ))}
            </div>
            {i < slides.length - 1 ? (
              <Button data-nav data-autofocus size="sm" variant="primary" onClick={() => go(1)}>
                {t("Siguiente")} <ArrowRight size={15} />
              </Button>
            ) : (
              <Button data-nav data-autofocus size="sm" variant="primary" onClick={onClose}>
                {t("Cerrar")}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
