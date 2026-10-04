// Idioma de la interfaz. La clave de cada texto es el propio texto en español:
// sin traducción se ve el original. Diccionario inglés: ./en.json.
// Al cambiar de idioma se recarga la ventana (y con ella el tema).

import en from "./en.json";
import { makeTranslator, observe } from "../../sdk/kit/translate.js";

export type Lang = "es" | "en";

let lang: Lang = "es";
const dicts: Record<Lang, Record<string, string> | null> = { es: null, en: en as Record<string, string> };

export function setLang(l: string) {
  lang = l === "en" ? "en" : "es";
  document.documentElement.lang = lang;
}

/** En inglés, traduce también lo que pinta la interfaz sin pasar por `t()`: nodos de
 *  texto y atributos, ahora y a medida que cambian. */
export function startTranslator() {
  if (lang !== "en") return;
  observe(makeTranslator(en as Record<string, string>), document);
}

export const getLang = () => lang;

/** Locale para Intl / toLocaleString. */
export const locale = () => (lang === "en" ? "en-US" : "es-ES");

/** Traduce y sustituye `{nombre}` por `vars.nombre`. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = dicts[lang]?.[s] ?? s;
  if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}

/** Singular o plural según n: tn(n, "{n} juego", "{n} juegos"). */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n: n.toLocaleString(locale()), ...vars });
}
