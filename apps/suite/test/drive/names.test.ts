// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  displayName,
  displayNameOf,
  extensionChain,
  guessContentType,
  MAX_NAME_LENGTH,
  toSegment,
  uploadFileName,
  withSuffix,
} from "../../src/apps/drive/lib/model/names.js";

describe("Drive names", () => {
  it.each([
    ["Reports 2026", "Reports 2026"],
    ["Résumé 日本語.txt", "Résumé 日本語.txt"],
    ["📂 Family 😀.jpg", "📂 Family 😀.jpg"],
    ["a/b.txt", "a-b.txt"],
    ["a\\b.txt", "a-b.txt"],
    ["a:b.txt", "a-b.txt"],
    ["a#b.txt", "a-b.txt"],
    ["a?b.txt", "a-b.txt"],
    ["a%b.txt", "a-b.txt"],
    ["a*b.txt", "a-b.txt"],
    ["a\u0000b.txt", "a-b.txt"],
    ["a\nb.txt", "a-b.txt"],
    ["a\u007fb", "a-b"],
    ["a\u0085b", "a-b"],
    ["  Report.pdf  ", "Report.pdf"],
    ["README", "README"],
    ["backup.tar.gz", "backup.tar.gz"],
    [".gitignore", ".gitignore"],
    [".config.json", ".config.json"],
    ["Hello+World!.MD", "Hello+World!.MD"],
    ["a".repeat(181), "a".repeat(180)],
    [`${"A".repeat(180)}.tar.gz`, `${"A".repeat(173)}.tar.gz`],
    [`${"😀".repeat(180)}.txt`, `${"😀".repeat(176)}.txt`],
  ])("normalizes %s", (input, expected) => {
    expect(uploadFileName(input)).toBe(expected);
    expect(decodeURIComponent(toSegment(input))).toBe(expected);
    expect(Array.from(expected).length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  });

  it.each(["", "   ", ".", "..", `a.${"x".repeat(180)}`])("rejects %s", (name) => {
    expect(() => uploadFileName(name)).toThrow(TypeError);
  });

  it.each([
    ["archive.tar.gz", ".tar.gz"],
    ["file.TXT", ".TXT"],
    ["plain", ""],
    [".gitignore", ""],
    ["...config.json", ".json"],
    ["file.", "."],
  ])("preserves full extension chain for %s", (name, expected) => {
    expect(extensionChain(name)).toBe(expected);
  });

  it("adds a collision suffix before the chain within the length limit", () => {
    expect(withSuffix("notes.md", 1)).toBe("notes (1).md");
    expect(withSuffix("backup.tar.gz", 12)).toBe("backup (12).tar.gz");
    expect(withSuffix("README", 1)).toBe("README (1)");
    expect(withSuffix(".gitignore", 2)).toBe(".gitignore (2)");
    expect(withSuffix(`${"a".repeat(180)}.tar.gz`, 1)).toBe(`${"a".repeat(169)} (1).tar.gz`);
    for (const n of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => withSuffix("a", n)).toThrow(TypeError);
    }
  });

  it("encodes one segment without losing capitalization or spaces", () => {
    expect(toSegment("Reports 2026")).toBe("Reports%202026");
    expect(toSegment("a/b:c")).toBe("a-b-c");
  });

  it("decodes file/folder paths and keeps malformed percent escapes readable", () => {
    expect(displayName("https://pod.example/drive/My%20Folder/?q=x#it")).toBe("My Folder");
    expect(displayName("https://pod.example/")).toBe("pod.example");
    expect(displayName("https://pod.example/%GG.txt")).toBe("%GG.txt");
    const entry = { url: "https://pod.example/generated-uuid" };
    expect(displayNameOf({ ...entry, displayName: "Requested Name.pdf" })).toBe(
      "Requested Name.pdf",
    );
    expect(displayNameOf({ ...entry, displayName: "" })).toBe("");
    expect(displayNameOf({ ...entry, displayName: null })).toBe("generated-uuid");
    expect(displayNameOf(entry)).toBe("generated-uuid");
  });

  it.each([
    ["ttl", "text/turtle"],
    ["jsonld", "application/ld+json"],
    ["nt", "application/n-triples"],
    ["nq", "application/n-quads"],
    ["txt", "text/plain"],
    ["md", "text/markdown"],
    ["csv", "text/csv"],
    ["json", "application/json"],
    ["html", "text/html"],
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["gif", "image/gif"],
    ["svg", "image/svg+xml"],
    ["webp", "image/webp"],
    ["pdf", "application/pdf"],
    ["mp3", "audio/mpeg"],
    ["wav", "audio/wav"],
    ["mp4", "video/mp4"],
    ["webm", "video/webm"],
  ])("guesses the Pod Manager content type for %s", (extension, type) => {
    expect(guessContentType(`File.${extension.toUpperCase()}`)).toBe(type);
  });

  it("leaves unknown types to the upload octet-stream fallback", () => {
    for (const name of [
      "README",
      "unknown.extension",
      "archive.tar.gz",
      "file.__proto__",
      ".png",
    ]) {
      expect(guessContentType(name)).toBeUndefined();
    }
  });
});
