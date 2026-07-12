// AUTHORED-BY Claude Fable 5
//
// Regression test for the n3.Writer IRI-injection class: n3.Writer does NOT escape
// the contents of an IRI, so an untrusted string containing `> . <s> <p> <o` handed
// to a NamedNode and serialised would BREAK OUT of the `<...>` and inject arbitrary
// triples. The guards in src/iri.ts (escapeIri for subjects/ids, safeHttpIri for
// http(s) object fields) must make that impossible while leaving legitimate ids
// (incl. `urn:`) intact.

import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import { intentToTurtle } from "../src/intent.js";
import { escapeIri, safeHttpIri } from "../src/iri.js";
import type { Intent } from "../src/types.js";

/** The classic breakout payload: close the `<...>`, then assert 3 attacker triples. */
const INJECTION_TARGET = "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";

/** Parse Turtle to quads (via n3's real parser — the same one a consumer round-trips with). */
function parseTurtle(ttl: string) {
  return new Parser().parse(ttl);
}

describe("IRI injection via n3.Writer (regression)", () => {
  it("does not inject triples when a malicious target breaks out of an IRI", async () => {
    const intent: Intent = {
      id: "urn:a2a:intent:legit",
      action: "read",
      target: INJECTION_TARGET,
    };
    const ttl = await intentToTurtle(intent);
    const quads = parseTurtle(ttl);

    // The attacker's injected subject must NOT appear anywhere in the parsed graph.
    const injected = quads.filter(
      (q) =>
        q.subject.value === "https://evil/s2" ||
        q.predicate.value === "https://evil/p2" ||
        q.object.value === "https://evil/o2",
    );
    expect(injected).toHaveLength(0);

    // A non-http(s) breakout payload as the target is DROPPED entirely (not http),
    // but even if a value survived it must be a single, escaped object term — never
    // an IRI whose value carries the raw `>` breakout character.
    for (const q of quads) {
      expect(q.subject.value).not.toContain(">");
      expect(q.subject.value).not.toContain(" ");
      expect(q.predicate.value).not.toContain(">");
      expect(q.object.value).not.toContain(">");
      expect(q.object.value).not.toContain(" ");
    }
  });

  it("does not inject triples when a malicious http(s) agent breaks out of an IRI", async () => {
    // A breakout payload that IS an http(s) URL (so it survives the http(s) filter as
    // one normalised, percent-encoded object) must still not produce injected triples.
    const intent: Intent = {
      id: "urn:a2a:intent:legit2",
      action: "read",
      target: "https://alice.pod/notes.ttl",
      agent: INJECTION_TARGET,
    };
    const ttl = await intentToTurtle(intent);
    const quads = parseTurtle(ttl);

    const injected = quads.filter(
      (q) =>
        q.subject.value === "https://evil/s2" ||
        q.predicate.value === "https://evil/p2" ||
        q.object.value === "https://evil/o2",
    );
    expect(injected).toHaveLength(0);

    // The agent survives as object term(s) (http scheme) — one on the intent node and
    // one on the action node — with the breakout chars percent-encoded, never emitted
    // verbatim. (The point is NO injected triple, not the exact agent count.)
    const agentQuads = quads.filter((q) => q.predicate.value === "https://schema.org/agent");
    expect(agentQuads.length).toBeGreaterThan(0);
    for (const q of agentQuads) {
      expect(q.object.value).not.toContain(">");
      expect(q.object.value).not.toContain(" ");
    }
  });

  it("round-trips a legitimate urn: intent id unchanged", async () => {
    const id = "urn:a2a:intent:abc-123_x";
    const intent: Intent = { id, action: "read", target: "https://alice.pod/notes.ttl" };
    const ttl = await intentToTurtle(intent);
    const quads = parseTurtle(ttl);

    // The intent subject IRI is preserved byte-for-byte (escapeIri is a no-op on a
    // valid urn: id — no scheme restriction, no forbidden chars to encode).
    const subjects = new Set(quads.map((q) => q.subject.value));
    expect(subjects.has(id)).toBe(true);
  });

  describe("escapeIri / safeHttpIri units", () => {
    it("escapeIri neutralises every Turtle IRIREF-forbidden char but preserves valid ids", () => {
      expect(escapeIri("urn:a2a:intent:abc")).toBe("urn:a2a:intent:abc");
      expect(escapeIri("https://a/b#frag")).toBe("https://a/b#frag");
      // `>` `<` `"` space `{` `}` `|` `^` backtick `\` -> percent-encoded.
      expect(escapeIri("a>b")).toBe("a%3Eb");
      expect(escapeIri("a b")).toBe("a%20b");
      expect(escapeIri("a<b")).toBe("a%3Cb");
      expect(escapeIri('a"b')).toBe("a%22b");
      expect(escapeIri("a`b")).toBe("a%60b");
      expect(escapeIri("a|b")).toBe("a%7Cb");
      expect(escapeIri("a^b")).toBe("a%5Eb");
      expect(escapeIri("a\\b")).toBe("a%5Cb");
      expect(escapeIri("a{b}c")).toBe("a%7Bb%7Dc");
    });

    it("safeHttpIri accepts http(s), rejects other schemes and malformed input", () => {
      expect(safeHttpIri("https://a/x")).toBe("https://a/x");
      expect(safeHttpIri("http://a/x")).toBe("http://a/x");
      expect(safeHttpIri("urn:x")).toBeUndefined();
      expect(safeHttpIri("javascript:alert(1)")).toBeUndefined();
      expect(safeHttpIri("mailto:a@b.c")).toBeUndefined();
      expect(safeHttpIri("not a url")).toBeUndefined();
      expect(safeHttpIri(undefined)).toBeUndefined();
      // A breakout payload that parses as http survives only as an escaped href.
      const safe = safeHttpIri(INJECTION_TARGET);
      expect(safe).toBeDefined();
      expect(safe).not.toContain(">");
      expect(safe).not.toContain(" ");
    });
  });
});
