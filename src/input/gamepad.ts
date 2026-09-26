// Mando → acciones de navegación. El bucle rAF solo corre con un mando
// conectado y la ventana enfocada: en reposo el CPU queda a 0.

import type { NavAction } from "../api/types";

type Emit = (action: NavAction, repeat: boolean) => void;

/** Tipo de mando a partir de su id (vendor/product o nombre). */
export function padTypeOf(id: string): "xbox" | "playstation" | "nintendo" | "generic" {
  const s = id.toLowerCase();
  if (/054c|dualsense|dualshock|playstation|wireless controller|ps4|ps5/.test(s)) return "playstation";
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return "nintendo";
  if (/045e|xbox|xinput/.test(s)) return "xbox";
  return "generic";
}

const BUTTONS: [number, NavAction][] = [
  [0, "accept"],
  [1, "back"],
  [2, "x"],
  [3, "y"],
  [4, "lb"],
  [5, "rb"],
  [6, "lt"],
  [7, "rt"],
  [8, "view"],
  [9, "menu"],
  [16, "home"],
];
const DIRS: [number, NavAction][] = [
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
];

const REPEAT_DELAY = 380;
const REPEAT_FAST = 70;
const REPEAT_SLOW = 120;

export function startGamepad(emit: Emit, onActivity?: (padId: string) => void) {
  let raf = 0;
  const held = new Map<string, { since: number; last: number }>();

  function pressed(gp: Gamepad): Set<NavAction> {
    const out = new Set<NavAction>();
    for (const [i, a] of BUTTONS) {
      const b = gp.buttons[i];
      if (b && (b.pressed || b.value > 0.5)) out.add(a);
    }
    for (const [i, a] of DIRS) if (gp.buttons[i]?.pressed) out.add(a);
    const [x = 0, y = 0] = gp.axes;
    if (x < -0.55) out.add("left");
    if (x > 0.55) out.add("right");
    if (y < -0.55) out.add("up");
    if (y > 0.55) out.add("down");
    return out;
  }

  function frame() {
    raf = 0;
    if (!document.hasFocus() || document.hidden) return; // se reanuda con focus
    const now = performance.now();
    const all = new Set<NavAction>();
    let who = "";
    for (const gp of navigator.getGamepads()) {
      if (!gp || !gp.connected) continue;
      const p = pressed(gp);
      if (p.size) who = gp.id;
      p.forEach((a) => all.add(a));
    }
    for (const a of all) {
      const h = held.get(a);
      if (!h) {
        held.set(a, { since: now, last: now });
        emit(a, false);
        onActivity?.(who);
      } else if (["up", "down", "left", "right", "lb", "rb"].includes(a)) {
        const age = now - h.since;
        const every = age > 1200 ? REPEAT_FAST : REPEAT_SLOW;
        if (age > REPEAT_DELAY && now - h.last > every) {
          h.last = now;
          emit(a, true);
        }
      }
    }
    for (const k of [...held.keys()]) if (!all.has(k as NavAction)) held.delete(k);
    schedule();
  }

  function anyPad() {
    return Array.from(navigator.getGamepads()).some((g) => g && g.connected);
  }

  function schedule() {
    if (!raf && anyPad()) raf = requestAnimationFrame(frame);
  }

  const wake = () => schedule();
  window.addEventListener("gamepadconnected", wake);
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", wake);
  // Si el foco vuelve directamente al iframe del tema, el padre no recibe
  // "focus": un chequeo por segundo (coste despreciable) reanuda el bucle.
  const tick = setInterval(wake, 1000);
  schedule();

  return () => {
    clearInterval(tick);
    cancelAnimationFrame(raf);
    window.removeEventListener("gamepadconnected", wake);
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
