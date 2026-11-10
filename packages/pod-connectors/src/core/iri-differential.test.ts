// AUTHORED-BY Codex GPT-6.1-Sol
import { escapeIri, safeIri as sharedSafeIri } from "@jeswr/rdf-serialize";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { PodThing, safeIri } from "./vocab.js";

// Frozen from 0d884208, retained only as a differential oracle.
// biome-ignore lint/suspicious/noControlCharactersInRegex: historical IRIREF exclusion set
const ILLEGAL_IRI = /[\u0000-\u0020<>"{}|^`\\]/;
function legacySafeIri(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return ILLEGAL_IRI.test(value) ? undefined : value;
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

describe("safeIri differential: preserve rejection of raw forbidden characters", () => {
  it.each(corpus)("compares historical and shared results for %j", (value) => {
    const old = legacySafeIri(value);
    const shared = sharedSafeIri(value);
    expect(safeIri(value)).toBe(old === undefined ? undefined : shared);
    if (old !== undefined && shared !== undefined) expect(shared).toBe(old);
    if (old === undefined && shared !== undefined) {
      // QUESTIONS.md Q2: retain drop-on-invalid instead of accepting an escaped value.
      expect(escapeIri(value as string)).not.toBe(value);
    }
  });
  it.each(forbidden)("records shared-only acceptance of embedded %j", (char) => {
    const value = `https://example.org/a${char}b`;
    expect(legacySafeIri(value)).toBeUndefined();
    expect(sharedSafeIri(value)).toBe(escapeIri(value));
    expect(safeIri(value)).toBeUndefined();
  });
  it.each([
    "",
    "relative",
    "/path",
    "#fragment",
    "https://[invalid]/path",
  ])("records stricter absolute-IRI validation for %j", (value) => {
    expect(legacySafeIri(value)).toBe(value);
    expect(sharedSafeIri(value)).toBeUndefined();
    expect(safeIri(value)).toBeUndefined();
    const store = new Store();
    const thing = new PodThing("https://pod.example/item#it", store, DataFactory);
    thing.sourceUrl = "https://example.org/valid";
    thing.sourceUrl = value;
    expect(thing.sourceUrl).toBeUndefined();
    expect(store.size).toBe(0);
  });
});
