// Ajustes → Apariencia → «De la comunidad»: temas de otras personas, con su huella
// comprobada. Solo habla con la red cuando se pulsa «Ver temas».

import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { CommunityTheme } from "../../api/types";
import { Button, Section, Spinner } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useApp } from "../../store/app";

/** a > b, comparando números separados por puntos («1.10.0» > «1.9.0»). */
function newer(a: string, b: string) {
  const n = (v: string) => v.split(/[^0-9]+/).filter(Boolean).map(Number);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

export function CommunityThemes({ onInstalled }: { onInstalled: () => void }) {
  const toast = useApp((s) => s.toast);
  const [list, setList] = useState<CommunityTheme[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setList(await api.communityThemes());
    } catch (e) {
      toast("error", t("No se pudo cargar la lista: {e}", { e: errMsg(e) }));
    } finally {
      setLoading(false);
    }
  };

  const install = async (th: CommunityTheme) => {
    setBusy(th.id);
    try {
      await api.communityThemeInstall(th.id);
      toast("ok", t("«{name}» instalado", { name: th.name }));
      onInstalled();
      await load();
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title={t("De la comunidad")}
      actions={
        <Button size="sm" variant="ghost" icon={loading ? <Spinner size={14} /> : <RefreshCw size={14} />} disabled={loading} onClick={() => void load()}>
          {list ? t("Actualizar lista") : t("Ver temas")}
        </Button>
      }
    >
      {!list && <p className="px-3 pb-2 text-xs text-muted">{t("Temas hechos por otras personas. Se descargan de GitHub y ejGames comprueba su huella antes de instalarlos.")}</p>}
      {list && list.length === 0 && <p className="px-3 py-2 text-sm text-muted">{t("Todavía no hay temas en la lista. ¿Quieres añadir el tuyo? Mira «community» en el repositorio de ejGames.")}</p>}
      {list?.map((th) => (
        <div key={th.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          {th.preview && <img src={th.preview} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">
              {th.name} <span className="text-xs font-normal text-muted">v{th.version} · {th.author}</span>
            </div>
            <div className="truncate text-xs text-muted">{th.description}</div>
          </div>
          {th.installed && !newer(th.version, th.installed) ? (
            <span className="text-xs text-muted">{t("Instalado")}</span>
          ) : (
            <Button size="sm" variant="primary" icon={<Download size={14} />} disabled={busy !== null} onClick={() => void install(th)}>
              {th.installed ? t("Actualizar") : t("Instalar")}
            </Button>
          )}
        </div>
      ))}
    </Section>
  );
}
