// Carga el tema activo en un iframe aislado y hace de puente con él.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, errMsg, on } from "../api/tauri";
import type { LibGame, Profile, ProfileCard, ThemeInfo } from "../api/types";
import { setThemeSink } from "../input/nav";
import { currentSeason, useSeason } from "./season";
import { activeTheme, useApp } from "../store/app";
import { handleThemeCall } from "./bridge";
import { configureSounds, playSound, type SoundName } from "./sounds";
import { globalKey } from "./window";
import { getLang } from "../lib/i18n";

const ORIGIN = "http://ejg-theme.localhost";
const SAFE_ORIGIN = "http://ejg-safe.localhost";

/** Tu perfil en corto para los temas (`ejg.profiles.me`): el nombre y el avatar del perfil local. */
function cardOf(p: Profile | null): ProfileCard | null {
  return p && { id: p.id, name: p.name, avatarUrl: p.avatar ?? null, color: p.color };
}

export function mergedSettings(theme: ThemeInfo | undefined, saved: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {};
  for (const s of theme?.settings ?? []) out[s.key] = s.default;
  return { ...out, ...(saved ?? {}) };
}

let shownOnce = false;

// Textos traducidos de cada tema (se piden una vez por tema).
const stringsCache = new Map<string, Promise<Record<string, string>>>();
function themeStrings(id: string | undefined) {
  if (!id || getLang() === "es") return Promise.resolve({});
  if (!stringsCache.has(id)) stringsCache.set(id, api.themeStrings(id).catch(() => ({})));
  return stringsCache.get(id)!;
}

export function ThemeFrame() {
  const theme = useApp(activeTheme);
  const profile = useApp((s) => s.profile);
  const games = useApp((s) => s.games);
  const collections = useApp((s) => s.collections);
  const running = useApp((s) => s.running);
  const mode = useApp((s) => s.mode);
  const reload = useApp((s) => s.themeReload);
  const overlays = useApp((s) => s.overlays.length);
  const safeOrigin = useApp((s) => s.safeOrigin);
  const inputSource = useApp((s) => s.inputSource);
  const padType = useApp((s) => s.padType);
  const origin = safeOrigin ? SAFE_ORIGIN : ORIGIN;
  const frame = useRef<HTMLIFrameElement>(null);
  const sent = useRef<Map<number, LibGame> | null>(null);
  const beats = useRef({ ready: false, last: 0 });
  const [failed, setFailed] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  const settings = useMemo(
    () => mergedSettings(theme, profile?.themeSettings?.[theme?.id ?? ""] as Record<string, unknown> | undefined),
    [theme, profile?.themeSettings],
  );
  const customCss = (theme && profile?.customCss?.[theme.id]) || "";

  const post = (msg: object) => frame.current?.contentWindow?.postMessage({ __ejg: 1, ...msg }, "*");
  const event = (name: string, data: unknown) => post({ type: "event", name, data });

  // Sonidos del tema: preset o ficheros propios; el ajuste "sounds" del editor manda.
  useEffect(() => {
    const files: Partial<Record<SoundName, string>> = {};
    const snd = theme?.sounds ?? {};
    for (const k of ["move", "select", "back", "launch", "error", "open"] as SoundName[]) {
      const f = snd?.[k];
      if (f) files[k] = `${origin}/${theme!.id}/${f}`;
    }
    const preset = (settings.sounds as string) || snd?.preset || "soft";
    configureSounds({ volume: profile?.soundsVolume ?? 0.6, preset, files: preset === "theme" || !settings.sounds ? files : {} });
  }, [theme, profile?.soundsVolume, settings.sounds, origin]);

  // Mensajes del iframe.
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (!frame.current || ev.source !== frame.current.contentWindow) return;
      const m = ev.data;
      if (!m || m.__ejg !== 1) return;
      switch (m.type) {
        case "hello":
          void themeStrings(activeTheme(useApp.getState())?.id).then(sendInit);
          break;
        case "ready":
          beats.current = { ready: true, last: Date.now() };
          setFailed(null);
          if (!shownOnce) {
            shownOnce = true;
            void api.appReady();
          }
          frame.current.focus();
          break;
        case "heartbeat":
          beats.current.last = Date.now();
          break;
        case "call":
          handleThemeCall(String(m.method), m.params)
            .then((result) => post({ type: "result", id: m.id, ok: true, result: result ?? null }))
            .catch((e) => post({ type: "result", id: m.id, ok: false, error: errMsg(e) }));
          break;
        case "key":
          globalKey(m);
          break;
        case "sound":
          playSound(String(m.name) as SoundName);
          break;
        case "nav-unhandled":
          // "Atrás" que el tema no ha usado: cierra lo del host que haya
          // abierto; en Big Picture, sin nada abierto, abre el menú rápido.
          if (m.action === "back") {
            const st = useApp.getState();
            if (st.overlays.length) st.close();
            else if (st.mode === "tv") st.open("menu");
          }
          break;
        case "input-source":
          if (m.source === "mouse" || m.source === "keyboard") {
            useApp.getState().set({ inputSource: m.source });
            document.body.dataset.input = m.source;
            document.documentElement.dataset.input = m.source;
          }
          break;
        case "error":
          if (useApp.getState().settings?.devMode) useApp.getState().toast("error", `Tema: ${String(m.message).slice(0, 200)}`);
          console.warn("[tema]", m.message);
          break;
      }
    };
    window.addEventListener("message", onMsg);
    setThemeSink((action, repeat, source) => event("nav", { action, repeat, source }));
    return () => {
      window.removeEventListener("message", onMsg);
      setThemeSink(null);
    };
  });

  function sendInit(strings: Record<string, string>) {
    const st = useApp.getState();
    const t = activeTheme(st);
    const games = st.games;
    sent.current = new Map(games.map((g) => [g.id, g]));
    post({
      type: "init",
      data: {
        sdk: 1,
        lang: getLang(),
        strings,
        theme: { id: t?.id, name: t?.name, settings: t?.settings ?? [], version: t?.version },
        settings: mergedSettings(t, st.profile?.themeSettings?.[t?.id ?? ""] as Record<string, unknown>),
        customCss: (t && st.profile?.customCss?.[t.id]) || "",
        profile: st.profile && { id: st.profile.id, name: st.profile.name, avatar: st.profile.avatar, color: st.profile.color, themeId: st.profile.themeId },
        library: games,
        collections: st.collections,
        running: st.running.map((r) => ({ gameId: r.gameId, startedAt: r.startedAt })),
        mode: st.mode,
        input: { source: st.inputSource, pad: st.padType },
        version: st.boot?.version,
        downloads: st.downloads,
        wishlist: st.wishlist,
        explore: st.settings?.exploreEnabled !== false,
        eventMode: st.settings?.eventMode ?? "auto",
        season: currentSeason(),
        page: cardOf(st.profile),
        catalogJobs: st.catalogJobs,
      },
    });
  }

  // Al recargar el tema (modo desarrollo), sus textos se vuelven a leer.
  useEffect(() => void stringsCache.clear(), [reload]);

  // Watchdog: listo en 6 s y latido cada 5 s (sin contar mientras está oculto).
  useEffect(() => {
    beats.current = { ready: false, last: Date.now() };
    const start = Date.now();
    const t = setInterval(() => {
      if (document.hidden) {
        beats.current.last = Date.now();
        return;
      }
      const b = beats.current;
      const dead = (!b.ready && Date.now() - start > 6000) || (b.ready && Date.now() - b.last > 16000);
      if (dead && theme) {
        clearInterval(t);
        const st = useApp.getState();
        if (theme.id !== "steam") {
          st.toast("error", `El tema «${theme.name}» no responde. Se ha cargado el tema Steam.`);
          // Desmontar el iframe colgado y esperar a que Chromium cierre su proceso;
          // si no, el tema de reserva reutilizaría el mismo proceso bloqueado.
          setRecovering(true);
          setTimeout(() => {
            st.set({ themeOverride: "steam", safeOrigin: true });
            setRecovering(false);
          }, 300);
        } else {
          setFailed("El tema no ha arrancado.");
          if (!shownOnce) {
            shownOnce = true;
            void api.appReady();
          }
        }
      }
    }, 1000);
    const vis = () => (beats.current.last = Date.now());
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [theme?.id, reload]);

  // Biblioteca → diferencias.
  useEffect(() => {
    const prev = sent.current;
    if (!prev || !beats.current.ready) return;
    const list = games;
    const now = new Map(list.map((g) => [g.id, g]));
    const changed = list.filter((g) => prev.get(g.id) !== g);
    const removed = [...prev.keys()].filter((id) => !now.has(id));
    if (!changed.length && !removed.length) return;
    event("library", changed.length > 150 ? { full: list } : { changed, removed });
    sent.current = now;
  }, [games]);

  useEffect(() => void (beats.current.ready && event("settings", settings)), [settings]);
  useEffect(() => void (beats.current.ready && event("css", customCss)), [customCss]);
  useEffect(() => void (beats.current.ready && event("collections", collections)), [collections]);
  useEffect(() => void (beats.current.ready && event("mode", mode)), [mode]);
  useEffect(() => void (beats.current.ready && event("input", { source: inputSource, pad: padType })), [inputSource, padType]);
  useEffect(
    () => void (beats.current.ready && event("running", running.map((r) => ({ gameId: r.gameId, startedAt: r.startedAt })))),
    [running],
  );
  useEffect(() => {
    if (!beats.current.ready || !profile) return;
    event("profile", { id: profile.id, name: profile.name, avatar: profile.avatar, color: profile.color, themeId: profile.themeId });
    event("page", cardOf(profile));
  }, [profile?.name, profile?.avatar, profile?.color]);

  // Al cerrar el último overlay, el foco vuelve al tema.
  useEffect(() => {
    if (overlays === 0 && beats.current.ready) {
      frame.current?.focus();
      event("focus-return", null);
    }
  }, [overlays]);

  // Descargas → tema (como mucho una vez por segundo).
  const downloads = useApp((s) => s.downloads);
  const dlTimer = useRef<{ t: number | null; last: number }>({ t: null, last: 0 });
  useEffect(() => {
    if (!beats.current.ready) return;
    const send = () => {
      dlTimer.current.t = null;
      dlTimer.current.last = Date.now();
      event("downloads", useApp.getState().downloads);
    };
    const wait = 1000 - (Date.now() - dlTimer.current.last);
    if (wait <= 0) send();
    else if (dlTimer.current.t == null) dlTimer.current.t = window.setTimeout(send, wait);
  }, [downloads]);
  useEffect(() => () => void (dlTimer.current.t != null && clearTimeout(dlTimer.current.t)), []);
  // Descargas de los catálogos (Homebrew) → tema, también como mucho una vez por segundo.
  const catJobs = useApp((s) => s.catalogJobs);
  const catTimer = useRef<{ t: number | null; last: number }>({ t: null, last: 0 });
  useEffect(() => {
    if (!beats.current.ready) return;
    const send = () => {
      catTimer.current.t = null;
      catTimer.current.last = Date.now();
      event("catalog-jobs", useApp.getState().catalogJobs);
    };
    const wait = 1000 - (Date.now() - catTimer.current.last);
    if (wait <= 0) send();
    else if (catTimer.current.t == null) catTimer.current.t = window.setTimeout(send, wait);
  }, [catJobs]);
  useEffect(() => () => void (catTimer.current.t != null && clearTimeout(catTimer.current.t)), []);
  // Lista de deseados → tema.
  const wishlist = useApp((s) => s.wishlist);
  useEffect(() => void (beats.current.ready && event("wishlist", wishlist)), [wishlist]);
  const exploreOn = useApp((s) => s.settings?.exploreEnabled !== false);
  useEffect(() => void (beats.current.ready && event("explore", { enabled: exploreOn })), [exploreOn]);
  // Evento de temporada (Halloween…) → tema: paleta, fondo y ambiente del SDK.
  const eventMode = useApp((s) => s.settings?.eventMode ?? "auto");
  const season = useSeason();
  useEffect(() => void (beats.current.ready && event("season", { mode: eventMode, season })), [eventMode, season]);

  // Llegó arte de Steam para la tienda: el tema vuelve a pedir la portada.
  useEffect(() => {
    const un = on("explore:art", () => beats.current.ready && event("explore-art", null));
    return () => void un.then((f) => f());
  }, []);

  // Partidas guardadas: copia nueva, restaurada o rutas cambiadas.
  useEffect(() => {
    const un = on("saves:changed", (e) => beats.current.ready && event("saves", e));
    return () => void un.then((f) => f());
  }, []);

  // Eventos de partida reenviados al tema.
  useEffect(() => {
    const fn = (e: Event) => event("game-state", (e as CustomEvent).detail);
    window.addEventListener("ejg:game-state", fn);
    // El host pide al tema que abra una de sus vistas (menú rápido, atajos…).
    const view = (e: Event) => {
      frame.current?.focus();
      event("ui:view", (e as CustomEvent).detail);
    };
    window.addEventListener("ejg:ui-view", view);
    const vis = () => event("visibility", { visible: !document.hidden });
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("ejg:game-state", fn);
      window.removeEventListener("ejg:ui-view", view);
      document.removeEventListener("visibilitychange", vis);
    };
  });

  if (!theme || recovering) return null;
  if (failed)
    return (
      <div className="grid h-full place-items-center text-center text-muted">
        <div>
          <p className="text-lg text-fg">No se pudo cargar el tema</p>
          <p className="mt-2 text-sm">{failed}</p>
          <button data-nav className="mt-4 rounded-lg bg-surface-3 px-4 py-2 text-fg" onClick={() => location.reload()}>
            Reintentar
          </button>
        </div>
      </div>
    );

  return (
    <iframe
      key={`${origin}:${theme.id}:${reload}`}
      ref={frame}
      className="theme-frame"
      title={theme.name}
      src={`${origin}/${theme.id}/${theme.entry || "index.html"}?r=${reload}`}
      sandbox="allow-scripts"
      allow="autoplay; fullscreen; gamepad"
      referrerPolicy="no-referrer"
    />
  );
}
