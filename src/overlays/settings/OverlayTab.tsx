import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderPlus, Keyboard, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { api, errMsg } from "../../api/tauri";
import type { NoticeLook, OverlayNotice, Settings } from "../../api/types";
import { Button, Cycle, Section, Toggle } from "../../components/ui";
import { NOTICE_STYLES, NoticeStack, NoticeView } from "../../ingame/notices";
import { useApp } from "../../store/app";

function useSave() {
  const set = useApp((s) => s.set);
  return async (patch: Partial<Settings>) => {
    try {
      set({ settings: await api.updateSettings(patch) });
    } catch (e) {
      useApp.getState().toast("error", errMsg(e));
    }
  };
}

const STYLES: { value: Settings["overlayStyle"]; label: string }[] = [{ value: "auto", label: "El de mi tema" }, ...NOTICE_STYLES];

const CORNERS: { value: Settings["overlayCorner"]; label: string }[] = [
  { value: "auto", label: "La de su plataforma" },
  { value: "bottom-right", label: "Abajo a la derecha" },
  { value: "bottom-center", label: "Abajo en el centro" },
  { value: "bottom-left", label: "Abajo a la izquierda" },
  { value: "top-right", label: "Arriba a la derecha" },
  { value: "top-center", label: "Arriba en el centro" },
  { value: "top-left", label: "Arriba a la izquierda" },
];

/** Cómo se verá el aviso encima de uno de tus juegos. */
function NoticePreview({ settings }: { settings: Settings }) {
  const profile = useApp((s) => s.profile);
  const games = useApp((s) => s.games);
  const [look, setLook] = useState<NoticeLook | null>(null);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    api.overlayLook().then(setLook).catch(() => setLook(null));
  }, [settings.overlayStyle, settings.overlayCorner, profile?.themeId, profile?.themeSettings]);
  const game = useMemo(
    () => games.filter((g) => g.media.hero || g.media.heroThumb).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))[0],
    [games],
  );
  if (!look) return null;
  const rare = seq % 2 === 1;
  const n: OverlayNotice = {
    id: seq,
    kind: "achievement",
    game: game?.title ?? "Tu juego",
    title: rare ? "Contra todo pronóstico" : "Primeros pasos",
    body: rare ? "Termina el juego en la dificultad más alta." : "Completa el primer capítulo.",
    rarity: rare ? 3.2 : 41,
    score: rare ? 90 : 15,
    progress: [rare ? 12 : 3, 40],
    at: 0,
    look,
  };
  const art = game?.media.heroThumb || game?.media.hero;
  return (
    <div className="px-3 pb-2 pt-1">
      <div
        className="relative h-[230px] overflow-hidden rounded-lg bg-black bg-cover bg-center ring-1 ring-line"
        style={art ? { backgroundImage: `url("${art}")` } : { background: "linear-gradient(135deg, #1d2633, #0b0e13)" }}
      >
        <NoticeStack corner={look.corner}>
          <NoticeView key={seq} n={n} />
        </NoticeStack>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
        <span>Así se verá encima del juego, con los colores de tu tema.</span>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setSeq((x) => x + 1)}>
          {rare ? "Ver uno normal" : "Ver uno raro"}
        </Button>
      </div>
    </div>
  );
}

const MOD_KEYS = ["Shift", "Control", "Alt", "Meta"];

/** "Mayús + Tab" para mostrar; "Shift+Tab" es lo que se guarda. */
export function hotkeyLabel(k: string) {
  return k
    .split("+")
    .map((p) => (p.trim().toLowerCase() === "shift" ? "Mayús" : p.trim()))
    .join(" + ");
}

function keyName(e: KeyboardEvent): string | null {
  if (MOD_KEYS.includes(e.key)) return null;
  if (e.key === "Tab") return "Tab";
  if (e.key === " ") return "Space";
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  if (["Home", "End", "Insert", "Delete", "PageUp", "PageDown"].includes(e.key)) return e.key;
  if (e.code === "Backquote") return "`";
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  return null;
}

function HotkeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const fn = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setListening(false);
      const k = keyName(e);
      if (!k) return;
      const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"].filter(Boolean);
      // Sin modificador solo las F (una letra sola rompería la escritura en el juego).
      if (!mods.length && !/^F\d/.test(k)) return;
      setListening(false);
      onChange([...mods, k].join("+"));
    };
    window.addEventListener("keydown", fn, true);
    return () => window.removeEventListener("keydown", fn, true);
  }, [listening, onChange]);
  return (
    <div className="flex items-center gap-4 px-3 py-2">
      <span className="flex-1">
        <span className="block text-sm">Atajo del panel</span>
        <span className="mt-0.5 block text-xs text-muted">
          Solo funciona con el juego en primer plano. En los juegos de Steam, si coincide con el de Steam (Mayús + Tab), manda el de Steam; usa el
          botón Guía del mando o elige otro atajo.
        </span>
      </span>
      <Button icon={<Keyboard size={15} />} onClick={() => setListening((l) => !l)} className={listening ? "ring-2 ring-accent" : ""}>
        {listening ? "Pulsa la combinación…" : value ? hotkeyLabel(value) : "Sin atajo"}
      </Button>
      {value !== "Shift+Tab" && (
        <Button variant="ghost" size="sm" onClick={() => onChange("Shift+Tab")}>
          Restablecer
        </Button>
      )}
    </div>
  );
}

export function OverlayTab() {
  const settings = useApp((s) => s.settings)!;
  const save = useSave();
  const dirs = settings.achievementDirs ?? [];

  async function addDir() {
    const picked = await openDialog({ directory: true, multiple: false, title: "Carpeta con logros de emuladores (<appid>\\achievements.*)" });
    if (typeof picked === "string" && !dirs.includes(picked)) await save({ achievementDirs: [...dirs, picked] });
  }

  return (
    <div>
      <Section
        title="Overlay dentro del juego"
        actions={
          <Button size="sm" icon={<Sparkles size={14} />} disabled={!settings.overlayEnabled} onClick={() => api.overlayTest().catch((e) => useApp.getState().toast("error", errMsg(e)))}>
            Probar aviso
          </Button>
        }
      >
        <p className="px-3 pb-2 text-xs leading-relaxed text-muted">
          Una capa transparente encima del juego con los avisos de logros y un panel con tus logros, el tiempo de sesión y la hora. No toca el juego
          (sin inyección), así que funciona en ventana y en ventana sin bordes. Si el juego usa pantalla completa exclusiva, los avisos salen al
          salir de ella o al cerrar el juego.
        </p>
        <Toggle label="Activar el overlay" checked={settings.overlayEnabled} onChange={(v) => save({ overlayEnabled: v })} />
        {settings.overlayEnabled && (
          <>
            <HotkeyInput value={settings.overlayHotkey} onChange={(v) => save({ overlayHotkey: v })} />
            <Cycle label="Estilo de los avisos" value={settings.overlayStyle} options={STYLES} onChange={(v) => save({ overlayStyle: v })} />
            <Cycle label="Dónde salen" value={settings.overlayCorner} options={CORNERS} onChange={(v) => save({ overlayCorner: v })} />
            <NoticePreview settings={settings} />
            <Toggle label="Sonido al desbloquear un logro" checked={settings.overlaySound} onChange={(v) => save({ overlaySound: v })} />
            <Toggle
              label="Recordar el atajo al empezar a jugar"
              hint="Un aviso de unos segundos, como el de Steam."
              checked={settings.overlayStartHint}
              onChange={(v) => save({ overlayStartHint: v })}
            />
            <Toggle
              label="Avisar también de los logros de Steam"
              hint="Steam ya los enseña con su propio overlay; actívalo si lo tienes desactivado."
              checked={settings.overlaySteamNotify}
              onChange={(v) => save({ overlaySteamNotify: v })}
            />
          </>
        )}
      </Section>

      <Section title="Logros">
        <div className="space-y-2 px-3 pb-2 text-xs leading-relaxed text-muted">
          <p>
            <b className="text-fg">Steam:</b> se leen de las estadísticas que Steam guarda en tu PC, sin cuenta ni clave.
          </p>
          <p>
            <b className="text-fg">Juegos sueltos (solo el .exe):</b> si traen un emulador de la API de Steam, ejGames saca el appid de su
            configuración (<code>steam_appid.txt</code>, <code>steam_emu.ini</code>, <code>OnlineFix.ini</code>…) y lee sus logros de{" "}
            <code>achievements.ini</code> / <code>achievements.json</code>. Busca en la carpeta del juego y en las de siempre (Documentos públicos
            de Steam\CODEX y RUNE, OnlineFix, %APPDATA%\Goldberg SteamEmu Saves, GSE Saves, EMPRESS, SKIDROW…). Nombres, iconos y rareza salen de
            Steam.
          </p>
        </div>
        <div className="px-3 pt-1 text-sm">Carpetas extra</div>
        <p className="px-3 pb-2 text-xs text-muted">Otras carpetas donde tu emulador crea una subcarpeta por appid.</p>
        {dirs.map((d) => (
          <div key={d} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <span className="flex-1 truncate">{d}</span>
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => save({ achievementDirs: dirs.filter((x) => x !== d) })}>
              Quitar
            </Button>
          </div>
        ))}
        <div className="px-3 py-2">
          <Button size="sm" icon={<FolderPlus size={14} />} onClick={addDir}>
            Añadir carpeta
          </Button>
        </div>
      </Section>
    </div>
  );
}
