// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  DedupeError,
  type DedupeErrorCode,
  normaliseEmail,
  normaliseName,
  normalisePhone,
} from "../src/apps/contacts/lib/dedupe";
import { validateWebId } from "../src/apps/contacts/lib/dedupe/normalise";

function rejects(action: () => unknown, code: DedupeErrorCode): void {
  expect(action).toThrow(DedupeError);
  expect(action).toThrow(expect.objectContaining({ code, message: `Contact dedupe: ${code}` }));
}

describe("contact normalisation", () => {
  it("folds email case and preserves plus-tags, dots and valid atom punctuation", () => {
    expect(normaliseEmail("  Mira.Quill+Club@EXAMPLE.ORG  ")).toBe("mira.quill+club@example.org");
    expect(normaliseEmail("mira+club@example.org")).not.toBe(normaliseEmail("mira@example.org"));
    expect(normaliseEmail("m.ira@example.org")).not.toBe(normaliseEmail("mira@example.org"));
    expect(normaliseEmail("o'quill+fiction@sub.example.org")).toBe(
      "o'quill+fiction@sub.example.org",
    );
    expect(normaliseEmail(`${"a".repeat(64)}@${"b".repeat(63)}.example.org`)).toContain("@b");
  });

  it.each([
    "",
    " ",
    "mira",
    "mira@",
    "@example.org",
    "mira@@example.org",
    "mira@example",
    "mira..quill@example.org",
    ".mira@example.org",
    "mira.@example.org",
    "mira@-example.org",
    "mira@example-.org",
    "mira@example..org",
    "mira@example.org.",
    "Mira <mira@example.org>",
    '"mira quill"@example.org',
    "mira@[127.0.0.1]",
    "míra@example.org",
    "mira@éxample.org",
    "mailto:mira@example.org",
    "mira@example.org?subject=hi",
    "mira\n@example.org",
    "\ud800@example.org",
    `${"a".repeat(65)}@example.org`,
    `mira@${"b".repeat(64)}.org`,
    `${"a".repeat(64)}@${Array(4).fill("b".repeat(63)).join(".")}`,
    null,
    123,
  ])("rejects unsupported email %j", (value) => {
    rejects(() => normaliseEmail(value as string), "invalid-email");
  });

  it("normalises recognised phone formatting without inferring a region", () => {
    expect(normalisePhone(" +1 (202) 555-0101 ")).toBe("+12025550101");
    expect(normalisePhone("202.555.0101", "1")).toBe("+12025550101");
    expect(normalisePhone("202 555 0101")).toBe("2025550101");
    expect(normalisePhone("020 7946 0101")).toBe("02079460101");
    expect(normalisePhone("+44 20 7946 0101", "1")).toBe("+442079460101");
    expect(normalisePhone("123", "123")).toBe("+123123");
    expect(normalisePhone("(202)5550101")).toBe("2025550101");
    expect(normalisePhone("+123456789012345")).toBe("+123456789012345");
  });

  it.each([
    "",
    " ",
    "+",
    "-",
    "++12025550101",
    "202+5550101",
    "+02025550101",
    "1-800-FLOWERS",
    "2025550101x2",
    "2025550101 ext. 2",
    "tel:+12025550101",
    "+12025550101;ext=2",
    "202/555/0101",
    "+44 (0)20 7946 0101",
    "(202",
    "202)",
    "()202",
    "((202))",
    "202\t5550101",
    "２０２５５５０１０１",
    "2025550101#",
    "2025550101,2",
    "1234567890123456",
    null,
    {},
  ])("rejects unsupported phone %j", (value) => {
    rejects(() => normalisePhone(value as string), "invalid-phone");
  });

  it("rejects national trunk assumptions and overlong prefixed numbers", () => {
    rejects(() => normalisePhone("02079460101", "44"), "invalid-phone");
    rejects(() => normalisePhone("123456789012345", "1"), "invalid-phone");
  });

  it.each([
    "",
    "0",
    "01",
    "+1",
    "1234",
    "44 ",
    "GB",
    null,
    44,
  ])("rejects unsupported country code %j even for an international phone", (code) =>
    rejects(() => normalisePhone("+12025550101", code as string), "invalid-country-code"));

  it.each([
    ["  ＭＩＲＡ Quill  ", "mira quill"],
    ["ÉLODIE", "élodie"],
    ["E\u0301lodie", "élodie"],
    ["Straße", "strasse"],
    ["Σίσυφος", "σίσυφοσ"],
    ["ΟΣ", "οσ"],
    ["İIı", "i\u0307iı"],
    ["ﬃ", "ffi"],
    ["Ꭰꭰ", "ᎠᎠ"],
    ["𐐀", "𐐨"],
    ["\u{16ea0}", "\u{16ebb}"],
    ["МИРА", "мира"],
    ["Mira  Quill", "mira  quill"],
    ["みら 🌿", "みら 🌿"],
  ])("NFKC full-folds %s", (value, expected) => {
    expect(normaliseName(value)).toBe(expected);
    expect(normaliseName(expected)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "\ud800",
    "Mira\nQuill",
    "Mira\u0000Quill",
    null,
    123,
  ])("rejects unsupported name %j", (value) =>
    rejects(() => normaliseName(value as string), "invalid-name"));

  it("validates WebIDs while retaining exact RDF identifier spelling", () => {
    expect(validateWebId("https://example.org/Mira#me")).toBe("https://example.org/Mira#me");
    expect(validateWebId("HTTP://EXAMPLE.ORG:80/%6Dira#me")).toBe(
      "HTTP://EXAMPLE.ORG:80/%6Dira#me",
    );
    expect(validateWebId("https://example.org/mira#other")).toContain("#other");
  });

  it.each([
    "",
    " ",
    "mira",
    "/mira#me",
    "ftp://example.org/mira",
    "https://",
    "https:///",
    "https:///example.org/mira",
    "https://@example.org/mira",
    "https://[invalid]/",
    "https://mira:secret@example.org/",
    "https://mira@example.org/",
    " https://example.org/mira",
    "https://example.org/mira quill",
    "https://example.org/\\mira",
    'https://example.org/"mira',
    "https://example.org/<mira>",
    "https://example.org/mira%xx",
    "https://example.org/mira%",
    "https://example.org/\ud800",
    null,
  ])("rejects unsupported WebID %j", (value) => {
    rejects(() => validateWebId(value as string), "invalid-webid");
  });
});
