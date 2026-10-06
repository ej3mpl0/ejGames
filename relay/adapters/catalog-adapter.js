// Catálogos (src-tauri/src/catalogs): reenvía las páginas de las fuentes configuradas

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const CACHE_SECONDS = 1800;
const MAX_BYTES = 8 * 1024 * 1024;
const PASS = ["content-type"];

// Fuentes por defecto - se pueden sobreescribir con env.CATALOG_SOURCES
const DEFAULT_SOURCES = {
  romshq: "https://romshq.com"
};

function sources(env) {
  try {
    const envSources = typeof env.CATALOG_SOURCES === "string" ? JSON.parse(env.CATALOG_SOURCES) : env.CATALOG_SOURCES;
    const merged = { ...DEFAULT_SOURCES, ...(envSources || {}) };
    return merged && typeof merged === "object" ? merged : DEFAULT_SOURCES;
  } catch {
    return DEFAULT_SOURCES;
  }
}

/** ¿Es una ruta de catálogo? */
export function isCatalog(url) {
  return url.pathname.startsWith("/catalog/");
}

/** /catalog/<id>/<ruta> → GET a <baseUrl>/<ruta> de esa fuente. */
export async function catalog(url, env, request) {
  const rest = url.pathname.slice("/catalog/".length);
  const slash = rest.indexOf("/");
  const id = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "/" : rest.slice(slash);

  const availableSources = sources(env);
  const base = availableSources[id];

  // Validación con mensaje descriptivo
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return new Response("ID de fuente inválido", { status: 400 });
  }

  if (!base) {
    const available = Object.keys(availableSources).join(", ");
    return new Response(
      `relay: el relay no tiene dada de alta la fuente «${id}». ` +
      `Fuentes disponibles: ${available || "ninguna"}`,
      { status: 404 }
    );
  }

  if (typeof base !== "string" || !/^https?:\/\//.test(base)) {
    return new Response("URL base inválida", { status: 500 });
  }

  const target = new URL(base.replace(/\/+$/, "") + path + url.search);
  if (target.host !== new URL(base).host) {
    return new Response("Host no permitido", { status: 403 });
  }

  // Manejar preflight OPTIONS
  if (request && request.method === "OPTIONS") {
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "X-Ejg-Time, X-Ejg-Sig, Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
    return new Response(null, { status: 204, headers });
  }

  let r;
  try {
    r = await fetch(target.toString(), {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1"
      },
      redirect: "follow",
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": CACHE_SECONDS, "300-599": 0 } },
    });
  } catch (e) {
    return new Response(`No se pudo llegar a la fuente: ${e}`, { status: 502 });
  }

  const type = r.headers.get("content-type") || "";
  if (r.ok && !/text\/html|json|xml|text\/plain/i.test(type)) {
    return new Response("Solo páginas y JSON", { status: 415 });
  }

  const len = Number(r.headers.get("content-length") || 0);
  if (len > MAX_BYTES) return new Response("Demasiado grande", { status: 413 });

  const headers = new Headers();

  // CORS para todas las respuestas
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "X-Ejg-Time, X-Ejg-Sig, Content-Type");

  for (const name of PASS) {
    const v = r.headers.get(name);
    if (v) headers.set(name, v);
  }

  return new Response(r.body, { status: r.status, headers });
}
