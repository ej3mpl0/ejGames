// Comprobaciones antes de publicar:  pnpm check  (añade --rust para correr también los tests de Rust)
//
//   · tipos del host (tsc)
//   · sintaxis de los temas, del SDK y de sus módulos
//   · theme.json de cada tema (que se lea, con id y nombre)
//   · que los diccionarios de inglés cubran todo (i18n:check --strict)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const withRust = process.argv.includes("--rust");
let failed = 0;
const step = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: process.platform === "win32", ...opts });

// tsc
{
  const r = run("npx", ["tsc", "--noEmit", "-p", "."]);
  step("TypeScript", r.status === 0, r.status === 0 ? "" : (r.stdout || r.stderr).split("\n").slice(0, 5).join(" | "));
}

// sintaxis JS de temas y SDK
{
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (["vendor", "node_modules", "fonts"].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(root, "themes"));
  walk(path.join(root, "sdk"));
  const bad = files.filter((f) => run("node", ["--check", f]).status !== 0).map((f) => path.relative(root, f));
  step(`JavaScript de temas y SDK (${files.length} ficheros)`, bad.length === 0, bad.join(", "));
}

// theme.json
{
  const bad = [];
  for (const e of fs.readdirSync(path.join(root, "themes"), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root, "themes", e.name, "theme.json"), "utf8").replace(/^﻿/, ""));
      if (!m.id || !m.name) bad.push(`${e.name}: falta id o name`);
      else if (m.id !== e.name) bad.push(`${e.name}: el id es «${m.id}»`);
    } catch (err) {
      bad.push(`${e.name}: ${err.message}`);
    }
  }
  step("theme.json de los temas", bad.length === 0, bad.join("; "));
}

// inglés
{
  const r = run("node", ["scripts/i18n-check.mjs", "--wide", "--strict"]);
  const last = (r.stdout || "").trim().split("\n").pop();
  step("Inglés: textos sin traducir y huecos", r.status === 0, r.status === 0 ? "" : last + " (pnpm i18n:check --wide para verlos)");
}

if (withRust) {
  const r = run("cargo", ["test", "--lib"], { cwd: path.join(root, "src-tauri") });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("test result")) || (r.stderr || "").split("\n").slice(-3).join(" | ");
  step("Tests de Rust", r.status === 0, line);
}

console.log(failed ? `\n${failed} comprobaciones fallan` : "\nTodo en orden");
process.exit(failed ? 1 : 0);
