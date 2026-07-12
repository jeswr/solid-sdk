// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { docOf, httpIriOrUndefined, isHttpIri } from "./iri.js";

describe("isHttpIri — canonical-consistent boolean guard", () => {
  it("accepts absolute http(s) URLs that are ALREADY canonical", () => {
    expect(isHttpIri("https://example.org/a")).toBe(true);
    expect(isHttpIri("http://example.org/")).toBe(true); // trailing slash = canonical
    expect(isHttpIri("https://example.org/p?q=1#f")).toBe(true);
    // Preserves the existing accepted shapes (was in task.test.ts helpers).
    expect(isHttpIri("http://x/y")).toBe(true);
    expect(isHttpIri("https://x/y#me")).toBe(true);
  });

  it("rejects non-http(s) schemes, relative refs, and empties", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "mailto:a@b.c",
      "urn:uuid:1",
      "urn:x",
      "javascript:1",
      "/relative/path",
      "not a url",
      "",
      undefined,
    ]) {
      expect(isHttpIri(bad)).toBe(false);
    }
  });

  it("rejects NON-canonical http(s) strings (the guard agrees with httpIriOrUndefined)", () => {
    // These parse but normalize, so the RAW string is not a well-formed IRI to
    // write verbatim — the guard must say false (lock-step with the value filter).
    for (const noncanonical of [
      "http://example.org",
      "  https://example.org/a  ", // leading + trailing whitespace
      "https://x.org\n", // trailing newline
      "\thttps://x.org/a", // leading tab (internal-to-input whitespace)
    ]) {
      expect(isHttpIri(noncanonical)).toBe(false);
      // ...but httpIriOrUndefined still yields the usable normalized value.
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
    // new URL() strips leading/trailing C0-control+space and some tab/newline,
    // so the RAW string contains chars illegal inside an RDF IRI. The filter must
    // return the normalized href, not the raw input (the roborev finding ported
    // from @jeswr/solid-bookmark).
    expect(httpIriOrUndefined("  https://example.org/a  ")).toBe("https://example.org/a");
    expect(httpIriOrUndefined("https://example.org/a\n")).toBe("https://example.org/a");
    expect(httpIriOrUndefined("\thttps://example.org")).toBe("https://example.org/");
    // No returned value ever contains whitespace.
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

describe("docOf — strips the fragment to the document URL", () => {
  it("drops the #fragment of an absolute IRI", () => {
    expect(docOf("https://example.org/doc#this")).toBe("https://example.org/doc");
    expect(docOf("https://example.org/doc#it")).toBe("https://example.org/doc");
  });

  it("leaves a fragmentless IRI unchanged (modulo WHATWG canonicalization)", () => {
    expect(docOf("https://example.org/doc")).toBe("https://example.org/doc");
  });

  it("throws on a non-parseable IRI (programmer error, not untrusted input)", () => {
    expect(() => docOf("not a url")).toThrow();
  });
});
