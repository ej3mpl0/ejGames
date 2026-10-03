// Overlay dentro del juego (ventana transparente encima del juego).
// - Avisos: pila en una esquina (logros, capturas, pista del atajo), con el
//   aspecto de la plataforma del tema (ver notices.tsx).
// - Panel: el de esa misma plataforma (ver panel/): logros, capturas, notas,
//   música, volumen, rendimiento, descargas y cerrar el juego. Se abre con el
//   atajo o el botón Guía; el núcleo manda la navegación del mando (el Gamepad
//   API no sirve cuando el foco lo tiene el juego) y los datos vivos.
// - Mapa: un iframe de Map Genie en la raíz (MapHost), que se coloca encima de
//   la pestaña Mapa o se ancla en una esquina encima del juego.
// Cuando no queda nada que enseñar se avisa al núcleo y la ventana se destruye.

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../api/tauri";
import type { NavAction, OverlayLive, OverlayNotice, OverlayPanel, OverlayPin } from "../api/types";
import { MapHost, useMapHost } from "../components/map";
import { padTypeOf } from "../input/gamepad";
import { configureSounds } from "../host/sounds";
import { useHostSeason } from "../host/season";
import { dispatchNav } from "../input/nav";
import { KeyboardOverlay } from "../overlays/Keyboard";
import { useApp } from "../store/app";
import "./ingame.css";
import { isRare, LEAVE_MS, noticeMs, NoticeStack, NoticeView } from "./notices";
import { PanelView } from "./panel";

const MAX_VISIBLE = 3;

type Shown = OverlayNotice & { leaving?: boolean };

const NO_LIVE: OverlayLive = { downloads: { items: [], pausedForGame: false, allowed: false } };

/** Teclado en pantalla (notas con el mando): el mismo del launcher. */
function Keyboards() {
  const kb = useApp((s) => s.overlays.find((o) => o.name === "keyboard"));
  if (!kb) return null;
  const close = () => useApp.setState((s) => ({ overlays: s.overlays.filter((o) => o.name !== "keyboard") }));
  return (
    <div className="ig-keyboard">
      <KeyboardOverlay args={kb.args} onClose={close} />
    </div>
  );
}

export function Overlay() {
  const [queue, setQueue] = useState<OverlayNotice[]>([]);
  const [shown, setShown] = useState<Shown[]>([]);
  const [panel, setPanel] = useState<OverlayPanel | null>(null);
  const [live, setLive] = useState<OverlayLive>(NO_LIVE);
  const [ready, setReady] = useState(false);
  const [pinned, setPinned] = useState(false);
  const panelRef = useRef<OverlayPanel | null>(null);
  panelRef.current = panel;
  // Evento de temporada (Halloween…): <html data-season> también aquí (ingame.css).
  useHostSeason();
  useEffect(() => {
    api.getSettings().then((settings) => useApp.getState().set({ settings }), () => {});
  }, []);

  useEffect(() => {
    const subs = [
      listen<OverlayNotice>("overlay:notice", (e) => setQueue((q) => [...q, e.payload])),
      listen<OverlayPanel | null>("overlay:panel", (e) => openPanel(e.payload)),
      listen<OverlayLive>("overlay:live", (e) => setLive(e.payload)),
      listen<OverlayPin | null>("overlay:pin", (e) => setPin(e.payload)),
      listen<NavAction>("overlay:nav", (e) => {
        useApp.getState().set({ inputSource: "gamepad" });
        dispatchNav(e.payload, false, "gamepad");
      }),
    ];
    Promise.all(subs).then(async () => {
      const init = await api.overlayReady();
      if (init.notices.length) setQueue((q) => [...q, ...init.notices]);
      if (init.panel) openPanel(init.panel);
      setPin(init.pin ?? null);
      setReady(true);
    });
    // Sin foco con el panel abierto (Alt+Tab, clic en otra ventana): cerrarlo.
    let unBlur: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && panelRef.current) void api.overlayPanel(false, false);
      })
      .then((u) => (unBlur = u));
    // Teclado: el panel se maneja como el launcher; RePág/AvPág cambian de pestaña.
    const onKey = (e: KeyboardEvent) => {
      if (!panelRef.current) return;
      if (e.key !== "Shift") useApp.getState().set({ inputSource: "keyboard" });
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      const tabs: Record<string, NavAction> = { PageUp: "lb", PageDown: "rb", q: "lb", e: "rb", Q: "lb", E: "rb" };
      if (tabs[e.key]) {
        e.preventDefault();
        dispatchNav(tabs[e.key], e.repeat, "keyboard");
      }
    };
    const onMouse = () => useApp.getState().inputSource !== "mouse" && useApp.getState().set({ inputSource: "mouse" });
    // Como en el launcher: con ratón no se pinta el foco de mando/teclado.
    const unInput = useApp.subscribe((s) => document.body.setAttribute("data-input", s.inputSource));
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMouse);
    return () => {
      subs.forEach((p) => p.then((u) => u()));
      unBlur?.();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMouse);
      unInput();
    };
  }, []);

  function setPin(pin: OverlayPin | null) {
    useMapHost.setState({ pin });
    setPinned(!!pin);
  }

  function openPanel(p: OverlayPanel | null) {
    if (p) {
      const pads = navigator.getGamepads?.().filter(Boolean) ?? [];
      useApp.getState().set({ inputSource: p.pad ? "gamepad" : "keyboard", padType: pads[0] ? padTypeOf(pads[0].id) : "xbox" });
      if (!panelRef.current) setLive(p.live ?? NO_LIVE);
      configureSounds({ volume: p.soundsVolume, preset: "soft" });
    } else {
      // Cerrar el panel cierra también el teclado en pantalla y suelta el mapa
      // (si no está anclado).
      useApp.getState().closeAll();
      useMapHost.setState({ url: null, slot: null });
    }
    setPanel(p);
  }

  // Cola → visibles (máx. 3) con su temporizador.
  useEffect(() => {
    if (!queue.length) return;
    const visible = shown.filter((s) => !s.leaving).length;
    if (visible >= MAX_VISIBLE) return;
    const take = queue.slice(0, MAX_VISIBLE - visible);
    setQueue((q) => q.slice(take.length));
    setShown((s) => [...s, ...take]);
    for (const n of take) {
      // El sonido, a la vez que la animación de entrada (la captura ya sonó).
      if (n.kind !== "info" && n.kind !== "screenshot") void api.overlayChime(isRare(n)).catch(() => {});
      setTimeout(() => setShown((s) => s.map((x) => (x.id === n.id ? { ...x, leaving: true } : x))), noticeMs(n));
      setTimeout(() => setShown((s) => s.filter((x) => x.id !== n.id)), noticeMs(n) + LEAVE_MS);
    }
  }, [queue, shown]);

  // Nada que enseñar: el núcleo destruye la ventana.
  useEffect(() => {
    if (!ready || queue.length || shown.length || panel || pinned) return;
    const t = setTimeout(() => void api.overlayIdle(), 400);
    return () => clearTimeout(t);
  }, [ready, queue.length, shown.length, panel, pinned]);

  return (
    <div className="ig-root">
      {panel && <PanelView key={panel.gameId} data={panel} live={live} />}
      <MapHost panelOpen={!!panel} />
      {panel && <Keyboards />}
      {shown.length > 0 && (
        <NoticeStack corner={shown[shown.length - 1].look.corner}>
          {shown.map((n) => (
            <NoticeView key={n.id} n={n} leaving={n.leaving} />
          ))}
        </NoticeStack>
      )}
    </div>
  );
}
