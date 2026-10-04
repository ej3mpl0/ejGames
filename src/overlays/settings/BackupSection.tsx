// Ajustes → Sistema → Copias de seguridad: exportar, restaurar y copias
// automáticas en una carpeta (una de OneDrive o Drive lleva la biblioteca a otro PC).

import { useEffect, useState } from "react";
import { ArchiveRestore, FolderOpen, Save } from "lucide-react";
import { ask, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, errMsg } from "../../api/tauri";
import type { BackupInfo, Settings } from "../../api/types";
import { Button, Cycle, Section, Toggle } from "../../components/ui";
import { bytes } from "../../lib/format";
import { locale, t, tn } from "../../lib/i18n";
import { useApp } from "../../store/app";

export function backupLabel(b: BackupInfo) {
  const date = new Date(b.created * 1000).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
  return t("{pc} · {date} · {games}", { pc: b.pc, date, games: tn(b.games, "{n} juego", "{n} juegos") });
}

/** Pregunta y restaura (ejGames se reinicia). */
export async function restoreBackup(b: BackupInfo) {
  const okd = await ask(
    t(
      "Se reemplazarán la biblioteca, las horas, los perfiles, los ajustes y los temas de este PC por los de la copia ({label}). ejGames se reiniciará. Lo actual se guarda en la carpeta de datos, en .before-restore.",
      { label: backupLabel(b) },
    ),
    { title: t("Restaurar copia"), kind: "warning", okLabel: t("Restaurar"), cancelLabel: t("Cancelar") },
  );
  if (!okd) return;
  try {
    await api.backupRestore(b.path);
  } catch (e) {
    useApp.getState().toast("error", errMsg(e));
  }
}

const KEEP: { value: string; label: string }[] = ["3", "5", "10", "20"].map((v) => ({ value: v, label: v }));

export function BackupSection() {
  const settings = useApp((s) => s.settings)!;
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<BackupInfo[]>([]);
  const save = async (patch: Partial<Settings>) => set({ settings: await api.updateSettings(patch) });

  useEffect(() => {
    void api.backupList().then(setList).catch(() => setList([]));
  }, [settings.backupDir, settings.backupLast]);

  const exportNow = async () => {
    const day = new Date().toISOString().slice(0, 10);
    const dest = await saveDialog({ defaultPath: `ejGames-${day}.zip`, filters: [{ name: t("Copia de ejGames"), extensions: ["zip"] }] });
    if (!dest) return;
    setBusy(true);
    try {
      const b = await api.backupCreate(dest, settings.backupMedia);
      toast("success", t("Copia guardada ({size})", { size: bytes(b.size) }));
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const importNow = async () => {
    const file = await openDialog({ multiple: false, filters: [{ name: t("Copia de ejGames"), extensions: ["zip"] }] });
    if (typeof file !== "string") return;
    try {
      await restoreBackup(await api.backupInspect(file));
    } catch (e) {
      toast("error", errMsg(e));
    }
  };

  const pickDir = async () => {
    const dir = await openDialog({ directory: true, defaultPath: settings.backupDir || undefined });
    if (typeof dir === "string") await save({ backupDir: dir, backupAuto: true });
  };

  return (
    <Section title={t("Copias de seguridad")}>
      <p className="px-3 pb-2 text-xs text-muted">
        {t(
          "Biblioteca, horas, logros, perfiles, notas, colecciones, ajustes y temas propios en un .zip. Si una carpeta de copias está en OneDrive o Google Drive, la biblioteca te sigue a otro PC: allí, ejGames ofrece restaurar la copia más nueva.",
        )}
      </p>
      <div className="flex flex-wrap gap-2 p-2">
        <Button variant="primary" icon={<Save size={15} />} disabled={busy} onClick={() => void exportNow()}>
          {busy ? t("Guardando…") : t("Hacer una copia")}
        </Button>
        <Button icon={<ArchiveRestore size={15} />} disabled={busy} onClick={() => void importNow()}>
          {t("Restaurar desde un archivo")}
        </Button>
      </div>
      <Toggle
        label={t("Incluir el arte descargado")}
        hint={t("Portadas, fondos y tus imágenes. Ocupa más, pero no hay que volver a bajarlo.")}
        checked={settings.backupMedia}
        onChange={(v) => save({ backupMedia: v })}
      />
      <Toggle
        label={t("Copias automáticas")}
        hint={settings.backupDir ? t("Como mucho una al día, en {dir}", { dir: settings.backupDir }) : t("Elige una carpeta para activarlas.")}
        checked={settings.backupAuto && !!settings.backupDir}
        onChange={(v) => (v && !settings.backupDir ? void pickDir() : save({ backupAuto: v }))}
      />
      <div className="flex items-center gap-3 px-3 py-2 text-sm">
        <span className="flex-1 truncate text-muted">{settings.backupDir || t("Sin carpeta de copias")}</span>
        <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => void pickDir()}>
          {settings.backupDir ? t("Cambiar") : t("Elegir carpeta")}
        </Button>
      </div>
      {settings.backupDir && (
        <Cycle
          label={t("Copias de este PC que se guardan")}
          value={String(settings.backupKeep)}
          options={KEEP}
          onChange={(v) => save({ backupKeep: Number(v) })}
        />
      )}
      {list.length > 0 && (
        <div className="px-3 pb-2 pt-1">
          <p className="pb-1 text-xs uppercase tracking-wide text-muted">{t("En la carpeta")}</p>
          {list.slice(0, 8).map((b) => (
            <div key={b.path} className="flex items-center gap-3 py-1 text-sm">
              <span className="flex-1 truncate">{backupLabel(b)}</span>
              <span className="text-xs text-muted">{bytes(b.size)}</span>
              <Button size="sm" onClick={() => void restoreBackup(b)}>
                {t("Restaurar")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
