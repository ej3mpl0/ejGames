import { useState } from "react";
import { Cpu, Database, Download, Gamepad2, Library, Palette, Trophy, UserRound, Users } from "lucide-react";
import { Modal, Tabs } from "../../components/ui";
import { useOverlayNav } from "../../input/nav";
import { useApp } from "../../store/app";
import { AccountPanel } from "../../components/AccountPanel";
import { AppearanceTab } from "./AppearanceTab";
import { DownloadsTab } from "./DownloadsTab";
import { LibraryTab } from "./LibraryTab";
import { MetadataTab } from "./MetadataTab";
import { OverlayTab } from "./OverlayTab";
import { ProfileTab } from "./ProfileTab";
import { ControlsTab, SystemTab } from "./SystemTab";

type Tab = "library" | "metadata" | "appearance" | "profile" | "account" | "controls" | "overlay" | "downloads" | "system";

const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: "appearance", label: "Apariencia", icon: <Palette size={17} /> },
  { value: "library", label: "Biblioteca", icon: <Library size={17} /> },
  { value: "metadata", label: "Info y arte", icon: <Database size={17} /> },
  { value: "profile", label: "Perfil", icon: <UserRound size={17} /> },
  { value: "account", label: "Cuenta y amigos", icon: <Users size={17} /> },
  { value: "controls", label: "Mando y TV", icon: <Gamepad2 size={17} /> },
  { value: "overlay", label: "Overlay y logros", icon: <Trophy size={17} /> },
  { value: "downloads", label: "Descargas", icon: <Download size={17} /> },
  { value: "system", label: "Sistema", icon: <Cpu size={17} /> },
];

export function SettingsOverlay({ args, onClose }: { args?: Record<string, unknown> | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>((args?.tab as Tab) || "appearance");
  const ref = useOverlayNav<HTMLDivElement>({ onBack: onClose });
  const settings = useApp((s) => s.settings);
  if (!settings) return null;
  return (
    <Modal ref={ref} title="Ajustes" onClose={onClose}>
      <div className="flex h-full">
        <aside className="w-56 shrink-0 border-r border-line p-3">
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto p-5" key={tab}>
          {tab === "library" && <LibraryTab autoAdd={!!args?.addFolder} />}
          {tab === "metadata" && <MetadataTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "profile" && <ProfileTab />}
          {tab === "account" && <AccountPanel />}
          {tab === "controls" && <ControlsTab />}
          {tab === "overlay" && <OverlayTab />}
          {tab === "downloads" && <DownloadsTab />}
          {tab === "system" && <SystemTab />}
        </div>
      </div>
    </Modal>
  );
}
