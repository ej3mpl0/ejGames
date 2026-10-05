// Selector del emulador de una plataforma: los de Ajustes, los de emulators.json,
// los instalados desde ejGames y los encontrados en el disco. Lo elegido queda en
// Ajustes → Biblioteca → Emuladores para esa plataforma.

import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import type { EmulatorOption, Platform } from "../../api/types";
import { errMsg } from "../../api/tauri";
import { emulatorOptions, setPreferredEmulator } from "../../host/emulator-launcher";
import { isEmulated } from "../../lib/catalog/platforms";
import { t } from "../../lib/i18n";
import { useApp } from "../../store/app";
import { Button, Spinner } from "../ui";

const ORIGIN: Record<EmulatorOption["origin"], string> = {
  settings: "Ajustes",
  json: "emulators.json",
  software: "Instalado desde ejGames",
  detected: "Encontrado en el disco",
};

export function EmulatorSelector({ platform, onChange }: { platform: Platform | null; onChange?: (name: string) => void }) {
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const [opts, setOpts] = useState<EmulatorOption[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!platform || !isEmulated(platform)) return setOpts([]);
    let alive = true;
    setOpts(null);
    emulatorOptions(platform)
      .then((o) => alive && setOpts(o))
      .catch(() => alive && setOpts([]));
    return () => {
      alive = false;
    };
  }, [platform, settings?.emulators]);

  if (!platform || !isEmulated(platform)) return <p className="text-xs text-muted">{t("Esta plataforma no se juega con emulador desde ejGames.")}</p>;
  if (!opts) return <Spinner size={14} />;
  if (!opts.length)
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-amber-300/90">
        {t("No hay ningún emulador para esta plataforma.")}
        <Button size="sm" icon={<Cpu size={13} />} onClick={() => useApp.getState().open("software")}>
          {t("Instalar emulador")}
        </Button>
      </div>
    );

  const current = opts.find((o) => o.active)?.key ?? "";
  const pick = async (key: string) => {
    const o = opts.find((x) => x.key === key);
    setSaving(true);
    try {
      await setPreferredEmulator(platform, o ? o.cfg : null);
      onChange?.(o?.name ?? "");
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">{t("Emulador")}:</span>
      <select data-nav value={current} disabled={saving} onChange={(e) => void pick(e.target.value)} className="rounded-lg bg-surface-3 px-2 py-1 text-sm ring-1 ring-line">
        {opts.map((o) => (
          <option key={o.key} value={o.key}>
            {o.name} — {t(ORIGIN[o.origin])}
          </option>
        ))}
      </select>
      {saving && <Spinner size={13} />}
    </label>
  );
}
