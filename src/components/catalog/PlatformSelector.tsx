// Selector de plataforma: rejilla de iconos agrupada por familia, con cuántas
// fuentes la cubren y con qué emulador se jugaría.

import type { CatalogPlatformInfo, Platform } from "../../api/types";
import { FAMILIES, platformDef } from "../../lib/catalog/platforms";
import { t } from "../../lib/i18n";
import { cx } from "../ui";

export function PlatformIcon({ platform, size = 44 }: { platform: string | null | undefined; size?: number }) {
  const d = platformDef(platform);
  const hue = d?.hue ?? 220;
  const pc = d?.family === "pc";
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-xl font-bold tracking-tight text-white ring-1 ring-white/10"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size / ((d?.short.length ?? 3) > 3 ? 4.2 : 3.2)),
        background: pc ? "linear-gradient(135deg, hsl(220 10% 30%), hsl(220 10% 18%))" : `linear-gradient(135deg, hsl(${hue} 65% 48%), hsl(${hue} 70% 30%))`,
      }}
    >
      {d?.short ?? "?"}
    </span>
  );
}

export function PlatformSelector({
  platforms,
  info,
  counts,
  selected,
  onSelect,
}: {
  platforms: Platform[];
  /** Nombre y emulador de cada plataforma (del núcleo). */
  info?: CatalogPlatformInfo[];
  /** Fuentes que cubren cada una. */
  counts?: Partial<Record<Platform, number>>;
  selected?: Platform | null;
  onSelect: (platform: Platform) => void;
}) {
  const groups = FAMILIES.map((f) => ({ ...f, items: platforms.filter((p) => platformDef(p)?.family === f.id) })).filter((g) => g.items.length);
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.id}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {g.items.map((p) => {
              const d = platformDef(p)!;
              const i = info?.find((x) => x.id === p);
              const n = counts?.[p];
              return (
                <button
                  key={p}
                  data-nav
                  onClick={() => onSelect(p)}
                  className={cx(
                    "flex items-center gap-3 rounded-xl bg-surface-2 p-2.5 text-left ring-1 ring-line transition hover:bg-surface-3 cursor-pointer",
                    selected === p && "ring-2 ring-accent",
                  )}
                >
                  <PlatformIcon platform={p} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.name}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {!d.system ? t("Sin emulador") : i?.emulator ? i.emulator : <span className="text-amber-300/90">{t("Sin emulador instalado")}</span>}
                      {n ? ` · ${n === 1 ? t("1 fuente") : t("{n} fuentes", { n })}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
