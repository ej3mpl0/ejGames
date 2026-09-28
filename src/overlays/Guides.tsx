// Guías de Steam de un juego en una ventana del host: para los temas que no
// pintan su propio lector (sin "features": {"guides": true}).

import { useState } from "react";
import { GuidesPane } from "../components/guide";
import { Modal } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { useApp } from "../store/app";

export function GuidesOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const gameId = Number(args?.id);
  const game = useApp((s) => s.games.find((g) => g.id === gameId));
  const [reading, setReading] = useState(!!args?.guide);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });
  return (
    <Modal
      ref={ref}
      title={`Guías de la comunidad${game ? ` · ${game.title}` : ""}`}
      onClose={onClose}
      width="min(980px, 94vw)"
      height="min(820px, 92vh)"
      hints={
        reading
          ? [
              ["up", "Desplazar"],
              ["lb", "Sección"],
              ["accept", "Índice"],
              ["y", "Guardar"],
              ["x", "Abrir en Steam"],
              ["back", "Volver"],
            ]
          : [
              ["accept", "Leer"],
              ["back", "Cerrar"],
            ]
      }
    >
      <div className="relative h-full px-5 pt-4" style={{ ["--gd-bg" as string]: "var(--h-surface)" }}>
        {gameId ? <GuidesPane gameId={gameId} initial={(args?.guide as string) ?? null} onReading={setReading} /> : null}
      </div>
    </Modal>
  );
}
