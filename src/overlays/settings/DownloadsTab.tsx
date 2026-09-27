// Ajustes → Descargas: carpetas, velocidad, al jugar, al terminar, red y Explorar.

import { useEffect, useState } from "react";
import { FolderOpen, HardDrive, Shuffle } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { DownloadDefaults, SeedPolicy, Settings } from "../../api/types";
import { Button, Cycle, Section, Slider, TextInput, Toggle } from "../../components/ui";
import { pickFolder } from "../../host/downloads";
import { bytes } from "../../lib/format";
import { useApp } from "../../store/app";

function useSave() {
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  return async (patch: Partial<Settings>) => {
    try {
      set({ settings: await api.updateSettings(patch) });
    } catch (e) {
      toast("error", errMsg(e));
    }
  };
}

const DOWN: { value: string; label: string }[] = [
  { value: "0", label: "Sin límite" },
  ...[1, 2, 5, 10, 20, 50, 100].map((mb) => ({ value: String(mb * 1024), label: `${mb} MB/s` })),
];
const UP: { value: string; label: string }[] = [
  { value: "0", label: "Sin límite" },
  { value: "128", label: "128 KB/s" },
  { value: "256", label: "256 KB/s" },
  { value: "512", label: "512 KB/s" },
  ...[1, 2, 5, 10].map((mb) => ({ value: String(mb * 1024), label: `${mb} MB/s` })),
];
const PEERS = [
  { value: "0", label: "Automático" },
  ...[50, 100, 200, 300, 500].map((n) => ({ value: String(n), label: `${n}` })),
];
const SEED: { value: SeedPolicy; label: string }[] = [
  { value: "until-install", label: "Hasta instalar" },
  { value: "ratio", label: "Hasta un ratio" },
  { value: "never", label: "Nunca" },
];

/** Una opción de lista con el valor guardado aunque no esté entre las fijas. */
function withCurrent(list: { value: string; label: string }[], v: number, unit = " KB/s") {
  const s = String(v);
  return list.some((o) => o.value === s) ? list : [...list, { value: s, label: `${v}${unit}` }];
}

function Folder({ label, hint, value, fallback, onPick }: { label: string; hint: string; value: string; fallback: string; onPick: () => void }) {
  const path = value || fallback;
  const [free, setFree] = useState<number | null>(null);
  useEffect(() => {
    if (!path) return setFree(null);
    api.diskSpace(path).then((d) => setFree(d.freeBytes ?? null)).catch(() => setFree(null));
  }, [path]);
  return (
    <div className="flex items-center gap-4 px-3 py-2.5">
      <HardDrive size={18} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        <div className="truncate text-xs text-muted">
          {path ? (
            <>
              {path}
              {!value && " (tu carpeta de juegos)"}
              {free != null && ` · ${bytes(free)} libres`}
            </>
          ) : (
            hint
          )}
        </div>
      </div>
      <Button size="sm" icon={<FolderOpen size={14} />} onClick={onPick}>
        {path ? "Cambiar" : "Elegir"}
      </Button>
    </div>
  );
}

export function DownloadsTab() {
  const s = useApp((st) => st.settings)!;
  const save = useSave();
  const [defaults, setDefaults] = useState<DownloadDefaults | null>(null);
  const [port, setPort] = useState(String(s.listenPort || ""));
  const [proxy, setProxy] = useState(s.torrentProxy);

  useEffect(() => {
    api.downloadsDefaults().then(setDefaults).catch(() => {});
  }, [s.downloadDir, s.installDir]);
  // El motor guarda el puerto elegido la primera vez que arranca: releerlo.
  const set = useApp((st) => st.set);
  useEffect(() => {
    api
      .getSettings()
      .then((fresh) => {
        set({ settings: fresh });
        setPort(String(fresh.listenPort || ""));
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <Section title="Carpetas">
        <Folder
          label="Descargas"
          hint="Elige dónde se guardan los repacks"
          value={s.downloadDir}
          fallback={s.downloadDir ? "" : defaults?.downloadDir ?? ""}
          onPick={async () => {
            const p = await pickFolder("Carpeta de descargas", s.downloadDir || defaults?.downloadDir);
            if (p) await save({ downloadDir: p.path });
          }}
        />
        <Folder
          label="Instalar juegos en"
          hint="Se propone al instalador (puedes cambiarlo en él)"
          value={s.installDir}
          fallback={s.installDir ? "" : defaults?.installDir ?? ""}
          onPick={async () => {
            const p = await pickFolder("Dónde instalar los juegos", s.installDir || defaults?.installDir);
            if (p) await save({ installDir: p.path });
          }}
        />
        <Toggle
          label="Borrar el repack al terminar de instalar"
          hint="Los archivos descargados ocupan casi lo mismo que el juego. Solo se borran si la instalación acaba bien."
          checked={s.deleteRepackAfterInstall}
          onChange={(v) => save({ deleteRepackAfterInstall: v })}
        />
      </Section>

      <Section title="Velocidad">
        <Cycle
          label="Límite de descarga"
          value={String(s.maxDownloadKbps)}
          options={withCurrent(DOWN, s.maxDownloadKbps)}
          onChange={(v) => save({ maxDownloadKbps: Number(v) })}
        />
        <Cycle label="Límite de subida" value={String(s.maxUploadKbps)} options={withCurrent(UP, s.maxUploadKbps)} onChange={(v) => save({ maxUploadKbps: Number(v) })} />
        <Slider
          label="Descargas a la vez"
          min={1}
          max={5}
          value={s.maxActiveDownloads}
          format={(v) => (v === 1 ? "1 (la más rápida)" : String(v))}
          onChange={(v) => save({ maxActiveDownloads: v })}
        />
        <p className="px-3 pb-2 text-xs text-muted">De una en una cada descarga va a toda velocidad; el resto esperan en cola.</p>
      </Section>

      <Section title="Mientras juegas">
        <Toggle
          label="Pausar las descargas al jugar"
          hint="Se reanudan solas al cerrar el juego. Así no hay tirones de disco ni de red."
          checked={s.pauseWhilePlaying}
          onChange={(v) => save({ pauseWhilePlaying: v })}
        />
        <Toggle
          label="Evitar que el PC se suspenda mientras descarga"
          checked={s.preventSleep}
          onChange={(v) => save({ preventSleep: v })}
        />
      </Section>

      <Section title="Al terminar">
        <Cycle<SeedPolicy> label="Compartir con otros" value={s.seedPolicy} options={SEED} onChange={(v) => save({ seedPolicy: v })} />
        {s.seedPolicy === "ratio" && (
          <Slider
            label="Ratio"
            min={0.5}
            max={5}
            step={0.5}
            value={s.seedRatio}
            format={(v) => `subir ${v.toLocaleString("es")} × lo descargado`}
            onChange={(v) => save({ seedRatio: v })}
          />
        )}
        <p className="px-3 pb-2 text-xs text-muted">Al instalar se deja de compartir siempre: Windows no deja abrir el instalador mientras el torrent usa sus archivos.</p>
        <Toggle
          label="Abrir el instalador en cuanto termine"
          hint="Si no estás jugando. Windows pedirá permiso de administrador."
          checked={s.autoInstall}
          onChange={(v) => save({ autoInstall: v })}
        />
      </Section>

      <Section title="Red">
        <div className="flex items-center gap-4 px-3 py-2">
          <span className="flex-1 text-sm">
            Puerto de entrada
            <span className="block text-xs text-muted">Se abre solo en el router con UPnP. La primera vez Windows pedirá permiso en el firewall.</span>
          </span>
          <TextInput
            className="w-28"
            inputMode="numeric"
            value={port}
            placeholder="Auto"
            onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onBlur={() => {
              const n = Number(port || 0);
              if (n !== s.listenPort && n >= 0 && n <= 65535) void save({ listenPort: n });
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Shuffle size={14} />}
            onClick={() => {
              setPort("");
              void save({ listenPort: 0 });
            }}
          >
            Otro
          </Button>
        </div>
        <Toggle label="Abrir el puerto en el router (UPnP)" checked={s.upnp} onChange={(v) => save({ upnp: v })} />
        <Toggle
          label="Añadir trackers públicos"
          hint="Más fuentes y arranques más rápidos."
          checked={s.extraTrackers}
          onChange={(v) => save({ extraTrackers: v })}
        />
        <Toggle label="uTP (experimental)" hint="Conexiones UDP: más fuentes detrás de algunos routers." checked={s.utp} onChange={(v) => save({ utp: v })} />
        <Cycle label="Conexiones por descarga" value={String(s.peerLimit)} options={withCurrent(PEERS, s.peerLimit, "")} onChange={(v) => save({ peerLimit: Number(v) })} />
        <div className="flex items-center gap-4 px-3 py-2">
          <span className="flex-1 text-sm">
            Proxy SOCKS5
            <span className="block text-xs text-muted">Las conexiones con otros usuarios salen por él (sin DHT ni puerto de entrada).</span>
          </span>
          <TextInput
            className="w-64"
            value={proxy}
            placeholder="socks5://host:puerto"
            onChange={(e) => setProxy(e.target.value)}
            onBlur={() => proxy.trim() !== s.torrentProxy && void save({ torrentProxy: proxy.trim() })}
          />
        </div>
      </Section>

      <Section title="Explorar">
        <Toggle label="Mostrar Explorar" hint="La tienda de repacks en el menú y en los temas." checked={s.exploreEnabled} onChange={(v) => save({ exploreEnabled: v })} />
        <Toggle label="Ocultar juegos para adultos" checked={s.exploreHideAdult} onChange={(v) => save({ exploreHideAdult: v })} />
      </Section>
    </div>
  );
}
