// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { createFormatters, negotiateLocale } from "./locale.js";
import { type CompiledMessage, compileMessage, messageParameters } from "./message.js";
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
  reason: "missing" | "invalid" | "parameter";
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
  // Catalog strings are finite, so parse each one once per translator.
  const compiled = new Map<string, CompiledMessage>();
  // A caller's missing or mistyped parameter is not the catalog's fault and no language fixes
  // it, so render the message with empty isolated values rather than leaking a key or placeholder.
  const formatMessage = (
    key: string,
    source: string,
    params: Parameters | undefined,
    target: string,
  ) => {
    let message = compiled.get(source);
    if (!message) {
      message = compileMessage(source);
      compiled.set(source, message);
    }
    try {
      return message(params, target);
    } catch {
      warn?.({ key, locale: target, reason: "parameter" });
      if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production")
        console.warn(`[suite-i18n] "${key}" was formatted with a missing or invalid parameter`);
      return message(params, target, true);
    }
  };
  const translate = (key: string, params?: Parameters): string => {
    const original = lookup(english, key);
    const localized = locale === "en" ? original : lookup(catalogs[locale], key);
    if (typeof localized === "string") {
      try {
        return formatMessage(key, localized, params, locale);
      } catch {
        warn?.({ key, locale, reason: "invalid" });
      }
    } else warn?.({ key, locale, reason: "missing" });
    if (typeof original === "string" && localized !== original) {
      try {
        return formatMessage(key, original, params, "en");
      } catch {
        warn?.({ key, locale: "en", reason: "invalid" });
      }
    }
    return key;
  };
  return { locale, t: translate as Translator<C>, ...createFormatters(locale) };
}
