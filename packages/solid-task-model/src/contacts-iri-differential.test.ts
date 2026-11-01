// AUTHORED-BY Codex GPT-6.1-Sol
import { escapeIri } from "@jeswr/rdf-serialize";
import { describe, expect, it } from "vitest";
import { buildPerson, parsePerson } from "./contacts.js";

// Frozen outputs of contacts.ts's private escapeIri at 0d884208.
const legacyEscapeCases = [
  ["", ""],
  ["https://example.org/a", "https://example.org/a"],
  ["http://example.org", "http://example.org"],
  ["HTTPS://EXAMPLE.org:443/a/../b", "HTTPS://EXAMPLE.org:443/a/../b"],
  ["https://EXAMPLE.org:443", "https://EXAMPLE.org:443"],
  ["https://example.org/%2e%2e/a", "https://example.org/%2e%2e/a"],
  ["https://example.org/a%2Fb%5Cc%3Ed", "https://example.org/a%2Fb%5Cc%3Ed"],
  ["https://example.org/%", "https://example.org/%"],
  ["https://example.org/%zz", "https://example.org/%zz"],
  ["https://bücher.example/日本語/🎨", "https://bücher.example/日本語/🎨"],
  ["https://xn--bcher-kva.example/", "https://xn--bcher-kva.example/"],
  ["https://user:pass@example.org/a", "https://user:pass@example.org/a"],
  ["https://user%40name:p%3Ass@example.org/a", "https://user%40name:p%3Ass@example.org/a"],
  ["https://user@evil.example@example.org/a", "https://user@evil.example@example.org/a"],
  ["https://[::1]/a", "https://[::1]/a"],
  ["https://example.org:65536/a", "https://example.org:65536/a"],
  ["https://%65xample.org/a", "https://%65xample.org/a"],
  ["javascript:alert(1)", "javascript:alert(1)"],
  ["data:text/plain,x", "data:text/plain,x"],
  ["file:///tmp/a", "file:///tmp/a"],
  ["ftp://example.org/a", "ftp://example.org/a"],
  ["mailto:a@example.org", "mailto:a@example.org"],
  ["tel:+123456789", "tel:+123456789"],
  ["urn:example:record:1", "urn:example:record:1"],
  ["did:example:123", "did:example:123"],
  ["/relative/path", "/relative/path"],
  ["relative/path", "relative/path"],
  ["//example.org/a", "//example.org/a"],
  ["#fragment", "#fragment"],
  ["?query", "?query"],
  ["https:example.org", "https:example.org"],
  ["https:/example.org", "https:/example.org"],
  ["https:///example.org", "https:///example.org"],
  ["http:////example.org", "http:////example.org"],
  ["https://?x", "https://?x"],
  ["https://", "https://"],
  ["https://example.org/a\\b", "https://example.org/a%5Cb"],
  ["https:\\example.org\\a", "https:%5Cexample.org%5Ca"],
  ["https://exa\tmple.org/a", "https://exa%09mple.org/a"],
  ["https://example.org/a\tb", "https://example.org/a%09b"],
  ["https://example.org/a\nb", "https://example.org/a%0Ab"],
  ["https://example.org/a\rb", "https://example.org/a%0Db"],
  [" https://example.org/a", "%20https://example.org/a"],
  ["https://example.org/a ", "https://example.org/a%20"],
  ["\u0000https://example.org/a", "%00https://example.org/a"],
  ["https://example.org/a\u001f", "https://example.org/a%1F"],
  [
    "https://example.org/a> . <https://evil.example/s> <https://evil.example/p> <https://evil.example/o",
    "https://example.org/a%3E%20.%20%3Chttps://evil.example/s%3E%20%3Chttps://evil.example/p%3E%20%3Chttps://evil.example/o",
  ],
  ["https://example.org/a?x=one two#three four", "https://example.org/a?x=one%20two#three%20four"],
  [
    "https://example.org/a\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f b",
    "https://example.org/a%00%01%02%03%04%05%06%07%08%09%0A%0B%0C%0D%0E%0F%10%11%12%13%14%15%16%17%18%19%1A%1B%1C%1D%1E%1F%20b",
  ],
  [
    "\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f https://example.org/a",
    "%00%01%02%03%04%05%06%07%08%09%0A%0B%0C%0D%0E%0F%10%11%12%13%14%15%16%17%18%19%1A%1B%1C%1D%1E%1F%20https://example.org/a",
  ],
  [
    "https://example.org/a\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f ",
    "https://example.org/a%00%01%02%03%04%05%06%07%08%09%0A%0B%0C%0D%0E%0F%10%11%12%13%14%15%16%17%18%19%1A%1B%1C%1D%1E%1F%20",
  ],
  ["https://example.org/a<b", "https://example.org/a%3Cb"],
  ["https://example.org/a?x=<b", "https://example.org/a?x=%3Cb"],
  ["https://example.org/a#x<b", "https://example.org/a#x%3Cb"],
  ["https://user<name@example.org/a", "https://user%3Cname@example.org/a"],
  ["https://exa<mple.org/a", "https://exa%3Cmple.org/a"],
  ["https://example.org/a>b", "https://example.org/a%3Eb"],
  ["https://example.org/a?x=>b", "https://example.org/a?x=%3Eb"],
  ["https://example.org/a#x>b", "https://example.org/a#x%3Eb"],
  ["https://user>name@example.org/a", "https://user%3Ename@example.org/a"],
  ["https://exa>mple.org/a", "https://exa%3Emple.org/a"],
  ['https://example.org/a"b', "https://example.org/a%22b"],
  ['https://example.org/a?x="b', "https://example.org/a?x=%22b"],
  ['https://example.org/a#x"b', "https://example.org/a#x%22b"],
  ['https://user"name@example.org/a', "https://user%22name@example.org/a"],
  ['https://exa"mple.org/a', "https://exa%22mple.org/a"],
  ["https://example.org/a{b", "https://example.org/a%7Bb"],
  ["https://example.org/a?x={b", "https://example.org/a?x=%7Bb"],
  ["https://example.org/a#x{b", "https://example.org/a#x%7Bb"],
  ["https://user{name@example.org/a", "https://user%7Bname@example.org/a"],
  ["https://exa{mple.org/a", "https://exa%7Bmple.org/a"],
  ["https://example.org/a}b", "https://example.org/a%7Db"],
  ["https://example.org/a?x=}b", "https://example.org/a?x=%7Db"],
  ["https://example.org/a#x}b", "https://example.org/a#x%7Db"],
  ["https://user}name@example.org/a", "https://user%7Dname@example.org/a"],
  ["https://exa}mple.org/a", "https://exa%7Dmple.org/a"],
  ["https://example.org/a|b", "https://example.org/a%7Cb"],
  ["https://example.org/a?x=|b", "https://example.org/a?x=%7Cb"],
  ["https://example.org/a#x|b", "https://example.org/a#x%7Cb"],
  ["https://user|name@example.org/a", "https://user%7Cname@example.org/a"],
  ["https://exa|mple.org/a", "https://exa%7Cmple.org/a"],
  ["https://example.org/a\\b", "https://example.org/a%5Cb"],
  ["https://example.org/a?x=\\b", "https://example.org/a?x=%5Cb"],
  ["https://example.org/a#x\\b", "https://example.org/a#x%5Cb"],
  ["https://user\\name@example.org/a", "https://user%5Cname@example.org/a"],
  ["https://exa\\mple.org/a", "https://exa%5Cmple.org/a"],
  ["https://example.org/a^b", "https://example.org/a%5Eb"],
  ["https://example.org/a?x=^b", "https://example.org/a?x=%5Eb"],
  ["https://example.org/a#x^b", "https://example.org/a#x%5Eb"],
  ["https://user^name@example.org/a", "https://user%5Ename@example.org/a"],
  ["https://exa^mple.org/a", "https://exa%5Emple.org/a"],
  ["https://example.org/a`b", "https://example.org/a%60b"],
  ["https://example.org/a?x=`b", "https://example.org/a?x=%60b"],
  ["https://example.org/a#x`b", "https://example.org/a#x%60b"],
  ["https://user`name@example.org/a", "https://user%60name@example.org/a"],
  ["https://exa`mple.org/a", "https://exa%60mple.org/a"],
] as const;

describe("contacts IRI escaper differential against rdf-serialize", () => {
  it("preserves every old lexical escape through the public contact API", () => {
    const person = "https://pod.example/contacts/person.ttl";
    for (const [value, legacy] of legacyEscapeCases) {
      expect(escapeIri(value), JSON.stringify(value)).toBe(legacy);
      // Prefix a nonempty atom so even empty / line-break inputs pass the existing
      // mailto/tel shape checks, exercising the private escape through typed accessors.
      const store = buildPerson(person, {
        name: "Fixture",
        emails: [`mailto:x${value}`],
        phones: [`tel:x${value}`],
      });
      const parsed = parsePerson(person, store);
      expect(parsed?.emails).toEqual([`mailto:x${legacy}`]);
      expect(parsed?.phones).toEqual([`tel:x${legacy}`]);
    }
  });
});
