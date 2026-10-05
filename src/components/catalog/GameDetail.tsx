// Ficha de una entrada de catálogo: datos, capturas, enlaces de descarga (directos
// a la cola de catálogos, torrents a Descargas, páginas al navegador), selector de
// emulador y «Jugar» si ya está en la biblioteca.

import { useEffect, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Globe, Magnet, Play, RefreshCw, X } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { CatalogDetail, CatalogEntry, CatalogInstallRequest, DownloadLink } from "../../api/types";
import { cancelCatalogJob, dismissCatalogJob, downloadFromCatalog } from "../../host/downloads";
import { launchRom } from "../../host/emulator-launcher";
import { CATEGORY_LABELS, entryKey } from "../../lib/catalog/sources";
import { platformName } from "../../lib/catalog/platforms";
import { t } from "../../lib/i18n";
import { useApp } from "../../store/app";
import { DownloadDialog } from "../../overlays/explore/DownloadDialog";
import { Button, Spinner } from "../ui";
import { JobBar } from "./CatalogCard";
import { EmulatorSelector } from "./EmulatorSelector";
import { PlatformIcon } from "./PlatformSelector";

export function requestFor(e: CatalogEntry, url: string, d?: CatalogDetail | null): CatalogInstallRequest {
  const x = d ?? e;
  return {
    sourceId: e.sourceId,
    gameId: e.id,
    title: x.title,
    platform: x.platform ?? e.platform,
    category: x.category,
    cover: x.coverOriginal ?? e.coverOriginal ?? null,
    description: x.description ?? null,
    region: x.region ?? null,
    version: x.version ?? null,
    url,
  };
}

const KIND_LABEL: Record<DownloadLink["kind"], string> = { direct: "Archivo", page: "Web de descarga", magnet: "Magnet", torrent: "Torrent" };

export function GameDetail({ entry, sourceName, onBack }: { entry: CatalogEntry; sourceName?: string; onBack: () => void }) {
  const toast = useApp((s) => s.toast);
  const job = useApp((s) => s.catalogJobs[entryKey(entry)]);
  const [d, setD] = useState<CatalogDetail | null>(null);
  const [error, setError] = useState("");
  const [torrent, setTorrent] = useState<CatalogInstallRequest | null>(null);

  const load = (force = false) => {
    setError("");
    api
      .catalogDetail(entry.sourceId, entry.id, force)
      .then(setD)
      .catch((e) => setError(errMsg(e)));
  };
  useEffect(() => {
    if (entry.id.startsWith("#")) return;
    load();
  }, [entry.sourceId, entry.id]);

  const x: CatalogEntry = d ?? entry;
  const gameId = job?.gameId ?? x.installedGameId ?? null;
  const busy = job && !["done", "error"].includes(job.phase);

  const get = (l: DownloadLink, tryPage = false) => {
    const req = requestFor(entry, l.url, d);
    if (l.kind === "magnet" || l.kind === "torrent") return setTorrent(req);
    if (l.kind === "page" && !tryPage) return void api.openExternal(l.url);
    downloadFromCatalog(req);
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-surface/95 backdrop-blur">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack} data-autofocus>
          {t("Volver")}
        </Button>
        <b className="min-w-0 flex-1 truncate">{x.title}</b>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => load(true)}>
          {t("Recargar")}
        </Button>
        <Button size="sm" variant="ghost" icon={<Globe size={14} />} onClick={() => void api.openExternal(x.originalUrl)}>
          {t("Ver en la web")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex flex-col gap-5 md:flex-row">
          <div className="w-full shrink-0 md:w-56">
            {x.coverUrl ? <img src={x.coverUrl} alt="" className="w-full rounded-xl object-cover ring-1 ring-line" /> : <div className="aspect-[3/4] rounded-xl bg-surface-3" />}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <PlatformIcon platform={x.platform} size={32} />
              <div className="text-sm text-muted">
                {[x.platform ? platformName(x.platform) : t("Plataforma desconocida"), t(CATEGORY_LABELS[x.category]), x.region, x.language, x.version && t("Versión {v}", { v: x.version }), x.size, sourceName]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <EmulatorSelector platform={x.platform} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<Play size={15} />} disabled={!gameId} onClick={() => gameId && void launchRom({ gameId }).catch(() => {})}>
                {t("Jugar")}
              </Button>
              {busy && (
                <Button variant="ghost" icon={<X size={15} />} onClick={() => cancelCatalogJob(entryKey(entry))}>
                  {t("Cancelar")}
                </Button>
              )}
            </div>
            {busy && <JobBar job={job!} />}
            {job?.phase === "error" && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">
                {job.message}{" "}
                <button className="underline" onClick={() => dismissCatalogJob(job.id)}>
                  {t("Quitar aviso")}
                </button>
              </div>
            )}

            <section>
              <h3 className="mb-2 text-sm font-semibold">{t("Descargas")}</h3>
              {!d && !error && !entry.id.startsWith("#") ? (
                <Spinner size={18} />
              ) : error ? (
                <p className="text-sm text-red-300">{error}</p>
              ) : !d?.links.length ? (
                <p className="text-sm text-muted">{t("La ficha no tiene enlaces de descarga (revisa selectors.downloadLink).")}</p>
              ) : (
                <div className="space-y-1.5">
                  {d.links.map((l) => (
                    <div key={l.url} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 ring-1 ring-line">
                      {l.kind === "magnet" || l.kind === "torrent" ? <Magnet size={15} className="text-muted" /> : <Download size={15} className="text-muted" />}
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {l.label || l.host || l.url}
                        <span className="ml-2 text-xs text-muted">
                          {t(KIND_LABEL[l.kind])}
                          {l.host && ` · ${l.host}`}
                          {l.size && ` · ${l.size}`}
                        </span>
                      </span>
                      {l.kind === "page" ? (
                        <>
                          <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => get(l)}>
                            {t("Abrir en el navegador")}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => get(l, true)}>
                            {t("Intentar descargar")}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="primary" icon={<Download size={13} />} disabled={!!busy} onClick={() => get(l)}>
                          {gameId ? t("Volver a descargar") : t("Descargar")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {x.description && <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{x.description}</p>}
          </div>
        </div>
        {d && d.screenshots.length > 0 && (
          <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
            {d.screenshots.map((s) => (
              <img key={s} src={s} alt="" loading="lazy" className="h-44 shrink-0 rounded-lg object-contain ring-1 ring-line" />
            ))}
          </div>
        )}
      </div>
      {torrent && (
        <DownloadDialog
          slug={`catalog:${entryKey(entry)}`}
          title={torrent.title}
          prepare={() => api.catalogPrepareTorrent(torrent)}
          onClose={() => setTorrent(null)}
          onStarted={() => {
            setTorrent(null);
            toast("ok", t("Añadido a Descargas. Al terminar, pulsa Instalar y quedará en tu biblioteca."));
          }}
        />
      )}
    </div>
  );
}
