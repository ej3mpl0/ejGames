// Arte que encaja en cualquier marco sin recortar logos ni deformar:
//   portrait  (2:3)   → carátula; si no hay, fondo difuminado + logo/cabecera.
//   square    (1:1)   → fondo (hero) + logo encima; si no, carátula centrada arriba.
//   landscape (16:9)  → fondo (hero) + logo encima; si no, cabecera; si no, carátula
//                        centrada sobre su propia versión difuminada.
// El elemento devuelto ocupa todo su contenedor (position:absolute; inset:0).

import { hueOf } from "./dom.js";

const abs = { position: "absolute", inset: "0", width: "100%", height: "100%" };

function image(src, style, cls, onFail) {
  const im = document.createElement("img");
  im.decoding = "async";
  im.loading = "lazy";
  im.draggable = false;
  im.alt = "";
  im.className = cls;
  Object.assign(im.style, style);
  im.addEventListener("error", () => (onFail ? onFail(im) : im.remove()), { once: true });
  im.src = src;
  return im;
}

function titleText(title, shape) {
  const t = document.createElement("div");
  t.className = "ejg-art-title";
  t.textContent = title;
  Object.assign(t.style, {
    position: "absolute",
    left: "8%",
    right: "8%",
    bottom: shape === "portrait" ? "8%" : "10%",
    color: "#fff",
    fontWeight: "800",
    fontSize: shape === "portrait" ? "1.05em" : "1.15em",
    lineHeight: "1.15",
    textAlign: shape === "square" ? "center" : "left",
    textShadow: "0 2px 12px rgba(0,0,0,.85)",
    overflow: "hidden",
    display: "-webkit-box",
    webkitLineClamp: "3",
    webkitBoxOrient: "vertical",
  });
  return t;
}

function shade(shape) {
  const d = document.createElement("div");
  d.className = "ejg-art-shade";
  Object.assign(d.style, abs, {
    background:
      shape === "landscape"
        ? "linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,0) 65%), linear-gradient(0deg, rgba(0,0,0,.45), rgba(0,0,0,0) 55%)"
        : "linear-gradient(0deg, rgba(0,0,0,.6), rgba(0,0,0,0) 60%)",
  });
  return d;
}

/**
 * @param {any} game  juego de ejg.library
 * @param {"portrait"|"square"|"landscape"} shape
 * @param {{ full?: boolean }} [opts]  full: usa las imágenes grandes en vez de miniaturas
 */
export function artFor(game, shape = "portrait", opts = {}) {
  const m = game.media || {};
  const full = !!opts.full;
  const cover = full ? m.cover || m.coverThumb : m.coverThumb || m.cover;
  const hero = full ? m.hero || m.heroThumb : m.heroThumb || m.hero;
  const hue = hueOf(game.title);
  const el = document.createElement("div");
  el.className = `ejg-art ejg-art-${shape}`;
  Object.assign(el.style, abs, {
    overflow: "hidden",
    background: `linear-gradient(150deg, hsl(${hue} 42% 30%), hsl(${(hue + 45) % 360} 48% 12%))`,
  });

  const withLogo = (bgSrc) => {
    el.append(image(bgSrc, { ...abs, objectFit: "cover", objectPosition: "center 30%" }, "ejg-art-bg"), shade(shape));
    const logo = image(
      m.logo,
      shape === "square"
        ? { position: "absolute", left: "12%", right: "12%", bottom: "9%", width: "76%", height: "42%", objectFit: "contain", objectPosition: "center bottom" }
        : { position: "absolute", left: "6%", bottom: "9%", width: "56%", height: "46%", objectFit: "contain", objectPosition: "left bottom" },
      "ejg-art-logo",
      (im) => im.replaceWith(titleText(game.title, shape)),
    );
    logo.style.filter = "drop-shadow(0 2px 10px rgba(0,0,0,.55))";
    el.append(logo);
  };

  const blurredContain = (src) => {
    el.append(
      image(src, { ...abs, objectFit: "cover", filter: "blur(18px) brightness(.55)", transform: "scale(1.15)" }, "ejg-art-blur"),
      image(src, { ...abs, objectFit: "contain" }, "ejg-art-main"),
    );
  };

  if (shape === "portrait") {
    if (cover) el.append(image(cover, { ...abs, objectFit: "cover" }, "ejg-art-main", (im) => im.replaceWith(titleText(game.title, shape))));
    else if (hero && m.logo) withLogo(hero);
    else if (m.header || hero) blurredContain(m.header || hero);
    else el.append(titleText(game.title, shape));
    return el;
  }

  if (hero && m.logo) withLogo(hero);
  else if (shape === "landscape" && m.header) el.append(image(m.header, { ...abs, objectFit: "cover" }, "ejg-art-main"));
  else if (shape === "square" && cover) el.append(image(cover, { ...abs, objectFit: "cover", objectPosition: "center 18%" }, "ejg-art-main"));
  else if (cover) blurredContain(cover);
  else if (hero) {
    el.append(image(hero, { ...abs, objectFit: "cover" }, "ejg-art-bg"), shade(shape), titleText(game.title, shape));
  } else el.append(titleText(game.title, shape));
  return el;
}
