// Idioma de la interfaz. La clave de cada texto es el propio texto en español:
// sin traducción se ve el original. Diccionarios: ./<lang>.json y sdk/i18n/<lang>.json.
// Al cambiar de idioma se recarga la ventana (y con ella el tema).

import en from "./en.json";
import de from "./de.json";
import fr from "./fr.json";
import zh from "./zh.json";
import ja from "./ja.json";
import pt from "./pt.json";
import kitEn from "../../sdk/i18n/en.json";
import kitDe from "../../sdk/i18n/de.json";
import kitFr from "../../sdk/i18n/fr.json";
import kitZh from "../../sdk/i18n/zh.json";
import kitJa from "../../sdk/i18n/ja.json";
import kitPt from "../../sdk/i18n/pt.json";
import { makeTranslator, observe } from "../../sdk/kit/translate.js";

export const UI_LANGS = ["es", "en", "de", "fr", "zh", "ja", "pt"] as const;
export type Lang = (typeof UI_LANGS)[number];

export function isLang(l: string): l is Lang {
  return (UI_LANGS as readonly string[]).includes(l);
}

/** Nombre en su propio idioma. El carácter final evita que se traduzca. */
export const LANG_LABELS: Record<Lang, string> = {
  es: "Español\u200b",
  en: "English\u200b",
  de: "Deutsch\u200b",
  fr: "Français\u200b",
  zh: "中文\u200b",
  ja: "日本語\u200b",
  pt: "Português (Brasil)\u200b",
};

export const LANG_LOCALES: Record<Lang, string> = {
  es: "es-ES",
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  zh: "zh-CN",
  ja: "ja-JP",
  pt: "pt-BR",
};

/** Idioma de las descripciones de Steam que corresponde a la interfaz. */
export function steamLanguageFor(lang: Lang): string {
  switch (lang) {
    case "es":
      return "spanish";
    case "en":
      return "english";
    case "de":
      return "german";
    case "fr":
      return "french";
    case "zh":
      return "schinese";
    case "ja":
      return "japanese";
    case "pt":
      return "brazilian";
  }
}

type Dict = Record<string, string>;
const asDict = (v: object) => v as Dict;

const host: Record<Lang, Dict | null> = {
  es: null,
  en: asDict(en),
  de: asDict(de),
  fr: asDict(fr),
  zh: asDict(zh),
  ja: asDict(ja),
  pt: asDict(pt),
};
const kit: Record<Lang, Dict | null> = {
  es: null,
  en: asDict(kitEn),
  de: asDict(kitDe),
  fr: asDict(kitFr),
  zh: asDict(kitZh),
  ja: asDict(kitJa),
  pt: asDict(kitPt),
};

let lang: Lang = "es";

export function setLang(l: string) {
  lang = isLang(l) ? l : "es";
  document.documentElement.lang = LANG_LOCALES[lang];
}

/** Fuera del español, traduce también lo que pinta la interfaz sin pasar por `t()`:
 *  nodos de texto y atributos, ahora y a medida que cambian. */
export function startTranslator() {
  if (lang === "es") return;
  observe(makeTranslator({ ...(kit[lang] ?? {}), ...(host[lang] ?? {}) }), document);
}

export const getLang = () => lang;

/** Locale para Intl / toLocaleString. */
export const locale = () => LANG_LOCALES[lang];

/** Traduce y sustituye `{nombre}` por `vars.nombre`. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = host[lang]?.[s] ?? s;
  if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}

/** Singular o plural según n: tn(n, "{n} juego", "{n} juegos"). */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n: n.toLocaleString(locale()), ...vars });
}
