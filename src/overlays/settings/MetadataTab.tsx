import { useEffect, useState } from "react";
import { DownloadCloud, RefreshCcw, Trash2 } from "lucide-react";
import { api } from "../../api/tauri";
import type { Settings } from "../../api/types";
import { Button, Cycle, Field, Section, Slider, TextInput, Toggle } from "../../components/ui";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";

export function MetadataTab() {
  const settings = useApp((s) => s.settings)!;
  const set = useApp((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const [cache, setCache] = useState<{ mediaMb: number; trailersMb: number } | null>(null);

  useEffect(() => {
    api.cacheInfo().then(setCache).catch(() => {});
  }, []);

  const val = <K extends keyof Settings>(k: K) => (draft[k] ?? settings[k]) as Settings[K];
  async function save(patch: Partial<Settings>) {
    const s = await api.updateSettings(patch);
    set({ settings: s });
    setDraft({});
  }
  const dirtyKeys = draft.sgdbKey !== undefined || draft.igdbClientId !== undefined || draft.igdbClientSecret !== undefined;

  return (
    <div>
      <Section title="Fuentes">
        <p className="px-3 pb-2 text-xs leading-relaxed text-muted">
          Steam se usa siempre y no necesita clave: portadas, fondos, logos, capturas, tráilers y descripción. Con estas
          claves gratuitas (opcionales) mejora el arte de los juegos que no están en Steam.
        </p>
        <Field label="Clave de SteamGridDB" hint="steamgriddb.com → Preferencias → API">
          <TextInput type="password" value={val("sgdbKey")} onChange={(e) => setDraft({ ...draft, sgdbKey: e.target.value })} placeholder="Opcional" />
        </Field>
        <div className="grid grid-cols-2">
          <Field label="IGDB · Client ID" hint="dev.twitch.tv → Console → Register app">
            <TextInput value={val("igdbClientId")} onChange={(e) => setDraft({ ...draft, igdbClientId: e.target.value })} placeholder="Opcional" />
          </Field>
          <Field label="IGDB · Client Secret">
            <TextInput type="password" value={val("igdbClientSecret")} onChange={(e) => setDraft({ ...draft, igdbClientSecret: e.target.value })} placeholder="Opcional" />
          </Field>
        </div>
        <Cycle
          label="Idioma de las descripciones"
          value={val("language")}
          options={[
            { value: "spanish", label: "Español (España)\u200b" },
            { value: "latam", label: "Español (Latinoamérica)\u200b" },
            { value: "english", label: "English" },
            { value: "french", label: "Français" },
            { value: "german", label: "Deutsch" },
            { value: "italian", label: "Italiano\u200b" },
            { value: "brazilian", label: "Português (Brasil)" },
          ]}
          onChange={(v) => save({ language: v })}
        />
        <Toggle
          label={t("Mostrar cuánto dura cada juego")}
          hint={t("Consulta HowLongToBeat con el nombre del juego al abrir su ficha (historia, extras y completarlo).")}
          checked={settings.hltbEnabled}
          onChange={(v) => save({ hltbEnabled: v })}
        />
        {dirtyKeys && (
          <div className="flex justify-end p-2">
            <Button variant="primary" onClick={() => save({ sgdbKey: val("sgdbKey"), igdbClientId: val("igdbClientId"), igdbClientSecret: val("igdbClientSecret") })}>
              Guardar claves
            </Button>
          </div>
        )}
      </Section>

      <Section title="Descargar información">
        <div className="flex flex-wrap gap-2 p-2">
          <Button
            icon={<DownloadCloud size={16} />}
            onClick={async () => {
              const n = await api.refreshMetadata();
              toast("info", n ? `Buscando info de ${n} juegos` : "No hay juegos pendientes");
            }}
          >
            Completar juegos sin info
          </Button>
          <Button
            icon={<RefreshCcw size={16} />}
            onClick={async () => {
              const n = await api.refreshMetadata(undefined, true);
              toast("info", `Actualizando ${n} juegos (no toca lo que hayas editado a mano)`);
            }}
          >
            Volver a descargar todo
          </Button>
        </div>
      </Section>

      <Section title="Tráilers">
        <Cycle
          label="Calidad máxima"
          value={String(val("trailerMaxHeight"))}
          options={[
            { value: "360", label: "360p (ahorro)" },
            { value: "480", label: "480p" },
            { value: "720", label: "720p" },
            { value: "1080", label: "1080p" },
          ]}
          onChange={(v) => save({ trailerMaxHeight: Number(v) })}
        />
        <Slider
          label="Caché de tráilers en disco"
          min={256}
          max={10240}
          step={256}
          value={val("trailerCacheMb")}
          format={(v) => (v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${v} MB`)}
          onChange={(v) => setDraft({ ...draft, trailerCacheMb: v })}
        />
        {draft.trailerCacheMb !== undefined && (
          <div className="flex justify-end px-3">
            <Button size="sm" variant="primary" onClick={() => save({ trailerCacheMb: draft.trailerCacheMb })}>
              Guardar tamaño
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
          <span>
            {cache ? `Arte: ${cache.mediaMb.toFixed(0)} MB · Tráilers: ${cache.trailersMb.toFixed(0)} MB` : "…"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={14} />}
            onClick={async () => {
              await api.clearTrailerCache();
              setCache(await api.cacheInfo());
            }}
          >
            Vaciar caché de tráilers
          </Button>
        </div>
      </Section>
    </div>
  );
}
