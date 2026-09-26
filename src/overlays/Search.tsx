// Búsqueda rápida (Ctrl+F): juegos de la biblioteca con acciones directas.

import { useMemo, useState } from "react";
import { Pencil, Play, Search as SearchIcon, Star } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import { cx } from "../components/ui";
import { Hints } from "../components/Hints";
import { useOverlayNav } from "../input/nav";
import { playtime } from "../lib/format";
import { useApp } from "../store/app";
// @ts-ignore módulo JS del kit
import { search } from "../../sdk/kit/library.js";

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const games = useApp((s) => s.games);
  const open = useApp((s) => s.open);
  const toast = useApp((s) => s.toast);
  const [q, setQ] = useState("");
  const results = useMemo(
    () => (search(games.filter((g) => !g.missing), q, 30) as typeof games).slice(0, q ? 30 : 12),
    [games, q],
  );
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: onClose,
    extra: {
      y: () => {
        const id = Number((document.activeElement as HTMLElement)?.dataset.gameId);
        if (id) void api.setFavorite(id, !games.find((g) => g.id === id)?.favorite);
      },
      x: () => {
        const id = Number((document.activeElement as HTMLElement)?.dataset.gameId);
        if (id) open("game", { id });
      },
    },
  });

  async function play(id: number) {
    onClose();
    try {
      await api.play(id);
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  return (
    <div className="overlay-enter absolute inset-0 z-40 flex justify-center bg-black/55 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} data-focus-trap className="panel-enter glass flex h-fit max-h-[70vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-[calc(var(--h-radius)*1.3)] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <SearchIcon size={18} className="text-muted" />
          <input
            data-nav
            data-autofocus
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) void play(results[0].id);
            }}
            placeholder="Buscar en tu biblioteca…"
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
          />
        </div>
        <div className="min-h-0 overflow-y-auto p-2">
          {results.length === 0 && <p className="p-6 text-center text-sm text-muted">Nada con «{q}».</p>}
          {results.map((g) => (
            <button
              key={g.id}
              data-nav
              data-game-id={g.id}
              onClick={() => play(g.id)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-3/60 cursor-pointer"
            >
              {g.media.coverThumb ? (
                <img src={g.media.coverThumb} className="h-14 w-10 rounded object-cover" alt="" loading="lazy" />
              ) : (
                <div className="h-14 w-10 rounded bg-surface-3" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm">
                  {g.favorite && <Star size={12} className="fill-amber-400 text-amber-400" />}
                  {g.title}
                </div>
                <div className="truncate text-xs text-muted">
                  {[g.developer, g.genres[0], playtime(g.playtime)].filter(Boolean).join(" · ")}
                </div>
              </div>
              <span className={cx("flex items-center gap-1 text-xs text-muted")}>
                <Play size={13} /> Jugar
              </span>
              <span
                role="button"
                title="Editar"
                onClick={(e) => {
                  e.stopPropagation();
                  open("game", { id: g.id });
                }}
                className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-fg"
              >
                <Pencil size={14} />
              </span>
            </button>
          ))}
        </div>
        <div className="border-t border-line px-4 py-2">
          <Hints
            items={[
              ["accept", "Jugar"],
              ["x", "Editar"],
              ["y", "Favorito"],
              ["back", "Cerrar"],
            ]}
          />
        </div>
      </div>
    </div>
  );
}
