// Catálogos (src-tauri/src/catalogs): reenvía las páginas de las fuentes que el
// dueño del relay haya dado de alta, para quien no llegue a ellas directamente.
//
// Las fuentes NO las manda la app: van en la variable CATALOG_SOURCES del Worker
// (JSON { "<id de la fuente>": "<baseUrl>" }, el mismo id y baseUrl que en
// catalog-sources.json). Así el relay no es un proxy abierto: solo pide rutas de
// esas webs. La app llama a /catalog/<id>/<ruta>?<consulta>, firmado como el resto.
//
// Solo páginas y JSON (con caché de Cloudflare); las descargas van directas.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const CACHE_SECONDS = 1800;
const MAX_BYTES = 8 * 1024 * 1024;
const PASS = ["content-type"];

function sources(env) {
  try {
    const v = typeof env.CATALOG_SOURCES === "string" ? JSON.parse(env.CATALOG_SOURCES) : env.CATALOG_SOURCES;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** ¿Es una ruta de catálogo? */
export function isCatalog(url) {
  return url.pathname.startsWith("/catalog/");
}

/** /catalog/<id>/<ruta> → GET a <baseUrl>/<ruta> de esa fuente. */
export async function catalog(url, env) {
  const rest = url.pathname.slice("/catalog/".length);
  const slash = rest.indexOf("/");
  const id = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "/" : rest.slice(slash);
  const base = sources(env)[id];
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof base !== "string" || !/^https?:\/\//.test(base)) {
    return new Response("Not Found", { status: 404 });
  }
  const target = new URL(base.replace(/\/+$/, "") + path + url.search);
  // Nada fuera del sitio de la fuente (por si la ruta traía «//otro-host»).
  if (target.host !== new URL(base).host) return new Response("Not Found", { status: 404 });
  let r;
  try {
    r = await fetch(target.toString(), {
      headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
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
  for (const name of PASS) {
    const v = r.headers.get(name);
    if (v) headers.set(name, v);
  }
  return new Response(r.body, { status: r.status, headers });
}
