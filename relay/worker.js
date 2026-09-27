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
// Se despliega en Cloudflare Workers (ver wrangler.toml).

const ORIGIN = "https://fitgirl-repacks.site";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
// La API de entradas (búsqueda, novedades y fichas) y la página de populares.
const ALLOWED = ["/wp-json/wp/v2/posts", "/popular-repacks/"];
// Lo que la app lee de la respuesta, además del cuerpo (paginación de WordPress).
const PASS = ["content-type", "x-wp-total", "x-wp-totalpages"];
// Segundos en la caché de Cloudflare: menos visitas a la web y respuestas más rápidas.
const CACHE_SECONDS = 300;
const MAX_SKEW = 300;

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

export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
    }
    const url = new URL(request.url);
    if (!ALLOWED.includes(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }
    if (!(await signed(request, url, env))) {
      return new Response("Unauthorized", { status: 401, headers: { "X-Ejg-Now": String(Math.floor(Date.now() / 1000)) } });
    }
    const ip = request.headers.get("CF-Connecting-IP") || "";
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) {
      return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "60" } });
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
