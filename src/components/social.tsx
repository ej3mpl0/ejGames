// Amigos y perfiles en React (ventanas del host y paneles del overlay): monta
// las vistas del kit (sdk/kit/social.js) con el objeto `ejg` del host. Van
// dentro de un `.gd-pane`, así que cada panel del overlay les da su aspecto
// con las mismas variables que las guías.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { NavAction } from "../api/types";
import { hostEjg, kitFocus } from "../host/social";
import { pushNavFilter } from "../input/nav";
import { createFriendsView, createProfileView } from "../../sdk/kit/social.js";
import "../../sdk/kit/social.css";
import "./guide.css";
import "./social.css";

type Screen = { kind: "friends" } | { kind: "profile"; id: number | null };

export interface SocialHandle {
  /** Acción del mando; true si la ha usado la vista. */
  nav: (a: NavAction) => boolean;
  hints: () => [NavAction, string][];
}

interface View {
  nav: (a: string) => boolean;
  hints: () => [NavAction, string][];
  destroy: () => void;
}

export const SocialPane = forwardRef<
  SocialHandle,
  {
    start?: "friends" | "profile";
    userId?: number | null;
    onExit?: () => void;
    onScreen?: (s: Screen) => void;
    className?: string;
    /** Dentro de un panel del overlay: la vista solo se queda con «Atrás» cuando hay un perfil abierto. */
    inPanel?: boolean;
  }
>(function SocialPane({ start = "friends", userId = null, onExit, onScreen, className, inPanel }, ref) {
  const [stack, setStack] = useState<Screen[]>(start === "profile" ? [{ kind: "profile", id: userId }] : [{ kind: "friends" }]);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const [, bump] = useState(0);
  const exit = useRef(onExit);
  exit.current = onExit;
  const depth = useRef(stack.length);
  depth.current = stack.length;
  const top = stack[stack.length - 1];

  // En un panel: «Atrás» cierra el perfil abierto; en la lista, sigue al panel.
  useEffect(() => {
    if (!inPanel) return;
    return pushNavFilter((a) => a === "back" && !!view.current?.nav("back"));
  }, [inPanel]);

  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const ejg = hostEjg();
    const focus = kitFocus(root);
    const open = (id: number) => setStack((s) => [...s, { kind: "profile", id }]);
    const back = () => {
      if (depth.current > 1) {
        setStack((s) => s.slice(0, -1));
        return true;
      }
      if (exit.current) {
        exit.current();
        return true;
      }
      // Raíz sin salida propia: lo decide quien contenga la vista.
      return false;
    };
    const onChange = () => bump((n) => n + 1);
    view.current = (
      top.kind === "friends"
        ? createFriendsView({ ejg, root, focus, onProfile: open, onExit: back, onChange })
        : createProfileView({ ejg, root, focus, userId: top.id, onProfile: open, onExit: back, onChange })
    ) as unknown as View;
    onScreen?.(top);
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [top]);

  useImperativeHandle(ref, () => ({
    nav: (a) => !!view.current?.nav(a),
    hints: () => view.current?.hints() ?? [],
  }));

  return (
    <div className={`gd-pane s-host ${className ?? ""}`}>
      <div ref={box} className="s-host-box" />
    </div>
  );
});

/** Vista previa del perfil (editor): pinta los datos que se le dan. */
export function ProfilePreview({ data }: { data: Record<string, unknown> }) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<{ update: (d: unknown) => void; destroy: () => void } | null>(null);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    view.current = createProfileView({ ejg: hostEjg(), root, focus: null, data });
    return () => view.current?.destroy();
  }, []);
  useEffect(() => view.current?.update(data), [data]);
  return (
    <div className="gd-pane s-host is-preview">
      <div ref={box} className="s-host-box" />
    </div>
  );
}
