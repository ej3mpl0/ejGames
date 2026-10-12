// Acerca de: la versión, las actualizaciones (y volver a una anterior), los
// enlaces del proyecto y quién lo hace.

import { BookOpen, Code2, ExternalLink, Power, ScrollText } from "lucide-react";
import { api } from "../../api/tauri";
import type { Settings } from "../../api/types";
import { Button, Section, Toggle } from "../../components/ui";
import { useApp } from "../../store/app";
import { RollbackSection } from "./RollbackSection";
import { UpdateRow } from "./SystemTab";

const AUTHOR_URL = "https://x.com/ej3mplo";
const LINKS = [
  { label: "Documentación", hint: "Cómo se usa todo y cómo crear temas", url: "https://ej3mplo.mintlify.site", icon: <BookOpen size={18} /> },
  { label: "Novedades", hint: "Lo que trae cada versión", url: "https://github.com/ej3mpl0/ejGames/blob/main/CHANGELOG.md", icon: <ScrollText size={18} /> },
  { label: "Código en GitHub", hint: "Es libre (MIT): avisa de fallos o propón mejoras", url: "https://github.com/ej3mpl0/ejGames", icon: <Code2 size={18} /> },
];

export function AboutTab() {
  const boot = useApp((s) => s.boot);
  const settings = useApp((s) => s.settings);
  const set = useApp((s) => s.set);
  const save = async (patch: Partial<Settings>) => set({ settings: await api.updateSettings(patch) });
  if (!settings) return null;
  return (
    <div>
      <section className="mb-8 flex items-center gap-6 rounded-[calc(var(--h-radius)*1.25)] bg-surface-2 p-7">
        <svg width="88" height="88" viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
          <circle cx="50" cy="50" r="50" fill="#ff3a2d" />
          <circle cx="50" cy="50" r="38" fill="none" stroke="var(--h-surface-2)" strokeWidth="3.5" />
          <rect x="27" y="44.5" width="46" height="11" fill="var(--h-surface-2)" />
        </svg>
        <div className="min-w-0 flex-1">
          <h2 className="text-[32px] font-extrabold leading-tight tracking-tight">ejGames</h2>
          <p className="mt-1 text-[15px] text-muted">Versión {boot?.version}</p>
          <button
            data-nav
            onClick={() => void api.openExternal(AUTHOR_URL)}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-surface-3 px-4 py-2 text-sm font-semibold hover:brightness-125 cursor-pointer"
          >
            Hecho por <span className="text-fg">@ej3mplo</span>
            <ExternalLink size={14} className="text-muted" />
          </button>
        </div>
      </section>

      <Section title="Actualizaciones">
        <Toggle
          label="Buscar versiones nuevas al abrir ejGames"
          hint="Si hay una, te avisa y la descarga e instala con un clic, sin perder nada."
          checked={settings.updateAuto}
          onChange={(v) => save({ updateAuto: v })}
        />
        <UpdateRow />
      </Section>

      <RollbackSection />

      <Section title="Enlaces">
        {LINKS.map((l) => (
          <button
            key={l.url}
            data-nav
            onClick={() => void api.openExternal(l.url)}
            className="flex w-full items-center gap-4 rounded-[calc(var(--h-radius)*0.7)] px-4 py-3 text-left hover:bg-surface-3/60 cursor-pointer"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-3">{l.icon}</span>
            <span className="flex-1">
              <span className="block text-[15px] font-medium">{l.label}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{l.hint}</span>
            </span>
            <ExternalLink size={16} className="text-muted" />
          </button>
        ))}
      </Section>

      <div className="flex justify-end">
        <Button variant="danger" icon={<Power size={15} />} onClick={() => api.quit()}>
          Salir de ejGames
        </Button>
      </div>
    </div>
  );
}
