// Recorre la API de cuentas contra `wrangler dev` (D1 local) con dos usuarios:
//   npx wrangler dev -c server/wrangler.toml --port 8787
//   node server/test.mjs [http://127.0.0.1:8787]
// Las claves son aleatorias (en la app las deriva argon2id).
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const key = () => randomBytes(32).toString("hex");
const tag = randomBytes(3).toString("hex");

async function call(method, path, { token, body, raw, type } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (raw) headers["content-type"] = type || "application/octet-stream";
  const r = await fetch(BASE + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: r.status, data };
}

const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};

let step = 0;
const log = (m) => console.log(`${String(++step).padStart(2)} ✓ ${m}`);

// ── cuentas
const ana = { username: `ana_${tag}`, key: key(), recovery: key() };
const beto = { username: `Beto.${tag}`, key: key(), recovery: key() };
const r1 = ok(await call("POST", "/v1/register", { body: { ...ana, displayName: "Ana" } }), 201);
ana.token = r1.token;
ana.id = r1.me.id;
assert.match(r1.me.friendCode, /^\d{3}-\d{3}-\d{3}$/);
log(`registro de ${ana.username} (código ${r1.me.friendCode})`);
const r2 = ok(await call("POST", "/v1/register", { body: beto }), 201);
beto.token = r2.token;
beto.id = r2.me.id;
beto.code = r2.me.friendCode;
log(`registro de ${beto.username}`);
assert.equal((await call("POST", "/v1/register", { body: { ...ana, username: ana.username.toUpperCase() } })).status, 409);
log("nombre repetido (sin distinguir mayúsculas) → 409");
assert.equal((await call("POST", "/v1/register", { body: { ...ana, username: "a b" } })).status, 400);
log("nombre no válido → 400");
assert.equal((await call("POST", "/v1/login", { body: { username: ana.username, key: key() } })).status, 401);
log("contraseña mala → 401");
const l = ok(await call("POST", "/v1/login", { body: { username: ana.username.toUpperCase(), key: ana.key } }));
log("login sin distinguir mayúsculas");
ok(await call("POST", "/v1/logout", { token: l.token }));
assert.equal((await call("GET", "/v1/me", { token: l.token })).status, 401);
log("logout invalida el token");

// ── amigos
const s0 = ok(await call("GET", "/v1/sync?rev=0", { token: ana.token }));
assert.equal(s0.friends.length, 0);
assert.equal((await call("GET", `/v1/sync?rev=${s0.rev}`, { token: ana.token })).status, 304);
log("sync sin cambios → 304");
ok(await call("POST", "/v1/friends/request", { token: ana.token, body: { user: beto.code } }));
log("solicitud por código de amigo");
assert.equal((await call("POST", "/v1/friends/request", { token: ana.token, body: { user: beto.username } })).status, 409);
log("solicitud repetida → 409");
const sb = ok(await call("GET", "/v1/sync?rev=0", { token: beto.token }));
assert.equal(sb.incoming.length, 1);
assert.equal(sb.incoming[0].name, "Ana");
log("a Beto le llega la solicitud");
assert.notEqual(ok(await call("GET", "/v1/sync?rev=0", { token: ana.token })).rev, s0.rev);
ok(await call("POST", "/v1/friends/accept", { token: beto.token, body: { id: ana.id } }));
const sa = ok(await call("GET", `/v1/sync?rev=${s0.rev}`, { token: ana.token }));
assert.equal(sa.friends.length, 1);
assert.equal(sa.friends[0].presence.status, "online");
log("aceptada: amigos y en línea");

// ── presencia
ok(await call("PUT", "/v1/presence", { token: beto.token, body: { status: "online", game: "Hollow Knight", appid: 367520 } }));
const sa2 = ok(await call("GET", `/v1/sync?rev=${sa.rev}`, { token: ana.token }));
assert.equal(sa2.friends[0].presence.game, "Hollow Knight");
log("«jugando a Hollow Knight» llega a Ana");
ok(await call("PUT", "/v1/presence", { token: beto.token, body: { status: "online", game: "Hollow Knight", appid: 367520, since: sa2.friends[0].presence.since } }));
assert.equal((await call("GET", `/v1/sync?rev=${sa2.rev}`, { token: ana.token })).status, 304);
log("latido sin cambios no molesta a los amigos (304)");
ok(await call("PUT", "/v1/presence", { token: beto.token, body: { status: "invisible" } }));
const sa3 = ok(await call("GET", `/v1/sync?rev=${sa2.rev}`, { token: ana.token }));
assert.equal(sa3.friends[0].presence.status, "offline");
assert.equal(sa3.friends[0].presence.game, undefined);
log("invisible → Ana lo ve desconectado");

// ── perfil e imágenes
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(200)]);
const up = ok(await call("POST", "/v1/media?kind=avatar", { token: ana.token, raw: jpeg, type: "image/jpeg" }), 201);
assert.equal((await call("POST", "/v1/media?kind=avatar", { token: ana.token, raw: Buffer.from("hola") })).status, 400);
log("subir avatar (y rechazar lo que no es imagen)");
const got = await fetch(`${BASE}/v1/media/${up.hash}`);
assert.equal(got.status, 200);
assert.equal(got.headers.get("content-type"), "image/jpeg");
log("el avatar se sirve por su hash");
const me = ok(
  await call("PUT", "/v1/profile", {
    token: ana.token,
    body: { name: "Ana 🎮", bio: "Cazadora de logros", country: "es", avatar: up.hash, frame: "neon", background: "aurora", showcases: [{ type: "text", title: "Hola", text: "Qué tal" }, { type: "bogus" }] },
  }),
);
assert.equal(me.profile.country, "ES");
assert.equal(me.profile.showcases.length, 1);
assert.equal(me.profile.avatar, up.hash);
log("perfil guardado (vitrina saneada)");
const bUp = ok(await call("POST", "/v1/media?kind=avatar", { token: beto.token, raw: Buffer.concat([jpeg, Buffer.from("b")]) }), 201);
assert.equal((await call("PUT", "/v1/profile", { token: ana.token, body: { avatar: bUp.hash } })).status, 400);
log("no se puede usar la imagen de otro");
ok(await call("PUT", "/v1/summary", { token: ana.token, body: { hash: key(), games: [{ title: "Hollow Knight", appid: 367520, minutes: 1200, ach: [30, 63] }], stats: { minutes: 1200, achievements: 30 }, xp: 1500, level: 7, badges: [{ id: "collector", tier: 2 }] } }));
log("resumen de juegos subido");

// ── ver perfiles y privacidad
const vb = ok(await call("GET", `/v1/users/${ana.id}`, { token: beto.token }));
assert.equal(vb.relation, "friend");
assert.equal(vb.level, 7);
assert.equal(vb.summary.games[0].title, "Hollow Knight");
log("Beto ve el perfil de Ana (nivel, juegos)");
ok(await call("PUT", "/v1/profile", { token: ana.token, body: { privacy: "private" } }));
assert.equal(ok(await call("GET", `/v1/users/${ana.id}`, { token: beto.token })).private, true);
ok(await call("PUT", "/v1/profile", { token: ana.token, body: { privacy: "public" } }));
log("perfil privado: solo lo básico");

// ── comentarios
const c = ok(await call("POST", `/v1/users/${ana.id}/comments`, { token: beto.token, body: { text: "¡Buen perfil!" } }), 201);
const cl = ok(await call("GET", `/v1/users/${ana.id}/comments`, { token: ana.token }));
assert.equal(cl.items[0].text, "¡Buen perfil!");
assert.equal(cl.items[0].canDelete, true);
log("comentario de Beto en el perfil de Ana");
ok(await call("PUT", "/v1/profile", { token: ana.token, body: { comments: "off" } }));
assert.equal((await call("POST", `/v1/users/${ana.id}/comments`, { token: beto.token, body: { text: "otro" } })).status, 403);
ok(await call("DELETE", `/v1/comments/${c.id}`, { token: ana.token }));
log("comentarios desactivados y borrado por la dueña");

// ── actividad
ok(await call("POST", "/v1/activity", { token: beto.token, body: { items: [{ kind: "played", data: { game: "Hollow Knight", minutes: 95 } }, { kind: "achievement", data: { game: "Hollow Knight", name: "Falsa Caballera", rarity: 12.5 } }] } }), 201);
const fd = ok(await call("GET", "/v1/feed", { token: ana.token }));
assert.ok(fd.items.some((i) => i.kind === "achievement" && i.user.id === beto.id));
assert.ok(fd.items.some((i) => i.kind === "friend" && i.data.user));
log(`feed de Ana: ${fd.items.length} entradas (logro de Beto, amistad)`);

// ── bloqueo
ok(await call("POST", "/v1/friends/block", { token: beto.token, body: { id: ana.id } }));
const sa4 = ok(await call("GET", "/v1/sync?rev=0", { token: ana.token }));
assert.equal(sa4.friends.length, 0);
assert.equal((await call("GET", `/v1/users/${beto.id}`, { token: ana.token })).status, 404);
assert.equal((await call("POST", "/v1/friends/request", { token: ana.token, body: { user: beto.username } })).status, 403);
log("bloqueo: fuera de amigos, perfil oculto, sin solicitudes");
ok(await call("POST", "/v1/friends/unblock", { token: beto.token, body: { id: ana.id } }));
log("desbloqueo");

// ── recuperación y contraseña
const newKey = key();
const rec = ok(await call("POST", "/v1/recover", { body: { username: beto.username, recovery: beto.recovery, key: newKey, newRecovery: key() } }));
assert.equal((await call("GET", "/v1/me", { token: beto.token })).status, 401);
ok(await call("POST", "/v1/login", { body: { username: beto.username, key: newKey } }));
log("recuperación: contraseña nueva y sesiones viejas cerradas");
const pw2 = key();
ok(await call("POST", "/v1/password", { token: rec.token, body: { key: newKey, newKey: pw2 } }));
assert.equal((await call("POST", "/v1/login", { body: { username: beto.username, key: newKey } })).status, 401);
ok(await call("GET", "/v1/me", { token: rec.token }));
log("cambio de contraseña (esta sesión sigue)");

// ── borrar cuenta
assert.equal((await call("DELETE", "/v1/me", { token: rec.token, body: { key: newKey } })).status, 401);
ok(await call("DELETE", "/v1/me", { token: rec.token, body: { key: pw2 } }));
assert.equal((await call("GET", "/v1/me", { token: rec.token })).status, 401);
log("cuenta borrada");

console.log(`\nTodo bien (${step} comprobaciones).`);
