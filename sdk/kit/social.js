// Cuentas de ejGames para temas: amigos (quién juega a qué), solicitudes,
// actividad y perfiles al estilo Steam, con sus objetos de personalización
// (marcos, fondos animados, colores, insignias y vitrinas). Esos objetos se
// ven igual en todos los temas; cada tema decide la maqueta y la piel con
// las variables --s-* y las clases `s-…` (o las suyas, con `cls`).
//
//   import { createFriendsView, createProfileView } from "/_sdk/kit/social.js";
//   <link rel="stylesheet" href="/_sdk/kit/social.css" />

import { h } from "./dom.js";
import { playtime, relative } from "./format.js";

// ───────────────────────────── presencia ─────────────────────────────

export const STATUSES = [
  { value: "online", label: "En línea" },
  { value: "away", label: "Ausente" },
  { value: "invisible", label: "Invisible" },
];
const STATUS_LABEL = { online: "En línea", away: "Ausente", invisible: "Invisible", offline: "Desconectado" };

/** playing | online | away | offline */
export function presenceKind(p) {
  if (!p || p.status === "offline") return "offline";
  if (p.game) return "playing";
  return p.status === "away" ? "away" : "online";
}

/** "Jugando a Hollow Knight", "En línea", "Última conexión hace 3 horas". */
export function presenceText(p) {
  const k = presenceKind(p);
  if (k === "playing") return `Jugando a ${p.game}`;
  if (k === "offline") return p?.lastSeen ? `Última conexión ${relative(p.lastSeen).toLowerCase()}` : "Desconectado";
  return STATUS_LABEL[k];
}

/** Amigos en tres grupos, como en Steam: jugando, en línea y desconectados. */
export function groupFriends(list = []) {
  const byName = (a, b) => a.name.localeCompare(b.name, "es");
  const g = { playing: [], online: [], offline: [] };
  for (const f of list) {
    const k = presenceKind(f.presence);
    (k === "playing" ? g.playing : k === "offline" ? g.offline : g.online).push(f);
  }
  g.playing.sort((a, b) => (b.presence.since || 0) - (a.presence.since || 0));
  g.online.sort(byName);
  g.offline.sort((a, b) => (b.presence?.lastSeen || 0) - (a.presence?.lastSeen || 0) || byName(a, b));
  return g;
}

// ───────────────────────────── nivel e insignias ─────────────────────────────

/** Nivel n cuesta 100·n(n+1)/2 de experiencia (igual que el núcleo). */
export const xpFor = (level) => (100 * level * (level + 1)) / 2;
export function levelOf(xp) {
  let n = 0;
  while (xpFor(n + 1) <= xp) n++;
  return n;
}

const LEVEL_COLORS = ["#8f98a0", "#c02942", "#d95b43", "#e7b82a", "#4f9a3c", "#4e8ddb", "#7652c9", "#c252c9", "#9a3b5c", "#b08d57"];
export const levelColor = (level) => (level >= 100 ? "#f5c518" : LEVEL_COLORS[Math.floor(level / 10) % 10]);

const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const BADGES = {
  collector: { name: "Coleccionista", unit: (n) => `${n} juegos en la biblioteca`, th: [5, 10, 25, 50, 100, 250], icon: I('<rect x="4" y="3" width="6" height="18" rx="1"/><rect x="11" y="3" width="4" height="18" rx="1"/><path d="m16 4 4 1-3 16-4-1Z"/>') },
  achiever: { name: "Cazalogros", unit: (n) => `${n} logros`, th: [10, 50, 100, 250, 500, 1000, 2500], icon: I('<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/>') },
  marathon: { name: "Maratón", unit: (n) => `${n} horas jugadas`, th: [10, 50, 100, 250, 500, 1000], icon: I('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>') },
  completionist: { name: "Completista", unit: (n) => `${n} juegos al 100 %`, th: [1, 3, 5, 10, 25, 50], icon: I('<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7Z"/>') },
  explorer: { name: "Explorador", unit: (n) => `${n} juegos jugados más de una hora`, th: [5, 10, 25, 50, 100], icon: I('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>') },
  veteran: { name: "Veterano", unit: (n) => `${n} ${n === 1 ? "año" : "años"} en ejGames`, th: [1, 2, 3, 4, 5], icon: I('<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/>') },
  social: { name: "Social", unit: (n) => `${n} ${n === 1 ? "amigo" : "amigos"}`, th: [1, 5, 10, 25, 50], icon: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 5"/>') },
};
export const TIERS = ["", "Bronce", "Plata", "Oro", "Platino", "Diamante", "Maestro", "Leyenda"];
export const TIER_COLORS = ["", "#c47f45", "#aab4be", "#e7b82a", "#7fd3e0", "#8ab4ff", "#c77dff", "#ff6b6b"];

export function badgeInfo(b) {
  const def = BADGES[b.id];
  if (!def) return null;
  const tier = Math.max(1, Math.min(b.tier || 1, def.th.length));
  return { ...def, id: b.id, tier, tierName: TIERS[tier] || "", color: TIER_COLORS[tier] || "#aaa", text: def.unit(def.th[tier - 1]), next: def.th[tier] ? def.unit(def.th[tier]) : null };
}

// ───────────────────────────── objetos de personalización ─────────────────────────────

export const FRAMES = [
  { id: "", name: "Sin marco" },
  { id: "gold", name: "Oro" },
  { id: "silver", name: "Plata" },
  { id: "neon", name: "Neón" },
  { id: "fire", name: "Fuego" },
  { id: "ice", name: "Hielo" },
  { id: "leaf", name: "Bosque" },
  { id: "pixel", name: "Píxel" },
  { id: "royal", name: "Real" },
  { id: "galaxy", name: "Galaxia" },
  { id: "rainbow", name: "Arcoíris" },
  { id: "glitch", name: "Glitch" },
];

export const BACKGROUNDS = [
  { id: "", name: "Solo color" },
  { id: "aurora", name: "Aurora" },
  { id: "stars", name: "Estrellas" },
  { id: "nebula", name: "Nebulosa" },
  { id: "sunset", name: "Atardecer" },
  { id: "ocean", name: "Océano" },
  { id: "synthwave", name: "Synthwave" },
  { id: "forest", name: "Bosque" },
  { id: "embers", name: "Brasas" },
];

export const COLORS = [
  { id: "", name: "Azul", accent: "#4f9dff" },
  { id: "purple", name: "Violeta", accent: "#a970ff" },
  { id: "red", name: "Rojo", accent: "#ff5a5f" },
  { id: "green", name: "Verde", accent: "#3ddc84" },
  { id: "gold", name: "Oro", accent: "#f5c518" },
  { id: "pink", name: "Rosa", accent: "#ff6ec7" },
  { id: "teal", name: "Turquesa", accent: "#2dd4bf" },
];

export const SHOWCASES = [
  { type: "featured", name: "Juego destacado" },
  { type: "favorite", name: "Juego favorito" },
  { type: "stats", name: "Estadísticas" },
  { type: "recent", name: "Jugados hace poco" },
  { type: "achievements", name: "Logros recientes" },
  { type: "badges", name: "Insignias" },
  { type: "screenshots", name: "Capturas" },
  { type: "text", name: "Texto libre" },
];

const initials = (name = "?") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

/** Avatar con su marco (y el punto de presencia si se pide). size: s | m | l | xl */
export function avatar(user, { size = "m", cls = "s-", presence } = {}) {
  const url = user?.avatarUrl || user?.profile?.avatarUrl;
  const frame = user?.frame ?? user?.profile?.frame ?? "";
  return h(
    "span",
    { class: `${cls}avatar ${cls}avatar-${size}${frame ? ` ${cls}frame ${cls}frame-${frame}` : ""}${presence ? ` is-${presenceKind(presence)}` : ""}` },
    url ? h("img", { src: url, alt: "", draggable: false, loading: "lazy" }) : h("span", { class: `${cls}avatar-ph` }, initials(user?.name || user?.username)),
    presence ? h("i", { class: `${cls}dot` }) : null,
  );
}

export function levelBadge(level = 0, cls = "s-") {
  // Variables CSS en texto: h() las pierde si van en un objeto.
  return h("span", { class: `${cls}level`, style: `--lv: ${levelColor(level)}`, title: `Nivel ${level}` }, String(level));
}

export function badgeEl(b, cls = "s-", { big = false } = {}) {
  const info = badgeInfo(b);
  if (!info) return null;
  return h(
    "span",
    { class: `${cls}badge${big ? " is-big" : ""}`, style: `--tier: ${info.color}`, title: `${info.name} · ${info.tierName}: ${info.text}` },
    h("span", { class: `${cls}badge-ico`, html: info.icon }),
    big ? h("span", { class: `${cls}badge-txt` }, h("b", null, info.name), h("small", null, `${info.tierName} · ${info.text}`)) : null,
  );
}

/** Clases del fondo y del color de un perfil (para el contenedor del tema). */
export function profileSkin(p, cls = "s-") {
  const bg = p?.background ?? p?.profile?.background ?? "";
  const color = p?.color ?? p?.profile?.color ?? "";
  return `${cls}skin${bg ? ` ${cls}bg-${bg}` : ""}${color ? ` ${cls}color-${color}` : ""}`;
}

// ───────────────────────────── actividad ─────────────────────────────

/** Texto de una entrada de la actividad («Ana jugó 1 h a Hollow Knight»). */
export function activityText(item, selfId) {
  const d = item.data || {};
  const who = item.user ? (item.user.id === selfId ? "Tú" : item.user.name) : "";
  const s = who === "Tú";
  switch (item.kind) {
    case "played":
      return `${who} ${s ? "jugaste" : "jugó"} ${playtime((d.minutes || 0) * 60)} a ${d.game}`;
    case "achievement":
      return `${who} ${s ? "conseguiste" : "consiguió"} «${d.name}» en ${d.game}${d.rarity != null ? ` (${String(Math.round(d.rarity * 10) / 10).replace(".", ",")} %)` : ""}`;
    case "completed":
      return `${who} ${s ? "completaste" : "completó"} ${d.game} al 100 %`;
    case "badge": {
      const b = badgeInfo({ id: d.badge, tier: d.tier });
      return b ? `${who} ${s ? "conseguiste" : "consiguió"} la insignia ${b.name} (${b.tierName})` : "";
    }
    case "friend":
      return d.user ? (s ? `Ahora eres amigo de ${d.user.name}` : `${who} y ${d.user.name} ahora son amigos`) : `${who} tiene un amigo nuevo`;
    default:
      return "";
  }
}

// ───────────────────────────── vista de amigos ─────────────────────────────

const key = (el, k) => (el.dataset.key = k, el);

/**
 * Lista de amigos con solicitudes y actividad. Se pinta dentro de `root`.
 * `onProfile(id)`: abrir un perfil (el tema lo pinta con createProfileView).
 * @param {{ ejg: any, root: HTMLElement, focus?: any, cls?: string, labels?: Record<string, string>,
 *   onProfile?: (id: number) => void, onExit?: () => void, onChange?: () => void }} opts
 * @returns {{ nav: (a: string) => boolean, hints: () => [string, string][], reload: () => any, destroy: () => void }}
 */
export function createFriendsView({ ejg, root, focus, cls = "s-", labels = {}, onProfile = () => {}, onExit = () => {}, onChange = () => {} }) {
  const c = cls;
  const L = { title: "Amigos", friends: "Amigos", requests: "Solicitudes", activity: "Actividad", add: "Añadir amigo", ...labels };
  let tab = "friends";
  let feed = { items: null, loading: false, done: false };
  let message = "";
  let busy = false;
  const view = h("div", { class: `${c}view ${c}friends` });
  root.replaceChildren(view);

  const state = () => ejg.account.state || {};
  const social = () => state().social || {};
  const btn = (k, label, onclick, extra = "") => key(h("button", { class: `${c}btn ${extra}`.trim(), "data-focus": "", "data-nav": "", onclick }, label), k);

  function flash(text) {
    message = text;
    paint();
    setTimeout(() => {
      if (message === text) {
        message = "";
        paint();
      }
    }, 4000);
  }

  async function act(fn, okText) {
    if (busy) return;
    busy = true;
    try {
      await fn();
      if (okText) flash(okText);
    } catch (e) {
      flash(String(e?.message || e));
    } finally {
      busy = false;
      paint();
    }
  }

  async function add() {
    const q = await ejg.ui.keyboard({ title: L.add, placeholder: "Nombre de usuario o código de amigo", maxLength: 40 });
    if (q && q.trim()) act(() => ejg.friends.add(q.trim()), "Solicitud enviada.");
  }

  function cycleStatus() {
    const cur = state().status || "online";
    const i = STATUSES.findIndex((s) => s.value === cur);
    const next = STATUSES[(i + 1) % STATUSES.length].value;
    act(() => ejg.account.setStatus(next));
  }

  async function loadFeed(more = false) {
    if (feed.loading || (more && feed.done)) return;
    feed.loading = true;
    paint();
    try {
      const before = more && feed.items?.length ? feed.items[feed.items.length - 1].id : undefined;
      const r = await ejg.activity.feed(before);
      feed.items = more ? [...(feed.items || []), ...r.items] : r.items;
      feed.done = r.items.length < 30;
    } catch (e) {
      message = String(e?.message || e);
      feed.items = feed.items || [];
    } finally {
      feed.loading = false;
      paint();
    }
  }

  function row(f, extra) {
    const p = f.presence;
    const kind = presenceKind(p);
    return key(
      h(
        "button",
        { class: `${c}row is-${kind}`, "data-focus": "", "data-nav": "", onclick: () => onProfile(f.id) },
        avatar(f, { size: "m", cls: c, presence: p || { status: "offline" } }),
        h("span", { class: `${c}row-main` }, h("b", { class: `${c}row-name` }, f.name), h("small", { class: `${c}row-sub` }, extra ?? presenceText(p))),
        f.level ? levelBadge(f.level, c) : null,
      ),
      `u${f.id}`,
    );
  }

  function friendsTab(s) {
    const g = groupFriends(s.friends || []);
    const section = (title, list) =>
      list.length ? [h("div", { class: `${c}sub` }, `${title} (${list.length})`), h("div", { class: `${c}rows` }, ...list.map((f) => row(f)))] : [];
    const out = [
      h("div", { class: `${c}actions` }, btn("add", `+ ${L.add}`, add, "is-primary"), s.me ? h("span", { class: `${c}code` }, `Tu código de amigo: `, h("b", null, s.me.friendCode)) : null),
      ...section("Jugando", g.playing),
      ...section("En línea", g.online),
      ...section("Desconectados", g.offline),
    ];
    if (!(s.friends || []).length) out.push(h("div", { class: `${c}empty` }, "Aún no tienes amigos en ejGames. Añádelos con su nombre de usuario o su código de amigo."));
    return out;
  }

  function requestsTab(s) {
    const out = [];
    const inc = s.incoming || [];
    const outg = s.outgoing || [];
    const blocked = s.blocked || [];
    if (inc.length) {
      out.push(h("div", { class: `${c}sub` }, `Te quieren añadir (${inc.length})`));
      for (const r of inc) {
        out.push(
          h(
            "div",
            { class: `${c}req` },
            row(r, `Te envió una solicitud ${relative(r.at).toLowerCase()}`),
            btn(`a${r.id}`, "Aceptar", () => act(() => ejg.friends.accept(r.id), `Ahora eres amigo de ${r.name}.`), "is-primary"),
            btn(`d${r.id}`, "Rechazar", () => act(() => ejg.friends.decline(r.id))),
          ),
        );
      }
    }
    if (outg.length) {
      out.push(h("div", { class: `${c}sub` }, `Enviadas (${outg.length})`));
      for (const r of outg) out.push(h("div", { class: `${c}req` }, row(r, "Esperando respuesta"), btn(`c${r.id}`, "Cancelar", () => act(() => ejg.friends.remove(r.id)))));
    }
    if (blocked.length) {
      out.push(h("div", { class: `${c}sub` }, `Bloqueados (${blocked.length})`));
      for (const r of blocked) out.push(h("div", { class: `${c}req` }, row(r, "Bloqueado"), btn(`u${r.id}b`, "Desbloquear", () => act(() => ejg.friends.unblock(r.id)))));
    }
    if (!out.length) out.push(h("div", { class: `${c}empty` }, "No tienes solicitudes pendientes."));
    return out;
  }

  function activityTab(s) {
    if (feed.items === null) {
      loadFeed();
      return [h("div", { class: `${c}empty` }, "Cargando la actividad…")];
    }
    if (!feed.items.length) return [h("div", { class: `${c}empty` }, "Todavía no hay actividad. Aquí salen las partidas, los logros y los amigos nuevos.")];
    const selfId = s.me?.id;
    const items = feed.items.map((it) => {
      const icon = it.data?.iconUrl || it.data?.coverUrl;
      return key(
        h(
          "button",
          { class: `${c}act is-${it.kind}`, "data-focus": "", "data-nav": "", onclick: () => onProfile(it.user.id) },
          avatar(it.user, { size: "s", cls: c }),
          h("span", { class: `${c}act-main` }, h("span", { class: `${c}act-text` }, activityText(it, selfId)), h("small", null, relative(it.at))),
          icon ? h("img", { class: `${c}act-img`, src: icon, alt: "", loading: "lazy" }) : null,
        ),
        `f${it.id}`,
      );
    });
    return [h("div", { class: `${c}rows` }, ...items), feed.done ? null : btn("more", feed.loading ? "Cargando…" : "Cargar más", () => loadFeed(true), `${c}more`)];
  }

  function paint() {
    const had = focus?.current && view.contains(focus.current) ? focus.current.dataset.key : null;
    const st = state();
    const s = social();
    let body;
    if (!st.enabled) {
      body = [h("div", { class: `${c}empty` }, "Esta versión de ejGames no tiene cuentas.")];
    } else if (!st.linked || st.needsLogin) {
      body = [
        h(
          "div",
          { class: `${c}cta` },
          h("b", null, st.needsLogin ? "Tu sesión ha caducado" : "Juega con tus amigos"),
          h(
            "p",
            null,
            st.needsLogin
              ? "Vuelve a entrar para ver a tus amigos."
              : "Crear una cuenta de ejGames es opcional (sin ella todo funciona igual), pero con ella desbloqueas:",
          ),
          st.needsLogin
            ? null
            : h(
                "ul",
                { class: `${c}perks` },
                ...["Amigos y a qué juegan", "Avisos dentro del juego", "La actividad de tu gente", "Tu perfil: marcos, fondos y vitrinas", "Nivel e insignias", "Comentarios"].map((t) => h("li", null, t)),
              ),
          btn("login", st.needsLogin ? "Entrar" : "Crear cuenta o entrar", () => ejg.ui.open("account"), "is-primary"),
        ),
      ];
    } else {
      const me = s.me || { name: st.username, profile: {} };
      const nReq = (s.incoming || []).length;
      const tabBtn = (id, label) => key(h("button", { class: `${c}tab${tab === id ? " is-on" : ""}`, "data-focus": "", "data-nav": "", "aria-selected": tab === id, onclick: () => setTab(id) }, label), `tab-${id}`);
      body = [
        h(
          "div",
          { class: `${c}me` },
          key(h("button", { class: `${c}me-card`, "data-focus": "", "data-nav": "", onclick: () => onProfile(me.id) }, avatar({ ...me, avatarUrl: me.profile?.avatarUrl, frame: me.profile?.frame, name: me.profile?.name }, { size: "l", cls: c, presence: { status: st.status === "invisible" ? "offline" : st.status } }), h("span", { class: `${c}row-main` }, h("b", null, me.profile?.name || st.username), h("small", null, `@${st.username}`))), "me"),
          levelBadge(me.level || 0, c),
          btn("status", STATUS_LABEL[st.status] || "En línea", cycleStatus, `${c}status is-${st.status}`),
        ),
        h("div", { class: `${c}tabs`, role: "tablist" }, tabBtn("friends", `${L.friends} (${(s.friends || []).length})`), tabBtn("requests", nReq ? `${L.requests} (${nReq})` : L.requests), tabBtn("activity", L.activity)),
        message ? h("div", { class: `${c}msg` }, message) : null,
        st.offline ? h("div", { class: `${c}msg is-warn` }, "Sin conexión con ejGames: lo que ves puede no estar al día.") : null,
        h("div", { class: `${c}panel` }, ...(tab === "friends" ? friendsTab(s) : tab === "requests" ? requestsTab(s) : activityTab(s))),
      ];
    }
    view.replaceChildren(...body.filter(Boolean));
    if (focus) {
      const again = had && view.querySelector(`[data-key="${CSS.escape(had)}"]`);
      if (again) focus.focus(again, { noScroll: true, silent: true });
      else if (!focus.current || !focus.current.isConnected) focus.first(view);
    }
    onChange();
  }

  function setTab(t) {
    tab = t;
    if (t === "activity") feed = { items: null, loading: false, done: false };
    paint();
    const on = view.querySelector(`[data-key="tab-${t}"]`);
    if (on && focus) focus.focus(on, { silent: true, noScroll: true });
  }

  const off = ejg.account.onChange(() => paint());
  paint();
  if (focus) focus.first(view);

  const TABS = ["friends", "requests", "activity"];
  return {
    nav(a) {
      if (a === "lb" || a === "rb") {
        setTab(TABS[(TABS.indexOf(tab) + (a === "rb" ? 1 : TABS.length - 1)) % TABS.length]);
        return true;
      }
      if (a === "x" && state().linked) {
        add();
        return true;
      }
      if (a === "y" && state().linked) {
        cycleStatus();
        return true;
      }
      if (a === "back") {
        if (tab !== "friends") {
          setTab("friends");
          return true;
        }
        // onExit puede devolver false: «Atrás» sigue a quien contenga la vista.
        return onExit() !== false;
      }
      return false;
    },
    hints: () =>
      state().linked
        ? [
            ["accept", "Ver perfil"],
            ["x", "Añadir amigo"],
            ["y", "Estado"],
            ["lb", "Pestañas"],
            ["back", "Atrás"],
          ]
        : [
            ["accept", "Elegir"],
            ["back", "Atrás"],
          ],
    reload: () => ejg.friends.refresh?.(),
    destroy() {
      off?.();
      view.remove();
    },
  };
}

// ───────────────────────────── perfil ─────────────────────────────

function gameCard(g, c, { big = false } = {}) {
  if (!g) return null;
  const ach = g.ach && g.ach[1] ? g.ach : null;
  return h(
    "div",
    { class: `${c}game${big ? " is-big" : ""}` },
    g.coverUrl ? h("img", { class: `${c}game-cover`, src: g.coverUrl, alt: "", loading: "lazy" }) : h("span", { class: `${c}game-cover is-ph` }, initials(g.title)),
    h(
      "span",
      { class: `${c}game-main` },
      h("b", null, g.title),
      h("small", null, [g.minutes ? `${playtime(g.minutes * 60)} jugadas` : null, g.last ? `última vez ${relative(g.last).toLowerCase()}` : null].filter(Boolean).join(" · ")),
      ach ? h("span", { class: `${c}bar`, title: `${ach[0]} de ${ach[1]} logros` }, h("i", { style: { width: `${Math.round((ach[0] / ach[1]) * 100)}%` } })) : null,
      ach ? h("small", null, `${ach[0]} de ${ach[1]} logros`) : null,
    ),
  );
}

function showcase(s, p, c) {
  const games = p.summary?.games || [];
  const find = (title) => games.find((g) => g.title === title) || (title ? { title } : null);
  const box = (title, ...kids) => h("section", { class: `${c}showcase is-${s.type}` }, h("h3", { class: `${c}sc-title` }, title), ...kids);
  switch (s.type) {
    case "featured":
      return s.game ? box("Juego destacado", gameCard(find(s.game), c, { big: true })) : null;
    case "favorite":
      return s.game ? box("Juego favorito", gameCard(find(s.game), c)) : null;
    case "stats": {
      const st = p.summary?.stats || {};
      const cell = (n, l) => h("div", { class: `${c}stat` }, h("b", null, n.toLocaleString("es")), h("small", null, l));
      return box("Estadísticas", h("div", { class: `${c}stats` }, cell(games.length, "juegos jugados"), cell(Math.round((st.minutes || 0) / 60), "horas"), cell(st.achievements || 0, "logros"), cell(st.perfect || 0, "al 100 %")));
    }
    case "recent": {
      const recent = [...games].filter((g) => g.last).sort((a, b) => b.last - a.last).slice(0, 4);
      return recent.length ? box("Jugados hace poco", h("div", { class: `${c}games` }, ...recent.map((g) => gameCard(g, c)))) : null;
    }
    case "achievements": {
      const list = (p.activity || []).filter((a) => a.kind === "achievement").slice(0, 6);
      if (!list.length) return null;
      return box(
        "Logros recientes",
        h(
          "div",
          { class: `${c}achs` },
          ...list.map((a) =>
            h(
              "div",
              { class: `${c}ach`, title: `${a.data.name} · ${a.data.game}` },
              a.data.iconUrl ? h("img", { src: a.data.iconUrl, alt: "", loading: "lazy" }) : h("span", { class: `${c}ach-ph` }, "🏆"),
              h("span", null, h("b", null, a.data.name), h("small", null, `${a.data.game}${a.data.rarity != null ? ` · ${String(Math.round(a.data.rarity * 10) / 10).replace(".", ",")} %` : ""}`)),
            ),
          ),
        ),
      );
    }
    case "badges": {
      const list = (p.badges || []).map((b) => badgeEl(b, c, { big: true })).filter(Boolean);
      return list.length ? box("Insignias", h("div", { class: `${c}badges` }, ...list)) : null;
    }
    case "screenshots":
      return s.urls?.length ? box("Capturas", h("div", { class: `${c}shots n${s.urls.length}` }, ...s.urls.map((u) => h("img", { src: u, alt: "", loading: "lazy" })))) : null;
    case "text":
      return s.text ? box(s.title || "Sobre mí", h("p", { class: `${c}sc-text` }, s.text)) : null;
    default:
      return null;
  }
}

const DEFAULT_SHOWCASES = [{ type: "recent" }, { type: "stats" }, { type: "achievements" }, { type: "badges" }];

// Nombre del país (Windows no pinta los emojis de banderas).
let regions;
const country = (cc) => {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return "";
  try {
    regions ??= new Intl.DisplayNames(["es"], { type: "region" });
    return regions.of(cc) || cc;
  } catch {
    return cc;
  }
};

/**
 * El perfil de un usuario (o el tuyo, sin `userId`) al estilo Steam: fondo,
 * avatar con marco, nivel, insignias, vitrinas, actividad y comentarios.
 * Con `data` pinta ese perfil tal cual (vista previa del editor, sin acciones).
 * @param {{ ejg: any, root: HTMLElement, focus?: any, userId?: number | null, data?: any, cls?: string,
 *   labels?: Record<string, string>, onExit?: () => void, onChange?: () => void, onProfile?: (id: number) => void }} opts
 * @returns {{ nav: (a: string) => boolean, hints: () => [string, string][], reload: () => any, update: (d: any) => void, destroy: () => void }}
 */
export function createProfileView({ ejg, root, focus, userId = null, data = null, cls = "s-", labels = {}, onExit = () => {}, onChange = () => {}, onProfile = () => {} }) {
  const c = cls;
  const L = { edit: "Editar perfil", ...labels };
  const view = h("div", { class: `${c}view ${c}profile` });
  root.replaceChildren(view);
  let p = data;
  let comments = null;
  let message = "";
  let confirm = null;
  let destroyed = false;
  const preview = !!data;
  const myId = () => ejg?.account?.state?.social?.me?.id ?? ejg?.account?.state?.userId;
  const id = () => userId ?? myId();
  const btn = (k, label, onclick, extra = "") => key(h("button", { class: `${c}btn ${extra}`.trim(), "data-focus": "", "data-nav": "", onclick }, label), k);

  async function load() {
    if (preview) return paint();
    view.replaceChildren(h("div", { class: `${c}empty` }, "Cargando el perfil…"));
    try {
      p = await ejg.profiles.view(id());
      if (destroyed) return;
      paint();
      if (!p.private) loadComments();
    } catch (e) {
      view.replaceChildren(h("div", { class: `${c}empty` }, String(e?.message || e)), btn("back", "Volver", onExit));
      if (focus) focus.first(view);
      onChange();
    }
  }

  async function loadComments() {
    try {
      comments = (await ejg.comments.list(p.id)).items;
    } catch {
      comments = [];
    }
    if (!destroyed) paint();
  }

  async function act(fn, okText) {
    try {
      await fn();
      message = okText || "";
      confirm = null;
      await load();
    } catch (e) {
      message = String(e?.message || e);
      paint();
    }
  }

  async function writeComment() {
    const text = await ejg.ui.keyboard({ title: "Escribe un comentario", placeholder: `Para ${p.name}`, maxLength: 500 });
    if (!text || !text.trim()) return;
    try {
      await ejg.comments.post(p.id, text.trim());
      await loadComments();
    } catch (e) {
      message = String(e?.message || e);
      paint();
    }
  }

  function actions() {
    if (preview) return [];
    const r = p.relation;
    const out = [];
    if (r === "self") out.push(btn("edit", L.edit, () => ejg.account.openEditor(), "is-primary"));
    if (r === "none") out.push(btn("add", "Añadir amigo", () => act(() => ejg.friends.add(p.username), "Solicitud enviada."), "is-primary"));
    if (r === "outgoing") out.push(btn("cancel", "Cancelar solicitud", () => act(() => ejg.friends.remove(p.id))));
    if (r === "incoming") out.push(btn("accept", "Aceptar solicitud", () => act(() => ejg.friends.accept(p.id), `Ahora eres amigo de ${p.name}.`), "is-primary"), btn("decline", "Rechazar", () => act(() => ejg.friends.decline(p.id))));
    if (r === "friend")
      out.push(
        confirm === "remove" ? btn("remove", "¿Seguro? Quitar", () => act(() => ejg.friends.remove(p.id)), "is-danger") : btn("remove", "Quitar de amigos", () => ((confirm = "remove"), paint())),
      );
    if (r === "blocked") out.push(btn("unblock", "Desbloquear", () => act(() => ejg.friends.unblock(p.id))));
    else if (r !== "self")
      out.push(confirm === "block" ? btn("block", "¿Seguro? Bloquear", () => act(() => ejg.friends.block(p.id)), "is-danger") : btn("block", "Bloquear", () => ((confirm = "block"), paint())));
    return out;
  }

  function commentsBox() {
    if (preview || p.commentsOff) return null;
    const list = comments === null ? [h("div", { class: `${c}empty` }, "Cargando…")] : comments.length ? comments.map((cm) =>
      h(
        "div",
        { class: `${c}comment` },
        key(h("button", { class: `${c}comment-who`, "data-focus": "", "data-nav": "", onclick: () => onProfile(cm.author.id) }, avatar(cm.author, { size: "s", cls: c })), `cm${cm.id}`),
        h("div", { class: `${c}comment-main` }, h("div", { class: `${c}comment-head` }, h("b", null, cm.author.name), h("small", null, relative(cm.at))), h("p", null, cm.text)),
        cm.canDelete ? btn(`del${cm.id}`, "✕", () => act(async () => { await ejg.comments.remove(cm.id); await loadComments(); }), `${c}comment-del`) : null,
      ),
    ) : [h("div", { class: `${c}empty` }, "Aún no hay comentarios.")];
    return h("section", { class: `${c}showcase is-comments` }, h("h3", { class: `${c}sc-title` }, "Comentarios"), p.canComment ? btn("write", "Escribir un comentario", writeComment, `${c}write`) : null, ...list);
  }

  function paint() {
    if (!p) return;
    const had = focus?.current && view.contains(focus.current) ? focus.current.dataset.key : null;
    const prof = p.profile || {};
    const bgUrl = p.backgroundImageUrl || prof.backgroundImageUrl;
    view.className = `${c}view ${c}profile ${profileSkin(p, c)}${bgUrl ? " has-image" : ""}`;
    const bg = h("div", { class: `${c}backdrop`, style: bgUrl ? { backgroundImage: `url("${bgUrl}")` } : {} });
    const presence = p.presence;
    const featured = (p.badges || []).find((b) => b.id === prof.featuredBadge) || (p.badges || [])[0];
    const head = h(
      "header",
      { class: `${c}phead` },
      avatar(p, { size: "xl", cls: c }),
      h(
        "div",
        { class: `${c}pname` },
        h("h2", null, prof.name || p.name),
        h("div", { class: `${c}pmeta` }, [prof.realName, country(p.country)].filter(Boolean).join(" · ") || `@${p.username}`),
        presence ? h("div", { class: `${c}ppresence is-${presenceKind(presence)}` }, h("i", { class: `${c}dot` }), presenceText(presence)) : null,
        prof.bio ? h("p", { class: `${c}bio` }, prof.bio) : null,
      ),
      h(
        "div",
        { class: `${c}plevel` },
        h("div", null, "Nivel ", levelBadge(p.level || 0, c)),
        featured ? badgeEl(featured, c, { big: true }) : null,
        h("div", { class: `${c}pactions` }, ...actions()),
      ),
    );
    if (p.private) {
      view.replaceChildren(bg, h("div", { class: `${c}pwrap` }, head, h("div", { class: `${c}empty` }, "Este perfil es privado."), message ? h("div", { class: `${c}msg` }, message) : null));
    } else {
      // Sin vitrinas elegidas, las de siempre (las que no tengan datos no salen).
      const chosen = prof.showcases?.length ? prof.showcases : DEFAULT_SHOWCASES;
      const main = h("div", { class: `${c}pmain` }, ...chosen.map((s) => showcase(s, p, c)).filter(Boolean), commentsBox());
      const xp = p.xp || 0;
      const lv = p.level || 0;
      const pct = Math.max(0, Math.min(100, Math.round(((xp - xpFor(lv)) / Math.max(1, xpFor(lv + 1) - xpFor(lv))) * 100)));
      const side = h(
        "aside",
        { class: `${c}pside` },
        h("section", { class: `${c}showcase` }, h("h3", { class: `${c}sc-title` }, `Nivel ${lv}`), h("span", { class: `${c}bar` }, h("i", { style: { width: `${pct}%` } })), h("small", null, `${xp.toLocaleString("es")} XP · ${(xpFor(lv + 1) - xp).toLocaleString("es")} para el nivel ${lv + 1}`)),
        (p.badges || []).length ? h("section", { class: `${c}showcase` }, h("h3", { class: `${c}sc-title` }, `Insignias (${p.badges.length})`), h("div", { class: `${c}badges is-small` }, ...p.badges.map((b) => badgeEl(b, c)).filter(Boolean))) : null,
        h(
          "section",
          { class: `${c}showcase` },
          h("div", { class: `${c}facts` }, h("span", null, h("b", null, String(p.summary?.games?.length ?? 0)), " juegos"), h("span", null, h("b", null, String(p.friends ?? 0)), " amigos"), p.memberSince ? h("span", null, "Desde ", h("b", null, new Date(p.memberSince * 1000).toLocaleDateString("es", { month: "short", year: "numeric" }))) : null),
        ),
        (p.activity || []).length
          ? h(
              "section",
              { class: `${c}showcase` },
              h("h3", { class: `${c}sc-title` }, "Actividad reciente"),
              ...p.activity.slice(0, 6).map((a) => h("div", { class: `${c}mini-act` }, activityText({ ...a, user: { id: p.id, name: prof.name || p.name } }, myId()), h("small", null, relative(a.at)))),
            )
          : null,
      );
      view.replaceChildren(bg, h("div", { class: `${c}pwrap` }, head, message ? h("div", { class: `${c}msg` }, message) : null, h("div", { class: `${c}pbody` }, main, side)));
    }
    if (focus && !preview) {
      const again = had && view.querySelector(`[data-key="${CSS.escape(had)}"]`);
      if (again) focus.focus(again, { noScroll: true, silent: true });
      else if (!focus.current || !focus.current.isConnected || !view.contains(focus.current)) focus.first(view);
    }
    onChange();
  }

  load();
  return {
    nav(a) {
      if (a === "back") {
        if (confirm) {
          confirm = null;
          paint();
          return true;
        }
        return onExit() !== false;
      }
      if (a === "x" && p?.canComment && !preview) {
        writeComment();
        return true;
      }
      return false;
    },
    hints: () => [["accept", "Elegir"], ...(p?.canComment ? [["x", "Comentar"]] : []), ["back", "Atrás"]],
    reload: load,
    /** Cambia los datos de la vista previa. */
    update(next) {
      p = next;
      paint();
    },
    destroy() {
      destroyed = true;
      view.remove();
    },
  };
}

// ───────────────────────────── amigos + perfiles en un contenedor ─────────────────────────────

/**
 * Amigos y perfiles en un mismo sitio: la lista, y al elegir a alguien su
 * perfil (Atrás vuelve a la lista). Lo que monta cada tema en su capa.
 * `start`: "friends" | "profile" (con `userId`; sin él, el tuyo).
 * @param {{ ejg: any, root: HTMLElement, focus?: any, start?: string, userId?: number | null, cls?: string,
 *   labels?: Record<string, string>, onExit?: () => void, onChange?: () => void }} opts
 * @returns {{ nav: (a: string) => boolean, hints: () => [string, string][], open: (start: string, userId?: number | null) => void, readonly depth: number, destroy: () => void }}
 */
export function createSocialView({ ejg, root, focus, start = "friends", userId = null, cls = "s-", labels = {}, onExit = () => {}, onChange = () => {} }) {
  let stack = [];
  let view = null;
  const back = () => {
    if (stack.length > 1) {
      stack.pop();
      show();
      return true;
    }
    return onExit() !== false;
  };
  function show() {
    view?.destroy();
    const top = stack[stack.length - 1];
    const common = { ejg, root, focus, cls, onChange, onExit: back, onProfile: (id) => (stack.push({ kind: "profile", id }), show()) };
    view = top.kind === "friends" ? createFriendsView({ ...common, labels }) : createProfileView({ ...common, userId: top.id });
    onChange();
  }
  function open(s, id = null) {
    stack = [s === "profile" ? { kind: "profile", id } : { kind: "friends" }];
    show();
  }
  open(start, userId);
  return {
    nav: (a) => !!view?.nav(a),
    hints: () => view?.hints() || [],
    open,
    /** Pantallas abiertas (1: la de entrada; más: perfiles abiertos desde ella). */
    get depth() {
      return stack.length;
    },
    destroy() {
      view?.destroy();
      view = null;
    },
  };
}
