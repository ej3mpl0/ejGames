// Homebrew para temas: los catálogos de juegos de consola a la vista, como una tienda
// (populares, novedades y una fila por consola, buscador y ficha con «Descargar»),
// tus juegos de consola (con «Borrar») y tus emuladores. Lo que se baja se descomprime
// y queda en la biblioteca. Con mando: LB/RB cambia de consola, X borra el juego
// enfocado e Y abre la tienda de emuladores.
// Cada tema pone su piel con las variables --hb-* y la maqueta con `layout`.
//
//   import { createHomebrewView } from "/_sdk/kit/homebrew.js";
//   <link rel="stylesheet" href="/_sdk/kit/homebrew.css" />
//   const hb = createHomebrewView({ ejg, root, focus, layout: "steam", onGame: (g) => abrirFicha(g.id) });
//   hb.nav("rb"); hb.hints(); hb.destroy();

import { h, hueOf, initials } from "./dom.js";
import { artFor } from "./art.js";
import { norm, roms, software, systemName } from "./library.js";
import { relative } from "./format.js";

export const HOMEBREW_LAYOUTS = ["steam", "ps5", "xbox", "switch", "cinema", "retro"];

const tr = (s, v) => (globalThis.ejg && globalThis.ejg.t ? globalThis.ejg.t(s, v) : s.replace(/\{(\w+)\}/g, (_, k) => (v && k in v ? v[k] : `{${k}}`)));

/** Nombre corto y tono de cada sistema (`game.platform`). */
const SYS = {
  switch: ["NSW", 356], wiiu: ["Wii U", 195], wii: ["Wii", 200], gc: ["GC", 262], n64: ["N64", 140], snes: ["SNES", 280], nes: ["NES", 0],
  "3ds": ["3DS", 350], nds: ["DS", 210], gba: ["GBA", 250], gbc: ["GBC", 50], gb: ["GB", 90],
  psx: ["PS1", 220], ps2: ["PS2", 225], ps3: ["PS3", 230], ps4: ["PS4", 235], ps5: ["PS5", 240], psp: ["PSP", 215], vita: ["Vita", 205],
  xbox: ["Xbox", 120], xbox360: ["360", 110],
  genesis: ["MD", 10], saturn: ["SAT", 30], dreamcast: ["DC", 25], sms: ["SMS", 5], gg: ["GG", 15],
  arcade: ["ARC", 300], pce: ["PCE", 60], wonderswan: ["WS", 170],
};
// Las de los catálogos que la biblioteca no emula (sin `system`).
const CAT_SYS = { ps4: "ps4", ps5: "ps5", "xbox-one": "xbox" };
export const systemShort = (id) => (SYS[id] ? SYS[id][0] : String(id || "").toUpperCase());
export const systemHue = (id) => (SYS[id] ? SYS[id][1] : hueOf(id));

const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  chip: I('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
  folder: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  pad: I('<path d="M7 9h10a4 4 0 0 1 4 4v.6a3.4 3.4 0 0 1-6 2.2L14 15h-4l-1 .8a3.4 3.4 0 0 1-6-2.2V13a4 4 0 0 1 4-4Z"/><path d="M8 11.5v3M6.5 13h3"/><circle cx="16" cy="12.5" r=".6"/><circle cx="17.6" cy="14.1" r=".6"/>'),
  up: I('<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>'),
  warn: I('<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5M12 17v.4"/>'),
  search: I('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/>'),
  down: I('<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/>'),
  check: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  play: I('<path d="M8 5.5v13l10.5-6.5Z"/>'),
  trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  close: I('<path d="m6 6 12 12M18 6 6 18"/>'),
  left: I('<path d="m15 18-6-6 6-6"/>'),
  right: I('<path d="m9 18 6-6-6-6"/>'),
  link: I('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};
const icon = (name, cls) => h("span", { class: cls, html: ICONS[name] });

/** Emulador de un juego («Eden», «RetroArch (Snes9x)»…) → clave para emparejarlo con su programa. */
const emuKey = (name) => norm(String(name || "").replace(/\(.*\)/, ""));
const jobKey = (e) => `${e.sourceId}|${e.id}`;
const ACTIVE = new Set(["queued", "download", "extract", "organize"]);
const mb = (n) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : `${Math.max(1, Math.round(n / (1 << 20)))} MB`);

let listCache = null;
/** `ejg.emulators.list()` una vez por sesión (pregunta las versiones nuevas a sus webs). */
function emulatorList(ejg, force = false) {
  if (!ejg.emulators?.list) return Promise.resolve([]);
  if (!listCache || force) listCache = ejg.emulators.list().catch(() => ((listCache = null), []));
  return listCache;
}

/**
 * @param {{ ejg: any, root: HTMLElement, focus?: any, layout?: string, onExit?: () => any, onChange?: () => void,
 *   onGame?: (g: any) => void }} opts
 *   onGame: abrir la ficha del tema de un juego de la biblioteca (sin él, se juega).
 * @returns {{ nav: (a: string) => boolean, hints: () => [string, string][], refresh: () => void, destroy: () => void }}
 */
export function createHomebrewView({ ejg, root, focus = null, layout: wanted = "steam", onExit = () => {}, onChange = () => {}, onGame = null }) {
  const layout = HOMEBREW_LAYOUTS.includes(wanted) ? wanted : "steam";
  const view = h("div", { class: `hb-view hb-layout-${layout}` });
  root.replaceChildren(view);
  const cat = ejg.catalogs || null;
  const s = { view: "front", plat: null, query: "", sources: [], loaded: false, sheet: null };
  /** Listas de los catálogos ya pedidas: clave → { entries, page, hasMore, loading, error }. */
  const lists = new Map();
  let infos = [];
  let destroyed = false;
  let jobSig = "";
  let observer = null;

  const open = (name, args) => ejg.ui.open(name, args);
  const play = (g) => (onGame ? onGame(g) : ejg.game.launch(g.id));
  const jobs = () => (cat && cat.jobs) || {};
  const installedOf = (e) => e.installedGameId || (jobs()[jobKey(e)]?.phase === "done" ? jobs()[jobKey(e)].gameId : null);
  const sysOf = (p) => p?.system || CAT_SYS[p?.id] || p?.id;

  // ─── datos ───
  /** Las consolas de los catálogos y las de tus juegos, una vez cada una. */
  function platforms() {
    const out = [];
    const seen = new Set();
    for (const src of s.sources)
      for (const p of src.platforms) {
        const sys = sysOf(p);
        if (seen.has(sys)) continue;
        seen.add(sys);
        out.push({ id: p.id, system: sys, name: p.name, source: src.id });
      }
    for (const g of roms(ejg.library.all))
      if (!seen.has(g.platform)) {
        seen.add(g.platform);
        out.push({ id: null, system: g.platform, name: systemName(g.platform), source: null });
      }
    return out;
  }
  const sourceFor = (p) => s.sources.find((x) => x.platforms.some((q) => q.id === p));

  async function load(key, fetch, more = false) {
    const cur = lists.get(key);
    if (cur?.loading || (cur && !more)) return;
    const page = more && cur ? cur.page + 1 : 1;
    lists.set(key, { entries: cur?.entries || [], page: cur?.page || 0, hasMore: !!cur?.hasMore, loading: true, error: null });
    if (more) paint();
    let r;
    try {
      r = await fetch(page);
    } catch (e) {
      r = { entries: [], hasMore: false, error: String(e?.message || e) };
    }
    if (destroyed) return;
    const prev = more && cur ? cur.entries : [];
    const have = new Set(prev.map(jobKey));
    lists.set(key, { entries: [...prev, ...(r.entries || []).filter((e) => !have.has(jobKey(e)))], page, hasMore: !!r.hasMore, loading: false, error: r.error || null });
    paint();
  }
  const browse = (key, q, more) => load(key, (page) => cat.browse({ ...q, page }), more);
  const loadPlatform = (p, more = false) => {
    const src = sourceFor(p.id);
    if (src) browse(`plat:${p.id}`, { source: src.id, mode: "platform", platform: p.id }, more);
  };
  const loadSearch = (more = false) => {
    const q = s.query.trim();
    if (!q) return;
    const plats = s.plat?.id ? [s.plat.id] : [];
    load(`search:${s.plat?.id || ""}:${q}`, (page) => cat.search(q, { platforms: plats, page }), more);
  };
  /** Populares o novedades de todas las fuentes, intercaladas. */
  const loadFront = (mode) =>
    load(mode, async (page) => {
      const parts = await Promise.all(s.sources.map((src) => cat.browse({ source: src.id, mode, page }).catch((e) => ({ entries: [], error: String(e?.message || e) }))));
      const entries = [];
      for (let i = 0; parts.some((p) => i < (p.entries || []).length); i++) for (const p of parts) if (p.entries?.[i]) entries.push(p.entries[i]);
      return { entries, hasMore: parts.some((p) => p.hasMore), error: entries.length ? null : parts.find((p) => p.error)?.error || null };
    });

  // ─── piezas ───
  function sysTag(id) {
    return h("span", { class: "hb-sys", style: `--hb-hue: ${systemHue(id)}`, title: systemName(id), "data-no-t": "" }, systemShort(id));
  }

  function bar(job) {
    const p = job.total ? Math.min(1, job.received / job.total) : 0;
    const label = job.phase === "queued" ? "En cola" : job.phase === "download" ? (job.total ? `${Math.round(p * 100)} %` : "Descargando") : job.phase === "error" ? "Error" : "Descomprimiendo";
    const w = job.phase === "download" ? p * 100 : job.phase === "queued" ? 0 : 100;
    return h("span", { class: `hb-job is-${job.phase}` }, h("span", { class: "hb-bar" }, h("i", { style: `width: ${w}%` })), h("small", { class: "hb-job-label" }, label));
  }

  /** tag: la etiqueta de la consola (donde se mezclan consolas). */
  function item(e, tag = true) {
    const key = jobKey(e);
    const job = jobs()[key];
    const got = installedOf(e);
    const shot = h("span", { class: "hb-shot", style: `--hb-hue: ${hueOf(e.title)}` });
    if (e.coverUrl) {
      const im = h("img", { src: e.coverUrl, alt: "", loading: "lazy", decoding: "async", draggable: "false" });
      im.addEventListener("error", () => im.replaceWith(h("b", { class: "hb-shot-title", "data-no-t": "" }, e.title)), { once: true });
      shot.append(im);
    } else shot.append(h("b", { class: "hb-shot-title", "data-no-t": "" }, e.title));
    if (tag && e.system) shot.append(sysTag(e.system));
    if (got) shot.append(h("span", { class: "hb-got", title: "En tu biblioteca" }, icon("check", "hb-got-ico")));
    if (job && ACTIVE.has(job.phase)) shot.append(bar(job));
    return h(
      "button",
      { class: `hb-item${got ? " is-got" : ""}`, "data-focus": "", "data-key": `c-${key}`, "data-job": key, onclick: () => openSheet(e) },
      shot,
      h(
        "span",
        { class: "hb-item-info" },
        h("b", { class: "hb-item-title", "data-no-t": "" }, e.title),
        h("small", { class: "hb-item-sub", "data-no-t": "" }, [e.size, e.region].filter(Boolean).join(" · ") || (e.system ? systemName(e.system) : "")),
      ),
    );
  }

  function gameCard(g, tag) {
    const running = ejg.game.isRunning(g.id);
    const ver = g.rom?.version ? `v${String(g.rom.version).replace(/^v/i, "")}` : null;
    const last = g.lastPlayed ? relative(g.lastPlayed) : null;
    return h(
      "button",
      { class: `hb-game${g.emulator ? "" : " no-emu"}${running ? " is-running" : ""}`, "data-focus": "", "data-key": `g-${g.id}`, "data-game-id": g.id, onclick: () => play(g) },
      h("span", { class: "hb-cover" }, artFor(g, "portrait"), tag ? sysTag(g.platform) : null, g.emulator ? null : h("span", { class: "hb-cover-warn", title: "Sin emulador" }, icon("warn", "hb-warn-ico"))),
      h(
        "span",
        { class: "hb-game-info" },
        h("b", { class: "hb-game-title", "data-no-t": "" }, g.title),
        h("small", { class: "hb-game-sub" }, running ? h("span", { class: "hb-live" }, "Jugando") : last ? last : h("span", { "data-no-t": "" }, systemName(g.platform)), ver ? h("span", { "data-no-t": "" }, ` · ${ver}`) : null),
      ),
    );
  }

  /** Una fila que se desliza (con flechas para el ratón). */
  function row(key, title, nodes, { more = null, extra = null, cls = "" } = {}) {
    const track = h("div", { class: "hb-track", "data-focus-group": `hb-${key}` }, ...nodes);
    const step = (d) => track.scrollBy({ left: d * track.clientWidth * 0.8, behavior: "smooth" });
    return h(
      "section",
      { class: `hb-row ${cls}`.trim(), "data-row": key },
      h(
        "div",
        { class: "hb-row-head" },
        h("h2", { "data-no-t": key.startsWith("plat:") ? "" : null }, title),
        extra,
        h(
          "span",
          { class: "hb-row-tools" },
          more,
          h("button", { class: "hb-arrow", tabindex: "-1", "aria-label": "Anterior", onclick: () => step(-1), html: ICONS.left }),
          h("button", { class: "hb-arrow", tabindex: "-1", "aria-label": "Siguiente", onclick: () => step(1), html: ICONS.right }),
        ),
      ),
      track,
    );
  }

  function skeleton(n = 6) {
    return Array.from({ length: n }, () => h("span", { class: "hb-item is-skel" }, h("span", { class: "hb-shot" }), h("span", { class: "hb-item-info" }, h("i"), h("i"))));
  }

  /** Fila de un catálogo: se pide al acercarse (las de cada consola) o enseguida. */
  function catalogRow(key, title, start, opts = {}) {
    const l = lists.get(key);
    if (!l && opts.eager) start();
    // Una consola sin juegos en el catálogo no ocupa sitio en el inicio.
    if (l && !l.loading && !l.entries.length && !l.error) return null;
    const tags = !key.startsWith("plat:");
    const nodes =
      !l || (l.loading && !l.entries.length)
        ? skeleton()
        : l.entries.length
          ? l.entries.slice(0, 24).map((e) => item(e, tags))
          : [h("p", { class: "hb-row-empty" }, tr("No se pudo cargar: {e}", { e: l.error }))];
    const r = row(key, title, nodes, opts);
    if (!l && !opts.eager) {
      r.dataset.lazy = key;
      r.__start = start;
    }
    return r;
  }

  function grid(entries, key, { more = false, loading = false, tags = true } = {}) {
    const g = h("div", { class: "hb-grid-items", "data-focus-group": key }, ...entries.map((e) => item(e, tags)), ...(loading ? skeleton(4) : []));
    const btn = more && !loading ? h("button", { class: "hb-btn hb-btn-ghost hb-more", "data-focus": "", "data-key": `more-${key}`, onclick: () => (s.view === "search" ? loadSearch(true) : loadPlatform(s.plat, true)) }, "Cargar más") : null;
    return [g, btn];
  }

  // ─── emuladores ───
  function emulatorModel() {
    const games = roms(ejg.library.all);
    const emus = new Map();
    for (const p of software(ejg.library.all)) {
      const info = infos.find((i) => i.gameId === p.id) || infos.find((i) => emuKey(i.name) === emuKey(p.title));
      emus.set(emuKey(p.title), { key: emuKey(p.title), name: p.title, game: p, info, platforms: new Set(info?.platforms || []), count: 0 });
    }
    for (const g of games) {
      if (!g.emulator) continue;
      const k = emuKey(g.emulator);
      if (!emus.has(k)) emus.set(k, { key: k, name: g.emulator.replace(/\s*\(.*\)$/, ""), game: null, info: null, platforms: new Set(), count: 0, external: true });
      const e = emus.get(k);
      e.platforms.add(g.platform);
      e.count++;
    }
    const systems = [...new Set(games.map((g) => g.platform))];
    const missing = systems.map((id) => ({ id, count: games.filter((g) => g.platform === id && !g.emulator).length })).filter((m) => m.count > 0);
    return { emus: [...emus.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), missing };
  }

  function emuCard(e) {
    const ico = e.game?.media?.icon;
    const running = e.game && ejg.game.isRunning(e.game.id);
    const plats = [...new Set([...(e.info?.platforms || []), ...e.platforms])];
    const ver = e.info?.version;
    return h(
      "button",
      { class: `hb-emu${e.external ? " is-external" : ""}${running ? " is-running" : ""}`, "data-focus": "", "data-key": `emu-${e.key}`, onclick: () => (e.game ? ejg.game.launch(e.game.id) : open("software")) },
      h("span", { class: "hb-emu-icon", style: `--hb-hue: ${hueOf(e.name)}` }, ico ? h("img", { src: ico, alt: "", draggable: "false" }) : h("span", { "data-no-t": "" }, initials(e.name))),
      h(
        "span",
        { class: "hb-emu-body" },
        h("b", { class: "hb-emu-name", "data-no-t": "" }, e.name),
        h(
          "span",
          { class: "hb-emu-meta" },
          running ? h("span", { class: "hb-live" }, "Abierto") : null,
          ver ? h("span", { "data-no-t": "" }, `v${String(ver).replace(/^v/i, "")}`) : e.external ? h("span", null, "Configurado a mano") : null,
          e.count ? h("span", null, e.count === 1 ? "1 juego" : tr("{n} juegos", { n: e.count })) : null,
        ),
        plats.length || e.info?.update
          ? h(
              "span",
              { class: "hb-emu-sys" },
              ...plats.slice(0, 5).map(sysTag),
              e.info?.update ? h("span", { class: "hb-pill hb-pill-up", title: e.info.latest ? `v${e.info.latest}` : "" }, icon("up", "hb-pill-ico"), "Actualización") : null,
            )
          : null,
      ),
    );
  }

  function missingCard(m) {
    return h(
      "button",
      { class: "hb-emu is-missing", "data-focus": "", "data-key": `miss-${m.id}`, onclick: () => open("software") },
      h("span", { class: "hb-emu-icon" }, icon("warn", "hb-warn-ico")),
      h(
        "span",
        { class: "hb-emu-body" },
        h("b", { class: "hb-emu-name" }, "Falta un emulador"),
        h("span", { class: "hb-emu-meta" }, h("span", { "data-no-t": "" }, systemName(m.id)), h("span", null, m.count === 1 ? "1 juego esperando" : tr("{n} juegos esperando", { n: m.count }))),
        h("span", { class: "hb-emu-sys" }, sysTag(m.id), h("span", { class: "hb-pill hb-pill-go" }, "Instalar")),
      ),
    );
  }

  function emulatorsSection() {
    const m = emulatorModel();
    const cards = [...m.emus.map(emuCard), ...m.missing.map(missingCard)];
    return h(
      "section",
      { class: "hb-sec hb-sec-emus" },
      h("div", { class: "hb-row-head" }, h("h2", null, "Tus emuladores"), h("span", { class: "hb-row-tools" }, h("button", { class: "hb-link", "data-focus": "", "data-key": "emus-store", onclick: () => open("software") }, "Descargar emuladores"))),
      cards.length
        ? h("div", { class: "hb-emus", "data-focus-group": "hb-emus" }, ...cards)
        : h(
            "div",
            { class: "hb-empty" },
            icon("chip", "hb-empty-ico"),
            h("b", null, "Aún no tienes emuladores"),
            h("p", null, "Instálalos desde ejGames: se configuran solos para sus consolas."),
            h("button", { class: "hb-btn", "data-focus": "", "data-key": "e-software", onclick: () => open("software") }, "Ver emuladores"),
          ),
    );
  }

  // ─── cabecera ───
  const input = h("input", { class: "hb-search-input", type: "search", placeholder: "Buscar juegos de consola", spellcheck: "false", autocomplete: "off", "data-focus": "", "data-key": "search" });
  let searchTimer = 0;
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search(input.value), 450);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      clearTimeout(searchTimer);
      if (ejg.input?.source === "gamepad") return void typeQuery();
      search(input.value);
    } else if (ev.key === "Escape" && input.value) {
      ev.stopPropagation();
      input.value = "";
      search("");
    }
  });
  /** Con mando, el teclado en pantalla del host. */
  async function typeQuery() {
    const v = await ejg.ui.keyboard?.({ title: "Buscar juegos de consola", value: s.query, maxLength: 80 });
    if (v == null) return;
    input.value = v;
    search(v);
  }
  input.addEventListener("click", () => ejg.input?.source === "gamepad" && typeQuery());

  function search(q) {
    s.query = q.trim();
    s.view = s.query ? "search" : s.plat ? "platform" : "front";
    if (s.query) loadSearch();
    paint();
  }

  function header() {
    const all = roms(ejg.library.all);
    const emus = software(ejg.library.all).length;
    const mine = new Map();
    for (const g of all) mine.set(g.platform, (mine.get(g.platform) || 0) + 1);
    const chip = (p, label, n) =>
      h(
        "button",
        {
          class: `hb-chip${(p ? s.plat?.system === p.system : !s.plat) ? " is-on" : ""}`,
          "data-focus": "",
          "data-key": `p-${p ? p.system : "all"}`,
          onclick: () => setPlat(p),
          style: p ? `--hb-hue: ${systemHue(p.system)}` : "",
        },
        h("span", { "data-no-t": p ? "" : null }, label),
        n ? h("small", null, String(n)) : null,
      );
    return h(
      "header",
      { class: "hb-top" },
      h(
        "div",
        { class: "hb-top-main" },
        h("h1", { class: "hb-title" }, "Homebrew"),
        h("p", { class: "hb-sub" }, h("span", null, all.length === 1 ? "1 juego" : tr("{n} juegos", { n: all.length })), h("span", null, emus === 1 ? "1 emulador" : tr("{n} emuladores", { n: emus }))),
      ),
      h("label", { class: "hb-search" }, icon("search", "hb-search-ico"), input),
      h(
        "div",
        { class: "hb-top-actions" },
        h("button", { class: "hb-btn hb-btn-ghost", "data-focus": "", "data-key": "a-software", onclick: () => open("software") }, icon("chip", "hb-btn-ico"), h("span", null, "Emuladores")),
        h("button", { class: "hb-btn hb-btn-ghost", "data-focus": "", "data-key": "a-import", onclick: () => open("rom-import") }, icon("folder", "hb-btn-ico"), h("span", null, "Importar ROMs")),
      ),
      h("nav", { class: "hb-chips", "data-focus-group": "hb-chips" }, chip(null, "Inicio"), ...platforms().map((p) => chip(p, p.name, mine.get(p.system)))),
    );
  }

  // ─── vistas ───
  function front() {
    const out = [];
    const js = Object.entries(jobs()).filter(([, j]) => ACTIVE.has(j.phase) || j.phase === "error");
    if (js.length)
      out.push(
        row(
          "jobs",
          "Descargando",
          js.map(([key, j]) =>
            h(
              "div",
              { class: `hb-dl is-${j.phase}`, "data-job": key },
              h("b", { class: "hb-dl-title", "data-no-t": "" }, j.name),
              bar(j),
              j.phase === "error" ? h("small", { class: "hb-dl-error" }, j.message || "") : h("small", { class: "hb-dl-size" }, j.total ? `${mb(j.received)} / ${mb(j.total)}` : ""),
              h("button", { class: "hb-link", "data-focus": "", "data-key": `cancel-${key}`, onclick: () => cat.cancel(key) }, j.phase === "error" ? "Quitar" : "Cancelar"),
            ),
          ),
          { cls: "hb-row-jobs" },
        ),
      );
    const mine = roms(ejg.library.all).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.sortTitle.localeCompare(b.sortTitle));
    const { missing } = emulatorModel();
    if (mine.length)
      out.push(
        row(
          "mine",
          "Tus juegos",
          mine.slice(0, 30).map((g) => gameCard(g, true)),
          {
            extra: missing.length
              ? h("button", { class: "hb-alert", "data-focus": "", "data-key": "missing", onclick: () => open("software") }, icon("warn", "hb-alert-ico"), h("span", null, tr("Falta emulador: {s}", { s: missing.map((m) => systemShort(m.id)).join(", ") })))
              : null,
          },
        ),
      );
    if (cat && s.sources.length) {
      out.push(catalogRow("popular", "Populares", () => loadFront("popular"), { eager: true }));
      out.push(catalogRow("newest", "Novedades", () => loadFront("newest"), { eager: true }));
      for (const p of platforms().filter((x) => x.id))
        out.push(catalogRow(`plat:${p.id}`, p.name, () => loadPlatform(p), { more: h("button", { class: "hb-link", "data-focus": "", "data-key": `all-${p.system}`, onclick: () => setPlat(p) }, "Ver todo") }));
    } else if (s.loaded)
      out.push(
        h(
          "div",
          { class: "hb-empty" },
          icon("pad", "hb-empty-ico"),
          h("b", null, "No hay catálogos de juegos"),
          h("p", null, "Añade una fuente en catalog-sources.json o importa tus propias ROMs."),
          h("button", { class: "hb-btn", "data-focus": "", "data-key": "e-import", onclick: () => open("rom-import") }, "Importar ROMs"),
        ),
      );
    out.push(emulatorsSection());
    return out;
  }

  function platformView() {
    const p = s.plat;
    const out = [];
    const mine = roms(ejg.library.all).filter((g) => g.platform === p.system);
    if (mine.length) out.push(row("mine", tr("Tus juegos de {p}", { p: p.name }), mine.map((g) => gameCard(g, false))));
    if (p.id && sourceFor(p.id)) {
      const key = `plat:${p.id}`;
      const l = lists.get(key);
      if (!l) loadPlatform(p);
      out.push(
        h(
          "section",
          { class: "hb-sec" },
          h("div", { class: "hb-row-head" }, h("h2", { "data-no-t": "" }, p.name)),
          ...grid(l?.entries || [], key, { more: l?.hasMore, loading: !l || l.loading, tags: false }),
          l?.error ? h("p", { class: "hb-row-empty" }, l.error) : l && !l.loading && !l.entries.length ? h("p", { class: "hb-row-empty" }, "No hay juegos aquí.") : null,
        ),
      );
    } else if (!mine.length) out.push(h("p", { class: "hb-row-empty" }, "No hay juegos aquí."));
    return out;
  }

  function searchView() {
    const key = `search:${s.plat?.id || ""}:${s.query}`;
    const l = lists.get(key);
    const mine = roms(ejg.library.all).filter((g) => norm(g.title).includes(norm(s.query)) && (!s.plat || g.platform === s.plat.system));
    const out = [];
    if (mine.length) out.push(row("mine", "En tu biblioteca", mine.map((g) => gameCard(g, true))));
    const n = l?.entries.length || 0;
    out.push(
      h(
        "section",
        { class: "hb-sec" },
        h("div", { class: "hb-row-head" }, h("h2", null, tr("Resultados para «{q}»", { q: s.query })), l && !l.loading ? h("span", { class: "hb-count" }, n === 1 ? "1 juego" : tr("{n} juegos", { n })) : null),
        ...grid(l?.entries || [], key, { more: l?.hasMore, loading: !l || l.loading }),
        l && !l.loading && !n ? h("p", { class: "hb-row-empty" }, l.error || "No hay resultados.") : null,
      ),
    );
    return out;
  }

  // ─── ficha ───
  let sheetEl = null;
  async function openSheet(e) {
    s.sheet = { entry: e, data: null, error: null, from: focus?.current || null };
    paintSheet();
    try {
      const d = await cat.detail(e.sourceId, e.id);
      if (s.sheet?.entry === e) s.sheet.data = d;
    } catch (err) {
      if (s.sheet?.entry === e) s.sheet.error = String(err?.message || err);
    }
    if (s.sheet?.entry === e) paintSheet(true);
  }

  function closeSheet() {
    const from = s.sheet?.from;
    s.sheet = null;
    sheetEl?.remove();
    sheetEl = null;
    if (focus && from?.isConnected) focus.focus(from, { silent: true });
    else if (focus) focus.first(view);
    onChange();
  }

  async function download(e, l) {
    try {
      const r = await cat.download(e.sourceId, e.id, l.url);
      if (r === "opened") ejg.ui.toast("Se ha abierto la web de descarga en el navegador");
    } catch (err) {
      ejg.ui.toast(String(err?.message || err), "error");
    }
  }

  function sheetActions(sh, key) {
    const job = jobs()[key];
    const gotId = installedOf(sh.entry) || sh.data?.installedGameId;
    const game = gotId && ejg.library.byId(gotId);
    const links = sh.data?.links || [];
    if (game)
      return [
        h("button", { class: "hb-btn hb-btn-big", "data-focus": "", "data-key": "s-play", onclick: () => (closeSheet(), play(game)) }, icon("play", "hb-btn-ico"), h("span", null, "Jugar")),
        h("button", { class: "hb-btn hb-btn-ghost hb-btn-big", "data-focus": "", "data-key": "s-del", onclick: () => ejg.game.uninstall(game.id) }, icon("trash", "hb-btn-ico"), h("span", null, "Borrar")),
      ];
    if (job && ACTIVE.has(job.phase))
      return [
        h("div", { class: "hb-sheet-job", "data-job": key }, bar(job), h("small", { class: "hb-dl-size" }, job.total ? `${mb(job.received)} / ${mb(job.total)}` : "")),
        h("button", { class: "hb-btn hb-btn-ghost", "data-focus": "", "data-key": "s-cancel", onclick: () => cat.cancel(key) }, "Cancelar"),
      ];
    if (!sh.data && !sh.error) return [h("span", { class: "hb-loading" }, "Buscando las descargas…")];
    if (!links.length) return [h("p", { class: "hb-row-empty" }, sh.error || "Esta ficha no tiene descargas.")];
    const [first, ...rest] = links;
    const label = (l) => [l.label, l.host].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ");
    return [
      job?.phase === "error" ? h("p", { class: "hb-dl-error" }, job.message || "") : null,
      h(
        "button",
        { class: "hb-btn hb-btn-big", "data-focus": "", "data-key": "s-dl", onclick: () => download(sh.entry, first) },
        icon(first.kind === "page" ? "link" : "down", "hb-btn-ico"),
        h("span", null, first.kind === "page" ? "Abrir la descarga" : "Descargar"),
        first.size ? h("small", { "data-no-t": "" }, first.size) : null,
      ),
      rest.length
        ? h(
            "div",
            { class: "hb-mirrors" },
            h("small", null, "Otros servidores"),
            ...rest.map((l, i) => h("button", { class: "hb-mirror", "data-focus": "", "data-key": `s-m${i}`, onclick: () => download(sh.entry, l) }, h("span", { "data-no-t": "" }, label(l)), icon(l.kind === "page" ? "link" : "down", "hb-mirror-ico"))),
          )
        : null,
    ];
  }

  function paintSheet(keepFocus = false) {
    const sh = s.sheet;
    if (!sh) return;
    const e = sh.data || sh.entry;
    const key = jobKey(sh.entry);
    // Si estaba en la ✕ (lo primero mientras carga), al botón principal.
    const had = keepFocus && focus?.current && sheetEl?.contains(focus.current) && focus.current.dataset.key !== "s-close" ? focus.current.dataset.key : null;
    const facts = [e.region, e.language, e.size, e.version && `v${String(e.version).replace(/^v/i, "")}`].filter(Boolean).map((x) => h("span", { class: "hb-fact", "data-no-t": "" }, x));
    const shots = (sh.data?.screenshots || []).slice(0, 8);
    const box = h(
      "div",
      { class: "hb-sheet-box" },
      h("button", { class: "hb-sheet-close", "data-focus": "", "data-key": "s-close", "aria-label": "Cerrar", onclick: closeSheet, html: ICONS.close }),
      h("div", { class: "hb-sheet-hero" }, e.coverUrl ? h("img", { src: e.coverUrl, alt: "", draggable: "false" }) : h("b", { class: "hb-shot-title", "data-no-t": "" }, e.title)),
      h(
        "div",
        { class: "hb-sheet-main" },
        h("div", { class: "hb-facts" }, e.system ? sysTag(e.system) : null, e.system ? h("span", { class: "hb-fact-sys", "data-no-t": "" }, systemName(e.system)) : null),
        h("h2", { class: "hb-sheet-title", "data-no-t": "" }, e.title),
        facts.length ? h("div", { class: "hb-facts" }, ...facts) : null,
        h("div", { class: "hb-sheet-actions", "data-focus-group": "hb-sheet-actions" }, ...sheetActions(sh, key).filter(Boolean)),
        e.emulator
          ? h("p", { class: "hb-sheet-note" }, h("span", null, "Se juega con"), " ", h("b", { "data-no-t": "" }, e.emulator))
          : e.system
            ? h("button", { class: "hb-alert", "data-focus": "", "data-key": "s-emu", onclick: () => open("software") }, icon("warn", "hb-alert-ico"), h("span", null, "Necesita un emulador: instálalo"))
            : null,
        e.description ? h("p", { class: "hb-sheet-desc", "data-no-t": "" }, e.description) : null,
      ),
      shots.length ? h("div", { class: "hb-shots" }, ...shots.map((u) => h("img", { src: u, alt: "", loading: "lazy", draggable: "false" }))) : null,
    );
    const el = h("div", { class: `hb-sheet hb-layout-${layout}`, "data-focus-trap": "" }, h("div", { class: "hb-sheet-bg", style: e.coverUrl ? `background-image: url("${e.coverUrl}")` : "" }), box);
    el.addEventListener("mousedown", (ev) => ev.target === el && closeSheet());
    if (sheetEl) sheetEl.replaceWith(el);
    else view.append(el);
    sheetEl = el;
    if (focus) {
      const again = had && el.querySelector(`[data-key="${CSS.escape(had)}"]`);
      focus.focus(again || el.querySelector('[data-key="s-dl"], [data-key="s-play"], [data-key="s-cancel"]') || el.querySelector("[data-focus]"), { silent: true });
    }
    onChange();
  }

  // ─── pintar ───
  function paint() {
    if (destroyed) return;
    const had = focus?.current && view.contains(focus.current) && !sheetEl?.contains(focus.current) ? focus.current.dataset.key : null;
    const sc = scroller();
    const top = sc?.scrollTop ?? 0;
    const tracks = new Map([...view.querySelectorAll(".hb-row[data-row]")].map((r) => [r.dataset.row, r.querySelector(".hb-track")?.scrollLeft || 0]));
    const typing = document.activeElement === input;
    const body = s.view === "search" ? searchView() : s.view === "platform" ? platformView() : front();
    view.replaceChildren(header(), h("div", { class: "hb-body" }, ...body.filter(Boolean)));
    if (sheetEl) view.append(sheetEl);
    if (input.value.trim() !== s.query) input.value = s.query;
    if (typing) input.focus();
    for (const [k, x] of tracks) {
      const t = view.querySelector(`.hb-row[data-row="${CSS.escape(k)}"] .hb-track`);
      if (t) t.scrollLeft = x;
    }
    if (sc) sc.scrollTop = top;
    watchLazy();
    jobSig = sigOf();
    if (focus && !sheetEl) {
      const again = had && view.querySelector(`[data-key="${CSS.escape(had)}"]`);
      if (again) focus.focus(again, { noScroll: true, silent: true });
      else if (!focus.current || !focus.current.isConnected || !view.contains(focus.current)) focus.first(view);
    }
    onChange();
  }

  /** Las filas de cada consola se piden al acercarse a la vista. */
  function watchLazy() {
    observer?.disconnect();
    const rows = [...view.querySelectorAll("[data-lazy]")];
    if (!rows.length) return;
    observer = new IntersectionObserver(
      (es) => {
        for (const en of es) {
          if (!en.isIntersecting) continue;
          observer.unobserve(en.target);
          en.target.__start?.();
        }
      },
      { rootMargin: "600px 0px" },
    );
    rows.forEach((r) => observer.observe(r));
  }

  function scroller() {
    let el = view.parentElement;
    while (el && el !== document.body && el.scrollHeight <= el.clientHeight) el = el.parentElement;
    return el && el !== document.body ? el : null;
  }

  function setPlat(p) {
    s.plat = p;
    s.view = s.query ? "search" : p ? "platform" : "front";
    if (s.query) loadSearch();
    paint();
    const chip = view.querySelector(`[data-key="p-${CSS.escape(p ? p.system : "all")}"]`);
    if (chip && focus) focus.focus(chip, { silent: true });
  }

  // Descargas: las barras se mueven en su sitio; si cambia qué se baja, se repinta.
  const sigOf = () =>
    Object.entries(jobs())
      .map(([k, j]) => `${k}:${ACTIVE.has(j.phase) ? "a" : j.phase}`)
      .sort()
      .join(",");
  function onJobs() {
    if (sigOf() !== jobSig) {
      paint();
      if (s.sheet) paintSheet(true);
      return;
    }
    for (const [key, j] of Object.entries(jobs())) {
      const els = [...view.querySelectorAll(`[data-job="${CSS.escape(key)}"]`)];
      for (const el of els) {
        el.querySelector(".hb-job")?.replaceWith(bar(j));
        const size = el.querySelector(".hb-dl-size");
        if (size) size.textContent = j.total ? `${mb(j.received)} / ${mb(j.total)}` : "";
      }
    }
  }

  // Las pistas dependen de lo enfocado (X borra los juegos de la biblioteca): el motor de foco
  // marca el elemento con data-focused.
  let wasGame = false;
  const focusWatch = new MutationObserver(() => {
    const now = !!focusedGame();
    if (now !== wasGame) {
      wasGame = now;
      onChange();
    }
  });
  focusWatch.observe(view, { subtree: true, attributes: true, attributeFilter: ["data-focused"] });
  const offs = [ejg.on("library", () => (paint(), s.sheet && paintSheet(true))), ejg.game.onState(() => paint()), cat?.onJobs?.(onJobs)];
  paint();
  emulatorList(ejg).then((list) => {
    infos = list || [];
    paint();
  });
  (cat ? cat.state().catch(() => ({ sources: [] })) : Promise.resolve({ sources: [] })).then((st) => {
    s.sources = st.sources || [];
    s.loaded = true;
    paint();
  });

  const focusedGame = () => {
    const id = Number(focus?.current?.closest?.("[data-game-id]")?.dataset.gameId);
    return id ? ejg.library.byId(id) : null;
  };

  return {
    nav(a) {
      if (s.sheet) {
        if (a === "back") return closeSheet(), true;
        return a === "lb" || a === "rb" || a === "y" || a === "x";
      }
      if (a === "back") {
        if (s.view !== "front") {
          input.value = "";
          s.query = "";
          setPlat(null);
          return true;
        }
        return onExit() !== false;
      }
      if (a === "y") {
        open("software");
        return true;
      }
      if (a === "x") {
        const g = focusedGame();
        if (!g) return false;
        ejg.game.uninstall(g.id);
        return true;
      }
      if (a === "lb" || a === "rb") {
        const ps = [null, ...platforms()];
        if (ps.length < 2) return false;
        const i = Math.max(0, ps.findIndex((p) => (p ? s.plat?.system === p.system : !s.plat)));
        setPlat(ps[(i + (a === "rb" ? 1 : ps.length - 1)) % ps.length]);
        return true;
      }
      return false;
    },
    hints() {
      if (s.sheet) return [["accept", "Elegir"], ["back", "Cerrar"]];
      return [["accept", "Abrir"], ...(focusedGame() ? [["x", "Borrar"]] : []), ["lb", "Consola"], ["y", "Emuladores"], ["back", "Atrás"]];
    },
    /** Vuelve a pedir los emuladores (versiones nuevas) y repinta. */
    refresh() {
      emulatorList(ejg, true).then((list) => {
        infos = list || [];
        paint();
      });
    },
    destroy() {
      destroyed = true;
      clearTimeout(searchTimer);
      observer?.disconnect();
      focusWatch.disconnect();
      offs.forEach((off) => typeof off === "function" && off());
      sheetEl?.remove();
      view.remove();
    },
  };
}
