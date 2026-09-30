// Tu perfil y tus insignias en una ventana del host: para el menú rápido y
// para los temas que no pintan los suyos (sin "features": {"profile": true}).

import { useRef, useState } from "react";
import type { NavAction } from "../api/types";
import { ProfilePane, type ProfileHandle } from "../components/profile";
import { Modal } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { activeTheme, useApp } from "../store/app";

const TITLES = { profile: "Perfil", badges: "Insignias" };

export function ProfileOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const pane = useRef<ProfileHandle>(null);
  const start = args?.view === "badges" ? "badges" : "profile";
  // El diseño del perfil del tema que usas (cada tema tiene el suyo).
  const themeId = useApp((s) => activeTheme(s)?.id ?? "steam");
  const layout = ["ps5", "xbox", "switch", "cinema", "retro"].includes(themeId) ? themeId : "steam";
  const [title, setTitle] = useState(TITLES[start]);
  const [, bump] = useState(0);
  const pass = (a: NavAction) => () => {
    if (!pane.current?.nav(a) && a === "back") onClose();
  };
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: pass("back"),
    extra: { back: pass("back"), lb: pass("lb"), rb: pass("rb"), y: pass("y") },
  });
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
        <ProfilePane
          ref={pane}
          start={start}
          layout={layout}
          onExit={onClose}
          onScreen={(s) => {
            setTitle(TITLES[s]);
            bump((n) => n + 1);
          }}
        />
      </div>
    </Modal>
  );
}
