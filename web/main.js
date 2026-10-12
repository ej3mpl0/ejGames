// ejGames — la web. Rellena el muro de carátulas y la fila de la app, apunta los
// botones de descarga al instalador de la última versión y, donde el navegador no
// sabe animar con el scroll, hace aparecer las secciones con un IntersectionObserver.

const COVERS = [
  1245620, 1086940, 1145350, 367520, 1771300, 1903340, 2050650, 1593500, 990080, 1091500,
  2358720, 1174180, 814380, 504230, 413150, 1817070, 2215430, 1716740, 2399830, 1466860,
  292030, 1888930, 1551360, 2246340, 489830,
];
const cover = (id) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;

function img(src) {
  const el = document.createElement("img");
  el.src = src;
  el.alt = "";
  el.loading = "lazy";
  el.decoding = "async";
  // Si una carátula no existe, fuera: mejor un hueco menos que un recuadro roto.
  el.addEventListener("error", () => el.remove(), { once: true });
  return el;
}

function buildWall() {
  const wall = document.querySelector("[data-wall]");
  if (!wall) return;
  const cols = 5;
  for (let c = 0; c < cols; c++) {
    const col = document.createElement("div");
    col.className = "col" + (c % 2 ? " down" : "") + (c === 2 || c === 4 ? " slow" : "");
    const ids = COVERS.filter((_, i) => i % cols === c);
    // Dos veces la misma tanda: la animación sube media columna y vuelve sin salto.
    for (const id of [...ids, ...ids]) col.append(img(cover(id)));
    wall.append(col);
  }
}

function buildRow() {
  const row = document.querySelector("[data-row]");
  if (!row) return;
  COVERS.slice(1, 8).forEach((id, i) => {
    const cell = document.createElement("div");
    if (i === 0) cell.className = "on";
    cell.append(img(cover(id)));
    row.append(cell);
  });
}

async function latestRelease() {
  try {
    const res = await fetch("https://api.github.com/repos/ej3mpl0/ejGames/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const rel = await res.json();
    const setup = (rel.assets || []).find((a) => /setup\.exe$/i.test(a.name)) || (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    if (setup) document.querySelectorAll("[data-download]").forEach((a) => (a.href = setup.browser_download_url));
    const v = String(rel.tag_name || "").replace(/^v/i, "");
    if (v) document.querySelectorAll("[data-version]").forEach((s) => (s.textContent = `Version ${v}`));
  } catch {
    // Sin red o sin cupo de la API: los botones siguen llevando a la página de la release.
  }
}

function revealFallback() {
  if (CSS.supports?.("animation-timeline: view()")) return;
  const els = document.querySelectorAll(".reveal, .tilt");
  if (!("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("no-sda");
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
  );
  els.forEach((el) => io.observe(el));
}

buildWall();
buildRow();
revealFallback();
latestRelease();
