// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri as sharedSafeHttpIri } from "@jeswr/rdf-serialize";
import { describe, expect, it } from "vitest";
import { safeHttpIri } from "./safe-iri.js";

// Frozen outputs of the original implementation at 0d884208, captured before migration.
// Keep these values: the differential must survive removal of the old guard logic.
const legacyHttpCases = [
  ["", undefined],
  ["https://example.org/a", "https://example.org/a"],
  ["http://example.org", "http://example.org/"],
  ["HTTPS://EXAMPLE.org:443/a/../b", "https://example.org/b"],
  ["https://EXAMPLE.org:443", "https://example.org/"],
  ["https://example.org/%2e%2e/a", "https://example.org/a"],
  ["https://example.org/a%2Fb%5Cc%3Ed", "https://example.org/a%2Fb%5Cc%3Ed"],
  ["https://example.org/%", "https://example.org/%"],
  ["https://example.org/%zz", "https://example.org/%zz"],
  [
    "https://bücher.example/日本語/🎨",
    "https://xn--bcher-kva.example/%E6%97%A5%E6%9C%AC%E8%AA%9E/%F0%9F%8E%A8",
  ],
  ["https://xn--bcher-kva.example/", "https://xn--bcher-kva.example/"],
  ["https://user:pass@example.org/a", "https://user:pass@example.org/a"],
  ["https://user%40name:p%3Ass@example.org/a", "https://user%40name:p%3Ass@example.org/a"],
  ["https://user@evil.example@example.org/a", "https://user%40evil.example@example.org/a"],
  ["https://[::1]/a", "https://[::1]/a"],
  ["https://example.org:65536/a", undefined],
  ["https://%65xample.org/a", "https://example.org/a"],
  ["javascript:alert(1)", undefined],
  ["data:text/plain,x", undefined],
  ["file:///tmp/a", undefined],
  ["ftp://example.org/a", undefined],
  ["mailto:a@example.org", undefined],
  ["tel:+123456789", undefined],
  ["urn:example:record:1", undefined],
  ["did:example:123", undefined],
  ["/relative/path", undefined],
  ["relative/path", undefined],
  ["//example.org/a", undefined],
  ["#fragment", undefined],
  ["?query", undefined],
  ["https:example.org", "https://example.org/"],
  ["https:/example.org", "https://example.org/"],
  ["https:///example.org", "https://example.org/"],
  ["http:////example.org", "http://example.org/"],
  ["https://?x", undefined],
  ["https://", undefined],
  ["https://example.org/a\\b", "https://example.org/a/b"],
  ["https:\\example.org\\a", "https://example.org/a"],
  ["https://exa\tmple.org/a", "https://example.org/a"],
  ["https://example.org/a\tb", "https://example.org/ab"],
  ["https://example.org/a\nb", "https://example.org/ab"],
  ["https://example.org/a\rb", "https://example.org/ab"],
  [" https://example.org/a", "https://example.org/a"],
  ["https://example.org/a ", "https://example.org/a"],
  ["\u0000https://example.org/a", "https://example.org/a"],
  ["https://example.org/a\u001f", "https://example.org/a"],
  [
    "https://example.org/a> . <https://evil.example/s> <https://evil.example/p> <https://evil.example/o",
    "https://example.org/a%3E%20.%20%3Chttps://evil.example/s%3E%20%3Chttps://evil.example/p%3E%20%3Chttps://evil.example/o",
  ],
  ["https://example.org/a?x=one two#three four", "https://example.org/a?x=one%20two#three%20four"],
  [
    "https://example.org/a\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f b",
    "https://example.org/a%00%01%02%03%04%05%06%07%08%0B%0C%0E%0F%10%11%12%13%14%15%16%17%18%19%1A%1B%1C%1D%1E%1F%20b",
  ],
  [
    "\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f https://example.org/a",
    "https://example.org/a",
  ],
  [
    "https://example.org/a\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f ",
    "https://example.org/a",
  ],
  ["https://example.org/a<b", "https://example.org/a%3Cb"],
  ["https://example.org/a?x=<b", "https://example.org/a?x=%3Cb"],
  ["https://example.org/a#x<b", "https://example.org/a#x%3Cb"],
  ["https://user<name@example.org/a", "https://user%3Cname@example.org/a"],
  ["https://exa<mple.org/a", undefined],
  ["https://example.org/a>b", "https://example.org/a%3Eb"],
  ["https://example.org/a?x=>b", "https://example.org/a?x=%3Eb"],
  ["https://example.org/a#x>b", "https://example.org/a#x%3Eb"],
  ["https://user>name@example.org/a", "https://user%3Ename@example.org/a"],
  ["https://exa>mple.org/a", undefined],
  ['https://example.org/a"b', "https://example.org/a%22b"],
  ['https://example.org/a?x="b', "https://example.org/a?x=%22b"],
  ['https://example.org/a#x"b', "https://example.org/a#x%22b"],
  ['https://user"name@example.org/a', "https://user%22name@example.org/a"],
  ['https://exa"mple.org/a', undefined],
  ["https://example.org/a{b", "https://example.org/a%7Bb"],
  ["https://example.org/a?x={b", undefined],
  ["https://example.org/a#x{b", undefined],
  ["https://user{name@example.org/a", "https://user%7Bname@example.org/a"],
  ["https://exa{mple.org/a", undefined],
  ["https://example.org/a}b", "https://example.org/a%7Db"],
  ["https://example.org/a?x=}b", undefined],
  ["https://example.org/a#x}b", undefined],
  ["https://user}name@example.org/a", "https://user%7Dname@example.org/a"],
  ["https://exa}mple.org/a", undefined],
  ["https://example.org/a|b", "https://example.org/a%7Cb"],
  ["https://example.org/a?x=|b", "https://example.org/a?x=%7Cb"],
  ["https://example.org/a#x|b", "https://example.org/a#x%7Cb"],
  ["https://user|name@example.org/a", "https://user%7Cname@example.org/a"],
  ["https://exa|mple.org/a", undefined],
  ["https://example.org/a\\b", "https://example.org/a/b"],
  ["https://example.org/a?x=\\b", undefined],
  ["https://example.org/a#x\\b", undefined],
  ["https://user\\name@example.org/a", "https://user/name@example.org/a"],
  ["https://exa\\mple.org/a", "https://exa/mple.org/a"],
  ["https://example.org/a^b", "https://example.org/a%5Eb"],
  ["https://example.org/a?x=^b", "https://example.org/a?x=%5Eb"],
  ["https://example.org/a#x^b", "https://example.org/a#x%5Eb"],
  ["https://user^name@example.org/a", "https://user%5Ename@example.org/a"],
  ["https://exa^mple.org/a", undefined],
  ["https://example.org/a`b", "https://example.org/a%60b"],
  ["https://example.org/a?x=`b", "https://example.org/a?x=%60b"],
  ["https://example.org/a#x`b", "https://example.org/a#x%60b"],
  ["https://user`name@example.org/a", "https://user%60name@example.org/a"],
  ["https://exa`mple.org/a", "https://exa%60mple.org/a"],
] as const;

// Shared acceptances that must retain the legacy rejection after migration.
const compatibilityRejections: readonly string[] = [
  'https://exa"mple.org/a',
  "https://example.org/a?x={b",
  "https://example.org/a#x{b",
  "https://exa{mple.org/a",
  "https://example.org/a?x=}b",
  "https://example.org/a#x}b",
  "https://exa}mple.org/a",
  "https://example.org/a?x=\\b",
  "https://example.org/a#x\\b",
];

describe("IRI guard differential against rdf-serialize", () => {
  it("adopts shared behavior without accepting any legacy rejection", () => {
    for (const [value, legacy] of legacyHttpCases) {
      expect(safeHttpIri(value), JSON.stringify(value)).toBe(
        legacy === undefined ? undefined : sharedSafeHttpIri(value),
      );
      const shared = sharedSafeHttpIri(value);
      if (shared !== undefined && legacy === undefined) {
        expect(compatibilityRejections).toContain(value);
      }
    }
  });
});
