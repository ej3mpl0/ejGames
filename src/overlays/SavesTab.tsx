// Pestaña «Partidas guardadas» del editor de juego: dónde las guarda el juego,
// copias hechas y restaurarlas.

import { useCallback, useEffect, useState } from "react";
import { open as openDialog, ask } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Plus, Save, Trash2 } from "lucide-react";
import { api, errMsg, on } from "../api/tauri";
import type { SavesInfo } from "../api/types";
import { Button, Section, Spinner, Toggle } from "../components/ui";
import { bytes } from "../lib/format";
import { locale, t, tn } from "../lib/i18n";
import { useApp } from "../store/app";

const SOURCE: Record<string, string> = {
  manifest: "Ludusavi",
  emulator: "Emulador de Steam",
  steam: "Steam Cloud",
  manual: "A mano",
};

export function SavesTab({ id }: { id: number }) {
  const settings = useApp((s) => s.settings)!;
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const running = useApp((s) => s.running.some((r) => r.gameId === id));
  const [info, setInfo] = useState<SavesInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.savesInfo(id).then(setInfo).catch((e) => toast("error", errMsg(e))), [id]);
  useEffect(() => {
    void load();
    const un = on("saves:changed", (e) => e.gameId === id && void load());
    return () => void un.then((f) => f());
  }, [id]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast("ok", ok);
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const addPath = async () => {
    const dir = await openDialog({ directory: true, title: t("Carpeta de partidas guardadas") });
    if (typeof dir === "string") await run(() => api.savesAddPath(id, dir));
  };

  const restore = async (snap: number, when: string) => {
    const yes = await ask(t("Se sobrescribirán las partidas guardadas actuales por las del {when}. Antes se guarda una copia de las de ahora.", { when }), {
      title: t("Restaurar partidas"),
      kind: "warning",
      okLabel: t("Restaurar"),
      cancelLabel: t("Cancelar"),
    });
    if (yes) await run(async () => toast("ok", tn(await api.savesRestore(id, snap), "{n} archivo restaurado", "{n} archivos restaurados")));
  };

  if (!info) {
    return (
      <div className="grid h-40 place-items-center">
        <Spinner size={24} />
      </div>
    );
  }
  const when = (at: number) => new Date(at * 1000).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <Section title={t("Dónde guarda este juego")}>
        {info.paths.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted">
            {info.known
              ? t("Ludusavi conoce este juego, pero no hay partidas guardadas en este PC todavía.")
              : t("No se han encontrado partidas guardadas. Si sabes dónde están, añade la carpeta.")}
          </p>
        )}
        {info.paths.map((p) => (
          <div key={p.path} className="flex items-center gap-3 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate" title={p.path}>
                {p.path}
              </div>
              <div className="text-xs text-muted">
                {t(SOURCE[p.source] ?? p.source)} · {tn(p.files, "{n} archivo", "{n} archivos")} · {bytes(p.bytes)}
              </div>
            </div>
            <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => void api.savesOpen(id, p.path)} />
            {p.source === "manual" && <Button size="sm" icon={<Trash2 size={14} />} onClick={() => void run(() => api.savesRemovePath(id, p.path))} />}
          </div>
        ))}
        <div className="flex flex-wrap gap-2 p-2">
          <Button size="sm" icon={<Plus size={14} />} onClick={() => void addPath()}>
            {t("Añadir carpeta")}
          </Button>
        </div>
      </Section>

      <Section title={t("Copias")}>
        <Toggle
          label={t("Copiar las partidas al cerrar cada juego")}
          hint={t("Solo si han cambiado. Se guardan las últimas {n} de cada juego.", { n: settings.savesKeep })}
          checked={settings.savesAuto}
          onChange={async (v) => set({ settings: await api.updateSettings({ savesAuto: v }) })}
        />
        <div className="p-2">
          <Button
            variant="primary"
            icon={<Save size={15} />}
            disabled={busy || info.paths.length === 0}
            onClick={() =>
              void run(async () => {
                const s = await api.savesBackup(id);
                toast("ok", s ? t("Copia guardada ({size})", { size: bytes(s.size) }) : t("Sin cambios desde la última copia"));
              })
            }
          >
            {t("Hacer una copia ahora")}
          </Button>
        </div>
        {info.snapshots.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1">
              {when(s.at)}
              {s.note && <span className="ml-2 text-xs text-muted">{s.note}</span>}
            </span>
            <span className="text-xs text-muted">{bytes(s.size)}</span>
            <Button size="sm" disabled={busy || running} onClick={() => void restore(s.id, when(s.at))}>
              {t("Restaurar")}
            </Button>
            <Button size="sm" icon={<Trash2 size={14} />} disabled={busy} onClick={() => void run(() => api.savesDelete(id, s.id))} />
          </div>
        ))}
        {info.snapshots.length === 0 && <p className="px-3 py-2 text-sm text-muted">{t("Todavía no hay copias.")}</p>}
      </Section>
    </div>
  );
}
