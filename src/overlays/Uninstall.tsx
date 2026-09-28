// «Desinstalar»: el host enseña qué va a pasar y pide confirmación. Los temas
// solo pueden abrir este diálogo (ejg.game.uninstall), nunca desinstalar solos.

import { useEffect, useState } from "react";
import { FolderX, Loader2, Trash2 } from "lucide-react";
import { api } from "../api/tauri";
import type { UninstallPlan } from "../api/types";
import { Hints } from "../components/Hints";
import { useOverlayNav } from "../input/nav";
import { bytes } from "../lib/format";
import { useApp } from "../store/app";

export function UninstallDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const [plan, setPlan] = useState<UninstallPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: () => !busy && onClose() });

  useEffect(() => {
    api.uninstallPlan(id).then(setPlan, (e) => setError(String(e?.message ?? e)));
  }, [id]);

  const go = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const r = await api.uninstallGame(id);
      if (r === "started") {
        toast("info", `Se ha abierto el desinstalador de «${plan.title}». Al terminar, desaparecerá de tu biblioteca.`);
      }
      onClose();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };

  const size = plan?.sizeBytes ? ` (${bytes(plan.sizeBytes)})` : "";
  const text = !plan
    ? ""
    : plan.method === "uninstaller"
        ? `Se abrirá su desinstalador (${plan.program}). Cuando termine, ejGames lo quitará de tu biblioteca junto con sus horas.`
        : `Este juego no trae desinstalador: su carpeta${size} irá a la papelera de reciclaje y el juego saldrá de tu biblioteca junto con sus horas.`;

  return (
    <div className="overlay-enter absolute inset-0 z-[45] grid place-items-center bg-black/60 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={ref} data-focus-trap className="panel-enter glass w-[min(480px,92vw)] rounded-[calc(var(--h-radius)*1.4)] p-7 shadow-2xl">
        <div className="mb-3 flex justify-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15 text-red-300">
            {plan?.method === "folder" ? <FolderX size={28} /> : <Trash2 size={28} />}
          </span>
        </div>
        <h2 className="text-center text-[20px] font-semibold">Desinstalar {plan ? `«${plan.title}»` : ""}</h2>
        {!plan && !error && (
          <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Buscando cómo desinstalarlo…
          </p>
        )}
        {plan && <p className="mt-3 text-center text-sm leading-relaxed text-muted">{text}</p>}
        {plan?.dir && (
          <p className="mt-3 truncate rounded-[var(--h-radius)] bg-black/25 px-3 py-2 text-center font-mono text-xs text-muted" title={plan.dir}>
            {plan.dir}
          </p>
        )}
        {error && <p className="mt-4 rounded-[var(--h-radius)] bg-red-500/10 px-3 py-2 text-center text-sm text-red-300">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button
            data-nav
            data-autofocus={!plan || undefined}
            disabled={busy}
            onClick={onClose}
            className="h-11 flex-1 rounded-[calc(var(--h-radius)*0.7)] bg-surface-3/80 text-sm font-semibold hover:brightness-125 disabled:opacity-50 cursor-pointer"
          >
            Cancelar
          </button>
          {plan && (
            <button
              data-nav
              data-autofocus
              disabled={busy}
              onClick={() => void go()}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[calc(var(--h-radius)*0.7)] bg-red-600 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-progress disabled:opacity-70 cursor-pointer"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              Desinstalar
            </button>
          )}
        </div>
        <Hints className="mt-4 justify-center" items={[["accept", "Elegir"], ["back", "Cancelar"]]} />
      </div>
    </div>
  );
}
