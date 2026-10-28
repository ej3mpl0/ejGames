// Una sola vez, al abrir la 1.8 con el tema anterior (Moneda): ¿probar Telón?
// Si dice que sí, se cambia el tema del perfil; se puede volver desde Ajustes → Apariencia.

import { api, errMsg } from "../api/tauri";
import { Button } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { DEFAULT_THEME, useApp } from "../store/app";

export function TryTelon({ onClose }: { onClose: () => void }) {
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });
  const profile = useApp((s) => s.profile);
  const { upsertProfile: upsert, set, toast } = useApp.getState();

  async function tryIt() {
    if (!profile) return onClose();
    try {
      const p = await api.updateProfile(profile.id, { themeId: DEFAULT_THEME });
      upsert(p);
      set({ themeOverride: null, safeOrigin: false });
      onClose();
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  return (
    <div className="overlay-enter absolute inset-0 z-[45] grid place-items-center bg-black/70" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} data-focus-trap className="panel-enter glass w-[min(520px,92vw)] overflow-hidden rounded-[calc(var(--h-radius)*1.4)] shadow-2xl">
        <div className="relative h-44 overflow-hidden bg-black">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_60%,#3a3a3a,#000_70%)]" />
          <svg viewBox="0 0 100 100" className="absolute left-7 top-1/2 h-16 w-16 -translate-y-1/2" aria-hidden="true">
            <circle cx="50" cy="50" r="50" fill="#ff3a2d" />
            <circle cx="50" cy="50" r="38" fill="none" stroke="#0e0e10" strokeWidth="3.4" />
            <rect x="27" y="44.75" width="46" height="10.5" fill="#0e0e10" />
          </svg>
          <p className="absolute left-28 top-1/2 -translate-y-1/2 text-[44px] font-light leading-none tracking-tight text-white" style={{ fontFamily: '"Segoe UI Variable Display", "Segoe UI", sans-serif' }}>
            Telón
          </p>
        </div>
        <div className="p-7 pt-6">
          <h2 className="text-[22px] font-semibold">Hay un tema nuevo: Telón</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Menos cosas por pantalla: el arte del juego a sangre, negro puro y nada de cajas. Tu biblioteca, tus colecciones y tus ajustes no cambian.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">Si no te convence, vuelves a Moneda en Ajustes → Apariencia.</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Ahora no
            </Button>
            <Button variant="primary" onClick={tryIt} autoFocus>
              Probar Telón
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
