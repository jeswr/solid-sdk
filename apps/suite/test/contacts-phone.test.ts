// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  formatPhoneNumber,
  normalisePhoneNumber,
  PhoneNumberError,
  type PhoneNumberErrorCode,
  type PhoneNumberFormat,
  type PhoneRegion,
  parsePhoneNumber,
  phoneNumbersEqual,
  SUPPORTED_PHONE_REGIONS,
} from "../src/apps/contacts/lib/phone";

// Synthetic numbers from the NANPA/Ofcom/ACMA fiction ranges linked in the README.
const fixtures: [PhoneRegion, string, string, string, string][] = [
  ["US", "202-555-0101", "+12025550101", "(202) 555-0101", "+1 202 555 0101"],
  ["CA", "416.555.0101", "+14165550101", "(416) 555-0101", "+1 416 555 0101"],
  ["GB", "020 7946 0123", "+442079460123", "020 7946 0123", "+44 20 7946 0123"],
  ["GB", "07700 900123", "+447700900123", "07700 900123", "+44 7700 900123"],
  ["AU", "02 5550 1234", "+61255501234", "(02) 5550 1234", "+61 2 5550 1234"],
  ["AU", "03 5550 1234", "+61355501234", "(03) 5550 1234", "+61 3 5550 1234"],
  ["AU", "07 5550 1234", "+61755501234", "(07) 5550 1234", "+61 7 5550 1234"],
  ["AU", "08 5550 1234", "+61855501234", "(08) 5550 1234", "+61 8 5550 1234"],
  ["AU", "0491 570 006", "+61491570006", "0491 570 006", "+61 491 570 006"],
];

function rejects(input: string, code: PhoneNumberErrorCode, region?: PhoneRegion): void {
  expect(() => parsePhoneNumber(input, region)).toThrow(PhoneNumberError);
  expect(() => parsePhoneNumber(input, region)).toThrow(expect.objectContaining({ code }));
  const result = normalisePhoneNumber(input, region);
  expect(result.ok).toBe(false);
  expect(result.original).toBe(input);
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(PhoneNumberError);
    expect(result.error.code).toBe(code);
    expect(result).not.toHaveProperty("number");
    expect(result).not.toHaveProperty("e164");
  }
}

describe("phone calling plans and formatting", () => {
  it("publishes an immutable explicit default-region set", () => {
    expect(SUPPORTED_PHONE_REGIONS).toEqual(["US", "CA", "GB", "AU"]);
    expect(Object.isFrozen(SUPPORTED_PHONE_REGIONS)).toBe(true);
  });

  it.each(
    fixtures,
  )("round-trips %s national input %s", (region, input, e164, national, international) => {
    const parsed = parsePhoneNumber(input, region);
    expect(parsed.e164).toBe(e164);
    expect(parsed.extension).toBeNull();
    expect(parsed.callingCode + parsed.nationalNumber).toBe(e164.slice(1));
    expect(formatPhoneNumber(input, "national", region)).toBe(national);
    expect(formatPhoneNumber(e164, "international")).toBe(international);
    expect(parsePhoneNumber(national, region)).toEqual(parsed);
    expect(parsePhoneNumber(international)).toEqual(parsed);
    expect(parsePhoneNumber(e164, "AU")).toEqual(parsed);
    expect(phoneNumbersEqual(input, e164, region)).toBe(true);
  });

  it("handles domestic NANP 1 and ASCII punctuation without inferring a country", () => {
    expect(parsePhoneNumber(" 1 (202) 555-0101 ", "CA")).toEqual({
      e164: "+12025550101",
      callingCode: "1",
      nationalNumber: "2025550101",
      extension: null,
    });
    expect(parsePhoneNumber("+1 (416) 555.0101")).not.toHaveProperty("region");
    expect(parsePhoneNumber("+44 (20) 7946-0123").e164).toBe("+442079460123");
  });

  it("returns a success result preserving the original spelling", () => {
    const input = " (202) 555.0101 ";
    expect(normalisePhoneNumber(input, "US")).toEqual({
      ok: true,
      original: input,
      number: parsePhoneNumber(input, "US"),
    });
  });

  it("rejects invalid display formats and propagates invalid numbers", () => {
    expect(() => formatPhoneNumber("+12025550101", "e164" as PhoneNumberFormat)).toThrow(
      expect.objectContaining({ code: "invalid-format" }),
    );
    expect(() => formatPhoneNumber("911", "national", "US")).toThrow(PhoneNumberError);
  });
});

describe("extensions and duplicate equality", () => {
  it.each([
    " ext 0012",
    " EXT. 0012",
    "ext.0012",
    " x0012",
    "X0012",
    ";ext=0012",
    ";EXT=0012",
  ])("recognises suffix %s and round-trips it without changing leading zeroes", (suffix) => {
    const input = `+12025550101${suffix}`;
    expect(parsePhoneNumber(input).extension).toBe("0012");
    for (const format of ["national", "international"] as const) {
      const formatted = formatPhoneNumber(input, format);
      expect(formatted).toBe(
        format === "national" ? "(202) 555-0101 ext. 0012" : "+1 202 555 0101 ext. 0012",
      );
      expect(parsePhoneNumber(formatted, "US")).toEqual(parsePhoneNumber(input));
    }
    expect(phoneNumbersEqual(input, "202-555-0101 x0012", "US")).toBe(true);
  });

  it("keeps base numbers, extension absence and leading zeroes distinct", () => {
    expect(phoneNumbersEqual("+12025550101", "+12025550102")).toBe(false);
    expect(phoneNumbersEqual("+12025550101 x1", "+12025550102 x1")).toBe(false);
    expect(phoneNumbersEqual("+12025550101", "+12025550101 x1")).toBe(false);
    expect(phoneNumbersEqual("+12025550101 x1", "+12025550101")).toBe(false);
    expect(phoneNumbersEqual("+12025550101 x01", "+12025550101 x1")).toBe(false);
    expect(parsePhoneNumber("+12025550101 x0").extension).toBe("0");
    expect(parsePhoneNumber("+12025550101 x1234567890").extension).toBe("1234567890");
  });

  it("never treats rejected operands as duplicate hints, even identical strings", () => {
    expect(() => phoneNumbersEqual("911", "911", "US")).toThrow(PhoneNumberError);
    expect(() => phoneNumbersEqual("+12025550101", "911", "US")).toThrow(PhoneNumberError);
  });

  it.each([
    "x",
    "x12345678901",
    "ext=1",
    ";ext=",
    ";ext=-1",
    "x1 x2",
    ";ext=1;ext=2",
    ";foo=1",
  ])("rejects malformed or duplicate extension %s without dropping data", (suffix) =>
    rejects(`+12025550101${suffix}`, "invalid-extension"));
});

describe("fail-closed parsing and verbatim preservation", () => {
  it("requires a supported explicit region for national inputs", () => {
    rejects("202-555-0101", "missing-region");
    for (const region of ["FR", "us", "", "toString", "__proto__", null, 1, {}]) {
      rejects("+12025550101", "invalid-region", region as PhoneRegion);
    }
  });

  it.each([
    "",
    " ",
    "+",
    "++12025550101",
    "202/555/0101",
    "202,555,0101",
    "202#5550101",
    "(202 555-0101",
    "202)5550101",
    "((202))5550101",
    "()2025550101",
    "2025550101-",
    "+ 1 2025550101",
    "202\t5550101",
    "2025550101\n",
    "+12025550101 x1\n",
    "\r+12025550101",
    "\u0000+12025550101",
    "２０２５５５０１０１",
    "+١٢٠٢٥٥٥٠١٠١",
    "\u00a02025550101",
    "202\u202e5550101",
    "\ud800",
    "1".repeat(257),
    `${"1".repeat(255)}!`,
    `${"("}${"1".repeat(254)}!`,
  ])("keeps invalid syntax verbatim: %j", (input) => rejects(input, "invalid-input", "US"));

  it.each([
    ["911", "US"],
    ["5550101", "US"],
    ["2021550101", "US"],
    ["1025550101", "US"],
    ["0207946012", "GB"],
    ["020794601234", "GB"],
    ["2079460123", "GB"],
    ["01632 960123", "GB"],
    ["07000 900123", "GB"],
    ["07600 900123", "GB"],
    ["03069 990123", "GB"],
    ["1800 975707", "AU"],
    ["491570006", "AU"],
    ["05 5550 1234", "AU"],
    ["+44 (0)20 7946 0123", "GB"],
    ["+61 0491 570006", "AU"],
    ["+9992025550101", "US"],
    ["+012025550101", "US"],
    ["+1", "US"],
    ["+12025550101123456", "US"],
    ["00442079460123", "GB"],
    ["011442079460123", "US"],
    ["0011442079460123", "AU"],
  ] as const)("rejects unsupported number %s in %s", (input, region) =>
    rejects(input, "unsupported-number", region));

  it.each([
    "tel:+12025550101",
    "+12025550101;phone-context=example.org",
    "1-800-FLOWERS",
  ])("rejects unsupported syntax without reinterpreting %s", (input) =>
    rejects(input, "invalid-extension", "US"));

  it("throws typed errors for non-string runtime inputs, without coercion", () => {
    for (const input of [undefined, null, 2025550101, {}, [], new String("+12025550101")]) {
      expect(() => parsePhoneNumber(input as string, "US")).toThrow(PhoneNumberError);
      expect(() => normalisePhoneNumber(input as string, "US")).toThrow(PhoneNumberError);
    }
  });

  it("excludes caller data from error messages", () => {
    const result = normalisePhoneNumber("Mira Quill at example.org");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("Phone number: invalid-extension");
  });

  it("propagates unexpected implementation failures instead of flagging them as bad data", () => {
    const failure = new Error("synthetic failure");
    const spy = vi.spyOn(Object, "values").mockImplementationOnce(() => {
      throw failure;
    });
    try {
      expect(() => normalisePhoneNumber("+12025550101")).toThrow(failure);
    } finally {
      spy.mockRestore();
    }
  });
});
