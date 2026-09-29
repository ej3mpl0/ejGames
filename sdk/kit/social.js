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

// Los de Steam por decenas (lvl_0, lvl_10… lvl_90).
const LEVEL_COLORS = ["#9b9b9b", "#c02942", "#d95b43", "#fecc23", "#467a3c", "#4e8ddb", "#7652c9", "#c252c9", "#542437", "#997c52"];
export const levelColor = (level) => (level >= 100 ? "#f5c518" : LEVEL_COLORS[Math.floor(level / 10) % 10]);

const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const BADGES = {
  collector: { name: "Coleccionista", unit: (n) => `${n} juegos en la biblioteca`, th: [5, 10, 25, 50, 100, 250], icon: I('<rect x="4" y="3" width="6" height="18" rx="1"/><rect x="11" y="3" width="4" height="18" rx="1"/><path d="m16 4 4 1-3 16-4-1Z"/>') },
  achiever: { name: "Cazalogros", unit: (n) => `${n} logros`, th: [10, 50, 100, 250, 500, 1000, 2500], icon: I('<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/>') },
  marathon: { name: "Maratón", unit: (n) => `${n} horas jugadas`, th: [10, 50, 100, 250, 500, 1000], icon: I('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>') },
  completionist: { name: "Completista", unit: (n) => `${n} ${n === 1 ? "juego" : "juegos"} al 100 %`, th: [1, 3, 5, 10, 25, 50], icon: I('<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7Z"/>') },
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

/** Los temas del perfil de Steam (el «color» de cada perfil). `accent`: el
 * color de sus botones y barras; `head`: el de las barras de las vitrinas. */
export const COLORS = [
  { id: "", name: "Por defecto", accent: "#3d5a80", head: "#2b2d44" },
  { id: "summer", name: "Verano", accent: "#91753d", head: "#46351f" },
  { id: "midnight", name: "Medianoche", accent: "#3a3875", head: "#22203d" },
  { id: "steel", name: "Acero", accent: "#56697f", head: "#373e4c" },
  { id: "cosmic", name: "Cósmico", accent: "#8c3b8f", head: "#39183d" },
  { id: "dark", name: "Modo oscuro", accent: "#505050", head: "#141414" },
  { id: "purple", name: "Violeta", accent: "#603689", head: "#4c2f69" },
  { id: "red", name: "Rojo apagado", accent: "#8a2a22", head: "#310909" },
  { id: "green", name: "Verde Steam", accent: "#5c6f2d", head: "#3e452c" },
  { id: "gold", name: "Oro", accent: "#a98444", head: "#b9914c" },
  { id: "pink", name: "Rosa y turquesa", accent: "#2a757a", head: "#2a757a" },
  { id: "teal", name: "Azul intenso", accent: "#235885", head: "#13395f" },
];

export const SHOWCASES = [
  { type: "featured", name: "Juego destacado" },
  { type: "favorite", name: "Juego favorito" },
  { type: "stats", name: "Estadísticas" },
  { type: "recent", name: "Jugados hace poco" },
  { type: "achievements", name: "Vitrina de logros" },
  { type: "badges", name: "Coleccionista de insignias" },
  { type: "screenshots", name: "Vitrina de capturas" },
  { type: "text", name: "Información personalizada" },
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
 * `tab`: la pestaña con la que empieza (friends | requests | activity).
 * @param {{ ejg: any, root: HTMLElement, focus?: any, tab?: string, cls?: string, labels?: Record<string, string>,
 *   onProfile?: (id: number) => void, onExit?: () => void, onChange?: () => void }} opts
 * @returns {{ nav: (a: string) => boolean, hints: () => [string, string][], reload: () => any, destroy: () => void }}
 */
export function createFriendsView({ ejg, root, focus, tab: startTab = "friends", cls = "s-", labels = {}, onProfile = () => {}, onExit = () => {}, onChange = () => {} }) {
  const c = cls;
  const L = { title: "Amigos", friends: "Amigos", requests: "Solicitudes", activity: "Actividad", add: "Añadir amigo", ...labels };
  let tab = ["friends", "requests", "activity"].includes(startTab) ? startTab : "friends";
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
                h("li", { class: `${c}soon` }, "Guardado en la nube", h("span", { class: `${c}soon-tag` }, "Próximamente")),
              ),
          btn("login", st.needsLogin ? "Entrar" : "Crear cuenta", () => (ejg.account.openLogin ? ejg.account.openLogin(st.needsLogin ? "login" : "register") : ejg.ui.open("account")), "is-primary"),
          st.needsLogin ? null : btn("signin", "Ya tengo cuenta", () => (ejg.account.openLogin ? ejg.account.openLogin("login") : ejg.ui.open("account"))),
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
        if (tab !== startTab && tab !== "friends") {
          setTab(startTab === "friends" ? "friends" : startTab);
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
// La página de perfil de Steam, pieza a pieza: cabecera (avatar, nombre,
// resumen, nivel, insignia destacada y acciones), columna izquierda (vitrinas,
// actividad reciente y comentarios) y columna derecha (estado, insignias,
// juegos, capturas y amigos). El tema del perfil (s-theme-*) pone los colores.

/** "46,3 h" / "1.083 h" como Steam. */
function hours(minutes = 0) {
  const h = minutes / 60;
  const n = h >= 100 ? Math.round(h) : Math.round(h * 10) / 10;
  return `${n.toLocaleString("es", { useGrouping: "always" })} h`;
}

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
/** "28 SEP" (o "28 SEP 2024" si no es de este año). */
function steamDate(ts) {
  const d = new Date(ts * 1000);
  const y = d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
}
/** "20 ABR 2023 a las 17:14" */
const steamStamp = (ts) => {
  const d = new Date(ts * 1000);
  return `${steamDate(ts)} a las ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const pct = (a, b) => (b ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);

/** Imagen de un juego: la cabecera ancha de Steam, o la portada, o sus iniciales. */
function capsule(g, c, cls = "") {
  const url = g?.headerUrl || g?.coverUrl;
  return url
    ? h("img", { class: `${c}cap ${cls}${g?.headerUrl ? "" : " is-cover"}`, src: url, alt: "", loading: "lazy", draggable: false })
    : h("span", { class: `${c}cap is-ph ${cls}` }, initials(g?.title));
}

/** Barra de logros de Steam: «Avance en los logros 10 de 53» + barra. */
function achProgress(ach, c) {
  if (!ach || !ach[1]) return null;
  return h(
    "div",
    { class: `${c}achsum` },
    h("span", { class: `${c}achsum-txt` }, h("span", { class: `${c}white` }, "Avance en los logros"), `  ${ach[0]} de ${ach[1]}`),
    h("span", { class: `${c}achbar` }, h("i", { style: `width: ${pct(ach[0], ach[1])}%` })),
  );
}

/** Iconos de los logros de un juego que salen en la actividad (y «+N»). */
function achIcons(p, g, c, max = 5) {
  const got = (p.activity || []).filter((a) => a.kind === "achievement" && a.data?.game === g.title && a.data.iconUrl);
  if (!got.length) return null;
  const shown = got.slice(0, max);
  const rest = Math.max(0, (g.ach?.[0] || got.length) - shown.length);
  return h(
    "div",
    { class: `${c}achicons` },
    ...shown.map((a) => h("img", { class: `${c}achicon`, src: a.data.iconUrl, alt: "", title: a.data.name, loading: "lazy" })),
    rest ? h("span", { class: `${c}achicon is-more` }, `+${rest}`) : null,
  );
}

/** Una fila de estadísticas de vitrina (valor grande y etiqueta gris). */
const statsRowBase = (c, ...cells) =>
  h("div", { class: `${c}statrow` }, ...cells.filter(Boolean).map(([v, l]) => h("div", { class: `${c}stat` }, h("div", { class: `${c}stat-v` }, typeof v === "number" ? v.toLocaleString("es", { useGrouping: "always" }) : v), h("div", { class: `${c}stat-l` }, l))));

/** Caja de vitrina de Steam: barra con degradado y el contenido debajo. */
const custom = (c, title, extra, ...kids) =>
  h("section", { class: `${c}custom${extra ? ` ${extra}` : ""}` }, h("div", { class: `${c}custom-head` }, title), h("div", { class: `${c}custom-block` }, ...kids));

/**
 * Una vitrina. Sin datos: las que se rellenan solas (logros, insignias,
 * jugados) lo dicen; las que elige el dueño (juego, capturas, texto) solo se
 * le enseñan a él, con lo que le falta, como los huecos vacíos de Steam.
 */
function showcase(s, p, c, { own = false, wrap = null, tx = (t) => t } = {}) {
  // `wrap(título, clase, ...hijos)`: la caja de cada diseño (sin él, la de Steam).
  const box = (title, extra, ...kids) => (wrap ? wrap(tx(title), extra, ...kids) : custom(c, tx(title), extra, ...kids));
  const statsRow = (cc, ...cells) => statsRowBase(cc, ...cells.map((x) => (x ? [x[0], tx(x[1])] : x)));
  const empty = (title, text, extra = "") => box(title, `${c}sc-empty ${extra}`.trim(), h("div", { class: `${c}cbg ${c}sc-none` }, tx(text)));
  const games = p.summary?.games || [];
  const find = (title) => games.find((g) => g.title === title) || (title ? { title } : null);
  const st = p.summary?.stats || {};
  switch (s.type) {
    case "featured": {
      const g = find(s.game);
      if (!g) return own ? empty("Juego destacado", "Elige el juego en Editar perfil → Vitrinas destacadas.") : null;
      return box(
        "Juego destacado",
        `${c}sc-featured`,
        h(
          "div",
          { class: `${c}cbg` },
          capsule(g, c, `${c}cap-big`),
          h("div", { class: `${c}sc-title` }, g.title),
          statsRow(c, g.minutes ? [hours(g.minutes).replace(" h", ""), "Horas jugadas"] : null, g.ach?.[1] ? [`${g.ach[0]}/${g.ach[1]}`, "Logros"] : null, g.last ? [steamDate(g.last), "Última sesión"] : null),
        ),
        g.ach?.[1] ? h("div", { class: `${c}gstats` }, achProgress(g.ach, c), achIcons(p, g, c, 7)) : null,
      );
    }
    case "favorite": {
      const g = find(s.game);
      if (!g) return own ? empty("Juego favorito", "Elige el juego en Editar perfil → Vitrinas destacadas.") : null;
      return box(
        "Juego favorito",
        `${c}sc-favorite`,
        h(
          "div",
          { class: `${c}cbg` },
          h("div", { class: `${c}favgame` }, capsule(g, c, `${c}cap-184`), h("div", { class: `${c}sc-title` }, g.title), statsRow(c, g.minutes ? [hours(g.minutes).replace(" h", ""), "Horas jugadas"] : null)),
        ),
        g.ach?.[1] ? h("div", { class: `${c}gstats` }, achProgress(g.ach, c), achIcons(p, g, c)) : null,
      );
    }
    case "stats":
      return box(
        "Estadísticas",
        `${c}sc-stats`,
        h("div", { class: `${c}cbg` }, statsRow(c, [st.library || games.length, "Juegos"], [Math.round((st.minutes || 0) / 60), "Horas jugadas"], [st.achievements || 0, "Logros"], [st.perfect || 0, "Juegos perfectos"])),
      );
    case "recent": {
      const recent = [...games].filter((g) => g.last).sort((a, b) => b.last - a.last).slice(0, 4);
      if (!recent.length) return empty("Jugados hace poco", "Todavía no hay partidas.");
      return box(
        "Jugados hace poco",
        `${c}sc-collector`,
        h("div", { class: `${c}cbg` }, h("div", { class: `${c}collector` }, ...recent.map((g) => h("div", { class: `${c}collector-game`, title: `${g.title} · ${hours(g.minutes)}` }, capsule(g, c))))),
      );
    }
    case "achievements": {
      const list = (p.activity || []).filter((a) => a.kind === "achievement").slice(0, 7);
      const withAch = games.filter((g) => g.ach?.[1]);

      const avg = withAch.length ? Math.round(withAch.reduce((n, g) => n + g.ach[0] / g.ach[1], 0) / withAch.length * 100) : 0;
      return box(
        "Vitrina de logros",
        `${c}sc-ach`,
        list.length
          ? h(
              "div",
              { class: `${c}cbg ${c}achgrid` },
              ...list.map((a) =>
                a.data.iconUrl
                  ? h("img", { class: `${c}achbig`, src: a.data.iconUrl, alt: "", loading: "lazy", title: `${a.data.name}\n${a.data.game}${a.data.rarity != null ? ` · ${String(Math.round(a.data.rarity * 10) / 10).replace(".", ",")} %` : ""}` })
                  : h("span", { class: `${c}achbig is-ph`, title: `${a.data.name}\n${a.data.game}` }, "🏆"),
              ),
            )
          : h("div", { class: `${c}cbg ${c}sc-none` }, tx("Los logros que consigas saldrán aquí.")),
        h("div", { class: `${c}cbg` }, statsRow(c, [st.achievements || 0, "Logros"], [st.perfect || 0, "Juegos perfectos"], [`${avg} %`, "Tasa media de finalización"])),
      );
    }
    case "badges": {
      const list = (p.badges || []).map((b) => badgeEl(b, c)).filter(Boolean);
      if (!list.length) return empty("Coleccionista de insignias", "Todavía no hay insignias: se consiguen jugando (horas, logros, juegos al 100 %…).");
      return box("Coleccionista de insignias", `${c}sc-badges`, h("div", { class: `${c}cbg` }, statsRow(c, [list.length, "Insignias conseguidas"], [p.xp || 0, "EXP"]), h("div", { class: `${c}badgerow` }, ...list)));
    }
    case "screenshots": {
      const urls = s.urls || [];
      if (!urls.length) return own ? empty("Vitrina de capturas", "Añade hasta 4 capturas en Editar perfil → Vitrinas destacadas.") : null;
      const [first, ...rest] = urls;
      return box(
        "Vitrina de capturas",
        `${c}sc-shots`,
        h(
          "div",
          { class: `${c}shots${rest.length ? "" : " is-single"}` },
          h("div", { class: `${c}shot-main` }, h("img", { src: first, alt: "", loading: "lazy" })),
          rest.length ? h("div", { class: `${c}shot-side` }, ...rest.slice(0, 3).map((u) => h("img", { src: u, alt: "", loading: "lazy" })), p.summary?.stats?.shots ? h("div", { class: `${c}shot-count` }, `${p.summary.stats.shots} capturas`) : null) : null,
        ),
      );
    }
    case "text":
      if (!s.text) return own ? empty(s.title || "Información personalizada", "Escribe el texto en Editar perfil → Vitrinas destacadas.") : null;
      return box(s.title || "Información personalizada", `${c}sc-text`, h("div", { class: `${c}sc-textbody` }, s.text));
    default:
      return null;
  }
}

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

/** Diseños de perfil de cada tema: steam | ps5 | xbox | switch | cinema | retro. */
export const PROFILE_LAYOUTS = ["steam", "ps5", "xbox", "switch", "cinema", "retro"];

// Retro habla en inglés arcade: su fuente pixelada no trae mayúsculas con tilde.
const RETRO_TX = {
  "Juego destacado": "FEATURED GAME",
  "Juego favorito": "FAVORITE GAME",
  "Estadísticas": "STATS",
  "Jugados hace poco": "RECENTLY PLAYED",
  "Vitrina de logros": "ACHIEVEMENTS",
  "Coleccionista de insignias": "BADGES",
  "Vitrina de capturas": "SCREENSHOTS",
  "Información personalizada": "INFO",
  "Horas jugadas": "HOURS",
  "Logros": "ACHIEVEMENTS",
  "Última sesión": "LAST PLAYED",
  "Juegos": "GAMES",
  "Juegos perfectos": "PERFECT",
  "Tasa media de finalización": "AVG COMPLETION",
  "Insignias conseguidas": "BADGES",
  "Editar perfil": "EDIT PROFILE",
  "Añadir amigo": "ADD FRIEND",
  "Cancelar solicitud": "CANCEL REQUEST",
  "Aceptar solicitud": "ACCEPT",
  "Ignorar": "IGNORE",
  "Desbloquear": "UNBLOCK",
  "Más ▾": "MORE ▾",
  "Eliminar de amigos": "REMOVE FRIEND",
  "¿Seguro? Eliminar de amigos": "SURE? REMOVE",
  "Bloquear toda comunicación": "BLOCK",
  "¿Seguro? Bloquear toda comunicación": "SURE? BLOCK",
  "Comentarios": "GUESTBOOK",
  "Añadir un comentario": "WRITE A MESSAGE...",
  "Publicar comentario": "POST",
  "Eliminar": "DELETE",
  "Todavía no hay partidas.": "NO GAMES YET",
  "Todavía no hay amigos.": "NO FRIENDS YET",
  "Los logros que consigas saldrán aquí.": "NO ACHIEVEMENTS YET",
  "Todavía no hay insignias: se consiguen jugando (horas, logros, juegos al 100 %…).": "NO BADGES YET",
  "Elige el juego en Editar perfil → Vitrinas destacadas.": "PICK A GAME IN EDIT PROFILE",
  "Añade hasta 4 capturas en Editar perfil → Vitrinas destacadas.": "ADD SCREENSHOTS IN EDIT PROFILE",
  "Escribe el texto en Editar perfil → Vitrinas destacadas.": "WRITE IT IN EDIT PROFILE",
  "Este perfil es privado.": "PRIVATE PROFILE",
  "Sobre mí": "ABOUT",
};
const RETRO_BADGES = { collector: "COLLECTOR", achiever: "ACHIEVER", marathon: "MARATHON", completionist: "COMPLETIONIST", explorer: "EXPLORER", veteran: "VETERAN", social: "SOCIAL" };

const STATUS_HEAD = { playing: "Actualmente jugando", online: "Actualmente en línea", away: "Actualmente ausente", offline: "Sin conexión" };

/**
 * El perfil de un usuario (o el tuyo, sin `userId`). `layout` elige el diseño
 * de cada tema (steam, ps5, xbox, switch, cinema, retro; `tab` es la pestaña
 * con la que empieza en los que tienen pestañas). Con `data` pinta ese perfil
 * tal cual (vista previa, sin acciones).
 * @param {{ ejg: any, root: HTMLElement, focus?: any, userId?: number | null, data?: any, layout?: string, tab?: string, cls?: string,
 *   labels?: Record<string, string>, onExit?: () => void, onChange?: () => void, onProfile?: (id: number) => void,
 *   onBadges?: ((id: number) => void) | null }} opts
 * @returns {{ nav: (a: string) => boolean, hints: () => [string, string][], reload: () => any, update: (d: any) => void, destroy: () => void }}
 */
export function createProfileView({
  ejg,
  root,
  focus,
  userId = null,
  data = null,
  layout: wanted = "steam",
  tab: startTab = "profile",
  cls = "s-",
  labels = {},
  onExit = () => {},
  onChange = () => {},
  onProfile = () => {},
  onBadges = null,
}) {
  const c = cls;
  const layout = PROFILE_LAYOUTS.includes(wanted) ? wanted : "steam";
  const tx = (t) => (layout === "retro" ? (RETRO_TX[t] ?? t) : t);
  const L = { edit: tx("Editar perfil"), ...labels };
  let tab = startTab;
  const view = h("div", { class: `${c}view ${c}profile` });
  root.replaceChildren(view);
  let p = data;
  let comments = null;
  let message = "";
  let confirm = null;
  let menu = false;
  let more = false;
  let destroyed = false;
  const preview = !!data;
  const myId = () => ejg?.account?.state?.social?.me?.id ?? ejg?.account?.state?.userId;
  const id = () => userId ?? myId();
  const btn = (k, label, onclick, extra = "") => key(h("button", { class: `${c}pbtn ${extra}`.trim(), "data-focus": "", "data-nav": "", onclick }, h("span", null, label)), k);

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

  /** Vuelve a pedir el perfil sin «Cargando…» y sin mover el scroll. */
  async function refresh() {
    try {
      const next = await ejg.profiles.view(id());
      if (destroyed) return;
      let sc = view;
      while (sc && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement;
      const top = sc?.scrollTop ?? 0;
      p = next;
      paint();
      if (sc) sc.scrollTop = top;
    } catch {
      /* se queda el de antes */
    }
  }

  // El tuyo se repinta solo al guardar en el editor, subir de nivel o ganar una insignia.
  const mine = () => {
    const me = ejg?.account?.state?.social?.me;
    return me ? JSON.stringify([me.profile, me.level, me.xp, me.badges]) : "";
  };
  let seen = mine();
  const off = preview
    ? null
    : ejg?.account?.onChange?.(() => {
        const now = mine();
        if (now === seen) return;
        seen = now;
        if (p && p.relation === "self") refresh();
      });

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
      menu = false;
      await refresh();
    } catch (e) {
      message = String(e?.message || e);
      paint();
    }
  }

  async function writeComment() {
    const text = await ejg.ui.keyboard({ title: "Añadir un comentario", placeholder: `Para ${p.profile?.name || p.name}`, maxLength: 500, multiline: true });
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
    const name = p.profile?.name || p.name;
    const out = [];
    if (r === "self") out.push(btn("edit", L.edit, () => ejg.account.openEditor()));
    if (r === "none") out.push(btn("add", tx("Añadir amigo"), () => act(() => ejg.friends.add(p.username), "Solicitud enviada.")));
    if (r === "outgoing") out.push(btn("cancel", tx("Cancelar solicitud"), () => act(() => ejg.friends.remove(p.id))));
    if (r === "incoming") out.push(btn("accept", tx("Aceptar solicitud"), () => act(() => ejg.friends.accept(p.id), `Ahora eres amigo de ${name}.`)), btn("decline", tx("Ignorar"), () => act(() => ejg.friends.decline(p.id))));
    if (r === "blocked") out.push(btn("unblock", tx("Desbloquear"), () => act(() => ejg.friends.unblock(p.id))));
    if (r === "friend" || r === "none" || r === "outgoing" || r === "incoming") {
      // «Más ▾» con lo que Steam esconde en su menú.
      out.push(btn("more", tx("Más ▾"), () => ((menu = !menu), (confirm = null), paint(), menu && focusKey(r === "friend" ? "remove" : "block")), `${c}pbtn-more${menu ? " is-open" : ""}`));
    }
    return out;
  }

  function moreMenu() {
    if (!menu || preview) return null;
    const r = p.relation;
    const item = (k, label, onclick, danger) => key(h("button", { class: `${c}pmenu-item${danger ? " is-danger" : ""}`, "data-focus": "", "data-nav": "", onclick }, label), k);
    return h(
      "div",
      { class: `${c}pmenu` },
      r === "friend"
        ? confirm === "remove"
          ? item("remove", tx("¿Seguro? Eliminar de amigos"), () => act(() => ejg.friends.remove(p.id)), true)
          : item("remove", tx("Eliminar de amigos"), () => ((confirm = "remove"), paint(), focusKey("remove")))
        : null,
      confirm === "block" ? item("block", tx("¿Seguro? Bloquear toda comunicación"), () => act(() => ejg.friends.block(p.id)), true) : item("block", tx("Bloquear toda comunicación"), () => ((confirm = "block"), paint(), focusKey("block"))),
    );
  }

  function focusKey(k) {
    const el = view.querySelector(`[data-key="${CSS.escape(k)}"]`);
    if (el && focus) focus.focus(el, { noScroll: true, silent: true });
  }

  function commentsArea() {
    if (preview || p.commentsOff) return null;
    const me = ejg?.account?.state?.social?.me;
    const list =
      comments === null
        ? [h("div", { class: `${c}cthread-empty` }, "Cargando…")]
        : comments.map((cm) =>
            h(
              "div",
              { class: `${c}comment` },
              key(h("button", { class: `${c}comment-av`, "data-focus": "", "data-nav": "", onclick: () => onProfile(cm.author.id), title: cm.author.name }, avatar(cm.author, { size: "s", cls: c })), `cm${cm.id}`),
              h(
                "div",
                { class: `${c}comment-main` },
                h(
                  "div",
                  { class: `${c}comment-author` },
                  h("span", { class: `${c}comment-name` }, cm.author.name),
                  h("span", { class: `${c}comment-time`, title: new Date(cm.at * 1000).toLocaleString("es") }, steamStamp(cm.at)),
                  cm.canDelete ? key(h("button", { class: `${c}comment-del`, "data-focus": "", "data-nav": "", onclick: () => act(async () => { await ejg.comments.remove(cm.id); await loadComments(); }), title: tx("Eliminar") }, tx("Eliminar")), `del${cm.id}`) : null,
                ),
                h("div", { class: `${c}comment-text` }, cm.text),
              ),
            ),
          );
    return h(
      "div",
      { class: `${c}cthread` },
      h("div", { class: `${c}cthread-head` }, h("span", null, tx("Comentarios")), comments?.length ? h("span", { class: `${c}cthread-count` }, `${comments.length}${comments.length >= 20 ? "+" : ""}`) : null),
      p.canComment
        ? h(
            "div",
            { class: `${c}centry` },
            me ? avatar({ ...me, avatarUrl: me.profile?.avatarUrl, frame: "", name: me.profile?.name || me.name }, { size: "s", cls: c }) : null,
            key(h("button", { class: `${c}centry-box`, "data-focus": "", "data-nav": "", onclick: writeComment }, tx("Añadir un comentario")), "write"),
            key(h("button", { class: `${c}cbtn`, "data-focus": "", "data-nav": "", onclick: writeComment }, h("span", null, tx("Publicar comentario"))), "post"),
          )
        : null,
      h("div", { class: `${c}comments` }, ...list),
    );
  }

  function recentActivity() {
    const games = [...(p.summary?.games || [])].filter((g) => g.last).sort((a, b) => b.last - a.last).slice(0, 3);
    if (!games.length) return null;
    const recent = p.summary?.stats?.recent;
    return h(
      "section",
      { class: `${c}custom ${c}recent` },
      h("div", { class: `${c}custom-head ${c}recent-head` }, h("div", null, "Actividad reciente"), recent != null ? h("div", { class: `${c}recent-time` }, `${hours(recent)} en estas 2 semanas`) : null),
      h(
        "div",
        { class: `${c}custom-block` },
        ...games.map((g) =>
          h(
            "div",
            { class: `${c}rgame` },
            h(
              "div",
              { class: `${c}rgame-info` },
              capsule(g, c, `${c}cap-184`),
              h("div", { class: `${c}rgame-details` }, `${hours(g.minutes)} registradas`, h("br"), `última sesión: ${steamDate(g.last)}`),
              h("div", { class: `${c}rgame-name` }, g.title),
            ),
            g.ach?.[1] ? h("div", { class: `${c}gstats` }, achProgress(g.ach, c), achIcons(p, g, c)) : null,
          ),
        ),
      ),
    );
  }

  function rightCol() {
    const kind = p.presence ? presenceKind(p.presence) : null;
    const badges = [...(p.badges || [])].sort((a, b) => (b.tier || 0) - (a.tier || 0));
    const st = p.summary?.stats || {};
    const count = (label, n, ...preview) => h("div", { class: `${c}count` }, h("div", { class: `${c}count-link` }, h("span", null, label), "  ", h("span", { class: `${c}count-total` }, n == null ? " " : n.toLocaleString("es", { useGrouping: "always" }))), preview.length ? h("div", { class: `${c}count-preview` }, ...preview) : null);
    const friends = p.topFriends || [];
    return h(
      "div",
      { class: `${c}rc` },
      kind
        ? h(
            "div",
            { class: `${c}ingame is-${kind}` },
            h("div", { class: `${c}ingame-head` }, STATUS_HEAD[kind]),
            kind === "playing" ? h("div", { class: `${c}ingame-name` }, p.presence.game) : null,
            kind === "offline" && p.presence.lastSeen ? h("div", { class: `${c}ingame-last` }, `Última conexión ${relative(p.presence.lastSeen).toLowerCase()}`) : null,
          )
        : null,
      badges.length
        ? h(
            "div",
            { class: `${c}rblock` },
            onBadges && !preview
              ? key(h("button", { class: `${c}count-btn`, "data-focus": "", "data-nav": "", onclick: () => onBadges(p.id) }, count("Insignias", badges.length, h("div", { class: `${c}rbadges` }, ...badges.slice(0, 4).map((b) => badgeEl(b, c))))), "badges")
              : count("Insignias", badges.length, h("div", { class: `${c}rbadges` }, ...badges.slice(0, 4).map((b) => badgeEl(b, c)))),
          )
        : null,
      h(
        "div",
        { class: `${c}rblock` },
        count("Juegos", st.library ?? p.summary?.games?.length ?? 0),
        st.shots ? count("Capturas", st.shots) : null,
        p.memberSince ? h("div", { class: `${c}count` }, h("div", { class: `${c}count-link` }, h("span", null, "Miembro desde"), "  ", h("span", { class: `${c}count-since` }, steamDate(p.memberSince)))) : null,
      ),
      h(
        "div",
        { class: `${c}rblock` },
        count(
          "Amigos",
          p.friends ?? 0,
          ...friends.map((f) => {
            const k = f.presence ? presenceKind(f.presence) : "offline";
            return key(
              h(
                "button",
                { class: `${c}fblock is-${k}`, "data-focus": "", "data-nav": "", onclick: () => onProfile(f.id), disabled: preview },
                avatar(f, { size: "fb", cls: c }),
                h("span", { class: `${c}fblock-main` }, h("span", { class: `${c}fblock-name` }, f.name), h("span", { class: `${c}fblock-sub` }, k === "playing" ? ["jugando", h("br"), f.presence.game] : k === "offline" ? "Sin conexión" : k === "away" ? "Ausente" : "En línea")),
                levelBadge(f.level || 0, c),
              ),
              `tf${f.id}`,
            );
          }),
        ),
      ),
    );
  }

  function header() {
    const prof = p.profile || {};
    const kind = p.presence ? presenceKind(p.presence) : "offline";
    const badges = p.badges || [];
    const featured = badges.find((b) => b.id === prof.featuredBadge) || null;
    const fav = featured ? badgeInfo(featured) : null;
    const bio = prof.bio || "";
    const long = bio.length > 190 || bio.split("\n").length > 3;
    const place = country(p.country || prof.country);
    return h(
      "div",
      { class: `${c}ph-bg` },
      h(
        "div",
        { class: `${c}ph-tex` },
        h(
          "div",
          { class: `${c}ph` },
          h("div", { class: `${c}pavatar is-${kind === "away" ? "online" : kind}` }, avatar(p, { size: "xl", cls: c })),
          h(
            "div",
            { class: `${c}ph-center` },
            h(
              "div",
              { class: `${c}persona` },
              h("div", { class: `${c}persona-name` }, prof.name || p.name),
              prof.realName || place ? h("div", { class: `${c}realname` }, prof.realName ? h("bdi", null, prof.realName) : null, place ? h("div", { class: `${c}location` }, place) : null) : null,
            ),
            bio
              ? h(
                  "div",
                  { class: `${c}summary-wrap` },
                  h("div", { class: `${c}summary${more ? " is-open" : ""}` }, bio),
                  long ? key(h("button", { class: `${c}summary-more ${c}white`, "data-focus": "", "data-nav": "", onclick: () => ((more = !more), paint()) }, more ? "Ver menos" : "Ver más información"), "more-info") : null,
                )
              : preview
                ? h("div", { class: `${c}summary is-empty` }, "No hay información.")
                : null,
          ),
          h(
            "div",
            { class: `${c}ph-badgeinfo` },
            onBadges && !preview
              ? key(h("button", { class: `${c}plevel is-link`, "data-focus": "", "data-nav": "", onclick: () => onBadges(p.id), title: "Insignias" }, "Nivel ", levelBadge(p.level || 0, c)), "level")
              : h("div", { class: `${c}plevel` }, "Nivel ", levelBadge(p.level || 0, c)),
            fav
              ? h(
                  "div",
                  { class: `${c}favbadge` },
                  h("span", { class: `${c}favbadge-ico` }, badgeEl(featured, c)),
                  h("span", { class: `${c}favbadge-desc` }, h("span", { class: `${c}favbadge-name` }, `${fav.name} - ${fav.tierName}`), h("span", { class: `${c}favbadge-xp` }, `${(fav.tier * 50).toLocaleString("es")} EXP`)),
                )
              : null,
            h("div", { class: `${c}ph-actions` }, ...actions()),
            moreMenu(),
          ),
        ),
      ),
    );
  }

  // ───────── los perfiles de cada tema ─────────
  // Steam es la página de Steam (header/rightCol/recentActivity de arriba). Los
  // demás comparten datos, acciones, vitrinas y comentarios con sus piezas
  // `lx-…`, y cada uno pone su maqueta: PS5 (portada, avatar redondo y
  // pestañas), Xbox (tarjeta del gamertag con gamerscore y pivotes), Switch
  // (página de usuario con menú lateral), Cine (portada de plataforma de cine
  // con filas) y Retro (tarjeta PLAYER 1 con HI-SCORES, en inglés arcade).
  const TABS = {
    ps5: [["profile", "Perfil"], ["games", "Juegos"], ["badges", "Insignias"], ["friends", "Amigos"]],
    xbox: [["profile", "Destacado"], ["games", "Juegos"], ["badges", "Insignias"], ["friends", "Amigos"]],
    switch: [["profile", "Perfil"], ["games", "Actividad de juego"], ["badges", "Insignias"], ["friends", "Amigos"]],
  }[layout];
  const TAB_ICONS = {
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    games: '<rect x="3" y="7" width="18" height="11" rx="5"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="16" cy="11.5" r="1"/><circle cx="17.5" cy="14" r="1"/>',
    badges: '<circle cx="12" cy="9" r="6"/><path d="m9 14-2 7 5-3 5 3-2-7"/>',
    friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 5"/>',
  };
  const num = (n) => (n || 0).toLocaleString("es", { useGrouping: "always" });

  function facts() {
    const prof = p.profile || {};
    const games = p.summary?.games || [];
    const st = p.summary?.stats || {};
    const lv = p.level || 0;
    const xp = p.xp || 0;
    const recent = [...games].filter((g) => g.last).sort((a, b) => b.last - a.last);
    return {
      prof,
      games,
      st,
      lv,
      xp,
      recent,
      all: [...recent, ...[...games].filter((g) => !g.last).sort((a, b) => (b.minutes || 0) - (a.minutes || 0))],
      top: [...games].sort((a, b) => (b.minutes || 0) - (a.minutes || 0)),
      name: prof.name || p.name,
      real: prof.realName || "",
      place: country(p.country || prof.country),
      bio: prof.bio || "",
      kind: p.presence ? presenceKind(p.presence) : null,
      lvPct: pct(xp - xpFor(lv), xpFor(lv + 1) - xpFor(lv)),
      toNext: Math.max(0, xpFor(lv + 1) - xp),
      own: preview || p.relation === "self",
      nGames: st.library ?? games.length,
      since: p.memberSince ? new Date(p.memberSince * 1000).getFullYear() : null,
    };
  }

  const retroPresence = (pr) => {
    const k = presenceKind(pr);
    return k === "playing" ? `PLAYING ${pr.game}` : k === "online" ? "ONLINE" : k === "away" ? "AWAY" : "OFFLINE";
  };
  const presenceLine = (f) =>
    f.kind ? h("div", { class: `${c}lx-presence is-${f.kind}` }, h("i", { class: `${c}lx-dot` }), layout === "retro" ? retroPresence(p.presence) : presenceText(p.presence)) : null;

  const lxSection = (title, extra, ...kids) =>
    h("section", { class: `${c}lx-sec${extra ? ` ${extra}` : ""}` }, h("h3", { class: `${c}lx-title` }, title), h("div", { class: `${c}lx-body` }, ...kids));
  const lxShowcases = () =>
    (p.profile?.showcases || []).map((s) => showcase(s, p, c, { own: preview || p.relation === "self", wrap: lxSection, tx })).filter(Boolean);
  const lxActions = () => h("div", { class: `${c}lx-actwrap` }, h("div", { class: `${c}lx-actions` }, ...actions()), moreMenu());
  const backdropEl = () => {
    const url = p.backgroundImageUrl || p.profile?.backgroundImageUrl;
    return h("div", { class: `${c}backdrop`, style: url ? `background-image: url("${url}")` : "" });
  };

  /** Nivel con su barra (lleva a las insignias). */
  function levelChip(f) {
    const inner = [
      h("span", { class: `${c}lx-level-ico`, html: I('<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7Z"/>') }),
      h("span", { class: `${c}lx-level-main` }, h("b", null, layout === "retro" ? `LV ${String(f.lv).padStart(2, "0")}` : `Nivel ${f.lv}`), h("span", { class: `${c}lx-bar` }, h("i", { style: `width: ${f.lvPct}%` })), h("small", null, layout === "retro" ? `NEXT ${num(f.toNext)} EXP` : `${num(f.toNext)} EXP para el nivel ${f.lv + 1}`)),
    ];
    return preview ? h("div", { class: `${c}lx-level` }, ...inner) : key(h("button", { class: `${c}lx-level`, "data-focus": "", "data-nav": "", onclick: goBadges }, ...inner), "level");
  }

  function lxGames(list, { wide = false, rows = false, max = 30 } = {}) {
    if (!list.length) return h("div", { class: `${c}lx-none` }, tx("Todavía no hay partidas."));
    return h(
      "div",
      { class: `${c}lx-games${rows ? " is-rows" : ""}${wide ? " is-wide" : ""}` },
      ...list.slice(0, max).map((g) => {
        // Ancha: la cabecera del juego; cuadrada (y las filas de Switch, con su icono): la portada.
        const square = !wide && (!rows || layout === "switch");
        const url = square ? g.coverUrl || g.headerUrl : g.headerUrl || g.coverUrl;
        const ach = g.ach?.[1] ? g.ach : null;
        return h(
          "div",
          { class: `${c}lx-game`, title: g.title },
          url ? h("img", { class: `${c}lx-game-img`, src: url, alt: "", loading: "lazy", draggable: false }) : h("span", { class: `${c}lx-game-img is-ph` }, initials(g.title)),
          h(
            "div",
            { class: `${c}lx-game-main` },
            h("b", null, g.title),
            rows
              ? [
                  h("small", null, g.minutes ? `Jugado durante ${hours(g.minutes)} o más` : "Jugado menos de una hora"),
                  g.last ? h("small", null, `Última vez: ${relative(g.last).toLowerCase()}`) : null,
                ]
              : h("small", null, [g.minutes ? hours(g.minutes) : null, g.last ? steamDate(g.last) : null].filter(Boolean).join(" · ")),
            ach ? h("span", { class: `${c}lx-bar`, title: `${ach[0]} de ${ach[1]} logros` }, h("i", { style: `width: ${pct(ach[0], ach[1])}%` })) : null,
            ach ? h("small", { class: `${c}lx-ach` }, `${pct(ach[0], ach[1])} % · ${ach[0]}/${ach[1]} logros`) : null,
          ),
        );
      }),
    );
  }

  function lxBadges() {
    const vals = badgeValues(p);
    const owned = new Map((p.badges || []).map((b) => [b.id, b.tier || 0]));
    const rows = Object.entries(BADGES)
      .map(([bid, def]) => ({ bid, def, tier: owned.get(bid) || 0, v: vals[bid] ?? 0 }))
      .sort((a, b) => b.tier - a.tier);
    return h(
      "div",
      { class: `${c}lx-badges` },
      ...rows.map(({ bid, def, tier, v }) => {
        const next = def.th[tier];
        const from = tier ? def.th[tier - 1] : 0;
        const info = tier ? badgeInfo({ id: bid, tier }) : null;
        return h(
          "div",
          { class: `${c}lx-badge${tier ? "" : " is-locked"}` },
          badgeEl({ id: bid, tier: Math.max(1, tier) }, c),
          h(
            "div",
            { class: `${c}lx-badge-main` },
            h("b", null, layout === "retro" ? RETRO_BADGES[bid] || def.name : def.name),
            h("small", null, layout === "retro" ? (tier ? `LV ${tier}` : "LOCKED") : info ? `${info.tierName} · ${info.text}` : "Sin conseguir"),
            next ? h("span", { class: `${c}lx-bar` }, h("i", { style: `width: ${pct(v - from, next - from)}%` })) : null,
            h("small", { class: `${c}lx-next` }, layout === "retro" ? (next ? `${num(Math.min(v, next))}/${num(next)}` : "MAX") : next ? `Siguiente: ${def.unit(next)}` : "Nivel máximo"),
          ),
        );
      }),
    );
  }

  function lxFriends() {
    const list = p.topFriends || [];
    if (!list.length) return h("div", { class: `${c}lx-none` }, tx("Todavía no hay amigos."));
    return h(
      "div",
      { class: `${c}lx-friends` },
      ...list.map((fr) => {
        const k = fr.presence ? presenceKind(fr.presence) : "offline";
        return key(
          h(
            "button",
            { class: `${c}lx-friend is-${k}`, "data-focus": "", "data-nav": "", onclick: () => onProfile(fr.id), disabled: preview },
            avatar(fr, { size: "l", cls: c, presence: fr.presence || { status: "offline" } }),
            h("span", { class: `${c}lx-friend-main` }, h("b", null, fr.name), h("small", null, fr.presence ? (layout === "retro" ? retroPresence(fr.presence) : presenceText(fr.presence)) : "")),
            levelBadge(fr.level || 0, c),
          ),
          `lf${fr.id}`,
        );
      }),
    );
  }

  function lxTabs(extraCls = "") {
    return h(
      "div",
      { class: `${c}lx-tabs ${extraCls}`.trim(), role: "tablist" },
      ...TABS.map(([t, label]) =>
        key(
          h(
            "button",
            { class: `${c}lx-tab${tab === t ? " is-on" : ""}`, "data-focus": "", "data-nav": "", "aria-selected": tab === t, onclick: () => setTab(t) },
            layout === "switch" ? h("span", { class: `${c}lx-tab-ico`, html: I(TAB_ICONS[t]) }) : null,
            label,
            t === "friends" && p.friends ? h("span", { class: `${c}lx-tab-n` }, String(p.friends)) : null,
          ),
          `tab-${t}`,
        ),
      ),
    );
  }

  /** Lo de cada pestaña (PS5, Xbox, Switch). */
  function tabBody(f, profileBody) {
    if (p.private) return h("div", { class: `${c}lx-private` }, tx("Este perfil es privado."));
    if (tab === "games") return lxGames(f.all, { rows: layout === "switch" });
    if (tab === "badges") return lxBadges();
    if (tab === "friends") return lxFriends();
    return profileBody();
  }
  const bioSection = (f, title = "Sobre mí") => (f.bio ? lxSection(tx(title), `${c}lx-about`, h("p", { class: `${c}lx-bio` }, f.bio)) : null);

  function ps5() {
    const f = facts();
    return [
      h("div", { class: `${c}ps-hero` }, backdropEl()),
      h(
        "div",
        { class: `${c}ps-main` },
        h(
          "div",
          { class: `${c}ps-id` },
          h("div", { class: `${c}ps-av` }, avatar(p, { size: "xl", cls: c })),
          h(
            "div",
            { class: `${c}ps-who` },
            h("h1", { class: `${c}ps-name` }, f.name),
            f.real || f.place ? h("div", { class: `${c}ps-real` }, [f.real, f.place].filter(Boolean).join(" · ")) : null,
            presenceLine(f),
            lxActions(),
          ),
          h(
            "div",
            { class: `${c}ps-side` },
            levelChip(f),
            h(
              "div",
              { class: `${c}ps-counts` },
              h("span", null, h("b", null, num((p.badges || []).length)), "insignias"),
              h("span", null, h("b", null, num(p.friends ?? 0)), "amigos"),
              h("span", null, h("b", null, num(f.nGames)), "juegos"),
            ),
          ),
        ),
        message ? h("div", { class: `${c}lx-msg` }, message) : null,
        p.private ? null : lxTabs(),
        tabBody(f, () => h("div", { class: `${c}lx-page` }, bioSection(f), ...lxShowcases(), f.recent.length ? lxSection("Jugado recientemente", "", lxGames(f.recent.slice(0, 6))) : null, commentsArea())),
      ),
    ];
  }

  function xbox() {
    const f = facts();
    const stat = (n, label) => h("div", { class: `${c}xb-stat` }, h("b", null, num(n)), h("small", null, label));
    return [
      h("div", { class: `${c}xb-banner` }, backdropEl()),
      h(
        "div",
        { class: `${c}xb-grid` },
        h(
          "aside",
          { class: `${c}xb-card` },
          h("div", { class: `${c}xb-av` }, avatar(p, { size: "xl", cls: c })),
          h("h1", { class: `${c}xb-tag` }, f.name),
          f.real ? h("div", { class: `${c}xb-real` }, f.real) : null,
          presenceLine(f),
          h("div", { class: `${c}xb-score`, title: "Gamerscore (tu experiencia)" }, h("span", { class: `${c}xb-g` }, "G"), h("b", null, num(f.xp))),
          h("div", { class: `${c}xb-stats` }, stat(f.lv, "Nivel"), stat(p.friends ?? 0, "Amigos"), stat(f.nGames, "Juegos")),
          h("span", { class: `${c}lx-bar ${c}xb-lvbar`, title: `${num(f.toNext)} EXP para el nivel ${f.lv + 1}` }, h("i", { style: `width: ${f.lvPct}%` })),
          f.bio ? h("p", { class: `${c}xb-bio` }, f.bio) : null,
          f.place || f.since ? h("div", { class: `${c}xb-facts` }, f.place ? h("span", null, f.place) : null, f.since ? h("span", null, `En ejGames desde ${f.since}`) : null) : null,
          lxActions(),
        ),
        h(
          "div",
          { class: `${c}xb-main` },
          message ? h("div", { class: `${c}lx-msg` }, message) : null,
          p.private ? null : lxTabs(),
          tabBody(f, () =>
            h(
              "div",
              { class: `${c}lx-page` },
              ...lxShowcases(),
              f.recent.length ? lxSection("Jugado recientemente", "", lxGames(f.recent.slice(0, 8), { wide: true })) : null,
              commentsArea(),
            ),
          ),
        ),
      ),
    ];
  }

  function nswitch() {
    const f = facts();
    const profileBody = () =>
      h(
        "div",
        { class: `${c}lx-page` },
        h(
          "div",
          { class: `${c}sw-card` },
          h("div", { class: `${c}sw-banner` }, backdropEl()),
          h("div", { class: `${c}sw-av` }, avatar(p, { size: "xl", cls: c })),
          h(
            "div",
            { class: `${c}sw-who` },
            h("h1", { class: `${c}sw-name` }, f.name),
            h("div", { class: `${c}sw-code` }, `@${p.username}`, f.place ? ` · ${f.place}` : ""),
            presenceLine(f),
            levelChip(f),
          ),
          lxActions(),
        ),
        f.bio ? h("div", { class: `${c}sw-bubble` }, f.bio) : null,
        ...lxShowcases(),
        f.recent.length ? lxSection("Actividad de juego", "", lxGames(f.recent.slice(0, 3), { rows: true })) : null,
        commentsArea(),
      );
    return [
      h(
        "div",
        { class: `${c}sw` },
        p.private ? null : lxTabs(`${c}sw-nav`),
        h(
          "div",
          { class: `${c}sw-main` },
          message ? h("div", { class: `${c}lx-msg` }, message) : null,
          p.private
            ? h("div", { class: `${c}sw-card` }, h("div", { class: `${c}sw-av` }, avatar(p, { size: "xl", cls: c })), h("div", { class: `${c}sw-who` }, h("h1", { class: `${c}sw-name` }, f.name), h("div", { class: `${c}lx-private` }, "Este perfil es privado.")), lxActions())
            : tabBody(f, profileBody),
        ),
      ),
    ];
  }

  function cinema() {
    const f = facts();
    const meta = [f.place, `${num(f.nGames)} juegos`, f.since ? `Desde ${f.since}` : null].filter(Boolean);
    return [
      h(
        "div",
        { class: `${c}cn-hero` },
        backdropEl(),
        h(
          "div",
          { class: `${c}cn-info` },
          h("div", { class: `${c}cn-kicker` }, avatar(p, { size: "m", cls: c }), h("span", null, "Perfil")),
          h("h1", { class: `${c}cn-title` }, f.name),
          h("div", { class: `${c}cn-meta` }, h("span", { class: `${c}cn-match` }, `Nivel ${f.lv}`), ...meta.map((m) => h("span", null, m)), f.kind ? h("span", { class: `${c}cn-live is-${f.kind}` }, f.kind === "playing" ? "Jugando ahora" : f.kind === "offline" ? "Desconectado" : "En línea") : null),
          f.real ? h("div", { class: `${c}cn-real` }, f.real) : null,
          f.bio ? h("p", { class: `${c}cn-bio` }, f.bio) : null,
          f.kind === "playing" ? h("div", { class: `${c}cn-now` }, `Jugando a ${p.presence.game}`) : null,
          lxActions(),
        ),
      ),
      h(
        "div",
        { class: `${c}cn-rows` },
        message ? h("div", { class: `${c}lx-msg` }, message) : null,
        p.private
          ? h("div", { class: `${c}lx-private` }, "Este perfil es privado.")
          : [
              f.recent.length ? lxSection("Seguir jugando", "", lxGames(f.recent.slice(0, 8), { wide: true })) : null,
              ...lxShowcases(),
              h("div", { "data-sec": "badges" }, lxSection("Insignias", "", levelChip(f), lxBadges())),
              lxSection(`Amigos (${num(p.friends ?? 0)})`, "", lxFriends()),
              commentsArea(),
            ],
      ),
    ];
  }

  function retro() {
    const f = facts();
    const segs = Array.from({ length: 10 }, (_, i) => h("i", { class: i < Math.round(f.lvPct / 10) ? "is-on" : "" }));
    const ORD = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH", "7TH", "8TH", "9TH", "10TH"];
    // La puntuación de cada juego: sus minutos jugados, como en los recreativos.
    const scores = f.top.filter((g) => g.minutes).slice(0, 10);
    return [
      h("div", { class: `${c}rt-screen` }, backdropEl()),
      h(
        "div",
        { class: `${c}rt-wrap` },
        h(
          "div",
          { class: `${c}rt-card` },
          h("div", { class: `${c}rt-label` }, f.own ? "PLAYER 1" : "PLAYER 2"),
          h("div", { class: `${c}rt-av` }, avatar(p, { size: "xl", cls: c })),
          h(
            "div",
            { class: `${c}rt-who` },
            h("div", { class: `${c}rt-name` }, f.name),
            f.real || f.place ? h("div", { class: `${c}rt-real` }, [f.real, f.place].filter(Boolean).join(" · ")) : null,
            presenceLine(f),
            h("div", { class: `${c}rt-lv` }, h("span", null, `LV ${String(f.lv).padStart(2, "0")}`), h("span", { class: `${c}rt-exp` }, ...segs), h("span", null, `EXP ${num(f.xp)}`)),
            lxActions(),
          ),
        ),
        message ? h("div", { class: `${c}lx-msg` }, message) : null,
        p.private
          ? h("div", { class: `${c}lx-private` }, "PRIVATE PROFILE")
          : [
              f.bio ? lxSection("ABOUT", "", h("p", { class: `${c}lx-bio` }, f.bio)) : null,
              lxSection(
                "HI-SCORES",
                `${c}rt-scores`,
                scores.length
                  ? h(
                      "div",
                      { class: `${c}rt-table` },
                      h("div", { class: `${c}rt-row is-head` }, h("span", null, "RANK"), h("span", null, "GAME"), h("span", null, "SCORE (MIN)")),
                      ...scores.map((g, i) => h("div", { class: `${c}rt-row` }, h("span", { class: `${c}rt-rank` }, ORD[i]), h("span", { class: `${c}rt-game` }, g.title), h("span", { class: `${c}rt-score` }, String(g.minutes).padStart(7, "0")))),
                    )
                  : h("div", { class: `${c}lx-none` }, "NO SCORES YET"),
              ),
              ...lxShowcases(),
              h("div", { "data-sec": "badges" }, lxSection("BADGES", "", lxBadges())),
              lxSection(`FRIENDS ${String(p.friends ?? 0).padStart(2, "0")}`, "", lxFriends()),
              commentsArea(),
            ],
      ),
    ];
  }

  const RENDER = { ps5, xbox, switch: nswitch, cinema, retro };

  function setTab(t) {
    if (!TABS || tab === t) return;
    tab = t;
    paint();
    focusKey(`tab-${t}`);
  }
  /** El nivel y «Insignias»: su pestaña, su sección o la página de insignias (Steam). */
  function goBadges() {
    if (TABS) return setTab("badges");
    const sec = view.querySelector('[data-sec="badges"]');
    if (sec) return sec.scrollIntoView({ behavior: "smooth", block: "start" });
    onBadges?.(p.id);
  }

  function paint() {
    if (!p) return;
    const had = focus?.current && view.contains(focus.current) ? focus.current.dataset.key : null;
    const prof = p.profile || {};
    const bgUrl = p.backgroundImageUrl || prof.backgroundImageUrl;
    const theme = p.color ?? prof.color ?? "";
    const bg = p.background ?? prof.background ?? "";
    view.className = `${c}view ${c}profile ${c}layout-${layout}${layout === "steam" ? "" : ` ${c}lx`} ${c}skin${theme ? ` ${c}theme-${theme}` : ""}${bg && !bgUrl ? ` ${c}bg-${bg}` : ""}${bgUrl ? " has-image" : ""}${bgUrl || bg ? " has-bg" : ""}${preview ? " is-preview" : ""}`;
    if (RENDER[layout]) {
      view.replaceChildren(h("div", { class: `${c}ppage` }, ...RENDER[layout]()));
      return afterPaint(had);
    }
    const backdrop = h("div", { class: `${c}backdrop`, style: bgUrl ? `background-image: url("${bgUrl}")` : "" });
    let content;
    if (p.private) {
      content = h("div", { class: `${c}pc is-private` }, h("div", { class: `${c}private` }, "Este perfil es privado."));
    } else {
      const chosen = prof.showcases || [];
      content = h(
        "div",
        { class: `${c}pc` },
        h("div", { class: `${c}lc` }, ...chosen.map((s) => showcase(s, p, c, { own: preview || p.relation === "self", tx })).filter(Boolean), recentActivity(), commentsArea()),
        rightCol(),
      );
    }
    view.replaceChildren(h("div", { class: `${c}ppage` }, backdrop, header(), message ? h("div", { class: `${c}pmsg` }, message) : null, content));
    afterPaint(had);
  }

  function afterPaint(had) {
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
        if (confirm || menu) {
          confirm = null;
          menu = false;
          paint();
          focusKey("more");
          return true;
        }
        return onExit() !== false;
      }
      if (a === "x" && p?.canComment && !preview) {
        writeComment();
        return true;
      }
      if (a === "y" && p?.relation === "self" && !preview) {
        ejg.account.openEditor();
        return true;
      }
      if ((a === "lb" || a === "rb") && TABS && p && !p.private) {
        const i = TABS.findIndex(([t]) => t === tab);
        setTab(TABS[(i + (a === "rb" ? 1 : TABS.length - 1)) % TABS.length][0]);
        return true;
      }
      return false;
    },
    hints: () => [
      ["accept", "Elegir"],
      ...(TABS ? [["lb", "Pestañas"]] : []),
      ...(p?.canComment ? [["x", "Comentar"]] : []),
      ...(p?.relation === "self" ? [["y", L.edit]] : []),
      ["back", "Atrás"],
    ],
    reload: load,
    /** Cambia los datos de la vista previa. */
    update(next) {
      p = next;
      paint();
    },
    destroy() {
      destroyed = true;
      if (typeof off === "function") off();
      view.remove();
    },
  };
}

// ───────────────────────────── insignias ─────────────────────────────

/** Lo que mide cada insignia, sacado del perfil (resumen, amigos y antigüedad). */
function badgeValues(p) {
  const st = p.summary?.stats || {};
  const games = p.summary?.games || [];
  return {
    collector: st.library ?? games.length,
    achiever: st.achievements || 0,
    marathon: Math.floor((st.minutes || 0) / 60),
    completionist: st.perfect || 0,
    explorer: games.filter((g) => (g.minutes || 0) >= 60).length,
    veteran: p.memberSince ? Math.floor((Date.now() / 1000 - p.memberSince) / (365 * 86400)) : 0,
    social: p.friends || 0,
  };
}

/**
 * La página de insignias de Steam: nivel y experiencia arriba y cada insignia
 * con su nivel, lo que falta para el siguiente y su barra.
 * @param {{ ejg: any, root: HTMLElement, focus?: any, userId?: number | null, cls?: string,
 *   onExit?: () => void, onChange?: () => void, onProfile?: (id: number) => void }} opts
 * @returns {{ nav: (a: string) => boolean, hints: () => [string, string][], reload: () => any, destroy: () => void }}
 */
export function createBadgesView({ ejg, root, focus, userId = null, cls = "s-", onExit = () => {}, onChange = () => {}, onProfile = () => {} }) {
  const c = cls;
  const view = h("div", { class: `${c}view ${c}profile ${c}badgespage` });
  root.replaceChildren(view);
  let p = null;
  let destroyed = false;
  const myId = () => ejg?.account?.state?.social?.me?.id ?? ejg?.account?.state?.userId;
  const id = () => userId ?? myId();

  async function load() {
    view.replaceChildren(h("div", { class: `${c}empty` }, "Cargando las insignias…"));
    try {
      p = await ejg.profiles.view(id());
      if (!destroyed) paint();
    } catch (e) {
      view.replaceChildren(h("div", { class: `${c}empty` }, String(e?.message || e)));
      onChange();
    }
  }

  function paint() {
    const prof = p.profile || {};
    const theme = p.color ?? prof.color ?? "";
    const bgUrl = p.backgroundImageUrl || prof.backgroundImageUrl;
    const bg = p.background ?? prof.background ?? "";
    view.className = `${c}view ${c}profile ${c}layout-steam ${c}badgespage ${c}skin${theme ? ` ${c}theme-${theme}` : ""}${bg && !bgUrl ? ` ${c}bg-${bg}` : ""}${bgUrl ? " has-image" : ""}${bgUrl || bg ? " has-bg" : ""}`;
    const name = prof.name || p.name;
    const lv = p.level || 0;
    const xp = p.xp || 0;
    const need = Math.max(0, xpFor(lv + 1) - xp);
    const done = pct(xp - xpFor(lv), xpFor(lv + 1) - xpFor(lv));
    const num = (n) => n.toLocaleString("es", { useGrouping: "always" });
    const head = h(
      "div",
      { class: `${c}ph-bg ${c}ph-small` },
      h(
        "div",
        { class: `${c}ph-tex` },
        h(
          "div",
          { class: `${c}bhead` },
          key(h("button", { class: `${c}bhead-who`, "data-focus": "", "data-nav": "", onclick: () => onProfile(p.id), title: "Ver el perfil" }, avatar(p, { size: "l", cls: c }), h("span", { class: `${c}bhead-name` }, name)), "who"),
          h("span", { class: `${c}bhead-sep` }, "»"),
          h("span", { class: `${c}bhead-page` }, "Insignias"),
        ),
      ),
    );
    let content;
    if (p.private) content = h("div", { class: `${c}pc is-private` }, h("div", { class: `${c}private` }, "Este perfil es privado."));
    else {
      const vals = badgeValues(p);
      const owned = new Map((p.badges || []).map((b) => [b.id, b.tier || 0]));
      const rows = Object.entries(BADGES)
        .map(([bid, def]) => ({ bid, def, tier: owned.get(bid) || 0, value: vals[bid] ?? 0 }))
        .sort((a, b) => b.tier - a.tier);
      content = h(
        "div",
        { class: `${c}pc ${c}bpage` },
        h(
          "div",
          { class: `${c}xpblock` },
          h("div", { class: `${c}xp-level` }, h("span", null, "Nivel"), levelBadge(lv, c)),
          h(
            "div",
            { class: `${c}xp-main` },
            h("div", { class: `${c}xp-total` }, `EXP: ${num(xp)}`),
            h("span", { class: `${c}achbar ${c}xp-bar` }, h("i", { style: `width: ${done}%` })),
            h("div", { class: `${c}xp-need` }, `Gana ${num(need)} EXP para subir al nivel ${lv + 1}`),
          ),
          h("div", { class: `${c}xp-count` }, h("b", null, String((p.badges || []).length)), ` de ${Object.keys(BADGES).length} insignias`),
        ),
        h(
          "div",
          { class: `${c}brows` },
          ...rows.map(({ bid, def, tier, value }) => {
            const next = def.th[tier];
            const from = tier ? def.th[tier - 1] : 0;
            const info = tier ? badgeInfo({ id: bid, tier }) : null;
            return h(
              "div",
              { class: `${c}brow${tier ? "" : " is-locked"}` },
              h("span", { class: `${c}brow-ico` }, badgeEl({ id: bid, tier: Math.max(1, tier) }, c)),
              h(
                "div",
                { class: `${c}brow-main` },
                h("div", { class: `${c}brow-title` }, def.name),
                h("div", { class: `${c}brow-sub` }, info ? `Nivel ${tier} (${info.tierName}), ${num(tier * 50)} EXP · ${info.text}` : "Sin conseguir"),
                h("div", { class: `${c}brow-now` }, `Ahora: ${def.unit(value)}`),
              ),
              h(
                "div",
                { class: `${c}brow-next` },
                next
                  ? [
                      h("div", null, `Siguiente nivel: ${def.unit(next)}`),
                      h("span", { class: `${c}achbar` }, h("i", { style: `width: ${pct(value - from, next - from)}%` })),
                      h("small", null, `${num(Math.min(value, next))} / ${num(next)}`),
                    ]
                  : h("div", { class: `${c}brow-max` }, "Nivel máximo"),
              ),
            );
          }),
        ),
      );
    }
    view.replaceChildren(h("div", { class: `${c}ppage` }, h("div", { class: `${c}backdrop`, style: bgUrl ? `background-image: url("${bgUrl}")` : "" }), head, content));
    if (focus && (!focus.current || !focus.current.isConnected || !view.contains(focus.current))) focus.first(view);
    onChange();
  }

  load();
  return {
    nav: (a) => (a === "back" ? onExit() !== false : false),
    hints: () => [
      ["accept", "Ver el perfil"],
      ["back", "Atrás"],
    ],
    reload: load,
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
 * `start`: "friends" | "requests" | "activity" (pestañas de la lista),
 * "profile" o "badges" (con `userId`; sin él, los tuyos). `layout`: el diseño
 * del perfil de tu tema (ver createProfileView).
 * @param {{ ejg: any, root: HTMLElement, focus?: any, start?: string, userId?: number | null, layout?: string, cls?: string,
 *   labels?: Record<string, string>, onExit?: () => void, onChange?: () => void }} opts
 * @returns {{ nav: (a: string) => boolean, hints: () => [string, string][], open: (start: string, userId?: number | null) => void, readonly depth: number, destroy: () => void }}
 */
export function createSocialView({ ejg, root, focus, start = "friends", userId = null, layout = "steam", cls = "s-", labels = {}, onExit = () => {}, onChange = () => {} }) {
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
  const push = (entry) => {
    stack.push(entry);
    show();
  };
  function show() {
    view?.destroy();
    const top = stack[stack.length - 1];
    const common = { ejg, root, focus, cls, onChange, onExit: back, onProfile: (id) => push({ kind: "profile", id }) };
    if (top.kind === "friends") view = createFriendsView({ ...common, tab: top.tab, labels });
    // Steam tiene su página de insignias; los demás, su pestaña o su sección del perfil.
    else if (top.kind === "badges" && layout === "steam") view = createBadgesView({ ...common, userId: top.id });
    else view = createProfileView({ ...common, layout, userId: top.id, tab: top.kind === "badges" ? "badges" : "profile", onBadges: (id) => push({ kind: "badges", id }) });
    onChange();
  }
  function open(s, id = null) {
    stack = [s === "profile" || s === "badges" ? { kind: s, id } : { kind: "friends", tab: s }];
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
