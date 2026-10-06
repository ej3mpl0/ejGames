// Relay de ejGames para Explorar y Catálogos

import { catalog, isCatalog } from "./adapters/catalog-adapter.js";

const ORIGIN = "https://fitgirl-repacks.site";
const UA2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const ALLOWED = ["/wp-json/wp/v2/posts", "/popular-repacks/"];
const PASS2 = ["content-type", "x-wp-total", "x-wp-totalpages"];
const CACHE_SECONDS2 = 300;
const MAX_SKEW = 300;
const HB = {
  switch: "https://switch.cdn.fortheusers.org/repo.json",
  vita: "https://www.rinnegatamante.eu/vitadb/list_hbs_json.php",
  "3ds": "https://db.universal-team.net/data/full.json"
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
  if (!env.RELAY_KEY || !Number.isInteger(time) || !sig || Math.abs(Date.now() / 1e3 - time) > MAX_SKEW) return false;
  hmacKey ??= crypto.subtle.importKey("raw", enc.encode(env.RELAY_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", await hmacKey, sig, enc.encode(`${time}\n${url.pathname}${url.search}`));
}

async function hbCatalog(system) {
  const r = await fetch(HB[system], {
    headers: { "User-Agent": UA2, Accept: "application/json" },
    cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": HB_CACHE_SECONDS, "300-599": 0 } }
  });
  if (!r.ok) throw new Error(`catálogo ${system}: ${r.status}`);
  return r;
}

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
  const rank = (n) => /\.3dsx$/i.test(n) ? 3 : /\.(zip|7z)$/i.test(n) ? 2 : /\.cia$/i.test(n) ? 1 : 0;
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
    const r = await fetch(target, { headers: { "User-Agent": UA2 }, redirect: "follow" });
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
    const url = new URL(request.url);
    const isHb = url.pathname.startsWith("/hb/");
    const isCat = isCatalog(url);

    // CORS preflight para catálogos
    if (isCat && request.method === "OPTIONS") {
      return catalog(url, env, request);
    }

    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
    }

    if (!isHb && !isCat && !ALLOWED.includes(url.pathname)) {
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
