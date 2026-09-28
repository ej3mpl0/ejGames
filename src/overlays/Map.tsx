// Mapa de Map Genie de un juego en una ventana del host (`ejg.maps.open`).
// Durante la partida, el mismo mapa está en el overlay y se puede anclar.

import { MapPane } from "../components/map";
import { Modal } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { useApp } from "../store/app";

export function MapOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const gameId = Number(args?.id);
  const game = useApp((s) => s.games.find((g) => g.id === gameId));
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });
  return (
    <Modal
      ref={ref}
      title={`Mapa${game ? ` · ${game.title}` : ""}`}
      onClose={onClose}
      width="min(1400px, 96vw)"
      height="92vh"
      hints={[
        ["accept", "Seleccionar"],
        ["back", "Cerrar"],
      ]}
    >
      <div className="relative h-full px-5 pt-4 pb-3" style={{ ["--gd-bg" as string]: "var(--h-surface)" }}>
        {game ? <MapPane gameId={gameId} gameTitle={game.title} /> : null}
      </div>
    </Modal>
  );
}
