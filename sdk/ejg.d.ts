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
  /** folder: carpeta de la biblioteca · manual: .exe añadido a mano · repack: instalado desde Descargas. */
  source: "folder" | "manual" | "repack";
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
  /** Siempre true desde la 0.5.0 (ya no hay juegos de tiendas sin instalar). */
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

// ───────────── Explorar y descargas ─────────────

export type RepackState = "none" | "library" | "queued" | "downloading" | "paused" | "seeding" | "completed" | "installing" | "installed" | "error";

export interface Repack {
  source: string;
  id: number;
  slug: string;
  /** Nombre del juego, sin versión. */
  title: string;
  version?: string | null;
  fullTitle: string;
  url: string;
  date: string;
  number?: number | null;
  /** Portada vertical (miniatura) y a tamaño completo. */
  cover?: string | null;
  coverFull?: string | null;
  /** Captura grande para fondos y cabeceras. */
  hero?: string | null;
  /** Arte de la tienda de Steam, si el juego está allí: cápsula 460×215, la grande 616×353 y la vertical 600×900.
   *  Puede llegar después: el SDK avisa con el evento `explore-art` (`ejg.on("explore-art", …)`). */
  capsule?: string | null;
  capsuleBig?: string | null;
  library?: string | null;
  genres: string[];
  companies?: string | null;
  languages?: string | null;
  originalSize?: string | null;
  repackSize?: string | null;
  repackBytes?: number | null;
  /** Se pueden dejar sin bajar idiomas y extras. */
  selective: boolean;
  adult: boolean;
  /** Crack de hipervisor (HV, «HYPERVISOR» en la ficha de la web): para jugar hay que desactivar un rato
   *  la seguridad de Windows basada en virtualización. Márcalo junto al nombre y explícalo en la ficha
   *  (el kit trae `HYPERVISOR`, `repackName`, `hypervisorTag` y `hypervisorInfo`). */
  hypervisor?: boolean;
  /** Etiquetas de la web (ids de `ejg.explore.genres()`). */
  tags?: number[];
  /** Relación contigo: en tu biblioteca, descargando, instalado… */
  status: { state: RepackState; downloadId?: number | null; gameId?: number | null; progress?: number | null };
}

export interface ExplorePage {
  query: string;
  items: Repack[];
  page: number;
  pages: number;
  total: number;
  /** Filtrado con `maxGb` o `hideOwned`: el total es aproximado. */
  filtered?: boolean;
}

export interface Genre {
  id: number;
  name: string;
  /** genre (género) | view (perspectiva) | setting (ambientación) */
  group: "genre" | "view" | "setting";
}

export interface BrowseFilters {
  /** Texto en el título. */
  query?: string;
  /** Hasta 4; salen los juegos que los tienen todos. */
  genres?: number[];
  /** date = novedades, modified = actualizados hace poco, title = de la A a la Z. */
  sort?: "date" | "modified" | "title";
  /** Tamaño máximo de la descarga. */
  maxGb?: number | null;
  /** Quitar los que ya están en tu biblioteca o en descargas. */
  hideOwned?: boolean;
}

export interface RepackDetails extends Repack {
  screenshots: { thumb: string; full: string }[];
  features: string[];
  /** "up to 26.7 GB" */
  installSize?: string | null;
  /** Texto con saltos de línea; las listas empiezan por "• ". */
  description?: string | null;
}

export interface TorrentFile {
  index: number;
  path: string;
  size: number;
  /** setup y core son obligatorios; selective = idiomas; optional = extras. */
  kind: "setup" | "core" | "selective" | "optional" | "extra";
  label: string;
  required: boolean;
  /** Selección propuesta. */
  selected: boolean;
}

export interface PreparedDownload {
  token: string;
  slug: string;
  title: string;
  version?: string | null;
  name: string;
  files: TorrentFile[];
  totalBytes: number;
  /** Carpeta de descargas; "" si aún no hay: pedir una con downloads.pickFolder(). */
  dir: string;
  freeBytes?: number | null;
  installSize?: string | null;
  installDir: string;
  installFreeBytes?: number | null;
  /** Crack de hipervisor: avisa antes de bajarlo (`HYPERVISOR.download` en el kit). */
  hypervisor?: boolean;
}

export type DownloadState = "queued" | "downloading" | "paused" | "seeding" | "completed" | "installing" | "installed" | "error";

export interface Download {
  id: number;
  slug?: string | null;
  title: string;
  version?: string | null;
  cover?: string | null;
  hero?: string | null;
  /** Cápsula de la tienda de Steam (460×215), si el juego está allí. */
  capsule?: string | null;
  pageUrl?: string | null;
  state: DownloadState;
  /** Por qué espera o está parada: user | queue | playing | install | needs-folder */
  pauseReason?: string | null;
  error?: string | null;
  totalBytes: number;
  doneBytes: number;
  uploadedBytes: number;
  /** 0..1 */
  progress: number;
  /** Bytes por segundo. */
  downBps: number;
  upBps: number;
  peers: number;
  /** Segundos que faltan. */
  eta?: number | null;
  /** Comprobando lo ya descargado. */
  checking: boolean;
  queuePos: number;
  installSize?: string | null;
  outputDir: string;
  installDir?: string | null;
  /** Juego de la biblioteca, cuando ya está instalado. */
  gameId?: number | null;
  addedAt: number;
  completedAt?: number | null;
  installedAt?: number | null;
  /** El repack ya se borró (tras instalar). */
  filesDeleted: boolean;
}

// ───────────── Guías de Steam ─────────────

/** Trozo de texto con estilo. `href`: web (ábrela con guides.openLink); `guide`: otra guía (ábrela en tu lector). */
export interface GuideSpan {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  /** Oculto hasta que se pulsa. */
  spoiler?: boolean;
  href?: string;
  guide?: string;
}

/** Bloques de una guía. Nunca llega HTML: el tema decide cómo se ve cada uno. Los "
" del texto son saltos de línea. */
export type GuideBlock =
  | { t: "h"; level: 1 | 2 | 3; spans: GuideSpan[] }
  | { t: "p"; spans: GuideSpan[] }
  | { t: "list"; ordered: boolean; items: { depth: number; spans: GuideSpan[] }[] }
  | { t: "quote"; spans: GuideSpan[] }
  | { t: "code"; text: string }
  /** `thumb`: el autor la puso pequeña, a un lado. */
  | { t: "img"; src: string; thumb?: boolean }
  | { t: "table"; head: boolean; rows: GuideSpan[][][] }
  /** Vídeo de YouTube: miniatura y enlace (ábrelo con guides.openLink(url)). */
  | { t: "video"; id: string; url: string; thumb: string }
  | { t: "hr" };

export interface GuideItem {
  id: string;
  title: string;
  desc: string;
  author: string;
  /** 0-5; sin valoración aún: null. */
  stars?: number | null;
  preview?: string | null;
  /** Idioma aproximado: es, en, pt, fr, de, it, pl, tr, ru, uk, zh, ja, ko… ("" si no se sabe). */
  lang: string;
}

export interface GuideList {
  /** null: el juego no está identificado en Steam (no hay guías que buscar). */
  appid?: number | null;
  items: GuideItem[];
  page: number;
  pages: number;
  total: number;
  /** Página que pedir para seguir (null: no hay más). */
  next?: number | null;
  /** Solo español e inglés (sin allLanguages): `total` cuenta todas. */
  filtered: boolean;
}

export interface GuideQuery {
  page?: number;
  sort?: "toprated" | "trend" | "mostrecent";
  query?: string;
  /** Una categoría de Steam (ver GUIDE_CATEGORIES en /_sdk/kit/guides.js). */
  category?: string;
  allLanguages?: boolean;
}

export interface GuideProgress {
  section: number;
  /** 0..1 dentro de la sección. */
  scroll: number;
  readAt: number;
}

export interface Guide {
  id: string;
  title: string;
  authors: string[];
  stars?: number | null;
  ratings?: number | null;
  published?: string | null;
  updated?: string | null;
  preview?: string | null;
  intro: GuideBlock[];
  sections: { id: string; title: string; blocks: GuideBlock[] }[];
  lang: string;
  url: string;
  pinned: boolean;
  progress?: GuideProgress | null;
}

export interface GuideShelfItem {
  id: string;
  title: string;
  author: string;
  preview?: string | null;
  pinned: boolean;
  progress?: GuideProgress | null;
}

/** Tu perfil en corto (`ejg.profiles.me`). Todo es local: se guarda en el PC. */
export interface ProfileCard {
  id: number;
  name: string;
  avatarUrl?: string | null;
  /** Marco del avatar (id del kit: "", "gold", "neon"…). */
  frame: string;
  /** Fondo animado (id del kit) o "". */
  background: string;
  backgroundImageUrl?: string | null;
  /** Tema del perfil (id del kit) o "". */
  color: string;
  level: number;
  xp: number;
  badges: { id: string; tier: number }[];
  featuredBadge: string;
}

/** Tu perfil entero (`ejg.profiles.view()`), como lo pinta el kit (profile.js). */
export interface ProfilePage {
  id: number;
  name: string;
  memberSince: number;
  level: number;
  xp: number;
  badges: { id: string; tier: number }[];
  profile: {
    name: string;
    avatarUrl?: string | null;
    realName: string;
    country: string;
    bio: string;
    backgroundImageUrl?: string | null;
    frame: string;
    background: string;
    color: string;
    showcases: { type: string; game?: string; title?: string; text?: string; items?: string[] }[];
    featuredBadge: string;
  };
  summary: {
    games: { id: number; title: string; minutes: number; last?: number | null; ach?: [number, number] | null; coverUrl?: string; headerUrl?: string }[];
    stats: { minutes: number; achievements: number; perfect: number; library: number; played: number; recent: number; shots: number };
  };
  /** Lo último: partidas de 5 minutos o más, logros y juegos completados. */
  activity: { id: number; kind: "played" | "achievement" | "completed"; at: number; data: { game: string; minutes?: number; name?: string; rarity?: number | null; iconUrl?: string | null } }[];
  /** A qué juegas ahora (o null). */
  presence: { status: "online"; game: string; since?: number | null } | null;
}

/** Trainer instalado para un juego (resumen). */
export interface TrainerInfo {
  /** Nombre del archivo en la web de FLiNG. */
  name: string;
  /** El juego según FLiNG. */
  title: string;
  /** Cuántas opciones tiene. */
  options: number;
  gameVersion: string | null;
  /** Se abre solo al jugar. */
  autoStart: boolean;
  /** El .exe sigue en su sitio (un antivirus puede habérselo llevado). */
  present: boolean;
  anticheat: string | null;
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
  input: { source: "mouse" | "keyboard" | "gamepad"; pad: "xbox" | "playstation" | "nintendo" | "generic" };
  version: string;
  downloads: Download[];
  /** Explorar activado en los ajustes. */
  explore: boolean;
  /** Eventos de temporada: en sus fechas, siempre o nunca. */
  eventMode: "auto" | "on" | "off";
  /** Evento activo (con su paleta y su arte) o null. */
  season: SeasonEvent | null;
}

export interface SeasonEvent {
  id: string;
  name: string;
  dates: string;
  banner: string;
  video?: string;
  wallpaper?: string;
  wallpaperVideo?: string;
  wallpaperAlt?: string;
  palette: { accent: string; green: string; violet: string; bg: string; panel: string; text: string };
  genre: number;
  title: string;
  subtitle: string;
}

export interface Ejg {
  version: 1;
  ready(): Promise<Ejg>;
  on(event: "library" | "settings" | "css" | "collections" | "profile" | "mode" | "running" | "game-state" | "visibility" | "focus-return" | "input" | "downloads" | "explore" | "ui:view", fn: (data: any) => void): () => void;
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
    /** Logros (ficheros del emulador del juego, con nombres e iconos de Steam). Puede tardar la primera vez: descarga el esquema. */
    achievements(id: number): Promise<AchievementList>;
    launch(id: number): Promise<void>;
    favorite(id: number, value?: boolean): Promise<void>;
    hide(id: number, value: boolean): Promise<void>;
    rate(id: number, value: number | null): Promise<void>;
    edit(id: number): Promise<void>;
    openFolder(id: number): Promise<void>;
    /**
     * Abre el diálogo «Desinstalar» del host, que enseña qué pasará (desinstalador
     * del juego o carpeta a la papelera) y pide confirmación.
     */
    uninstall(id: number): Promise<void>;
    isRunning(id: number): boolean;
    onState(fn: (e: { gameId: number; state: "launching" | "running" | "stopped"; value?: number }) => void): () => void;
  };
  profiles: {
    current(): Profile | null;
    switch(): Promise<void>;
    readonly me: ProfileCard | null;
    onChange(fn: (me: ProfileCard | null) => void): () => void;
    view(): Promise<ProfilePage>;
    open(): Promise<void>;
    badges(): Promise<void>;
    edit(): Promise<void>;
  };
  stats: { get(days?: number): Promise<any>; recent(limit?: number): Promise<any[]> };
  storage: { getAll(): Promise<Record<string, any>>; get(key: string): Promise<any>; set(key: string, value: any): Promise<void> };
  ui: {
    open(
      name:
        | "settings" | "game" | "profiles" | "search" | "add-folder" | "stats" | "theme" | "collections" | "menu" | "explore" | "downloads"
        | "guides" | "trainer" | "map" | "profile" | "badges" | "profile-editor",
      args?: any,
    ): Promise<void>;
    toast(message: string, kind?: "info" | "ok" | "error"): Promise<void>;
    /** El host pide abrir una vista del tema (menú rápido, Ctrl+E, Ctrl+J, el indicador de descargas…). */
    onView(
      fn: (e: {
        view: "explore" | "downloads" | "repack" | "guides" | "profile" | "badges";
        slug?: string;
        gameId?: number;
        guideId?: string | null;
      }) => void,
    ): () => void;
    /** Teclado en pantalla del host: el texto escrito o null si se cancela. */
    keyboard(opts?: { title?: string; value?: string; placeholder?: string; maxLength?: number }): Promise<string | null>;
  };
  explore: {
    /** Lista de deseados de la tienda (por perfil, solo en este PC). */
    wishlist: {
      readonly items: (Repack & { addedAt: number })[];
      has(slug: string): boolean;
      add(slug: string): Promise<any[]>;
      remove(slug: string): Promise<any[]>;
      /** true si queda en la lista. */
      toggle(slug: string): Promise<boolean>;
      onChange(fn: (items: (Repack & { addedAt: number })[]) => void): () => void;
    };
    readonly enabled: boolean;
    onEnabled(fn: (enabled: boolean) => void): () => void;
    home(): Promise<{ sections: { id: "today" | "week" | "month" | "latest" | string; title: string; items: Repack[] }[] }>;
    search(query: string, page?: number): Promise<ExplorePage>;
    /** Catálogo con filtros. Con `maxGb` o `hideOwned` una página puede leer varias de la web: pide `page + 1` de la respuesta. */
    browse(filters?: BrowseFilters, page?: number): Promise<ExplorePage>;
    genres(): Promise<Genre[]>;
    details(slug: string): Promise<RepackDetails>;
    /** Abre la ficha en la web de la fuente (navegador del sistema). */
    openPage(slug: string): Promise<void>;
  };
  guides: {
    list(gameId: number, query?: GuideQuery): Promise<GuideList>;
    get(id: string): Promise<Guide>;
    shelf(gameId: number): Promise<{ pinned: GuideShelfItem[]; recent: GuideShelfItem[] }>;
    pin(gameId: number, guide: { id: string; title: string; author?: string; authors?: string[]; preview?: string | null }, value?: boolean): Promise<void>;
    progress(gameId: number, guide: { id: string; title: string; author?: string; authors?: string[] }, section: number, scroll: number): Promise<void>;
    openInBrowser(id: string): Promise<void>;
    openLink(href: string): Promise<void>;
  };
  /** Trucos con los trainers de FLiNG (buscar e instalar, siempre en la ventana del host). */
  trainer: {
    info(gameId: number): Promise<TrainerInfo | null>;
    open(gameId: number): Promise<void>;
  };
  /** Mapas interactivos de Map Genie. */
  maps: {
    info(gameId: number): Promise<{ game: { name: string; maps: string[] } | null; none: boolean }>;
    open(gameId: number): Promise<void>;
  };
  downloads: {
    readonly all: Download[];
    list(): Promise<Download[]>;
    onChange(fn: (list: Download[]) => void): () => void;
    byId(id: number): Download | undefined;
    defaults(): Promise<{ downloadDir: string; installDir: string; configured: boolean }>;
    prepare(slug: string): Promise<PreparedDownload>;
    cancelPrepare(slugOrToken: string): Promise<void>;
    start(token: string, files: number[], dir?: string | null): Promise<Download>;
    pause(id?: number): Promise<void>;
    resume(id?: number): Promise<void>;
    move(id: number, pos: number): Promise<void>;
    remove(id: number, deleteFiles?: boolean): Promise<void>;
    deleteFiles(id: number): Promise<void>;
    install(id: number): Promise<void>;
    locate(id: number): Promise<void>;
    openFolder(id: number): Promise<void>;
    pickFolder(current?: string): Promise<{ path: string; freeBytes?: number | null } | null>;
    open(view?: "explore" | "downloads", slug?: string): Promise<void>;
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
  /**
   * Evento de temporada (Halloween…). Mientras dura, el SDK pone `data-season` en
   * <html>, las variables `--ejg-season-*`, la paleta y el fondo del evento en las
   * opciones del tema y su capa de ambiente. Piezas para la tienda: /_sdk/kit/events.js.
   */
  season: {
    readonly mode: "auto" | "on" | "off";
    readonly id: string | null;
    readonly event: SeasonEvent | null;
    onChange(fn: (d: { mode: "auto" | "on" | "off"; season: SeasonEvent | null }) => void): () => void;
  };
  art(game: Game, kind: keyof MediaUrls | "cover" | "hero", thumb?: boolean): string | undefined;
}

declare global {
  interface Window {
    ejg: Ejg;
  }
}
