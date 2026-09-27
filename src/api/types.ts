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

export interface LibGame {
  id: number;
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
  kind: "achievement" | "info" | "summary";
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
  achievements?: AchList | null;
  pad: boolean;
}

export interface OverlayInit {
  notices: OverlayNotice[];
  panel?: OverlayPanel | null;
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
  installUri?: string | null;
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
  features?: { explore?: boolean } | null;
  builtin: boolean;
  dir: string;
  previewUrl?: string | null;
  compatible: boolean;
}

export interface Settings {
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
  closeToTray: boolean;
  devMode: boolean;
  importSteam: boolean;
  importEpic: boolean;
  importGog: boolean;
  importUbisoft: boolean;
  importEa: boolean;
  importUninstalled: boolean;
  overlayEnabled: boolean;
  overlayHotkey: string;
  overlayCorner: NoticeCorner | "auto";
  overlayStyle: NoticeStyle | "auto";
  overlaySound: boolean;
  overlayStartHint: boolean;
  overlaySteamNotify: boolean;
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

export interface StoreSummary {
  source: "steam" | "epic" | "gog" | "ubisoft" | "ea";
  detected: boolean;
  installed: number;
  library: number;
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
  status: RepackStatus;
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

// ───────────────────────────── actualizaciones ─────────────────────────────

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
