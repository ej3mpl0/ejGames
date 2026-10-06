// Relay de ejGames para Explorar y Catálogos

import { catalog, isCatalog } from "./adapters/catalog-adapter.js";

const ORIGIN = "https://fitgirl-repacks.site";
const UA2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const ALLOWED = ["/wp-json/wp/v2/posts", "/popular-repacks/"];
const PASS2 = ["content-type", "x-wp-total", "x-wp-totalpages"];
const CACHE_SECONDS2 = 300;
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
  if (!env.RELAY_KEY || !Number.isInteger(time) || !sig || Math.abs(Date.now() / 1e3 - time) > MAX_SKEW) return false;
  hmacKey ??= crypto.subtle.importKey("raw", enc.encode(env.RELAY_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", await hmacKey, sig, enc.encode(`${time}\n${url.pathname}${url.search}`));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isCat = isCatalog(url);

    // CORS preflight para catálogos
    if (isCat && request.method === "OPTIONS") {
      return catalog(url, env, request);
    }

    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
    }

    if (!isCat && !ALLOWED.includes(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }

    if (!await signed(request, url, env)) {
      return new Response("Unauthorized", { status: 401, headers: { "X-Ejg-Now": String(Math.floor(Date.now() / 1e3)) } });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) {
      return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "60" } });
    }

    if (isCat) return catalog(url, env, request);

    let upstream;
    try {
      upstream = await fetch(ORIGIN + url.pathname + url.search, {
        headers: { "User-Agent": UA2, Accept: request.headers.get("Accept") || "*/*" },
        cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": CACHE_SECONDS2, "300-599": 0 } }
      });
    } catch (e) {
      return new Response(`No se pudo llegar a la web: ${e}`, { status: 502 });
    }

    const headers = new Headers();
    for (const name of PASS2) {
      const v = upstream.headers.get(name);
      if (v) headers.set(name, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
