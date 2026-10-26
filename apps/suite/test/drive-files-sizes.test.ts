// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { FileError, formatFileSize } from "../src/apps/drive/lib/files";

describe("Drive file sizes", () => {
  it.each([
    [0, "0 B"],
    [-0, "0 B"],
    [1, "1 B"],
    [999, "999 B"],
    [1000, "1 kB"],
    [1024, "1 kB"],
    [1250, "1.3 kB"],
    [999949, "999.9 kB"],
    [999950, "1 MB"],
    [1_200_000, "1.2 MB"],
    [1e9, "1 GB"],
    [1e12, "1 TB"],
    [1e15, "1 PB"],
    [Number.MAX_SAFE_INTEGER, "9 PB"],
  ])("formats %s bytes", (bytes, expected) => expect(formatFileSize(bytes)).toBe(expected));

  it("uses the supplied account locale", () => {
    expect(formatFileSize(1_200_000, "de-DE")).toBe("1,2 MB");
    expect(formatFileSize(1_200_000, "en-GB")).toBe("1.2 MB");
  });

  it.each([
    -1,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid byte count %s", (bytes) =>
    expect(() => formatFileSize(bytes)).toThrow(expect.objectContaining({ code: "invalid-size" })));

  it.each([
    "",
    "not_a_locale",
    "zz-ZZ",
    "\ud800",
    null as unknown as string,
  ])("rejects unsupported or malformed locale %j", (locale) =>
    expect(() => formatFileSize(10, locale)).toThrow(FileError));
});
