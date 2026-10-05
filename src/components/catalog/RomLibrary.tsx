// Biblioteca de ROMs agrupada por plataforma, con el emulador de cada una (que se
// puede cambiar) y «Jugar» en cada juego.

import { useState } from "react";
import { FolderPlus, Gamepad2, Play, Settings2 } from "lucide-react";
import type { LibGame, Platform } from "../../api/types";
import { launchRom } from "../../host/emulator-launcher";
import { romExtras, romGroups, type RomGroup } from "../../host/rom-manager";
import { t } from "../../lib/i18n";
import { useApp } from "../../store/app";
import { Button, Empty } from "../ui";
import { EmulatorSelector } from "./EmulatorSelector";
import { PlatformIcon } from "./PlatformSelector";

export function PlatformSection({ platform, name, roms, emulator }: { platform: Platform | null; name: string; roms: LibGame[]; emulator: string }) {
  const [edit, setEdit] = useState(false);
  return (
    <section className="rounded-xl bg-surface-2/60 p-3 ring-1 ring-line">
      <header className="mb-2 flex flex-wrap items-center gap-3">
        <PlatformIcon platform={platform} size={34} />
        <div className="min-w-0 flex-1">
          <b className="block truncate">{name}</b>
          <span className="text-xs text-muted">
            {roms.length === 1 ? t("1 juego") : t("{n} juegos", { n: roms.length })} ·{" "}
            {emulator ? t("Se juega con {emu}", { emu: emulator }) : <span className="text-amber-300/90">{t("Sin emulador")}</span>}
          </span>
        </div>
        <Button size="sm" variant="ghost" icon={<Settings2 size={13} />} onClick={() => setEdit((v) => !v)}>
          {t("Emulador")}
        </Button>
      </header>
      {edit && (
        <div className="mb-2 rounded-lg bg-surface-3/60 p-2">
          <EmulatorSelector platform={platform} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-3">
        {roms.map((g) => {
          const extras = romExtras(g);
          return (
            <div key={g.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-3/50">
              <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-surface-3">{g.media?.cover && <img src={g.media.cover} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{g.title}</div>
                <div className="truncate text-[11px] text-muted">
                  {[g.rom?.region, g.rom?.version && `v${g.rom.version}`, extras.length && t("{n} extras (DLC/actualizaciones)", { n: extras.length })].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<Play size={13} />} onClick={() => void launchRom({ gameId: g.id }).catch(() => {})} aria-label={t("Jugar")} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function RomLibrary() {
  const games = useApp((s) => s.games);
  const groups: RomGroup[] = romGroups(games);
  if (!groups.length)
    return (
      <Empty icon={<Gamepad2 size={40} />} title={t("Todavía no tienes ROMs")}>
        <div className="mt-2 flex justify-center">
          <Button icon={<FolderPlus size={15} />} onClick={() => useApp.getState().open("rom-import")}>
            {t("Importar ROMs")}
          </Button>
        </div>
      </Empty>
    );
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <PlatformSection key={g.system} platform={g.platform} name={g.name} roms={g.roms} emulator={g.emulator} />
      ))}
    </div>
  );
}
