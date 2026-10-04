// Ajustes → Sistema → «Volver a una versión anterior»: si una actualización sale
// mal, se reinstala la versión que quieras desde GitHub. Antes se guarda una copia
// de seguridad de la biblioteca, por si la versión vieja no entiende algo nuevo.

import { useState } from "react";
import { History } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, errMsg, on } from "../../api/tauri";
import type { ReleaseEntry } from "../../api/types";
import { Button, Section, Spinner } from "../../components/ui";
import { bytes } from "../../lib/format";
import { locale, t } from "../../lib/i18n";
import { useApp } from "../../store/app";

/** a < b, comparando 1.10.0 con 1.9.0 como números. */
const older = (a: string, b: string) => {
  const n = (v: string) => v.split(".").map(Number);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

export function RollbackSection() {
  const version = useApp((s) => s.boot?.version ?? "");
  const toast = useApp((s) => s.toast);
  const [list, setList] = useState<ReleaseEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setList((await api.updateVersions()).filter((r) => r.version !== version));
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const install = async (r: ReleaseEntry) => {
    const ok = await ask(
      t("Se instalará ejGames {version} encima de la actual. Antes se guarda una copia de tu biblioteca en la carpeta de datos (rollback). Tus horas, ajustes y descargas se conservan, pero lo que añadieron versiones nuevas puede no verse en la antigua.", { version: r.version }),
      { title: t("Volver a la versión {version}", { version: r.version }), kind: "warning", okLabel: t("Instalar"), cancelLabel: t("Cancelar") },
    );
    if (!ok) return;
    setBusy(r.version);
    setProgress({ received: 0, total: r.assetSize ?? 0 });
    const un = await on("update:progress", setProgress);
    try {
      const file = await api.updateDownloadVersion(r.version);
      await api.updateInstall(file.path);
    } catch (e) {
      toast("error", errMsg(e));
      setBusy(null);
      setProgress(null);
    } finally {
      un();
    }
  };

  return (
    <Section
      title={t("Volver a una versión anterior")}
      actions={
        <Button size="sm" variant="ghost" icon={loading ? <Spinner size={14} /> : <History size={14} />} disabled={loading || !!busy} onClick={() => void load()}>
          {list ? t("Actualizar lista") : t("Ver versiones")}
        </Button>
      }
    >
      {!list && <p className="px-3 pb-2 text-xs text-muted">{t("Si una actualización te da problemas, puedes reinstalar la versión anterior desde GitHub.")}</p>}
      {list?.map((r) => (
        <div key={r.version} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="flex-1">
            ejGames {r.version}
            {r.publishedAt && <span className="ml-2 text-xs text-muted">{new Date(r.publishedAt).toLocaleDateString(locale(), { dateStyle: "medium" })}</span>}
            {older(version, r.version) && <span className="ml-2 rounded bg-accent/20 px-1.5 text-[10px] uppercase text-accent">{t("Más nueva")}</span>}
          </span>
          {busy === r.version && progress ? (
            <span className="text-xs text-muted">
              {bytes(progress.received)}
              {progress.total ? ` / ${bytes(progress.total)}` : ""}
            </span>
          ) : (
            <Button size="sm" disabled={!!busy} onClick={() => void install(r)}>
              {t("Instalar esta versión")}
            </Button>
          )}
        </div>
      ))}
    </Section>
  );
}
