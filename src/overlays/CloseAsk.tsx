// Al cerrar la ventana (X, Alt+F4, barra de tareas) con «Al cerrar: preguntar»:
// seguir en la bandeja o salir del todo, y si recordarlo. Lo pide el núcleo
// (app:close-ask); se cambia luego en Ajustes → Sistema.

import { useEffect, useState } from "react";
import { LogOut, PanelBottomClose } from "lucide-react";
import { api, on } from "../api/tauri";
import { Hints } from "../components/Hints";
import { useOverlayNav } from "../input/nav";
import { useApp } from "../store/app";

export function CloseAsk() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const un = on("app:close-ask", () => setOpen(true));
    return () => void un.then((f) => f());
  }, []);
  return open ? <CloseDialog onClose={() => setOpen(false)} /> : null;
}

function CloseDialog({ onClose }: { onClose: () => void }) {
  const set = useApp((s) => s.set);
  const downloads = useApp((s) => s.downloads.filter((d) => d.state === "downloading" || d.state === "installing").length);
  const playing = useApp((s) => s.running.length);
  const [remember, setRemember] = useState(false);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });

  const pick = async (action: "tray" | "quit") => {
    if (remember) {
      try {
        set({ settings: await api.updateSettings({ closeAction: action }) });
      } catch {
        // Sin guardar, se cierra igual.
      }
    }
    onClose();
    if (action === "tray") await api.windowAction("to-tray");
    else await api.quit();
  };

  const busy = [
    playing ? `${playing === 1 ? "un juego abierto" : `${playing} juegos abiertos`}` : "",
    downloads ? `${downloads === 1 ? "una descarga" : `${downloads} descargas`} en curso` : "",
  ].filter(Boolean);

  const choice = "flex w-full items-center gap-4 rounded-[calc(var(--h-radius)*0.8)] bg-surface-3/60 px-4 py-3.5 text-left ring-1 ring-line hover:bg-surface-3 hover:ring-accent/60 cursor-pointer";

  return (
    <div className="overlay-enter fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} data-focus-trap className="panel-enter glass w-[min(460px,92vw)] rounded-[calc(var(--h-radius)*1.4)] p-6 shadow-2xl">
        <h2 className="text-[19px] font-semibold">¿Cerrar ejGames?</h2>
        <p className="mt-1.5 text-sm text-muted">En la bandeja apenas consume y vuelve al instante; salir lo cierra del todo.</p>

        <div className="mt-5 flex flex-col gap-2.5">
          <button data-nav data-autofocus className={choice} onClick={() => void pick("tray")}>
            <PanelBottomClose size={22} className="shrink-0 text-accent" />
            <span className="flex-1">
              <span className="block text-sm font-semibold">Minimizar a la bandeja</span>
              <span className="block text-xs text-muted">Sigue en marcha junto al reloj: descargas, avisos y el botón Guía del mando.</span>
            </span>
          </button>
          <button data-nav className={choice} onClick={() => void pick("quit")}>
            <LogOut size={22} className="shrink-0 text-red-300" />
            <span className="flex-1">
              <span className="block text-sm font-semibold">Salir de ejGames</span>
              <span className="block text-xs text-muted">
                {busy.length ? `Hay ${busy.join(" y ")}: las partidas se guardan y las descargas se pausan.` : "Cierra el launcher y la bandeja."}
              </span>
            </span>
          </button>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2.5 px-1 text-sm">
          <input data-nav type="checkbox" className="h-4 w-4 accent-[var(--h-accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          No volver a preguntar <span className="text-muted">(se cambia en Ajustes → Sistema)</span>
        </label>

        <div className="mt-5 flex items-center justify-between">
          <Hints items={[["accept", "Elegir"], ["back", "Cancelar"]]} />
          <button data-nav onClick={onClose} className="h-9 rounded-[calc(var(--h-radius)*0.7)] px-4 text-sm text-muted hover:bg-surface-3 hover:text-fg cursor-pointer">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
