// Tu perfil en React (ventanas del host): monta las vistas del kit
// (sdk/kit/profile.js) con el objeto `ejg` del host. Van dentro de un
// `.gd-pane`, con las mismas variables que las guías.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { NavAction } from "../api/types";
import { hostEjg, kitFocus } from "../host/profile";
import { createBadgesView, createProfileView } from "../../sdk/kit/profile.js";
import "../../sdk/kit/profile.css";
import "./guide.css";
import "./profile.css";

type Screen = "profile" | "badges";

export interface ProfileHandle {
  /** Acción del mando; true si la ha usado la vista. */
  nav: (a: NavAction) => boolean;
  hints: () => [NavAction, string][];
}

interface View {
  nav: (a: string) => boolean;
  hints: () => [NavAction, string][];
  destroy: () => void;
}

export const ProfilePane = forwardRef<
  ProfileHandle,
  {
    start?: Screen;
    onExit?: () => void;
    onScreen?: (s: Screen) => void;
    className?: string;
    /** Diseño del perfil (el del tema): steam, ps5, xbox, switch, cinema, retro. */
    layout?: string;
  }
>(function ProfilePane({ start = "profile", onExit, onScreen, className, layout = "steam" }, ref) {
  const [stack, setStack] = useState<Screen[]>([start]);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const [, bump] = useState(0);
  const exit = useRef(onExit);
  exit.current = onExit;
  const depth = useRef(stack.length);
  depth.current = stack.length;
  const top = stack[stack.length - 1];

  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const ejg = hostEjg();
    const focus = kitFocus(root);
    const push = (s: Screen) => setStack((st) => [...st, s]);
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
    // Steam tiene su página de insignias; los demás, su pestaña del perfil.
    view.current = (
      top === "badges" && layout === "steam"
        ? createBadgesView({ ejg, root, focus, onProfile: () => (depth.current > 1 ? back() : push("profile")), onExit: back, onChange })
        : createProfileView({ ejg, root, focus, layout, tab: top, onBadges: () => push("badges"), onExit: back, onChange })
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
export function ProfilePreview({ data, layout = "steam" }: { data: Record<string, unknown>; layout?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<{ update: (d: unknown) => void; destroy: () => void } | null>(null);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    view.current = createProfileView({ ejg: hostEjg(), root, focus: null, data, layout });
    return () => view.current?.destroy();
  }, [layout]);
  useEffect(() => view.current?.update(data), [data]);
  return (
    <div className="gd-pane s-host is-preview">
      <div ref={box} className="s-host-box" />
    </div>
  );
}
