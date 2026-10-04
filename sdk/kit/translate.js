// Traductor de interfaz en tiempo de ejecución (host y temas, en inglés).
//
// La clave de cada texto es el propio texto en español; el diccionario dice cómo
// va en el otro idioma. Los textos con datos llevan huecos: «Descargas ({0})» →
// «Downloads ({0})». Se traducen los nodos de texto y los atributos de interfaz
// (title, placeholder, aria-label, alt) y se sigue observando el documento, así
// que vale también para lo que se pinta después.
//
//   const tr = makeTranslator({ "Jugar": "Play", "{0} juegos": "{0} games" });
//   tr.text("12 juegos")   // "12 games"; null si no hay traducción
//   observe(tr, document)  // traduce ahora y lo que cambie

const HOLE = /\{([A-Za-z0-9_]+)\}/g;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "NOSCRIPT"]);
export const ATTRS = ["title", "placeholder", "aria-label", "alt"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {Record<string,string>} dict */
export function makeTranslator(dict) {
  const exact = new Map();
  /** @type {{re: RegExp, names: string[], to: string, lead: string}[]} */
  const patterns = [];
  for (const [k, v] of Object.entries(dict || {})) {
    if (typeof v !== "string") continue;
    if (!HOLE.test(k)) {
      HOLE.lastIndex = 0;
      exact.set(k, v);
      continue;
    }
    HOLE.lastIndex = 0;
    const names = [];
    let src = "";
    let last = 0;
    for (const m of k.matchAll(HOLE)) {
      src += esc(k.slice(last, m.index)) + "(.+?)";
      names.push(m[1]);
      last = m.index + m[0].length;
    }
    src += esc(k.slice(last));
    patterns.push({ re: new RegExp("^" + src + "$", "s"), names, to: v, lead: k.slice(0, k.indexOf("{")) });
  }
  // Los temas que ponen todo en mayúsculas (Retro) piden «JUGAR» en vez de «Jugar».
  const upper = new Map();
  for (const [k, v] of exact) {
    const K = k.toUpperCase();
    if (K !== k && !exact.has(K) && !upper.has(K)) upper.set(K, v.toUpperCase());
  }
  // Las plantillas más largas (más específicas) primero.
  patterns.sort((a, b) => b.lead.length - a.lead.length);
  const cache = new Map();

  function lookup(s) {
    if (exact.has(s)) return exact.get(s);
    if (upper.has(s)) return upper.get(s);
    for (const p of patterns) {
      const m = p.re.exec(s);
      if (!m) continue;
      const got = {};
      p.names.forEach((n, i) => (got[n] = m[i + 1]));
      return p.to.replace(HOLE, (_, n) => (n in got ? got[n] : ""));
    }
    return null;
  }

  return {
    size: exact.size + patterns.length,
    /** Traducción de un texto suelto (sin espacios sobrantes), o null. */
    text(raw) {
      const s = raw.replace(/\s+/g, " ").trim();
      if (!s) return null;
      if (cache.has(s)) return cache.get(s);
      const r = lookup(s);
      if (cache.size > 6000) cache.clear();
      cache.set(s, r);
      return r;
    },
  };
}

function translateText(tr, node) {
  const raw = node.nodeValue;
  if (!raw || !raw.trim()) return;
  const out = tr.text(raw);
  if (out == null) return;
  // Conserva los espacios de alrededor (los que separan de otros nodos).
  const lead = raw.match(/^\s*/)[0];
  const trail = raw.match(/\s*$/)[0];
  const next = lead + out + trail;
  if (next !== raw) node.nodeValue = next;
}

function translateAttrs(tr, el) {
  for (const a of ATTRS) {
    const v = el.getAttribute && el.getAttribute(a);
    if (!v) continue;
    const out = tr.text(v);
    if (out != null && out !== v) el.setAttribute(a, out);
  }
}

function skipped(node) {
  for (let n = node.nodeType === 3 ? node.parentNode : node; n && n.nodeType === 1; n = n.parentNode) {
    if (SKIP_TAGS.has(n.tagName) || n.hasAttribute("data-no-t") || n.isContentEditable) return true;
  }
  return false;
}

/** Traduce `root` (nodo, o documento) entero. */
export function translateTree(tr, root) {
  if (!root) return;
  if (root.nodeType === 3) {
    if (!skipped(root)) translateText(tr, root);
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) {
    if (skipped(root)) return;
    translateAttrs(tr, root);
  }
  const doc = root.ownerDocument || root;
  const walker = doc.createTreeWalker(root, 1 | 4, {
    acceptNode: (n) => (n.nodeType === 1 && (SKIP_TAGS.has(n.tagName) || n.hasAttribute("data-no-t")) ? 2 : 1),
  });
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 3) translateText(tr, n);
    else translateAttrs(tr, n);
  }
}

/** Traduce ahora y vigila los cambios. Devuelve la función para dejar de vigilar. */
export function observe(tr, doc) {
  translateTree(tr, doc.body || doc.documentElement);
  if (doc.title) {
    const t = tr.text(doc.title);
    if (t != null) doc.title = t;
  }
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") m.addedNodes.forEach((n) => translateTree(tr, n));
      else if (m.type === "characterData") {
        if (!skipped(m.target)) translateText(tr, m.target);
      } else if (m.type === "attributes" && m.target.nodeType === 1 && !skipped(m.target)) translateAttrs(tr, m.target);
    }
  });
  mo.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return () => mo.disconnect();
}
