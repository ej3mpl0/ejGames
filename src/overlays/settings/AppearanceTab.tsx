import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Code2, Copy, Download, FolderOpen, ImagePlus, RotateCcw, Trash2, Upload, X, RefreshCw } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { Settings, ThemeInfo, ThemeSetting } from "../../api/types";
import { Button, ColorInput, Cycle, Section, Slider, TextInput, Toggle } from "../../components/ui";
import { ThemeCard } from "../../components/ThemeCard";
import { mergedSettings } from "../../host/ThemeFrame";
import { SOUND_PRESETS } from "../../host/sounds";
import { refreshThemes, reloadTheme } from "../../host/window";
import { activeTheme, useApp } from "../../store/app";
import { SEASON_ORIGIN, useSeason } from "../../host/season";

const EVENT_OPTIONS: { value: Settings["eventMode"]; label: string }[] = [
  { value: "auto", label: "En sus fechas" },
  { value: "on", label: "Siempre" },
  { value: "off", label: "Nunca" },
];

/** Eventos de temporada (ejGames Scream: Halloween, del 26 oct al 2 nov): toda la app. */
function SeasonSection() {
  const mode = useApp((s) => s.settings?.eventMode ?? "auto");
  const set = useApp((s) => s.set);
  const ev = useSeason();
  return (
    <Section title="Eventos de temporada">
      {ev && (
        <img
          src={`${SEASON_ORIGIN}${ev.banner}`}
          alt={ev.name}
          className="mx-3 mb-2 block w-[calc(100%-1.5rem)] rounded-[calc(var(--h-radius)*0.6)] ring-1 ring-line"
          style={{ aspectRatio: "2000 / 297" }}
        />
      )}
      <Cycle
        label="Modo Halloween"
        value={mode}
        options={EVENT_OPTIONS}
        onChange={async (v) => set({ settings: await api.updateSettings({ eventMode: v }) })}
      />
      <p className="px-3 pb-2 text-xs text-muted">
        ejGames Scream, del 26 de octubre al 2 de noviembre: toda la app de noche (colores, fondos animados, niebla y
        murciélagos en cualquier tema), el banner y la selección de terror en la tienda, y los avisos del overlay.
      </p>
    </Section>
  );
}

const FONTS = [
  "Segoe UI Variable Display",
  "Segoe UI",
  "Bahnschrift",
  "Calibri",
  "Candara",
  "Corbel",
  "Franklin Gothic Medium",
  "Trebuchet MS",
  "Verdana",
  "Tahoma",
  "Arial",
  "Georgia",
  "Cambria",
  "Palatino Linotype",
  "Consolas",
  "Cascadia Code",
  "Lucida Console",
  "Impact",
  "Comic Sans MS",
];

function useDebounced<T extends unknown[]>(fn: (...a: T) => void, ms: number) {
  const t = useRef<number>(0);
  return (...a: T) => {
    clearTimeout(t.current);
    t.current = window.setTimeout(() => fn(...a), ms);
  };
}

function Control({ s, value, onChange }: { s: ThemeSetting; value: unknown; onChange: (v: unknown) => void }) {
  const toast = useApp((x) => x.toast);
  switch (s.type) {
    case "color":
      return <ColorInput label={s.label} value={String(value ?? "#000000")} onChange={onChange} />;
    case "range":
    case "number":
      return (
        <Slider
          label={s.label}
          min={s.min ?? 0}
          max={s.max ?? 100}
          step={s.step ?? 1}
          value={Number(value ?? s.default ?? 0)}
          format={(v) => `${v}${s.unit ?? ""}`}
          onChange={onChange}
        />
      );
    case "toggle":
      return <Toggle label={s.label} hint={s.help} checked={!!value} onChange={onChange} />;
    case "select":
      return <Cycle label={s.label} value={String(value ?? "")} options={s.options ?? []} onChange={onChange} />;
    case "font": {
      const opts = [...(s.options ?? []), ...FONTS.map((f) => ({ value: f, label: f }))];
      return <Cycle label={s.label} value={String(value ?? "")} options={opts} onChange={onChange} />;
    }
    case "image":
      return (
        <div className="flex items-center gap-3 px-3 py-2">
          <span className="flex-1 text-sm">{s.label}</span>
          {value ? (
            String(value).match(/\.(mp4|webm)$/) ? (
              <video src={String(value)} muted className="h-10 w-16 rounded object-cover" />
            ) : (
              <img src={String(value)} className="h-10 w-16 rounded object-cover" alt="" />
            )
          ) : null}
          <Button
            size="sm"
            icon={<ImagePlus size={14} />}
            onClick={async () => {
              const path = await openDialog({ multiple: false, filters: [{ name: "Imagen o vídeo", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "mp4", "webm"] }] });
              if (typeof path !== "string") return;
              try {
                onChange(await api.importImage(path));
              } catch (e) {
                toast("error", errMsg(e));
              }
            }}
          >
            Elegir…
          </Button>
          {value ? (
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => onChange(null)}>
              Quitar
            </Button>
          ) : null}
        </div>
      );
    default:
      return (
        <div className="px-3 py-2">
          <div className="mb-1.5 text-sm">{s.label}</div>
          <TextInput value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
  }
}

export function ThemeEditor({ theme }: { theme: ThemeInfo }) {
  const profile = useApp((s) => s.profile)!;
  const upsert = useApp((s) => s.upsertProfile);
  const saved = (profile.themeSettings?.[theme.id] ?? {}) as Record<string, unknown>;
  const values = mergedSettings(theme, saved);
  const [css, setCss] = useState(profile.customCss?.[theme.id] ?? "");
  const persist = useDebounced((v: Record<string, unknown>) => void api.setThemeSettings(theme.id, v), 350);
  const persistCss = useDebounced((c: string) => void api.setCustomCss(theme.id, c), 500);

  useEffect(() => setCss(profile.customCss?.[theme.id] ?? ""), [theme.id]);

  function change(key: string, v: unknown) {
    const next = { ...saved, [key]: v };
    upsert({ ...profile, themeSettings: { ...profile.themeSettings, [theme.id]: next } });
    persist(next);
  }

  const groups = useMemo(() => {
    const m = new Map<string, ThemeSetting[]>();
    for (const s of theme.settings) {
      const g = s.group || "General";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(s);
    }
    return [...m.entries()];
  }, [theme]);

  const hasSoundSetting = theme.settings.some((s) => s.key === "sounds");

  return (
    <>
      {groups.map(([g, list]) => (
        <Section
          key={g}
          title={`${theme.name} · ${g}`}
          actions={
            g === groups[0][0] ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={14} />}
                onClick={() => {
                  upsert({ ...profile, themeSettings: { ...profile.themeSettings, [theme.id]: {} } });
                  void api.setThemeSettings(theme.id, {});
                }}
              >
                Restablecer
              </Button>
            ) : undefined
          }
        >
          {list.map((s) => (
            <Control key={s.key} s={s} value={values[s.key]} onChange={(v) => change(s.key, v)} />
          ))}
          {g === groups[0][0] && !hasSoundSetting && (
            <Cycle
              label="Sonidos de navegación"
              value={String(values.sounds ?? theme.sounds?.preset ?? "soft")}
              options={SOUND_PRESETS}
              onChange={(v) => change("sounds", v)}
            />
          )}
        </Section>
      ))}
      {groups.length === 0 && (
        <Section title={theme.name}>
          <p className="px-3 py-2 text-sm text-muted">Este tema no tiene opciones visuales. Puedes personalizarlo con CSS o duplicarlo y editar su código.</p>
        </Section>
      )}
      <SeasonSection />
      <Section title={<span className="flex items-center gap-2"><Code2 size={15} /> CSS extra para este tema</span>}>
        <p className="px-3 pb-2 text-xs text-muted">
          Se aplica encima del tema solo para tu perfil. Variables disponibles: <code className="text-fg">--ejg-*</code> (una por
          cada opción de arriba).
        </p>
        <textarea
          data-nav
          spellCheck={false}
          value={css}
          onChange={(e) => {
            setCss(e.target.value);
            upsert({ ...profile, customCss: { ...profile.customCss, [theme.id]: e.target.value } });
            persistCss(e.target.value);
          }}
          placeholder={".card { border-radius: 0; }\n:root { --ejg-accent: hotpink; }"}
          className="h-40 w-full resize-y rounded-lg bg-black/30 p-3 font-mono text-xs text-fg outline-none ring-1 ring-line focus:ring-accent"
        />
      </Section>
    </>
  );
}

export function AppearanceTab() {
  const themes = useApp((s) => s.themes);
  const profile = useApp((s) => s.profile)!;
  const settings = useApp((s) => s.settings)!;
  const set = useApp((s) => s.set);
  const upsert = useApp((s) => s.upsertProfile);
  const toast = useApp((s) => s.toast);
  const current = useApp(activeTheme);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function refresh() {
    set({ themes: await api.listThemes() });
  }

  // Temas creados a mano o con theme.json cambiado, sin reiniciar ejGames.
  useEffect(() => {
    void refreshThemes();
  }, []);

  async function select(id: string) {
    const p = await api.updateProfile(profile.id, { themeId: id });
    upsert(p);
    set({ themeOverride: null, safeOrigin: false });
  }

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast("ok", ok);
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  return (
    <div>
      <Section
        title="Temas"
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<Upload size={14} />}
              onClick={() =>
                run(async () => {
                  const path = await openDialog({ multiple: false, filters: [{ name: "Tema de ejGames", extensions: ["ejtheme", "zip"] }] });
                  if (typeof path !== "string") return;
                  const t = await api.importTheme(path);
                  await refresh();
                  await select(t.id);
                }, "Tema instalado")
              }
            >
              Importar
            </Button>
            <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => api.openThemeFolder()}>
              Carpeta de temas
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-3 p-2">
          {themes.map((t) => (
            <ThemeCard key={t.id} theme={t} active={t.id === current?.id} onClick={() => select(t.id)} />
          ))}
        </div>
      </Section>

      {current && (
        <Section title="Hazlo tuyo">
          <p className="px-3 pb-2 text-xs leading-relaxed text-muted">
            Ajusta colores, tamaños y fondos aquí abajo. Si quieres ir más allá, <b className="text-fg">duplica</b> el tema: se copia a tu carpeta
            de temas y puedes editar su HTML, CSS y JavaScript con recarga en vivo (activa el modo desarrollador).
          </p>
          <div className="flex flex-wrap gap-2 p-2">
            <Button icon={<Copy size={15} />} onClick={() => run(async () => {
              const t = await api.duplicateTheme(current.id);
              await refresh();
              await select(t.id);
            }, "Tema duplicado: ya puedes editarlo")}>
              Duplicar para editar
            </Button>
            <Button icon={<FolderOpen size={15} />} onClick={() => api.openThemeFolder(current.id)}>
              Abrir carpeta del tema
            </Button>
            <Button
              icon={<Download size={15} />}
              onClick={() =>
                run(async () => {
                  const dest = await saveDialog({ defaultPath: `${current.id}.ejtheme`, filters: [{ name: "Tema de ejGames", extensions: ["ejtheme"] }] });
                  if (dest) await api.exportTheme(current.id, dest);
                }, "Tema exportado")
              }
            >
              Exportar .ejtheme
            </Button>
            <Button icon={<RefreshCw size={15} />} onClick={() => void reloadTheme()}>
              Recargar tema
            </Button>
            {!current.builtin &&
              (confirmDelete ? (
                <Button
                  variant="danger"
                  icon={<Trash2 size={15} />}
                  onClick={() =>
                    run(async () => {
                      await select("steam");
                      await api.deleteTheme(current.id);
                      await refresh();
                      setConfirmDelete(false);
                    }, "Tema eliminado")
                  }
                >
                  ¿Seguro? Eliminar
                </Button>
              ) : (
                <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setConfirmDelete(true)}>
                  Eliminar tema
                </Button>
              ))}
          </div>
          <Toggle
            label="Modo desarrollador"
            hint="Recarga el tema al guardar sus ficheros y muestra sus errores."
            checked={settings.devMode}
            onChange={async (v) => set({ settings: await api.updateSettings({ devMode: v }) })}
          />
        </Section>
      )}

      {current && <ThemeEditor theme={current} />}
    </div>
  );
}
