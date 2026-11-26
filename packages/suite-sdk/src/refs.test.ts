// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
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

/** Base64url aliases of `ref`: the same bytes with different (ignored) trailing bits. */
function aliases(ref: string): string[] {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = chars.indexOf(ref.at(-1) as string);
  const unused = ref.length % 4 === 2 ? 4 : ref.length % 4 === 3 ? 2 : 0;
  const base = last & ~((1 << unused) - 1);
  return Array.from(
    { length: 1 << unused },
    (_, i) => `${ref.slice(0, -1)}${chars[base + i]}`,
  ).filter((alias) => alias !== ref);
}

function randomUrl(next: () => number, letters = alphabet): string {
  const pick = () => letters[Math.floor(next() * letters.length)];
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

  it("rejects every non-canonical alias of a ref", () => {
    const ref = encodeRef("https://pod.example/ab");
    const others = aliases(ref);
    expect(others).toHaveLength(15);
    for (const alias of others) expect(() => decodeRef(alias)).toThrow(RefError);
    expect(decodeRef(ref)).toBe("https://pod.example/ab");
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

  it("preserves a non-breaking space in a subject IRI", () => {
    const iri = "https://alice.pod/chat#message\u00a01";
    expect(decodeIdentifierRef(encodeIdentifierRef(iri))).toBe(iri);
  });

  it("round-trips random http(s) IRIs verbatim", () => {
    const next = mulberry32(0xc0ffee);
    const iriLetters = alphabet.filter((letter) => letter !== " ");
    for (let i = 0; i < 200; i++) {
      const iri = randomUrl(next, iriLetters);
      expect(decodeIdentifierRef(encodeIdentifierRef(iri))).toBe(iri);
    }
  });

  it("refuses non-http identifiers both ways", () => {
    expect(() => encodeIdentifierRef("urn:uuid:1")).toThrow(TypeError);
    expect(() => decodeIdentifierRef(btoa("urn:uuid:1").replace(/=+$/, ""))).toThrow(RefError);
    expect(() => decodeIdentifierRef("**")).toThrow(RefError);
  });

  it("rejects non-canonical aliases", () => {
    const ref = encodeIdentifierRef("https://pod.example/chat#m12");
    const others = aliases(ref);
    expect(others).toHaveLength(15);
    for (const alias of others) expect(() => decodeIdentifierRef(alias)).toThrow(RefError);
  });

  it.each([
    ["a backslash", "https:\\\\evil.example/"],
    ["a tab", "https://pod.example/chat#m\t1"],
    ["a newline", "https://pod.example/chat\n#m1"],
    ["a space", "https://pod.example/chat#m 1"],
    ["leading whitespace", " https://pod.example/chat#m1"],
    ["trailing whitespace", "https://pod.example/chat#m1 "],
    ["a NUL", "https://pod.example/chat#m\u00001"],
    ["a DEL", "https://pod.example/chat#m\u007f"],
    ["a C1 control", "https://pod.example/chat#m\u0085"],
  ])("rejects an identifier containing %s", (_label, iri) => {
    let binary = "";
    for (const byte of new TextEncoder().encode(iri)) binary += String.fromCharCode(byte);
    const ref = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => decodeIdentifierRef(ref)).toThrow(RefError);
  });
});
