// AUTHORED-BY Codex GPT-6.1-Sol
export const locales = ["en", "es", "fr", "de", "pt", "ar"] as const;
export type Locale = (typeof locales)[number];
export const localeNames: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  ar: "العربية",
};

function canonical(locale: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}

/** Stored choice wins; each browser preference tries its region, then its base language. */
export function negotiateLocale(
  stored?: string | null,
  languages: readonly string[] = [],
  supported: readonly string[] = locales,
): string {
  const available = supported.map((value) => ({ value, tag: canonical(value) }));
  for (const requested of [stored, ...languages]) {
    if (!requested) continue;
    let tag = canonical(requested);
    while (tag) {
      const exact = available.find((value) => value.tag === tag);
      if (exact) return exact.value;
      const cut = tag.lastIndexOf("-");
      if (cut === -1) {
        const region = available.find((value) => value.tag?.split("-")[0] === tag);
        if (region) return region.value;
        break;
      }
      tag = tag.slice(0, cut);
    }
  }
  return "en";
}

export function dir(locale: string): "rtl" | "ltr" {
  return ["ar", "he", "fa", "ur"].includes(canonical(locale)?.split("-")[0] ?? "") ? "rtl" : "ltr";
}

export function createFormatters(locale: string) {
  return {
    date: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, options).format(value),
    time: (value: Date | number, options: Intl.DateTimeFormatOptions = {}) => {
      const settings =
        options.timeStyle || options.dateStyle
          ? options
          : ({
              hour: "numeric",
              minute: "2-digit",
              ...options,
            } satisfies Intl.DateTimeFormatOptions);
      return new Intl.DateTimeFormat(locale, settings).format(value);
    },
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, options).format(value),
    relativeTime: (
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options?: Intl.RelativeTimeFormatOptions,
    ) => new Intl.RelativeTimeFormat(locale, options).format(value, unit),
    list: (value: Iterable<string>, options?: Intl.ListFormatOptions) =>
      new Intl.ListFormat(locale, options).format(value),
  };
}
