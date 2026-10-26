// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  type CellValue,
  formatCellValue,
  parseCellInput,
  parseFormatCode,
  SheetFormatError,
  type SheetFormatErrorCode,
} from "../src/apps/sheets/lib/format";

const number = (value: number): CellValue => ({ type: "number", value });
const date = (value: string): CellValue => ({ type: "date", value });
function rejects(action: () => unknown, code: SheetFormatErrorCode) {
  expect(action).toThrow(SheetFormatError);
  expect(action).toThrow(expect.objectContaining({ name: "SheetFormatError", code }));
}

describe("cell display", () => {
  it.each([
    [1234.567, "General", "en-US", "1234.567"],
    [0.0000001, "General", "de-DE", "0,0000001"],
    [1234.567, "0", "en-US", "1235"],
    [-12.5, "0", "en-US", "-13"],
    [12, "0.00", "en-US", "12.00"],
    [12.345, "0.00", "de-DE", "12,35"],
    [12345.5, "#,##0", "en-US", "12,346"],
    [1234567.1, "#,##0", "hi-IN", "12,34,567"],
    [12345.1, "#,##0", "de-DE", "12.345"],
    [0.126, "%", "en-US", "13%"],
    [0.126, "0%", "de-DE", "13 %"],
    [-0.1256, "0.00%", "en-US", "-12.56%"],
    [12.5, "USD", "en-US", "USD 12.50"],
    [12.5, "EUR", "de-DE", "12,50 EUR"],
    [12.5, "JPY", "en-US", "JPY 13"],
    [12.5, "KWD", "en-US", "KWD 12.500"],
    [-0, "0.00", "en-US", "-0.00"],
  ])("formats %s as %s in %s", (value, code, locale, expected) => {
    expect(formatCellValue(number(value), code, locale)).toBe(expected);
  });
  it("keeps type semantics in General and supports explicit numeric overrides", () => {
    expect(formatCellValue({ type: "percent", value: 0.12345 }, "General", "en-US")).toBe(
      "12.345%",
    );
    expect(formatCellValue({ type: "percent", value: 0.5 }, "0.00", "en-US")).toBe("0.50");
    expect(formatCellValue({ type: "boolean", value: true }, "0", "en-US")).toBe("TRUE");
    expect(formatCellValue({ type: "boolean", value: false }, "General", "en-US")).toBe("FALSE");
    expect(formatCellValue({ type: "text", value: "=A1 · example.org" }, "USD", "en-US")).toBe(
      "=A1 · example.org",
    );
  });
  it.each([
    ["yyyy-mm-dd", "2024-02-29"],
    ["hh:mm", "00:05"],
    ["yyyy-mm-dd hh:mm", "2024-02-29 00:05"],
    ["General", "2024-02-29 00:05"],
  ])("formats UTC dates with %s", (code, expected) => {
    const cell = date("2024-02-29T00:05:00.000Z");
    expect(formatCellValue(cell, code, "en-US")).toBe(expected);
    expect(formatCellValue(cell, code, "de-DE")).toBe(expected);
    expect(cell.value).toBe("2024-02-29T00:05:00.000Z");
  });
  it("pads early years and uses native digits with the Gregorian calendar", () => {
    expect(formatCellValue(date("0001-01-01T23:59:00.000Z"), "yyyy-mm-dd hh:mm", "en-US")).toBe(
      "0001-01-01 23:59",
    );
    expect(formatCellValue(date("2026-01-02T13:45:00.000Z"), "yyyy-mm-dd hh:mm", "ar-EG")).toBe(
      "٢٠٢٦-٠١-٠٢ ١٣:٤٥",
    );
    expect(formatCellValue(date("2026-01-02T13:45:00.000Z"), "yyyy-mm-dd", "th-TH")).toBe(
      "2026-01-02",
    );
  });
  it.each([
    "",
    "general",
    "0.0",
    "#,##0.00",
    "0.0%",
    "$0.00",
    "USD 0.00",
    "ZZZ",
    "usd",
    "mm/dd/yy",
    "[Red]0",
    "0;0",
    "yyyy-mm-dd\n",
  ])("rejects unsupported code %j", (code) => {
    rejects(() => parseFormatCode(code), "unsupported-format");
    rejects(
      () => formatCellValue({ type: "text", value: "literal" }, code, "en-US"),
      "unsupported-format",
    );
    rejects(() => parseCellInput("'literal", "en-US", code), "unsupported-format");
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite %s", (value) => {
    rejects(() => formatCellValue(number(value), "General", "en-US"), "invalid-value");
  });
  it.each([
    "",
    "not_a_locale",
    "zz-ZZ",
    "en-US-u-nu-foobar",
  ])("rejects unsupported locale %j", (locale) => {
    rejects(() => formatCellValue(number(1), "0", locale), "unsupported-locale");
    rejects(() => parseCellInput("1", locale), "unsupported-locale");
  });
  it("rejects mismatched formats", () => {
    rejects(() => formatCellValue(number(1), "hh:mm", "en-US"), "invalid-value");
    rejects(() => formatCellValue(date("2026-01-01T00:00:00.000Z"), "0", "en-US"), "invalid-value");
  });
  it("round-trips non-Latin and supplementary-plane digit systems", () => {
    for (const locale of ["en-US-u-nu-hanidec", "en-US-u-nu-mathbold"]) {
      const cell = date("0001-01-02T03:04:00.000Z");
      expect(parseCellInput(formatCellValue(cell, "yyyy-mm-dd hh:mm", locale), locale)).toEqual(
        cell,
      );
      expect(parseCellInput(formatCellValue(number(1234.5), "0.00", locale), locale)).toEqual(
        number(1234.5),
      );
    }
  });
  it.each([
    "bad",
    "0000-01-01T00:00:00.000Z",
    "2026-02-30T00:00:00.000Z",
    "2026-99-99T00:00:00.000Z",
    "2026-01-01T12:30:01.000Z",
    "2026-01-01T12:30:00+01:00",
  ])("rejects invalid stored date %j", (value) => {
    rejects(() => formatCellValue(date(value), "General", "en-US"), "invalid-value");
  });
});

describe("cell input", () => {
  it("parses ee-GH numbers with explicit grouping discovery", () => {
    for (const value of [1234.5, -1234.5, 0.5]) {
      expect(parseCellInput(String(value), "ee-GH")).toEqual(number(value));
      expect(parseCellInput(formatCellValue(number(value), "General", "ee-GH"), "ee-GH")).toEqual(
        number(value),
      );
    }
    expect(parseCellInput("1,234.5", "ee-GH")).toEqual(number(1234.5));
    expect(parseCellInput(formatCellValue(number(1234), "#,##0", "ee-GH"), "ee-GH")).toEqual(
      number(1234),
    );
    rejects(() => parseCellInput("12,34.5", "ee-GH"), "invalid-input");
  });
  it("handles a formatter that supplies no grouping separator", () => {
    const original = Intl.NumberFormat.prototype.formatToParts;
    const spy = vi.spyOn(Intl.NumberFormat.prototype, "formatToParts").mockImplementation(function (
      this: Intl.NumberFormat,
      value,
    ) {
      return original.call(this, value).filter((part) => part.type !== "group");
    });
    try {
      expect(parseCellInput("1234.5", "ee-GH")).toEqual(number(1234.5));
      rejects(() => parseCellInput("1,234.5", "ee-GH"), "invalid-input");
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    ["1,234.50", "en-US", 1234.5],
    ["-1.234,5", "de-DE", -1234.5],
    ["+12,5", "de-DE", 12.5],
    ["12 345,5", "fr-FR", 12345.5],
    ["12,34,567.8", "hi-IN", 1234567.8],
    ["١٢٬٣٤٥٫٦", "ar-EG", 12345.6],
    ["؜-١٢٫٥", "ar-EG", -12.5],
    [".5", "en-US", 0.5],
    [",5", "de-DE", 0.5],
    [" 12.500 ", "en-US", 12.5],
    ["0", "en-US", 0],
    ["-0", "en-US", -0],
    ["9007199254740991", "en-US", Number.MAX_SAFE_INTEGER],
    ["0.000000000000000000001", "en-US", 1e-21],
  ])("parses number %j in %s", (input, locale, value) => {
    expect(parseCellInput(input, locale)).toEqual(number(value));
  });
  it.each([
    ["25%", "en-US", 0.25],
    ["-12.50%", "en-US", -0.125],
    ["+12.5%", "en-US", 0.125],
    ["12,5 %", "de-DE", 0.125],
    ["١٢٫٥٪؜", "ar-EG", 0.125],
    ["%12,5", "tr-TR", 0.125],
    ["0%", "en-US", 0],
  ])("parses percent %j", (input, locale, value) => {
    expect(parseCellInput(input, locale)).toEqual({ type: "percent", value });
  });
  it("parses explicit currency displays and leaves unmarked numbers unscaled", () => {
    expect(parseCellInput("USD 1,234.50", "en-US", "USD")).toEqual(number(1234.5));
    expect(parseCellInput("-1.234,50 EUR", "de-DE", "EUR")).toEqual(number(-1234.5));
    expect(parseCellInput("25", "en-US", "%")).toEqual(number(25));
    rejects(() => parseCellInput("EUR 12.00", "en-US", "USD"), "invalid-input");
    rejects(() => parseCellInput("$12.00", "en-US", "USD"), "invalid-input");
  });
  it.each([
    ["2024-02-29", "en-US", "2024-02-29T00:00:00.000Z"],
    ["2024-02-29 13:05", "en-US", "2024-02-29T13:05:00.000Z"],
    ["00:00", "en-US", "1970-01-01T00:00:00.000Z"],
    ["23:59", "en-US", "1970-01-01T23:59:00.000Z"],
    ["01/02/2026", "en-US", "2026-01-02T00:00:00.000Z"],
    ["01/02/2026", "en-GB", "2026-02-01T00:00:00.000Z"],
    ["02.01.2026", "de-DE", "2026-01-02T00:00:00.000Z"],
    ["٢٠٢٦-٠١-٠٢ ١٣:٤٥", "ar-EG", "2026-01-02T13:45:00.000Z"],
    ["0001-01-01", "en-US", "0001-01-01T00:00:00.000Z"],
    ["9999-12-31", "en-US", "9999-12-31T00:00:00.000Z"],
  ])("parses Gregorian date %j in %s", (input, locale, value) => {
    expect(parseCellInput(input, locale)).toEqual(date(value));
  });
  it("accepts a date hint and rejects non-date input under it", () => {
    expect(parseCellInput("2026-01-02", "en-US", "yyyy-mm-dd").type).toBe("date");
    rejects(() => parseCellInput("42", "en-US", "yyyy-mm-dd"), "invalid-input");
    rejects(() => parseCellInput("tomorrow", "en-US", "hh:mm"), "invalid-input");
  });
  it("rejects conflicting fixed and locale dates unless a date hint selects fixed order", () => {
    rejects(() => parseCellInput("2026-02-01", "ky-KG"), "invalid-input");
    expect(parseCellInput("2026-02-01", "ky-KG", "yyyy-mm-dd")).toEqual(
      date("2026-02-01T00:00:00.000Z"),
    );
    expect(parseCellInput("2026-01-01", "ky-KG")).toEqual(date("2026-01-01T00:00:00.000Z"));
    expect(parseCellInput("2026-22-01", "ky-KG")).toEqual(date("2026-01-22T00:00:00.000Z"));
    expect(parseCellInput("2026-01-22", "ky-KG")).toEqual(date("2026-01-22T00:00:00.000Z"));
    rejects(() => parseCellInput("2026-22-01", "ky-KG", "yyyy-mm-dd"), "invalid-input");
    rejects(() => parseCellInput("2026-32-01", "ky-KG"), "invalid-input");
    for (const code of ["yyyy-mm-dd", "yyyy-mm-dd hh:mm", "hh:mm"]) {
      const cell = date(code === "hh:mm" ? "1970-01-01T00:00:00.000Z" : "2026-02-01T00:00:00.000Z");
      expect(parseCellInput(formatCellValue(cell, code, "ky-KG"), "ky-KG", code)).toEqual(cell);
    }
    expect(parseCellInput("01/02/2026", "en-US", "yyyy-mm-dd")).toEqual(
      date("2026-01-02T00:00:00.000Z"),
    );
  });
  it.each(["bg-BG", "mk-MK"])("accepts Intl date literal spacing in %s", (locale) => {
    const formatter = new Intl.DateTimeFormat(locale, {
      calendar: "gregory",
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const value = "2026-01-02T00:00:00.000Z";
    expect(parseCellInput(formatter.format(new Date(value)), locale)).toEqual(date(value));
    for (const space of [" ", "\u00a0", "\u202f"]) {
      expect(parseCellInput(`02.01.2026${space}г.`, locale)).toEqual(date(value));
    }
    for (const input of [
      "2.01.2026 г.",
      "02.1.2026 г.",
      "02.01.26 г.",
      "30.02.2026 г.",
      "02.01.2026г.",
      "02.01.2026 x.",
    ]) {
      rejects(() => parseCellInput(input, locale), "invalid-input");
    }
  });
  it.each([
    "2025-02-29",
    "1900-02-29",
    "2026-04-31",
    "0000-01-01",
    "2026-13-01",
    "2026-01-00",
    "24:00",
    "12:60",
    "2026-02-01 24:00",
    "02/30/2026",
  ])("rejects impossible date %j", (input) => {
    rejects(() => parseCellInput(input, "en-US"), "invalid-input");
  });
  it("recognises booleans without translating or coercing text", () => {
    expect(parseCellInput(" TRUE ", "en-US")).toEqual({ type: "boolean", value: true });
    expect(parseCellInput("False", "de-DE")).toEqual({ type: "boolean", value: false });
    for (const value of [
      "",
      "  ",
      " example.org ",
      "Dana Example",
      "wahr",
      "trueish",
      "falsehood",
    ]) {
      expect(parseCellInput(value, "en-US")).toEqual({ type: "text", value });
    }
    for (const value of ["0012", "1/2", "NaN", "2026-02-30", " true ", "'literal"]) {
      expect(parseCellInput(`'${value}`, "en-US")).toEqual({ type: "text", value });
    }
  });
  it.each([
    ["Growth %", "en-US"],
    ["  Growth 25%  ", "en-US"],
    ["% growth", "en-US"],
    ["Budget $", "en-US"],
    ["Budget $12", "en-US"],
    ["$ budget", "en-US"],
    ["Budget €", "de-DE"],
    ["USD budget", "en-US"],
    ["Infinity pool", "en-US"],
    ["NaN label", "en-US"],
    ["Pool ∞", "en-US"],
    ["∞ pool", "en-US"],
    ["Growth ٪", "ar-EG"],
    ["٪ growth", "ar-EG"],
    ["Growth %", "tr-TR"],
  ])("preserves numeric markers in text %j in %s", (value, locale) => {
    for (const code of ["General", "%", "USD"]) {
      expect(parseCellInput(value, locale, code)).toEqual({ type: "text", value });
    }
  });
  it.each([
    "1,23",
    "12,34,567",
    "1,234,",
    "1,,234",
    "1.2.3",
    "1.",
    "1.2,3",
    "01",
    "00.5",
    "--1",
    "1e3",
    "0x10",
    "1/2",
    "12 apples",
    "2026-01-01T00:00:00Z",
    "1/2/26",
    "12:00:30",
    "NaN",
    "Infinity",
    "+Infinity",
    "-Infinity",
    "∞",
    "$12",
    "$ 12",
    "$12oops",
    "USD 12",
    "USD 12oops",
    "12%oops",
    "12 %",
    "%12",
    "%12oops",
    "9007199254740992",
    "0.10000000000000001",
    `0.${"0".repeat(400)}1`,
  ])("rejects unsupported input %j", (input) => {
    rejects(() => parseCellInput(input, "en-US"), "invalid-input");
  });
  it("rejects mixed digits, malformed foreign grouping and oversized values", () => {
    rejects(() => parseCellInput("١2", "ar-EG"), "invalid-input");
    rejects(() => parseCellInput("1 234,5", "fr-FR"), "invalid-input");
    rejects(() => parseCellInput("12.5", "de-DE"), "invalid-input");
    rejects(() => parseCellInput("9".repeat(999), "en-US"), "invalid-input");
    rejects(() => parseCellInput("a".repeat(1001), "en-US"), "invalid-input");
    expect(parseCellInput("a".repeat(1000), "en-US").type).toBe("text");
  });
  it("round-trips synthetic integers across locale grouping systems", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (value) => {
        for (const locale of ["en-US", "de-DE", "fr-FR", "hi-IN", "ar-EG"]) {
          expect(parseCellInput(formatCellValue(number(value), "#,##0", locale), locale)).toEqual(
            number(value),
          );
        }
      }),
    );
  });
  it("round-trips synthetic minute dates and explicit currency codes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (minute) => {
        const cell = date(new Date(Date.UTC(2000, 0, 1) + minute * 60_000).toISOString());
        for (const locale of ["en-US", "de-DE", "ar-EG"]) {
          expect(parseCellInput(formatCellValue(cell, "yyyy-mm-dd hh:mm", locale), locale)).toEqual(
            cell,
          );
        }
      }),
    );
    for (const locale of ["en-US", "de-DE", "ar-EG", "hi-IN"]) {
      for (const code of ["USD", "JPY", "KWD"]) {
        expect(parseCellInput(formatCellValue(number(-1234), code, locale), locale, code)).toEqual(
          number(-1234),
        );
      }
    }
  });
});
