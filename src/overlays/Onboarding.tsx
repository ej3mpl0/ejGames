// Primer arranque: perfil → tema → biblioteca.

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, ArrowRight, FolderPlus, Gamepad2, Sparkles, Trash2 } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { FolderInspection, StoreSummary } from "../api/types";
import { Button, TextInput, Toggle, cx } from "../components/ui";
import { ThemeCard } from "../components/ThemeCard";
import { useOverlayNav } from "../input/nav";
import { PROFILE_COLORS } from "../lib/format";
import { useApp } from "../store/app";
import { Hints } from "../components/Hints";

const STORES = [
  { key: "importSteam", source: "steam", label: "Steam" },
  { key: "importEpic", source: "epic", label: "Epic Games" },
  { key: "importGog", source: "gog", label: "GOG Galaxy" },
  { key: "importUbisoft", source: "ubisoft", label: "Ubisoft Connect" },
  { key: "importEa", source: "ea", label: "EA app" },
] as const;

function storeHint(s?: StoreSummary) {
  if (!s) return "Buscando…";
  if (!s.detected) return "No está instalada en este PC";
  const parts = [`${s.installed} ${s.installed === 1 ? "juego instalado" : "juegos instalados"}`];
  if (s.library) parts.push(`${s.library} en tu biblioteca`);
  return parts.join(" · ");
}

export function Onboarding({ onDone }: { onDone: (profileId: number) => void }) {
  const themes = useApp((s) => s.themes);
  const toast = useApp((s) => s.toast);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROFILE_COLORS[0]);
  const [theme, setTheme] = useState("steam");
  const [folders, setFolders] = useState<FolderInspection[]>([]);
  const [stores, setStores] = useState<Record<string, boolean>>({
    importSteam: true,
    importEpic: true,
    importGog: true,
    importUbisoft: true,
    importEa: true,
  });
  const [uninstalled, setUninstalled] = useState(true);
  const [summary, setSummary] = useState<StoreSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: () => setStep((s) => Math.max(0, s - 1)) });

  // Detectar tiendas en cuanto se llega al paso de juegos (sin red, rápido).
  useEffect(() => {
    if (step !== 2 || summary) return;
    api
      .storeSummary()
      .then((list) => {
        setSummary(list);
        // Las tiendas que no están instaladas empiezan desactivadas.
        setStores((cur) => {
          const next = { ...cur };
          for (const s of STORES) next[s.key] = !!list.find((x) => x.source === s.source)?.detected;
          return next;
        });
      })
      .catch(() => setSummary([]));
  }, [step]);

  async function addFolder() {
    const path = await openDialog({ directory: true, multiple: false, title: "Carpeta con juegos" });
    if (typeof path !== "string") return;
    try {
      const info = await api.inspectFolder(path);
      setFolders((f) => [...f.filter((x) => x.path !== info.path), info]);
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  async function finish() {
    setBusy(true);
    try {
      const p = await api.createProfile(name.trim() || "Jugador", color, theme);
      await api.login(p.id);
      await api.updateSettings({ ...stores, importUninstalled: uninstalled, firstRunDone: true });
      for (const f of folders) await api.addFolder(f.path, f.suggestedMode);
      await api.importStores();
      onDone(p.id);
    } catch (e) {
      toast("error", errMsg(e));
      setBusy(false);
    }
  }

  const steps = ["Tu perfil", "Tu estilo", "Tus juegos"];
  return (
    <div ref={ref} className="relative flex h-full flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,#1d2a4a,#090c12_60%)]">
      <div
        className="h-10 shrink-0"
        onMouseDown={(e) => e.button === 0 && void api.windowAction(e.detail === 2 ? "toggle-maximize" : "drag")}
      />
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-10 pb-10">
        <div className="mb-8 flex items-center gap-3 text-sm text-muted">
          <Gamepad2 className="text-accent" size={22} />
          <span className="font-semibold text-fg">ejGames</span>
          <span className="mx-2 opacity-40">·</span>
          {steps.map((s, i) => (
            <span key={s} className={cx("flex items-center gap-2", i === step && "text-fg")}>
              <span className={cx("grid h-6 w-6 place-items-center rounded-full text-xs", i <= step ? "bg-accent text-accent-contrast" : "bg-surface-3")}>
                {i + 1}
              </span>
              {s}
              {i < steps.length - 1 && <span className="mx-2 h-px w-8 bg-line" />}
            </span>
          ))}
        </div>

        <div className="panel-enter min-h-0 flex-1" key={step}>
          {step === 0 && (
            <div className="max-w-xl">
              <h1 className="text-4xl font-semibold tracking-tight">Bienvenido a tu biblioteca</h1>
              <p className="mt-3 text-muted">
                Todos tus juegos en un solo sitio, con el aspecto que tú quieras. Empieza creando tu perfil: cada perfil
                tiene su tema, sus favoritos y sus horas.
              </p>
              <div className="mt-8 flex items-center gap-5">
                <div
                  className="grid h-20 w-20 shrink-0 place-items-center rounded-full text-3xl font-semibold text-white shadow-lg"
                  style={{ background: color }}
                >
                  {(name.trim()[0] || "?").toUpperCase()}
                </div>
                <TextInput
                  data-autofocus
                  autoFocus
                  placeholder="¿Cómo te llamas?"
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(1)}
                  className="h-12 text-lg"
                />
              </div>
              <div className="mt-5 flex flex-wrap gap-2.5">
                {PROFILE_COLORS.map((c) => (
                  <button
                    key={c}
                    data-nav
                    aria-label={c}
                    onClick={() => setColor(c)}
                    className={cx("h-9 w-9 rounded-full cursor-pointer", c === color && "ring-2 ring-white ring-offset-2 ring-offset-[#0d1220]")}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex h-full flex-col">
              <h1 className="text-3xl font-semibold tracking-tight">Elige un estilo</h1>
              <p className="mt-2 text-muted">Podrás cambiarlo, retocar cada detalle o crear el tuyo desde Ajustes → Apariencia.</p>
              <div className="mt-6 grid min-h-0 grid-cols-3 gap-4 overflow-auto pb-2 pr-1">
                {themes.map((t) => (
                  <ThemeCard key={t.id} theme={t} active={t.id === theme} onClick={() => setTheme(t.id)} />
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid h-full grid-cols-2 gap-8">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Encuentra tus juegos</h1>
                <p className="mt-2 text-muted">Importamos lo que tengas instalado en tus tiendas y escaneamos las carpetas que elijas.</p>
                <div className="mt-6 rounded-[var(--h-radius)] bg-surface-2/70 p-2 ring-1 ring-line">
                  {STORES.map((s) => {
                    const info = summary?.find((x) => x.source === s.source);
                    return (
                      <Toggle
                        key={s.key}
                        label={s.label}
                        hint={storeHint(summary ? info : undefined)}
                        checked={stores[s.key]}
                        disabled={!!summary && !info?.detected}
                        onChange={(v) => setStores((x) => ({ ...x, [s.key]: v }))}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 rounded-[var(--h-radius)] bg-surface-2/70 p-2 ring-1 ring-line">
                  <Toggle
                    label="Incluir también los juegos que no tengo instalados"
                    hint="Aparecen con la opción «Instalar», que abre su tienda. Steam, Epic y GOG."
                    checked={uninstalled}
                    onChange={setUninstalled}
                  />
                </div>
              </div>
              <div className="flex min-h-0 flex-col">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Carpetas de juegos</h2>
                  <Button icon={<FolderPlus size={16} />} onClick={addFolder} data-autofocus>
                    Añadir carpeta
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto rounded-[var(--h-radius)] bg-surface-2/70 p-2 ring-1 ring-line">
                  {folders.length === 0 && (
                    <p className="p-6 text-center text-sm text-muted">
                      Añade las carpetas donde tienes juegos (por ejemplo <span className="text-fg">D:\Juegos</span>). Cada
                      subcarpeta se trata como un juego y se detecta su .exe automáticamente.
                    </p>
                  )}
                  {folders.map((f) => (
                    <div key={f.path} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-3/50">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{f.path}</div>
                        <div className="mt-0.5 text-xs text-muted">
                          {f.suggestedMode === "single" ? "Un juego" : `${f.preview.length} posibles juegos`}
                          {f.preview.length > 0 && ` · ${f.preview.slice(0, 4).join(", ")}${f.preview.length > 4 ? "…" : ""}`}
                        </div>
                      </div>
                      <button data-nav className="text-muted hover:text-red-300 cursor-pointer" onClick={() => setFolders((x) => x.filter((y) => y !== f))}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between gap-6">
          <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => setStep(step - 1)} disabled={step === 0}>
            Atrás
          </Button>
          <Hints
            className="flex-1 justify-center"
            items={[
              ["accept", "Elegir"],
              ["back", "Atrás"],
            ]}
          />
          {step < 2 ? (
            <Button variant="primary" size="lg" onClick={() => setStep(step + 1)} disabled={step === 0 && !name.trim()}>
              Siguiente <ArrowRight size={18} />
            </Button>
          ) : (
            <Button variant="primary" size="lg" icon={<Sparkles size={18} />} onClick={finish} disabled={busy}>
              {busy ? "Preparando…" : "Empezar"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
