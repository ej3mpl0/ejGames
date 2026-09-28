import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FilePlus2, FolderPlus, RefreshCw, Trash2, Eraser } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { FolderInspection, LibraryFolder } from "../../api/types";
import { Button, Cycle, Section } from "../../components/ui";
import { relative } from "../../lib/format";
import { useApp } from "../../store/app";

export function LibraryTab({ autoAdd }: { autoAdd?: boolean }) {
  const toast = useApp((s) => s.toast);
  const scan = useApp((s) => s.scan);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [pending, setPending] = useState<FolderInspection | null>(null);

  const load = () => api.listFolders().then(setFolders).catch(() => {});
  useEffect(() => {
    void load();
  }, [scan?.phase]);
  useEffect(() => {
    if (autoAdd) void pick();
  }, []);

  async function pick() {
    const path = await openDialog({ directory: true, multiple: false, title: "Carpeta con juegos" });
    if (typeof path !== "string") return;
    try {
      setPending(await api.inspectFolder(path));
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  async function confirmAdd() {
    if (!pending) return;
    try {
      await api.addFolder(pending.path, pending.suggestedMode);
      toast("ok", "Carpeta añadida. Escaneando…");
      setPending(null);
      void load();
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  async function addExe() {
    const path = await openDialog({ multiple: false, title: "Ejecutable del juego", filters: [{ name: "Ejecutables", extensions: ["exe", "lnk", "bat"] }] });
    if (typeof path !== "string") return;
    try {
      await api.addManualGame(path);
      toast("ok", "Juego añadido");
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  return (
    <div>
      <Section
        title="Carpetas de juegos"
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => api.rescan()}>
              Reescanear todo
            </Button>
            <Button size="sm" variant="primary" icon={<FolderPlus size={14} />} onClick={pick}>
              Añadir carpeta
            </Button>
          </>
        }
      >
        {pending && (
          <div className="m-2 rounded-xl bg-accent/10 p-4 ring-1 ring-accent/40">
            <div className="text-sm font-medium">{pending.path}</div>
            <div className="mt-1 text-xs text-muted">
              {pending.preview.length ? `Detectados: ${pending.preview.slice(0, 12).join(", ")}${pending.preview.length > 12 ? "…" : ""}` : "No se ven juegos a primera vista; se escaneará igualmente."}
            </div>
            <Cycle
              label="Cómo leer esta carpeta"
              value={pending.suggestedMode}
              options={[
                { value: "subfolders", label: "Cada subcarpeta es un juego" },
                { value: "single", label: "Esta carpeta es un juego" },
              ]}
              onChange={(v) => setPending({ ...pending, suggestedMode: v })}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                Cancelar
              </Button>
              <Button size="sm" variant="primary" onClick={confirmAdd} data-autofocus>
                Añadir y escanear
              </Button>
            </div>
          </div>
        )}
        {folders.length === 0 && !pending && <p className="px-3 py-4 text-sm text-muted">Aún no hay carpetas. Añade una para detectar juegos automáticamente.</p>}
        {folders.map((f) => (
          <div key={f.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-3/40">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{f.path}</div>
              <div className="text-xs text-muted">
                {f.gameCount} juegos · {f.mode === "single" ? "un juego" : "subcarpetas"} · escaneada {relative(f.lastScan)}
              </div>
            </div>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => api.rescan(f.id)}>
              Escanear
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={14} />}
              onClick={async () => {
                await api.removeFolder(f.id);
                void load();
              }}
            >
              Quitar
            </Button>
          </div>
        ))}
      </Section>

      <Section title="Otras acciones">
        <div className="flex flex-wrap gap-2 p-2">
          <Button icon={<FilePlus2 size={16} />} onClick={addExe}>
            Añadir un juego a mano (.exe)
          </Button>
          <Button
            icon={<Eraser size={16} />}
            onClick={async () => {
              const n = await api.purgeMissing();
              toast("ok", n ? `${n} juegos eliminados de la biblioteca` : "No hay juegos desaparecidos");
            }}
          >
            Quitar juegos que ya no existen
          </Button>
        </div>
      </Section>
    </div>
  );
}
