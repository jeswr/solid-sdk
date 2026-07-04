// AUTHORED-BY Claude Fable 5
/**
 * Unit tests for the untrusted-IRI hardening (`safeHttpIri` / `isWithinBase` /
 * `sanitizeText`) — the guard that stops an untrusted string breaking out of a
 * Turtle `<...>` and injecting triples, and stops a write escaping the container.
 */

import { describe, expect, it } from "vitest";
import { canonicalContainer, isWithinBase, safeHttpIri, sanitizeText } from "./safe-iri.js";

const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const DEL = String.fromCharCode(127);

describe("safeHttpIri", () => {
  it("accepts a plain http(s) IRI and returns its canonical form", () => {
    expect(safeHttpIri("https://alice.pod.example/profile/card#me")).toBe(
      "https://alice.pod.example/profile/card#me",
    );
    expect(safeHttpIri("http://x.example/a")).toBe("http://x.example/a");
  });

  it("canonicalises an origin-only URL with the trailing slash", () => {
    expect(safeHttpIri("https://matrix.example.org")).toBe("https://matrix.example.org/");
  });

  it("rejects non-http(s) schemes and non-strings", () => {
    expect(safeHttpIri("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpIri("mailto:a@b.c")).toBeUndefined();
    expect(safeHttpIri("urn:x:y")).toBeUndefined();
    expect(safeHttpIri("not a url")).toBeUndefined();
    expect(safeHttpIri("")).toBeUndefined();
    expect(safeHttpIri(undefined)).toBeUndefined();
    expect(safeHttpIri(null)).toBeUndefined();
    expect(safeHttpIri(42)).toBeUndefined();
    expect(safeHttpIri({})).toBeUndefined();
  });

  it("NEUTRALISES a `>` breakout — the returned value contains no raw angle bracket", () => {
    const evil =
      "https://evil.example/a> <http://x/p> <http://x/o> .\n<http://s> <http://p> <http://o";
    const out = safeHttpIri(evil);
    expect(out).toBeDefined();
    expect(out).not.toContain(">");
    expect(out).not.toContain("<");
    expect(out).not.toContain("\n");
    // The breakout chars are percent-encoded, not present raw.
    expect(out).toContain("%3E");
  });

  it("percent-encodes the URL-parser residue `|`, `^` and backtick", () => {
    const out = safeHttpIri("https://x.example/a|b^c`d");
    expect(out).toBeDefined();
    expect(out).not.toContain("|");
    expect(out).not.toContain("^");
    expect(out).not.toContain("`");
    expect(out).toContain("%7C");
    expect(out).toContain("%5E");
    expect(out).toContain("%60");
  });

  it("contains no IRIREF-forbidden character for any accepted value", () => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the C0 range is absent is the point.
    const forbidden = /[\u0000-\u0020<>"{}|\\^`]/;
    for (const v of [
      "https://x.example/normal",
      `https://x.example/${NUL}${ESC}${BEL}`,
      "https://x.example/a>b<c|d^e`f",
      "https://x.example/a b",
    ]) {
      const out = safeHttpIri(v);
      if (out !== undefined) expect(forbidden.test(out)).toBe(false);
    }
  });
});

describe("canonicalContainer", () => {
  it("accepts a clean container and returns origin+path (no query/fragment)", () => {
    expect(canonicalContainer("https://alice.pod.example/chat/matrix/")).toBe(
      "https://alice.pod.example/chat/matrix/",
    );
  });

  it("REJECTS a container carrying a query (`?x=/` deceptively ends in '/')", () => {
    // `${container}.acl` would resolve to `chat/?x=/.acl`, a decoy — not the real ACL.
    expect(canonicalContainer("https://alice.pod.example/chat/?x=/")).toBeUndefined();
  });

  it("REJECTS a container carrying a fragment (`#frag/`)", () => {
    expect(canonicalContainer("https://alice.pod.example/chat/#frag/")).toBeUndefined();
  });

  it("REJECTS a path that does not end in '/'", () => {
    expect(canonicalContainer("https://alice.pod.example/chat")).toBeUndefined();
  });

  it("REJECTS a non-http(s) container", () => {
    expect(canonicalContainer("ftp://x.example/c/")).toBeUndefined();
    expect(canonicalContainer("not a url")).toBeUndefined();
    expect(canonicalContainer(undefined)).toBeUndefined();
  });

  it("NEUTRALISES an injection char in the path (canonicalises, still a container)", () => {
    const out = canonicalContainer("https://alice.pod.example/a>x/");
    expect(out).toBe("https://alice.pod.example/a%3Ex/");
    expect(out?.endsWith("/")).toBe(true);
  });

  it("REJECTS a container path carrying an encoded path delimiter (%2F/%5C)", () => {
    // `@jeswr/guarded-fetch`'s `normalizePodBase` (delegated to from `isWithinBase`)
    // refuses a base whose pathname contains an encoded `/` or `\` — so accepting
    // such a container here would let `importRoom()` write its ACL and then have
    // EVERY subsequent per-message `isWithinBase` scope check reject the base
    // outright, silently dropping every message as out-of-scope. Reject up front
    // instead, matching the delegated guard exactly (case-insensitive).
    expect(canonicalContainer("https://alice.pod.example/chat%2Fevil/")).toBeUndefined();
    expect(canonicalContainer("https://alice.pod.example/chat%2fevil/")).toBeUndefined();
    expect(canonicalContainer("https://alice.pod.example/chat%5Cevil/")).toBeUndefined();
    expect(canonicalContainer("https://alice.pod.example/chat%5cevil/")).toBeUndefined();
  });
});

describe("isWithinBase", () => {
  const base = "https://alice.pod.example/chat/matrix/";

  it("accepts a resource strictly under the container", () => {
    expect(isWithinBase("https://alice.pod.example/chat/matrix/m-x.ttl", base)).toBe(true);
    expect(isWithinBase("https://alice.pod.example/chat/matrix/sub/m-y.ttl", base)).toBe(true);
  });

  it("rejects the container itself (must be a strict descendant)", () => {
    expect(isWithinBase(base, base)).toBe(false);
  });

  it("rejects a sibling-prefix path that is not actually inside the container", () => {
    // `/chat/matrix-evil/` shares the string prefix `/chat/matrix` but is NOT inside
    // `/chat/matrix/` — the trailing-slash boundary check must reject it.
    expect(isWithinBase("https://alice.pod.example/chat/matrix-evil/x.ttl", base)).toBe(false);
  });

  it("rejects a cross-origin resource", () => {
    expect(isWithinBase("https://attacker.example/chat/matrix/x.ttl", base)).toBe(false);
  });

  it("rejects a `..`-escaping / unsafe resource", () => {
    expect(isWithinBase("https://alice.pod.example/chat/matrix/../secret.ttl", base)).toBe(false);
    expect(isWithinBase("javascript:alert(1)", base)).toBe(false);
  });
});

describe("sanitizeText", () => {
  it("strips NUL, ESC, BEL and DEL", () => {
    expect(sanitizeText(`a${NUL}b${ESC}c${BEL}d${DEL}e`)).toBe("abcde");
  });

  it("keeps legitimate whitespace (tab, newline, CR)", () => {
    expect(sanitizeText("line1\n\tline2\r\nline3")).toBe("line1\n\tline2\r\nline3");
  });

  it("leaves clean text unchanged", () => {
    expect(sanitizeText("Hello, world!")).toBe("Hello, world!");
  });
});
