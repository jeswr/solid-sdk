// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { ar } from "./catalogs/ar.js";
import { de } from "./catalogs/de.js";
import { en } from "./catalogs/en.js";
import { es } from "./catalogs/es.js";
import { fr } from "./catalogs/fr.js";
import { pt } from "./catalogs/pt.js";
import type { Locale } from "./locale.js";
import { createI18n, type I18n } from "./translator.js";
import type { PartialCatalog } from "./types.js";

export { ar, de, en, es, fr, pt };
export const catalogs: Readonly<Record<Exclude<Locale, "en">, PartialCatalog<typeof en>>> = {
  es,
  fr,
  de,
  pt,
  ar,
};
export const createSuiteI18n = (locale = "en"): I18n<typeof en> =>
  createI18n({ english: en, catalogs, locale });
export * from "./device.js";
export * from "./locale.js";
export * from "./message.js";
export * from "./translator.js";
export * from "./types.js";
