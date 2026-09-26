// Fondos con fundido, tráilers HLS y microtráilers.

import { h } from "./dom.js";

let hlsLoading = null;
function loadHls() {
  if (/** @type {any} */ (window).Hls) return Promise.resolve(/** @type {any} */ (window).Hls);
  if (!hlsLoading) {
    hlsLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/_sdk/vendor/hls.light.min.js";
      s.onload = () => resolve(/** @type {any} */ (window).Hls);
      s.onerror = reject;
      document.head.append(s);
    });
  }
  return hlsLoading;
}

/**
 * Asigna una fuente a un <video>: mp4/webm directo o HLS (nativo o hls.js).
 * @returns {Promise<() => void>} función para liberar recursos.
 */
export async function attachStream(video, url) {
  if (!url) return () => {};
  if (!/\.m3u8(\?|$)/.test(url) || video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }
  const Hls = await loadHls();
  if (!Hls || !Hls.isSupported()) {
    video.src = url;
    return () => video.removeAttribute("src");
  }
  const hls = new Hls({ maxBufferLength: 20, capLevelToPlayerSize: true, startLevel: -1, enableWorker: true });
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => hls.destroy();
}

/**
 * Fondo con dos capas que se funden. `set(url)` cambia la imagen; `video(url)`
 * superpone un vídeo mudo en bucle (microtráiler) que aparece al empezar a sonar.
 */
export function createBackdrop(container, { fade = 500, className = "ejg-backdrop" } = {}) {
  const wrap = h("div", { class: className, style: { position: "absolute", inset: "0", overflow: "hidden" } });
  const layers = [0, 1].map(() =>
    h("div", {
      class: `${className}-layer`,
      style: {
        position: "absolute",
        inset: "0",
        backgroundSize: "cover",
        backgroundPosition: "center",
        opacity: "0",
        transition: `opacity ${fade}ms ease`,
      },
    }),
  );
  const vid = /** @type {HTMLVideoElement} */ (
    h("video", {
      class: `${className}-video`,
      muted: true,
      loop: true,
      playsInline: true,
      style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover", opacity: "0", transition: `opacity ${fade}ms ease` },
    })
  );
  vid.muted = true;
  wrap.append(...layers, vid);
  container.prepend(wrap);
  let front = 0;
  let currentUrl = null;
  let release = () => {};
  let token = 0;

  function stopVideo() {
    token++;
    vid.style.opacity = "0";
    vid.pause();
    release();
    release = () => {};
  }

  return {
    el: wrap,
    set(url) {
      stopVideo();
      if (url === currentUrl) return;
      currentUrl = url;
      const next = layers[1 - front];
      if (!url) {
        layers.forEach((l) => (l.style.opacity = "0"));
        return;
      }
      const im = new Image();
      im.decoding = "async";
      im.onload = im.onerror = () => {
        if (currentUrl !== url) return;
        next.style.backgroundImage = `url("${url}")`;
        next.style.opacity = "1";
        layers[front].style.opacity = "0";
        front = 1 - front;
      };
      im.src = url;
    },
    async video(url) {
      stopVideo();
      if (!url) return;
      const my = ++token;
      release = await attachStream(vid, url);
      if (my !== token) return;
      vid.onplaying = () => {
        if (my === token) vid.style.opacity = "1";
      };
      vid.play().catch(() => {});
    },
    stopVideo,
  };
}

/**
 * Llama a `fn` cuando el foco lleva `delay` ms quieto en el mismo valor.
 * Útil para arrancar microtráilers solo si el usuario se detiene.
 */
export function idle(delay = 2500) {
  let t = 0;
  return (fn) => {
    clearTimeout(t);
    t = setTimeout(fn, delay);
  };
}

/** Reproductor sencillo de tráiler completo (con controles) dentro de `container`. */
export function trailerPlayer(container, trailer, { autoplay = true, muted = false } = {}) {
  const v = /** @type {HTMLVideoElement} */ (h("video", { class: "ejg-trailer", controls: true, playsInline: true, preload: "metadata" }));
  if (trailer.poster) v.poster = trailer.poster;
  v.muted = muted;
  container.replaceChildren(v);
  let release = () => {};
  attachStream(v, trailer.url).then((r) => {
    release = r;
    if (autoplay) v.play().catch(() => {});
  });
  return {
    video: v,
    destroy() {
      v.pause();
      release();
      v.remove();
    },
  };
}
