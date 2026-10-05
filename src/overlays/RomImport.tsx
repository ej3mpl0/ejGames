// Importar ROMs propias (volcados de tu consola, homebrew, demos): por archivo o
// por carpeta, con los .zip/.7z descomprimidos y el sistema detectado; se elige qué
// importar y si se copia a la carpeta de ejGames (<datos>\roms\<sistema>).

import { useEffect, useMemo, useState } from "react";
import { FileArchive, FilePlus2, FolderSearch, HardDriveDownload } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errMsg, on } from "../api/tauri";
import type { EmulationCatalog, RomEntry } from "../api/types";
import { Button, Empty, Modal, Spinner, Toggle, cx } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { bytes } from "../lib/format";
import { t, tn } from "../lib/i18n";
import { useApp } from "../store/app";

type Row = RomEntry & { key: string; pick: boolean; system: string };

const KIND: Record<string, string> = { update: "Actualización", dlc: "DLC" };

export function RomImport({ onClose }: { onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });
  const [cat, setCat] = useState<EmulationCatalog | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [copy, setCopy] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [emus, setEmus] = useState<Record<string, string>>({});

  useEffect(() => {
    void api.emulationCatalog().then(setCat);
    const un = on("rom:import", (p) => setProgress(p.done >= p.total ? null : p));
    return () => void un.then((f) => f());
  }, []);
  const sysName = (id: string) => cat?.platforms.find((p) => p.id === id)?.name ?? id;
  const exts = useMemo(() => [...new Set(cat?.platforms.flatMap((p) => p.exts) ?? [])], [cat]);

  const scan = async (paths: string[]) => {
    setScanning(true);
    try {
      const found: Row[] = [];
      for (const p of paths) {
        for (const e of await api.romScanFolder(p)) {
          const key = `${e.path}|${e.inner ?? ""}`;
          if (found.some((r) => r.key === key)) continue;
          found.push({ ...e, key, pick: !e.known && !!e.platform, system: e.platform ?? "" });
        }
      }
      setRows((prev) => [...(prev ?? []).filter((r) => !found.some((f) => f.key === r.key)), ...found]);
      // Con qué emulador se jugará cada sistema encontrado.
      const systems = [...new Set(found.map((r) => r.platform).filter(Boolean) as string[])];
      const pairs = await Promise.all(systems.map(async (s) => [s, (await api.emulatorForSystem(s).catch(() => null))?.name ?? ""] as const));
      setEmus((m) => ({ ...m, ...Object.fromEntries(pairs) }));
      if (!found.length) toast("info", t("No se encontraron ROMs de ningún sistema conocido"));
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setScanning(false);
    }
  };
  const pickFiles = async () => {
    const r = await openDialog({ multiple: true, title: t("ROMs a importar"), filters: [{ name: t("Juegos de consola"), extensions: [...exts, "zip", "7z"] }] });
    if (Array.isArray(r) && r.length) void scan(r);
    else if (typeof r === "string") void scan([r]);
  };
  const pickFolder = async () => {
    const r = await openDialog({ directory: true, title: t("Carpeta con ROMs") });
    if (typeof r === "string") void scan([r]);
  };

  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const k = r.system || "?";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "?" ? 1 : b[0] === "?" ? -1 : sysName(a[0]).localeCompare(sysName(b[0]))));
  }, [rows, cat]);
  const chosen = (rows ?? []).filter((r) => r.pick && r.system);
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);

  const doImport = async () => {
    setProgress({ done: 0, total: chosen.length, name: "" });
    try {
      const rep = await api.romImport(
        chosen.map((r) => ({ path: r.path, inner: r.inner, platform: r.system })),
        copy,
      );
      const parts = [tn(rep.added, "{n} juego añadido", "{n} juegos añadidos")];
      if (rep.extras) parts.push(tn(rep.extras, "{n} actualización o DLC enganchado a su juego", "{n} actualizaciones o DLC enganchados a su juego"));
      if (rep.skipped) parts.push(tn(rep.skipped, "{n} ya estaba", "{n} ya estaban"));
      toast(rep.errors.length ? "error" : "ok", parts.join(" · ") + (rep.errors.length ? ` · ${rep.errors[0]}` : ""));
      if (!rep.errors.length) onClose();
      else setRows((rs) => rs?.filter((r) => !r.pick) ?? null);
    } catch (e) {
      toast("error", errMsg(e));
    } finally {
      setProgress(null);
    }
  };

  const infoLine = (r: Row) => {
    const i = r.info;
    const bits = [
      i.kind && i.kind !== "base" ? t(KIND[i.kind] ?? i.kind) : null,
      i.title && i.title !== r.name ? i.title : null,
      i.titleId ? `ID ${i.titleId}` : null,
      i.serial && i.serial !== i.titleId ? i.serial : null,
      i.version ? `v${i.version.replace(/^v/i, "")}` : null,
      i.region ? t(i.region) : null,
    ].filter(Boolean);
    return bits.join(" · ");
  };

  return (
    <Modal
      ref={ref}
      title={
        <span className="flex items-center gap-2">
          <HardDriveDownload size={18} className="text-accent" /> {t("Importar ROMs")}
        </span>
      }
      onClose={onClose}
      width="min(1000px, 95vw)"
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <Button icon={<FilePlus2 size={15} />} onClick={() => void pickFiles()} data-autofocus>
            {t("Elegir archivos")}
          </Button>
          <Button icon={<FolderSearch size={15} />} onClick={() => void pickFolder()}>
            {t("Elegir carpeta")}
          </Button>
          <span className="text-xs text-muted">{t("Se reconoce el sistema por la extensión y la cabecera; los .zip y .7z se descomprimen.")}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {scanning && !rows?.length ? (
            <div className="grid h-40 place-items-center">
              <Spinner size={26} />
            </div>
          ) : !rows?.length ? (
            <Empty icon={<FileArchive size={40} />} title={t("Tus juegos, en tu biblioteca")}>
              {t("Importa los volcados de tus propios juegos, homebrew o demos: Switch (.nsp, .xci), PS Vita (.vpk), 3DS (.3ds, .cci, .3dsx), PSP/PS1/PS2 (.iso, .cso), N64, SNES, NES y muchos más. ejGames no incluye juegos, BIOS, claves ni firmware.")}
            </Empty>
          ) : (
            groups.map(([sys, list]) => (
              <section key={sys} className="mb-4">
                <h3 className="mb-1 flex items-baseline gap-2 text-sm font-semibold">
                  {sys === "?" ? t("¿De qué sistema?") : sysName(sys)}
                  <span className="text-xs font-normal text-muted">
                    {sys !== "?" && (emus[sys] ? t("Requiere emulador: {emu}", { emu: emus[sys] }) : t("Sin emulador todavía (instálalo en Homebrew)"))}
                  </span>
                </h3>
                {list.map((r) => (
                  <div key={r.key} className={cx("flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-3/40", r.known && "opacity-60")}>
                    <input type="checkbox" data-nav checked={r.pick} disabled={!r.system} onChange={(e) => update(r.key, { pick: e.target.checked })} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {r.name}
                        {r.inner && <span className="ml-2 text-xs text-muted">({t("en {file}", { file: r.path.split(/[\\/]/).pop() ?? "" })})</span>}
                        {r.known && <span className="ml-2 text-xs text-muted">{t("ya en la biblioteca")}</span>}
                      </div>
                      <div className="truncate text-xs text-muted">{infoLine(r)}</div>
                    </div>
                    {r.options.length > 1 && (
                      <select
                        data-nav
                        value={r.system}
                        onChange={(e) => update(r.key, { system: e.target.value, pick: !!e.target.value })}
                        className="rounded-md bg-surface-2 px-2 py-1 text-xs ring-1 ring-line"
                      >
                        <option value="">{t("Sistema…")}</option>
                        {r.options.map((o) => (
                          <option key={o} value={o}>
                            {sysName(o)}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="w-20 shrink-0 text-right text-xs text-muted">{r.size ? bytes(r.size) : ""}</span>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          <div className="min-w-[300px] flex-1">
            <Toggle
              checked={copy}
              onChange={setCopy}
              label={t("Copiar a la carpeta de ejGames")}
              hint={copy ? t("Quedan ordenadas en roms\\<sistema> dentro de los datos de ejGames.") : t("Se juegan desde donde están (lo comprimido se descomprime igualmente en la carpeta de ejGames).")}
            />
          </div>
          {progress ? (
            <span className="flex items-center gap-2 text-sm text-muted">
              <Spinner size={14} /> {t("Importando {n} de {total}…", { n: progress.done + 1, total: progress.total })} {progress.name}
            </span>
          ) : (
            <Button variant="primary" icon={<HardDriveDownload size={15} />} disabled={!chosen.length} onClick={() => void doImport()}>
              {chosen.length ? tn(chosen.length, "Importar {n} ROM", "Importar {n} ROMs") : t("Importar")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
