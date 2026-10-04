import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, ImagePlus, Search, Star, Trash2, EyeOff, Play, Check, Wand2 } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { ArtItem, Candidate, GameFull, GamePatch } from "../api/types";
import { Button, Field, Modal, Section, Spinner, Tabs, TextInput, Toggle, cx } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { playtime, SOURCE_LABEL } from "../lib/format";
import { useApp } from "../store/app";
import { t } from "../lib/i18n";
import { openExplore } from "../host/downloads";
import { SavesTab } from "./SavesTab";

/** Juegos que ejGames sabe desinstalar (todos los que siguen en su sitio). */
const canUninstall = (g: { missing?: boolean; platform?: string | null }) => !g.missing && !g.platform;

type Tab = "general" | "match" | "art" | "saves" | "info";
const ART_KINDS = [
  { kind: "cover", label: "Portada", aspect: "aspect-[2/3]" },
  { kind: "hero", label: "Fondo (hero)", aspect: "aspect-[96/31]" },
  { kind: "logo", label: "Logo", aspect: "aspect-[16/9]" },
  { kind: "header", label: "Cabecera", aspect: "aspect-[460/215]" },
  { kind: "icon", label: "Icono", aspect: "aspect-square" },
];

export function GameEditor({ id, onClose }: { id: number; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("general");
  const [data, setData] = useState<GameFull | null>(null);
  const [launching, setLaunching] = useState(false);
  const lib = useApp((s) => s.games.find((g) => g.id === id));
  const toast = useApp((s) => s.toast);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });

  const load = () => api.getGameFull(id).then(setData).catch((e) => toast("error", errMsg(e)));
  useEffect(() => {
    void load();
  }, [id, lib?.media.cover, lib?.metaStatus]);

  if (!data || !lib) {
    return (
      <Modal ref={ref} title="Juego" onClose={onClose}>
        <div className="grid h-full place-items-center">
          <Spinner size={28} />
        </div>
      </Modal>
    );
  }
  const g = data.game;

  return (
    <Modal ref={ref} title={g.title} onClose={onClose}>
      <div className="flex h-full">
        <aside className="flex w-60 shrink-0 flex-col gap-4 border-r border-line p-4">
          <div className="overflow-hidden rounded-xl bg-surface-3 ring-1 ring-line">
            {lib.media.coverThumb ? (
              <img src={lib.media.coverThumb} className="aspect-[2/3] w-full object-cover" alt="" />
            ) : (
              <div className="grid aspect-[2/3] place-items-center p-4 text-center text-sm text-muted">{g.title}</div>
            )}
          </div>
          <div className="text-xs text-muted">
            {SOURCE_LABEL[g.source] ?? g.source} · {playtime(lib.playtime)}
            {lib.lastPlayed ? "" : " · nunca jugado"}
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "general", label: "General" },
              { value: "match", label: "Identificar juego" },
              { value: "art", label: "Arte" },
              { value: "saves", label: t("Partidas guardadas") },
              { value: "info", label: "Información" },
            ]}
          />
          <div className="mt-auto flex flex-col gap-2">
            <Button
              variant="primary"
              icon={<Play size={15} />}
              disabled={launching}
              onClick={() => {
                // Un solo lanzamiento aunque se haga doble clic.
                setLaunching(true);
                api
                  .play(id)
                  .catch((e) => toast("error", errMsg(e)))
                  .finally(() => setTimeout(() => setLaunching(false), 3000));
              }}
            >
              Jugar
            </Button>
          </div>
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto p-5" key={tab}>
          {tab === "general" && <GeneralTab data={data} reload={load} onClose={onClose} />}
          {tab === "match" && <MatchTab data={data} />}
          {tab === "art" && <ArtTab data={data} reload={load} />}
          {tab === "saves" && <SavesTab id={id} />}
          {tab === "info" && <InfoTab data={data} reload={load} />}
        </div>
      </div>
    </Modal>
  );
}

function useSaver(id: number) {
  const toast = useApp((s) => s.toast);
  return async (patch: GamePatch, ok?: string) => {
    try {
      await api.updateGame(id, patch);
      if (ok) toast("ok", ok);
    } catch (e) {
      toast("error", errMsg(e));
    }
  };
}

function GeneralTab({ data, reload, onClose }: { data: GameFull; reload: () => void; onClose: () => void }) {
  const g = data.game;
  const lib = useApp((s) => s.games.find((x) => x.id === g.id))!;
  const collections = useApp((s) => s.collections);
  const set = useApp((s) => s.set);
  const save = useSaver(g.id);
  const [title, setTitle] = useState(g.title);
  const [args, setArgs] = useState(g.args);
  const [uri, setUri] = useState(g.launchUri ?? "");
  const [hints, setHints] = useState(g.processHints.join(", "));
  const [confirm, setConfirm] = useState(false);
  const [newCol, setNewCol] = useState("");
  const toast = useApp((s) => s.toast);

  async function toggleCol(cid: number, member: boolean) {
    await api.setInCollection(cid, g.id, member);
    set({ collections: await api.listCollections() });
  }

  return (
    <div>
      {lib.repackUpdate && (
        <Section title={t("Versión nueva del repack")}>
          <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1">
              {lib.repackUpdate.installed} → <b>{lib.repackUpdate.latest}</b>
            </span>
            <Button size="sm" variant="primary" onClick={() => (onClose(), openExplore("repack", { slug: lib.repackUpdate!.slug }))}>
              {t("Ver en la tienda")}
            </Button>
            <Button size="sm" onClick={() => void api.repackUpdateDismiss(g.id)}>
              {t("Ocultar")}
            </Button>
          </div>
        </Section>
      )}
      <Section title="Juego">
        <Field label="Nombre">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== g.title && save({ title: title.trim() })} />
        </Field>
        <Toggle label="Favorito" checked={lib.favorite} onChange={(v) => api.setFavorite(g.id, v)} />
        <Toggle label="Ocultar de la biblioteca" checked={lib.hidden} onChange={(v) => api.setHidden(g.id, v)} />
        <Toggle label="Mostrar en Discord" checked={g.discordEnabled} onChange={(v) => save({ discordEnabled: v }).then(reload)} />
      </Section>

      <Section title={t("Lanzar desde fuera de ejGames")}>
        <p className="px-3 pb-2 text-xs text-muted">
          {t("Un acceso directo o una entrada de Steam abren este juego a través de ejGames: se cuentan las horas y salen el overlay y Discord.")}
        </p>
        <div className="flex flex-wrap gap-2 px-3 pb-3">
          <Button
            size="sm"
            onClick={() =>
              api.gameShortcut(g.id).then(
                () => toast("ok", t("Acceso directo creado en el escritorio")),
                (e) => toast("error", errMsg(e)),
              )
            }
          >
            {t("Acceso directo en el escritorio")}
          </Button>
          <Button size="sm" onClick={() => api.gameAddToSteam(g.id).then((m) => toast("ok", m), (e) => toast("error", errMsg(e)))}>
            {t("Añadir a Steam")}
          </Button>
        </div>
      </Section>

      <Section title="Cómo se lanza">
        {uri ? (
          <Field label="URI de lanzamiento">
            <TextInput value={uri} onChange={(e) => setUri(e.target.value)} onBlur={() => uri !== (g.launchUri ?? "") && save({ launchUri: uri || null })} />
          </Field>
        ) : null}
        <Field label="Ejecutable">
          <div className="flex gap-2">
            <TextInput readOnly value={g.exePath ?? ""} />
            <Button
              icon={<FolderOpen size={15} />}
              onClick={async () => {
                const path = await openDialog({ multiple: false, defaultPath: g.installDir ?? undefined, filters: [{ name: "Ejecutable", extensions: ["exe", "bat", "lnk"] }] });
                if (typeof path === "string") await save({ exePath: path }, "Ejecutable cambiado").then(reload);
              }}
            >
              Buscar…
            </Button>
          </div>
        </Field>
        {data.exeCandidates.length > 1 && (
          <div className="px-3 pb-2">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Otros ejecutables detectados</div>
            <div className="flex flex-col gap-1">
              {data.exeCandidates.slice(0, 8).map(([p, score]) => (
                <button
                  key={p}
                  data-nav
                  onClick={() => save({ exePath: p }, "Ejecutable cambiado").then(reload)}
                  className={cx(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-3 cursor-pointer",
                    p === g.exePath && "text-accent",
                  )}
                >
                  {p === g.exePath ? <Check size={13} /> : <span className="w-[13px]" />}
                  <span className="flex-1 truncate">{g.installDir ? p.replace(g.installDir + "\\", "") : p}</span>
                  <span className="tabular-nums text-muted">{score.toFixed(0)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Argumentos">
          <TextInput value={args} placeholder="-windowed -skipintro" onChange={(e) => setArgs(e.target.value)} onBlur={() => args !== g.args && save({ args })} />
        </Field>
        <Toggle
          label="Ejecutar como administrador"
          hint={
            g.runAsAdmin || data.elevation === "manifest"
              ? `${g.runAsAdmin ? "Así" : "El propio juego lo exige, y así"} Windows no deja que ejGames lea el teclado durante la partida: el overlay solo se abre con el mando.`
              : data.elevation === "windows"
                ? "Windows lo tiene marcado como «Ejecutar como administrador», pero ejGames lo abre sin permisos para que no salga el aviso de UAC y funcione el atajo del overlay. Actívalo si el juego lo necesita."
                : undefined
          }
          checked={g.runAsAdmin}
          onChange={(v) => save({ runAsAdmin: v }).then(reload)}
        />
        <Field label="Procesos del juego (para contar horas)" hint="Nombres de exe separados por comas, por si el juego se lanza a través de otro programa.">
          <TextInput
            value={hints}
            placeholder="game-win64-shipping.exe"
            onChange={(e) => setHints(e.target.value)}
            onBlur={() =>
              save({ processHints: hints.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean) })
            }
          />
        </Field>
      </Section>

      <Section title="Colecciones">
        <div className="flex flex-wrap gap-2 p-2">
          {collections.filter((c) => c.kind === "manual").map((c) => {
            const member = c.gameIds.includes(g.id);
            return (
              <button
                key={c.id}
                data-nav
                onClick={() => toggleCol(c.id, !member)}
                className={cx("rounded-full px-3 py-1.5 text-sm ring-1 cursor-pointer", member ? "bg-accent/20 text-fg ring-accent" : "text-muted ring-line hover:text-fg")}
              >
                {member && <Check size={12} className="mr-1 inline" />}
                {c.name}
              </button>
            );
          })}
          <div className="flex gap-2">
            <TextInput className="h-8 w-44" placeholder="Nueva colección" value={newCol} onChange={(e) => setNewCol(e.target.value)} />
            <Button
              size="sm"
              disabled={!newCol.trim()}
              onClick={async () => {
                const cid = await api.createCollection(newCol.trim());
                await api.setInCollection(cid, g.id, true);
                setNewCol("");
                set({ collections: await api.listCollections() });
              }}
            >
              Crear
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Otros">
        <div className="flex flex-wrap gap-2 p-2">
          <Button icon={<FolderOpen size={15} />} onClick={() => api.openGameFolder(g.id)}>
            Abrir carpeta
          </Button>
          {g.steamAppid && (
            <Button onClick={() => api.openExternal(`https://store.steampowered.com/app/${g.steamAppid}`)}>Ver en la tienda de Steam</Button>
          )}
          <Button icon={<EyeOff size={15} />} onClick={() => api.setHidden(g.id, true).then(onClose)}>
            Ocultar
          </Button>
          {canUninstall(g) && (
            <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => useApp.getState().open("uninstall", { id: g.id })}>
              Desinstalar…
            </Button>
          )}
          {confirm ? (
            <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => api.deleteGame(g.id).then(onClose)}>
              Quitar de la biblioteca (no borra archivos)
            </Button>
          ) : (
            <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setConfirm(true)}>
              Quitar
            </Button>
          )}
        </div>
      </Section>
    </div>
  );
}

function MatchTab({ data }: { data: GameFull }) {
  const g = data.game;
  const toast = useApp((s) => s.toast);
  const [q, setQ] = useState(g.title);
  const [res, setRes] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    try {
      setRes(await api.searchMetadata(q));
    } catch (e) {
      toast("error", errMsg(e));
    }
    setBusy(false);
  }
  useEffect(() => {
    void search();
  }, []);

  const status: Record<string, string> = {
    matched: "Identificado automáticamente",
    review: "Coincidencia dudosa: revísala",
    manual: "Elegido por ti",
    pending: "Pendiente",
    failed: "No encontrado",
  };

  return (
    <div>
      <Section title="Estado">
        <div className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className={cx("h-2.5 w-2.5 rounded-full", g.metaStatus === "matched" || g.metaStatus === "manual" ? "bg-emerald-400" : g.metaStatus === "review" ? "bg-amber-400" : "bg-red-400")} />
          <span className="flex-1">{status[g.metaStatus] ?? g.metaStatus}</span>
          {g.steamAppid && <span className="text-muted">Steam {g.steamAppid}</span>}
          {g.matchConfidence != null && <span className="text-muted">{Math.round(g.matchConfidence * 100)} %</span>}
          <Button size="sm" variant="ghost" icon={<Wand2 size={14} />} onClick={() => api.refreshMetadata([g.id]).then(() => toast("info", "Buscando de nuevo…"))}>
            Reintentar
          </Button>
        </div>
      </Section>
      <Section title="Buscar el juego correcto">
        <div className="flex gap-2 p-2">
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} data-autofocus />
          <Button icon={busy ? <Spinner size={14} /> : <Search size={15} />} onClick={search}>
            Buscar
          </Button>
        </div>
        <div className="flex flex-col gap-1 p-2">
          {res?.length === 0 && <p className="p-3 text-sm text-muted">Sin resultados.</p>}
          {res?.map((c) => (
            <button
              key={`${c.provider}-${c.id}`}
              data-nav
              onClick={async () => {
                await api.applyMatch(g.id, c.provider, c.id);
                toast("ok", `Usando «${c.name}». Descargando info y arte…`);
              }}
              className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-3 cursor-pointer"
            >
              {c.image ? <img src={c.image} className="h-10 w-24 rounded object-cover" alt="" /> : <div className="h-10 w-24 rounded bg-surface-3" />}
              <span className="flex-1 text-sm">
                {c.name} {c.year && <span className="text-muted">({c.year})</span>}
              </span>
              <span className="rounded bg-surface-3 px-2 py-0.5 text-[11px] uppercase text-muted">{c.provider}</span>
              {c.provider === "steam" && c.id === g.steamAppid && <Check size={16} className="text-accent" />}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function ArtTab({ data, reload }: { data: GameFull; reload: () => void }) {
  const g = data.game;
  const toast = useApp((s) => s.toast);
  const hasKey = useApp((s) => !!s.settings?.sgdbKey);
  const [kind, setKind] = useState("cover");
  const [opts, setOpts] = useState<ArtItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = ART_KINDS.find((k) => k.kind === kind)!;
  const mine = data.media.filter((m) => m.kind === kind);

  useEffect(() => {
    setOpts(null);
  }, [kind]);

  async function loadOpts() {
    setBusy(true);
    try {
      setOpts(await api.artOptions(g.id, kind));
    } catch (e) {
      toast("error", errMsg(e));
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {ART_KINDS.map((k) => (
          <button
            key={k.kind}
            data-nav
            data-tab
            aria-selected={k.kind === kind}
            onClick={() => setKind(k.kind)}
            className={cx("rounded-full px-4 py-1.5 text-sm ring-1 cursor-pointer", k.kind === kind ? "bg-accent text-accent-contrast ring-accent" : "text-muted ring-line hover:text-fg")}
          >
            {k.label}
          </button>
        ))}
      </div>
      <Section
        title="Disponibles"
        actions={
          <Button
            size="sm"
            icon={<ImagePlus size={14} />}
            onClick={async () => {
              const path = await openDialog({ multiple: false, filters: [{ name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp", "gif", "ico"] }] });
              if (typeof path !== "string") return;
              await api.setArtFile(g.id, kind, path).catch((e) => toast("error", errMsg(e)));
              reload();
            }}
          >
            Desde archivo…
          </Button>
        }
      >
        <div className={cx("grid gap-3 p-2", kind === "cover" ? "grid-cols-5" : kind === "icon" ? "grid-cols-8" : "grid-cols-3")}>
          {mine.map((m) => (
            <button
              key={m.id}
              data-nav
              onClick={() => api.selectMedia(g.id, m.id).then(reload)}
              className={cx("relative overflow-hidden rounded-lg bg-surface-3 ring-2 cursor-pointer", m.selected ? "ring-accent" : "ring-transparent hover:ring-white/30")}
            >
              <img src={m.thumb || m.url} className={cx("w-full object-cover", meta.aspect, kind === "logo" && "object-contain p-2")} alt="" loading="lazy" />
              {m.selected && <Star size={14} className="absolute right-1.5 top-1.5 fill-accent text-accent" />}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] uppercase">{m.source}</span>
            </button>
          ))}
          {mine.length === 0 && <p className="col-span-full p-3 text-sm text-muted">Nada todavía.</p>}
        </div>
      </Section>
      <Section
        title="Más opciones en SteamGridDB"
        actions={
          hasKey ? (
            <Button size="sm" icon={busy ? <Spinner size={14} /> : <Search size={14} />} onClick={loadOpts}>
              Buscar
            </Button>
          ) : undefined
        }
      >
        {!hasKey && <p className="px-3 py-2 text-sm text-muted">Añade tu clave gratuita de SteamGridDB en Ajustes → Info y arte para ver cientos de alternativas.</p>}
        {opts && (
          <div className={cx("grid gap-3 p-2", kind === "cover" ? "grid-cols-5" : kind === "icon" ? "grid-cols-8" : "grid-cols-3")}>
            {opts.map((o) => (
              <button
                key={o.url}
                data-nav
                onClick={async () => {
                  await api.setArtUrl(g.id, kind, o.url).catch((e) => toast("error", errMsg(e)));
                  reload();
                }}
                className="overflow-hidden rounded-lg bg-surface-3 ring-2 ring-transparent hover:ring-white/30 cursor-pointer"
              >
                <img src={o.extra?.thumb || o.url} className={cx("w-full object-cover", meta.aspect, kind === "logo" && "object-contain p-2")} alt="" loading="lazy" />
              </button>
            ))}
            {opts.length === 0 && <p className="col-span-full p-3 text-sm text-muted">No hay alternativas para este juego.</p>}
          </div>
        )}
      </Section>
    </div>
  );
}

function InfoTab({ data, reload }: { data: GameFull; reload: () => void }) {
  const g = data.game;
  const save = useSaver(g.id);
  const [f, setF] = useState({
    developer: g.developer ?? "",
    publisher: g.publisher ?? "",
    releaseDate: g.releaseDate ?? "",
    genres: g.genres.join(", "),
    shortDescription: g.shortDescription ?? "",
    description: g.description ?? "",
  });
  return (
    <div>
      <Section title="Datos (lo que edites aquí no se sobrescribe al actualizar)">
        <div className="grid grid-cols-2">
          <Field label="Desarrolladora">
            <TextInput value={f.developer} onChange={(e) => setF({ ...f, developer: e.target.value })} />
          </Field>
          <Field label="Editora">
            <TextInput value={f.publisher} onChange={(e) => setF({ ...f, publisher: e.target.value })} />
          </Field>
          <Field label="Lanzamiento (AAAA-MM-DD)">
            <TextInput value={f.releaseDate} onChange={(e) => setF({ ...f, releaseDate: e.target.value })} />
          </Field>
          <Field label="Géneros (separados por comas)">
            <TextInput value={f.genres} onChange={(e) => setF({ ...f, genres: e.target.value })} />
          </Field>
        </div>
        <Field label="Resumen">
          <textarea
            data-nav
            value={f.shortDescription}
            onChange={(e) => setF({ ...f, shortDescription: e.target.value })}
            className="h-20 w-full resize-y rounded-lg bg-surface-3/70 p-3 text-sm outline-none ring-1 ring-line focus:ring-accent"
          />
        </Field>
        <Field label="Descripción">
          <textarea
            data-nav
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            className="h-48 w-full resize-y rounded-lg bg-surface-3/70 p-3 text-sm outline-none ring-1 ring-line focus:ring-accent"
          />
        </Field>
        <div className="flex justify-end p-2">
          <Button
            variant="primary"
            onClick={() => {
              // Solo lo que cambió: cada campo editado queda bloqueado frente a actualizaciones.
              const p: GamePatch = {};
              if (f.developer !== (g.developer ?? "")) p.developer = f.developer;
              if (f.publisher !== (g.publisher ?? "")) p.publisher = f.publisher;
              if (f.releaseDate !== (g.releaseDate ?? "")) p.releaseDate = f.releaseDate;
              if (f.genres !== g.genres.join(", ")) p.genres = f.genres.split(",").map((x) => x.trim()).filter(Boolean);
              if (f.shortDescription !== (g.shortDescription ?? "")) p.shortDescription = f.shortDescription;
              if (f.description !== (g.description ?? "")) p.description = f.description;
              if (Object.keys(p).length) void save(p, "Guardado").then(reload);
            }}
          >
            Guardar
          </Button>
        </div>
      </Section>
    </div>
  );
}
