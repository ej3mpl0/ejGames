// Piezas fijas del host sobre el tema: botones de ventana, avisos y progreso.

import { useEffect, useState } from "react";
import { Copy, Minus, Square, X, Loader2, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { api } from "../api/tauri";
import { activeTheme, useApp } from "../store/app";
import { cx } from "./ui";

export function WindowControls() {
  const theme = useApp(activeTheme);
  const mode = useApp((s) => s.mode);
  const [max, setMax] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const upd = () => api.windowState().then((s) => {
      setMax(s.maximized);
      setFull(s.fullscreen);
    }).catch(() => {});
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  if (full || mode === "tv" || theme?.windowControls === "theme") return null;
  const btn = "grid h-8 w-11 place-items-center text-white/70 hover:text-white hover:bg-white/10 transition-colors";
  return (
    <div className="group absolute right-0 top-0 z-30 flex items-center rounded-bl-xl bg-black/35 opacity-0 backdrop-blur-md transition-opacity duration-200 hover:opacity-100">
      <div
        className="h-8 w-24 cursor-grab"
        title="Arrastrar ventana"
        onMouseDown={(e) => {
          if (e.button === 0) void api.windowAction(e.detail === 2 ? "toggle-maximize" : "drag");
        }}
      />
      <button className={btn} title="Minimizar" onClick={() => api.windowAction("minimize")}>
        <Minus size={15} />
      </button>
      <button className={btn} title={max ? "Restaurar" : "Maximizar"} onClick={() => api.windowAction("toggle-maximize")}>
        {max ? <Copy size={13} /> : <Square size={13} />}
      </button>
      <button className={cx(btn, "hover:bg-red-600")} title="Cerrar" onClick={() => api.windowAction("close")}>
        <X size={16} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="pointer-events-none absolute bottom-5 right-5 z-50 flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className="panel-enter glass pointer-events-auto flex cursor-pointer items-start gap-3 rounded-[var(--h-radius)] px-4 py-3 text-sm shadow-2xl"
        >
          {t.kind === "error" ? (
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-400" />
          ) : t.kind === "ok" ? (
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
          ) : (
            <Info size={18} className="mt-0.5 shrink-0 text-accent" />
          )}
          <span className="flex-1 leading-snug">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/** Indicador discreto de escaneo / descarga de metadatos. */
export function ActivityPill() {
  const meta = useApp((s) => s.meta);
  const scan = useApp((s) => s.scan);
  const busyMeta = meta.total > 0;
  const busyScan = scan && scan.phase !== "done";
  if (!busyMeta && !busyScan) return null;
  const label = busyScan
    ? scan!.phase === "stores"
      ? "Buscando juegos en tus tiendas…"
      : `Escaneando ${scan!.done}/${scan!.total}${scan!.current ? ` · ${scan!.current}` : ""}`
    : `Descargando info y arte ${Math.min(meta.done, meta.total)}/${meta.total}`;
  return (
    <div className="glass pointer-events-none absolute bottom-5 left-5 z-30 flex max-w-md items-center gap-2.5 rounded-full py-2 pl-3 pr-4 text-xs shadow-xl">
      <Loader2 size={14} className="animate-spin text-accent" />
      <span className="truncate">{label}</span>
    </div>
  );
}
