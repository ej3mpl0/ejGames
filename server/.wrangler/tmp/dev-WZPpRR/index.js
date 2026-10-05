var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var MAX_SKEW = 300;
var SESSION_DAYS = 90;
var OFFLINE_AFTER = 15 * 60;
var USERNAME = /^[A-Za-z0-9_.-]{3,20}$/;
var HEX32 = /^[0-9a-f]{64}$/;
var MEDIA = {
  avatar: 256 * 1024,
  background: 1536 * 1024,
  shot: 460 * 1024
};
var STATUSES = ["online", "away", "invisible", "offline"];
var PRIVACY = ["public", "friends", "private"];
var COMMENTS = ["public", "friends", "off"];
var ACTIVITY = ["played", "achievement", "completed", "badge", "friend"];
var enc = new TextEncoder();
var appKey;
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
var fail = /* @__PURE__ */ __name((status, code, message) => {
  throw new HttpError(status, code, message);
}, "fail");
var now = /* @__PURE__ */ __name(() => Math.floor(Date.now() / 1e3), "now");
var hex = /* @__PURE__ */ __name((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""), "hex");
var fromHex = /* @__PURE__ */ __name((s) => new Uint8Array(s.match(/../g).map((x) => parseInt(x, 16))), "fromHex");
var sha256 = /* @__PURE__ */ __name(async (data) => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data)), "sha256");
var random = /* @__PURE__ */ __name((n) => crypto.getRandomValues(new Uint8Array(n)), "random");
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
__name(json, "json");
function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
__name(concat, "concat");
async function keyMatches(salt, hash, keyHex) {
  if (!HEX32.test(keyHex || "")) return false;
  const got = await sha256(concat(new Uint8Array(salt), fromHex(keyHex)));
  const want = new Uint8Array(hash);
  return got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
}
__name(keyMatches, "keyMatches");
async function sealKey(keyHex) {
  const salt = random(16);
  return [salt, await sha256(concat(salt, fromHex(keyHex)))];
}
__name(sealKey, "sealKey");
var text = /* @__PURE__ */ __name((v, max) => typeof v === "string" ? v.trim().slice(0, max) : "", "text");
var hashOrNull = /* @__PURE__ */ __name((v) => typeof v === "string" && HEX32.test(v) ? v : null, "hashOrNull");
async function body(request, max = 64 * 1024) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > max) fail(413, "too_big", "La petici\xF3n es demasiado grande.");
  const raw = await request.text();
  if (raw.length > max) fail(413, "too_big", "La petici\xF3n es demasiado grande.");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    fail(400, "bad_json", "Petici\xF3n no v\xE1lida.");
  }
}
__name(body, "body");
async function signed(request, url, env) {
  if (!env.APP_KEY) return true;
  const time = Number(request.headers.get("X-Ejg-Time"));
  const sig = request.headers.get("X-Ejg-Sig") || "";
  if (!Number.isInteger(time) || !HEX32.test(sig) || Math.abs(now() - time) > MAX_SKEW) return false;
  appKey ??= crypto.subtle.importKey("raw", enc.encode(env.APP_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", await appKey, fromHex(sig), enc.encode(`${time}
${request.method}
${url.pathname}${url.search}`));
}
__name(signed, "signed");
async function limit(binding, key) {
  if (binding && !(await binding.limit({ key })).success) fail(429, "rate_limited", "Demasiadas peticiones. Espera un momento.");
}
__name(limit, "limit");
async function newSession(env, userId) {
  const token = random(32);
  const tokenB64 = btoa(String.fromCharCode(...token)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)").bind(hex(await sha256(tokenB64)), userId, now() + SESSION_DAYS * 86400, now()).run();
  return tokenB64;
}
__name(newSession, "newSession");
async function auth(request, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get("Authorization") || "");
  if (!m) fail(401, "no_session", "Inicia sesi\xF3n.");
  const th = hex(await sha256(m[1]));
  const s = await env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?1").bind(th).first();
  if (!s || s.expires_at < now()) fail(401, "no_session", "La sesi\xF3n ha caducado. Vuelve a entrar.");
  if (s.expires_at < now() + (SESSION_DAYS - 1) * 86400) {
    await env.DB.prepare("UPDATE sessions SET expires_at = ?2 WHERE token_hash = ?1").bind(th, now() + SESSION_DAYS * 86400).run();
  }
  await limit(env.API_LIMIT, `u${s.user_id}`);
  return { id: s.user_id, tokenHash: th };
}
__name(auth, "auth");
var pair = /* @__PURE__ */ __name((x, y) => x < y ? [x, y] : [y, x], "pair");
async function relation(env, me, other) {
  const [a, b] = pair(me, other);
  return env.DB.prepare("SELECT state, requested_by FROM friends WHERE a = ?1 AND b = ?2").bind(a, b).first();
}
__name(relation, "relation");
function bump(env, ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return [];
  return [env.DB.prepare(`UPDATE users SET rev = rev + 1 WHERE id IN (${list.map(() => "?").join(",")})`).bind(...list)];
}
__name(bump, "bump");
function bumpFriends(env, id) {
  return env.DB.prepare(
    "UPDATE users SET rev = rev + 1 WHERE id IN (SELECT b FROM friends WHERE a = ?1 AND state = 'accepted' UNION SELECT a FROM friends WHERE b = ?1 AND state = 'accepted')"
  ).bind(id);
}
__name(bumpFriends, "bumpFriends");
async function findUser(env, who) {
  const q = text(who, 40);
  const code = q.replace(/[\s-]/g, "");
  if (/^\d{9}$/.test(code)) return env.DB.prepare("SELECT id FROM users WHERE friend_code = ?1").bind(code).first();
  if (USERNAME.test(q)) return env.DB.prepare("SELECT id FROM users WHERE username_lc = ?1").bind(q.toLowerCase()).first();
  return null;
}
__name(findUser, "findUser");
function visiblePresence(p) {
  if (!p) return { status: "offline" };
  const gone = p.last_seen < now() - OFFLINE_AFTER;
  if (gone || p.status === "invisible" || p.status === "offline") return { status: "offline", lastSeen: p.last_seen };
  return { status: p.status, game: p.game || null, appid: p.game_appid || null, since: p.since || null, lastSeen: p.last_seen };
}
__name(visiblePresence, "visiblePresence");
var userCard = /* @__PURE__ */ __name((r) => ({ id: r.id, username: r.username, name: r.display_name || r.username, avatar: r.avatar || null, frame: r.frame || "", level: r.level || 0 }), "userCard");
async function register(request, env) {
  const b = await body(request);
  const username = text(b.username, 20);
  if (!USERNAME.test(username)) fail(400, "bad_username", "El nombre de usuario lleva de 3 a 20 letras, n\xFAmeros, \xAB.\xBB, \xAB_\xBB o \xAB-\xBB.");
  if (!HEX32.test(b.key || "") || !HEX32.test(b.recovery || "")) fail(400, "bad_key", "Petici\xF3n no v\xE1lida.");
  const lc = username.toLowerCase();
  if (await env.DB.prepare("SELECT 1 FROM users WHERE username_lc = ?1").bind(lc).first()) fail(409, "taken", "Ese nombre de usuario ya existe.");
  const [pwSalt, pwHash] = await sealKey(b.key);
  const [rcSalt, rcHash] = await sealKey(b.recovery);
  let id;
  for (let i = 0; i < 6 && !id; i++) {
    const code = String(1e8 + crypto.getRandomValues(new Uint32Array(1))[0] % 9e8);
    try {
      const r = await env.DB.prepare(
        "INSERT INTO users (username, username_lc, friend_code, pw_salt, pw_hash, rc_salt, rc_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id"
      ).bind(username, lc, code, pwSalt, pwHash, rcSalt, rcHash, now()).first();
      id = r.id;
    } catch (e) {
      if (String(e).includes("username_lc")) fail(409, "taken", "Ese nombre de usuario ya existe.");
      if (!String(e).includes("friend_code")) throw e;
    }
  }
  if (!id) fail(500, "retry", "Int\xE9ntalo otra vez.");
  const name = text(b.displayName, 32) || username;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?1, ?2, ?3)").bind(id, name, now()),
    env.DB.prepare("INSERT INTO presence (user_id, status, last_seen) VALUES (?1, 'online', ?2)").bind(id, now())
  ]);
  return json({ token: await newSession(env, id), me: await meOf(env, id) }, 201);
}
__name(register, "register");
async function login(request, env) {
  const b = await body(request);
  const u = await env.DB.prepare("SELECT id, pw_salt, pw_hash FROM users WHERE username_lc = ?1").bind(text(b.username, 20).toLowerCase()).first();
  if (!u || !await keyMatches(u.pw_salt, u.pw_hash, b.key)) fail(401, "bad_login", "Usuario o contrase\xF1a incorrectos.");
  return json({ token: await newSession(env, u.id), me: await meOf(env, u.id) });
}
__name(login, "login");
async function recover(request, env) {
  const b = await body(request);
  const u = await env.DB.prepare("SELECT id, rc_salt, rc_hash FROM users WHERE username_lc = ?1").bind(text(b.username, 20).toLowerCase()).first();
  if (!u || !await keyMatches(u.rc_salt, u.rc_hash, b.recovery)) fail(401, "bad_recovery", "Usuario o c\xF3digo de recuperaci\xF3n incorrectos.");
  if (!HEX32.test(b.key || "") || !HEX32.test(b.newRecovery || "")) fail(400, "bad_key", "Petici\xF3n no v\xE1lida.");
  const [pwSalt, pwHash] = await sealKey(b.key);
  const [rcSalt, rcHash] = await sealKey(b.newRecovery);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pw_salt = ?2, pw_hash = ?3, rc_salt = ?4, rc_hash = ?5 WHERE id = ?1").bind(u.id, pwSalt, pwHash, rcSalt, rcHash),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(u.id)
  ]);
  return json({ token: await newSession(env, u.id), me: await meOf(env, u.id) });
}
__name(recover, "recover");
async function changePassword(request, env, me) {
  const b = await body(request);
  const u = await env.DB.prepare("SELECT pw_salt, pw_hash FROM users WHERE id = ?1").bind(me.id).first();
  if (!await keyMatches(u.pw_salt, u.pw_hash, b.key)) fail(401, "bad_password", "La contrase\xF1a actual no es correcta.");
  const stmts = [];
  if (HEX32.test(b.newKey || "")) {
    const [s, h] = await sealKey(b.newKey);
    stmts.push(env.DB.prepare("UPDATE users SET pw_salt = ?2, pw_hash = ?3 WHERE id = ?1").bind(me.id, s, h));
    stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2").bind(me.id, me.tokenHash));
  }
  if (HEX32.test(b.newRecovery || "")) {
    const [s, h] = await sealKey(b.newRecovery);
    stmts.push(env.DB.prepare("UPDATE users SET rc_salt = ?2, rc_hash = ?3 WHERE id = ?1").bind(me.id, s, h));
  }
  if (!stmts.length) fail(400, "bad_key", "Petici\xF3n no v\xE1lida.");
  await env.DB.batch(stmts);
  return json({ ok: true });
}
__name(changePassword, "changePassword");
async function deleteAccount(request, env, me) {
  const b = await body(request);
  const u = await env.DB.prepare("SELECT pw_salt, pw_hash FROM users WHERE id = ?1").bind(me.id).first();
  if (!await keyMatches(u.pw_salt, u.pw_hash, b.key)) fail(401, "bad_password", "La contrase\xF1a no es correcta.");
  await env.DB.batch([bumpFriends(env, me.id), env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(me.id)]);
  return json({ ok: true });
}
__name(deleteAccount, "deleteAccount");
async function meOf(env, id) {
  const r = await env.DB.prepare(
    `SELECT u.id, u.username, u.friend_code, u.created_at, p.*, s.xp, s.level, s.badges, s.hash AS summary_hash, pr.status
     FROM users u JOIN profiles p ON p.user_id = u.id LEFT JOIN summaries s ON s.user_id = u.id LEFT JOIN presence pr ON pr.user_id = u.id WHERE u.id = ?1`
  ).bind(id).first();
  if (!r) fail(401, "no_session", "La cuenta ya no existe.");
  return {
    id: r.id,
    username: r.username,
    friendCode: `${r.friend_code.slice(0, 3)}-${r.friend_code.slice(3, 6)}-${r.friend_code.slice(6)}`,
    createdAt: r.created_at,
    status: r.status || "online",
    summaryHash: r.summary_hash || null,
    profile: profileOut(r),
    xp: r.xp || 0,
    level: r.level || 0,
    badges: JSON.parse(r.badges || "[]")
  };
}
__name(meOf, "meOf");
function profileOut(r) {
  return {
    name: r.display_name,
    realName: r.real_name,
    country: r.country,
    bio: r.bio,
    avatar: r.avatar,
    backgroundImage: r.background_img,
    frame: r.frame,
    background: r.background,
    color: r.color,
    showcases: JSON.parse(r.showcases || "[]"),
    featuredBadge: r.featured_badge,
    privacy: r.privacy,
    comments: r.comments
  };
}
__name(profileOut, "profileOut");
var SHOWCASE_TYPES = ["featured", "favorite", "achievements", "stats", "recent", "text", "screenshots", "badges"];
function cleanShowcases(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(0, 6)) {
    if (!s || !SHOWCASE_TYPES.includes(s.type)) continue;
    const c = { type: s.type };
    if (s.type === "text") {
      c.title = text(s.title, 60);
      c.text = text(s.text, 2e3);
    }
    if (s.type === "featured" || s.type === "favorite") {
      c.game = text(s.game, 120);
      c.appid = Number.isInteger(s.appid) ? s.appid : null;
    }
    if (s.type === "achievements" && Array.isArray(s.items)) {
      c.items = s.items.slice(0, 12).map((a) => ({ game: text(a.game, 120), name: text(a.name, 120), icon: text(a.icon, 300), rarity: typeof a.rarity === "number" ? a.rarity : null }));
    }
    if (s.type === "screenshots" && Array.isArray(s.items)) {
      c.items = s.items.map(hashOrNull).filter(Boolean).slice(0, 4);
    }
    out.push(c);
  }
  return out;
}
__name(cleanShowcases, "cleanShowcases");
async function putProfile(request, env, me) {
  const b = await body(request, 32 * 1024);
  const cur = await env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?1").bind(me.id).first();
  const field = /* @__PURE__ */ __name((key, col, max) => b[key] === void 0 ? cur[col] : text(b[key], max), "field");
  const showcases = b.showcases === void 0 ? JSON.parse(cur.showcases) : cleanShowcases(b.showcases);
  const avatar = b.avatar === void 0 ? cur.avatar : hashOrNull(b.avatar);
  const bgImg = b.backgroundImage === void 0 ? cur.background_img : hashOrNull(b.backgroundImage);
  const used = [avatar, bgImg, ...showcases.flatMap((s) => s.type === "screenshots" ? s.items : [])].filter(Boolean);
  if (used.length) {
    const own = await env.DB.prepare(`SELECT hash FROM media WHERE owner = ?1 AND hash IN (${used.map(() => "?").join(",")})`).bind(me.id, ...used).all();
    const mine = new Set(own.results.map((r) => r.hash));
    if (used.some((h) => !mine.has(h))) fail(400, "bad_media", "Esa imagen no es tuya.");
  }
  const name = field("name", "display_name", 32) || cur.display_name;
  const privacy = PRIVACY.includes(b.privacy) ? b.privacy : cur.privacy;
  const comments = COMMENTS.includes(b.comments) ? b.comments : cur.comments;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE profiles SET display_name = ?2, real_name = ?3, country = ?4, bio = ?5, avatar = ?6, background_img = ?7, frame = ?8, background = ?9,
         color = ?10, showcases = ?11, featured_badge = ?12, privacy = ?13, comments = ?14, updated_at = ?15 WHERE user_id = ?1`
    ).bind(
      me.id,
      name,
      field("realName", "real_name", 60),
      field("country", "country", 2).toUpperCase(),
      field("bio", "bio", 1e3),
      avatar,
      bgImg,
      field("frame", "frame", 32),
      field("background", "background", 32),
      field("color", "color", 32),
      JSON.stringify(showcases),
      field("featuredBadge", "featured_badge", 40),
      privacy,
      comments,
      now()
    ),
    // Imágenes que ya no usa: fuera.
    env.DB.prepare(`DELETE FROM media WHERE owner = ?1 ${used.length ? `AND hash NOT IN (${used.map(() => "?").join(",")})` : ""} AND created_at < ?${used.length + 2}`).bind(
      me.id,
      ...used,
      now() - 3600
    ),
    // El nombre o el avatar cambian en la lista de sus amigos.
    bumpFriends(env, me.id)
  ]);
  return json(await meOf(env, me.id));
}
__name(putProfile, "putProfile");
async function putSummary(request, env, me) {
  const b = await body(request, 256 * 1024);
  if (!HEX32.test(b.hash || "")) fail(400, "bad_hash", "Petici\xF3n no v\xE1lida.");
  const games = Array.isArray(b.games) ? b.games.slice(0, 2e3).map((g) => ({
    title: text(g.title, 120),
    appid: Number.isInteger(g.appid) ? g.appid : null,
    minutes: Math.max(0, Math.min(1e7, Math.floor(Number(g.minutes) || 0))),
    last: Number.isInteger(g.last) ? g.last : null,
    ach: Array.isArray(g.ach) && g.ach.length === 2 ? g.ach.map((n) => Math.max(0, Math.floor(Number(n) || 0))) : null,
    cover: text(g.cover, 300) || null
  })) : [];
  const stats = b.stats && typeof b.stats === "object" ? b.stats : {};
  const json_ = JSON.stringify({ games, stats: { games: games.length, minutes: Math.floor(Number(stats.minutes) || 0), achievements: Math.floor(Number(stats.achievements) || 0), perfect: Math.floor(Number(stats.perfect) || 0) } });
  const badges = Array.isArray(b.badges) ? b.badges.slice(0, 40).map((x) => ({ id: text(x.id, 30), tier: Math.max(1, Math.min(10, Math.floor(Number(x.tier) || 1))) })) : [];
  const xp = Math.max(0, Math.min(1e9, Math.floor(Number(b.xp) || 0)));
  const level = Math.max(0, Math.min(1e3, Math.floor(Number(b.level) || 0)));
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO summaries (user_id, hash, json, xp, level, badges, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (user_id) DO UPDATE SET hash = excluded.hash, json = excluded.json, xp = excluded.xp, level = excluded.level, badges = excluded.badges, updated_at = excluded.updated_at`
    ).bind(me.id, b.hash, json_, xp, level, JSON.stringify(badges), now()),
    bumpFriends(env, me.id)
  ]);
  return json({ ok: true });
}
__name(putSummary, "putSummary");
function sniff(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
  if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69) return "image/webp";
  return null;
}
__name(sniff, "sniff");
async function postMedia(request, env, me, url) {
  const kind = url.searchParams.get("kind");
  const max = MEDIA[kind];
  if (!max) fail(400, "bad_kind", "Tipo de imagen no v\xE1lido.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > max) fail(413, "too_big", "La imagen es demasiado grande.");
  const mime = sniff(bytes);
  if (!mime) fail(400, "bad_image", "Solo im\xE1genes JPEG, PNG o WebP.");
  const hash = hex(await sha256(bytes));
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM media WHERE owner = ?1").bind(me.id).first();
  if (count.n >= 40) fail(429, "too_many", "Tienes demasiadas im\xE1genes subidas.");
  await env.DB.prepare("INSERT OR IGNORE INTO media (hash, owner, kind, mime, bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(hash, me.id, kind, mime, bytes, now()).run();
  return json({ hash }, 201);
}
__name(postMedia, "postMedia");
async function getMedia(request, env, hash, ctx) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;
  const r = await env.DB.prepare("SELECT mime, bytes FROM media WHERE hash = ?1").bind(hash).first();
  if (!r) return new Response("Not Found", { status: 404 });
  const res = new Response(new Uint8Array(r.bytes), {
    headers: { "content-type": r.mime, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" }
  });
  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}
__name(getMedia, "getMedia");
async function putPresence(request, env, me) {
  const b = await body(request);
  const status = STATUSES.includes(b.status) ? b.status : "online";
  const game = text(b.game, 120) || null;
  const appid = Number.isInteger(b.appid) ? b.appid : null;
  const since = game ? Number.isInteger(b.since) ? b.since : now() : null;
  const cur = await env.DB.prepare("SELECT status, game, last_seen FROM presence WHERE user_id = ?1").bind(me.id).first();
  const t = now();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO presence (user_id, status, game, game_appid, since, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (user_id) DO UPDATE SET status = excluded.status, game = excluded.game, game_appid = excluded.game_appid, since = excluded.since, last_seen = excluded.last_seen`
    ).bind(me.id, status, game, appid, since, t)
  ];
  const seenBefore = cur ? cur.last_seen >= t - OFFLINE_AFTER : false;
  const changed = !cur || cur.status !== status || (cur.game || null) !== game || !seenBefore;
  if (changed) stmts.push(bumpFriends(env, me.id));
  await env.DB.batch(stmts);
  return json({ ok: true });
}
__name(putPresence, "putPresence");
async function friendAction(request, env, me, action) {
  const b = await body(request);
  let other;
  if (action === "request") {
    const u = await findUser(env, b.user);
    if (!u) fail(404, "not_found", "No hay nadie con ese nombre o c\xF3digo.");
    other = u.id;
  } else {
    other = Number(b.id);
    if (!Number.isInteger(other)) fail(400, "bad_id", "Petici\xF3n no v\xE1lida.");
  }
  if (other === me.id) fail(400, "self", "No puedes a\xF1adirte a ti mismo.");
  const [a, bb] = pair(me.id, other);
  const rel = await relation(env, me.id, other);
  const t = now();
  const stmts = [];
  switch (action) {
    case "request": {
      if (rel?.state === "blocked") fail(403, "blocked", rel.requested_by === me.id ? "Tienes bloqueado a este usuario." : "No puedes a\xF1adir a este usuario.");
      if (rel?.state === "accepted") fail(409, "already", "Ya sois amigos.");
      if (rel?.state === "pending" && rel.requested_by === me.id) fail(409, "pending", "Ya le enviaste una solicitud.");
      if (rel?.state === "pending") {
        stmts.push(env.DB.prepare("UPDATE friends SET state = 'accepted', created_at = ?3 WHERE a = ?1 AND b = ?2").bind(a, bb, t));
      } else {
        const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM friends WHERE (a = ?1 OR b = ?1) AND state = 'pending' AND requested_by = ?1").bind(me.id).first();
        if (pending.n >= 50) fail(429, "too_many", "Tienes demasiadas solicitudes sin responder.");
        stmts.push(env.DB.prepare("INSERT INTO friends (a, b, state, requested_by, created_at) VALUES (?1, ?2, 'pending', ?3, ?4)").bind(a, bb, me.id, t));
      }
      break;
    }
    case "accept":
      if (rel?.state !== "pending" || rel.requested_by === me.id) fail(404, "no_request", "No hay ninguna solicitud de ese usuario.");
      stmts.push(env.DB.prepare("UPDATE friends SET state = 'accepted', created_at = ?3 WHERE a = ?1 AND b = ?2").bind(a, bb, t));
      break;
    case "decline":
    case "remove":
      if (!rel || rel.state === "blocked") fail(404, "not_friends", "No sois amigos.");
      stmts.push(env.DB.prepare("DELETE FROM friends WHERE a = ?1 AND b = ?2").bind(a, bb));
      break;
    case "block":
      stmts.push(
        env.DB.prepare(
          "INSERT INTO friends (a, b, state, requested_by, created_at) VALUES (?1, ?2, 'blocked', ?3, ?4) ON CONFLICT (a, b) DO UPDATE SET state = 'blocked', requested_by = ?3, created_at = ?4"
        ).bind(a, bb, me.id, t)
      );
      break;
    case "unblock":
      if (rel?.state !== "blocked" || rel.requested_by !== me.id) fail(404, "not_blocked", "No tienes bloqueado a este usuario.");
      stmts.push(env.DB.prepare("DELETE FROM friends WHERE a = ?1 AND b = ?2").bind(a, bb));
      break;
    default:
      fail(404, "not_found", "No existe.");
  }
  if (action === "accept" || action === "request" && rel?.state === "pending") {
    stmts.push(
      env.DB.prepare("INSERT INTO activity (user_id, kind, data, created_at) VALUES (?1, 'friend', ?2, ?3), (?4, 'friend', ?5, ?3)").bind(
        me.id,
        JSON.stringify({ with: other }),
        t,
        other,
        JSON.stringify({ with: me.id })
      )
    );
  }
  stmts.push(...bump(env, [me.id, other]));
  await env.DB.batch(stmts);
  return json({ ok: true });
}
__name(friendAction, "friendAction");
async function sync(env, me, url) {
  const since = Number(url.searchParams.get("rev"));
  const u = await env.DB.prepare("SELECT rev FROM users WHERE id = ?1").bind(me.id).first();
  if (!u) fail(401, "no_session", "La cuenta ya no existe.");
  if (u.rev === since) return new Response(null, { status: 304 });
  const rows = await env.DB.prepare(
    `SELECT f.other, f.state, f.requested_by, f.created_at AS friends_since, u.id, u.username, p.display_name, p.avatar, p.frame, s.level,
            pr.status, pr.game, pr.game_appid, pr.since, pr.last_seen
     FROM (SELECT b AS other, state, requested_by, created_at FROM friends WHERE a = ?1
           UNION ALL SELECT a, state, requested_by, created_at FROM friends WHERE b = ?1) f
     JOIN users u ON u.id = f.other LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN summaries s ON s.user_id = u.id LEFT JOIN presence pr ON pr.user_id = u.id`
  ).bind(me.id).all();
  const friends = [];
  const incoming = [];
  const outgoing = [];
  const blocked = [];
  for (const r of rows.results) {
    const card = userCard(r);
    if (r.state === "accepted") friends.push({ ...card, since: r.friends_since, presence: visiblePresence(r) });
    else if (r.state === "pending") (r.requested_by === me.id ? outgoing : incoming).push({ ...card, at: r.friends_since });
    else if (r.state === "blocked" && r.requested_by === me.id) blocked.push(card);
  }
  const last = await env.DB.prepare("SELECT MAX(id) AS id FROM comments WHERE profile_user = ?1").bind(me.id).first();
  return json({ rev: u.rev, me: await meOf(env, me.id), friends, incoming, outgoing, blocked, lastComment: last?.id || 0, now: now() });
}
__name(sync, "sync");
async function viewUser(env, me, id) {
  const r = await env.DB.prepare(
    `SELECT u.id, u.username, u.created_at, p.*, s.json AS summary, s.xp, s.level, s.badges, pr.status, pr.game, pr.game_appid, pr.since, pr.last_seen
     FROM users u JOIN profiles p ON p.user_id = u.id LEFT JOIN summaries s ON s.user_id = u.id LEFT JOIN presence pr ON pr.user_id = u.id WHERE u.id = ?1`
  ).bind(id).first();
  if (!r) fail(404, "not_found", "Ese perfil no existe.");
  const self = id === me.id;
  const rel = self ? null : await relation(env, me.id, id);
  if (rel?.state === "blocked" && rel.requested_by === id) fail(404, "not_found", "Ese perfil no existe.");
  const friend = rel?.state === "accepted";
  const relationOut = self ? "self" : !rel ? "none" : rel.state === "pending" ? rel.requested_by === me.id ? "outgoing" : "incoming" : rel.state === "blocked" ? "blocked" : "friend";
  const canSee = self || r.privacy === "public" || r.privacy === "friends" && friend;
  const card = { ...userCard(r), relation: relationOut, level: r.level || 0, memberSince: r.created_at };
  const base = { ...card, backgroundImage: r.background_img, background: r.background, color: r.color, country: r.country };
  if (!canSee) return json({ ...base, private: true });
  const friendsCount = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM friends WHERE a = ?1 AND state = 'accepted') + (SELECT COUNT(*) FROM friends WHERE b = ?1 AND state = 'accepted') AS n"
  ).bind(id).first();
  const activity = await env.DB.prepare("SELECT id, kind, data, created_at FROM activity WHERE user_id = ?1 ORDER BY id DESC LIMIT 15").bind(id).all();
  const canComment = self || r.comments === "public" && relationOut !== "blocked" || r.comments === "friends" && friend;
  return json({
    ...base,
    profile: profileOut(r),
    xp: r.xp || 0,
    badges: JSON.parse(r.badges || "[]"),
    summary: r.summary ? JSON.parse(r.summary) : null,
    presence: self || friend || r.privacy === "public" ? visiblePresence(r) : null,
    friends: friendsCount.n,
    activity: activity.results.map((a) => ({ id: a.id, kind: a.kind, data: JSON.parse(a.data), at: a.created_at })),
    canComment,
    commentsOff: r.comments === "off"
  });
}
__name(viewUser, "viewUser");
async function listComments(env, me, id, url) {
  const before = Number(url.searchParams.get("before")) || 1e15;
  const owner = await env.DB.prepare("SELECT privacy, comments FROM profiles WHERE user_id = ?1").bind(id).first();
  if (!owner) fail(404, "not_found", "Ese perfil no existe.");
  const rel = id === me.id ? null : await relation(env, me.id, id);
  if (rel?.state === "blocked" && rel.requested_by === id) fail(404, "not_found", "Ese perfil no existe.");
  if (id !== me.id && owner.privacy !== "public" && !(owner.privacy === "friends" && rel?.state === "accepted")) return json({ items: [] });
  const rows = await env.DB.prepare(
    `SELECT c.id, c.text, c.created_at, u.id AS uid, u.username, p.display_name, p.avatar, p.frame, s.level
     FROM comments c JOIN users u ON u.id = c.author LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN summaries s ON s.user_id = u.id
     WHERE c.profile_user = ?1 AND c.id < ?2 ORDER BY c.id DESC LIMIT 20`
  ).bind(id, before).all();
  return json({
    items: rows.results.map((r) => ({ id: r.id, text: r.text, at: r.created_at, author: userCard({ ...r, id: r.uid }), canDelete: r.uid === me.id || id === me.id }))
  });
}
__name(listComments, "listComments");
async function postComment(request, env, me, id) {
  const b = await body(request);
  const msg = text(b.text, 500);
  if (!msg) fail(400, "empty", "Escribe algo.");
  const owner = await env.DB.prepare("SELECT comments FROM profiles WHERE user_id = ?1").bind(id).first();
  if (!owner) fail(404, "not_found", "Ese perfil no existe.");
  if (id !== me.id) {
    const rel = await relation(env, me.id, id);
    const ok = rel?.state !== "blocked" && (owner.comments === "public" || owner.comments === "friends" && rel?.state === "accepted");
    if (!ok) fail(403, "no_comments", "No puedes comentar en este perfil.");
  }
  const r = await env.DB.prepare("INSERT INTO comments (profile_user, author, text, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id").bind(id, me.id, msg, now()).first();
  await env.DB.batch(bump(env, [id]));
  return json({ id: r.id }, 201);
}
__name(postComment, "postComment");
async function deleteComment(env, me, id) {
  const c = await env.DB.prepare("SELECT profile_user, author FROM comments WHERE id = ?1").bind(id).first();
  if (!c || c.author !== me.id && c.profile_user !== me.id) fail(404, "not_found", "Ese comentario no existe.");
  await env.DB.prepare("DELETE FROM comments WHERE id = ?1").bind(id).run();
  return json({ ok: true });
}
__name(deleteComment, "deleteComment");
async function postActivity(request, env, me) {
  const b = await body(request, 8 * 1024);
  const items = Array.isArray(b.items) ? b.items.slice(0, 20) : [b];
  const stmts = [];
  for (const it of items) {
    if (!ACTIVITY.includes(it.kind) || it.kind === "friend") continue;
    const d = it.data && typeof it.data === "object" ? it.data : {};
    const data = {
      game: text(d.game, 120) || null,
      appid: Number.isInteger(d.appid) ? d.appid : null,
      minutes: Number.isInteger(d.minutes) ? d.minutes : void 0,
      name: text(d.name, 120) || void 0,
      icon: text(d.icon, 300) || void 0,
      rarity: typeof d.rarity === "number" ? d.rarity : void 0,
      cover: text(d.cover, 300) || void 0,
      badge: text(d.badge, 30) || void 0,
      tier: Number.isInteger(d.tier) ? d.tier : void 0
    };
    stmts.push(env.DB.prepare("INSERT INTO activity (user_id, kind, data, created_at) VALUES (?1, ?2, ?3, ?4)").bind(me.id, it.kind, JSON.stringify(data), now()));
  }
  if (!stmts.length) fail(400, "bad_activity", "Petici\xF3n no v\xE1lida.");
  if (Math.random() < 0.05) {
    stmts.push(
      env.DB.prepare("DELETE FROM activity WHERE user_id = ?1 AND id < (SELECT id FROM activity WHERE user_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET 200)").bind(me.id)
    );
  }
  await env.DB.batch(stmts);
  return json({ ok: true }, 201);
}
__name(postActivity, "postActivity");
async function feed(env, me, url) {
  const before = Number(url.searchParams.get("before")) || 1e15;
  const rows = await env.DB.prepare(
    `SELECT a.id, a.user_id, a.kind, a.data, a.created_at, u.username, p.display_name, p.avatar, p.frame, s.level
     FROM activity a JOIN users u ON u.id = a.user_id LEFT JOIN profiles p ON p.user_id = a.user_id LEFT JOIN summaries s ON s.user_id = a.user_id
     WHERE a.user_id IN (SELECT b FROM friends WHERE a = ?1 AND state = 'accepted' UNION SELECT a FROM friends WHERE b = ?1 AND state = 'accepted' UNION SELECT ?1)
       AND a.id < ?2
     ORDER BY a.id DESC LIMIT 30`
  ).bind(me.id, before).all();
  const withIds = [...new Set(rows.results.filter((r) => r.kind === "friend").map((r) => JSON.parse(r.data).with))].filter(Number.isInteger);
  const names = {};
  if (withIds.length) {
    const w = await env.DB.prepare(`SELECT u.id, u.username, p.display_name, p.avatar, p.frame FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id IN (${withIds.map(() => "?").join(",")})`).bind(...withIds).all();
    for (const r of w.results) names[r.id] = userCard(r);
  }
  return json({
    items: rows.results.map((r) => {
      const data = JSON.parse(r.data);
      if (r.kind === "friend") data.user = names[data.with] || null;
      return { id: r.id, kind: r.kind, data, at: r.created_at, user: userCard({ ...r, id: r.user_id }) };
    })
  });
}
__name(feed, "feed");
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const media = /^\/v1\/media\/([0-9a-f]{64})$/.exec(path);
  if (media && method === "GET") return getMedia(request, env, media[1], ctx);
  if (!path.startsWith("/v1/")) return new Response("Not Found", { status: 404 });
  if (!await signed(request, url, env)) {
    return json({ error: "bad_signature", message: "Actualiza ejGames." }, 401, { "X-Ejg-Now": String(now()) });
  }
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (method === "POST" && (path === "/v1/register" || path === "/v1/login" || path === "/v1/recover")) {
    await limit(env.AUTH_LIMIT, ip);
    if (path === "/v1/register") return register(request, env);
    if (path === "/v1/login") return login(request, env);
    return recover(request, env);
  }
  const me = await auth(request, env);
  let m;
  if (path === "/v1/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(me.tokenHash).run();
    return json({ ok: true });
  }
  if (path === "/v1/me" && method === "GET") return json(await meOf(env, me.id));
  if (path === "/v1/me" && method === "DELETE") return deleteAccount(request, env, me);
  if (path === "/v1/password" && method === "POST") return changePassword(request, env, me);
  if (path === "/v1/profile" && method === "PUT") return putProfile(request, env, me);
  if (path === "/v1/summary" && method === "PUT") return putSummary(request, env, me);
  if (path === "/v1/media" && method === "POST") return postMedia(request, env, me, url);
  if (path === "/v1/presence" && method === "PUT") return putPresence(request, env, me);
  if (path === "/v1/sync" && method === "GET") return sync(env, me, url);
  if (path === "/v1/feed" && method === "GET") return feed(env, me, url);
  if (path === "/v1/activity" && method === "POST") return postActivity(request, env, me);
  if ((m = /^\/v1\/friends\/(request|accept|decline|remove|block|unblock)$/.exec(path)) && method === "POST") return friendAction(request, env, me, m[1]);
  if ((m = /^\/v1\/users\/(\d+)$/.exec(path)) && method === "GET") return viewUser(env, me, Number(m[1]));
  if (m = /^\/v1\/users\/(\d+)\/comments$/.exec(path)) {
    if (method === "GET") return listComments(env, me, Number(m[1]), url);
    if (method === "POST") return postComment(request, env, me, Number(m[1]));
  }
  if ((m = /^\/v1\/comments\/(\d+)$/.exec(path)) && method === "DELETE") return deleteComment(env, me, Number(m[1]));
  return json({ error: "not_found", message: "No existe." }, 404);
}
__name(route, "route");
var src_default = {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.error(e);
      return json({ error: "internal", message: "Error del servidor. Int\xE9ntalo m\xE1s tarde." }, 500);
    }
  }
};

// C:/Users/jairo/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// C:/Users/jairo/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body2 = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body2);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body2, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-aNGqya/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// C:/Users/jairo/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-aNGqya/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
