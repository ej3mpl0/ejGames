import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AchList,
  ArtItem,
  BackupInfo,
  Hltb,
  CommunityTheme,
  YearReview,
  EmulationCatalog,
  EmulatorFound,
  SavesInfo,
  SaveSnapshot,
  Bootstrap,
  BrowseFilters,
  Candidate,
  Collection,
  DownloadDefaults,
  DownloadItem,
  ExploreHome,
  ExplorePage,
  NoticeLook,
  OverlayInit,
  FolderInspection,
  GameDetails,
  GameMaps,
  Guide,
  GuideList,
  GuideQuery,
  GuideShelf,
  Genre,
  GameFull,
  GamePatch,
  LibGame,
  LibraryFolder,
  PreparedDownload,
  Profile,
  ProfilePatch,
  RepackDetails,
  RunningGame,
  Settings,
  Stats,
  ThemeInfo,
  UninstallPlan,
  UpdateCheck,
  MapGame,
  TrainerFound,
  TrainerInstalled,
  TrainerLive,
  TrainerPage,
  ProfileFields,
  ProfilePage,
  WishItem,
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
  uninstallPlan: (id: number) => invoke<UninstallPlan>("uninstall_plan", { id }),
  uninstallGame: (id: number) => invoke<"started" | "removed">("uninstall_game", { id }),
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
  overlayAction: (action: "launcher" | "screenshot" | "quit-game" | "downloads-resume" | "downloads-pause" | "open-captures") =>
    invoke<void>("overlay_action", { action }),
  overlayMedia: (cmd: "toggle" | "next" | "prev") => invoke<void>("overlay_media", { cmd }),
  overlayVolume: (which: "game" | "master", level?: number | null, muted?: boolean | null) =>
    invoke<void>("overlay_volume", { which, level: level ?? null, muted: muted ?? null }),
  overlayNote: (text: string) => invoke<void>("overlay_note", { text }),
  overlayTest: () => invoke<void>("overlay_test"),
  overlayChime: (rare: boolean) => invoke<void>("overlay_chime", { rare }),
  overlayLook: () => invoke<NoticeLook>("overlay_look"),

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
  themeStrings: (id: string) => invoke<Record<string, string>>("theme_strings", { id }),
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

  exploreHome: () => invoke<ExploreHome>("explore_home"),
  exploreSearch: (query: string, page?: number) => invoke<ExplorePage>("explore_search", { query, page }),
  exploreBrowse: (filters: BrowseFilters, page?: number) => invoke<ExplorePage>("explore_browse", { filters, page }),
  exploreGenres: () => invoke<Genre[]>("explore_genres"),
  exploreDetails: (slug: string) => invoke<RepackDetails>("explore_details", { slug }),
  wishlist: () => invoke<WishItem[]>("wishlist"),
  wishlistAdd: (slug: string) => invoke<WishItem[]>("wishlist_add", { slug }),
  wishlistRemove: (slug: string) => invoke<WishItem[]>("wishlist_remove", { slug }),
  guidesList: (gameId: number, query?: GuideQuery) => invoke<GuideList>("guides_list", { gameId, query: query ?? null }),
  guidesGet: (id: string) => invoke<Guide>("guides_get", { id }),
  guidesShelf: (gameId: number) => invoke<GuideShelf>("guides_shelf", { gameId }),
  guidesPin: (gameId: number, id: string, title: string, author: string, preview: string | null, value: boolean) =>
    invoke<void>("guides_pin", { gameId, id, title, author, preview, value }),
  guidesProgress: (gameId: number, id: string, title: string, author: string, preview: string | null, section: number, scroll: number) =>
    invoke<void>("guides_progress", { gameId, id, title, author, preview, section, scroll }),
  // Trucos (trainers de FLiNG)
  trainerInfo: (gameId: number) => invoke<TrainerInstalled | null>("trainer_info", { gameId }),
  trainerFind: (gameId: number, query?: string) => invoke<TrainerFound>("trainer_find", { gameId, query: query ?? null }),
  trainerDetails: (url: string) => invoke<TrainerPage>("trainer_details", { url }),
  trainerInstall: (gameId: number, pageUrl: string, downloadUrl: string) =>
    invoke<TrainerInstalled>("trainer_install", { gameId, pageUrl, downloadUrl }),
  trainerRemove: (gameId: number) => invoke<void>("trainer_remove", { gameId }),
  trainerAuto: (gameId: number, on: boolean) => invoke<void>("trainer_auto", { gameId, on }),
  trainerStatus: () => invoke<TrainerLive>("trainer_status"),
  trainerStart: (gameId: number) => invoke<TrainerLive>("trainer_start", { gameId }),
  trainerTrigger: (keys: string) => invoke<TrainerLive>("trainer_trigger", { keys }),
  trainerShow: (visible: boolean) => invoke<TrainerLive>("trainer_show", { visible }),
  trainerReset: () => invoke<TrainerLive>("trainer_reset"),
  // Mapas (Map Genie)
  mapsFor: (gameId: number) => invoke<GameMaps>("maps_for", { gameId }),
  mapsSearch: (query: string) => invoke<MapGame[]>("maps_search", { query }),
  mapsChoose: (gameId: number, slug: string | null) => invoke<GameMaps>("maps_choose", { gameId, slug }),
  mapsLast: (gameId: number, map: string) => invoke<void>("maps_last", { gameId, map }),
  overlayPin: (url: string | null) => invoke<void>("overlay_pin", { url }),
  // Perfil (página al estilo Steam)
  /** La página de perfil del perfil activo. */
  profilePage: () => invoke<ProfilePage>("profile_page"),
  /** Guarda los campos que lleguen; devuelve el perfil local y la página al día. */
  profilePageUpdate: (patch: Partial<ProfileFields>) => invoke<{ profile: Profile; page: ProfilePage }>("profile_page_update", { patch }),
  /** Guarda una imagen del disco para el perfil y devuelve su URL. */
  profileImage: (kind: "avatar" | "background" | "shot", path: string) => invoke<string>("profile_image", { kind, path }),
  downloadsList: () => invoke<DownloadItem[]>("downloads_list"),
  downloadsDefaults: () => invoke<DownloadDefaults>("downloads_defaults"),
  downloadsPrepare: (slug: string) => invoke<PreparedDownload>("downloads_prepare", { slug }),
  downloadsCancelPrepare: (key: string) => invoke<void>("downloads_cancel_prepare", { key }),
  downloadsStart: (token: string, files: number[], dir?: string | null) =>
    invoke<DownloadItem>("downloads_start", { token, files, dir }),
  downloadsPause: (id?: number | null) => invoke<void>("downloads_pause", { id }),
  downloadsResume: (id?: number | null) => invoke<void>("downloads_resume", { id }),
  downloadsMove: (id: number, pos: number) => invoke<void>("downloads_move", { id, pos }),
  downloadsRemove: (id: number, deleteFiles: boolean) => invoke<void>("downloads_remove", { id, deleteFiles }),
  downloadsDeleteFiles: (id: number) => invoke<void>("downloads_delete_files", { id }),
  downloadsInstall: (id: number) => invoke<void>("downloads_install", { id }),
  downloadsFinishInstall: (id: number, dir: string) => invoke<void>("downloads_finish_install", { id, dir }),
  downloadsOpenFolder: (id: number) => invoke<void>("downloads_open_folder", { id }),
  diskSpace: (path: string) => invoke<{ freeBytes?: number | null }>("disk_space", { path }),

  overlayFpsGrant: () => invoke<void>("overlay_fps_grant"),
  emulationCatalog: () => invoke<EmulationCatalog>("emulation_catalog"),
  emulatorsDetect: () => invoke<EmulatorFound[]>("emulators_detect"),
  emulatorCores: (exe: string) => invoke<string[]>("emulator_cores", { exe }),
  getYearReview: (year?: number) => invoke<YearReview>("get_year_review", { year }),
  communityThemes: () => invoke<CommunityTheme[]>("community_themes"),
  communityThemeInstall: (id: string) => invoke<ThemeInfo>("community_theme_install", { id }),
  gameHltb: (id: number) => invoke<Hltb | null>("game_hltb", { id }),
  savesInfo: (id: number) => invoke<SavesInfo>("saves_info", { id }),
  savesBackup: (id: number) => invoke<SaveSnapshot | null>("saves_backup", { id }),
  savesRestore: (id: number, snapshot: number) => invoke<number>("saves_restore", { id, snapshot }),
  savesDelete: (id: number, snapshot: number) => invoke<void>("saves_delete", { id, snapshot }),
  savesAddPath: (id: number, path: string) => invoke<void>("saves_add_path", { id, path }),
  savesRemovePath: (id: number, path: string) => invoke<void>("saves_remove_path", { id, path }),
  savesOpen: (id: number, path: string) => invoke<void>("saves_open", { id, path }),
  gameShortcut: (id: number) => invoke<string>("game_shortcut", { id }),
  gameAddToSteam: (id: number) => invoke<string>("game_add_to_steam", { id }),
  repackUpdateDismiss: (gameId: number) => invoke<void>("repack_update_dismiss", { gameId }),
  repackUpdateCheck: () => invoke<number>("repack_update_check"),
  backupCreate: (dest: string, withMedia: boolean) => invoke<BackupInfo>("backup_create", { dest, withMedia }),
  backupInspect: (path: string) => invoke<BackupInfo>("backup_inspect", { path }),
  backupRestore: (path: string) => invoke<void>("backup_restore", { path }),
  backupList: () => invoke<BackupInfo[]>("backup_list"),
  backupNewer: () => invoke<BackupInfo | null>("backup_newer"),
  backupDismiss: (created: number) => invoke<void>("backup_dismiss", { created }),

  updateCheck: (force: boolean) => invoke<UpdateCheck>("update_check", { force }),
  updateDownload: () => invoke<{ path: string; size: number }>("update_download"),
  updateInstall: (path: string) => invoke<void>("update_install", { path }),
};

export type Events = {
  "library:changed": { ids?: number[]; full?: boolean };
  "meta:progress": { done: number; total: number };
  "scan:progress": { phase: string; done: number; total: number; current: string };
  "game:state": { gameId: number; state: "launching" | "running" | "stopped"; value?: number | null };
  "app:toast": { kind: string; message: string };
  "app:close-ask": null;
  "theme:changed": { id: string };
  "update:progress": { received: number; total: number };
  "downloads:changed": DownloadItem[];
  "downloads:progress": DownloadItem[];
  "downloads:finished": { id: number; title: string };
  "explore:art": null;
  "wishlist:changed": WishItem[];
  "saves:changed": { gameId: number };
  "downloads:install": { id: number; phase: "running" | "done" | "cancelled" | "error" | "needs-folder"; message?: string | null; gameId?: number | null };
};

export function on<K extends keyof Events>(name: K, fn: (payload: Events[K]) => void): Promise<UnlistenFn> {
  return listen<Events[K]>(name, (e) => fn(e.payload));
}

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
