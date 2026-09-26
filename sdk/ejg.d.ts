// Tipos del SDK de temas de ejGames (v1). Úsalos con `// @ts-check` + JSDoc
// o desde TypeScript: `/// <reference path="http://ejg-theme.localhost/_sdk/ejg.d.ts" />`.

export interface MediaUrls {
  cover?: string;
  coverThumb?: string;
  hero?: string;
  heroThumb?: string;
  logo?: string;
  icon?: string;
  header?: string;
  microtrailer?: string;
}

export interface Game {
  id: number;
  title: string;
  sortTitle: string;
  source: "folder" | "steam" | "epic" | "gog" | "ea" | "ubisoft" | "manual";
  engine?: string;
  shortDescription?: string;
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  genres: string[];
  tags: string[];
  rating?: number;
  metaStatus: "pending" | "matched" | "review" | "manual" | "failed";
  missing: boolean;
  /** false = lo tienes en la tienda pero no está instalado (launch() abre la tienda para instalarlo). */
  installed: boolean;
  addedAt: number;
  favorite: boolean;
  hidden: boolean;
  lastPlayed?: number;
  /** segundos */
  playtime: number;
  launchCount: number;
  userRating?: number;
  collections: number[];
  media: MediaUrls;
  running: boolean;
  /** Logros desbloqueados / totales. Solo si el juego tiene logros detectados. */
  achievements?: { unlocked: number; total: number };
}

export interface Achievement {
  apiName: string;
  /** Los ocultos sin desbloquear llegan como "Logro oculto", sin icono. */
  name: string;
  description?: string;
  /** Icono en color (desbloqueado) y en gris (bloqueado), servidos por ejg-media. */
  icon?: string;
  iconGray?: string;
  hidden: boolean;
  /** % de jugadores de Steam que lo tienen. */
  globalPct?: number;
  /** Fecha de desbloqueo (Unix, segundos); sin ella está bloqueado. */
  unlockedAt?: number;
}

export interface AchievementList {
  gameId: number;
  appid?: number;
  total: number;
  unlocked: number;
  /** En el orden del juego. */
  items: Achievement[];
}

export interface MediaItem {
  id: number;
  kind: string;
  url: string;
  thumb?: string;
  poster?: string;
  title?: string;
}

export interface GameDetails extends Game {
  description?: string;
  installDir?: string;
  screenshots: MediaItem[];
  trailers: MediaItem[];
  recentSessions: { id: number; gameId: number; startedAt: number; endedAt: number; duration: number }[];
  steamAppid?: number;
}

export interface Collection {
  id: number;
  name: string;
  kind: "manual" | "smart";
  rules: Record<string, unknown>;
  gameIds: number[];
}

export interface Profile {
  id: number;
  name: string;
  avatar?: string;
  color: string;
  themeId: string;
}

export type NavAction =
  | "up" | "down" | "left" | "right" | "accept" | "back" | "x" | "y"
  | "lb" | "rb" | "lt" | "rt" | "menu" | "view" | "home";

export interface NavEvent {
  action: NavAction;
  source: "keyboard" | "gamepad";
  repeat: boolean;
  /** Marca el evento como gestionado (si no, "back" lo gestiona el host). */
  preventDefault(): void;
}

export interface InitData {
  sdk: number;
  theme: { id: string; name: string; settings: any[] };
  settings: Record<string, unknown>;
  customCss: string;
  profile: Profile;
  library: Game[];
  collections: Collection[];
  running: { gameId: number; startedAt?: number }[];
  mode: "desktop" | "tv";
  version: string;
}

export interface Ejg {
  version: 1;
  ready(): Promise<Ejg>;
  on(event: "library" | "settings" | "css" | "collections" | "profile" | "mode" | "running" | "game-state" | "visibility" | "meta-progress" | "focus-return" | "input", fn: (data: any) => void): () => void;
  readonly init: InitData | null;
  readonly settings: Record<string, any>;
  readonly profile: Profile | null;
  readonly mode: "desktop" | "tv";
  library: {
    readonly all: Game[];
    get(): Promise<Game[]>;
    byId(id: number): Game | undefined;
    onChange(fn: (d: { full?: Game[]; changed?: Game[]; removed?: number[] }) => void): () => void;
    readonly collections: Collection[];
  };
  game: {
    details(id: number): Promise<GameDetails>;
    /** Logros (Steam o emuladores locales). Puede tardar la primera vez: descarga el esquema. */
    achievements(id: number): Promise<AchievementList>;
    launch(id: number): Promise<void>;
    favorite(id: number, value?: boolean): Promise<void>;
    hide(id: number, value: boolean): Promise<void>;
    rate(id: number, value: number | null): Promise<void>;
    edit(id: number): Promise<void>;
    openFolder(id: number): Promise<void>;
    isRunning(id: number): boolean;
    onState(fn: (e: { gameId: number; state: "launching" | "running" | "stopped"; value?: number }) => void): () => void;
  };
  profiles: { current(): Profile | null; switch(): Promise<void> };
  stats: { get(days?: number): Promise<any>; recent(limit?: number): Promise<any[]> };
  storage: { getAll(): Promise<Record<string, any>>; get(key: string): Promise<any>; set(key: string, value: any): Promise<void> };
  ui: {
    open(name: "settings" | "game" | "profiles" | "search" | "add-folder" | "stats" | "theme" | "collections" | "menu", args?: any): Promise<void>;
    toast(message: string, kind?: "info" | "ok" | "error"): Promise<void>;
  };
  input: {
    on(event: "nav", fn: (e: NavEvent) => void): () => void;
    /** Dispositivo usado por última vez (para mostrar glifos de mando o de teclado). */
    readonly source: "mouse" | "keyboard" | "gamepad";
    readonly pad: "xbox" | "playstation" | "nintendo" | "generic";
  };
  sound: { play(name: "move" | "select" | "back" | "launch" | "error" | "open"): void };
  window: { minimize(): Promise<void>; maximize(): Promise<void>; close(): Promise<void>; fullscreen(v?: boolean): Promise<void> };
  app: { info(): Promise<{ version: string; running: any[]; meta: [number, number] }> };
  art(game: Game, kind: keyof MediaUrls | "cover" | "hero", thumb?: boolean): string | undefined;
}

declare global {
  interface Window {
    ejg: Ejg;
  }
}
