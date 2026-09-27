// Teclado en pantalla: escribir con el mando (búsquedas de Explorar, temas).

import { useEffect, useRef, useState } from "react";
import { ArrowBigUp, Check, Delete, Space } from "lucide-react";
import { resolveKeyboard, type KeyboardOptions } from "../host/downloads";
import { useOverlayNav } from "../input/nav";
import { cx } from "../components/ui";
import { Hints } from "../components/Hints";

const ROWS = ["1234567890", "qwertyuiop", "asdfghjklñ", "zxcvbnm-':"];

export function KeyboardOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const opts = (args ?? {}) as KeyboardOptions;
  const max = opts.maxLength ?? 100;
  const [text, setText] = useState(opts.value ?? "");
  const [shift, setShift] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    resolveKeyboard(v);
    onClose();
  };
  // Cerrado por fuera (otro overlay encima, cerrar todo): cuenta como cancelar.
  useEffect(() => () => void (!done.current && resolveKeyboard(null)), []);

  const type = (ch: string) => setText((t) => (t + (shift ? ch.toUpperCase() : ch)).slice(0, max));
  const back = () => setText((t) => t.slice(0, -1));
  const ref = useOverlayNav<HTMLDivElement>({
    onBack: () => finish(null),
    extra: { x: back, y: () => type(" "), menu: () => finish(text), lb: () => setShift((s) => !s) },
  });

  const key = (label: React.ReactNode, fn: () => void, className = "", autofocus = false) => (
    <button
      data-nav
      data-autofocus={autofocus || undefined}
      onClick={fn}
      className={cx(
        "grid h-12 min-w-12 place-items-center rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/80 text-lg hover:brightness-125 cursor-pointer",
        className,
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="overlay-enter absolute inset-0 z-[45] grid place-items-center bg-black/60 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && finish(null)}>
      <div ref={ref} data-focus-trap className="panel-enter glass w-[min(760px,94vw)] rounded-[calc(var(--h-radius)*1.4)] p-5 shadow-2xl">
        {opts.title && <h2 className="mb-3 text-base font-semibold">{opts.title}</h2>}
        <input
          ref={input}
          value={text}
          maxLength={max}
          placeholder={opts.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") finish(text);
          }}
          className="mb-4 h-12 w-full rounded-[calc(var(--h-radius)*0.6)] bg-surface-3/70 px-4 text-lg outline-none ring-1 ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-accent"
        />
        <div className="flex flex-col gap-2">
          {ROWS.map((row, r) => (
            <div key={row} className="flex gap-2">
              {row.split("").map((ch, i) => (
                <span key={ch} className="flex-1 [&>button]:w-full">
                  {key(shift ? ch.toUpperCase() : ch, () => type(ch), "", r === 1 && i === 0)}
                </span>
              ))}
            </div>
          ))}
          <div className="flex gap-2">
            {key(<ArrowBigUp size={20} className={shift ? "text-accent" : ""} />, () => setShift((s) => !s), "w-20")}
            {key(<Space size={20} />, () => type(" "), "flex-1")}
            {key(<Delete size={20} />, back, "w-20")}
            {key(
              <span className="flex items-center gap-2 text-base font-semibold">
                <Check size={18} /> Aceptar
              </span>,
              () => finish(text),
              "w-36 bg-accent text-accent-contrast",
            )}
          </div>
        </div>
        <Hints
          className="mt-4 justify-center"
          items={[
            ["accept", "Tecla"],
            ["x", "Borrar"],
            ["y", "Espacio"],
            ["lb", "Mayúsculas"],
            ["menu", "Aceptar"],
            ["back", "Cancelar"],
          ]}
        />
      </div>
    </div>
  );
}
