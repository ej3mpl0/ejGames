// Homebrew para temas: tus emuladores y tus juegos de consola (ROMs propias,
// homebrew y lo bajado de los catálogos), aparte de la biblioteca, con accesos a
// la tienda de emuladores, los catálogos de ROMs, la tienda de homebrew e
// Importar ROMs. Con mando: LB/RB cambia de sistema e Y abre los emuladores.
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
  psx: ["PS1", 220], ps2: ["PS2", 225], ps3: ["PS3", 230], psp: ["PSP", 215], vita: ["Vita", 205],
  xbox: ["Xbox", 120], xbox360: ["360", 110],
  genesis: ["MD", 10], saturn: ["SAT", 30], dreamcast: ["DC", 25], sms: ["SMS", 5], gg: ["GG", 15],
  arcade: ["ARC", 300], pce: ["PCE", 60], wonderswan: ["WS", 170],
};
export const systemShort = (id) => (SYS[id] ? SYS[id][0] : String(id || "").toUpperCase());
export const systemHue = (id) => (SYS[id] ? SYS[id][1] : hueOf(id));

const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  chip: I('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
  books: I('<path d="M4 19V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v14M9 19V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12"/><path d="m14.5 7.5 2.9-.8a1 1 0 0 1 1.2.7l3 11.1M3 19h18"/>'),
  spark: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>'),
  folder: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  pad: I('<path d="M7 9h10a4 4 0 0 1 4 4v.6a3.4 3.4 0 0 1-6 2.2L14 15h-4l-1 .8a3.4 3.4 0 0 1-6-2.2V13a4 4 0 0 1 4-4Z"/><path d="M8 11.5v3M6.5 13h3"/><circle cx="16" cy="12.5" r=".6"/><circle cx="17.6" cy="14.1" r=".6"/>'),
  up: I('<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>'),
  warn: I('<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5M12 17v.4"/>'),
  play: I('<path d="M8 5.5v13l10.5-6.5Z"/>'),
};
const icon = (name, cls) => h("span", { class: cls, html: ICONS[name] });

/** Emulador de un juego («Eden», «RetroArch (Snes9x)»…) → clave para emparejarlo con su programa. */
const emuKey = (name) => norm(String(name || "").replace(/\(.*\)/, ""));

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
 *   onGame: abrir la ficha del tema de un juego de consola (sin él, se juega).
 * @returns {{ nav: (a: string) => boolean, hints: () => [string, string][], refresh: () => void, destroy: () => void }}
 */
export function createHomebrewView({ ejg, root, focus = null, layout: wanted = "steam", onExit = () => {}, onChange = () => {}, onGame = null }) {
  const layout = HOMEBREW_LAYOUTS.includes(wanted) ? wanted : "steam";
  const view = h("div", { class: `hb-view hb-layout-${layout}` });
  root.replaceChildren(view);
  let sys = "all";
  let infos = [];
  let destroyed = false;

  const open = (name, args) => ejg.ui.open(name, args);
  const play = (g) => (onGame ? onGame(g) : ejg.game.launch(g.id));

  function model() {
    const games = roms(ejg.library.all);
    const progs = software(ejg.library.all);
    const systems = new Map();
    for (const g of games) systems.set(g.platform, (systems.get(g.platform) || 0) + 1);
    // Emuladores: los instalados desde la tienda y los que se usan sin estar en ella (los de Ajustes).
    const emus = new Map();
    for (const p of progs) {
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
    const missing = [...systems.keys()]
      .map((id) => ({ id, count: games.filter((g) => g.platform === id && !g.emulator).length }))
      .filter((m) => m.count > 0);
    const order = [...systems.entries()].sort((a, b) => systemName(a[0]).localeCompare(systemName(b[0])));
    return { games, emus: [...emus.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), systems: order, missing };
  }

  // ─── piezas ───
  function action(key, ico, title, sub, run) {
    return h(
      "button",
      { class: "hb-action", "data-focus": "", "data-key": key, onclick: run },
      icon(ico, "hb-action-ico"),
      h("span", { class: "hb-action-text" }, h("b", null, title), h("small", null, sub)),
    );
  }

  function sysTag(id) {
    return h("span", { class: "hb-sys", style: `--hb-hue: ${systemHue(id)}`, title: systemName(id), "data-no-t": "" }, systemShort(id));
  }

  function emuCard(e) {
    const ico = e.game?.media?.icon;
    const running = e.game && ejg.game.isRunning(e.game.id);
    const plats = [...new Set([...(e.info?.platforms || []), ...e.platforms])];
    const ver = e.info?.version;
    return h(
      "button",
      {
        class: `hb-emu${e.external ? " is-external" : ""}${running ? " is-running" : ""}`,
        "data-focus": "",
        "data-key": `emu-${e.key}`,
        onclick: () => (e.game ? ejg.game.launch(e.game.id) : open("software")),
      },
      h(
        "span",
        { class: "hb-emu-icon", style: `--hb-hue: ${hueOf(e.name)}` },
        ico ? h("img", { src: ico, alt: "", draggable: "false" }) : h("span", { "data-no-t": "" }, initials(e.name)),
      ),
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

  /** tags: la etiqueta del sistema en cada carátula (donde se mezclan sistemas). */
  function grid(list, key, tags = false) {
    return h("div", { class: "hb-grid", "data-focus-group": key }, ...list.map((g) => gameCard(g, tags)));
  }

  function hero(m) {
    const stat = (n, one, many) => h("div", { class: "hb-stat" }, h("b", null, String(n)), h("span", null, n === 1 ? one : many));
    return h(
      "header",
      { class: "hb-hero" },
      h("div", { class: "hb-hero-art", "aria-hidden": "true" }, icon("pad", "hb-hero-pad")),
      h(
        "div",
        { class: "hb-hero-main" },
        h("h1", { class: "hb-title" }, "Homebrew"),
        h("p", { class: "hb-sub" }, "Tus emuladores y tus juegos de consola, en un solo sitio."),
        h("div", { class: "hb-stats" }, stat(m.emus.filter((e) => e.game).length, "emulador", "emuladores"), stat(m.games.length, "juego", "juegos"), stat(m.systems.length, "sistema", "sistemas")),
      ),
      h(
        "nav",
        { class: "hb-actions", "data-focus-group": "hb-actions" },
        action("a-software", "chip", "Emuladores", "Descargar y actualizar", () => open("software")),
        action("a-catalogs", "books", "Catálogos de ROMs", "Juegos para tus consolas", () => open("catalogs")),
        action("a-homebrew", "spark", "Tienda homebrew", "Apps para Switch, Vita y 3DS", () => open("homebrew")),
        action("a-import", "folder", "Importar ROMs", "Desde una carpeta del PC", () => open("rom-import")),
      ),
    );
  }

  function emulators(m) {
    const cards = [...m.emus.map(emuCard), ...m.missing.map(missingCard)];
    const installed = m.emus.filter((e) => e.game).length;
    return h(
      "section",
      { class: "hb-sec hb-sec-emus" },
      h("div", { class: "hb-sec-head" }, h("h2", null, "Emuladores"), installed ? h("span", { class: "hb-count" }, installed === 1 ? "1 instalado" : tr("{n} instalados", { n: installed })) : null),
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

  function games(m) {
    const head = h("div", { class: "hb-sec-head" }, h("h2", null, "Juegos de consola"), m.games.length ? h("span", { class: "hb-count" }, m.games.length === 1 ? "1 juego" : tr("{n} juegos", { n: m.games.length })) : null);
    if (!m.games.length)
      return h(
        "section",
        { class: "hb-sec hb-sec-games" },
        head,
        h(
          "div",
          { class: "hb-empty" },
          icon("pad", "hb-empty-ico"),
          h("b", null, "Aún no tienes juegos de consola"),
          h("p", null, "Descárgalos de los catálogos o importa tus propias ROMs."),
          h(
            "div",
            { class: "hb-empty-actions" },
            h("button", { class: "hb-btn", "data-focus": "", "data-key": "e-catalogs", onclick: () => open("catalogs") }, "Catálogos de ROMs"),
            h("button", { class: "hb-btn hb-btn-ghost", "data-focus": "", "data-key": "e-import", onclick: () => open("rom-import") }, "Importar ROMs"),
          ),
        ),
      );
    if (sys !== "all" && !m.systems.some(([id]) => id === sys)) sys = "all";
    const chip = (id, label, n) =>
      h(
        "button",
        { class: `hb-chip${sys === id ? " is-on" : ""}`, "data-focus": "", "data-key": `s-${id}`, "aria-pressed": String(sys === id), onclick: () => setSys(id), style: id === "all" ? "" : `--hb-hue: ${systemHue(id)}` },
        h("span", { "data-no-t": id === "all" ? null : "" }, label),
        h("small", null, String(n)),
      );
    const chips = m.systems.length > 1 ? h("div", { class: "hb-chips", "data-focus-group": "hb-sys" }, chip("all", "Todos", m.games.length), ...m.systems.map(([id, n]) => chip(id, systemName(id), n))) : null;
    const body = [];
    if (sys === "all") {
      const recent = m.games.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 6);
      if (recent.length && m.games.length > 6) body.push(h("div", { class: "hb-group hb-group-recent" }, h("h3", { class: "hb-group-title" }, "Seguir jugando"), grid(recent, "hb-recent", true)));
      for (const [id, n] of m.systems) {
        const list = m.games.filter((g) => g.platform === id);
        const emu = list.find((g) => g.emulator)?.emulator;
        body.push(
          h(
            "div",
            { class: "hb-group", style: `--hb-hue: ${systemHue(id)}` },
            h(
              "h3",
              { class: "hb-group-title" },
              sysTag(id),
              h("span", { "data-no-t": "" }, systemName(id)),
              h("small", null, n === 1 ? "1 juego" : tr("{n} juegos", { n })),
              h("small", { class: emu ? "hb-group-emu" : "hb-group-emu is-missing" }, emu ? h("span", { "data-no-t": "" }, emu) : "Sin emulador"),
            ),
            grid(list, `hb-sys-${id}`),
          ),
        );
      }
    } else body.push(grid(m.games.filter((g) => g.platform === sys), `hb-sys-${sys}`));
    return h("section", { class: "hb-sec hb-sec-games" }, head, chips, ...body);
  }

  // ─── pintar ───
  function paint() {
    if (destroyed) return;
    const had = focus?.current && view.contains(focus.current) ? focus.current.dataset.key : null;
    const sc = scroller();
    const top = sc?.scrollTop ?? 0;
    const m = model();
    view.replaceChildren(hero(m), h("div", { class: "hb-body" }, emulators(m), games(m)));
    if (sc) sc.scrollTop = top;
    if (focus) {
      const again = had && view.querySelector(`[data-key="${CSS.escape(had)}"]`);
      if (again) focus.focus(again, { noScroll: true, silent: true });
      else if (!focus.current || !focus.current.isConnected || !view.contains(focus.current)) focus.first(view);
    }
    onChange();
  }

  function scroller() {
    let el = view.parentElement;
    while (el && el !== document.body && el.scrollHeight <= el.clientHeight) el = el.parentElement;
    return el && el !== document.body ? el : null;
  }

  function setSys(id) {
    if (sys === id) return;
    sys = id;
    paint();
    const chip = view.querySelector(`[data-key="s-${CSS.escape(id)}"]`);
    if (chip && focus) focus.focus(chip, { silent: true });
  }

  const offs = [ejg.on("library", () => paint()), ejg.game.onState(() => paint())];
  paint();
  emulatorList(ejg).then((list) => {
    infos = list || [];
    paint();
  });

  return {
    nav(a) {
      if (a === "back") return onExit() !== false;
      if (a === "y") {
        open("software");
        return true;
      }
      if (a === "lb" || a === "rb") {
        const ids = ["all", ...model().systems.map(([id]) => id)];
        if (ids.length < 3) return false;
        const i = Math.max(0, ids.indexOf(sys));
        setSys(ids[(i + (a === "rb" ? 1 : ids.length - 1)) % ids.length]);
        return true;
      }
      return false;
    },
    hints: () => [["accept", "Abrir"], ...(model().systems.length > 1 ? [["lb", "Sistema"]] : []), ["y", "Emuladores"], ["back", "Atrás"]],
    /** Vuelve a pedir los emuladores (versiones nuevas) y repinta. */
    refresh() {
      emulatorList(ejg, true).then((list) => {
        infos = list || [];
        paint();
      });
    },
    destroy() {
      destroyed = true;
      offs.forEach((off) => typeof off === "function" && off());
      view.remove();
    },
  };
}
