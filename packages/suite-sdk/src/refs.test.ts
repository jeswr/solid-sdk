// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  decodeIdentifierRef,
  decodeRef,
  encodeIdentifierRef,
  encodeRef,
  RefError,
} from "./refs.js";

/** Deterministic PRNG so the property test is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const alphabet = ["a", "Z", "0", "-", "_", ".", "~", "é", "ü", "日", "😀", " ", "%", "+", "=", "?"];

function randomUrl(next: () => number): string {
  const pick = () => alphabet[Math.floor(next() * alphabet.length)];
  const segment = () => Array.from({ length: 1 + Math.floor(next() * 8) }, pick).join("");
  const scheme = next() < 0.5 ? "https" : "http";
  const port = next() < 0.2 ? `:${1 + Math.floor(next() * 65534)}` : "";
  const path = Array.from({ length: Math.floor(next() * 4) }, segment).join("/");
  const query = next() < 0.3 ? `?q=${segment()}` : "";
  const fragment = next() < 0.3 ? `#${segment()}` : "";
  return `${scheme}://pod${Math.floor(next() * 100)}.example${port}/${path}${query}${fragment}`;
}

describe("encodeRef / decodeRef", () => {
  it("round-trips the normalised form of random http(s) URLs", () => {
    const next = mulberry32(0x5eed);
    for (let i = 0; i < 500; i++) {
      const url = randomUrl(next);
      const ref = encodeRef(url);
      expect(ref).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeRef(ref)).toBe(new URL(url).href);
      expect(encodeRef(decodeRef(ref))).toBe(ref);
    }
  });

  it("matches the encoding apps already link with", () => {
    expect(encodeRef("https://alice.pod/docs/a b")).toBe("aHR0cHM6Ly9hbGljZS5wb2QvZG9jcy9hJTIwYg");
  });

  it.each([
    "mailto:alice@example.org",
    "ftp://example.org/file",
    "file:///etc/passwd",
    "urn:x:y",
  ])("refuses to encode %s", (url) => {
    expect(() => encodeRef(url)).toThrow(TypeError);
  });

  it("refuses to encode a relative URL", () => {
    expect(() => encodeRef("/drive")).toThrow(TypeError);
  });

  it.each([
    ["non-http scheme", btoa("javascript:alert(1)").replace(/=+$/, "")],
    ["non-base64url characters", "aHR0cHM6Ly9h+bGljZQ=="],
    ["empty", ""],
    ["invalid UTF-8", btoa(String.fromCharCode(0xff, 0xfe)).replace(/=+$/, "")],
    ["not a URL", btoa("hello world").replace(/=+$/, "")],
    ["non-canonical URL", btoa("HTTPS://Alice.Pod/x").replace(/=+$/, "")],
    ["bad padding length", "a"],
  ])("rejects %s with RefError", (_label, ref) => {
    let caught: unknown;
    try {
      decodeRef(ref);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RefError);
    expect((caught as RefError).ref).toBe(ref);
    expect((caught as RefError).name).toBe("RefError");
  });
});

describe("encodeIdentifierRef / decodeIdentifierRef", () => {
  it("keeps the IRI exactly as written", () => {
    const iri = "https://alice.pod/chat#naïve";
    expect(decodeIdentifierRef(encodeIdentifierRef(iri))).toBe(iri);
    expect(decodeRef(encodeRef(iri))).not.toBe(iri);
  });

  it("round-trips random http(s) IRIs verbatim", () => {
    const next = mulberry32(0xc0ffee);
    for (let i = 0; i < 200; i++) {
      const iri = randomUrl(next);
      expect(decodeIdentifierRef(encodeIdentifierRef(iri))).toBe(iri);
    }
  });

  it("refuses non-http identifiers both ways", () => {
    expect(() => encodeIdentifierRef("urn:uuid:1")).toThrow(TypeError);
    expect(() => decodeIdentifierRef(btoa("urn:uuid:1").replace(/=+$/, ""))).toThrow(RefError);
    expect(() => decodeIdentifierRef("**")).toThrow(RefError);
  });
});
