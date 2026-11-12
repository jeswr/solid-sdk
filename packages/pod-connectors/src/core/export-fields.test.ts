// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { bookFragment, bookKey, isbn13, primaryAuthor } from "./books.js";
import {
  cappedText,
  exportDate,
  finiteNumber,
  httpUrl,
  MAX_TAG_CHARS,
  MAX_TAGS,
  MAX_URL_CHARS,
  parseDateOnly,
  tagList,
  unixSecondsDate,
} from "./export-fields.js";

describe("export field bounds", () => {
  it("caps text at a code point boundary", () => {
    expect(cappedText("  abc  ", 10)).toBe("abc");
    expect(cappedText("   ", 10)).toBeUndefined();
    expect(cappedText(5, 10)).toBeUndefined();
    expect(cappedText("ab🌍cd", 3)).toBe("ab");
    expect(cappedText("abcdef", 4)).toBe("abcd");
  });

  it("keeps dates between 1970 and 2100 only", () => {
    expect(exportDate(new Date("1970-01-01T00:00:00Z"))?.getTime()).toBe(0);
    expect(exportDate(new Date("2100-12-31T23:59:59Z"))).toBeDefined();
    expect(exportDate(new Date("2101-01-01T00:00:00Z"))).toBeUndefined();
    expect(exportDate(new Date("1969-12-31T23:59:59Z"))).toBeUndefined();
    expect(exportDate(new Date(Number.NaN))).toBeUndefined();
    expect(exportDate(undefined)).toBeUndefined();
  });

  it("reads Unix seconds from numbers and plain digit strings", () => {
    expect(unixSecondsDate("1700000000")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(unixSecondsDate(1700000000.5)?.getTime()).toBe(1700000000500);
    for (const raw of [
      "1e9",
      "0x10",
      "-5",
      "",
      "Infinity",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      null,
      "7258118400",
    ])
      expect(unixSecondsDate(raw), String(raw)).toBeUndefined();
  });

  it("parses strict calendar dates", () => {
    expect(parseDateOnly("2024-02-29")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(parseDateOnly("2024/1/5")?.toISOString()).toBe("2024-01-05T00:00:00.000Z");
    for (const raw of [
      "2023-02-29",
      "2024-13-01",
      "2024-01/05",
      "1969-12-31",
      "2101-01-01",
      "x",
      undefined,
    ])
      expect(parseDateOnly(raw), String(raw)).toBeUndefined();
  });

  it("reads finite plain decimals only", () => {
    expect(finiteNumber(" 4.5 ")).toBe(4.5);
    expect(finiteNumber("-2")).toBe(-2);
    for (const raw of ["1e3", "Infinity", "NaN", "0x1", "", "1.", undefined])
      expect(finiteNumber(raw), String(raw)).toBeUndefined();
  });

  it("keeps credential-free absolute http(s) links only", () => {
    expect(httpUrl(" https://example.org/a b ")).toBe("https://example.org/a%20b");
    expect(httpUrl("HTTP://Example.org")).toBe("http://example.org/");
    for (const raw of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "ftp://example.org/",
      "//example.org/x",
      "/relative",
      "https://user:pw@example.org/",
      "https://user@example.org/",
      `https://example.org/${"a".repeat(MAX_URL_CHARS)}`,
      5,
      undefined,
    ])
      expect(httpUrl(raw), String(raw)).toBeUndefined();
  });

  it("splits, caps and dedups tags", () => {
    expect(tagList("a| b |a||c", "|")).toEqual(["a", "b", "c"]);
    expect(tagList(undefined, ",")).toEqual([]);
    expect(tagList(Array.from({ length: 100 }, (_, i) => `t${i}`).join(","), ",")).toHaveLength(
      MAX_TAGS,
    );
    expect(tagList("x".repeat(MAX_TAG_CHARS + 5), ",")[0]).toHaveLength(MAX_TAG_CHARS);
  });
});

describe("shared book identity", () => {
  it("normalises ISBN-10 to ISBN-13 and verifies checksums", () => {
    expect(isbn13("0441013597")).toBe("9780441013593");
    expect(isbn13("0-441-01359-7")).toBe("9780441013593");
    expect(isbn13('="9780441013593"')).toBe("9780441013593");
    expect(isbn13("080442957X")).toBe("9780804429573");
    expect(isbn13("979-10-90636-07-1")).toBe("9791090636071");
    for (const raw of [
      "0441013598",
      "9780441013594",
      "1234567890123",
      "X441013597",
      "abc",
      "",
      undefined,
      "9".repeat(80),
    ])
      expect(isbn13(raw), String(raw)).toBeUndefined();
  });

  it("keys books by ISBN, else folded title and primary author", () => {
    expect(bookKey("Dune", "Frank", "9780441013593")).toBe("isbn:9780441013593");
    expect(bookKey("Ça  Va!", "Émile Zola")).toBe(bookKey("ca va", "EMILE ZOLA"));
    expect(bookFragment("Any title", undefined, "9780441013593")).toBe("isbn-9780441013593");
    expect(bookFragment("Le Café", "Writer")).toBe(bookFragment("le cafe", "writer"));
    expect(bookFragment("Le Café", "Writer")).not.toBe(bookFragment("Le Café", "Other"));
    expect(primaryAuthor("A One, B Two")).toBe("A One");
    expect(primaryAuthor(undefined)).toBeUndefined();
  });
});
