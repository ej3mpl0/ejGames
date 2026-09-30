// Tu perfil en el host: el mismo objeto `ejg` que ven los temas (profiles,
// ui), pero llamando al núcleo directamente. Así las vistas del kit
// (sdk/kit/profile.js) sirven tal cual en las ventanas del host.

import { api } from "../api/tauri";
import type { ProfileCard, ProfilePage } from "../api/types";
import { activeTheme, useApp } from "../store/app";
import { openKeyboard } from "./downloads";

/** Lo corto del perfil (cabeceras de los temas, menús). */
export function cardOf(p: ProfilePage): ProfileCard {
  const pr = p.profile;
  return {
    id: p.id,
    name: pr.name || p.name,
    avatarUrl: pr.avatarUrl ?? null,
    frame: pr.frame,
    background: pr.background,
    backgroundImageUrl: pr.backgroundImageUrl ?? null,
    color: pr.color,
    level: p.level,
    xp: p.xp,
    badges: p.badges,
    featuredBadge: pr.featuredBadge,
  };
}

/** Guarda la tarjeta del perfil (solo si ha cambiado: los temas repintan con cada cambio). */
export function setPage(p: ProfilePage | null) {
  const card = p ? cardOf(p) : null;
  if (JSON.stringify(card) !== JSON.stringify(useApp.getState().page)) useApp.setState({ page: card });
}

let timer: number | null = null;

/** Vuelve a calcular el perfil (nivel, insignias…). Con `delay`, agrupa las peticiones seguidas. */
export function refreshPage(delay = 0) {
  if (timer != null) clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    if (!useApp.getState().profile) return;
    void api.profilePage().then(setPage, () => {});
  }, delay);
}

/** ¿El tema activo pinta su propio perfil? */
export function themeHasProfile() {
  const f = activeTheme(useApp.getState())?.features;
  return !!(f?.profile ?? f?.social);
}

/** Abre tu perfil o tus insignias (los del tema si los pinta; si no, la ventana del host) o el editor. */
export function openProfile(name: "profile" | "badges" | "profile-editor", fromTheme = false) {
  const st = useApp.getState();
  if (!st.profile) return;
  if (name === "profile-editor") return st.open("profile-editor");
  // Si lo pide el propio tema, no se le devuelve la pelota.
  if (themeHasProfile() && !fromTheme) {
    st.closeAll();
    window.dispatchEvent(new CustomEvent("ejg:ui-view", { detail: { view: name } }));
    return;
  }
  st.open("profile", { view: name });
}

export function hostEjg() {
  return {
    profiles: {
      get me() {
        return useApp.getState().page;
      },
      onChange(fn: (p: ProfileCard | null) => void) {
        return useApp.subscribe((s, prev) => {
          if (s.page !== prev.page) fn(s.page);
        });
      },
      view: () => api.profilePage(),
      edit: () => openProfile("profile-editor"),
    },
    ui: {
      keyboard: (o: { title?: string; placeholder?: string; maxLength?: number; value?: string }) => openKeyboard(o),
      open: (name: string) => (name === "profile" || name === "badges" || name === "profile-editor" ? openProfile(name) : undefined),
    },
  };
}

/**
 * El foco de las vistas del kit dentro de una ventana del host: el host ya
 * tiene su navegación (`useOverlayNav`); esto solo le pide que enfoque algo.
 */
export function kitFocus(root: HTMLElement) {
  const mouse = () => document.body.getAttribute("data-input") === "mouse";
  const api = {
    get current() {
      return root.querySelector<HTMLElement>(".is-focused");
    },
    focus(el: HTMLElement) {
      if (el && !mouse()) el.dispatchEvent(new Event("nav:focus", { bubbles: true }));
      return true;
    },
    first(scope?: HTMLElement) {
      const el = (scope || root).querySelector<HTMLElement>("[data-nav]:not([disabled])");
      if (el) api.focus(el);
    },
  };
  return api;
}
