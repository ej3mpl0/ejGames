// Amigos y perfiles en el host: el mismo objeto `ejg` que ven los temas
// (account, friends, profiles, comments, activity, ui), pero llamando al
// núcleo directamente. Así las vistas del kit (sdk/kit/social.js) sirven tal
// cual en las ventanas del host y en el overlay.

import { api } from "../api/tauri";
import type { AccountState, AccountStatus } from "../api/types";
import { activeTheme, useApp } from "../store/app";
import { openKeyboard } from "./downloads";

const setAccount = (a: AccountState) => {
  useApp.setState({ account: a });
  return a;
};

/** ¿El tema activo pinta sus propios amigos y perfiles? */
export function themeHasSocial() {
  return !!activeTheme(useApp.getState())?.features?.social;
}

/**
 * Abre lo social: amigos o un perfil (los del tema si los pinta; si no, la
 * ventana del host), el editor del perfil o los ajustes de la cuenta.
 */
export function openSocial(name: string, args?: Record<string, unknown> | null, fromTheme = false) {
  const st = useApp.getState();
  const a = st.account;
  const linked = !!a?.linked && !a.needsLogin;
  // Sin cuenta, «Cuenta» es el diálogo para crearla o entrar; con ella, sus ajustes.
  if (name === "account") return linked ? st.open("settings", { tab: "account" }) : openLogin(a?.needsLogin ? "login" : "register");
  if (name === "account-login") return openLogin(args?.mode === "login" ? "login" : "register");
  if (name === "profile-editor") return linked ? st.open("profile-editor") : openLogin("register");
  const id = typeof args?.id === "number" ? args.id : null;
  const tab = typeof args?.tab === "string" && ["friends", "requests", "activity"].includes(args.tab) ? args.tab : null;
  const view = name === "profile" || name === "badges" ? name : "friends";
  // Si lo pide el propio tema, no se le devuelve la pelota.
  if (themeHasSocial() && !fromTheme) {
    st.closeAll();
    window.dispatchEvent(new CustomEvent("ejg:ui-view", { detail: { view, userId: id, tab } }));
    return;
  }
  st.open("social", { view, id, tab });
}

/** El diálogo de la cuenta de ejGames: crearla o entrar. */
export function openLogin(mode: "register" | "login" = "register") {
  const st = useApp.getState();
  if (!st.account?.enabled) return;
  if (st.overlays.some((o) => o.name === "account-auth")) return;
  st.open("account-auth", { mode });
}

export function hostEjg() {
  return {
    account: {
      get state() {
        return useApp.getState().account;
      },
      onChange(fn: (a: AccountState | null) => void) {
        return useApp.subscribe((s, prev) => {
          if (s.account !== prev.account) fn(s.account);
        });
      },
      setStatus: (status: AccountStatus) => api.accountPrefs({ status }).then(setAccount),
      openEditor: () => openSocial("profile-editor"),
      openLogin: (mode?: "register" | "login") => openLogin(mode),
    },
    friends: {
      add: (q: string) => api.socialFriend("request", q).then(setAccount),
      accept: (id: number) => api.socialFriend("accept", id).then(setAccount),
      decline: (id: number) => api.socialFriend("decline", id).then(setAccount),
      remove: (id: number) => api.socialFriend("remove", id).then(setAccount),
      block: (id: number) => api.socialFriend("block", id).then(setAccount),
      unblock: (id: number) => api.socialFriend("unblock", id).then(setAccount),
      refresh: () => api.socialRefresh().then(setAccount),
    },
    profiles: { view: (id: number) => api.socialUser(id) },
    comments: {
      list: (id: number, before?: number) => api.socialComments(id, before),
      post: (id: number, text: string) => api.socialComment(id, text),
      remove: (id: number) => api.socialCommentDelete(id),
    },
    activity: { feed: (before?: number) => api.socialFeed(before) },
    ui: {
      keyboard: (o: { title?: string; placeholder?: string; maxLength?: number; value?: string }) => openKeyboard(o),
      open: (name: string, args?: Record<string, unknown>) => openSocial(name, args),
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
