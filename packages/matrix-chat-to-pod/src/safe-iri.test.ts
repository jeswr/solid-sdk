// AUTHORED-BY Claude Fable 5
/**
 * Unit tests for the REPO-SPECIFIC untrusted-input hardening in this package —
 * {@link canonicalContainer} (the owner-lockable container ACL anchor),
 * {@link isWithinBase} (the strict-descendant write-scope check), and
 * {@link sanitizeText} (the chat-body control-char stripper).
 *
 * The generic IRI-injection guard `safeHttpIri` is NO LONGER implemented here — it
 * moved to the audited suite home `@jeswr/rdf-serialize` and is exhaustively tested
 * THERE (this package re-exports it). These tests cover only what this package
 * composes on top of it; the end-to-end injection-safety proof (a hostile IRI in a
 * Matrix event cannot break out of the serialized Turtle) lives in `security.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { canonicalContainer, isWithinBase, safeHttpIri, sanitizeText } from "./safe-iri.js";

const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const DEL = String.fromCharCode(127);

// Boundary smoke test for the RE-EXPORT: this package depends on the exact
// security contract of `safeHttpIri` at every IRI write-path call site
// (webId / room / reply / edit target / ACL owner), so pin that the symbol
// re-exported from `./safe-iri.js` still resolves to the http(s)-only,
// injection-escaping guard — a mis-wired re-export (e.g. to the scheme-agnostic
// `safeIri`, or a dropped import) would be caught here rather than in prod. The
// exhaustive cases live in `@jeswr/rdf-serialize`'s own suite; this is a guard
// against a wiring regression in THIS package.
describe("safeHttpIri (re-export contract smoke test)", () => {
  it("keeps a clean http(s) IRI usable", () => {
    expect(safeHttpIri("https://alice.pod.example/profile#me")).toBe(
      "https://alice.pod.example/profile#me",
    );
  });

  it("drops non-http(s) schemes (never widened to a scheme-agnostic guard)", () => {
    expect(safeHttpIri("mailto:alice@example.com")).toBeUndefined();
    expect(safeHttpIri("urn:uuid:1234")).toBeUndefined();
    // biome-ignore lint/suspicious/noExplicitAny: exercising the untrusted `unknown` input path.
    expect(safeHttpIri("javascript:alert(1)" as any)).toBeUndefined();
  });

  it("neutralises a Turtle-IRIREF breakout payload (the `>` cannot survive)", () => {
    const hostile = "http://evil.example/o> . <http://victim.example/s> <http://p> <http://o";
    const safe = safeHttpIri(hostile);
    expect(safe).toBeDefined();
    expect(safe).not.toContain(">");
    expect(safe).not.toContain(" ");
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
