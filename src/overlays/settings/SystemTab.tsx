import { useEffect, useState } from "react";
import { FolderOpen, Gamepad2, MonitorPlay, Power, RefreshCw } from "lucide-react";
import { api } from "../../api/tauri";
import type { NavAction, Settings } from "../../api/types";
import { Button, Cycle, Section, Toggle } from "../../components/ui";
import { GLYPHS } from "../../../sdk/kit/hints.js";
import { Glyph } from "../../components/Hints";
import { setBigPicture } from "../../host/window";
import { checkNow, useUpdate } from "../../host/update";
import { useApp } from "../../store/app";
import { LANG_LABELS, t, UI_LANGS, type Lang } from "../../lib/i18n";
import { BackupSection } from "./BackupSection";
import { RollbackSection } from "./RollbackSection";

function useSave() {
  const set = useApp((s) => s.set);
  return async (patch: Partial<Settings>) => set({ settings: await api.updateSettings(patch) });
}

export function ControlsTab() {
  const settings = useApp((s) => s.settings)!;
  const mode = useApp((s) => s.mode);
  const save = useSave();
  const [last, setLast] = useState<string>("—");
  const [pads, setPads] = useState<string[]>([]);

  useEffect(() => {
    const upd = () => setPads(Array.from(navigator.getGamepads()).filter(Boolean).map((g) => g!.id));
    upd();
    const fn = (e: Event) => setLast((e as CustomEvent<NavAction>).detail);
    window.addEventListener("gamepadconnected", upd);
    window.addEventListener("gamepaddisconnected", upd);
    window.addEventListener("ejg:nav-debug", fn);
    return () => {
      window.removeEventListener("gamepadconnected", upd);
      window.removeEventListener("gamepaddisconnected", upd);
      window.removeEventListener("ejg:nav-debug", fn);
    };
  }, []);

  return (
    <div>
      <Section title="Big Picture">
        <p className="px-3 pb-2 text-xs text-muted">Pantalla completa pensada para el sofá: los temas se adaptan a la tele y todo se maneja con el mando.</p>
        <div className="p-2">
          <Button variant="primary" icon={<MonitorPlay size={16} />} onClick={() => setBigPicture(mode !== "tv")}>
            {mode === "tv" ? "Salir de Big Picture" : "Entrar en Big Picture"}
          </Button>
        </div>
        <Toggle label="Arrancar siempre en Big Picture" checked={settings.startBigPicture} onChange={(v) => save({ startBigPicture: v })} />
      </Section>

      <Section title="Mando">
        <div className="flex items-center gap-3 px-3 py-2 text-sm">
          <Gamepad2 size={18} className="text-muted" />
          <span className="flex-1">{pads.length ? pads.join(" · ") : "Pulsa cualquier botón del mando para detectarlo"}</span>
          <span className="text-muted">
            Última acción: <span className="text-fg">{last}</span>
          </span>
        </div>
        <Toggle
          label="Botón Guía / PS durante la partida"
          hint="Abre el panel del overlay (o ejGames si el overlay está desactivado). También Select + Start mantenidos 1 s. En los juegos de Steam el botón Guía es de Steam: usa Select + Start."
          checked={settings.gamepadHomeButton}
          onChange={(v) => save({ gamepadHomeButton: v })}
        />
        <ControlsTable />
      </Section>
    </div>
  );
}

const ACTIONS: [NavAction, string][] = [
  ["accept", "Aceptar / jugar"],
  ["back", "Atrás / cerrar"],
  ["x", "Opciones / editar juego"],
  ["y", "Favorito"],
  ["lb", "Sección anterior"],
  ["rb", "Sección siguiente"],
  ["menu", "Menú rápido"],
  ["view", "Buscar"],
];

function ControlsTable() {
  const pad = useApp((s) => s.padType);
  const source = useApp((s) => s.inputSource);
  const padSet = ((GLYPHS as unknown as Record<string, Record<string, string[]>>)[pad] ?? GLYPHS.xbox) as Record<string, string[]>;
  const names: Record<string, string> = { xbox: "Mando Xbox", playstation: "Mando PlayStation", nintendo: "Mando Nintendo", generic: "Mando" };
  return (
    <div className="px-3 py-3 text-sm">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-8 gap-y-2">
        <span className="text-xs uppercase tracking-wide text-muted">Acción</span>
        <span className="text-xs uppercase tracking-wide text-muted">{names[pad] ?? "Mando"}</span>
        <span className="text-xs uppercase tracking-wide text-muted">Teclado</span>
        {ACTIONS.map(([a, label]) => (
          <div key={a} className="contents">
            <span>{label}</span>
            <span className="flex justify-center">
              <PadGlyph txt={padSet[a]?.[0] ?? a} color={padSet[a]?.[1]} ps={pad === "playstation"} />
            </span>
            <span className="text-muted">{GLYPHS.keyboard[a as keyof typeof GLYPHS.keyboard]?.[0]}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Las pistas de botones de toda la app cambian solas según uses {source === "gamepad" ? "el mando (ahora mismo)" : "mando o teclado"}.
        También: <b className="text-fg">F11</b> pantalla completa, <b className="text-fg">Ctrl ,</b> ajustes, <b className="text-fg">Shift</b> al
        arrancar para el modo seguro. Ahora mismo: <Glyph action="accept" />
      </p>
    </div>
  );
}

function PadGlyph({ txt, color, ps }: { txt: string; color?: string; ps: boolean }) {
  const round = txt.length <= 1;
  return (
    <span
      className="inline-grid place-items-center font-bold"
      style={{
        minWidth: 26,
        height: 26,
        padding: round ? 0 : "0 7px",
        borderRadius: round ? "50%" : 7,
        fontSize: 12,
        color: ps && color ? color : color ? "#fff" : "currentColor",
        background: ps && color ? "rgba(0,0,0,.5)" : color ?? "transparent",
        border: color && !ps ? "none" : `1.5px solid ${ps && color ? color : "currentColor"}`,
      }}
    >
      {txt}
    </span>
  );
}

const CLOSE_OPTIONS: { value: Settings["closeAction"]; label: string }[] = [
  { value: "ask", label: "Preguntar" },
  { value: "tray", label: "Minimizar a la bandeja" },
  { value: "quit", label: "Salir del todo" },
];

export function SystemTab() {
  const settings = useApp((s) => s.settings)!;
  const boot = useApp((s) => s.boot);
  const save = useSave();

  return (
    <div>
      <Section title={t("Idioma")}>
        <Cycle
          label={t("Idioma de la interfaz")}
          value={(settings.uiLanguage === "" || (UI_LANGS as readonly string[]).includes(settings.uiLanguage) ? settings.uiLanguage : "") as "" | Lang}
          options={[
            { value: "", label: t("El de Windows") },
            ...UI_LANGS.map((id) => ({ value: id, label: LANG_LABELS[id] })),
          ]}
          onChange={async (v) => {
            await save({ uiLanguage: v });
            // Todo (interfaz, tema y overlay) se vuelve a pintar en el idioma nuevo.
            location.reload();
          }}
        />
      </Section>

      <Section title="Inicio y bandeja">
        <Toggle label="Iniciar con Windows" hint="Arranca en la bandeja, sin ventana (apenas consume)." checked={settings.startWithWindows} onChange={(v) => save({ startWithWindows: v })} />
        <Toggle label="Arrancar minimizado en la bandeja" checked={settings.startMinimized} onChange={(v) => save({ startMinimized: v })} />
        <Cycle
          label="Al cerrar la ventana"
          value={settings.closeAction}
          options={CLOSE_OPTIONS}
          onChange={(v) => save({ closeAction: v })}
        />
        <Toggle label="Entrar automáticamente con el último perfil" hint="Los perfiles con PIN siempre lo piden." checked={settings.autoLogin} onChange={(v) => save({ autoLogin: v })} />
      </Section>

      <Section title="Discord Rich Presence">
        <Toggle
          label="Mostrar en Discord a qué estoy jugando"
          hint="Tus amigos verán «Jugando a <juego>» con su portada y «Jugando desde ejGames». También se puede quitar por perfil (Ajustes → Perfil) y por juego."
          checked={settings.discordEnabled}
          onChange={(v) => save({ discordEnabled: v })}
        />
      </Section>

      <Section title="Actualizaciones">
        <Toggle
          label="Buscar versiones nuevas al abrir ejGames"
          hint="Si hay una, te avisa y la descarga e instala con un clic, sin perder nada."
          checked={settings.updateAuto}
          onChange={(v) => save({ updateAuto: v })}
        />
        <UpdateRow />
      </Section>

      <BackupSection />

      <RollbackSection />

      <Section title="Datos">
        <div className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="flex-1 truncate text-muted">
            {boot?.dataDir} {boot?.portable && <span className="ml-2 rounded bg-accent/20 px-1.5 text-[10px] uppercase text-accent">portable</span>}
          </span>
          <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => api.openDataDir()}>
            Abrir
          </Button>
        </div>
      </Section>

      <Section title="Acerca de">
        <div className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="flex-1">
            ejGames <span className="text-muted">v{boot?.version}</span>
          </span>
          <Button size="sm" variant="danger" icon={<Power size={14} />} onClick={() => api.quit()}>
            Salir de ejGames
          </Button>
        </div>
      </Section>
    </div>
  );
}

function UpdateRow() {
  const boot = useApp((s) => s.boot);
  const open = useApp((s) => s.open);
  const { check, phase, checkError } = useUpdate();
  const status = checkError
    ? checkError
    : phase === "checking"
      ? "Buscando…"
      : check
        ? check.available
          ? `Hay una versión nueva: ${check.latest}`
          : `Tienes la última versión (${check.current})`
        : `Versión instalada: ${boot?.version ?? ""}`;
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className={checkError ? "flex-1 text-red-300" : "flex-1 text-muted"}>{status}</span>
      {check?.available && (
        <Button size="sm" variant="primary" onClick={() => open("update")}>
          Ver
        </Button>
      )}
      <Button size="sm" icon={<RefreshCw size={14} />} disabled={phase !== "idle"} onClick={() => void checkNow()}>
        Buscar ahora
      </Button>
    </div>
  );
}
