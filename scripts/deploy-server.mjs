// Despliega la API de cuentas (server/) en tu Cloudflare y deja server/.dev.vars
// listo para compilar la app con cuentas:
//
//   npx wrangler login          (una vez)
//   pnpm deploy-server
//
// 1. Crea la base de datos D1 «ejgames» si no existe y pone su id en server/wrangler.toml.
// 2. Crea o pone al día sus tablas (server/migrations).
// 3. Genera la clave de la app (o reutiliza la de server/.dev.vars) y la sube como secreto.
// 4. Despliega el Worker y guarda su URL y la clave en server/.dev.vars.
// Se puede repetir: lo que ya está hecho no se toca.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toml = join(root, "server", "wrangler.toml");
const vars = join(root, "server", ".dev.vars");
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const W = "npx wrangler";

const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, CI: "1" }, ...opts });
const step = (m) => console.log(`\n▸ ${m}`);

step("Comprobando la sesión de Cloudflare");
try {
  run(`${W} whoami`);
} catch {
  console.error("No hay sesión. Ejecuta antes: npx wrangler login");
  process.exit(1);
}

// 1. Base de datos
let conf = readFileSync(toml, "utf8");
if (conf.includes(PLACEHOLDER)) {
  step("Creando la base de datos D1 «ejgames»");
  let id = null;
  try {
    const out = run(`${W} d1 create ejgames`);
    id = /database_id\s*=\s*"([0-9a-f-]{36})"/.exec(out)?.[1] || /"database_id":\s*"([0-9a-f-]{36})"/.exec(out)?.[1];
  } catch {
    // Ya existe: se busca en la lista.
  }
  if (!id) {
    const list = JSON.parse(run(`${W} d1 list --json`));
    id = list.find((d) => d.name === "ejgames")?.uuid;
  }
  if (!id) {
    console.error("No se pudo crear ni encontrar la base de datos «ejgames».");
    process.exit(1);
  }
  conf = conf.replace(PLACEHOLDER, id);
  writeFileSync(toml, conf);
  console.log(`  database_id = ${id} (guardado en server/wrangler.toml)`);
}

// 2. Tablas
step("Aplicando las migraciones");
run(`${W} d1 migrations apply ejgames --remote -c server/wrangler.toml`, { stdio: "inherit" });

// 3. Clave de la app
const saved = existsSync(vars) ? Object.fromEntries(readFileSync(vars, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2).map((x) => x.trim()))) : {};
const key = saved.APP_KEY || randomBytes(32).toString("hex");
step(saved.APP_KEY ? "Subiendo la clave de la app (la de server/.dev.vars)" : "Generando y subiendo la clave de la app");
run(`${W} secret put APP_KEY -c server/wrangler.toml`, { input: key });

// 4. Despliegue
step("Desplegando el Worker");
const out = run(`${W} deploy -c server/wrangler.toml`);
process.stdout.write(out);
const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(out)?.[0] || saved.API_URL;
if (!url) {
  console.error("No encuentro la URL del Worker en la salida. Ponla a mano en server/.dev.vars (API_URL=…).");
  process.exit(1);
}
writeFileSync(vars, `API_URL=${url}\nAPP_KEY=${key}\n`);
console.log(`\n✓ API de cuentas en ${url}`);
console.log("  server/.dev.vars listo (fuera de git). Ahora compila la app con cuentas: pnpm release …");
