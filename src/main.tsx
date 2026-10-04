import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "./store/app";
import { setLang, startTranslator } from "./lib/i18n";

// Solo en desarrollo: acceso al estado desde DevTools / scripts/cdp.mjs.
if (import.meta.env.DEV) (window as unknown as { __ejg: unknown }).__ejg = { useApp };

// Sin menú contextual del navegador (salvo en campos de texto).
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!(t.tagName === "INPUT" || t.tagName === "TEXTAREA")) e.preventDefault();
});

const render = (node: ReactNode) => createRoot(document.getElementById("root")!).render(<StrictMode>{node}</StrictMode>);

// El idioma va antes de cargar nada: hay textos que se calculan al importar.
const lang = await invoke<string>("ui_language").catch(() => "es");
setLang(lang);
startTranslator();

// La misma página sirve al launcher y al overlay del juego (#overlay); cada
// uno carga solo su código.
if (location.hash === "#overlay") {
  document.documentElement.classList.add("ingame");
  void import("./ingame/Overlay").then(({ Overlay }) => render(<Overlay />));
} else {
  void Promise.all([import("./App"), import("./overlays/CloseAsk")]).then(([{ default: App }, { CloseAsk }]) =>
    render(
      <>
        <App />
        <CloseAsk />
      </>,
    ),
  );
}
