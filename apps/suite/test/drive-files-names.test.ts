// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FileError } from "../src/apps/drive/lib/files/errors";
import {
  encodeResourceName,
  extensionChain,
  MAX_RESOURCE_NAME_LENGTH,
  renameOnConflict,
  uploadFileName,
  withSuffix,
} from "../src/apps/drive/lib/files/names";

describe("Drive resource names", () => {
  it.each([
    [" Report 2026.PDF ", "Report 2026.PDF"],
    ["a/b\\c:d#e?f%g*h", "a-b-c-d-e-f-g-h"],
    ["a\u0000\n\r\t\u001f\u007f\u0085b", "a-------b"],
    ["Cafe\u0301.txt", "Café.txt"],
    ["日本語 💡.txt", "日本語 💡.txt"],
    ["a@b!$&'()+,;=[]{}<>|.txt", "a@b!$&'()+,;=[]{}<>|.txt"],
    [".env", ".env"],
    [".config.json", ".config.json"],
    ["a .txt", "a .txt"],
    ["%2F.txt", "-2F.txt"],
    ["a.", "a."],
    ["x".repeat(181), "x".repeat(180)],
    [`${"x".repeat(180)}.tar.gz`, `${"x".repeat(173)}.tar.gz`],
    [`${"💡".repeat(181)}.txt`, `${"💡".repeat(176)}.txt`],
    [`${"a".repeat(179)} b`, "a".repeat(179)],
  ])("sanitizes %j with display fidelity", (input, expected) => {
    expect(uploadFileName(input)).toBe(expected);
    expect(uploadFileName(expected)).toBe(expected);
  });

  it.each([
    "",
    " ",
    ".",
    "..",
    "\ud800",
    "a\udfff",
    null as unknown as string,
    1 as unknown as string,
  ])("rejects unusable names %j with a typed error", (name) => {
    expect(() => uploadFileName(name)).toThrow(FileError);
    expect(() => encodeResourceName(name)).toThrow(
      expect.objectContaining({ code: "invalid-name", name: "FileError" }),
    );
  });

  it("caps code points and fails if the complete extension cannot fit", () => {
    expect(MAX_RESOURCE_NAME_LENGTH).toBe(180);
    expect(uploadFileName(`x.${"z".repeat(178)}`)).toHaveLength(180);
    expect(() => uploadFileName(`x.${"z".repeat(179)}`)).toThrow(
      expect.objectContaining({ code: "name-too-long" }),
    );
    expect(() => withSuffix(`x.${"z".repeat(175)}`, 1)).toThrow(
      expect.objectContaining({ code: "name-too-long" }),
    );
  });

  it.each([
    " ",
    "\u00a0",
    "\u2003",
  ])("rejects names truncated and trimmed to a dot segment with whitespace %j", (whitespace) => {
    const name = `.${whitespace.repeat(MAX_RESOURCE_NAME_LENGTH - 1)}x`;
    for (const operation of [
      () => uploadFileName(name),
      () => encodeResourceName(name),
      () => withSuffix(name, 1),
      () => renameOnConflict(name, []),
    ]) {
      expect(operation).toThrow(
        expect.objectContaining({ code: "invalid-name", name: "FileError" }),
      );
    }
    const fittedName = `.${whitespace.repeat(MAX_RESOURCE_NAME_LENGTH - 2)}x`;
    expect(uploadFileName(fittedName)).toBe(fittedName);
  });

  it.each([
    ["report.final.tar.gz", ".final.tar.gz"],
    ["x.tar.gz", ".tar.gz"],
    [".env", ""],
    [".config.json", ".json"],
    ["plain", ""],
    ["", ""],
    ["x.", "."],
  ])("extracts full extension chains from %j", (name, expected) =>
    expect(extensionChain(name)).toBe(expected));

  it("encodes one safe segment without losing Unicode, case, or allowed punctuation", () => {
    const name = "Café 💡 @;=&+!(').txt";
    const slug = encodeResourceName(name);
    expect(slug).toBe(encodeURIComponent(name));
    expect(decodeURIComponent(slug)).toBe(name);
    expect(new URL(slug, "https://example.org/drive/").pathname).toBe(`/drive/${slug}`);
    expect(encodeResourceName("x%20y/z")).toBe("x-20y-z");
  });

  it.each([
    ["name.ext", "name (1).ext"],
    ["name.tar.gz", "name (1).tar.gz"],
    ["name", "name (1)"],
    [".env", ".env (1)"],
    [".env.local", ".env (1).local"],
    ["name (1).txt", "name (1) (1).txt"],
  ])("adds a conflict suffix to %s", (name, expected) =>
    expect(withSuffix(name, 1)).toBe(expected));

  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid suffix %s", (n) => {
    expect(() => withSuffix("test.txt", n)).toThrow(
      expect.objectContaining({ code: "invalid-name" }),
    );
  });

  it("finds the first free number, preserving extensions, length, and input snapshots", () => {
    const existing = Object.freeze(["name.tar.gz", "name (1).tar.gz", "name (3).tar.gz"]);
    expect(renameOnConflict("name.tar.gz", existing)).toBe("name (2).tar.gz");
    expect(renameOnConflict("other.tar.gz", existing)).toBe("other.tar.gz");
    expect(renameOnConflict("name.tar.gz", [])).toBe("name.tar.gz");
    expect(renameOnConflict("Café.txt", ["Cafe\u0301.txt"])).toBe("Café (1).txt");
    expect(renameOnConflict("Name.txt", ["name.txt"])).toBe("Name.txt");
    expect(() => renameOnConflict("name", ["\ud800"])).toThrow(FileError);
    const long = `${"💡".repeat(176)}.txt`;
    const first = `${"💡".repeat(172)} (1).txt`;
    expect(withSuffix(long, 1)).toBe(first);
    expect(renameOnConflict(long, [long, first])).toBe(`${"💡".repeat(172)} (2).txt`);
    expect(withSuffix("x.txt", 12)).toBe("x (12).txt");
    expect(existing).toHaveLength(3);
  });

  it("keeps every generated name inside one URL segment and finds a free capped name", () => {
    const characters = fc.constantFrom(
      "a",
      "Z",
      " ",
      "/",
      "\\",
      "%",
      "#",
      "?",
      "*",
      "é",
      "💡",
      "日",
      "\u0301",
      "\n",
    );
    fc.assert(
      fc.property(fc.array(characters, { maxLength: 250 }), (chars) => {
        const name = uploadFileName(`A${chars.join("")}.tar.gz`);
        const slug = encodeResourceName(name);
        expect(Array.from(name).length).toBeLessThanOrEqual(180);
        expect(decodeURIComponent(slug)).toBe(name);
        expect(name).toBe(name.normalize("NFC"));
        expect(new URL(slug, "https://example.org/storage/").pathname.split("/")).toHaveLength(3);
        const occupied = [name, withSuffix(name, 1), withSuffix(name, 2)];
        const next = renameOnConflict(name, occupied);
        expect(occupied).not.toContain(next);
        expect(next.endsWith(" (3).tar.gz")).toBe(true);
        expect(Array.from(next).length).toBeLessThanOrEqual(180);
      }),
      { seed: 20261026, numRuns: 200 },
    );
  });
});
