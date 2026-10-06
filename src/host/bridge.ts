// Llamadas de los temas → host. Solo lo que aparece aquí es accesible para un
// tema; cada parámetro se valida antes de tocar el núcleo.

import { api } from "../api/tauri";
import { useApp, activeTheme, type OverlayName } from "../store/app";
import { cancelCatalogJob, dismissCatalogJob, downloadFromCatalog, installDownload, locateInstall, openExplore, openKeyboard, pickFolder } from "./downloads";
import type { CatalogEntry } from "../api/types";
import { requestFor, usable } from "../lib/catalog/sources";
import { platformName, toSystem } from "../lib/catalog/platforms";
import { getGuide, openGuideInBrowser, openGuideLink, validGuideId } from "./guides";
import { playSound } from "./sounds";
import { toggleBigPicture } from "./window";

const num = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("id no válido");
  return n;
};

const UI_NAMES: Record<string, OverlayName> = {
  settings: "settings",
  game: "game",
  profiles: "profiles",
  search: "search",
  "add-folder": "add-folder",
  stats: "stats",
  "year-review": "year-review",
  software: "software",
  "rom-import": "rom-import",
  catalogs: "catalogs",
  theme: "theme",
  collections: "collections",
  menu: "menu",
  explore: "explore",
  downloads: "downloads",
  guides: "guides",
  trainer: "trainer",
  map: "map",
  // Editar tu perfil (nombre y avatar): Ajustes → Perfil.
  "profile-editor": "settings",
};

const GUIDE_SORTS = ["toprated", "trend", "mostrecent"];

/** Una entrada de catálogo para un tema: con el sistema de la biblioteca («ps1» → «psx»). */
const catEntry = (e: CatalogEntry) => ({
  id: e.id,
  sourceId: e.sourceId,
  title: e.title,
  platform: e.platform,
  system: toSystem(e.platform),
  coverUrl: e.coverUrl,
  description: e.description ?? null,
  region: e.region ?? null,
  language: e.language ?? null,
  size: e.size ?? null,
  version: e.version ?? null,
  category: e.category,
  installedGameId: e.installedGameId ?? null,
  emulator: e.emulator ?? null,
});
const CAT_MODES = ["popular", "newest", "platform", "search"] as const;

/** Juego de la biblioteca (un tema solo puede pedir guías de los suyos). */
const libGame = (v: unknown): number => {
  const id = num(v);
  if (!useApp.getState().games.some((g) => g.id === id)) throw new Error("juego desconocido");
  return id;
};

const str = (v: unknown, max = 300): string => {
  if (typeof v !== "string") throw new Error("texto no válido");
  return v.slice(0, max);
};

const slug = (v: unknown): string => {
  const s = str(v, 200);
  if (!/^[a-z0-9-]+$/.test(s)) throw new Error("ficha no válida");
  return s;
};

const optId = (v: unknown): number | null => (v == null ? null : num(v));

/** Carpetas que el usuario eligió en el diálogo: un tema solo puede mandar
 *  descargas a una de ellas (o a la de siempre), no a cualquier ruta. */
const picked = new Set<string>();
const normDir = (d: string) => d.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

let launching = new Set<number>();

export async function handleThemeCall(method: string, params: any): Promise<unknown> {
  const st = useApp.getState();
  const theme = activeTheme(st);
  switch (method) {
    case "game.details":
      return api.getGameDetails(num(params?.id));
    case "game.achievements":
      return api.getAchievements(num(params?.id));
    case "game.launch": {
      const id = num(params?.id);
      if (launching.has(id)) return;
      launching.add(id);
      try {
        playSound("launch");
        await api.play(id);
      } catch (e) {
        playSound("error");
        throw e;
      } finally {
        setTimeout(() => launching.delete(id), 3000);
      }
      return;
    }
    case "game.favorite": {
      const id = num(params?.id);
      const g = st.games.find((x) => x.id === id);
      const value = typeof params?.value === "boolean" ? params.value : !g?.favorite;
      return api.setFavorite(id, value);
    }
    case "stats.year":
      return api.getYearReview(params?.year == null ? undefined : num(params.year));
    case "game.hltb":
      return api.gameHltb(num(params?.id));
    case "saves.info":
      return api.savesInfo(num(params?.id));
    case "saves.backup":
      return api.savesBackup(num(params?.id));
    case "saves.restore":
      return api.savesRestore(num(params?.id), num(params?.snapshot));
    case "game.shortcut":
      return api.gameShortcut(num(params?.id));
    case "game.addToSteam":
      return api.gameAddToSteam(num(params?.id));
    case "game.repackDismiss":
      return api.repackUpdateDismiss(num(params?.id));
    case "game.repackCheck":
      return api.repackUpdateCheck();
    case "game.hide":
      return api.setHidden(num(params?.id), !!params?.value);
    case "game.rate":
      return api.setUserRating(num(params?.id), params?.value == null ? null : Math.max(0, Math.min(100, num(params.value))));
    case "game.folder":
      return api.openGameFolder(num(params?.id));
    case "game.uninstall": {
      // Solo abre el diálogo del host: desinstalar lo confirma siempre el usuario.
      const id = num(params?.id);
      if (!st.games.some((g) => g.id === id)) throw new Error("juego desconocido");
      playSound("open");
      st.open("uninstall", { id });
      return;
    }
    case "stats.get":
      return api.getStats(params?.days ? num(params.days) : undefined);
    case "stats.recent":
      return api.recentSessions(params?.limit ? num(params.limit) : undefined);
    case "storage.get":
      return theme ? api.themeStorageGet(theme.id) : {};
    case "storage.set": {
      if (!theme) return;
      const key = String(params?.key ?? "");
      if (!key) throw new Error("clave vacía");
      return api.themeStorageSet(theme.id, key, params?.value ?? null);
    }
    case "ui.open": {
      const name = UI_NAMES[String(params?.name)];
      if (!name) throw new Error("overlay desconocido");
      playSound("open");
      const args = params?.args && typeof params.args === "object" ? params.args : null;
      if (name === "add-folder") st.open("settings", { tab: "library", addFolder: true });
      else if (name === "guides") st.open("guides", { id: libGame(args?.id), guide: args?.guide == null ? null : validGuideId(args.guide) });
      else if (name === "trainer" || name === "map") st.open(name, { id: libGame(args?.id) });
      else if (params?.name === "profile-editor") st.open("settings", { tab: "profile" });
      else if (name === "theme") st.open("settings", { tab: "appearance" });
      else if (name === "explore" || name === "downloads") st.open(name, { view: name, ...(args ?? {}) });
      else st.open(name, args);
      return;
    }
    case "ui.keyboard": {
      const o = params && typeof params === "object" ? params : {};
      return openKeyboard({
        title: o.title == null ? undefined : str(o.title, 80),
        value: o.value == null ? "" : str(o.value, 200),
        placeholder: o.placeholder == null ? undefined : str(o.placeholder, 80),
        maxLength: o.maxLength == null ? 100 : Math.max(1, Math.min(200, num(o.maxLength))),
      });
    }
    case "explore.home":
      return api.exploreHome();
    case "explore.search":
      return api.exploreSearch(str(params?.query ?? "", 100), params?.page == null ? 1 : Math.max(1, Math.min(500, num(params.page))));
    case "explore.browse": {
      const f = params?.filters && typeof params.filters === "object" ? params.filters : {};
      const max = f.maxGb == null ? null : num(f.maxGb);
      return api.exploreBrowse(
        {
          query: str(f.query ?? "", 100),
          genres: Array.isArray(f.genres) ? f.genres.slice(0, 4).map(num).filter((n: number) => n > 0) : [],
          sort: ["date", "modified", "title"].includes(f.sort) ? f.sort : "date",
          maxGb: max && max > 0 ? Math.min(max, 1000) : null,
          hideOwned: !!f.hideOwned,
        },
        params?.page == null ? 1 : Math.max(1, Math.min(1000, num(params.page))),
      );
    }
    case "explore.wishlist":
      return st.wishlist;
    case "explore.wishlistAdd":
      return api.wishlistAdd(slug(params?.slug));
    case "explore.wishlistRemove":
      return api.wishlistRemove(slug(params?.slug));
    case "explore.genres":
      return api.exploreGenres();
    case "explore.details":
      return api.exploreDetails(slug(params?.slug));
    case "explore.openPage":
      // Solo la ficha de la web oficial (se construye aquí, no la manda el tema).
      return api.openExternal(`https://fitgirl-repacks.site/${slug(params?.slug)}/`);
    case "guides.list": {
      const q = params?.query && typeof params.query === "object" ? params.query : {};
      return api.guidesList(libGame(params?.gameId), {
        page: q.page == null ? 1 : Math.max(1, Math.min(1000, num(q.page))),
        sort: GUIDE_SORTS.includes(q.sort) ? q.sort : "toprated",
        query: str(q.query ?? "", 100),
        category: str(q.category ?? "", 40),
        allLanguages: !!q.allLanguages,
      });
    }
    case "guides.get":
      return getGuide(validGuideId(params?.id));
    case "guides.shelf":
      return api.guidesShelf(libGame(params?.gameId));
    case "guides.pin":
      return api.guidesPin(
        libGame(params?.gameId),
        validGuideId(params?.id),
        str(params?.title ?? "", 200),
        str(params?.author ?? "", 80),
        params?.preview == null ? null : str(params.preview, 120),
        params?.value !== false,
      );
    case "guides.progress":
      return api.guidesProgress(
        libGame(params?.gameId),
        validGuideId(params?.id),
        str(params?.title ?? "", 200),
        str(params?.author ?? "", 80),
        params?.preview == null ? null : str(params.preview, 120),
        Math.max(0, Math.min(10000, Math.floor(num(params?.section ?? 0)))),
        Math.max(0, Math.min(1, Number(params?.scroll) || 0)),
      );
    case "guides.openInBrowser":
      return openGuideInBrowser(validGuideId(params?.id));
    case "guides.openLink":
      return openGuideLink(str(params?.href, 2000));
    // Trucos: el tema solo ve el resumen; buscar e instalar pasa por la ventana del host.
    case "trainer.info": {
      const t = await api.trainerInfo(libGame(params?.gameId));
      return t && {
        name: t.name,
        title: t.title,
        options: t.options.length,
        gameVersion: t.gameVersion ?? null,
        autoStart: t.autoStart,
        present: t.present,
        anticheat: t.anticheat ?? null,
      };
    }
    case "catalogs.state": {
      const cs = st.catalogState ?? (await api.catalogsState());
      if (!st.catalogState) useApp.getState().set({ catalogState: cs });
      return {
        sources: cs.sources.filter(usable).map((x) => ({
          id: x.id,
          name: x.name,
          hasSearch: x.hasSearch,
          platforms: x.platforms.map((p) => ({ id: p.id, system: p.system, name: platformName(p.id) })),
        })),
      };
    }
    case "catalogs.browse": {
      const mode = CAT_MODES.find((m) => m === params?.mode) ?? "popular";
      const p = await api.catalogBrowse({
        sourceId: str(params?.source, 64),
        mode,
        query: mode === "search" ? str(params?.query ?? "", 100) : undefined,
        platform: params?.platform == null ? null : str(params.platform, 32),
        page: params?.page == null ? 1 : Math.max(1, Math.min(500, num(params.page))),
      });
      return { sourceId: p.sourceId, entries: p.entries.map(catEntry), page: p.page, hasMore: p.hasMore, error: p.error ?? null };
    }
    case "catalogs.search": {
      const platforms = Array.isArray(params?.platforms) ? params.platforms.slice(0, 40).map((x: unknown) => str(x, 32)) : [];
      const pages = await api.catalogSearchAll(str(params?.query ?? "", 100), platforms, params?.page == null ? 1 : Math.max(1, Math.min(500, num(params.page))));
      // Intercaladas, para que no tape una fuente a las demás.
      const entries: ReturnType<typeof catEntry>[] = [];
      for (let i = 0; pages.some((p) => i < p.entries.length); i++) for (const p of pages) if (p.entries[i]) entries.push(catEntry(p.entries[i]));
      return { entries, hasMore: pages.some((p) => p.hasMore), errors: pages.filter((p) => p.error).map((p) => ({ sourceId: p.sourceId, error: p.error })) };
    }
    case "catalogs.detail": {
      const d = await api.catalogDetail(str(params?.source, 64), str(params?.id, 400));
      return { ...catEntry(d), links: d.links.map((l) => ({ url: l.url, label: l.label, kind: l.kind, host: l.host, size: l.size ?? null })), screenshots: d.screenshots };
    }
    case "catalogs.download": {
      // Solo uno de los enlaces de la ficha: el tema no puede pedir bajar cualquier cosa.
      const source = str(params?.source, 64);
      const d = await api.catalogDetail(source, str(params?.id, 400));
      const l = d.links.find((x) => x.url === params?.url);
      if (!l) throw new Error("ese enlace no es de la ficha");
      if (l.kind === "page") {
        await api.openExternal(l.url);
        return "opened";
      }
      if (l.kind === "magnet" || l.kind === "torrent") {
        // Los torrents se eligen en la ventana de catálogos (con su diálogo de descarga).
        st.open("catalogs");
        return "catalogs";
      }
      downloadFromCatalog(requestFor(d, l.url, d));
      return "queued";
    }
    case "catalogs.cancel": {
      const key = str(params?.key, 500);
      const job = st.catalogJobs[key];
      if (!job) return;
      if (job.phase === "done" || job.phase === "error") dismissCatalogJob(key);
      else cancelCatalogJob(key);
      return;
    }
    case "emulators.list": {
      // Lo de la tienda de emuladores, sin rutas del disco; gameId: su entrada en la biblioteca.
      const lib = st.games.filter((g) => g.source === "emulator");
      return (await api.emulatorStore(false)).map((e) => ({
        id: e.id,
        name: e.name,
        blurb: e.blurb,
        systems: e.systems,
        platforms: e.platforms,
        installed: !!e.installed,
        version: e.installed?.version ?? null,
        latest: e.latest ?? null,
        update: e.update,
        gameId: lib.find((g) => g.title === e.name)?.id ?? null,
      }));
    }
    case "maps.info": {
      const m = await api.mapsFor(libGame(params?.gameId));
      return { game: m.game ? { name: m.game.name, maps: m.game.maps.map((x) => x.name) } : null, none: m.none };
    }
    case "downloads.list":
      return st.downloads;
    case "downloads.defaults":
      return api.downloadsDefaults();
    case "downloads.prepare":
      return api.downloadsPrepare(slug(params?.slug));
    case "downloads.cancelPrepare":
      return api.downloadsCancelPrepare(str(params?.key, 200));
    case "downloads.start": {
      const files = Array.isArray(params?.files) ? params.files.slice(0, 5000).map(num) : [];
      let dir = params?.dir == null || params.dir === "" ? null : str(params.dir, 1000);
      if (dir && !picked.has(normDir(dir))) {
        const d = await api.downloadsDefaults();
        if (normDir(d.downloadDir) !== normDir(dir)) throw new Error("Elige la carpeta con el botón «Cambiar»");
        dir = null;
      }
      return api.downloadsStart(str(params?.token, 64), files, dir);
    }
    case "downloads.pause":
      return api.downloadsPause(optId(params?.id));
    case "downloads.resume":
      return api.downloadsResume(optId(params?.id));
    case "downloads.move":
      return api.downloadsMove(num(params?.id), Math.max(0, num(params?.pos)));
    case "downloads.remove":
      return api.downloadsRemove(num(params?.id), !!params?.deleteFiles);
    case "downloads.deleteFiles":
      return api.downloadsDeleteFiles(num(params?.id));
    case "downloads.install":
      return installDownload(num(params?.id));
    case "downloads.locate":
      return locateInstall(num(params?.id));
    case "downloads.openFolder":
      return api.downloadsOpenFolder(num(params?.id));
    case "downloads.pickFolder": {
      const r = await pickFolder("Carpeta de descargas", params?.current == null ? null : str(params.current, 1000));
      if (r) picked.add(normDir(r.path));
      return r;
    }
    case "downloads.open":
      // Desde un tema sin vistas propias: las del host.
      openExplore(params?.view === "downloads" ? "downloads" : "explore", params?.slug ? { slug: slug(params.slug) } : undefined);
      return;
    case "ui.toast":
      st.toast(["ok", "error", "info"].includes(params?.kind) ? params.kind : "info", String(params?.message ?? "").slice(0, 300));
      return;
    case "window": {
      const a = String(params);
      if (a === "fullscreen-on" || a === "fullscreen-off") return api.windowAction("fullscreen", a === "fullscreen-on");
      if (a === "tv") return toggleBigPicture();
      if (["minimize", "toggle-maximize", "close", "fullscreen", "drag"].includes(a)) return api.windowAction(a);
      throw new Error("acción de ventana no válida");
    }
    case "app.info":
      return { version: st.boot?.version, running: st.running, meta: [st.meta.done, st.meta.total] };
    default:
      throw new Error(`método desconocido: ${method}`);
  }
}
