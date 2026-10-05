// Tienda → Homebrew: emuladores que se bajan de su fuente oficial y quedan
// integrados en ejGames (puestos como emulador de sus sistemas), y los núcleos de
// RetroArch de cada sistema.

import { useEffect, useMemo, useState } from "react";
import { Cpu, Download, ExternalLink, FolderOpen, FolderPlus, HardDriveDownload, Library, Play, RefreshCw, Trash2 } from "lucide-react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errMsg, on } from "../api/tauri";
import type { EmulationCatalog, SoftwareItem } from "../api/types";
import { Button, Modal, Spinner, cx } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { bytes } from "../lib/format";
import { t } from "../lib/i18n";
import { useApp } from "../store/app";

type Progress = { phase: string; received: number; total: number };

// Lo que pide cada emulador antes del primer juego (sale de tu consola, ejGames no lo trae).
const SETUP: Record<string, string> = {
  eden: "Antes del primer juego: pulsa «Abrir» y añade en Eden las claves (prod.keys) y el firmware de tu Switch.",
  vita3k: "Antes del primer juego comercial: pulsa «Abrir» e instala en Vita3K el firmware oficial de PS Vita (el homebrew no lo necesita).",
  rpcs3: "Antes del primer juego: pulsa «Abrir» e instala en RPCS3 el firmware de PS3 (archivo PS3UPDAT.PUP).",
  pcsx2: "Antes del primer juego: pulsa «Abrir» y elige en PCSX2 la BIOS de tu PS2.",
  duckstation: "Para jugar necesita la BIOS de tu PlayStation: pulsa «Abrir» y añádela en sus ajustes.",
};

export function SoftwareStore({ onClose }: { onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings)!;
  const set = useApp((s) => s.set);
  const [items, setItems] = useState<SoftwareItem[] | null>(null);
  const [busy, setBusy] = useState<Record<string, Progress>>({});
  const [cat, setCat] = useState<EmulationCatalog | null>(null);
  const [cores, setCores] = useState<string[]>([]);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });

  const load = async (force = false) => {
    try {
      setItems(await api.emulatorStore(force));
    } catch (e) {
      toast("error", errMsg(e));
    }
  };
  const ra = items?.find((i) => i.id === "retroarch")?.installed;
  useEffect(() => {
    void load();
    void api.emulationCatalog().then(setCat);
    const un = on("emu:progress", (p) => setBusy((b) => (b[p.id] ? { ...b, [p.id]: p } : b)));
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => {
    if (ra) void api.emulatorCores(ra.exe).then(setCores).catch(() => setCores([]));
  }, [ra?.exe, settings.emulators]);

  const refreshSettings = async () => set({ settings: await api.getSettings() });

  // Carpeta de juegos de ese emulador: si sirve un solo sistema, se añade directamente.
  const addGames = async (it: SoftwareItem) => {
    if (it.platforms.length !== 1) return useApp.getState().open("settings", { tab: "library" });
    const dir = await openDialog({ directory: true, title: t("Carpeta con juegos de {system}", { system: it.systems[0] }) });
    if (typeof dir !== "string") return;
    try {
      await api.addFolder(dir, `roms:${it.platforms[0]}`);
      toast("ok", t("Carpeta añadida. Escaneando…"));
    } catch (e) {
      toast("error", errMsg(e));
    }
  };

  const install = async (it: SoftwareItem) => {
    setBusy((b) => ({ ...b, [it.id]: { phase: "download", received: 0, total: it.size ?? 0 } }));
    try {
      await api.emulatorInstall(it.id);
      await refreshSettings();
      toast("ok", t("«{name}» instalado y listo para {systems}", { name: it.name, systems: it.systems.join(", ") }), {
        label: t("Añadir juegos"),
        run: () => void addGames(it),
      });
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[it.id];
        return n;
      });
      void load();
    }
  };

  const remove = async (it: SoftwareItem) => {
    const ok = await ask(t("Se borrará {name} de la carpeta de ejGames y sus sistemas se quedarán sin emulador.", { name: it.name }), {
      title: t("Quitar {name}", { name: it.name }),
      kind: "warning",
      okLabel: t("Quitar"),
      cancelLabel: t("Cancelar"),
    });
    if (!ok) return;
    try {
      await api.emulatorUninstall(it.id);
      await refreshSettings();
    } catch (e) {
      toast("error", errMsg(e));
    }
    void load();
  };

  // Sistemas que juegan con RetroArch y si ya tienen su núcleo.
  const raSystems = useMemo(() => {
    if (!cat || !ra) return [];
    return settings.emulators
      .filter((c) => c.kind === "retroarch")
      .map((c) => {
        const p = cat.platforms.find((x) => x.id === c.platform);
        const core = c.core || p?.core || "";
        return { id: c.platform, name: p?.name ?? c.platform, core, ok: cores.includes(core) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cat, ra, settings.emulators, cores]);

  const installCore = async (platform: string) => {
    setBusy((b) => ({ ...b, ["core:" + platform]: { phase: "download", received: 0, total: 0 } }));
    try {
      await api.emulatorInstallCore(platform);
      if (ra) setCores(await api.emulatorCores(ra.exe));
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n["core:" + platform];
        return n;
      });
    }
  };

  return (
    <Modal
      ref={ref}
      title={
        <span className="flex items-center gap-2">
          <Cpu size={18} className="text-accent" /> {t("Homebrew")}
        </span>
      }
      headerExtra={
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load(true)}>
          {t("Buscar versiones nuevas")}
        </Button>
      }
      onClose={onClose}
      width="min(1080px, 95vw)"
    >
      <div className="h-full overflow-y-auto p-5">
        <p className="mb-4 text-sm text-muted">
          {t("Emuladores para jugar a tus juegos de consola. Se bajan de su web oficial y quedan puestos en ejGames para sus sistemas: solo falta añadir tu carpeta de ROMs. ejGames no incluye juegos, BIOS, claves ni firmware.")}
        </p>
        {!items ? (
          <div className="grid h-40 place-items-center">
            <Spinner size={26} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {items.map((it) => {
              const pr = busy[it.id];
              return (
                <div key={it.id} className="flex flex-col gap-2 rounded-xl bg-surface-2 p-4 ring-1 ring-line">
                  <div className="flex items-baseline gap-2">
                    <b className="text-base">{it.name}</b>
                    <span className="truncate text-xs text-muted">{it.systems.join(" · ")}</span>
                  </div>
                  <p className="text-sm text-muted">{t(it.blurb)}</p>
                  {it.installed && SETUP[it.id] && <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs">{t(SETUP[it.id])}</p>}
                  <div className="text-xs text-muted">
                    {it.installed ? t("Instalado: {v}", { v: it.installed.version }) : t("No instalado")}
                    {it.latest && ` · ${t("Última: {v}", { v: it.latest })}`}
                    {it.size ? ` · ${bytes(it.size)}` : ""}
                  </div>
                  {pr ? (
                    <div className="mt-1">
                      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className={cx("h-full bg-accent", pr.phase !== "download" && "animate-pulse")}
                          style={{ width: pr.phase === "download" && pr.total ? `${Math.min(100, (pr.received / pr.total) * 100)}%` : "100%" }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {pr.phase === "download" ? `${t("Descargando…")} ${bytes(pr.received)}${pr.total ? ` / ${bytes(pr.total)}` : ""}` : t("Instalando…")}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      {it.auto && !it.installed && (
                        <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={() => void install(it)}>
                          {t("Instalar")}
                        </Button>
                      )}
                      {it.auto && it.installed && it.update && (
                        <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={() => void install(it)}>
                          {t("Actualizar")}
                        </Button>
                      )}
                      {!it.auto && (
                        <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} onClick={() => void api.openExternal(it.site)}>
                          {t("Descargar en su web")}
                        </Button>
                      )}
                      {it.installed && (
                        <>
                          <Button size="sm" icon={<Play size={14} />} onClick={() => void api.emulatorOpen(it.id).catch((e) => toast("error", errMsg(e)))}>
                            {t("Abrir")}
                          </Button>
                          <Button size="sm" icon={<FolderPlus size={14} />} onClick={() => void addGames(it)}>
                            {t("Añadir juegos")}
                          </Button>
                          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => void api.emulatorReveal(it.id).catch((e) => toast("error", errMsg(e)))}>
                            {t("Carpeta")}
                          </Button>
                        </>
                      )}
                      {it.installed && (
                        <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void remove(it)}>
                          {t("Quitar")}
                        </Button>
                      )}
                      {it.auto && (
                        <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void api.openExternal(it.site)}>
                          {t("Web")}
                        </Button>
                      )}
                    </div>
                  )}
                  {it.error && !it.installed && <div className="text-xs text-red-300">{it.error}</div>}
                </div>
              );
            })}
          </div>
        )}

        {ra && raSystems.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-1 text-sm font-semibold">{t("Núcleos de RetroArch")}</h3>
            <p className="mb-2 text-xs text-muted">{t("RetroArch necesita un núcleo por sistema. Se bajan de libretro, el proyecto de RetroArch.")}</p>
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
              {raSystems.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-3/40">
                  <span className="flex-1">
                    {s.name} <span className="text-xs text-muted">{s.core}</span>
                  </span>
                  {s.ok ? (
                    <span className="text-xs text-muted">{t("Listo")}</span>
                  ) : busy["core:" + s.id] ? (
                    <Spinner size={14} />
                  ) : (
                    <Button size="sm" onClick={() => void installCore(s.id)}>
                      {t("Instalar núcleo")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button icon={<FolderPlus size={15} />} onClick={() => useApp.getState().open("settings", { tab: "library" })}>
            {t("Añadir carpeta de ROMs")}
          </Button>
          <Button icon={<HardDriveDownload size={15} />} onClick={() => useApp.getState().open("rom-import")}>
            {t("Importar ROMs")}
          </Button>
          <Button icon={<Library size={15} />} onClick={() => useApp.getState().open("catalogs")}>
            {t("Catálogos")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
