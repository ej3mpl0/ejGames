// Copia dependencias de terceros que necesitan los temas (servidos por ejg-theme,
// sin acceso a node_modules ni a internet): hls.js light y fuentes OFL.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");

function copy(from, to) {
  const src = join(nm, from);
  if (!existsSync(src)) {
    console.warn(`[vendor] no existe ${from}, se omite`);
    return;
  }
  const dst = join(root, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`[vendor] ${from} -> ${to}`);
}

copy("hls.js/dist/hls.light.min.js", "sdk/vendor/hls.light.min.js");

// Solo el subconjunto latin en woff2 para mantener los temas ligeros.
function copyFont(pkg, match, to) {
  const dir = join(nm, "@fontsource", pkg, "files");
  if (!existsSync(dir)) return console.warn(`[vendor] falta @fontsource/${pkg}`);
  for (const f of readdirSync(dir)) {
    if (match.test(f)) copy(`@fontsource/${pkg}/files/${f}`, `${to}/${f}`);
  }
}
copyFont("press-start-2p", /^press-start-2p-latin-400-normal\.woff2$/, "themes/retro/fonts");
copyFont("nunito", /^nunito-latin-(400|700|800)-normal\.woff2$/, "themes/switch/fonts");
