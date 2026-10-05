// Antes de descargar: lista de archivos del torrent (idiomas y extras
// opcionales), carpeta de destino y espacio libre.

import { useEffect, useMemo, useState } from "react";
import { Download, FolderOpen, HardDrive, Lock, ShieldAlert } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { PreparedDownload } from "../../api/types";
import { Button, Spinner, cx } from "../../components/ui";
import { Hints } from "../../components/Hints";
import { pickFolder } from "../../host/downloads";
import { useOverlayNav } from "../../input/nav";
import { HV, sizeText } from "./shared";
import { bytes } from "../../lib/format";
import { useApp } from "../../store/app";
// @ts-ignore módulo JS del kit
import { fileSelection } from "../../../sdk/kit/store.js";

interface Selection {
  isSelected(i: number): boolean;
  toggle(i: number): boolean;
  readonly bytes: number;
  readonly error: string;
  indices(): number[];
  fits(free?: number | null): boolean;
}

export function DownloadDialog({
  slug,
  title,
  prepare,
  onClose,
  onStarted,
}: {
  slug: string;
  title: string;
  /** Otra forma de pedir la lista (los torrents de los catálogos); por defecto, la ficha de la tienda. */
  prepare?: () => Promise<PreparedDownload>;
  onClose: () => void;
  onStarted: () => void;
}) {
  const toast = useApp((s) => s.toast);
  const [prep, setPrep] = useState<PreparedDownload | null>(null);
  const [error, setError] = useState("");
  const [dir, setDir] = useState<{ path: string; freeBytes?: number | null } | null>(null);
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: cancel });

  useEffect(() => {
    let alive = true;
    (prepare ? prepare() : api.downloadsPrepare(slug))
      .then((p) => {
        if (!alive) return;
        setPrep(p);
        if (p.dir) setDir({ path: p.dir, freeBytes: p.freeBytes });
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [slug]);

  const sel = useMemo(() => (prep ? (fileSelection(prep) as Selection) : null), [prep]);

  function cancel() {
    if (!prep) void api.downloadsCancelPrepare(slug);
    onClose();
  }

  async function change() {
    const p = await pickFolder("Carpeta de descargas", dir?.path);
    if (p) setDir(p);
  }

  async function start() {
    if (!prep || !sel || !dir) return;
    setBusy(true);
    try {
      await api.downloadsStart(prep.token, sel.indices(), dir.path);
      toast("ok", `«${prep.title}» añadido a Descargas`);
      onStarted();
    } catch (e) {
      toast("error", errMsg(e));
      setBusy(false);
    }
  }

  const groups = prep
    ? [
        { title: "Idiomas", hint: "Baja solo los que vayas a usar.", files: prep.files.filter((f) => f.kind === "selective") },
        { title: "Extras opcionales", hint: "Vídeos, bandas sonoras, contenido adicional…", files: prep.files.filter((f) => f.kind === "optional") },
      ].filter((g) => g.files.length)
    : [];
  const required = prep?.files.filter((f) => f.required) ?? [];
  const fits = sel && dir ? sel.fits(dir.freeBytes) : true;

  return (
    <div className="overlay-enter absolute inset-0 z-[44] grid place-items-center bg-black/60 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div ref={ref} data-focus-trap className="panel-enter glass flex max-h-[86vh] w-[min(640px,94vw)] flex-col overflow-hidden rounded-[calc(var(--h-radius)*1.4)] shadow-2xl">
        <header className="border-b border-line px-5 py-4">
          <h2 className="truncate text-base font-semibold">Descargar {title}</h2>
          {prep && <p className="mt-0.5 truncate text-xs text-muted">{prep.name}</p>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!prep && !error && (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted">
              <Spinner size={26} />
              Buscando el torrent y su lista de archivos…
              <span className="text-xs">Puede tardar hasta un par de minutos si hay pocas fuentes.</span>
            </div>
          )}
          {error && <p className="py-8 text-center text-sm text-red-300">{error}</p>}
          {prep && sel && (
            <>
              {prep.hypervisor && (
                <div className="mb-4 flex gap-3 rounded-[var(--h-radius)] bg-red-500/10 p-3 text-sm leading-snug ring-1 ring-red-400/30">
                  <ShieldAlert size={16} className="mt-0.5 shrink-0 text-red-300" />
                  <span className="flex-1 text-fg/90">{HV.download}</span>
                </div>
              )}
              <div className="mb-4 flex items-center gap-3 rounded-[var(--h-radius)] bg-surface-2/70 p-3 text-sm ring-1 ring-line">
                <Lock size={16} className="shrink-0 text-muted" />
                <span className="flex-1">
                  Imprescindible: {required.length} archivos · {bytes(required.reduce((a, f) => a + f.size, 0))}
                </span>
              </div>
              {groups.map((g) => (
                <section key={g.title} className="mb-4">
                  <h3 className="text-sm font-semibold">{g.title}</h3>
                  <p className="mb-2 text-xs text-muted">{g.hint}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {g.files.map((f) => {
                      const on = sel.isSelected(f.index);
                      return (
                        <button
                          key={f.index}
                          data-nav
                          onClick={() => {
                            sel.toggle(f.index);
                            redraw((n) => n + 1);
                          }}
                          className={cx(
                            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ring-1 cursor-pointer",
                            on ? "bg-accent/15 ring-accent/60" : "bg-surface-3/40 ring-line hover:bg-surface-3/70",
                          )}
                        >
                          <span className={cx("grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px]", on ? "border-accent bg-accent text-accent-contrast" : "border-line")}>
                            {on && "✓"}
                          </span>
                          <span className="flex-1 truncate">{f.label}</span>
                          <span className="text-xs text-muted">{bytes(f.size)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {groups.length > 0 && (
                <p className="mb-4 text-xs text-muted">Al instalar, desmarca en el instalador lo que no hayas descargado.</p>
              )}
              <div className="rounded-[var(--h-radius)] bg-surface-2/70 p-3 ring-1 ring-line">
                <div className="flex items-center gap-3">
                  <HardDrive size={16} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="truncate">{dir?.path || "Elige dónde guardar las descargas"}</div>
                    {dir?.freeBytes != null && <div className={cx("text-xs", fits ? "text-muted" : "text-red-300")}>{bytes(dir.freeBytes)} libres</div>}
                  </div>
                  <Button size="sm" icon={<FolderOpen size={14} />} onClick={change} data-autofocus={!dir || undefined}>
                    {dir ? "Cambiar" : "Elegir"}
                  </Button>
                </div>
                {prep.installSize && (
                  <p className="mt-2 text-xs text-muted">
                    Instalado ocupará {sizeText(prep.installSize)}
                    {prep.installFreeBytes != null && ` · ${bytes(prep.installFreeBytes)} libres en ${prep.installDir}`}.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        <footer className="flex items-center gap-3 border-t border-line px-5 py-3">
          <Hints items={[["accept", "Elegir"], ["back", "Cancelar"]]} className="flex-1" />
          <Button variant="ghost" onClick={cancel}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            icon={busy ? <Spinner size={14} /> : <Download size={16} />}
            disabled={!prep || !sel || !dir || !!sel.error || !fits || busy}
            onClick={start}
            data-autofocus={(prep && dir) || undefined}
            title={sel?.error || (!fits ? "No cabe en ese disco" : "")}
          >
            {sel ? `Descargar ${bytes(sel.bytes)}` : "Descargar"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
