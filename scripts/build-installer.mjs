// Instalador propio (installer-app/): mete dentro el paquete NSIS de la versión
// y deja installer/ejGames_<versión>_Setup.exe, que es lo que se publica (también
// para las actualizaciones automáticas). Lo llama release.mjs; también se puede
// lanzar solo:
//
//   node scripts/build-installer.mjs            → versión de package.json
//
// El NSIS (…_x64-setup.exe) no se publica: va dentro, y el instalador lo abre tal
// cual si al PC le falta WebView2.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...x) => join(root, ...x);
const version = process.argv[2] || JSON.parse(readFileSync(p("package.json"), "utf8")).version;
const target = process.env.CARGO_TARGET_DIR || p("src-tauri", "target");
const nsis = join(target, "release", "bundle", "nsis", `ejGames_${version}_x64-setup.exe`);
const payload = existsSync(nsis) ? nsis : p("installer", `ejGames_${version}_x64-setup.exe`);
if (!existsSync(payload)) {
  console.error(`No encuentro el paquete NSIS de la ${version}. Compílalo antes (pnpm release …).`);
  process.exit(1);
}

// Lo que ocupa instalado: el ejecutable más los temas y el SDK.
function size(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((a, f) => a + size(join(path, f)), 0);
}
const exe = join(target, "release", "ejgames.exe");
const installed = (existsSync(exe) ? size(exe) : 30e6) + size(p("themes")) + size(p("sdk"));

// Su propio target (otro perfil de compilación que el de ejGames).
const env = { ...process.env, EJG_PAYLOAD: payload, EJG_VERSION: version, EJG_INSTALLED_BYTES: String(Math.round(installed)) };
delete env.CARGO_TARGET_DIR;

console.log(`Instalador propio ${version} (paquete de ${(statSync(payload).size / 1048576).toFixed(1)} MB)…`);
execFileSync(process.execPath, [p("node_modules", "@tauri-apps", "cli", "tauri.js"), "build", "--no-bundle"], {
  cwd: p("installer-app"),
  stdio: "inherit",
  env,
});

const built = p("installer-app", "src-tauri", "target", "release", "ejgames-installer.exe");
const out = p("installer", `ejGames_${version}_Setup.exe`);
mkdirSync(p("installer"), { recursive: true });
copyFileSync(built, out);
console.log(`✓ ${out}`);
