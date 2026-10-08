import { Check } from "lucide-react";
import type { ThemeInfo } from "../api/types";
import { cx } from "./ui";
import { t } from "../lib/i18n";

/** Miniatura de un tema: su preview o un boceto con su paleta. */
export function ThemePreview({ theme }: { theme: ThemeInfo }) {
  if (theme.previewUrl) {
    return <img src={theme.previewUrl} alt="" className="h-full w-full object-cover" draggable={false} />;
  }
  const [bg = "#111", surface = "#222", accent = "#4f8cff", text = "#fff"] = theme.palette ?? [];
  const layout = theme.id.includes("ps5") || theme.id.includes("switch") ? "row" : theme.id.includes("steam") ? "side" : "rows";
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: bg }}>
      {layout === "side" && (
        <div className="absolute inset-y-0 left-0 w-[26%] p-2" style={{ background: surface }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="mb-1.5 h-1.5 rounded-full" style={{ background: i === 1 ? accent : text, opacity: i === 1 ? 1 : 0.25 }} />
          ))}
        </div>
      )}
      {layout === "side" && (
        <div className="absolute left-[30%] right-2 top-3 grid grid-cols-4 gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-sm" style={{ background: surface, outline: i === 0 ? `2px solid ${accent}` : undefined }} />
          ))}
        </div>
      )}
      {layout === "row" && (
        <>
          <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: `linear-gradient(transparent, ${surface})` }} />
          <div className="absolute left-3 top-4 flex gap-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={cx("rounded-md", i === 0 ? "h-9 w-9" : "h-7 w-7")}
                style={{ background: i === 0 ? accent : surface, opacity: i === 0 ? 1 : 0.8 }}
              />
            ))}
          </div>
          <div className="absolute bottom-4 left-3 h-2 w-1/3 rounded-full" style={{ background: text, opacity: 0.8 }} />
          <div className="absolute bottom-8 left-3 h-3 w-1/2 rounded-full" style={{ background: text }} />
        </>
      )}
      {layout === "rows" && (
        <>
          <div className="absolute inset-x-0 top-0 h-[45%]" style={{ background: `linear-gradient(135deg, ${accent}, ${surface})`, opacity: 0.8 }} />
          {[0, 1].map((r) => (
            <div key={r} className="absolute left-3 right-3 flex gap-1.5" style={{ top: `${52 + r * 24}%` }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-6 flex-1 rounded-sm" style={{ background: surface, outline: r === 0 && i === 0 ? `2px solid ${accent}` : undefined }} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function ThemeCard({ theme, active, onClick }: { theme: ThemeInfo; active?: boolean; onClick?: () => void }) {
  return (
    <button
      data-nav
      onClick={onClick}
      className={cx(
        "group overflow-hidden rounded-[var(--h-radius)] bg-surface-2 text-left ring-1 cursor-pointer",
        active ? "ring-2 ring-accent" : "ring-line hover:ring-white/20",
      )}
    >
      <div className="relative aspect-[16/10]">
        <ThemePreview theme={theme} />
        {active && (
          <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-contrast">
            <Check size={14} />
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          {theme.name}
          {!theme.builtin && <span className="rounded bg-accent/20 px-1.5 text-[10px] uppercase text-accent">propio</span>}
          {!theme.compatible && <span className="rounded bg-red-500/20 px-1.5 text-[10px] uppercase text-red-300">sdk</span>}
        </div>
        <div className="truncate text-xs text-muted">{(theme.description && t(theme.description)) || theme.author}</div>
      </div>
    </button>
  );
}
