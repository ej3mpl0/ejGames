// ejGames Scream (Halloween): capa de ambiente que el SDK carga en cualquier
// tema mientras dura el evento (niebla, ascuas y murciélagos de vez en cuando).
// Se quita sola si el evento acaba (el SDK borra #ejg-season).

const BAT =
  '<svg viewBox="0 0 64 32" fill="currentColor" aria-hidden="true"><path d="M32 10c-2-4-3-6-3-8 2 2 4 3 6 0 0 2-1 4-3 8 4-3 10-6 18-6-3 2-4 5-3 8 3-2 7-2 10 0-3 1-6 4-7 8-3-3-7-4-11-2-2-3-4-5-7-6-3 1-5 3-7 6-4-2-8-1-11 2-1-4-4-7-7-8 3-2 7-2 10 0 1-3 0-6-3-8 8 0 14 3 18 6z"/></svg>';

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const rnd = (a, b) => a + Math.random() * (b - a);

function build() {
  if (document.getElementById("ejg-season")) return;
  const layer = document.createElement("div");
  layer.id = "ejg-season";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = '<div class="glow"></div><div class="fog"></div><div class="fog b"></div>';
  for (let i = 0; i < 16; i++) {
    const e = document.createElement("i");
    e.className = "ember";
    const green = Math.random() < 0.3;
    e.style.cssText = [
      `left:${rnd(2, 98).toFixed(1)}%`,
      `--s:${rnd(2, 4).toFixed(1)}px`,
      `--c:${green ? "#8dff5a" : "#ff9a3c"}`,
      `--d:${rnd(14, 26).toFixed(1)}s`,
      `--w:${rnd(-26, 0).toFixed(1)}s`,
      `--x:${rnd(-60, 60).toFixed(0)}px`,
    ].join(";");
    layer.append(e);
  }
  (document.body || document.documentElement).append(layer);
  if (!reduce) scheduleBats(layer);
}

/** Una bandada de 2–5 murciélagos cada 25–55 s, de un lado o del otro. */
function scheduleBats(layer) {
  let timer = 0;
  const flock = () => {
    if (!layer.isConnected) return;
    if (!document.hidden) {
      layer.classList.toggle("rtl", Math.random() < 0.5);
      const n = 2 + Math.floor(Math.random() * 4);
      const base = rnd(4, 16);
      for (let i = 0; i < n; i++) {
        const b = document.createElement("span");
        b.className = "bat";
        b.innerHTML = BAT;
        b.style.cssText = [
          `--s:${rnd(16, 30).toFixed(0)}px`,
          `--d:${rnd(8, 12).toFixed(1)}s`,
          `--w:${(i * rnd(0.15, 0.5)).toFixed(2)}s`,
          `--y0:${(base + rnd(-3, 5)).toFixed(1)}vh`,
          `--y1:${(base + rnd(-6, 2)).toFixed(1)}vh`,
          `--y2:${(base + rnd(-2, 8)).toFixed(1)}vh`,
        ].join(";");
        b.addEventListener("animationend", (e) => e.target === b && b.remove());
        layer.append(b);
      }
    }
    timer = setTimeout(flock, rnd(25000, 55000));
  };
  timer = setTimeout(flock, rnd(3000, 8000));
  new MutationObserver((_, obs) => {
    if (!layer.isConnected) {
      clearTimeout(timer);
      obs.disconnect();
    }
  }).observe(document.body || document.documentElement, { childList: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build, { once: true });
else build();
