// Enrutado de navegación: el overlay superior del host tiene prioridad; si no
// hay overlays, las acciones van al tema (iframe).

import { useEffect, useRef } from "react";
import type { NavAction } from "../api/types";
// Reutilizamos la navegación espacial del kit de temas.
import { createFocus } from "../../sdk/kit/focus.js";
import { playSound } from "../host/sounds";
import { useApp } from "../store/app";

export type NavSource = "keyboard" | "gamepad";
type Handler = (action: NavAction, repeat: boolean, source: NavSource) => void;

const stack: Handler[] = [];
let themeSink: Handler | null = null;

export function setThemeSink(fn: Handler | null) {
  themeSink = fn;
}

export function dispatchNav(action: NavAction, repeat: boolean, source: NavSource) {
  const top = stack[stack.length - 1];
  if (top) return top(action, repeat, source);
  if (action === "home") {
    useApp.getState().open("menu");
    return;
  }
  themeSink?.(action, repeat, source);
}

export function pushNav(fn: Handler) {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

interface FocusApi {
  current: HTMLElement | null;
  move(dir: string): boolean;
  first(within?: HTMLElement): boolean;
  focus(el: HTMLElement, o?: object): boolean;
  destroy(): void;
}

/**
 * Navegación por mando/teclado dentro de un overlay del host. Los elementos
 * interactivos llevan `data-nav`. Devuelve una ref para el contenedor.
 */
export function useOverlayNav<T extends HTMLElement>(opts: { onBack?: () => void; autoFocus?: boolean; extra?: Partial<Record<NavAction, () => void>> } = {}) {
  const ref = useRef<T>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const focus = createFocus({
      root,
      selector: "[data-nav]:not([disabled])",
      scroll: "nearest",
      sound: false,
      onChange: (_el: HTMLElement, prev: HTMLElement | null) => {
        if (prev) playSound("move");
      },
    }) as unknown as FocusApi;
    if (optsRef.current.autoFocus !== false) {
      // Tras pintar, enfocar el primer elemento marcado con data-autofocus o el primero.
      requestAnimationFrame(() => {
        const auto = root.querySelector<HTMLElement>("[data-autofocus]");
        if (auto) focus.focus(auto, { instant: true, silent: true });
        else focus.first();
      });
    }
    const handler: Handler = (action) => {
      const extra = optsRef.current.extra?.[action];
      if (extra) return extra();
      const cur = focus.current;
      if ((action === "left" || action === "right") && cur instanceof HTMLInputElement && cur.type === "range") {
        if (action === "left") cur.stepDown();
        else cur.stepUp();
        cur.dispatchEvent(new Event("input", { bubbles: true }));
        cur.dispatchEvent(new Event("change", { bubbles: true }));
        playSound("move");
        return;
      }
      if ((action === "left" || action === "right") && cur?.dataset.cycle !== undefined) {
        cur.dispatchEvent(new CustomEvent("cycle", { detail: action === "left" ? -1 : 1 }));
        playSound("move");
        return;
      }
      if (action === "up" || action === "down" || action === "left" || action === "right") {
        focus.move(action);
        return;
      }
      if (action === "accept") {
        if (!cur) return;
        playSound("select");
        if (cur instanceof HTMLInputElement && cur.type !== "checkbox" && cur.type !== "range") cur.focus();
        else if (cur instanceof HTMLTextAreaElement) cur.focus();
        else cur.click();
        return;
      }
      if (action === "back") {
        playSound("back");
        optsRef.current.onBack?.();
      }
      if (action === "lb" || action === "rb") {
        const tabs = Array.from(root.querySelectorAll<HTMLElement>("[data-tab]"));
        const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
        const next = tabs[(i + (action === "rb" ? 1 : tabs.length - 1)) % Math.max(tabs.length, 1)];
        if (next) {
          next.click();
          playSound("move");
        }
      }
    };
    const pop = pushNav(handler);
    // Teclado dentro del host (el foco ya no está en el iframe).
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && (t as HTMLInputElement).type !== "range" && (t as HTMLInputElement).type !== "checkbox";
      const map: Record<string, NavAction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Escape: "back" };
      let a = map[e.key];
      if (!a && e.key === "Enter" && !typing) a = "accept";
      if (!a) return;
      if (typing && a !== "back" && a !== "up" && a !== "down") return;
      if (stack[stack.length - 1] !== handler) return;
      e.preventDefault();
      e.stopPropagation();
      if (typing && a === "back") {
        (t as HTMLInputElement).blur();
        return;
      }
      handler(a, e.repeat, "keyboard");
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      pop();
      focus.destroy();
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  return ref;
}
