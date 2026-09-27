// Publica en GitHub la versión actual (etiqueta vX.Y.Z con el instalador) para
// que las copias instaladas de ejGames la ofrezcan al abrirse.
//
//   pnpm release minor            → compila y deja installer/ejGames_<v>_x64-setup.exe y _Instalar.exe
//   pnpm publish-release          → crea la release en GitHub con los dos instaladores
//   pnpm publish-release --draft  → como borrador
//
// Las notas salen de la sección de esa versión en CHANGELOG.md. Hace falta el
// GitHub CLI con sesión iniciada (`gh auth login`) en la cuenta dueña del repo.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const draft = process.argv.includes("--draft");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tag = `v${version}`;
const installer = join(root, "installer", `ejGames_${version}_x64-setup.exe`);
// El instalador propio (el que se descarga a mano). El NSIS es el de las actualizaciones.
const pretty = join(root, "installer", `ejGames_${version}_Instalar.exe`);
const REPO = "ej3mpl0/ejGames";

if (!existsSync(installer)) {
  console.error(`No está el instalador ${installer}. Genéralo antes con \`pnpm release …\`.`);
  process.exit(1);
}

// Notas: lo que hay entre "## <versión>" y la siguiente "## ".
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const start = changelog.search(new RegExp(`^## ${version.replace(/\./g, "\\.")}\\s*$`, "m"));
let notes = "";
if (start >= 0) {
  const rest = changelog.slice(start).split(/\r?\n/).slice(1).join("\n");
  const end = rest.search(/^## /m);
  notes = (end >= 0 ? rest.slice(0, end) : rest).trim();
}
if (!notes) {
  console.error(`CHANGELOG.md no tiene la sección «## ${version}».`);
  process.exit(1);
}
const head = existsSync(pretty)
  ? `**Para instalar, descarga \`ejGames_${version}_Instalar.exe\`.** Si ya tienes ejGames, se actualiza solo al abrirlo.\n\n`
  : "";
const notesFile = join(mkdtempSync(join(tmpdir(), "ejgames-release-")), "notas.md");
writeFileSync(notesFile, head + notes);
const assets = [installer, ...(existsSync(pretty) ? [pretty] : [])];

const gh = (args, opts = {}) => execFileSync("gh", args, { stdio: "inherit", ...opts });
let exists = true;
try {
  execFileSync("gh", ["release", "view", tag, "-R", REPO], { stdio: "ignore" });
} catch {
  exists = false;
}

if (exists) {
  console.log(`La release ${tag} ya existe: se sustituyen el instalador y las notas.`);
  gh(["release", "upload", tag, ...assets, "--clobber", "-R", REPO]);
  gh(["release", "edit", tag, "--notes-file", notesFile, "-R", REPO]);
} else {
  const args = ["release", "create", tag, ...assets, "--title", `ejGames ${version}`, "--notes-file", notesFile, "-R", REPO];
  if (draft) args.push("--draft");
  gh(args);
}
console.log(`Publicada ${tag}. Las copias instaladas la ofrecerán al abrirse.`);
