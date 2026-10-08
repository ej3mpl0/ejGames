import { create } from "zustand";
import { t as translate } from "../lib/i18n";
import type {
  Bootstrap,
  Collection,
  DownloadItem,
  LibGame,
  Profile,
  RunningGame,
  Settings,
  ThemeInfo,
  WishItem,
  CatalogJob,
  CatalogState,
  EmulatorCfg,
} from "../api/types";

export type PadType = "xbox" | "playstation" | "nintendo" | "generic";

export type OverlayName =
  | "settings"
  | "game"
  | "profiles"
  | "search"
  | "add-folder"
  | "stats"
  | "theme"
  | "collections"
  | "menu"
  | "explore"
  | "downloads"
  | "keyboard"
  | "update"
  | "uninstall"
  | "guides"
  | "trainer"
  | "map"
  | "year-review"
  | "software"
  | "rom-import"
  | "catalogs"
  | "onboarding";

export interface Overlay {
  name: OverlayName;
  args?: Record<string, unknown> | null;
}

export interface Toast {
  id: number;
  kind: string;
  message: string;
  action?: { label: string; run: () => void };
}

interface State {
  boot: Bootstrap | null;
  profiles: Profile[];
  profile: Profile | null;
  settings: Settings | null;
  themes: ThemeInfo[];
  games: LibGame[];
  collections: Collection[];
  running: RunningGame[];
  downloads: DownloadItem[];
  /** Lista de deseados de la tienda (del perfil activo). */
  wishlist: WishItem[];
  /** Explorar → Catálogos: fuentes configuradas (null = sin leer). */
  catalogState: CatalogState | null;
  /** Descargas directas de los catálogos (por `<fuente>|<id>`). */
  catalogJobs: Record<string, CatalogJob>;
  overlays: Overlay[];
  toasts: Toast[];
  meta: { done: number; total: number };
  scan: { phase: string; done: number; total: number; current: string } | null;
  mode: "desktop" | "tv";
  /** Tema forzado (modo seguro o tema roto). */
  themeOverride: string | null;
  /** Cargar los temas desde el origen de rescate (proceso nuevo). */
  safeOrigin: boolean;
  /** Cambia para forzar la recarga del iframe (modo dev). */
  themeReload: number;
  inputSource: "mouse" | "keyboard" | "gamepad";
  padType: PadType;

  set: (p: Partial<State>) => void;
  setGames: (g: LibGame[]) => void;
  patchGames: (changed: LibGame[], removed?: number[]) => void;
  open: (name: OverlayName, args?: Record<string, unknown> | null) => void;
  close: () => void;
  closeAll: () => void;
  toast: (kind: string, message: string, action?: Toast["action"]) => void;
  dismiss: (id: number) => void;
  upsertProfile: (p: Profile) => void;
}

let toastId = 0;

export const useApp = create<State>((set, get) => ({
  boot: null,
  profiles: [],
  profile: null,
  settings: null,
  themes: [],
  games: [],
  collections: [],
  running: [],
  downloads: [],
  wishlist: [],
  catalogState: null,
  catalogJobs: {},
  overlays: [],
  toasts: [],
  meta: { done: 0, total: 0 },
  scan: null,
  mode: "desktop",
  themeOverride: null,
  safeOrigin: false,
  themeReload: 0,
  inputSource: "mouse",
  padType: "xbox",

  set: (p) => set(p),
  setGames: (games) => set({ games }),
  patchGames: (changed, removed = []) => {
    const map = new Map(get().games.map((g) => [g.id, g]));
    for (const g of changed) map.set(g.id, g);
    for (const id of removed) map.delete(id);
    const games = [...map.values()].sort((a, b) => (a.sortTitle < b.sortTitle ? -1 : a.sortTitle > b.sortTitle ? 1 : 0));
    set({ games });
  },
  open: (name, args = null) => {
    const ov = get().overlays.filter((o) => o.name !== name);
    set({ overlays: [...ov, { name, args }] });
  },
  close: () => set({ overlays: get().overlays.slice(0, -1) }),
  closeAll: () => set({ overlays: [] }),
  toast: (kind, message, action) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, message: translate(message), action }] });
    setTimeout(() => get().dismiss(id), action ? 10000 : kind === "error" ? 7000 : 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  upsertProfile: (p) => {
    const profiles = get().profiles.some((x) => x.id === p.id)
      ? get().profiles.map((x) => (x.id === p.id ? p : x))
      : [...get().profiles, p];
    set({ profiles, profile: get().profile?.id === p.id ? p : get().profile });
  },
}));

export function activeTheme(s: Pick<State, "themes" | "profile" | "themeOverride">): ThemeInfo | undefined {
  const id = s.themeOverride ?? s.profile?.themeId ?? "steam";
  return s.themes.find((t) => t.id === id) ?? s.themes.find((t) => t.id === "steam") ?? s.themes[0];
}

/** Los juegos de consola de la biblioteca (ROMs propias y homebrew), por sistema. */
export function romLibrary(s: Pick<State, "games">): Map<string, LibGame[]> {
  const out = new Map<string, LibGame[]>();
  for (const g of s.games) {
    if (!g.platform || g.missing) continue;
    const list = out.get(g.platform) ?? [];
    list.push(g);
    out.set(g.platform, list);
  }
  return out;
}

/** Emulador elegido para cada sistema en Ajustes → Biblioteca → Emuladores. */
export function emulatorSettings(s: Pick<State, "settings">): Record<string, EmulatorCfg> {
  return Object.fromEntries((s.settings?.emulators ?? []).map((e) => [e.platform, e]));
}
