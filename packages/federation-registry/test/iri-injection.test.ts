// AUTHORED-BY Claude Fable 5
//
// Regression tests for the n3.Writer IRI-injection class: an untrusted string
// flowing into a NamedNode must NOT be able to break out of the `<…>` delimiters
// and inject extra triples on serialise. We build a registry / storage graph via
// the PUBLIC API with a hostile IRI, serialise it, re-parse the Turtle with the
// n3 Parser, and assert the smuggled triples never materialise.

import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import { escapeIri, safeHttpIri } from "../src/iri.js";
import { buildRegistry } from "../src/registry.js";
import { describeStorage } from "../src/storage.js";
import { AUTHORITY, REGISTRY_NS } from "./fixtures.js";

// A payload that closes the `<…>` of the intended object IRI and appends two
// fully-formed triples: `<https://evil/s2> <https://evil/p2> <https://evil/o2>`.
const INJECTION = "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";

/** Parse Turtle and return every quad. */
function parseTurtle(turtle: string) {
  return new Parser().parse(turtle);
}

/** Assert the smuggled subject/predicate never appear as real terms. */
function assertNoInjection(turtle: string): void {
  const quads = parseTurtle(turtle);
  const injectedSubject = quads.some((q) => q.subject.value === "https://evil/s2");
  const injectedPredicate = quads.some((q) => q.predicate.value === "https://evil/p2");
  expect(injectedSubject).toBe(false);
  expect(injectedPredicate).toBe(false);
}

describe("IRI-injection hardening (n3.Writer emits IRIs verbatim)", () => {
  it("does not let a membership app IRI inject triples", async () => {
    const built = buildRegistry({
      id: REGISTRY_NS,
      members: [{ id: `${REGISTRY_NS}#m-evil`, app: INJECTION, assertedBy: AUTHORITY }],
    });
    const turtle = await built.toString();
    // The serialised document must still parse (no broken-out `<…>` corrupting it)…
    expect(() => parseTurtle(turtle)).not.toThrow();
    // …and the smuggled triples must be absent.
    assertNoInjection(turtle);
  });

  it("does not let a membership assertedBy IRI inject triples", async () => {
    const built = buildRegistry({
      id: REGISTRY_NS,
      members: [{ id: `${REGISTRY_NS}#m-evil`, app: `${REGISTRY_NS}#app`, assertedBy: INJECTION }],
    });
    assertNoInjection(await built.toString());
  });

  it("does not let a StorageDescription acceptsSpec IRI inject triples", async () => {
    const built = describeStorage({
      id: "https://alice.pod.example/",
      acceptsSpec: [INJECTION],
    });
    const turtle = await built.toString();
    expect(() => parseTurtle(turtle)).not.toThrow();
    assertNoInjection(turtle);
  });

  it("does not let a hostile registry/membership subject id inject triples", async () => {
    const built = buildRegistry({
      id: INJECTION,
      members: [{ id: INJECTION, app: `${REGISTRY_NS}#app`, assertedBy: AUTHORITY }],
    });
    assertNoInjection(await built.toString());
  });

  describe("safeHttpIri", () => {
    it("returns undefined for non-http(s) or unparseable input", () => {
      expect(safeHttpIri(undefined)).toBeUndefined();
      expect(safeHttpIri("not a url")).toBeUndefined();
      expect(safeHttpIri("urn:example:1")).toBeUndefined();
      expect(safeHttpIri("javascript:alert(1)")).toBeUndefined();
    });

    it("percent-encodes the IRIREF chars the URL parser leaves intact", () => {
      const out = safeHttpIri("https://e.example/p|a^b`c");
      expect(out).toBe("https://e.example/p%7Ca%5Eb%60c");
    });

    it("round-trips a clean http(s) IRI's href", () => {
      expect(safeHttpIri("https://music.example/clientid.jsonld")).toBe(
        "https://music.example/clientid.jsonld",
      );
    });
  });

  describe("escapeIri", () => {
    it("percent-encodes every IRIREF-forbidden character", () => {
      expect(escapeIri('a> <b" {c}|^`\\d')).toBe("a%3E%20%3Cb%22%20%7Bc%7D%7C%5E%60%5Cd");
    });

    it("leaves a well-formed (incl. non-http) IRI unchanged", () => {
      expect(escapeIri("urn:example:record:1")).toBe("urn:example:record:1");
      expect(escapeIri("https://registry.example/federation#m1")).toBe(
        "https://registry.example/federation#m1",
      );
    });
  });
});
