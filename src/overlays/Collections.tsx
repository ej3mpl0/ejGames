// Gestión de colecciones: manuales (eliges juegos) e inteligentes (reglas).

import { useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { Collection } from "../api/types";
import { Button, Cycle, Modal, Section, TextInput, Toggle } from "../components/ui";
import { useOverlayNav } from "../input/nav";
import { SOURCE_LABEL } from "../lib/format";
import { useApp } from "../store/app";

function SmartRules({ col, genres, onSave }: { col: Collection; genres: string[]; onSave: (r: Record<string, unknown>) => void }) {
  const r = col.rules as Record<string, any>;
  const upd = (k: string, v: unknown) => onSave({ ...r, [k]: v || undefined });
  return (
    <div className="mt-1 rounded-lg bg-black/20 p-1">
      <Cycle label="Género" value={r.genre ?? ""} options={[{ value: "", label: "Cualquiera" }, ...genres.map((g) => ({ value: g, label: g }))]} onChange={(v) => upd("genre", v)} />
      <Cycle
        label="Tienda"
        value={r.source ?? ""}
        options={[{ value: "", label: "Cualquiera" }, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))]}
        onChange={(v) => upd("source", v)}
      />
      <Toggle label="Solo favoritos" checked={!!r.favorite} onChange={(v) => upd("favorite", v)} />
      <Toggle label="Solo sin jugar" checked={!!r.unplayed} onChange={(v) => upd("unplayed", v)} />
    </div>
  );
}

export function CollectionsOverlay({ onClose }: { onClose: () => void }) {
  const cols = useApp((s) => s.collections);
  const games = useApp((s) => s.games);
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState("");
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });
  const genres = [...new Set(games.flatMap((g) => g.genres))].sort();
  const reload = async () => set({ collections: await api.listCollections() });

  async function create(kind: "manual" | "smart") {
    if (!name.trim()) return;
    try {
      await api.createCollection(name.trim(), kind, kind === "smart" ? {} : undefined);
      setName("");
      await reload();
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  return (
    <Modal ref={ref} title="Colecciones" onClose={onClose} width="min(760px, 94vw)">
      <div className="h-full overflow-y-auto p-5">
        <Section title="Nueva colección">
          <div className="flex gap-2 p-2">
            <TextInput data-autofocus placeholder="Nombre (p. ej. Para jugar con amigos)" value={name} onChange={(e) => setName(e.target.value)} />
            <Button icon={<Plus size={15} />} onClick={() => create("manual")} disabled={!name.trim()}>
              Manual
            </Button>
            <Button icon={<Sparkles size={15} />} onClick={() => create("smart")} disabled={!name.trim()}>
              Inteligente
            </Button>
          </div>
          <p className="px-3 pb-2 text-xs text-muted">Manual: añades juegos desde su ficha. Inteligente: se llena sola según unas reglas.</p>
        </Section>
        {cols.map((c) => (
          <Section
            key={c.id}
            title={
              <span className="flex items-center gap-2">
                {c.kind === "smart" && <Sparkles size={14} className="text-accent" />}
                {c.name}
                <span className="font-normal text-muted">{c.kind === "manual" ? `· ${c.gameIds.length} juegos` : ""}</span>
              </span>
            }
            actions={
              <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => api.deleteCollection(c.id).then(reload)}>
                Borrar
              </Button>
            }
          >
            {c.kind === "smart" ? (
              <SmartRules col={c} genres={genres} onSave={(r) => api.updateCollection(c.id, undefined, r).then(reload)} />
            ) : (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                {c.gameIds.slice(0, 30).map((id) => {
                  const g = games.find((x) => x.id === id);
                  return g ? (
                    <span key={id} className="rounded-full bg-surface-3 px-2.5 py-1 text-xs">
                      {g.title}
                    </span>
                  ) : null;
                })}
                {c.gameIds.length === 0 && <span className="text-xs text-muted">Vacía. Añade juegos desde su ficha (Editar → Colecciones).</span>}
              </div>
            )}
          </Section>
        ))}
      </div>
    </Modal>
  );
}
