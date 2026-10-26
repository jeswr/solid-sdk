// AUTHORED-BY Codex GPT-6.1-Sol
import { escapeIri, safeHttpIri as sharedSafeHttpIri } from "@jeswr/rdf-serialize";
import { describe, expect, it } from "vitest";
import { safeHttpIri } from "../src/iri.js";

// Frozen from 0d884208, retained only as a differential oracle.
function hasUrlStripDivergence(value: string): boolean {
  if (value.length === 0) return false;
  if (value.charCodeAt(0) <= 0x20 || value.charCodeAt(value.length - 1) <= 0x20) {
    return true;
  }
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x09 || c === 0x0a || c === 0x0d) return true;
  }
  return false;
}

function legacySafeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  if (hasUrlStripDivergence(value)) return undefined;
  const escaped = escapeIri(value);
  let u: URL;
  try {
    u = new URL(escaped);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  if (!/^https?:\/\/[^/?#]/i.test(escaped) || u.host === "") return undefined;
  return escaped;
}

// Same adversarial corpus for each historical copy; fixtures never dereference IRIs.
const corpus: Array<string | undefined> = [
  undefined,
  "",
  "relative",
  "/path",
  "../path",
  "//example.org/path",
  "#fragment",
  "urn:uuid:abc",
  "did:example:123",
  "mailto:a@example.org",
  "ftp://example.org/path",
  "file:///tmp/example",
  "javascript:alert(1)",
  "data:text/plain,example",
  "http://example.org/path",
  "HTTPS://Example.ORG:443/a/../b#me",
  "https://example.org",
  "http://example.org:80",
  "https://example.org#me",
  "https://user:password@example.org/path",
  "https://user%40name@example.org/path",
  "https://例え.テスト/é/😀",
  "https://xn--r8jz45g.xn--zckzah/path",
  "https://example.org/%2f/%3E/%09?x=%20#%0a",
  "https://example.org/%not-hex",
  "https:example.org",
  "http:example.org/path",
  "https:/example.org/path",
  "https:///example.org/path",
  "http:////example.org/path",
  "https://?query",
  "https://#fragment",
  "https://",
  "https://[invalid]/path",
  "https://example.org:99999/path",
  "https://example.org/path> . <https://evil.example/s> <https://evil.example/p> <https://evil.example/o",
];
const forbidden = [
  ...Array.from({ length: 0x21 }, (_, code) => String.fromCharCode(code)),
  ...'<>{}|^`\\"',
];
for (const char of forbidden) {
  corpus.push(
    `${char}https://example.org/path`,
    `https://example.org/path${char}`,
    `ht${char}tps://example.org/path`,
    `https://exa${char}mple.org/path`,
    `https://example.org/a${char}b`,
    `https://example.org/path?q=a${char}b`,
    `https://example.org/path#a${char}b`,
    `urn:example:a${char}b`,
  );
}

describe("safeHttpIri differential: preserve the VC strip-divergence restriction", () => {
  it.each(corpus)("compares historical and shared results for %j", (value) => {
    const old = legacySafeHttpIri(value);
    const shared = sharedSafeHttpIri(value);
    expect(safeHttpIri(value)).toBe(old);
    if (old !== undefined) expect(shared).toBe(old);
    if (old === undefined && shared !== undefined) {
      // QUESTIONS.md Q1: the canonical guard escapes these; VC must still drop them.
      expect(value).toMatch(/[\t\n\r]/);
    }
  });
  it.each(["\t", "\n", "\r"])("records the shared-only acceptance of embedded %j", (char) => {
    const value = `https://example.org/a${char}b`;
    expect(legacySafeHttpIri(value)).toBeUndefined();
    expect(sharedSafeHttpIri(value)).toBe(escapeIri(value));
    expect(safeHttpIri(value)).toBeUndefined();
  });
});
