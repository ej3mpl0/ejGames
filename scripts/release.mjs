// Versión nueva + instalador versionado.
//
//   pnpm release patch|minor|major   → 0.2.0 → 0.2.1 | 0.3.0 | 1.0.0
//   pnpm release 1.4.2               → versión exacta
//   pnpm release --solo-build        → compila la versión actual (sin subirla)
//
// Actualiza package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml y
// Cargo.lock, compila (`pnpm tauri build`) y copia el instalador a
// installer/ejGames_<versión>_x64-setup.exe. Nunca sobrescribe un instalador
// que ya exista: cada versión se queda con el suyo.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...x) => join(root, ...x);
const arg = process.argv[2];
if (!arg) {
  console.error("Uso: pnpm release patch|minor|major|<x.y.z>|--solo-build");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(p("package.json"), "utf8"));
const current = pkg.version;
const [ma, mi, pa] = current.split(".").map(Number);
const next =
  arg === "--solo-build"
    ? current
    : arg === "patch"
      ? `${ma}.${mi}.${pa + 1}`
      : arg === "minor"
        ? `${ma}.${mi + 1}.0`
        : arg === "major"
          ? `${ma + 1}.0.0`
          : arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Versión no válida: ${next}`);
  process.exit(1);
}
const out = p("installer", `ejGames_${next}_x64-setup.exe`);
if (existsSync(out)) {
  console.error(`Ya existe ${out}: sube la versión (no se sobrescriben instaladores).`);
  process.exit(1);
}

function replaceIn(file, re, to) {
  const text = readFileSync(file, "utf8");
  if (!re.test(text)) throw new Error(`No encuentro la versión en ${file}`);
  writeFileSync(file, text.replace(re, to));
}

if (next !== current) {
  console.log(`Versión ${current} → ${next}`);
  replaceIn(p("package.json"), /("version":\s*")[^"]+(")/, `$1${next}$2`);
  replaceIn(p("src-tauri", "tauri.conf.json"), /("version":\s*")[^"]+(")/, `$1${next}$2`);
  replaceIn(p("src-tauri", "Cargo.toml"), /^(version\s*=\s*")[^"]+(")/m, `$1${next}$2`);
  replaceIn(p("src-tauri", "Cargo.lock"), /(name = "ejgames"\r?\nversion = ")[^"]+(")/, `$1${next}$2`);
  if (!readFileSync(p("CHANGELOG.md"), "utf8").includes(`## ${next}`)) {
    console.warn(`Aviso: CHANGELOG.md no tiene una entrada "## ${next}".`);
  }
}

console.log("Compilando…");
execSync("pnpm tauri build", { cwd: root, stdio: "inherit" });

const target = process.env.CARGO_TARGET_DIR || p("src-tauri", "target");
const built = join(target, "release", "bundle", "nsis", `ejGames_${next}_x64-setup.exe`);
if (!existsSync(built)) {
  console.error(`No encuentro el instalador compilado: ${built}`);
  process.exit(1);
}
mkdirSync(p("installer"), { recursive: true });
copyFileSync(built, out);
console.log(`\n✓ ${out}`);
