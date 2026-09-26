// Pistas de controles que se adaptan a lo que estés usando: mando de Xbox,
// PlayStation, Nintendo (o genérico) o teclado. Cambian solas al cambiar de
// dispositivo (evento "input" del SDK).

/** Glifos por acción. [texto, color de fondo o null, forma] */
export const GLYPHS = {
  xbox: {
    accept: ["A", "#3fa142"], back: ["B", "#d23d3d"], x: ["X", "#2d7fd3"], y: ["Y", "#e0b020"],
    lb: ["LB"], rb: ["RB"], lt: ["LT"], rt: ["RT"], menu: ["☰"], view: ["⧉"], home: ["Guía"],
    up: ["↑"], down: ["↓"], left: ["←"], right: ["→"],
  },
  playstation: {
    accept: ["✕", "#6f9ce8"], back: ["○", "#e0626b"], x: ["□", "#d985c9"], y: ["△", "#3fbfa4"],
    lb: ["L1"], rb: ["R1"], lt: ["L2"], rt: ["R2"], menu: ["OPTIONS"], view: ["CREATE"], home: ["PS"],
    up: ["↑"], down: ["↓"], left: ["←"], right: ["→"],
  },
  // Nintendo: por posición física (el de abajo es B, el de la derecha A).
  nintendo: {
    accept: ["B"], back: ["A"], x: ["Y"], y: ["X"],
    lb: ["L"], rb: ["R"], lt: ["ZL"], rt: ["ZR"], menu: ["+"], view: ["−"], home: ["⌂"],
    up: ["↑"], down: ["↓"], left: ["←"], right: ["→"],
  },
  keyboard: {
    accept: ["Enter"], back: ["Esc"], x: ["E"], y: ["F"],
    lb: ["RePág"], rb: ["AvPág"], lt: ["Inicio"], rt: ["Fin"], menu: ["Ctrl K"], view: ["Ctrl F"], home: ["Ctrl K"],
    up: ["↑"], down: ["↓"], left: ["←"], right: ["→"],
  },
};

/** Conjunto de glifos para el dispositivo actual. */
export function glyphSet(source, pad) {
  if (source === "gamepad") return GLYPHS[pad] || GLYPHS.xbox;
  return GLYPHS.keyboard;
}

function currentSet() {
  const ejg = window.ejg;
  return glyphSet(ejg?.input?.source, ejg?.input?.pad);
}

/** <span> con el glifo de una acción (estilos en línea; clases para personalizar). */
export function glyph(action, set = currentSet()) {
  const [txt, color] = set[action] || [action];
  const el = document.createElement("span");
  el.className = "ejg-glyph";
  el.dataset.action = action;
  el.textContent = txt;
  const round = txt.length <= 1 && set !== GLYPHS.keyboard;
  Object.assign(el.style, {
    display: "inline-grid",
    placeItems: "center",
    minWidth: "1.7em",
    height: "1.7em",
    padding: round ? "0" : "0 .45em",
    borderRadius: round ? "50%" : ".45em",
    fontSize: ".78em",
    fontWeight: "700",
    lineHeight: "1",
    verticalAlign: "middle",
    marginRight: ".45em",
    boxSizing: "border-box",
    color: color ? "#fff" : "currentColor",
    background: color || "transparent",
    border: color ? "none" : "1.5px solid currentColor",
    opacity: color ? "1" : ".9",
    fontFamily: "system-ui, 'Segoe UI', sans-serif",
  });
  if (set === GLYPHS.playstation && color) {
    // Mandos PlayStation: símbolo de color sobre fondo oscuro.
    Object.assign(el.style, { background: "rgba(0,0,0,.55)", color, border: `1.5px solid ${color}` });
  }
  return el;
}

/**
 * Barra de pistas que se actualiza sola.
 * @param {HTMLElement} container
 * @param {[string, string][]} items  [[acción, texto], …]
 * @returns {{ set(items: [string, string][]): void }}
 */
export function hints(container, items) {
  let current = items;
  function render() {
    const set = currentSet();
    container.replaceChildren(
      ...current.map(([action, label]) => {
        const span = document.createElement("span");
        span.className = "ejg-hint";
        span.style.whiteSpace = "nowrap";
        span.append(glyph(action, set), document.createTextNode(label));
        return span;
      }),
    );
  }
  render();
  window.ejg?.on("input", render);
  return {
    set(next) {
      current = next;
      render();
    },
  };
}
