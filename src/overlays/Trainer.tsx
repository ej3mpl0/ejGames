// Trucos de un juego en una ventana del host: buscar su trainer de FLiNG,
// ver sus opciones, instalarlo (con confirmación) y gestionarlo. La abren los
// temas con `ejg.trainer.open(gameId)`: la instalación nunca la decide un tema.

import { TrainerPane } from "../components/trainer";
import { Modal } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { useApp } from "../store/app";

export function TrainerOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const gameId = Number(args?.id);
  const game = useApp((s) => s.games.find((g) => g.id === gameId));
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });
  return (
    <Modal
      ref={ref}
      title={`Trucos${game ? ` · ${game.title}` : ""}`}
      onClose={onClose}
      width="min(860px, 94vw)"
      height="min(820px, 92vh)"
      hints={[
        ["accept", "Seleccionar"],
        ["back", "Cerrar"],
      ]}
    >
      <div className="relative h-full px-5 pt-4" style={{ ["--gd-bg" as string]: "var(--h-surface)" }}>
        {game ? <TrainerPane gameId={gameId} gameTitle={game.title} /> : null}
      </div>
    </Modal>
  );
}
