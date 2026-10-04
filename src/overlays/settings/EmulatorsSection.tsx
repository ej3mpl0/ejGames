// Ajustes → Biblioteca → Consolas: carpetas de ROMs por sistema y el emulador de
// cada sistema (RetroArch con un núcleo, un emulador independiente o uno propio).

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderPlus, Search, Gamepad2 } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { EmulatorCfg, EmulatorFound, EmulationCatalog } from "../../api/types";
import { Button, Cycle, Field, Section, TextInput } from "../../components/ui";
import { t } from "../../lib/i18n";
import { useApp } from "../../store/app";

export function EmulatorsSection({ onFolderAdded }: { onFolderAdded: () => void }) {
  const settings = useApp((s) => s.settings)!;
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [cat, setCat] = useState<EmulationCatalog | null>(null);
  const [found, setFound] = useState<EmulatorFound[]>([]);
  const [romSystem, setRomSystem] = useState("snes");
  const [open, setOpen] = useState<string | null>(null);
  const [cores, setCores] = useState<Record<string, string[]>>({});

  useEffect(() => {
    void api.emulationCatalog().then(setCat);
  }, []);

  const save = async (emulators: EmulatorCfg[]) => set({ settings: await api.updateSettings({ emulators }) });
  const cfgOf = (id: string) => settings.emulators.find((e) => e.platform === id);
  const upsert = (c: EmulatorCfg) => save([...settings.emulators.filter((e) => e.platform !== c.platform), c]);

  const detect = async () => {
    const f = await api.emulatorsDetect().catch(() => []);
    setFound(f);
    toast(f.length ? "ok" : "info", f.length ? t("Encontrados: {list}", { list: f.map((x) => x.name).join(", ") }) : t("No se ha encontrado ningún emulador. Elige su .exe a mano."));
  };

  const addRoms = async () => {
    const dir = await openDialog({ directory: true, title: t("Carpeta con ROMs") });
    if (typeof dir !== "string") return;
    try {
      await api.addFolder(dir, `roms:${romSystem}`);
      toast("ok", t("Carpeta añadida. Escaneando…"));
      onFolderAdded();
    } catch (e) {
      toast("error", errMsg(e));
    }
  };

  const pickExe = async (id: string, base: Partial<EmulatorCfg>) => {
    const exe = await openDialog({ multiple: false, title: t("Emulador"), filters: [{ name: t("Programas"), extensions: ["exe"] }] });
    if (typeof exe !== "string") return;
    await upsert({ platform: id, kind: "custom", preset: "", core: "", args: "", ...base, exe });
  };

  const useFound = async (id: string, f: EmulatorFound) => {
    const isRA = f.preset === "retroarch";
    if (isRA) setCores((c) => ({ ...c, [id]: f.cores }));
    await upsert({ platform: id, kind: isRA ? "retroarch" : "preset", preset: f.preset, exe: f.exe, core: "", args: "" });
  };

  if (!cat) return null;
  const sysOpts = cat.platforms.map((p) => ({ value: p.id, label: p.name }));

  return (
    <Section title={t("Consolas")}>
      <p className="px-3 pb-2 text-xs text-muted">
        {t("Añade una carpeta de ROMs de un sistema y elige con qué emulador se juega. ejGames lanza el emulador con la ROM, cuenta las horas y saca el overlay.")}
      </p>
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
        <div className="w-64">
          <Cycle label="" value={romSystem} options={sysOpts} onChange={setRomSystem} />
        </div>
        <Button size="sm" variant="primary" icon={<FolderPlus size={14} />} onClick={() => void addRoms()}>
          {t("Añadir carpeta de ROMs")}
        </Button>
        <Button size="sm" icon={<Search size={14} />} onClick={() => void detect()}>
          {t("Buscar emuladores")}
        </Button>
      </div>

      {cat.platforms.map((p) => {
        const c = cfgOf(p.id);
        const compatible = found.filter((f) => f.preset === "retroarch" || p.presets.includes(f.preset));
        const expanded = open === p.id;
        return (
          <div key={p.id} className="px-3 py-1.5">
            <button data-nav className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-surface-3/40" onClick={() => setOpen(expanded ? null : p.id)}>
              <Gamepad2 size={15} className="text-muted" />
              <span className="flex-1">{p.name}</span>
              <span className="truncate text-xs text-muted">{c ? `${c.kind === "retroarch" ? "RetroArch" : c.kind === "preset" ? cat.presets.find((x) => x.id === c.preset)?.name : t("Propio")}` : t("Sin emulador")}</span>
            </button>
            {expanded && (
              <div className="mb-2 ml-7 flex flex-col gap-2 border-l border-line pl-4">
                {compatible.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {compatible.map((f) => (
                      <Button key={f.preset} size="sm" onClick={() => void useFound(p.id, f)}>
                        {t("Usar {name}", { name: f.name })}
                      </Button>
                    ))}
                  </div>
                )}
                <Field label={t("Programa")}>
                  <div className="flex gap-2">
                    <TextInput readOnly value={c?.exe ?? ""} placeholder={t("Elige el .exe del emulador")} />
                    <Button size="sm" onClick={() => void pickExe(p.id, c ? { kind: c.kind, preset: c.preset, core: c.core, args: c.args } : {})}>
                      {t("Elegir…")}
                    </Button>
                  </div>
                </Field>
                {c && c.kind === "retroarch" && (
                  <Field label={t("Núcleo de RetroArch")}>
                    <div className="flex gap-2">
                      <TextInput
                        key={c.exe}
                        defaultValue={c.core}
                        placeholder={p.core || t("Obligatorio")}
                        onBlur={(e) => e.target.value !== c.core && void upsert({ ...c, core: e.target.value.trim() })}
                        list={`cores-${p.id}`}
                        onFocus={() => c.exe && !cores[p.id] && void api.emulatorCores(c.exe).then((v) => setCores((x) => ({ ...x, [p.id]: v })))}
                      />
                      <datalist id={`cores-${p.id}`}>{(cores[p.id] ?? []).map((n) => <option key={n} value={n} />)}</datalist>
                    </div>
                  </Field>
                )}
                {c && c.kind !== "retroarch" && (
                  <Field label={t("Argumentos ({rom} = la ROM)")}>
                    <TextInput
                      key={c.exe}
                      defaultValue={c.args}
                      placeholder={c.kind === "preset" ? cat.presets.find((x) => x.id === c.preset)?.args : '"{rom}"'}
                      onBlur={(e) => e.target.value !== c.args && void upsert({ ...c, args: e.target.value })}
                    />
                  </Field>
                )}
                {c && (
                  <div>
                    <Button size="sm" variant="ghost" onClick={() => void save(settings.emulators.filter((e) => e.platform !== p.id))}>
                      {t("Quitar emulador")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}
