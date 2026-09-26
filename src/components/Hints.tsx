// Pistas de controles del host: glifos del mando que estés usando (Xbox,
// PlayStation, Nintendo) o teclas si usas teclado/ratón. Misma tabla que el kit.

import { GLYPHS, glyphSet } from "../../sdk/kit/hints.js";
import type { NavAction } from "../api/types";
import { useApp } from "../store/app";

export function Glyph({ action, big }: { action: NavAction; big?: boolean }) {
  const source = useApp((s) => s.inputSource);
  const pad = useApp((s) => s.padType);
  const set = glyphSet(source, pad) as Record<string, [string, string?]>;
  const [txt, color] = set[action] ?? [action];
  const keyboard = set === (GLYPHS.keyboard as unknown);
  const round = txt.length <= 1 && !keyboard;
  const ps = set === (GLYPHS.playstation as unknown) && !!color;
  return (
    <span
      className="inline-grid shrink-0 place-items-center align-middle font-bold leading-none"
      style={{
        minWidth: big ? 28 : 22,
        height: big ? 28 : 22,
        padding: round ? 0 : "0 6px",
        borderRadius: round ? "50%" : 6,
        fontSize: big ? 13 : 11,
        color: ps ? color : color ? "#fff" : "currentColor",
        background: ps ? "rgba(0,0,0,.5)" : color ?? "transparent",
        border: color && !ps ? "none" : `1.5px solid ${ps ? color : "currentColor"}`,
        opacity: color ? 1 : 0.85,
      }}
    >
      {txt}
    </span>
  );
}

export function Hints({ items, className }: { items: [NavAction, string][]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted ${className ?? ""}`}>
      {items.map(([a, label]) => (
        <span key={a + label} className="flex items-center gap-1.5 whitespace-nowrap">
          <Glyph action={a} />
          {label}
        </span>
      ))}
    </div>
  );
}
