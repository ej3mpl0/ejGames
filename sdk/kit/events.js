// Eventos de temporada (Halloween…). El host decide cuál está activo (fechas y
// ajuste del usuario) y lo manda a los temas: `ejg.season.id`. Mientras dura,
// el SDK ya aplica solo la paleta, el fondo y el ambiente (ver ejg.js y
// /_sdk/events/<id>/season.css); aquí van los datos y las piezas para la tienda.
//   import { seasonOf, seasonBanner, seasonPicks } from "/_sdk/kit/events.js";
//   const ev = seasonOf(ejg);   // null si no hay evento

import { h, img } from "./dom.js";

export const EVENTS = [
  {
    id: "halloween",
    name: "ejGames Scream V",
    /** Mes y día (incluidos), todos los años. */
    from: [10, 3],
    to: [11, 2],
    dates: "3 oct – 2 nov",
    /** Banner 2000×297: imagen fija (cartel y respaldo) y su versión animada en bucle. */
    banner: "/_sdk/events/halloween/banner.webp",
    video: "/_sdk/events/halloween/banner.mp4",
    /** Cabecera grande 1600×560 (el banner sobre la calle encantada), para portadas a lo ancho. */
    hero: "/_sdk/events/halloween/hero.webp",
    heroVideo: "/_sdk/events/halloween/hero.mp4",
    /** Fondos 16:9 (biblioteca y pantallas del host). */
    wallpaper: "/_sdk/events/halloween/wallpaper-street.jpg",
    /** El mismo fondo animado en bucle (para los temas que admiten vídeo de fondo). */
    wallpaperVideo: "/_sdk/events/halloween/wallpaper-street.mp4",
    wallpaperAlt: "/_sdk/events/halloween/wallpaper-graveyard.jpg",
    /** Colores: naranja calabaza, verde del logo, violeta de la noche. */
    palette: { accent: "#ff7a1a", green: "#7cf64a", violet: "#7b4bd6", bg: "#110d1a", panel: "#1a1428", text: "#ece6f5" },
    /** Selección del evento: género «Terror». */
    genre: 54,
    title: "Ofertas de miedo",
    subtitle: "Lo más terrorífico del catálogo, para jugar con las luces apagadas",
  },
];

const md = (d) => (d.getMonth() + 1) * 100 + d.getDate();

/** ¿Está `ev` en sus fechas el día `now`? (Admite rangos que cruzan de año). */
export function inEvent(ev, now = new Date()) {
  const t = md(now);
  const a = ev.from[0] * 100 + ev.from[1];
  const b = ev.to[0] * 100 + ev.to[1];
  return a <= b ? t >= a && t <= b : t >= a || t <= b;
}

/**
 * El evento que toca. `mode`: "auto" (solo en sus fechas), "on" (siempre: el
 * que esté en fechas o, si no, el primero) u "off".
 */
export function activeEvent(mode = "auto", now = new Date()) {
  if (mode === "off") return null;
  const cur = EVENTS.find((e) => inEvent(e, now));
  return cur || (mode === "on" ? EVENTS[0] : null);
}

/** El evento activo para un tema (el que manda el host) o null. */
export function seasonOf(ejg) {
  const id = ejg?.season?.id;
  return (id && EVENTS.find((e) => e.id === id)) || null;
}

/**
 * Banner del evento: el vídeo en bucle (quieto con «reducir movimiento» o si
 * no carga: la imagen). Se pausa con la ventana oculta. Clase: ejg-ev-banner
 * (franja 2000×297) o, con `{ hero: true }`, ejg-ev-hero (cabecera 1600×560).
 */
export function seasonBanner(ev, cls = "", { hero = false } = {}) {
  const poster = hero && ev.hero ? ev.hero : ev.banner;
  const src = hero && ev.heroVideo ? ev.heroVideo : ev.video;
  const still = img(poster, { loading: "eager", alt: ev.name });
  const box = h("div", { class: (hero && ev.hero ? "ejg-ev-hero " : "ejg-ev-banner ") + cls });
  if (!src || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    box.append(still);
    return box;
  }
  const video = h("video", { muted: "", loop: "", autoplay: "", playsinline: "", preload: "auto", poster, "aria-label": ev.name });
  video.muted = true;
  video.src = src;
  video.addEventListener("error", () => video.replaceWith(still), { once: true });
  const sync = () => {
    if (!video.isConnected) return document.removeEventListener("visibilitychange", sync);
    if (document.hidden) video.pause();
    else video.play().catch(() => {});
  };
  document.addEventListener("visibilitychange", sync);
  box.append(video);
  return box;
}

const picks = new Map();
/**
 * Juegos del evento: primero los populares de la portada de su género y, para
 * completar, los del catálogo (se piden una vez; `onLoad` avisa al llegar).
 * Devuelve { items, loading }.
 */
export function seasonPicks(ejg, ev, sections = [], onLoad = () => {}) {
  const seen = new Set();
  const popular = sections.flatMap((x) => x.items || []).filter((r) => r.tags?.includes(ev.genre) && !seen.has(r.slug) && seen.add(r.slug));
  let p = picks.get(ev.id);
  if (!p) {
    p = { items: null, loading: true };
    picks.set(ev.id, p);
    ejg.explore
      .browse({ query: "", genres: [ev.genre], sort: "modified", maxGb: null, hideOwned: false }, 1)
      .then((r) => (p.items = r.items || []))
      .catch(() => (p.items = []))
      .finally(() => {
        p.loading = false;
        onLoad();
      });
  }
  return { items: popular.concat((p.items || []).filter((r) => !seen.has(r.slug))), loading: p.loading };
}
