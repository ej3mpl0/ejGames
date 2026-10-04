// Tipos espejo de los modelos Rust (serde camelCase).

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

export interface RepackUpdate {
  slug: string;
  installed: string;
  latest: string;
}

export interface LibGame {
  id: number;
  /** El repack instalado tiene una versión más nueva en la tienda. */
  repackUpdate?: RepackUpdate;
  title: string;
  sortTitle: string;
  source: string;
  engine?: string | null;
  shortDescription?: string | null;
  developer?: string | null;
  publisher?: string | null;
  releaseDate?: string | null;
  genres: string[];
  tags: string[];
  rating?: number | null;
  metaStatus: string;
  missing: boolean;
  installed: boolean;
  addedAt: number;
  favorite: boolean;
  hidden: boolean;
  lastPlayed?: number | null;
  playtime: number;
  launchCount: number;
  userRating?: number | null;
  collections: number[];
  media: MediaUrls;
  running: boolean;
  /** Logros desbloqueados / totales (solo si el juego tiene). */
  achievements?: AchSummary;
}

export interface AchSummary {
  unlocked: number;
  total: number;
}

export interface Achievement {
  apiName: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  iconGray?: string | null;
  hidden: boolean;
  globalPct?: number | null;
  unlockedAt?: number | null;
  /** Puntos al estilo Xbox (1000 por juego, repartidos por rareza). */
  score?: number | null;
}

export interface AchList {
  gameId: number;
  appid?: number | null;
  total: number;
  unlocked: number;
  items: Achievement[];
}

export type NoticeStyle = "steam" | "playstation" | "xbox" | "switch" | "cinema" | "retro" | "ejgames";
export type NoticeCorner = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

/** Aspecto de los avisos: estilo y, si es el del propio tema, sus colores. */
export interface NoticeLook {
  style: NoticeStyle;
  corner: NoticeCorner;
  accent?: string | null;
  surface?: string | null;
  text?: string | null;
  radius?: string | null;
  font?: string | null;
  dark: boolean;
  palette?: string | null;
}

export interface OverlayNotice {
  id: number;
  kind: "achievement" | "info" | "summary" | "screenshot";
  gameId?: number | null;
  game?: string | null;
  title: string;
  body?: string | null;
  icon?: string | null;
  rarity?: number | null;
  at: number;
  /** Puntos al estilo Xbox (1000 por juego). */
  score?: number | null;
  /** [conseguidos, total] contando este. */
  progress?: [number, number] | null;
  look: NoticeLook;
}

export interface OverlayPanel {
  gameId: number;
  title: string;
  startedAt?: number | null;
  media: MediaUrls;
  hotkey?: string | null;
  screenshotHotkey?: string | null;
  achievements?: AchList | null;
  pad: boolean;
  look: NoticeLook;
  /** Segundos jugados antes de esta partida. */
  playtime: number;
  launchCount: number;
  note: string;
  captures: Capture[];
  capturesDir: string;
  live: OverlayLive;
  developer?: string | null;
  releaseYear?: string | null;
  /** Volumen de los sonidos de la interfaz del perfil (0..1). */
  soundsVolume: number;
}

export interface Capture {
  id: number;
  gameId: number;
  url: string;
  thumb: string;
  path: string;
  width: number;
  height: number;
  takenAt: number;
}

export interface OverlayLive {
  perf?: {
    cpu: number;
    ram: number;
    gpu?: number | null;
    vram?: number | null;
    sysCpu: number;
    sysRamUsed: number;
    sysRamTotal: number;
    fps?: { fps: number; low1: number; frametime: number } | null;
    /** off | on | denied | error */
    fpsStatus?: string;
  } | null;
  media?: {
    title: string;
    artist: string;
    album: string;
    app: string;
    playing: boolean;
    art?: string | null;
    position?: number | null;
    duration?: number | null;
    canPrev: boolean;
    canNext: boolean;
  } | null;
  volume?: { game?: number | null; gameMuted: boolean; master: number; masterMuted: boolean } | null;
  pad?: { name: string; state: "wired" | "charging" | "discharging" | "charged" | "unknown"; level?: number | null } | null;
  battery?: { level: number; charging: boolean } | null;
  downloads: {
    items: {
      id: number;
      title: string;
      state: string;
      pauseReason?: string | null;
      progress: number;
      downBps: number;
      eta?: number | null;
      capsule?: string | null;
      cover?: string | null;
    }[];
    pausedForGame: boolean;
    allowed: boolean;
  };
}

export interface OverlayInit {
  notices: OverlayNotice[];
  panel?: OverlayPanel | null;
  pin?: OverlayPin | null;
}

/** Mapa anclado encima del juego. */
export interface OverlayPin {
  gameId: number;
  url: string;
}

export interface MediaItem {
  id: number;
  kind: string;
  url: string;
  thumb?: string | null;
  remoteUrl?: string | null;
  source: string;
  selected: boolean;
  title?: string | null;
  w?: number | null;
  h?: number | null;
  poster?: string | null;
}

export interface Session {
  id: number;
  gameId: number;
  startedAt: number;
  endedAt: number;
  duration: number;
}

export interface GameDetails extends LibGame {
  description?: string | null;
  installDir?: string | null;
  screenshots: MediaItem[];
  trailers: MediaItem[];
  recentSessions: Session[];
  steamAppid?: number | null;
}

export interface Game {
  id: number;
  title: string;
  sortTitle: string;
  source: string;
  sourceId: string;
  folderId?: number | null;
  installDir?: string | null;
  exePath?: string | null;
  args: string;
  workingDir?: string | null;
  launchUri?: string | null;
  runAsAdmin: boolean;
  processHints: string[];
  engine?: string | null;
  steamAppid?: number | null;
  sgdbId?: number | null;
  igdbId?: number | null;
  description?: string | null;
  shortDescription?: string | null;
  developer?: string | null;
  publisher?: string | null;
  releaseDate?: string | null;
  genres: string[];
  tags: string[];
  rating?: number | null;
  metaStatus: string;
  matchConfidence?: number | null;
  metaLocked: string[];
  discordEnabled: boolean;
  missing: boolean;
  addedAt: number;
  updatedAt: number;
  installed: boolean;
}

export interface GameFull {
  game: Game;
  exeCandidates: [string, number][];
  media: MediaItem[];
  /** Por qué se abriría como administrador sin pedirlo en ejGames. */
  elevation: "manifest" | "windows" | null;
}

export interface GamePatch {
  title?: string;
  exePath?: string;
  args?: string;
  workingDir?: string | null;
  launchUri?: string | null;
  runAsAdmin?: boolean;
  description?: string;
  shortDescription?: string;
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  genres?: string[];
  discordEnabled?: boolean;
  processHints?: string[];
}

export interface Profile {
  id: number;
  name: string;
  avatar?: string | null;
  color: string;
  themeId: string;
  themeSettings: Record<string, Record<string, unknown>>;
  customCss: Record<string, string>;
  hasPin: boolean;
  discordEnabled: boolean;
  discordHideNames: boolean;
  launchBehavior: "none" | "minimize" | "saver";
  soundsVolume: number;
  createdAt: number;
  lastUsed?: number | null;
}

export interface ProfilePatch {
  name?: string;
  avatar?: string | null;
  color?: string;
  themeId?: string;
  discordEnabled?: boolean;
  discordHideNames?: boolean;
  launchBehavior?: string;
  soundsVolume?: number;
  pin?: string;
}

export interface Collection {
  id: number;
  profileId: number;
  name: string;
  kind: "manual" | "smart";
  rules: Record<string, unknown>;
  position: number;
  gameIds: number[];
}

export interface LibraryFolder {
  id: number;
  path: string;
  mode: "subfolders" | "single";
  enabled: boolean;
  lastScan?: number | null;
  gameCount: number;
}

export interface FolderInspection {
  path: string;
  suggestedMode: "subfolders" | "single";
  preview: string[];
  exists: boolean;
}

export interface ThemeSetting {
  key: string;
  type: "color" | "range" | "number" | "toggle" | "select" | "font" | "image" | "text";
  label: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  group?: string;
  help?: string;
}

export interface ThemeHostStyle {
  accent?: string;
  surface?: string;
  text?: string;
  radius?: string;
  font?: string;
  dark?: boolean;
}

export interface ThemeInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  sdk: number;
  entry: string;
  preview?: string | null;
  modes: string[];
  settings: ThemeSetting[];
  sounds: { preset?: string; [k: string]: string | undefined } | null;
  palette: string[];
  host: ThemeHostStyle | null;
  windowControls?: "host" | "theme" | null;
  overlay?: { style?: NoticeStyle } | null;
  /** Vistas propias del tema (sin ellas, el host abre las suyas). */
  /** `social` es el nombre de antes de `profile` (0.7). */
  features?: { explore?: boolean; guides?: boolean; profile?: boolean; social?: boolean } | null;
  builtin: boolean;
  dir: string;
  previewUrl?: string | null;
  compatible: boolean;
}

export interface SavePath {
  path: string;
  /** manifest | emulator | steam | manual */
  source: string;
  bytes: number;
  files: number;
}
export interface SaveSnapshot {
  id: number;
  gameId: number;
  at: number;
  size: number;
  note: string;
}
export interface SavesInfo {
  paths: SavePath[];
  snapshots: SaveSnapshot[];
  known: boolean;
}

export interface BackupInfo {
  app: string;
  version: string;
  created: number;
  pc: string;
  games: number;
  profiles: number;
  withMedia: boolean;
  path: string;
  size: number;
}

export interface Settings {
  /** "" (el de Windows) | "es" | "en". */
  uiLanguage: string;
  overlayFps: boolean;
  savesAuto: boolean;
  savesKeep: number;
  gameModePower: boolean;
  gameModeDnd: boolean;
  backupDir: string;
  backupAuto: boolean;
  backupMedia: boolean;
  backupKeep: number;
  backupLast: number;
  backupSeen: number;
  language: string;
  country: string;
  sgdbKey: string;
  igdbClientId: string;
  igdbClientSecret: string;
  discordEnabled: boolean;
  trailerCacheMb: number;
  trailerMaxHeight: number;
  startWithWindows: boolean;
  startMinimized: boolean;
  startBigPicture: boolean;
  gamepadHomeButton: boolean;
  lastProfile?: number | null;
  autoLogin: boolean;
  /** La X de la ventana: preguntar, seguir en la bandeja o salir del todo. */
  closeAction: "ask" | "tray" | "quit";
  /** Eventos de temporada en la tienda: en sus fechas, siempre o nunca. */
  eventMode: "auto" | "on" | "off";
  devMode: boolean;
  overlayEnabled: boolean;
  overlayHotkey: string;
  overlayCorner: NoticeCorner | "auto";
  overlayStyle: NoticeStyle | "auto";
  overlaySound: boolean;
  overlayStartHint: boolean;
  screenshotHotkey: string;
  screenshotDir: string;
  achievementDirs: string[];
  firstRunDone: boolean;
  exploreEnabled: boolean;
  exploreHideAdult: boolean;
  downloadDir: string;
  installDir: string;
  maxDownloadKbps: number;
  maxUploadKbps: number;
  maxActiveDownloads: number;
  pauseWhilePlaying: boolean;
  seedPolicy: SeedPolicy;
  seedRatio: number;
  autoInstall: boolean;
  deleteRepackAfterInstall: boolean;
  preventSleep: boolean;
  listenPort: number;
  upnp: boolean;
  utp: boolean;
  extraTrackers: boolean;
  peerLimit: number;
  torrentProxy: string;
  updateAuto: boolean;
  updateSkipped: string;
}

export type SeedPolicy = "never" | "until-install" | "ratio";

export interface RunningGame {
  gameId: number;
  profileId: number;
  title: string;
  startedAt?: number | null;
}

export interface Bootstrap {
  profiles: Profile[];
  settings: Settings;
  themes: ThemeInfo[];
  activeProfile?: number | null;
  safeMode: boolean;
  version: string;
  dataDir: string;
  portable: boolean;
  running: RunningGame[];
  hasFolders: boolean;
  downloads: DownloadItem[];
}

export interface Candidate {
  provider: "steam" | "igdb" | "sgdb";
  id: number;
  name: string;
  image?: string | null;
  year?: string | null;
}

export interface ArtItem {
  kind: string;
  url: string;
  source: string;
  title?: string | null;
  position: number;
  extra?: { thumb?: string; poster?: string } | null;
}

export interface Stats {
  totalSeconds: number;
  trackedSeconds: number;
  gamesPlayed: number;
  sessions: number;
  avgSession: number;
  longestSession: number;
  currentStreak: number;
  bestStreak: number;
  topGames: { gameId: number; title: string; seconds: number; sessions: number; lastPlayed?: number | null }[];
  byDay: { day: string; seconds: number }[];
  byWeekday: number[];
  byHour: number[];
  byGenre: [string, number][];
  librarySize: number;
  neverPlayed: number;
}

export type NavAction =
  | "up" | "down" | "left" | "right" | "accept" | "back" | "x" | "y"
  | "lb" | "rb" | "lt" | "rt" | "menu" | "view" | "home";

// ───────────────────────────── Explorar y descargas ─────────────────────────────

export type RepackState =
  | "none"
  | "library"
  | "queued"
  | "downloading"
  | "paused"
  | "seeding"
  | "completed"
  | "installing"
  | "installed"
  | "error";

export interface RepackStatus {
  state: RepackState;
  downloadId?: number | null;
  gameId?: number | null;
  progress?: number | null;
}

export interface Repack {
  source: string;
  id: number;
  slug: string;
  title: string;
  version?: string | null;
  fullTitle: string;
  url: string;
  date: string;
  number?: number | null;
  cover?: string | null;
  coverFull?: string | null;
  hero?: string | null;
  genres: string[];
  companies?: string | null;
  languages?: string | null;
  originalSize?: string | null;
  repackSize?: string | null;
  repackBytes?: number | null;
  selective: boolean;
  adult: boolean;
  /** Crack de hipervisor (HV): para jugar hay que desactivar un rato la seguridad de Windows. */
  hypervisor?: boolean;
  /** Etiquetas de la web (ids de `Genre`). */
  tags?: number[];
  status: RepackStatus;
}

/** Un juego de la lista de deseados (solo en este PC, por perfil). */
export interface WishItem extends Repack {
  /** Cuándo se añadió (segundos). */
  addedAt: number;
}

export interface RepackDetails extends Repack {
  screenshots: { thumb: string; full: string }[];
  features: string[];
  installSize?: string | null;
  description?: string | null;
  magnet?: string | null;
}

export interface ExploreHome {
  sections: { id: string; title: string; items: Repack[] }[];
}

export interface ExplorePage {
  query: string;
  items: Repack[];
  page: number;
  pages: number;
  total: number;
  /** Con filtros de tamaño o «los que ya tengo», el total es aproximado. */
  filtered?: boolean;
}

export interface Genre {
  id: number;
  name: string;
  group: "genre" | "view" | "setting";
}

export interface BrowseFilters {
  query?: string;
  genres?: number[];
  sort?: "date" | "modified" | "title";
  maxGb?: number | null;
  hideOwned?: boolean;
}

export interface TorrentFile {
  index: number;
  path: string;
  size: number;
  kind: "setup" | "core" | "selective" | "optional" | "extra";
  label: string;
  required: boolean;
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
  dir: string;
  freeBytes?: number | null;
  installSize?: string | null;
  installDir: string;
  installFreeBytes?: number | null;
  /** Crack de hipervisor: avisar antes de bajarlo. */
  hypervisor?: boolean;
}

export type DownloadState = "queued" | "downloading" | "paused" | "seeding" | "completed" | "installing" | "installed" | "error";

export interface DownloadItem {
  id: number;
  source: string;
  sourceId: string;
  slug?: string | null;
  title: string;
  version?: string | null;
  cover?: string | null;
  hero?: string | null;
  /** Cápsula de la tienda de Steam (460×215), si el juego está allí. */
  capsule?: string | null;
  pageUrl?: string | null;
  state: DownloadState;
  /** user | queue | playing | install | needs-folder */
  pauseReason?: string | null;
  error?: string | null;
  totalBytes: number;
  doneBytes: number;
  uploadedBytes: number;
  progress: number;
  downBps: number;
  upBps: number;
  peers: number;
  eta?: number | null;
  checking: boolean;
  queuePos: number;
  installSize?: string | null;
  outputDir: string;
  name: string;
  fileCount: number;
  selectedCount: number;
  installDir?: string | null;
  gameId?: number | null;
  addedAt: number;
  completedAt?: number | null;
  installedAt?: number | null;
  filesDeleted: boolean;
}

export interface DownloadDefaults {
  downloadDir: string;
  installDir: string;
  configured: boolean;
}

// ───────────────────────────── guías de Steam ─────────────────────────────

export interface GuideSpan {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  spoiler?: boolean;
  /** Enlace a una web (https). */
  href?: string;
  /** Enlace a otra guía: se abre en el lector. */
  guide?: string;
}

export type GuideBlock =
  | { t: "h"; level: 1 | 2 | 3; spans: GuideSpan[] }
  | { t: "p"; spans: GuideSpan[] }
  | { t: "list"; ordered: boolean; items: { depth: number; spans: GuideSpan[] }[] }
  | { t: "quote"; spans: GuideSpan[] }
  | { t: "code"; text: string }
  | { t: "img"; src: string; thumb?: boolean }
  | { t: "table"; head: boolean; rows: GuideSpan[][][] }
  | { t: "video"; id: string; url: string; thumb: string }
  | { t: "hr" };

export interface GuideItem {
  id: string;
  title: string;
  desc: string;
  author: string;
  stars?: number | null;
  preview?: string | null;
  /** Idioma aproximado: es, en, pt, ru, zh… ("" si no se sabe). */
  lang: string;
}

export interface GuideList {
  appid?: number | null;
  items: GuideItem[];
  page: number;
  pages: number;
  total: number;
  next?: number | null;
  filtered: boolean;
}

export interface GuideQuery {
  page?: number;
  sort?: "toprated" | "trend" | "mostrecent";
  query?: string;
  category?: string;
  allLanguages?: boolean;
}

export interface GuideProgress {
  section: number;
  scroll: number;
  readAt: number;
}

export interface Guide {
  id: string;
  appid?: number | null;
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

export interface GuideShelf {
  pinned: GuideShelfItem[];
  recent: GuideShelfItem[];
}

// ───────────────────────────── trucos (FLiNG) ─────────────────────────────

export interface TrainerOption {
  /** "Ctrl+Num 1": identifica la opción. */
  keys: string;
  label: string;
  group?: string | null;
  /** toggle | action (una vez) | value (necesita un valor en el trainer) */
  kind: "toggle" | "action" | "value";
}

export interface TrainerCandidate {
  title: string;
  url: string;
  updated: string;
  score: number;
}

export interface TrainerFound {
  query: string;
  candidates: TrainerCandidate[];
}

export interface TrainerDownload {
  name: string;
  url: string;
  date: string;
  size: string;
}

export interface TrainerPage {
  title: string;
  url: string;
  gameVersion?: string | null;
  updated?: string | null;
  options: TrainerOption[];
  notes: string[];
  anticheat?: string | null;
  downloads: TrainerDownload[];
}

export interface TrainerInstalled {
  gameId: number;
  name: string;
  title: string;
  pageUrl: string;
  gameVersion?: string | null;
  updated?: string | null;
  options: TrainerOption[];
  notes: string[];
  anticheat?: string | null;
  autoStart: boolean;
  installedAt: number;
  size: number;
  /** El .exe sigue en su sitio. */
  present: boolean;
}

export interface TrainerLive {
  gameId?: number | null;
  state: "none" | "idle" | "waiting" | "starting" | "running" | "stopped" | "error";
  message?: string | null;
  on: string[];
  visible: boolean;
  elevated: boolean;
}

// ───────────────────────────── perfil (página al estilo Steam) ─────────────────────────────

export interface ProfileShowcase {
  type: "featured" | "favorite" | "stats" | "recent" | "achievements" | "badges" | "screenshots" | "text";
  game?: string;
  title?: string;
  text?: string;
  /** Capturas: URL ejg-media. */
  items?: string[];
}

/** Lo que se edita del perfil (el nombre y el avatar son los del perfil local). */
export interface ProfileFields {
  name: string;
  avatarUrl?: string | null;
  realName: string;
  country: string;
  bio: string;
  backgroundImageUrl?: string | null;
  frame: string;
  background: string;
  color: string;
  showcases: ProfileShowcase[];
  featuredBadge: string;
}

export interface ProfileBadge {
  id: string;
  tier: number;
}

export interface ProfileGame {
  id: number;
  title: string;
  minutes: number;
  last?: number | null;
  ach?: [number, number] | null;
  coverUrl?: string;
  headerUrl?: string;
}

/** La página de perfil entera (`profile_page`). */
export interface ProfilePage {
  id: number;
  name: string;
  memberSince: number;
  level: number;
  xp: number;
  badges: ProfileBadge[];
  profile: ProfileFields;
  summary: {
    games: ProfileGame[];
    stats: { minutes: number; achievements: number; perfect: number; library: number; played: number; recent: number; shots: number };
  };
  activity: { id: number; kind: "played" | "achievement" | "completed"; at: number; data: Record<string, unknown> }[];
  presence: { status: "online"; game: string; since?: number | null } | null;
}

/** Lo corto del perfil, lo que reciben los temas (`ejg.profiles.me`). */
export interface ProfileCard {
  id: number;
  name: string;
  avatarUrl?: string | null;
  frame: string;
  background: string;
  backgroundImageUrl?: string | null;
  color: string;
  level: number;
  xp: number;
  badges: ProfileBadge[];
  featuredBadge: string;
}

// ───────────────────────────── mapas (Map Genie) ─────────────────────────────

export interface MapRef {
  slug: string;
  name: string;
}

export interface MapGame {
  slug: string;
  name: string;
  maps: MapRef[];
}

export interface GameMaps {
  game?: MapGame | null;
  manual: boolean;
  none: boolean;
  lastMap?: string | null;
}

// ───────────────────────────── actualizaciones ─────────────────────────────

/** Qué hará «Desinstalar» (lo decide el núcleo). */
export interface UninstallPlan {
  gameId: number;
  title: string;
  method: "uninstaller" | "folder";
  dir: string | null;
  program: string | null;
  sizeBytes: number | null;
}

export interface UpdateCheck {
  current: string;
  latest: string;
  available: boolean;
  skipped: boolean;
  notes: string;
  url: string;
  assetUrl?: string | null;
  assetName?: string | null;
  assetSize?: number | null;
  publishedAt?: string | null;
}
