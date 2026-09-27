// «Hay una versión nueva»: notas de GitHub, descarga con progreso, saltar o más tarde.

import { useMemo } from "react";
import { Download, ExternalLink, Gamepad2, Loader2 } from "lucide-react";
import { Hints } from "../components/Hints";
import { cx } from "../components/ui";
import { downloadAndInstall, openRelease, skipVersion, useUpdate } from "../host/update";
import { useOverlayNav } from "../input/nav";
import { bytes } from "../lib/format";

type Block = { kind: "heading" | "bullet" | "text"; text: string };

/** Markdown mínimo de las notas de GitHub: títulos, viñetas y párrafos. */
function parseNotes(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const plain = line
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\((.+?)\)/g, "$1");
    if (/^#{1,6}\s/.test(plain)) out.push({ kind: "heading", text: plain.replace(/^#{1,6}\s+/, "") });
    else if (/^[-*•]\s/.test(plain)) out.push({ kind: "bullet", text: plain.replace(/^[-*•]\s+/, "") });
    else out.push({ kind: "text", text: plain });
  }
  // El título «ejGames x.y.z» sobra: el aviso ya dice la versión.
  if (out[0]?.kind === "heading" && /^ejgames\b|^\d+\.\d+/i.test(out[0].text)) out.shift();
  return out;
}

export function UpdateAvailable({ onClose }: { onClose: () => void }) {
  const { check, phase, progress, installError } = useUpdate();
  const working = phase === "downloading" || phase === "installing";
  const ref = useOverlayNav<HTMLDivElement>({ onBack: () => !working && onClose() });
  const blocks = useMemo(() => parseNotes(check?.notes ?? ""), [check?.notes]);
  if (!check) return null;

  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const label =
    phase === "installing"
      ? "Abriendo el instalador…"
      : phase === "downloading"
        ? `Descargando ${pct} %`
        : check.assetSize
          ? `Descargar e instalar (${bytes(check.assetSize)})`
          : "Descargar e instalar";

  return (
    <div className="overlay-enter absolute inset-0 z-[45] grid place-items-center bg-black/60 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !working && onClose()}>
      <div ref={ref} data-focus-trap className="panel-enter glass flex max-h-[88vh] w-[min(540px,92vw)] flex-col overflow-hidden rounded-[calc(var(--h-radius)*1.4)] p-7 shadow-2xl">
        <div className="mb-3 flex justify-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/20 text-accent">
            <Gamepad2 size={30} />
          </span>
        </div>
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Actualización</p>
        <h2 className="mt-1 text-center text-[22px] font-semibold">Hay una versión nueva de ejGames</h2>
        <p className="mt-1 text-center text-sm text-muted">
          La {check.latest} ya está disponible (tienes la {check.current}).
        </p>

        {blocks.length > 0 && (
          <div className="mt-5 min-h-0 flex-1 overflow-y-auto rounded-[var(--h-radius)] bg-black/25 px-4 py-3 text-sm leading-relaxed text-muted">
            {blocks.map((b, i) =>
              b.kind === "heading" ? (
                <p key={i} className={cx("text-xs font-semibold uppercase tracking-wide text-fg/80", i > 0 && "mt-3")}>
                  {b.text}
                </p>
              ) : b.kind === "bullet" ? (
                <p key={i} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{b.text}</span>
                </p>
              ) : (
                <p key={i}>{b.text}</p>
              ),
            )}
          </div>
        )}

        {check.assetUrl ? (
          <button
            data-nav
            data-autofocus
            disabled={working}
            onClick={() => void downloadAndInstall()}
            className="relative mt-6 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-[calc(var(--h-radius)*0.7)] bg-accent text-sm font-semibold text-accent-contrast hover:brightness-110 disabled:cursor-progress cursor-pointer"
          >
            {working && <span className="absolute inset-y-0 left-0 bg-black/20 transition-[width] duration-200" style={{ width: `${phase === "installing" ? 100 : pct}%` }} />}
            <span className="relative flex items-center gap-2">
              {working ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {label}
            </span>
          </button>
        ) : (
          <button
            data-nav
            data-autofocus
            onClick={openRelease}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-[calc(var(--h-radius)*0.7)] bg-accent text-sm font-semibold text-accent-contrast hover:brightness-110 cursor-pointer"
          >
            <ExternalLink size={16} /> Ver en GitHub
          </button>
        )}
        <p className="mt-2 text-center text-xs text-muted">
          {installError ? (
            <span className="text-red-300">No se pudo actualizar: {installError}</span>
          ) : check.assetUrl ? (
            "ejGames se cerrará, se instalará la versión nueva y volverá a abrirse. Tu biblioteca, horas, ajustes y descargas se conservan."
          ) : (
            "Esta versión no trae instalador: descárgala desde GitHub."
          )}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[13px]">
          <button data-nav onClick={openRelease} className="rounded px-1 text-muted hover:text-fg cursor-pointer">
            Ver en GitHub
          </button>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <button
              data-nav
              disabled={working}
              onClick={() => {
                void skipVersion();
                onClose();
              }}
              className="rounded px-1 text-muted hover:text-fg disabled:opacity-50 cursor-pointer"
            >
              Saltar esta versión
            </button>
            <button data-nav disabled={working} onClick={onClose} className="rounded px-1 font-semibold hover:text-accent disabled:opacity-50 cursor-pointer">
              Más tarde
            </button>
          </div>
        </div>
        <Hints className="mt-4 justify-center" items={[["accept", "Elegir"], ["back", "Más tarde"]]} />
      </div>
    </div>
  );
}
