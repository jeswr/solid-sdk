// AUTHORED-BY Claude Opus 4.8
// PARITY: @jeswr/solid-bookmark's src/iri.test.ts, VERBATIM except the IRI filters
// are imported from the facade (which re-exports them from @jeswr/model-runtime's
// guard inventory) rather than the hand-written package.
import { describe, expect, it } from "vitest";
import { httpIriOrUndefined, isHttpIri } from "../../examples/bookmark/facade.js";

describe("isHttpIri — canonical-consistent boolean guard", () => {
  it("accepts absolute http(s) URLs that are ALREADY canonical", () => {
    expect(isHttpIri("https://example.org/a")).toBe(true);
    expect(isHttpIri("http://example.org/")).toBe(true); // trailing slash = canonical
    expect(isHttpIri("https://example.org/p?q=1#f")).toBe(true);
  });

  it("rejects non-http(s) schemes, relative refs, and empties", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "mailto:a@b.c",
      "urn:uuid:1",
      "/relative/path",
      "not a url",
      "",
      undefined,
    ]) {
      expect(isHttpIri(bad)).toBe(false);
    }
  });

  it("rejects NON-canonical http(s) strings (the guard agrees with httpIriOrUndefined)", () => {
    for (const noncanonical of [
      "http://example.org",
      "  https://example.org/a  ",
      "https://x.org\n",
    ]) {
      expect(isHttpIri(noncanonical)).toBe(false);
      expect(httpIriOrUndefined(noncanonical)).toBeDefined();
    }
  });

  it("isHttpIri(v) === (httpIriOrUndefined(v) === v) — the lock-step invariant", () => {
    for (const v of [
      "https://example.org/a",
      "http://example.org",
      "  https://x.org ",
      "javascript:1",
      "",
    ]) {
      expect(isHttpIri(v)).toBe(httpIriOrUndefined(v) === v);
    }
  });
});

describe("httpIriOrUndefined — returns the CANONICAL href (whitespace/control hardening)", () => {
  it("returns the value for a clean http(s) URL", () => {
    expect(httpIriOrUndefined("https://example.org/a")).toBe("https://example.org/a");
  });

  it("NORMALIZES whitespace/control noise WHATWG URL tolerates, never writing it through", () => {
    expect(httpIriOrUndefined("  https://example.org/a  ")).toBe("https://example.org/a");
    expect(httpIriOrUndefined("https://example.org/a\n")).toBe("https://example.org/a");
    expect(httpIriOrUndefined("\thttps://example.org")).toBe("https://example.org/");
    for (const v of ["  https://x.org ", "https://x.org\t", "\nhttps://x.org\n"]) {
      const out = httpIriOrUndefined(v);
      expect(out).toBeDefined();
      expect(out).not.toMatch(/\s/);
    }
  });

  it("returns undefined for non-http(s) / invalid input", () => {
    for (const bad of ["javascript:alert(1)", "urn:uuid:1", "nope", "", undefined]) {
      expect(httpIriOrUndefined(bad)).toBeUndefined();
    }
  });
});
