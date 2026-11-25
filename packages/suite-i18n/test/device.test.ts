// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_LOCALE_KEY,
  dir,
  localeBootScript,
  locales,
  readDeviceLocale,
  rtlLanguages,
  writeDeviceLocale,
} from "../src/index.js";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});
afterEach(() => vi.restoreAllMocks());

describe("device locale", () => {
  it("round-trips a supported locale and removes it for automatic", () => {
    expect(readDeviceLocale()).toBe("");
    expect(writeDeviceLocale("ar")).toBe(true);
    expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBe("ar");
    expect(readDeviceLocale()).toBe("ar");
    expect(writeDeviceLocale("")).toBe(true);
    expect(localStorage.getItem(DEVICE_LOCALE_KEY)).toBeNull();
    writeDeviceLocale("fr", "custom");
    expect(readDeviceLocale("custom")).toBe("fr");
  });
  it("ignores invalid stored values and survives blocked storage", () => {
    localStorage.setItem(DEVICE_LOCALE_KEY, "xx");
    expect(readDeviceLocale()).toBe("");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readDeviceLocale()).toBe("");
    expect(writeDeviceLocale("es")).toBe(false);
  });
  it("reads nothing where there is no browser storage", () => {
    vi.stubGlobal("localStorage", undefined);
    try {
      expect(readDeviceLocale()).toBe("");
      expect(writeDeviceLocale("es")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("boot script", () => {
  const run = (languages: readonly string[] | undefined, language = "en") => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(languages as readonly string[]);
    vi.spyOn(navigator, "language", "get").mockReturnValue(language);
    new Function(localeBootScript())();
    return [document.documentElement.lang, document.documentElement.dir];
  };
  it("is a stable constant safe to inline, so build-time CSP hashes keep matching", () => {
    expect(localeBootScript()).toBe(localeBootScript());
    expect(localeBootScript("</script>")).not.toContain("</script>");
    for (const locale of locales) expect(localeBootScript()).toContain(`"${locale}"`);
  });
  it("prefers the device choice, then browser languages by base language, then English", () => {
    localStorage.setItem(DEVICE_LOCALE_KEY, "ar");
    expect(run(["en-GB"])).toEqual(["ar", "rtl"]);
    localStorage.clear();
    expect(run(["xx", "PT-br", "es"])).toEqual(["pt", "ltr"]);
    expect(run(["zh"])).toEqual(["en", "ltr"]);
    expect(run(undefined, "ar-EG")).toEqual(["ar", "rtl"]);
    expect(run([""])).toEqual(["en", "ltr"]);
  });
  it("falls back to browser languages when storage throws, and never throws itself", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run(["fr-CA"])).toEqual(["fr", "ltr"]);
    vi.spyOn(document, "documentElement", "get").mockImplementation(() => {
      throw new Error("no document");
    });
    expect(() => new Function(localeBootScript())()).not.toThrow();
  });
  it("agrees with dir() for every supported locale", () => {
    for (const locale of locales) {
      localStorage.setItem(DEVICE_LOCALE_KEY, locale);
      expect(run([])).toEqual([locale, dir(locale)]);
    }
    expect(rtlLanguages).toContain("ar");
  });
});
