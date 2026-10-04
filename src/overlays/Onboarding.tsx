// Primer arranque: perfil → tema → biblioteca → descargas.

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, ArrowRight, Compass, FolderOpen, FolderPlus, Gamepad2, HardDrive, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { FolderInspection } from "../api/types";
import { Button, TextInput, Toggle, cx } from "../components/ui";
import { ThemeCard } from "../components/ThemeCard";
import { useOverlayNav } from "../input/nav";
import { PROFILE_COLORS, bytes } from "../lib/format";
import { useApp } from "../store/app";
import { Hints } from "../components/Hints";
import { getLang, t } from "../lib/i18n";
import { restoreBackup } from "./settings/BackupSection";

export function Onboarding({ onDone }: { onDone: (profileId: number) => void }) {
  const themes = useApp((s) => s.themes);
  const toast = useApp((s) => s.toast);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROFILE_COLORS[0]);
  const [theme, setTheme] = useState("steam");
  const [folders, setFolders] = useState<FolderInspection[]>([]);
  const [busy, setBusy] = useState(false);
  // Descargas: carpeta (por defecto la primera carpeta de juegos) y Explorar.
  const [dlDir, setDlDir] = useState<string | null>(null);
  const [dlFree, setDlFree] = useState<number | null>(null);
  const [explore, setExplore] = useState(true);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: () => setStep((s) => Math.max(0, s - 1)) });

  useEffect(() => {
    if (step !== 3 || dlDir) return;
    const lib = folders.find((f) => f.suggestedMode !== "single");
    if (lib) setDlDir(lib.path);
  }, [step]);
  useEffect(() => {
    if (!dlDir) return setDlFree(null);
    api.diskSpace(dlDir).then((d) => setDlFree(d.freeBytes ?? null)).catch(() => setDlFree(null));
  }, [dlDir]);

  async function pickDownloads() {
    const path = await openDialog({ directory: true, multiple: false, title: "Carpeta de descargas", defaultPath: dlDir || undefined });
    if (typeof path === "string") setDlDir(path);
  }

  // «¿Vienes de otro PC?»: restaurar una copia de ejGames.
  async function restoreFromFile() {
    const file = await openDialog({ multiple: false, filters: [{ name: t("Copia de ejGames"), extensions: ["zip"] }] });
    if (typeof file !== "string") return;
    try {
      await restoreBackup(await api.backupInspect(file));
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  async function switchLanguage() {
    await api.updateSettings({ uiLanguage: getLang() === "en" ? "es" : "en" });
    location.reload();
  }

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
      await api.updateSettings({
        firstRunDone: true,
        exploreEnabled: explore,
        downloadDir: explore ? dlDir ?? "" : "",
      });
      for (const f of folders) await api.addFolder(f.path, f.suggestedMode);
      onDone(p.id);
    } catch (e) {
      toast("error", errMsg(e));
      setBusy(false);
    }
  }

  const steps = ["Tu perfil", "Tu estilo", "Tus juegos", "Descargas"];
  const last = step === steps.length - 1;
  return (
    <div ref={ref} className="season-scene relative flex h-full flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,#1d2a4a,#090c12_60%)]">
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
              <div className="mt-6 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => void restoreFromFile()}>
                  {t("¿Vienes de otro PC? Restaurar una copia")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void switchLanguage()}>
                  {getLang() === "en" ? "Español" : "English"}
                </Button>
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
                <p className="mt-2 text-muted">
                  Dinos dónde tienes tus juegos y ejGames se encarga del resto. Si más adelante instalas otro en esas carpetas, aparecerá solo.
                </p>
                <ul className="mt-6 space-y-3 rounded-[var(--h-radius)] bg-surface-2/70 p-4 text-sm ring-1 ring-line">
                  <li className="flex gap-3">
                    <Gamepad2 size={18} className="mt-0.5 shrink-0 text-accent" />
                    <span>Cada subcarpeta es un juego: se detecta su .exe, aunque esté en lo más hondo.</span>
                  </li>
                  <li className="flex gap-3">
                    <Sparkles size={18} className="mt-0.5 shrink-0 text-accent" />
                    <span>Portadas, fondos, descripción y tráileres se descargan solos.</span>
                  </li>
                  <li className="flex gap-3">
                    <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
                    <span>Si el juego guarda logros en su carpeta o en la de su emulador, se leen y te avisan en el overlay.</span>
                  </li>
                </ul>
                <p className="mt-3 text-xs text-muted">¿Un juego suelto fuera de estas carpetas? Añádelo luego en Ajustes → Biblioteca.</p>
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

          {step === 3 && (
            <div className="max-w-2xl">
              <h1 className="text-3xl font-semibold tracking-tight">¿Dónde guardamos las descargas?</h1>
              <p className="mt-2 text-muted">
                En <span className="text-fg">Explorar</span> buscas un juego y ejGames lo descarga con su torrent integrado. Al terminar,
                pulsas Instalar y el juego aparece en tu biblioteca.
              </p>
              <div className="mt-6 rounded-[var(--h-radius)] bg-surface-2/70 p-2 ring-1 ring-line">
                <Toggle
                  label={
                    <span className="flex items-center gap-2">
                      <Compass size={16} className="text-accent" /> Usar Explorar y Descargas
                    </span>
                  }
                  hint="Puedes cambiarlo cuando quieras en Ajustes → Descargas."
                  checked={explore}
                  onChange={setExplore}
                />
              </div>
              {explore && (
                <>
                  <div className="mt-3 flex items-center gap-4 rounded-[var(--h-radius)] bg-surface-2/70 p-4 ring-1 ring-line">
                    <HardDrive size={22} className="shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{dlDir || "Aún no has elegido carpeta"}</div>
                      <div className="text-xs text-muted">
                        {dlDir
                          ? `${dlFree != null ? `${bytes(dlFree)} libres · ` : ""}Los juegos también se instalarán aquí`
                          : "Elige una carpeta en un disco con espacio (los repacks ocupan decenas de GB)."}
                      </div>
                    </div>
                    <Button icon={<FolderOpen size={16} />} onClick={pickDownloads} data-autofocus>
                      {dlDir ? "Cambiar" : "Elegir carpeta"}
                    </Button>
                  </div>
                  <p className="mt-4 flex items-start gap-2 text-xs text-muted">
                    <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                    La primera vez que descargues, Windows te pedirá permiso en el firewall: acéptalo para que otros usuarios puedan
                    conectarse contigo y la descarga vaya más rápida.
                  </p>
                </>
              )}
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
          {!last ? (
            <Button variant="primary" size="lg" onClick={() => setStep(step + 1)} disabled={step === 0 && !name.trim()}>
              Siguiente <ArrowRight size={18} />
            </Button>
          ) : (
            <Button variant="primary" size="lg" icon={<Sparkles size={18} />} onClick={finish} disabled={busy || (explore && !dlDir)}>
              {busy ? "Preparando…" : "Empezar"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
