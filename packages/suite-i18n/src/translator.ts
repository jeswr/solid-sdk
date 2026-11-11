// AUTHORED-BY Codex GPT-6.1-Sol
import { createFormatters, negotiateLocale } from "./locale.js";
import { formatMessage, messageParameters } from "./message.js";
import type { Catalog, Parameters, PartialCatalog, Translator } from "./types.js";

function lookup(catalog: unknown, key: string): unknown {
  let value = catalog;
  for (const part of key.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Partial catalogs may omit English keys, but cannot add keys or change parameter contracts. */
export function validateCatalog(english: Catalog, translated: unknown): string[] {
  const errors: string[] = [];
  const visit = (value: unknown, prefix: string) => {
    const original = prefix ? lookup(english, prefix) : english;
    if (typeof value === "string" && typeof original === "string") {
      try {
        if (
          JSON.stringify(messageParameters(original)) !== JSON.stringify(messageParameters(value))
        )
          errors.push(`${prefix}: parameter mismatch`);
      } catch {
        errors.push(`${prefix}: invalid message`);
      }
    } else if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      original &&
      typeof original === "object"
    ) {
      for (const [key, child] of Object.entries(value))
        visit(child, prefix ? `${prefix}.${key}` : key);
    } else errors.push(`${prefix}: unknown key or invalid catalog value`);
  };
  visit(translated, "");
  return errors;
}

export interface I18nWarning {
  key: string;
  locale: string;
  reason: "missing" | "invalid";
}
export interface I18nOptions<C extends Catalog> {
  english: C;
  catalogs?: Readonly<Record<string, PartialCatalog<C>>>;
  locale?: string;
  warn?: (warning: I18nWarning) => void;
}

export interface I18n<C extends Catalog> extends ReturnType<typeof createFormatters> {
  locale: string;
  t: Translator<C>;
}

export function createI18n<const C extends Catalog>({
  english,
  catalogs = {},
  locale: requested = "en",
  warn,
}: I18nOptions<C>): I18n<C> {
  const locale = negotiateLocale(requested, [], ["en", ...Object.keys(catalogs)]);
  const translate = (key: string, params?: Parameters): string => {
    const original = lookup(english, key);
    const localized = locale === "en" ? original : lookup(catalogs[locale], key);
    if (typeof localized === "string") {
      try {
        return formatMessage(localized, params, locale);
      } catch {
        warn?.({ key, locale, reason: "invalid" });
      }
    } else warn?.({ key, locale, reason: "missing" });
    if (typeof original === "string" && localized !== original) {
      try {
        return formatMessage(original, params, "en");
      } catch {
        warn?.({ key, locale: "en", reason: "invalid" });
      }
    }
    return key;
  };
  return { locale, t: translate as Translator<C>, ...createFormatters(locale) };
}
