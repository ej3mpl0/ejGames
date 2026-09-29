// Amigos y perfiles en una ventana del host: para el menú rápido y para los
// temas que no pintan los suyos (sin "features": {"social": true}).

import { useRef, useState } from "react";
import type { NavAction } from "../api/types";
import { SocialPane, type SocialHandle } from "../components/social";
import { Modal } from "../components/ui";
import { useOverlayNav } from "../input/nav";

export function SocialOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const pane = useRef<SocialHandle>(null);
  const [title, setTitle] = useState(args?.view === "profile" ? "Perfil" : "Amigos");
  const [, bump] = useState(0);
  const pass = (a: NavAction) => () => {
    if (!pane.current?.nav(a) && a === "back") onClose();
  };
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: pass("back"),
    extra: { back: pass("back"), lb: pass("lb"), rb: pass("rb"), x: pass("x"), y: pass("y") },
  });
  const id = typeof args?.id === "number" ? args.id : null;
  return (
    <Modal
      ref={ref}
      title={title}
      onClose={onClose}
      width="min(1180px, 96vw)"
      height="min(900px, 94vh)"
      hints={pane.current?.hints() ?? [["back", "Cerrar"]]}
    >
      <div className="h-full px-5 pb-4 pt-3" style={{ ["--gd-bg" as string]: "var(--h-surface)" }}>
        <SocialPane
          ref={pane}
          start={args?.view === "profile" ? "profile" : "friends"}
          userId={id}
          onExit={onClose}
          onScreen={(s) => {
            setTitle(s.kind === "friends" ? "Amigos" : "Perfil");
            bump((n) => n + 1);
          }}
        />
      </div>
    </Modal>
  );
}
