// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { createFormatters, createSuiteI18n, dir, negotiateLocale } from "../src/index.js";

describe("negotiation and direction", () => {
  it.each([
    ["fr", ["es"], "fr"],
    ["pt-BR", ["ar"], "pt"],
    [null, ["xx", "es-MX", "fr"], "es"],
    ["xx", ["de-DE"], "de"],
    ["bad_tag", ["!", "AR-eg"], "ar"],
    ["", [], "en"],
    [null, ["zh"], "en"],
  ] as const)("%s / %j -> %s", (stored, languages, expected) =>
    expect(negotiateLocale(stored, languages)).toBe(expected));
  it("handles default inputs, exact region preference, base fallbacks, case, scripts, and region-only catalogs", () => {
    expect(negotiateLocale()).toBe("en");
    expect(negotiateLocale("pt-BR", [], ["en", "pt", "pt-BR"])).toBe("pt-BR");
    expect(negotiateLocale("pt-PT", [], ["en", "pt", "pt-BR"])).toBe("pt");
    expect(negotiateLocale("PT-br", [], ["bad_tag", "en", "pt-BR"])).toBe("pt-BR");
    expect(negotiateLocale("pt", [], ["en", "pt-BR"])).toBe("pt-BR");
    expect(negotiateLocale("zh-Hant-TW", [], ["en", "zh-Hant"])).toBe("zh-Hant");
  });
  it.each(["ar", "AR-EG", "he-IL", "fa", "ur-PK"])("%s is RTL", (locale) =>
    expect(dir(locale)).toBe("rtl"));
  it.each(["en", "fr", "pt-BR", "invalid_tag", ""])("%s is LTR", (locale) =>
    expect(dir(locale)).toBe("ltr"));
});
describe("Intl helpers", () => {
  it.each([
    "en",
    "es",
    "fr",
    "de",
    "pt",
    "ar",
  ])("%s formats dates, times, numbers, lists and relative times", (locale) => {
    const f = createFormatters(locale);
    const date = new Date("2026-11-11T13:45:00Z");
    expect(f.date(date)).toBe(new Intl.DateTimeFormat(locale).format(date));
    expect(f.date(date.getTime(), { timeZone: "UTC", dateStyle: "long" })).toBe(
      new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "long" }).format(date),
    );
    expect(f.time(date)).toBe(
      new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date),
    );
    expect(f.time(date, { timeZone: "UTC", hour12: false })).toBe(
      new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
        hour12: false,
      }).format(date),
    );
    expect(f.time(date, { timeStyle: "short", timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "UTC" }).format(date),
    );
    expect(f.time(date, { dateStyle: "long", timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date),
    );
    expect(f.number(1234.5)).toBe(new Intl.NumberFormat(locale).format(1234.5));
    expect(f.number(10, { style: "currency", currency: "EUR" })).toBe(
      new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(10),
    );
    expect(f.relativeTime(-1, "day")).toBe(new Intl.RelativeTimeFormat(locale).format(-1, "day"));
    expect(f.relativeTime(-1, "day", { numeric: "auto" })).toBe(
      new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day"),
    );
    expect(f.list(["A", "B"])).toBe(new Intl.ListFormat(locale).format(["A", "B"]));
    expect(f.list(new Set(["A", "B"]), { type: "disjunction" })).toBe(
      new Intl.ListFormat(locale, { type: "disjunction" }).format(["A", "B"]),
    );
    expect(createSuiteI18n(locale).number(1234)).toBe(f.number(1234));
  });
});
