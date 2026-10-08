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
  /** Sistema de consola ("snes", "ps2"…); sin valor en los juegos de PC. */
  platform?: string | null;
  /** Juegos de consola: lo leído de la ROM, con su DLC y actualizaciones. */
  rom?: RomInfo | null;
  /** Juegos de consola: emulador con que se abre ("" si no hay ninguno). */
  emulator?: string | null;
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
  gameModePower: boolean;
  gameModeDnd: boolean;
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
  gameModePower?: boolean;
  gameModeDnd?: boolean;
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
  /** "subfolders" | "single" | "roms:<sistema>" (carpeta de juegos de consola). */
  suggestedMode: string;
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
  features?: { explore?: boolean; guides?: boolean } | null;
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

export interface EmulatorCfg {
  platform: string;
  /** retroarch | preset | custom */
  kind: string;
  preset: string;
  exe: string;
  core: string;
  args: string;
}
export interface SoftwareItem {
  id: string;
  name: string;
  blurb: string;
  systems: string[];
  /** Ids de esos sistemas, en el mismo orden. */
  platforms: string[];
  site: string;
  /** Se instala desde ejGames (si no, se abre su web). */
  auto: boolean;
  installed?: { version: string; dir: string; exe: string } | null;
  latest?: string | null;
  size?: number | null;
  update: boolean;
  error?: string | null;
}
export interface EmulatorFound {
  preset: string;
  name: string;
  exe: string;
  cores: string[];
}
export interface EmulationCatalog {
  platforms: { id: string; name: string; exts: string[]; core: string; presets: string[] }[];
  presets: { id: string; name: string; args: string }[];
}

export interface YearReview {
  year: number;
  totalSeconds: number;
  sessions: number;
  gamesPlayed: number;
  daysPlayed: number;
  bestStreak: number;
  topGames: { gameId: number; title: string; seconds: number; sessions: number }[];
  byMonth: number[];
  topMonth: number | null;
  favoriteHour: number | null;
  favoriteWeekday: number | null;
  longestSession: number;
  longestSessionGame: string | null;
  genres: [string, number][];
  achievements: number;
  rarest: { name: string; game: string; gameId: number; pct: number; at: number } | null;
  newGames: number;
  firstGame: string | null;
}

export interface CommunityTheme {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  preview?: string | null;
  download: string;
  sha256: string;
  /** Versión instalada en este PC. */
  installed?: string | null;
}

export interface Hltb {
  id: number;
  name: string;
  main: number;
  extra: number;
  complete: number;
  url: string;
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
  /** "" (el de Windows) | "es" | "en" | "de" | "fr" | "zh" | "ja" | "pt". */
  uiLanguage: string;
  overlayFps: boolean;
  hltbEnabled: boolean;
  yearReviewSeen: number;
  emulators: EmulatorCfg[];
  savesAuto: boolean;
  savesKeep: number;
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

// ───────────────────────────── perfil ─────────────────────────────

/** Lo corto del perfil, lo que reciben los temas (`ejg.profiles.me`): nombre y avatar del perfil local. */
export interface ProfileCard {
  id: number;
  name: string;
  avatarUrl?: string | null;
  color: string;
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
  /** console: un juego de consola, cuyos archivos van a la papelera. */
  method: "uninstaller" | "folder" | "console";
  dir: string | null;
  program: string | null;
  sizeBytes: number | null;
}

export interface ReleaseEntry {
  version: string;
  publishedAt?: string | null;
  url: string;
  assetUrl?: string | null;
  assetName?: string | null;
  assetSize?: number | null;
  assetSha256?: string | null;
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

// ───────────────────────────── ROMs y homebrew ─────────────────────────────

/** Lo que se lee de la propia ROM (cuando el formato lo trae en claro). */
export interface RomInfo {
  titleId?: string;
  version?: string;
  region?: string;
  serial?: string;
  title?: string;
  /** base | update | dlc */
  kind?: string;
  baseTitleId?: string;
  /** Actualizaciones y DLC importados de este juego. */
  extras?: { titleId: string; kind: "update" | "dlc"; version?: string | null; path: string }[];
}

/** Una ROM encontrada al escanear un archivo o una carpeta para importarla. */
export interface RomEntry {
  path: string;
  /** Dentro de un .zip/.7z: su ruta en él. */
  inner?: string;
  name: string;
  size: number;
  /** Sistema detectado; null si la extensión vale para varios y la cabecera no lo aclara. */
  platform: string | null;
  options: string[];
  info: RomInfo;
  /** Ya está en la biblioteca. */
  known: boolean;
}

export interface RomImportReport {
  added: number;
  extras: number;
  skipped: number;
  errors: string[];
  gameIds: number[];
}

/** Emulador con que se abre un sistema ahora mismo. */
export interface SystemEmulator {
  platform: string;
  name: string;
  exe: string;
  kind: string;
  /** settings (Ajustes) | software (instalado desde ejGames) | detected (en el disco) | none */
  origin: "settings" | "software" | "detected" | "none";
}

// ───────────────────────────── catálogos ─────────────────────────────

/** Plataformas de los catálogos (ampliable: el núcleo reconoce las de `catalogs/platforms.rs`). */
export type Platform =
  | "switch" | "wii" | "wii-u" | "gamecube" | "n64" | "snes" | "nes" | "gba" | "gb" | "gbc" | "ds" | "3ds"
  | "ps1" | "ps2" | "ps3" | "ps4" | "ps5" | "psp" | "ps-vita"
  | "xbox" | "xbox-360" | "xbox-one"
  | "genesis" | "saturn" | "dreamcast" | "master-system" | "game-gear"
  | "neo-geo" | "arcade" | "mame"
  | "pc-engine" | "turbografx" | "wonderswan"
  | "pc" | "dos" | "windows";

export type CatalogCategory = "game" | "dlc" | "update" | "homebrew" | "emulator";

/** Direcciones de una fuente: `{query}`, `{page}`, `{platform}`, `{platformPath}`, `{id}`. */
export interface CatalogEndpoints {
  search?: string;
  popular?: string;
  newest?: string;
  byPlatform?: string;
  detail?: string;
}

/** Una fuente de `config/catalog-sources.json` (la edita el usuario). */
export interface CatalogSource {
  id: string;
  name: string;
  baseUrl: string;
  type: "api" | "scrape";
  enabled?: boolean;
  platforms: Platform[];
  apiEndpoints?: CatalogEndpoints;
  apiFields?: Record<string, string>;
  selectors?: {
    gameList: string;
    title: string;
    description?: string;
    coverImage?: string;
    downloadLink?: string;
    platform?: string;
    region?: string;
    language?: string;
    size?: string;
    version?: string;
    nextPage?: string;
    detailLink?: string;
    category?: string;
    breadcrumbs?: string;
    screenshots?: string;
  };
  platformMapping?: Record<string, Platform>;
  platformPaths?: Partial<Record<Platform, string>>;
  headers?: Record<string, string>;
  rateLimitPerMinute: number;
  cacheMinutes?: number;
  extractPasswords?: string[];
  imageHosts?: string[];
  relay?: "auto" | "always" | "never";
  /** Categorías que no se muestran («emulator»). */
  hideCategories?: CatalogCategory[];
  /** Botón de descarga que pide antes la dirección del archivo (POST con `{id}`). */
  signedDownload?: { url: string; field: string };
  icon?: string | null;
}

export interface CatalogDownloadSettings {
  defaultRomPath: string;
  extractPasswords: string[];
  autoExtract: boolean;
  organizeByPlatform: boolean;
}

export interface CatalogEntry {
  id: string;
  sourceId: string;
  title: string;
  /** null si la web no lo dice y no se pudo deducir. */
  platform: Platform | null;
  /** Servida por ejGames ("" si no hay). */
  coverUrl: string;
  coverOriginal?: string | null;
  description?: string | null;
  region?: string | null;
  language?: string | null;
  size?: string | null;
  sizeBytes?: number | null;
  version?: string | null;
  category: CatalogCategory;
  originalUrl: string;
  /** Ya bajado desde este catálogo: su juego en la biblioteca. */
  installedGameId?: number | null;
  /** Emulador con que se jugaría ("" ninguno; null si no es de consola). */
  emulator?: string | null;
}

export interface DownloadLink {
  url: string;
  label: string;
  /** direct (un archivo) | page (web de descargas: navegador) | magnet | torrent */
  kind: "direct" | "page" | "magnet" | "torrent";
  host: string;
  size?: string | null;
}

export interface CatalogDetail extends CatalogEntry {
  links: DownloadLink[];
  screenshots: string[];
}

export interface CatalogPage {
  sourceId: string;
  entries: CatalogEntry[];
  page: number;
  hasMore: boolean;
  error?: string | null;
}

export interface CatalogPlatformInfo {
  id: Platform;
  name: string;
  /** Id de ejGames («psx»); null si no se emula. */
  system: string | null;
  emulator: string;
}

export interface CatalogSourceInfo {
  id: string;
  name: string;
  kind: "api" | "scrape";
  baseUrl: string;
  icon?: string | null;
  enabled: boolean;
  platforms: CatalogPlatformInfo[];
  /** Lo que falta en el JSON para poder usarla. */
  problems: string[];
  hasSearch: boolean;
  /** Viene con ejGames (si no, es del archivo del usuario). */
  builtin: boolean;
}

export interface CatalogState {
  sources: CatalogSourceInfo[];
  error?: string | null;
  emulatorsError?: string | null;
  path: string;
  emulatorsPath: string;
  exists: boolean;
  downloadSettings: CatalogDownloadSettings;
  allPlatforms: CatalogPlatformInfo[];
}

/** Lo que se manda al núcleo para bajar e instalar una entrada. */
export interface CatalogInstallRequest {
  sourceId: string;
  gameId: string;
  title: string;
  platform?: Platform | null;
  category: CatalogCategory;
  cover?: string | null;
  description?: string | null;
  region?: string | null;
  version?: string | null;
  baseGameId?: string | null;
  url: string;
}

export interface CatalogInstallOutcome {
  gameIds: number[];
  extras: number;
  dir: string;
  notEmulated: boolean;
}

/** Una descarga de catálogo por HTTP (la cola vive en `host/downloads.ts`). */
export interface CatalogJob {
  /** `<fuente>|<id>` */
  id: string;
  name: string;
  phase: "queued" | "download" | "extract" | "organize" | "done" | "error";
  received: number;
  total: number;
  message?: string | null;
  gameId?: number | null;
}

/** Emulador de `config/emulators.json` (lo edita el usuario). */
export interface EmulatorConfig {
  id: string;
  name: string;
  platforms: Platform[];
  executableName: string;
  /** Carpeta o .exe; sin él se busca solo. */
  installPath?: string | null;
  romExtensions: string[];
  /** `%APPDATA%\ejGames\roms\{platform}\` */
  romFolder?: string | null;
  /** Argumentos con `{romPath}`, `{romDir}`, `{romName}`, `{core}` y `{fullscreen}`. */
  launchArgs: string[];
  fullscreenArgs?: string[];
  /** RetroArch: núcleo para `{core}`. */
  core?: string | null;
  coverExtensions?: string[];
}

/** Un emulador posible para un sistema (para elegir el preferido). */
export interface EmulatorOption {
  key: string;
  name: string;
  origin: "settings" | "json" | "software" | "detected";
  exe: string;
  cfg: EmulatorCfg;
  active: boolean;
}
