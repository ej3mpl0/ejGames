import { useState } from "react";
import { ArrowLeft, Cpu, Database, Download, Gamepad2, Info, Library, Minus, Palette, Square, Trophy, UserRound, X } from "lucide-react";
import { api } from "../../api/tauri";
import { Hints } from "../../components/Hints";
import { Tabs } from "../../components/ui";
import { useOverlayNav } from "../../input/nav";
import { useApp } from "../../store/app";
import { AboutTab } from "./AboutTab";
import { AppearanceTab } from "./AppearanceTab";
import { DownloadsTab } from "./DownloadsTab";
import { LibraryTab } from "./LibraryTab";
import { MetadataTab } from "./MetadataTab";
import { OverlayTab } from "./OverlayTab";
import { ProfileTab } from "./ProfileTab";
import { ControlsTab, SystemTab } from "./SystemTab";

type Tab = "library" | "metadata" | "appearance" | "profile" | "controls" | "overlay" | "downloads" | "system" | "about";

const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: "appearance", label: "Apariencia", icon: <Palette size={18} /> },
  { value: "library", label: "Biblioteca", icon: <Library size={18} /> },
  { value: "metadata", label: "Info y arte", icon: <Database size={18} /> },
  { value: "profile", label: "Perfil", icon: <UserRound size={18} /> },
  { value: "controls", label: "Mando y TV", icon: <Gamepad2 size={18} /> },
  { value: "overlay", label: "Overlay y logros", icon: <Trophy size={18} /> },
  { value: "downloads", label: "Descargas", icon: <Download size={18} /> },
  { value: "system", label: "Sistema", icon: <Cpu size={18} /> },
  { value: "about", label: "Acerca de", icon: <Info size={18} /> },
];

/** Ajustes a pantalla completa: barra lateral con las secciones y su contenido al lado. */
export function SettingsOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>((args?.tab as Tab) || "appearance");
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });
  const settings = useApp((s) => s.settings);
  const source = useApp((s) => s.inputSource);
  const mode = useApp((s) => s.mode);
  if (!settings) return null;
  const win = "grid h-16 w-[46px] place-items-center text-muted hover:bg-surface-3 hover:text-fg cursor-pointer";
  return (
    <div ref={ref} data-focus-trap className="overlay-enter absolute inset-0 z-40 flex flex-col bg-surface">
      <header
        className="flex h-16 shrink-0 items-center gap-3 pl-6"
        onMouseDown={(e) => {
          if (e.button === 0 && e.target === e.currentTarget) void api.windowAction(e.detail === 2 ? "toggle-maximize" : "drag");
        }}
      >
        <button data-nav aria-label="Volver (Esc)" title="Volver (Esc)" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-fg hover:bg-surface-3 cursor-pointer">
          <ArrowLeft size={19} />
        </button>
        <h1 className="pointer-events-none text-[22px] font-bold tracking-tight">Ajustes</h1>
        <div className="flex-1 self-stretch" onMouseDown={(e) => e.button === 0 && void api.windowAction(e.detail === 2 ? "toggle-maximize" : "drag")} />
        {source !== "mouse" && (
          <Hints
            items={[
              ["back", "Volver"],
              ["lb", "Sección anterior"],
              ["rb", "Siguiente"],
            ]}
          />
        )}
        {mode !== "tv" && (
          <div className="ml-2 flex">
            <button className={win} title="Minimizar" onClick={() => api.windowAction("minimize")}>
              <Minus size={15} />
            </button>
            <button className={win} title="Maximizar" onClick={() => api.windowAction("toggle-maximize")}>
              <Square size={12} />
            </button>
            <button className="grid h-16 w-[46px] place-items-center text-muted hover:bg-red-600 hover:text-white cursor-pointer" title="Cerrar" onClick={() => api.windowAction("close")}>
              <X size={16} />
            </button>
          </div>
        )}
      </header>
      <div className="flex min-h-0 flex-1 gap-8 px-8 pb-6">
        <aside className="w-60 shrink-0 overflow-y-auto pt-2">
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto pr-2 pt-2" key={tab}>
          <div className="panel-enter mx-auto max-w-[980px] pb-10">
            {tab === "library" && <LibraryTab autoAdd={!!args?.addFolder} />}
            {tab === "metadata" && <MetadataTab />}
            {tab === "appearance" && <AppearanceTab />}
            {tab === "profile" && <ProfileTab />}
            {tab === "controls" && <ControlsTab />}
            {tab === "overlay" && <OverlayTab />}
            {tab === "downloads" && <DownloadsTab />}
            {tab === "system" && <SystemTab />}
            {tab === "about" && <AboutTab />}
          </div>
        </main>
      </div>
    </div>
  );
}
