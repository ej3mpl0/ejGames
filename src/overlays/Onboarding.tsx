// Primer arranque: idioma → perfil → biblioteca → descargas. A la izquierda la moneda y
// los pasos (la ranura marca dónde estás); a la derecha, el paso.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowRight, Compass, FolderOpen, HardDrive, Minus, Plus, ShieldCheck, Sparkles, Square, Trophy, X } from "lucide-react";
import { api, errMsg } from "../api/tauri";
import type { FolderInspection } from "../api/types";
import { Button, TextInput, Toggle, cx } from "../components/ui";
import { Toasts } from "../components/Chrome";
import { useOverlayNav } from "../input/nav";
import { PROFILE_COLORS, bytes } from "../lib/format";
import { DEFAULT_THEME, useApp } from "../store/app";
import { Hints } from "../components/Hints";
import { getLang, isLang, LANG_LABELS, steamLanguageFor, t, tn, UI_LANGS, type Lang } from "../lib/i18n";
import { restoreBackup } from "./settings/BackupSection";

const ONBOARD_STEP = "ejg.onboard.step";
const STEPS = ["Idioma", "Tu perfil", "Tus juegos", "Descargas"];

function initialStep() {
  const n = Number(sessionStorage.getItem(ONBOARD_STEP) || "0");
  return n >= 1 && n < STEPS.length ? n : 0;
}

const drag = (e: React.MouseEvent) => {
  if (e.button === 0 && e.target === e.currentTarget) void api.windowAction(e.detail === 2 ? "toggle-maximize" : "drag");
};

/** El logo: disco rojo con su anillo y la ranura, recortados con el color del fondo. */
function Coin({ size, cut, ring = 4, className, style }: { size: number | string; cut: string; ring?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className} style={{ width: size, height: size, ...style }}>
      <circle cx="50" cy="50" r="50" fill="#ff3a2d" />
      <circle cx="50" cy="50" r="38" fill="none" stroke={cut} strokeWidth={ring} />
      <rect x="27" y="44.5" width="46" height="11" fill={cut} />
    </svg>
  );
}

/** Fila de lista: fondo al elegirla y la ranura roja a la izquierda. */
function Choice({ on, onClick, children, autofocus }: { on: boolean; onClick: () => void; children: ReactNode; autofocus?: boolean }) {
  return (
    <button
      data-nav
      {...(autofocus ? { "data-autofocus": true } : {})}
      onClick={onClick}
      className={cx(
        "relative flex h-16 w-full items-center gap-4 rounded-[18px] px-5 text-left transition-colors cursor-pointer",
        on ? "bg-surface-3" : "bg-surface-2 hover:bg-surface-3/70",
      )}
    >
      <i className={cx("absolute left-0 top-1/2 h-[22px] w-[5px] -translate-y-1/2 rounded-[1.5px] bg-accent transition-opacity", on ? "opacity-100" : "opacity-0")} />
      {children}
      <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors", on ? "bg-fg" : "ring-2 ring-inset ring-muted/40")}>
        {on && <span className="h-2 w-2 rounded-full bg-surface" />}
      </span>
    </button>
  );
}

const round = "grid h-11 w-11 shrink-0 place-items-center rounded-full";

export function Onboarding({ onDone }: { onDone: (profileId: number) => void }) {
  const toast = useApp((s) => s.toast);
  const source = useApp((s) => s.inputSource);
  const [step, setStep] = useState(initialStep);
  const [picked, setPicked] = useState<Lang>(getLang());
  const [systemLang, setSystemLang] = useState<Lang | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROFILE_COLORS[0]);
  const [folders, setFolders] = useState<FolderInspection[]>([]);
  const [busy, setBusy] = useState(false);
  // Descargas: carpeta (por defecto la primera carpeta de juegos) y Explorar.
  const [dlDir, setDlDir] = useState<string | null>(null);
  const [dlFree, setDlFree] = useState<number | null>(null);
  const [explore, setExplore] = useState(true);
  const ref = useOverlayNav<HTMLDivElement>({ onBack: () => setStep((s) => Math.max(0, s - 1)) });
  const applying = useRef(false);

  /** Guarda el idioma y recarga para pintarlo. `true` si la recarga ya está en marcha. */
  async function persistLanguage(id: Lang, nextStep: number) {
    if (applying.current) return true;
    const raw = await api.systemUiLanguage();
    const system = isLang(raw) ? raw : getLang();
    const explicit = id === system ? "" : id;
    const cur = (await api.getSettings()).uiLanguage;
    if (cur === explicit) return false;
    applying.current = true;
    sessionStorage.setItem(ONBOARD_STEP, String(nextStep));
    await api.updateSettings({ uiLanguage: explicit });
    location.reload();
    return true;
  }

  useEffect(() => {
    void api.systemUiLanguage().then((l) => { if (isLang(l)) setSystemLang(l); });
  }, []);
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
    const path = await openDialog({ directory: true, multiple: false, title: t("Carpeta de descargas"), defaultPath: dlDir || undefined });
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

  async function chooseLanguage(id: Lang) {
    setPicked(id);
    try {
      await persistLanguage(id, 0);
    } catch (e) {
      applying.current = false;
      toast("error", errMsg(e));
    }
  }

  async function confirmLanguage() {
    try {
      if (!(await persistLanguage(picked, 1))) setStep(1);
    } catch (e) {
      applying.current = false;
      toast("error", errMsg(e));
    }
  }

  async function addFolder() {
    const path = await openDialog({ directory: true, multiple: false, title: t("Carpeta con juegos") });
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
      const p = await api.createProfile(name.trim() || "Jugador", color, DEFAULT_THEME);
      await api.login(p.id);
      await api.updateSettings({
        firstRunDone: true,
        exploreEnabled: explore,
        downloadDir: explore ? dlDir ?? "" : "",
        language: steamLanguageFor(getLang()),
      });
      sessionStorage.removeItem(ONBOARD_STEP);
      for (const f of folders) await api.addFolder(f.path, f.suggestedMode);
      onDone(p.id);
    } catch (e) {
      toast("error", errMsg(e));
      setBusy(false);
    }
  }

  const last = step === STEPS.length - 1;
  const canNext = step !== 1 || !!name.trim();
  const next = () => {
    if (!canNext) return;
    if (step === 0) void confirmLanguage();
    else setStep(step + 1);
  };
  const win = "grid h-12 w-[46px] place-items-center text-muted hover:bg-surface-3 hover:text-fg cursor-pointer";

  return (
    <div ref={ref} className="relative flex h-full overflow-hidden bg-surface text-fg">
      {/* Izquierda: la marca, el saludo y los pasos. La moneda grande gira un poco con cada paso. */}
      <aside className="relative flex w-[clamp(320px,34vw,500px)] shrink-0 flex-col overflow-hidden bg-surface-2 px-[clamp(36px,4vw,56px)] pb-10 pt-12" onMouseDown={drag}>
        <Coin size={34} cut="var(--h-surface-2)" className="pointer-events-none" />
        <h1 className="pointer-events-none mt-[clamp(28px,7vh,64px)] text-[clamp(34px,3.6vw,52px)] font-extrabold leading-[1.04] tracking-[-0.045em]">
          {t("Hola. Vamos a dejarlo listo.")}
        </h1>
        <p className="pointer-events-none mt-3 max-w-[340px] text-[15px] leading-relaxed text-muted">{t("Son cuatro pasos y todo se puede cambiar luego en Ajustes.")}</p>
        <ol className="pointer-events-none mt-[clamp(24px,5vh,44px)] flex flex-col gap-[18px]">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={cx("flex items-center gap-4 text-[15px] font-semibold transition-colors duration-300", i === step ? "text-fg" : i < step ? "text-muted" : "text-muted/45")}
            >
              <span className="grid w-[22px] place-items-center">
                <i
                  className={cx(
                    "block transition-all duration-300",
                    i === step ? "h-[5px] w-[22px] rounded-[1.5px] bg-accent" : "h-2.5 w-2.5 rounded-full",
                    i < step ? "bg-muted" : i > step && "bg-surface-3",
                  )}
                />
              </span>
              {s}
            </li>
          ))}
        </ol>
        <Coin
          size="min(470px, 92%)"
          cut="var(--h-surface-2)"
          ring={2.5}
          className="pointer-events-none absolute -bottom-[150px] -right-[34%] transition-transform duration-[900ms] ease-[cubic-bezier(.6,0,.2,1)]"
          style={{ transform: `rotate(${step * -22}deg)` }}
        />
      </aside>

      {/* Derecha: el paso. */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0" onMouseDown={drag}>
          <div className="flex-1" onMouseDown={drag} />
          <button className={win} title={t("Minimizar")} onClick={() => api.windowAction("minimize")}>
            <Minus size={15} />
          </button>
          <button className={win} title={t("Maximizar")} onClick={() => api.windowAction("toggle-maximize")}>
            <Square size={12} />
          </button>
          <button className="grid h-12 w-[46px] place-items-center text-muted hover:bg-red-600 hover:text-white cursor-pointer" title={t("Cerrar")} onClick={() => api.windowAction("close")}>
            <X size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col px-[clamp(32px,5vw,72px)] pb-9 pt-[clamp(4px,3vh,28px)]">
          <div key={step} className="panel-enter flex min-h-0 flex-1 flex-col">
            <span className="text-[15px] text-muted">{t("Paso {n} de {total}", { n: step + 1, total: STEPS.length })}</span>

            {step === 0 && (
              <>
                <h2 className="mt-2 text-[clamp(30px,3vw,40px)] font-extrabold tracking-[-0.04em]">{t("Elige tu idioma")}</h2>
                <p className="mt-2.5 max-w-[620px] text-base leading-relaxed text-muted">
                  {t("ejGames usará el idioma de Windows. Puedes cambiarlo ahora o más tarde en Ajustes → Sistema.")}
                </p>
                <div className="-mx-2 mt-8 min-h-0 flex-1 overflow-auto px-2 pb-2">
                  <div className="grid max-w-[680px] grid-cols-2 gap-2.5" data-focus-group>
                    {UI_LANGS.map((id) => (
                      <Choice key={id} on={picked === id} autofocus={id === picked} onClick={() => void chooseLanguage(id)}>
                        <span data-no-t className="flex-1 text-base font-semibold">{LANG_LABELS[id]}</span>
                        {systemLang === id && <span className="text-xs text-muted">{t("El de Windows")}</span>}
                      </Choice>
                    ))}
                  </div>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2 className="mt-2 text-[clamp(30px,3vw,40px)] font-extrabold tracking-[-0.04em]">{t("Crea tu perfil")}</h2>
                <p className="mt-2.5 max-w-[620px] text-base leading-relaxed text-muted">
                  {t("Cada perfil tiene sus favoritos, sus horas y sus logros. Si jugáis varios en casa, podréis añadir más.")}
                </p>
                <div className="-mx-2 mt-9 min-h-0 flex-1 overflow-auto px-2 pb-2">
                  <div className="flex max-w-[640px] items-center gap-6">
                    <div
                      className="grid h-[104px] w-[104px] shrink-0 place-items-center rounded-full text-[42px] font-bold text-white transition-colors duration-300"
                      style={{ background: color }}
                    >
                      {(name.trim()[0] || "?").toUpperCase()}
                    </div>
                    <TextInput
                      data-autofocus
                      autoFocus
                      placeholder={t("¿Cómo te llamas?")}
                      value={name}
                      maxLength={32}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && next()}
                      className="h-16 rounded-[18px] bg-surface-2 px-6 text-xl font-semibold ring-0"
                    />
                  </div>
                  <div className="mt-8 flex flex-wrap gap-3 pl-[2px]" data-focus-group>
                    {PROFILE_COLORS.map((c) => (
                      <button
                        key={c}
                        data-nav
                        aria-label={c}
                        onClick={() => setColor(c)}
                        className={cx(
                          "h-10 w-10 rounded-full transition-transform cursor-pointer hover:scale-110",
                          c === color && "ring-2 ring-fg ring-offset-4 ring-offset-surface",
                        )}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="mt-2 text-[clamp(30px,3vw,40px)] font-extrabold tracking-[-0.04em]">{t("¿Dónde tienes tus juegos?")}</h2>
                <p className="mt-2.5 max-w-[620px] text-base leading-relaxed text-muted">
                  {t("Dinos dónde tienes tus juegos y ejGames se encarga del resto. Si más adelante instalas otro en esas carpetas, aparecerá solo.")}
                </p>
                <div className="-mx-2 mt-8 min-h-0 flex-1 overflow-auto px-2 pb-2">
                  <div className="flex max-w-[760px] flex-col gap-1 rounded-[22px] bg-surface-2 p-2">
                    {folders.map((f) => (
                      <div key={f.path} className="flex items-center gap-4 rounded-[16px] px-3 py-2.5">
                        <span className={cx(round, "bg-surface-3")}>
                          <FolderOpen size={19} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div data-no-t className="truncate text-[15px] font-semibold">{f.path}</div>
                          <div className="mt-0.5 truncate text-[13px] text-muted">
                            <span>{f.suggestedMode === "single" ? t("Un juego") : tn(f.preview.length, "{n} posible juego", "{n} posibles juegos")}</span>
                            {f.preview.length > 0 && (
                              <span data-no-t>{` · ${f.preview.slice(0, 4).join(", ")}${f.preview.length > 4 ? "…" : ""}`}</span>
                            )}
                          </div>
                        </div>
                        <button
                          data-nav
                          aria-label={t("Quitar")}
                          title={t("Quitar")}
                          className={cx(round, "text-muted hover:bg-surface-3 hover:text-fg cursor-pointer")}
                          onClick={() => setFolders((x) => x.filter((y) => y !== f))}
                        >
                          <X size={17} />
                        </button>
                      </div>
                    ))}
                    <button
                      data-nav
                      data-autofocus
                      onClick={() => void addFolder()}
                      className="flex items-center gap-4 rounded-[16px] px-3 py-2.5 text-left text-muted hover:bg-surface-3/60 hover:text-fg cursor-pointer"
                    >
                      <span className={cx(round, "border-[1.5px] border-dashed border-muted/50")}>
                        <Plus size={19} />
                      </span>
                      <span className="text-[15px] font-semibold">{folders.length ? t("Añadir otra carpeta") : t("Añadir carpeta")}</span>
                    </button>
                  </div>
                  <div className="mt-5 grid max-w-[760px] grid-cols-3 gap-2.5">
                    {[
                      [<FolderOpen size={17} />, "Cada subcarpeta es un juego: se detecta su .exe, aunque esté en lo más hondo."],
                      [<Sparkles size={17} />, "Portadas, fondos, descripción y tráileres se descargan solos."],
                      [<Trophy size={17} />, "Si el juego guarda logros en su carpeta o en la de su emulador, se leen y te avisan en el overlay."],
                    ].map(([icon, text], i) => (
                      <div key={i} className="rounded-[18px] bg-surface-2/60 p-4 text-[13px] leading-snug text-muted">
                        <span className="mb-2.5 block text-fg">{icon}</span>
                        {t(text as string)}
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-[13px] text-muted">{t("¿Un juego suelto fuera de estas carpetas? Añádelo luego en Ajustes → Biblioteca.")}</p>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="mt-2 text-[clamp(30px,3vw,40px)] font-extrabold tracking-[-0.04em]">{t("¿Dónde guardamos las descargas?")}</h2>
                <p className="mt-2.5 max-w-[620px] text-base leading-relaxed text-muted">
                  En <span className="text-fg">Explorar</span> buscas un juego y ejGames lo descarga con su torrent integrado. Al terminar,
                  pulsas Instalar y el juego aparece en tu biblioteca.
                </p>
                <div className="-mx-2 mt-8 min-h-0 flex-1 overflow-auto px-2 pb-2">
                  <div className="flex max-w-[760px] flex-col gap-1 rounded-[22px] bg-surface-2 p-2">
                    <Toggle
                      label={
                        <span className="flex items-center gap-2">
                          <Compass size={16} /> Usar Explorar y Descargas
                        </span>
                      }
                      hint="Puedes cambiarlo cuando quieras en Ajustes → Descargas."
                      checked={explore}
                      onChange={setExplore}
                    />
                    {explore && (
                      <div className="flex items-center gap-4 rounded-[16px] px-3 py-2.5">
                        <span className={cx(round, "bg-surface-3")}>
                          <HardDrive size={19} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div data-no-t={dlDir ? "" : undefined} className="truncate text-[15px] font-semibold">
                            {dlDir || t("Aún no has elegido carpeta")}
                          </div>
                          <div className="mt-0.5 text-[13px] text-muted">
                            {dlDir ? (
                              <>
                                {dlFree != null && <span>{t("{n} libres", { n: bytes(dlFree) })} · </span>}
                                <span>{t("Los juegos también se instalarán aquí")}</span>
                              </>
                            ) : (
                              t("Elige una carpeta en un disco con espacio (los repacks ocupan decenas de GB).")
                            )}
                          </div>
                        </div>
                        <Button icon={<FolderOpen size={16} />} onClick={pickDownloads} data-autofocus>
                          {dlDir ? "Cambiar" : "Elegir carpeta"}
                        </Button>
                      </div>
                    )}
                  </div>
                  {explore && (
                    <p className="mt-4 flex max-w-[760px] items-start gap-2.5 text-[13px] leading-snug text-muted">
                      <ShieldCheck size={16} className="mt-px shrink-0" />
                      La primera vez que descargues, Windows te pedirá permiso en el firewall: acéptalo para que otros usuarios puedan
                      conectarse contigo y la descarga vaya más rápida.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          <footer className="mt-6 flex items-center gap-3">
            {step <= 1 && (
              <button
                data-nav
                onClick={() => void restoreFromFile()}
                className="rounded-full px-1 text-sm font-semibold text-muted underline underline-offset-4 hover:text-fg cursor-pointer"
              >
                {t("¿Vienes de otro PC? Restaurar una copia")}
              </button>
            )}
            <div className="flex-1" />
            {source !== "mouse" && (
              <Hints
                className="mr-3"
                items={[
                  ["accept", "Elegir"],
                  ["back", "Atrás"],
                ]}
              />
            )}
            {step > 0 && (
              <Button variant="ghost" size="lg" onClick={() => setStep(step - 1)}>
                Atrás
              </Button>
            )}
            {!last ? (
              <Button variant="primary" size="lg" onClick={next} disabled={!canNext}>
                Siguiente <ArrowRight size={18} />
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => void finish()} disabled={busy || (explore && !dlDir)}>
                {busy ? "Preparando…" : "Empezar"} {!busy && <ArrowRight size={18} />}
              </Button>
            )}
          </footer>
        </div>
      </main>
      <Toasts />
    </div>
  );
}
