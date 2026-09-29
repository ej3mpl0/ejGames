// El diálogo de la cuenta de ejGames: crearla o entrar desde cualquier sitio
// (temas, menú rápido, Ajustes, el aviso de «Novedad»). Mientras se enseña el
// código de recuperación no se cierra con «Atrás».

import { useRef } from "react";
import { AccountCard, type AccountStep } from "../components/AccountCard";
import { useOverlayNav } from "../input/nav";

export function AccountAuthOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const step = useRef<AccountStep>("form");
  const tryClose = () => {
    if (step.current !== "code") onClose();
  };
  const ref = useOverlayNav<HTMLDivElement>({ onBack: tryClose });
  return (
    <div
      ref={ref}
      className="ac-overlay overlay-enter"
      data-focus-trap
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) tryClose();
      }}
    >
      <AccountCard
        className="panel-enter"
        mode={args?.mode === "login" ? "login" : "register"}
        promo={!!args?.promo}
        onClose={onClose}
        onFinish={onClose}
        onStep={(k) => (step.current = k)}
      />
    </div>
  );
}
