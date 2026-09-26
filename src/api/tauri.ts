import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AchList,
  ArtItem,
  Bootstrap,
  Candidate,
  Collection,
  OverlayInit,
  FolderInspection,
  GameDetails,
  GameFull,
  GamePatch,
  LibGame,
  LibraryFolder,
  Profile,
  ProfilePatch,
  RunningGame,
  Settings,
  Stats,
  StoreSummary,
  ThemeInfo,
} from "./types";

export const api = {
  bootstrap: () => invoke<Bootstrap>("bootstrap"),
  appReady: () => invoke<void>("app_ready"),
  windowAction: (action: string, value?: boolean) => invoke<void>("window_action", { action, value }),
  windowState: () => invoke<{ maximized: boolean; fullscreen: boolean }>("window_state"),

  listProfiles: () => invoke<Profile[]>("list_profiles"),
  createProfile: (name: string, color: string, themeId: string) =>
    invoke<Profile>("create_profile", { name, color, themeId }),
  updateProfile: (id: number, patch: ProfilePatch) => invoke<Profile>("update_profile", { id, patch }),
  deleteProfile: (id: number) => invoke<void>("delete_profile", { id }),
  login: (id: number, pin?: string) => invoke<Profile>("login", { id, pin }),
  logout: () => invoke<void>("logout"),
  setAvatar: (id: number, path: string | null) => invoke<Profile>("set_avatar", { id, path }),
  importImage: (path: string, max?: number) => invoke<string>("import_image", { path, max }),
  setThemeSettings: (themeId: string, values: Record<string, unknown>) =>
    invoke<void>("set_theme_settings", { themeId, values }),
  setCustomCss: (themeId: string, css: string) => invoke<void>("set_custom_css", { themeId, css }),

  getLibrary: () => invoke<LibGame[]>("get_library"),
  getGames: (ids: number[]) => invoke<LibGame[]>("get_games", { ids }),
  getGameDetails: (id: number) => invoke<GameDetails>("get_game_details", { id }),
  getGameFull: (id: number) => invoke<GameFull>("get_game_full", { id }),
  updateGame: (id: number, patch: GamePatch) => invoke<void>("update_game", { id, patch }),
  deleteGame: (id: number) => invoke<void>("delete_game", { id }),
  purgeMissing: () => invoke<number>("purge_missing"),
  setFavorite: (id: number, value: boolean) => invoke<void>("set_favorite", { id, value }),
  setHidden: (id: number, value: boolean) => invoke<void>("set_hidden", { id, value }),
  setUserRating: (id: number, value: number | null) => invoke<void>("set_user_rating", { id, value }),
  addManualGame: (exe: string) => invoke<number>("add_manual_game", { exe }),

  inspectFolder: (path: string) => invoke<FolderInspection>("inspect_folder", { path }),
  listFolders: () => invoke<LibraryFolder[]>("list_folders"),
  addFolder: (path: string, mode: string) => invoke<number>("add_folder", { path, mode }),
  removeFolder: (id: number) => invoke<void>("remove_folder", { id }),
  rescan: (folderId?: number) => invoke<void>("rescan", { folderId }),
  importStores: (only?: string[]) => invoke<void>("import_stores", { only }),
  storeSummary: () => invoke<StoreSummary[]>("store_summary"),

  refreshMetadata: (ids?: number[], all?: boolean) => invoke<number>("refresh_metadata", { ids, all }),
  searchMetadata: (term: string) => invoke<Candidate[]>("search_metadata", { term }),
  applyMatch: (gameId: number, provider: string, id: number) => invoke<void>("apply_match", { gameId, provider, id }),
  artOptions: (gameId: number, kind: string) => invoke<ArtItem[]>("art_options", { gameId, kind }),
  setArtUrl: (gameId: number, kind: string, url: string) => invoke<void>("set_art_url", { gameId, kind, url }),
  setArtFile: (gameId: number, kind: string, path: string) => invoke<void>("set_art_file", { gameId, kind, path }),
  selectMedia: (gameId: number, mediaId: number) => invoke<void>("select_media", { gameId, mediaId }),
  metaProgress: () => invoke<[number, number]>("meta_progress"),

  play: (id: number) => invoke<void>("play", { id }),
  stopTracking: (id: number) => invoke<void>("stop_tracking", { id }),
  runningGames: () => invoke<RunningGame[]>("running_games"),
  openGameFolder: (id: number) => invoke<void>("open_game_folder", { id }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),

  getAchievements: (id: number) => invoke<AchList>("get_achievements", { id }),
  overlayReady: () => invoke<OverlayInit>("overlay_ready"),
  overlayIdle: () => invoke<void>("overlay_idle"),
  overlayPanel: (open: boolean, restore?: boolean) => invoke<void>("overlay_panel", { open, restore }),
  overlayAction: (action: "launcher") => invoke<void>("overlay_action", { action }),
  overlayTest: () => invoke<void>("overlay_test"),

  getStats: (days?: number) => invoke<Stats>("get_stats", { days }),
  recentSessions: (limit?: number) => invoke<unknown[]>("recent_sessions", { limit }),

  listCollections: () => invoke<Collection[]>("list_collections"),
  createCollection: (name: string, kind?: string, rules?: unknown) =>
    invoke<number>("create_collection", { name, kind, rules }),
  updateCollection: (id: number, name?: string, rules?: unknown) => invoke<void>("update_collection", { id, name, rules }),
  deleteCollection: (id: number) => invoke<void>("delete_collection", { id }),
  setInCollection: (collectionId: number, gameId: number, member: boolean) =>
    invoke<void>("set_in_collection", { collectionId, gameId, member }),

  listThemes: () => invoke<ThemeInfo[]>("list_themes"),
  duplicateTheme: (id: string) => invoke<ThemeInfo>("duplicate_theme", { id }),
  deleteTheme: (id: string) => invoke<void>("delete_theme", { id }),
  importTheme: (path: string) => invoke<ThemeInfo>("import_theme", { path }),
  exportTheme: (id: string, dest: string) => invoke<void>("export_theme", { id, dest }),
  openThemeFolder: (id?: string) => invoke<void>("open_theme_folder", { id }),
  themeStorageGet: (themeId: string) => invoke<Record<string, unknown>>("theme_storage_get", { themeId }),
  themeStorageSet: (themeId: string, key: string, value: unknown) =>
    invoke<void>("theme_storage_set", { themeId, key, value }),

  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (patch: Partial<Settings>) => invoke<Settings>("update_settings", { patch }),
  cacheInfo: () => invoke<{ mediaMb: number; trailersMb: number }>("cache_info"),
  clearTrailerCache: () => invoke<void>("clear_trailer_cache"),
  openDataDir: () => invoke<void>("open_data_dir"),
  quit: () => invoke<void>("quit"),
};

export type Events = {
  "library:changed": { ids?: number[]; full?: boolean };
  "meta:progress": { done: number; total: number };
  "scan:progress": { phase: string; done: number; total: number; current: string };
  "game:state": { gameId: number; state: "launching" | "running" | "stopped"; value?: number | null };
  "app:toast": { kind: string; message: string };
  "theme:changed": { id: string };
};

export function on<K extends keyof Events>(name: K, fn: (payload: Events[K]) => void): Promise<UnlistenFn> {
  return listen<Events[K]>(name, (e) => fn(e.payload));
}

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
