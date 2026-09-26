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
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
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
  discordClientId: string;
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
  overlayCorner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  overlaySound: boolean;
  overlayStartHint: boolean;
  overlaySteamNotify: boolean;
  achievementDirs: string[];
  firstRunDone: boolean;
}

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
