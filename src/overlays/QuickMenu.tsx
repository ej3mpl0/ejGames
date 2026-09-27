// Menú rápido (botón Guía / Ctrl+K): lo esencial a un botón de distancia.

import { BarChart3, Compass, Download, FolderPlus, Gamepad2, Library, LogOut, Minimize2, MonitorPlay, Power, Search, Settings, StopCircle } from "lucide-react";
import { openExplore } from "../host/downloads";
import { api } from "../api/tauri";
import { setBigPicture } from "../host/window";
import { useOverlayNav } from "../input/nav";
import { useApp } from "../store/app";
import { relative } from "../lib/format";
import { Avatar } from "./ProfilePicker";
import { Hints } from "../components/Hints";

export function QuickMenu({ onClose }: { onClose: () => void }) {
  const open = useApp((s) => s.open);
  const profile = useApp((s) => s.profile);
  const running = useApp((s) => s.running);
  const mode = useApp((s) => s.mode);
  const exploreOn = useApp((s) => s.settings?.exploreEnabled !== false);
  const downloads = useApp((s) => s.downloads);
  const pending = downloads.filter((d) => ["queued", "downloading", "paused", "seeding", "completed", "installing", "error"].includes(d.state)).length;
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose, extra: { home: onClose } });

  const item = (icon: React.ReactNode, label: string, fn: () => void, autofocus = false) => (
    <button
      data-nav
      data-autofocus={autofocus || undefined}
      onClick={fn}
      className="flex h-12 w-full items-center gap-3.5 rounded-xl px-4 text-left text-[15px] hover:bg-white/8 cursor-pointer"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );

  return (
    <div className="overlay-enter absolute inset-0 z-40 bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} data-focus-trap className="panel-enter glass absolute bottom-0 left-0 top-0 flex w-[360px] flex-col gap-1 p-4 shadow-2xl">
        {profile && (
          <div className="mb-3 flex items-center gap-3 px-2 pt-8">
            <Avatar p={profile} size={48} />
            <div>
              <div className="font-medium">{profile.name}</div>
              <div className="text-xs text-muted">{running.length ? `Jugando a ${running.map((r) => r.title).join(", ")}` : "En línea"}</div>
            </div>
          </div>
        )}
        {running.map((r) => (
          <div key={r.gameId} className="mb-2 rounded-xl bg-accent/12 p-3 ring-1 ring-accent/40">
            <div className="flex items-center gap-2 text-sm">
              <Gamepad2 size={16} className="text-accent" />
              <span className="flex-1 truncate">{r.title}</span>
            </div>
            <div className="mt-1 text-xs text-muted">{r.startedAt ? `Desde ${relative(r.startedAt)}` : "Arrancando…"}</div>
            <button data-nav onClick={() => api.stopTracking(r.gameId)} className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted hover:text-fg cursor-pointer">
              <StopCircle size={13} /> Dejar de contar esta partida
            </button>
          </div>
        ))}
        {item(<Library size={19} />, "Volver a la biblioteca", onClose, true)}
        {item(<Search size={19} />, "Buscar", () => open("search"))}
        {exploreOn && item(<Compass size={19} />, "Explorar", () => openExplore("explore"))}
        {(exploreOn || downloads.length > 0) && item(<Download size={19} />, pending ? `Descargas (${pending})` : "Descargas", () => openExplore("downloads"))}
        {item(<BarChart3 size={19} />, "Estadísticas", () => open("stats"))}
        {item(<FolderPlus size={19} />, "Añadir juegos", () => open("settings", { tab: "library", addFolder: true }))}
        {item(<Settings size={19} />, "Ajustes", () => open("settings"))}
        {item(<LogOut size={19} />, "Cambiar de perfil", () => open("profiles"))}
        <div className="my-2 h-px bg-line" />
        {item(<MonitorPlay size={19} />, mode === "tv" ? "Salir de Big Picture" : "Big Picture", () => {
          onClose();
          void setBigPicture(mode !== "tv");
        })}
        {item(<Minimize2 size={19} />, "Minimizar", () => {
          onClose();
          void api.windowAction("minimize");
        })}
        {item(<Power size={19} />, "Salir de ejGames", () => api.quit())}
        <Hints
          className="mt-auto px-2 pb-2"
          items={[
            ["accept", "Elegir"],
            ["back", "Volver"],
          ]}
        />
      </div>
    </div>
  );
}
