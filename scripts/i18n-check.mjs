// Busca textos de interfaz en español sin traducción al inglés.
//
//   pnpm i18n:check            lista lo que falta, por zona
//   pnpm i18n:check --strict   igual, y falla (código 1) si falta algo
//   pnpm i18n:check --wide     además, textos que parecen interfaz aunque no lleven acentos
//
// Zonas: host (src/), kit (sdk/kit/), cada tema (themes/<id>/) y el núcleo (src-tauri/src/).
// Un texto está cubierto si el traductor del diccionario de su zona lo traduce. Los que son
// iguales en inglés (marcas, «Error»…) se anotan en scripts/i18n-same.json.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(path.join(root, "package.json"))("typescript");
const { makeTranslator } = await import(pathToFileURL(path.join(root, "sdk/kit/translate.js")).href);
const strict = process.argv.includes("--strict");
const wide = process.argv.includes("--wide");

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {});
const same = new Set(Object.keys(readJson(path.join(root, "scripts/i18n-same.json"))));

const UI_PROPS = new Set(["label", "title", "hint", "placeholder", "text", "message", "body", "description", "sub", "desc", "okLabel", "cancelLabel", "aria-label", "alt", "subtitle", "heading", "empty", "name", "tip", "caption", "help"]);
const CALLS = new Set(["toast", "ask", "confirm", "alert", "message", "notify", "error", "info", "ok"]);
const SPANISH = /[áéíóúñ¿¡ÁÉÍÓÚÑ]|\b(el|la|los|las|de|del|que|para|con|sin|por|una?|tu|tus|se|en|y|o|no|más|este|esta|al|lo|su|sus|mi|mis|ya|hay|todo|todos|desde|hasta|como|cada)\b/i;

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "target", "vendor", "fonts", ".git", "i18n"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function noise(t) {
  if (/^\{\d+\}[-_a-z]/.test(t)) return true;
  if (/(px|rem|vh|vw|deg|ms)\b/.test(t) && !/[áéíóú ]/.test(t)) return true;
  if (/^[#.[\]{}()0-9a-zA-Z_:,;>+~*="' -]+$/.test(t) && !t.includes(" ") && !/[A-ZÁÉÍÓÚ][a-záéíóú]/.test(t)) return true;
  if (/^[a-z]+(-[a-z0-9]+)+$/.test(t)) return true;
  if (/^(data:|http|\/|#|rgba?\(|var\(|linear-gradient|radial-gradient|translate|scale\(|calc\(|url\()/.test(t)) return true;
  if (/^\W+$/.test(t)) return true;
  // Clases de Tailwind: todo en minúsculas y con guiones, barras, corchetes o cifras.
  if (!/[A-ZÁÉÍÓÚÑáéíóúñ]/.test(t) && t.split(" ").every((w) => /^[a-z0-9:_[\]/%.(){}-]+$/.test(w)) && t.split(" ").some((w) => /[-[\]/0-9]/.test(w))) return true;
  return false;
}

function keep(s, ctx) {
  if (/^(<|--|\.|@|\$)/.test(s) || s.includes('="') || (s.includes("px") && !SPANISH.test(s))) return false;
  if (/[;{}]\s*$/.test(s) && !SPANISH.test(s)) return false;
  if (/\b(solid|flex|grid|none|auto|inherit|center)\b/.test(s) && !SPANISH.test(s)) return false;
  if (SPANISH.test(s) || /^[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ ]{2,}$/.test(s)) return true;
  // --wide: texto con pinta de interfaz aunque no lleve acentos ni palabras vacías.
  return wide && ctx !== "lit" ? /^[A-ZÁÉÍÓÚÑ¿¡]/.test(s) : wide && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+( [a-záéíóúñ]+){0,6}[.…:?!]?$/.test(s);
}

function addText(set, raw, ctx) {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 2 || !/[A-Za-zÁ-ú]/.test(t) || noise(t) || /^[a-z][a-zA-Z0-9]*$/.test(t)) return;
  if (!keep(t, ctx)) return;
  set.add(t);
}

function scanTs(file, set) {
  const src = fs.readFileSync(file, "utf8");
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const visit = (n) => {
    if (ts.isJsxText(n)) addText(set, n.getText(), "jsx");
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      let ctx = "lit";
      if (ts.isJsxAttribute(p) && UI_PROPS.has(p.name.getText())) ctx = "attr";
      else if (ts.isPropertyAssignment(p) && UI_PROPS.has(p.name.getText().replace(/['"]/g, ""))) ctx = "prop";
      else if (ts.isCallExpression(p)) {
        const last = p.expression.getText().split(".").pop();
        if (last === "h" && p.arguments.indexOf(n) >= 2) ctx = "h-child";
        else if (CALLS.has(last) || last === "t") ctx = "call";
      } else if (ts.isBinaryExpression(p) && /textContent|innerText|title|placeholder/.test(p.left.getText())) ctx = "assign";
      if (!(ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p))) addText(set, n.text, ctx);
    } else if (ts.isTemplateExpression(n)) {
      let s = n.head.text;
      let i = 0;
      for (const sp of n.templateSpans) s += `{${i++}}` + sp.literal.text;
      addText(set, s, "tpl");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

function scanHtml(file, set) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/>([^<>{}]+)</g)) addText(set, m[1], "html");
  for (const m of src.matchAll(/\b(?:title|placeholder|aria-label|alt)="([^"]+)"/g)) addText(set, m[1], "html-attr");
}

function scanRust(file, set) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const l = line.trim();
    if (/^\/\/|tracing::|println!|panic!|assert|#\[|expect\(/.test(l)) continue;
    for (const m of l.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      let s = m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\'/g, "'");
      if (s.length < 6 || !SPANISH.test(s) || !s.includes(" ")) continue;
      if (/^[a-z_:/.\-0-9 ]+$/.test(s) && !/[áéíóú]/.test(s)) continue;
      let n = 0;
      s = s.replace(/\{([^{}]*)\}/g, (_, inner) => {
        const name = inner.split(":")[0];
        return name === "" || /^\d+$/.test(name) || !/^\w+$/.test(name) ? `{${n++}}` : `{${name}}`;
      });
      if (!noise(s)) set.add(s);
    }
  }
}

function collect(dir, { rust = false } = {}) {
  const set = new Set();
  for (const f of walk(dir, rust ? /\.rs$/ : /\.(tsx?|jsx?|mjs|html)$/)) {
    if (rust) scanRust(f, set);
    else if (f.endsWith(".html")) scanHtml(f, set);
    else scanTs(f, set);
  }
  return [...set];
}

const dict = (p) => readJson(path.join(root, p));
const sdkDict = dict("sdk/i18n/en.json");
const zones = [
  { name: "host (src/)", keys: collect(path.join(root, "src")), dict: dict("src/lib/en.json") },
  { name: "núcleo (src-tauri/)", keys: collect(path.join(root, "src-tauri/src"), { rust: true }), dict: dict("src/lib/en.json") },
  { name: "kit (sdk/kit/)", keys: collect(path.join(root, "sdk/kit")), dict: sdkDict },
  ...fs.readdirSync(path.join(root, "themes"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({
    name: `tema ${e.name}`,
    keys: collect(path.join(root, "themes", e.name)),
    dict: { ...sdkDict, ...dict(`themes/${e.name}/i18n/en.json`) },
  })),
];

const dumpAt = process.argv.indexOf("--dump");
if (dumpAt > 0) {
  fs.writeFileSync(process.argv[dumpAt + 1], JSON.stringify(Object.fromEntries(zones.map((z) => [z.name, z.keys])), null, 1));
}

// Diccionarios: sin valores vacíos y con los mismos huecos {…} en las dos lenguas.
let broken = 0;
const holes = (t) => [...t.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort().join(",");
const files = ["src/lib/en.json", "sdk/i18n/en.json", "src-tauri/i18n/en.json", ...fs.readdirSync(path.join(root, "themes")).map((t) => `themes/${t}/i18n/en.json`)];
for (const f of files) {
  for (const [k, v] of Object.entries(dict(f))) {
    if (typeof v !== "string" || !v.trim()) { console.log(`  ${f}: valor vacío para ${JSON.stringify(k)}`); broken++; }
    else if (holes(k) !== holes(v)) { console.log(`  ${f}: huecos distintos en ${JSON.stringify(k)}`); broken++; }
  }
}
if (broken) console.log(`${broken} entradas de diccionario con problemas`);

let missing = 0;
for (const z of zones) {
  const tr = makeTranslator(z.dict);
  const miss = z.keys.filter((k) => tr.text(k) == null && !same.has(k)).sort((a, b) => a.localeCompare(b, "es"));
  console.log(`\n== ${z.name}: ${z.keys.length} textos, ${miss.length} sin traducir`);
  for (const k of miss) console.log("  " + JSON.stringify(k).slice(0, 170));
  missing += miss.length;
}
console.log(`\n${missing} textos sin traducir`);
if (strict && (missing || broken)) process.exit(1);
