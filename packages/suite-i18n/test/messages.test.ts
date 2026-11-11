// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  catalogs,
  createI18n,
  createSuiteI18n,
  en,
  formatMessage,
  messageParameters,
  parseMessage,
  validateCatalog,
} from "../src/index.js";

describe("message grammar", () => {
  it("interpolates without interpreting values as syntax or HTML", () => {
    expect(formatMessage("Hello {name}, {n}!", { name: "<b>{n}</b>", n: 0 })).toBe(
      "Hello <b>{n}</b>, 0!",
    );
    expect(formatMessage("plain text")).toBe("plain text");
    expect(formatMessage("")).toBe("");
    expect(formatMessage("# \\{name\\} \\# \\\\ \\x")).toBe("# {name} # \\ x");
    expect(formatMessage("{ name }", { name: "Ada" })).toBe("Ada");
  });
  it.each([
    [0, "0 files"],
    [1, "1 file"],
    [2, "2 files"],
    [1.5, "1.5 files"],
  ])("cardinal plural %s", (count, expected) => {
    expect(formatMessage("{count, plural, one {# file} other {# files}}", { count })).toBe(
      expected,
    );
  });
  it("prefers exact matches and formats # with the locale", () => {
    expect(
      formatMessage("{n, plural, =0 {empty} =-1 {negative} one {one} other {# files}}", { n: 0 }),
    ).toBe("empty");
    expect(formatMessage("{n, plural, =-1 {negative} other {#}}", { n: -1 })).toBe("negative");
    expect(formatMessage("{n, plural, =1.5 {fraction} other {#}}", { n: 1.5 })).toBe("fraction");
    expect(formatMessage("{n, plural, other {#}}", { n: 1234.5 }, "de")).toBe(
      new Intl.NumberFormat("de").format(1234.5),
    );
    expect(formatMessage("{n, plural, one {one} other {other}}", { n: 0 }, "fr")).toBe("one");
  });
  it.each([
    [0, "zero"],
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [11, "many"],
    [100, "other"],
  ])("Arabic plural %s", (n, expected) => {
    expect(
      formatMessage(
        "{n, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}",
        { n },
        "ar",
      ),
    ).toBe(expected);
  });
  it("compares exact plural selectors numerically", () => {
    expect(formatMessage("{n, plural, =1.0 {exact} other {other}}", { n: 1 })).toBe("exact");
    expect(() => parseMessage("{n, plural, =1 {a} =1.0 {b} other {c}}")).toThrow(SyntaxError);
  });
  it("selects exact values including prototype names, with other as fallback", () => {
    const source = "{role, select, editor {Edit} __proto__ {safe} other {Read}}";
    expect(formatMessage(source, { role: "editor" })).toBe("Edit");
    expect(formatMessage(source, { role: "viewer" })).toBe("Read");
    expect(formatMessage(source, { role: "__proto__" })).toBe("safe");
    expect(formatMessage(source, { role: "constructor" })).toBe("Read");
  });
  it("nests choices and keeps the enclosing plural's # through select, restoring after nested plurals", () => {
    const source =
      "{n, plural, other {{role, select, a {{name}: #} other {#}} / {m, plural, other {#}} / #}}";
    expect(formatMessage(source, { n: 3, m: 9, role: "a", name: "Ada" })).toBe("Ada: 3 / 9 / 3");
    expect(formatMessage("{role, select, other {#}}", { role: "a" })).toBe("#");
    expect(formatMessage("{n, plural, other {\\# \\{literal\\}}}", { n: 2 })).toBe("# {literal}");
  });
  it.each([
    "{",
    "}",
    "{}",
    "{a",
    "{a b}",
    "{1a}",
    "{a, number}",
    "{a, select other {x}}",
    "{a, select, one {x}}",
    "{a, select, other {x} other {y}}",
    "{a, plural, banana {x} other {y}}",
    "{a, select, other {x}",
    "{a, select, other {x",
    "\\",
    "{a, select, other x}",
    "{a, plural, other {x} trailing",
    "{a, select, , {x}}",
  ])("rejects malformed input %j", (source) => {
    expect(() => parseMessage(source)).toThrow(SyntaxError);
  });
  it("bounds length and nesting", () => {
    expect(() => parseMessage("a".repeat(20_001))).toThrow("20000");
    expect(() => parseMessage(`${"{n, select, other {".repeat(33)}x${"}}".repeat(33)}`)).toThrow(
      "32",
    );
    expect(
      formatMessage(`${"{n, select, other {".repeat(32)}x${"}}".repeat(32)}`, { n: "a" }),
    ).toBe("x");
  });
  it.each([undefined, true, null, {}])("rejects missing/invalid interpolation %j", (value) => {
    expect(() => formatMessage("{name}", { name: value } as never)).toThrow(TypeError);
  });
  it.each(["1", Number.NaN, Infinity])("requires a finite plural number %s", (n) => {
    expect(() => formatMessage("{n, plural, other {#}}", { n })).toThrow(TypeError);
  });
  it("requires a string select and own parameter properties", () => {
    expect(() => formatMessage("{n, select, other {x}}", { n: 1 })).toThrow(TypeError);
    expect(() => formatMessage("{constructor}")).toThrow(TypeError);
  });
  it("extracts sorted parameter contracts across all branches and detects conflicts", () => {
    expect(
      messageParameters(
        "\\{literal\\} {z} {n, plural, one {{a}} other {{n}}} {role, select, other {#}}",
      ),
    ).toEqual({ a: "value", n: "number", role: "string", z: "value" });
    expect(messageParameters("{n} {n, plural, other {#}}")).toEqual({ n: "number" });
    expect(() => messageParameters("{n, select, other {{n, plural, other {#}}}}")).toThrow(
      "Conflicting",
    );
  });
});

describe("catalog contracts", () => {
  it("validates every English source message even before it has a translation", () => {
    expect(validateCatalog(en, en)).toEqual([]);
  });
  it.each(
    Object.entries(catalogs),
  )("%s has only English keys and the same parameter contracts", (_locale, catalog) => {
    expect(validateCatalog(en, catalog)).toEqual([]);
  });
  it("allows partial nested translations and rejects unknown keys, shape changes and parameter changes", () => {
    const english = { a: { greet: "Hi {name}" }, count: "{n, plural, other {#}}" };
    expect(validateCatalog(english, { a: {} })).toEqual([]);
    expect(
      validateCatalog(english, {
        a: { missing: "x", greet: "Hola {person}" },
        count: "{n}",
        unknown: "x",
      }),
    ).toHaveLength(4);
    for (const catalog of [null, [], 4, { a: "x" }, { count: {} }, { count: null }])
      expect(validateCatalog(english, catalog).length).toBeGreaterThan(0);
    expect(validateCatalog(english, { count: "{" })).toEqual(["count: invalid message"]);
    expect(validateCatalog({ a: "{" }, { a: "x" })).toEqual(["a: invalid message"]);
    expect(validateCatalog(english, { count: "{n, select, other {x}}" })).toEqual([
      "count: parameter mismatch",
    ]);
  });
  it("falls back per key to English and ultimately to the key, warning optionally", () => {
    const warn = vi.fn();
    const i18n = createI18n({
      english: { a: { greeting: "Hi {name}", plain: "English" } },
      catalogs: { es: { a: { greeting: "Hola {name}" } } },
      locale: "es-MX",
      warn,
    });
    expect(i18n.locale).toBe("es");
    expect(i18n.t("a.greeting", { name: "Ada" })).toBe("Hola Ada");
    expect(i18n.t("a.plain")).toBe("English");
    expect(warn).toHaveBeenCalledWith({ key: "a.plain", locale: "es", reason: "missing" });
    expect((i18n.t as (key: string) => string)("missing")).toBe("missing");
    expect((i18n.t as (key: string) => string)("a.toString")).toBe("a.toString");
    expect((i18n.t as (key: string) => string)("a")).toBe("a");
    expect(createSuiteI18n().t("apps.home")).toBe("Home");
    expect(createI18n({ english: { a: "A" } }).t("a")).toBe("A");
  });
  it("uses English grammar for fallback messages while Intl helpers retain the active locale", () => {
    const i18n = createI18n({
      english: { files: "{count, plural, one {# file} other {# files}}" },
      catalogs: { fr: {} },
      locale: "fr",
    });
    expect(i18n.t("files", { count: 0 })).toBe("0 files");
    expect(i18n.number(1234.5)).toBe(new Intl.NumberFormat("fr").format(1234.5));
  });
  it("uses English for malformed translations, then key for malformed English or missing params", () => {
    const warn = vi.fn();
    const make = (english: string, translated: string) =>
      createI18n({
        english: { a: english },
        catalogs: { es: { a: translated } },
        locale: "es",
        warn,
      });
    expect(make("English", "{").t("a", {})).toBe("English");
    expect(make("{", "{").t("a", {})).toBe("a");
    expect((make("{name}", "{").t as (key: string) => string)("a")).toBe("a");
    expect(
      createI18n({ english: { a: "{" }, catalogs: { es: {} }, locale: "es", warn }).t("a"),
    ).toBe("a");
    expect(warn).toHaveBeenCalledWith({ key: "a", locale: "en", reason: "invalid" });
    expect(make("{", "translated").t("a", {})).toBe("translated");
    expect(make("English", "translated").t("a", {})).toBe("translated");
    expect(createI18n({ english: { a: "{" } }).t("a")).toBe("a");
  });
});
