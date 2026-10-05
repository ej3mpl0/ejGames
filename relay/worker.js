// Relay de ejGames para Explorar: reenvía a fitgirl-repacks.site las rutas que
// pide la app (src-tauri/src/explore/fitgirl.rs), para quien tenga la web
// bloqueada por su proveedor de internet. Solo GET, solo esas rutas y solo
// peticiones firmadas por la app: no sirve de proxy para nada más.
//
// Firma: X-Ejg-Time (hora unix) y X-Ejg-Sig = HMAC-SHA256 en hex de
// «hora\nruta?consulta» con la clave RELAY_KEY (secreto del Worker, la misma
// que relay/.dev.vars). Vale MAX_SKEW segundos; si no vale, el 401 lleva la
// hora del relay en X-Ejg-Now para que la app corrija un reloj que va mal.
//
// La clave va dentro del .exe, así que esto no es infranqueable: deja fuera a
// quien encuentre la URL y a quien copie una petición, y el límite por IP
// acota lo que podría hacer quien la saque.
//
// Homebrew (Explorar → Homebrew, src-tauri/src/explore/homebrew.rs): los catálogos
// de hb-appstore, VitaDB y Universal-DB en /hb/<sistema>, y las descargas en
// /hb/file?system=…&id=…: el relay busca la URL en el catálogo (nunca la recibe de
// la app), así que solo baja lo que está en ellos.
//
// Catálogos (relay/adapters/catalog-adapter.js): /catalog/<fuente>/<ruta>, solo
// para las fuentes dadas de alta en la variable CATALOG_SOURCES del Worker.
//
// Se despliega en Cloudflare Workers (ver wrangler.toml).

import { catalog, isCatalog } from "./adapters/catalog-adapter.js";

const ORIGIN = "https://fitgirl-repacks.site";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
// La API de entradas (búsqueda, novedades y fichas) y la página de populares.
const ALLOWED = ["/wp-json/wp/v2/posts", "/popular-repacks/"];
// Lo que la app lee de la respuesta, además del cuerpo (paginación de WordPress).
const PASS = ["content-type", "x-wp-total", "x-wp-totalpages"];
// Segundos en la caché de Cloudflare: menos visitas a la web y respuestas más rápidas.
const CACHE_SECONDS = 300;
const MAX_SKEW = 300;

// Catálogos de homebrew y cuánto se guardan en la caché de Cloudflare.
const HB = {
  switch: "https://switch.cdn.fortheusers.org/repo.json",
  vita: "https://www.rinnegatamante.eu/vitadb/list_hbs_json.php",
  "3ds": "https://db.universal-team.net/data/full.json",
};
const HB_CACHE_SECONDS = 3600;

const enc = new TextEncoder();
let hmacKey;

function hexBytes(hex) {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function signed(request, url, env) {
  const time = Number(request.headers.get("X-Ejg-Time"));
  const sig = hexBytes(request.headers.get("X-Ejg-Sig") || "");
  if (!env.RELAY_KEY || !Number.isInteger(time) || !sig || Math.abs(Date.now() / 1000 - time) > MAX_SKEW) return false;
  hmacKey ??= crypto.subtle.importKey("raw", enc.encode(env.RELAY_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  // verify compara en tiempo constante.
  return crypto.subtle.verify("HMAC", await hmacKey, sig, enc.encode(`${time}\n${url.pathname}${url.search}`));
}

// ───────────── homebrew ─────────────

async function hbCatalog(system) {
  const r = await fetch(HB[system], {
    // VitaDB solo contesta a navegadores.
    headers: { "User-Agent": UA, Accept: "application/json" },
    cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": HB_CACHE_SECONDS, "300-599": 0 } },
  });
  if (!r.ok) throw new Error(`catálogo ${system}: ${r.status}`);
  return r;
}

// La URL de descarga de una entrada, con la misma regla que la app.
function hbUrl(system, id, data) {
  if (system === "switch") {
    const p = (data.packages || []).find((x) => x.name === id);
    return p ? `https://switch.cdn.fortheusers.org/zips/${encodeURIComponent(p.name)}.zip` : null;
  }
  if (system === "vita") {
    const p = (Array.isArray(data) ? data : []).find((x) => String(x.id) === id);
    return p && /^https:\/\//.test(p.url) ? p.url : null;
  }
  const p = (Array.isArray(data) ? data : []).find((x) => x.slug === id);
  if (!p || !p.downloads) return null;
  const rank = (n) => (/\.3dsx$/i.test(n) ? 3 : /\.(zip|7z)$/i.test(n) ? 2 : /\.cia$/i.test(n) ? 1 : 0);
  let best = null;
  for (const [name, d] of Object.entries(p.downloads)) {
    if (!d || !/^https:\/\//.test(d.url) || !rank(name)) continue;
    if (!best || rank(name) > best.r) best = { r: rank(name), url: d.url };
  }
  return best ? best.url : null;
}

async function homebrew(url) {
  const sys = url.pathname.slice(4);
  if (HB[sys]) {
    const r = await hbCatalog(sys);
    return new Response(r.body, { status: 200, headers: { "content-type": "application/json" } });
  }
  if (sys === "file") {
    const system = url.searchParams.get("system") || "";
    const id = url.searchParams.get("id") || "";
    if (!HB[system] || !id) return new Response("Bad Request", { status: 400 });
    const target = hbUrl(system, id, await (await hbCatalog(system)).json());
    if (!target) return new Response("Not Found", { status: 404 });
    const r = await fetch(target, { headers: { "User-Agent": UA }, redirect: "follow" });
    const headers = new Headers();
    for (const name of ["content-type", "content-length"]) {
      const v = r.headers.get(name);
      if (v) headers.set(name, v);
    }
    return new Response(r.body, { status: r.status, headers });
  }
  return new Response("Not Found", { status: 404 });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
    }
    const url = new URL(request.url);
    const isHb = url.pathname.startsWith("/hb/");
    const isCat = isCatalog(url);
    if (!isHb && !isCat && !ALLOWED.includes(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }
    if (!(await signed(request, url, env))) {
      return new Response("Unauthorized", { status: 401, headers: { "X-Ejg-Now": String(Math.floor(Date.now() / 1000)) } });
    }
    const ip = request.headers.get("CF-Connecting-IP") || "";
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) {
      return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "60" } });
    }
    if (isCat) return catalog(url, env);
    if (isHb) {
      try {
        return await homebrew(url);
      } catch (e) {
        return new Response(`No se pudo llegar al catálogo: ${e}`, { status: 502 });
      }
    }
    let upstream;
    try {
      upstream = await fetch(ORIGIN + url.pathname + url.search, {
        headers: { "User-Agent": UA, Accept: request.headers.get("Accept") || "*/*" },
        // Los errores no se guardan: un fallo pasajero no se repite 5 minutos.
        cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": CACHE_SECONDS, "300-599": 0 } },
      });
    } catch (e) {
      return new Response(`No se pudo llegar a la web: ${e}`, { status: 502 });
    }
    const headers = new Headers();
    for (const name of PASS) {
      const v = upstream.headers.get(name);
      if (v) headers.set(name, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
