// Pixelado de imágenes: se reducen a pocos píxeles y a la paleta elegida.
// Lo usan la carátula de la biblioteca y la tienda.

/** Píxeles de la carátula 2:3 según el ajuste «Carátulas pixeladas». */
export const SIZES = { low: [160, 240], medium: [84, 126], high: [44, 66] };
// Píxeles de pantalla por píxel de imagen (misma rejilla en todas las imágenes).
const DENSITY = { low: 1.7, medium: 3.2, high: 6.1 };

export function cssColor(v) {
  const c = document.createElement("canvas").getContext("2d");
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const hex = c.fillStyle;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** drawImage que rellena el lienzo recortando (como object-fit: cover). */
export function drawCover(ctx, im, w, hh) {
  const s = Math.max(w / im.naturalWidth, hh / im.naturalHeight);
  const sw = w / s;
  const sh = hh / s;
  ctx.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 4, sw, sh, 0, 0, w, hh);
}

/** `shades` (de oscuro a claro, [r,g,b]) por luminancia: tantos tonos como haya. */
export function tones(ctx, w, hh, shades) {
  let data;
  try {
    data = ctx.getImageData(0, 0, w, hh);
  } catch {
    return;
  }
  const d = data.data;
  const n = shades.length;
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
    const s = shades[Math.min(n - 1, Math.floor(l * n))];
    d[i] = s[0];
    d[i + 1] = s[1];
    d[i + 2] = s[2];
  }
  ctx.putImageData(data, 0, 0);
}

/** Paletas monocromas: 4 tonos por luminancia. Resto (y en un evento): posterizado a 4 niveles por canal. */
export function quantize(ctx, w, hh) {
  const p = window.ejg.settings.palette || "arcade";
  if (!window.ejg.season.id && (p === "gameboy" || p === "phosphor" || p === "amber"))
    return tones(ctx, w, hh, [cssColor("--bg"), cssColor("--dim"), cssColor("--fg"), cssColor("--hi")]);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, hh);
  } catch {
    return; // lienzo "manchado": se queda solo pixelado
  }
  const d = data.data;
  const q = (v) => Math.round(v / 85) * 85;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = q(d[i]);
    d[i + 1] = q(d[i + 1]);
    d[i + 2] = q(d[i + 2]);
  }
  ctx.putImageData(data, 0, 0);
}

const cache = new Map();
function load(url) {
  if (!cache.has(url)) {
    if (cache.size > 120) cache.delete(cache.keys().next().value);
    cache.set(
      url,
      new Promise((ok, fail) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.decoding = "async";
        im.onload = () => ok(im);
        im.onerror = () => (cache.delete(url), fail(new Error("img")));
        im.src = url;
      }),
    );
  }
  return cache.get(url);
}

/**
 * Pinta `url` pixelado en `canvas`, con la misma rejilla que la biblioteca.
 * `url` puede ser una lista (se usa la primera que cargue). `ratio` =
 * ancho/alto del marco. Sin pixelado, se pinta a su tamaño real.
 */
export async function pixelate(canvas, url, ratio) {
  const my = (canvas.__px = (canvas.__px || 0) + 1);
  let im;
  for (const u of [].concat(url).filter(Boolean)) {
    try {
      im = await load(u);
      break;
    } catch {}
  }
  if (!im) return;
  if (my !== canvas.__px || !canvas.isConnected) return;
  const mode = window.ejg.settings.pixelate || "medium";
  const cw = canvas.clientWidth || 160;
  let w, hh;
  if (mode === "off") {
    w = Math.round(cw * devicePixelRatio);
  } else if (ratio === 2 / 3 && cw < 420) {
    w = (SIZES[mode] || SIZES.medium)[0];
  } else {
    w = Math.max(16, Math.round(cw / (DENSITY[mode] || DENSITY.medium)));
  }
  hh = Math.max(1, Math.round(w / ratio));
  canvas.width = w;
  canvas.height = hh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  drawCover(ctx, im, w, hh);
  if (mode !== "off") quantize(ctx, w, hh);
}
