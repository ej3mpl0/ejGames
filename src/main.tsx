import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { useApp } from "./store/app";

// Solo en desarrollo: acceso al estado desde DevTools / scripts/cdp.mjs.
if (import.meta.env.DEV) (window as unknown as { __ejg: unknown }).__ejg = { useApp };

// Sin menú contextual del navegador (salvo en campos de texto).
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!(t.tagName === "INPUT" || t.tagName === "TEXTAREA")) e.preventDefault();
});

const render = (node: ReactNode) => createRoot(document.getElementById("root")!).render(<StrictMode>{node}</StrictMode>);

// La misma página sirve al launcher y al overlay del juego (#overlay); cada
// uno carga solo su código.
if (location.hash === "#overlay") {
  document.documentElement.classList.add("ingame");
  void import("./ingame/Overlay").then(({ Overlay }) => render(<Overlay />));
} else {
  void import("./App").then(({ default: App }) => render(<App />));
}
