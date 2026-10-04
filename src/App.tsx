import { useEffect, useState } from "react";
import { api, on, errMsg } from "./api/tauri";
import type { Profile } from "./api/types";
import { ActivityPill, Toasts, WindowControls } from "./components/Chrome";
import { ThemeFrame } from "./host/ThemeFrame";
import { playSound } from "./host/sounds";
import { globalKey, reloadTheme, setBigPicture } from "./host/window";
import { installDownload, locateInstall, mergeProgress, setDownloads } from "./host/downloads";
import { refreshPage, setPage } from "./host/profile";
import { padTypeOf, startGamepad } from "./input/gamepad";
import { dispatchNav } from "./input/nav";
import { playtime } from "./lib/format";
import { CollectionsOverlay } from "./overlays/Collections";
import { DownloadsOverlay } from "./overlays/explore/Downloads";
import { ExploreOverlay } from "./overlays/explore/Explore";
import { KeyboardOverlay } from "./overlays/Keyboard";
import { UpdateAvailable } from "./overlays/UpdateAvailable";
import { UninstallDialog } from "./overlays/Uninstall";
import { checkOnLaunch } from "./host/update";
import { GameEditor } from "./overlays/GameEditor";
import { GuidesOverlay } from "./overlays/Guides";
import { ProfileEditorOverlay } from "./overlays/ProfileEditor";
import { ProfileOverlay } from "./overlays/Profile";
import { MapOverlay } from "./overlays/Map";
import { TrainerOverlay } from "./overlays/Trainer";
import { Onboarding } from "./overlays/Onboarding";
import { ProfilePicker } from "./overlays/ProfilePicker";
import { QuickMenu } from "./overlays/QuickMenu";
import { SearchOverlay } from "./overlays/Search";
import { SettingsOverlay } from "./overlays/settings/Settings";
import { StatsOverlay } from "./overlays/Stats";
import { YearReviewOverlay } from "./overlays/YearReview";
import { SoftwareStore } from "./overlays/SoftwareStore";
import { HomebrewStore } from "./overlays/HomebrewStore";
import { RomImport } from "./overlays/RomImport";
import { activeTheme, useApp } from "./store/app";
import { useHostSeason } from "./host/season";
import { restoreBackup } from "./overlays/settings/BackupSection";
import { t } from "./lib/i18n";

/** Aplica al host los colores del tema activo (theme.json → "host"). */
function useHostStyle() {
  const theme = useApp(activeTheme);
  const profile = useApp((s) => s.profile);
  // Evento de temporada: su acento manda sobre el del tema (ver index.css).
  const season = useHostSeason();
  useEffect(() => {
    const h = theme?.host ?? {};
    const root = document.documentElement.style;
    root.setProperty("--h-accent", season?.palette.accent || h.accent || profile?.color || "#4f8cff");
    // Con evento, sus superficies (index.css → :root[data-season]) en vez de las del tema.
    if (h.surface && !season) root.setProperty("--h-surface", h.surface);
    else root.removeProperty("--h-surface");
    if (h.text && !season) root.setProperty("--h-text", h.text);
    else root.removeProperty("--h-text");
    root.setProperty("--h-radius", h.radius || "14px");
    if (h.font) root.setProperty("--h-font", h.font);
    else root.removeProperty("--h-font");
    document.documentElement.dataset.hostLight = h.dark === false && !season ? "true" : "false";
  }, [theme, profile?.color, season]);
}

/** Hay una copia más nueva de otro PC en la carpeta de copias: ofrecer traerla. */
async function offerNewerBackup() {
  const b = await api.backupNewer().catch(() => null);
  if (!b) return;
  void api.backupDismiss(b.created);
  useApp.getState().toast("info", t("Hay una copia más nueva de tu biblioteca en {pc}", { pc: b.pc }), {
    label: t("Restaurar"),
    run: () => void restoreBackup(b),
  });
}

/** Del 1 de diciembre al 15 de enero, una vez por año: «Tu año en ejGames». */
function offerYearReview() {
  const now = new Date();
  const year = now.getMonth() === 11 ? now.getFullYear() : now.getMonth() === 0 && now.getDate() <= 15 ? now.getFullYear() - 1 : 0;
  const st = useApp.getState();
  if (!year || (st.settings?.yearReviewSeen ?? 0) >= year) return;
  void api.updateSettings({ yearReviewSeen: year }).then((s) => useApp.getState().set({ settings: s }));
  st.toast("info", t("Tu año en ejGames ya está listo"), { label: t("Verlo"), run: () => useApp.getState().open("year-review", { year }) });
}

async function loadLibrary() {
  const [games, collections, running] = await Promise.all([api.getLibrary(), api.listCollections(), api.runningGames()]);
  useApp.getState().set({ games, collections, running });
}

export default function App() {
  const boot = useApp((s) => s.boot);
  const profile = useApp((s) => s.profile);
  const overlays = useApp((s) => s.overlays);
  const close = useApp((s) => s.close);
  const set = useApp((s) => s.set);
  const [phase, setPhase] = useState<"loading" | "onboarding" | "picker" | "main">("loading");
  useHostStyle();

  async function enter(p: Profile) {
    set({ profile: p });
    await loadLibrary();
    setPage(await api.profilePage().catch(() => null));
    set({ wishlist: await api.wishlist().catch(() => []) });
    useApp.getState().closeAll();
    setPhase("main");
    checkOnLaunch();
    void offerNewerBackup();
    offerYearReview();
  }

  // Arranque.
  useEffect(() => {
    (async () => {
      try {
        const b = await api.bootstrap();
        set({ boot: b, profiles: b.profiles, settings: b.settings, themes: b.themes, running: b.running, themeOverride: b.safeMode ? "steam" : null, safeOrigin: b.safeMode });
        setDownloads(b.downloads ?? []);
        if (b.safeMode) useApp.getState().toast("info", "Modo seguro: se ha cargado el tema Steam.");
        if (b.settings.startBigPicture) void setBigPicture(true);
        if (b.profiles.length === 0) setPhase("onboarding");
        else if (b.activeProfile) await enter(b.profiles.find((p) => p.id === b.activeProfile)!);
        else setPhase("picker");
      } catch (e) {
        console.error(e);
        void api.appReady();
        useApp.getState().toast("error", errMsg(e));
      }
    })();
  }, []);

  // Pantallas del host (sin tema): mostrar la ventana ya.
  useEffect(() => {
    if (phase === "onboarding" || phase === "picker") void api.appReady();
  }, [phase]);

  // Eventos del núcleo.
  useEffect(() => {
    const subs = [
      on("library:changed", async (e) => {
        if (!useApp.getState().profile) return;
        if (e.full) await loadLibrary();
        else if (e.ids?.length) useApp.getState().patchGames(await api.getGames(e.ids));
        // Juegos nuevos o logros: el nivel y las insignias pueden cambiar.
        refreshPage(3000);
      }),
      on("meta:progress", (m) => set({ meta: m })),
      on("scan:progress", (s) => set({ scan: s })),
      on("app:toast", (t) => useApp.getState().toast(t.kind, t.message)),
      on("wishlist:changed", (list) => set({ wishlist: list })),
      on("theme:changed", (t) => {
        // El elegido, no el que se ve: con su theme.json roto se ve Steam y,
        // al arreglarlo, tiene que volver.
        const st = useApp.getState();
        if ((st.themeOverride ?? st.profile?.themeId) === t.id) void reloadTheme();
      }),
      on("downloads:changed", (list) => {
        setDownloads(list);
        // El estado de lo deseado (descargando, instalado…) va con las descargas.
        if (useApp.getState().wishlist.length) void api.wishlist().then((w) => set({ wishlist: w }), () => {});
      }),
      on("downloads:progress", (list) => mergeProgress(list)),
      on("downloads:finished", (d) =>
        useApp.getState().toast("ok", `«${d.title}» descargado`, { label: "Instalar", run: () => void installDownload(d.id) }),
      ),
      on("downloads:install", (e) => {
        const st = useApp.getState();
        if (e.phase === "needs-folder")
          st.toast("info", e.message || "Elige la carpeta del juego instalado", { label: "Elegir carpeta", run: () => void locateInstall(e.id) });
        else if (e.phase === "done" && e.gameId) {
          const id = e.gameId;
          st.toast("ok", "Juego instalado", { label: "Jugar", run: () => void api.play(id).catch((x) => st.toast("error", errMsg(x))) });
        }
      }),
      on("game:state", async (e) => {
        set({ running: await api.runningGames() });
        window.dispatchEvent(new CustomEvent("ejg:game-state", { detail: e }));
        // Partida guardada: horas, nivel e insignias al día.
        if (e.state === "stopped") refreshPage(500);
        if (e.state === "stopped" && e.value && e.value >= 60) {
          const g = useApp.getState().games.find((x) => x.id === e.gameId);
          useApp.getState().toast("ok", `Sesión de ${playtime(e.value)}${g ? ` en ${g.title}` : ""} registrada`);
        }
      }),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);

  // Mando + teclado global + origen de la entrada (oculta el cursor con mando).
  useEffect(() => {
    const setSource = (s: "mouse" | "keyboard" | "gamepad", padId?: string) => {
      const st = useApp.getState();
      const pad = padId ? padTypeOf(padId) : st.padType;
      if (st.inputSource !== s || st.padType !== pad) {
        st.set({ inputSource: s, padType: pad });
        document.body.dataset.input = s;
        document.documentElement.dataset.input = s;
      }
    };
    document.body.dataset.input = "mouse";
    document.documentElement.dataset.input = "mouse";
    const stop = startGamepad(
      (action, repeat) => {
        window.dispatchEvent(new CustomEvent("ejg:nav-debug", { detail: action }));
        dispatchNav(action, repeat, "gamepad");
      },
      (id) => setSource("gamepad", id),
    );
    let lastMouse = 0;
    const onMouse = () => {
      const now = Date.now();
      if (now - lastMouse > 250) {
        lastMouse = now;
        setSource("mouse");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      setSource("keyboard");
      const global = e.key === "F11" || e.key === "F5" || (e.ctrlKey && ["f", ",", "p", "k", "e", "j"].includes(e.key.toLowerCase()));
      if (global) {
        e.preventDefault();
        globalKey({ key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey });
      }
    };
    window.addEventListener("mousemove", onMouse, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      stop();
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (phase === "loading" || !boot) return null;
  if (phase === "onboarding") return <Onboarding onDone={async () => {
    const b = await api.bootstrap();
    set({ boot: b, profiles: b.profiles, settings: b.settings });
    const p = b.profiles.find((x) => x.id === b.activeProfile) ?? b.profiles[0];
    await enter(p);
  }} />;
  if (phase === "picker") return <ProfilePicker onLogin={enter} />;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {profile && <ThemeFrame />}
      <WindowControls />
      <ActivityPill />
      {overlays.map((o, i) => {
        const onClose = () => {
          playSound("back");
          close();
        };
        const key = `${o.name}-${i}`;
        switch (o.name) {
          case "settings":
            return <SettingsOverlay key={key} args={o.args} onClose={onClose} />;
          case "game":
            return <GameEditor key={key} id={Number(o.args?.id)} onClose={onClose} />;
          case "search":
            return <SearchOverlay key={key} onClose={onClose} />;
          case "software":
            return <SoftwareStore key={key} onClose={onClose} />;
          case "homebrew":
            return <HomebrewStore key={key} args={o.args} onClose={onClose} />;
          case "rom-import":
            return <RomImport key={key} onClose={onClose} />;
          case "year-review":
            return <YearReviewOverlay key={key} year={o.args?.year == null ? undefined : Number(o.args.year)} onClose={onClose} />;
          case "stats":
            return <StatsOverlay key={key} onClose={onClose} />;
          case "collections":
            return <CollectionsOverlay key={key} onClose={onClose} />;
          case "menu":
            return <QuickMenu key={key} onClose={onClose} />;
          case "explore":
            return <ExploreOverlay key={key} args={o.args} onClose={onClose} />;
          case "downloads":
            return <DownloadsOverlay key={key} onClose={onClose} />;
          case "keyboard":
            return <KeyboardOverlay key={key} args={o.args} onClose={close} />;
          case "update":
            return <UpdateAvailable key={key} onClose={onClose} />;
          case "uninstall":
            return <UninstallDialog key={key} id={Number(o.args?.id)} onClose={onClose} />;
          case "guides":
            return <GuidesOverlay key={key} args={o.args} onClose={onClose} />;
          case "trainer":
            return <TrainerOverlay key={key} args={o.args} onClose={onClose} />;
          case "map":
            return <MapOverlay key={key} args={o.args} onClose={onClose} />;
          case "profile":
            return <ProfileOverlay key={key} args={o.args} onClose={onClose} />;
          case "profile-editor":
            return <ProfileEditorOverlay key={key} onClose={onClose} />;
          case "profiles":
            return (
              <ProfilePicker
                key={key}
                onClose={onClose}
                onLogin={async (p) => {
                  await enter(p);
                }}
              />
            );
          default:
            return null;
        }
      })}
      <Toasts />
    </div>
  );
}
