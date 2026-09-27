// Descargas (ventana del host, para temas sin cola propia).

import { ask } from "@tauri-apps/plugin-dialog";
import { ArrowUp, Compass, Download, FolderOpen, FolderSearch, Pause, Play, RotateCcw, Trash2, Wrench } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { DownloadItem } from "../../api/types";
import { Button, Empty, IconButton, Modal } from "../../components/ui";
import { installDownload, locateInstall, openExplore } from "../../host/downloads";
import { useOverlayNav } from "../../input/nav";
import { bytes, eta, relative, speed } from "../../lib/format";
import { useApp } from "../../store/app";
import { Cover, Progress, downloadLabel, pct } from "./shared";
// @ts-ignore módulo JS del kit
import { canInstall, isActive } from "../../../sdk/kit/store.js";

export function DownloadsOverlay({ onClose }: { onClose: () => void }) {
  const downloads = useApp((s) => s.downloads);
  const toast = useApp((s) => s.toast);
  const exploreOn = useApp((s) => s.settings?.exploreEnabled !== false);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });

  const run = (p: Promise<unknown>) => p.catch((e) => toast("error", errMsg(e)));
  const active = downloads.filter((d) => d.state !== "installed");
  const done = downloads.filter((d) => d.state === "installed");
  const anyRunning = downloads.some((d) => d.state === "downloading" || d.state === "queued");
  const anyPaused = downloads.some((d) => d.state === "paused");

  async function remove(d: DownloadItem) {
    const finished = d.state === "installed";
    if (finished && d.filesDeleted) return run(api.downloadsRemove(d.id, false));
    const del = await ask(
      finished
        ? `¿Borrar también los archivos del repack de «${d.title}»? El juego instalado no se toca.`
        : `¿Borrar también lo descargado de «${d.title}» (${bytes(d.doneBytes)})?`,
      { title: "Quitar de Descargas", kind: "warning", okLabel: "Borrar archivos", cancelLabel: "Conservarlos" },
    );
    await run(api.downloadsRemove(d.id, del));
  }

  const row = (d: DownloadItem, i: number) => (
    <div key={d.id} className="flex items-center gap-4 rounded-[var(--h-radius)] bg-surface-2/60 p-3 ring-1 ring-line">
      <Cover src={d.cover} title={d.title} className="h-20 w-15 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium">{d.title}</span>
          {d.version && <span className="truncate text-xs text-muted">{d.version}</span>}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {downloadLabel(d)}
          {d.state === "downloading" && d.eta ? ` · quedan ${eta(d.eta)}` : ""}
          {d.state === "downloading" && d.peers ? ` · ${d.peers} fuentes` : ""}
          {d.state === "installed" && d.installedAt ? ` ${relative(d.installedAt)}` : ""}
        </div>
        {d.state !== "installed" && (
          <div className="mt-2 flex items-center gap-3">
            <Progress value={d.progress} className="flex-1" muted={d.state !== "downloading"} />
            <span className="w-40 text-right text-xs tabular-nums text-muted">
              {bytes(d.doneBytes)} de {bytes(d.totalBytes)} · {pct(d.progress)}
            </span>
          </div>
        )}
        {d.state === "seeding" && d.upBps > 0 && <div className="mt-1 text-[11px] text-muted">Subiendo a {speed(d.upBps)}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canInstall(d) && (
          <Button variant="primary" size="sm" icon={<Wrench size={14} />} onClick={() => void installDownload(d.id)}>
            Instalar
          </Button>
        )}
        {d.pauseReason === "needs-folder" && (
          <Button size="sm" icon={<FolderSearch size={14} />} onClick={() => void locateInstall(d.id)}>
            Elegir carpeta
          </Button>
        )}
        {d.state === "installed" && d.gameId && (
          <Button size="sm" icon={<Play size={14} />} onClick={() => run(api.play(d.gameId!))}>
            Jugar
          </Button>
        )}
        {isActive(d) && (
          <IconButton label="Pausar" onClick={() => run(api.downloadsPause(d.id))}>
            <Pause size={16} />
          </IconButton>
        )}
        {(d.state === "paused" || d.state === "error") && (
          <IconButton label={d.state === "error" ? "Reintentar" : "Reanudar"} onClick={() => run(api.downloadsResume(d.id))}>
            {d.state === "error" ? <RotateCcw size={16} /> : <Play size={16} />}
          </IconButton>
        )}
        {d.state === "queued" && i > 0 && (
          <IconButton label="Descargar primero" onClick={() => run(api.downloadsMove(d.id, 0))}>
            <ArrowUp size={16} />
          </IconButton>
        )}
        {!(d.state === "installed" && d.filesDeleted) && (
          <IconButton label="Abrir carpeta" onClick={() => run(api.downloadsOpenFolder(d.id))}>
            <FolderOpen size={16} />
          </IconButton>
        )}
        {d.state !== "installing" && (
          <IconButton label="Quitar" onClick={() => void remove(d)}>
            <Trash2 size={16} />
          </IconButton>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      ref={ref}
      title={
        <span className="flex items-center gap-2">
          <Download size={18} className="text-accent" /> Descargas
        </span>
      }
      headerExtra={
        <div className="flex items-center gap-2">
          {anyRunning && (
            <Button size="sm" variant="ghost" icon={<Pause size={14} />} onClick={() => run(api.downloadsPause())}>
              Pausar todo
            </Button>
          )}
          {anyPaused && (
            <Button size="sm" variant="ghost" icon={<Play size={14} />} onClick={() => run(api.downloadsResume())}>
              Reanudar todo
            </Button>
          )}
          {exploreOn && (
            <Button size="sm" variant="ghost" icon={<Compass size={14} />} onClick={() => openExplore("explore")}>
              Explorar
            </Button>
          )}
        </div>
      }
      onClose={onClose}
      width="min(980px, 94vw)"
      hints={[
        ["accept", "Elegir"],
        ["back", "Cerrar"],
      ]}
    >
      <div className="h-full overflow-y-auto p-5">
        {downloads.length === 0 ? (
          <Empty icon={<Download size={40} />} title="No hay descargas">
            {exploreOn ? "Busca un juego en Explorar y pulsa Descargar." : "Activa Explorar en Ajustes → Descargas."}
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {active.map(row)}
            {done.length > 0 && <h3 className="mt-4 mb-1 text-sm font-semibold text-muted">Instalados</h3>}
            {done.map(row)}
          </div>
        )}
      </div>
    </Modal>
  );
}
