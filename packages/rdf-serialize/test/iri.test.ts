// AUTHORED-BY Claude Fable 5
//
// Exhaustive tests for the canonical IRI-safety helper set (src/iri.ts): every
// clause of each function's contract plus the exact adversarial cases the
// cross-suite security sweep surfaced (>-breakout injection, embedded
// tab/newline/carriage-return, backslash handling, authority-less / empty-authority
// http forms, leading/trailing control+space, :443 / uppercase-host lexical
// preservation, urn:/did: scheme-agnostic acceptance, and the non-canonical-safe
// predicate).

import { DataFactory, Parser, Writer } from "n3";
import { describe, expect, it } from "vitest";
import { escapeIri, isHttpIri, safeHttpIri, safeIri } from "../src/index.js";

// The full Turtle IRIREF-forbidden set as a detection regex, used to assert that
// a helper's returned value can never inject when written inside `<…>`.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is the exact set the helpers escape.
const FORBIDDEN = /[\u0000-\u0020<>"{}|^`\\]/;

/** Serialise a single triple whose object IRI is `objectIri`, parse it back, and
 * return the number of quads recovered — >1 means the object IRI injected. */
function roundTripQuadCount(objectIri: string): number {
  const { namedNode, quad } = DataFactory;
  const q = quad(
    namedNode("https://example.org/s"),
    namedNode("https://example.org/p"),
    namedNode(objectIri),
  );
  const writer = new Writer({ format: "application/n-triples" });
  writer.addQuad(q);
  let out = "";
  writer.end((_err, result) => {
    out = result;
  });
  return new Parser({ format: "application/n-triples" }).parse(out).length;
}

// ---------------------------------------------------------------------------
// escapeIri
// ---------------------------------------------------------------------------

describe("escapeIri — lexical percent-encoding of the IRIREF-forbidden set", () => {
  it("encodes each forbidden ASCII symbol to its uppercase %XX", () => {
    expect(escapeIri("<")).toBe("%3C");
    expect(escapeIri(">")).toBe("%3E");
    expect(escapeIri('"')).toBe("%22");
    expect(escapeIri("{")).toBe("%7B");
    expect(escapeIri("}")).toBe("%7D");
    expect(escapeIri("|")).toBe("%7C");
    expect(escapeIri("^")).toBe("%5E");
    expect(escapeIri("`")).toBe("%60");
    expect(escapeIri("\\")).toBe("%5C");
  });

  it("encodes SPACE (U+0020)", () => {
    expect(escapeIri(" ")).toBe("%20");
    expect(escapeIri("a b")).toBe("a%20b");
  });

  it("encodes embedded tab / newline / carriage-return", () => {
    expect(escapeIri("\t")).toBe("%09");
    expect(escapeIri("\n")).toBe("%0A");
    expect(escapeIri("\r")).toBe("%0D");
    expect(escapeIri("a\tb\nc\rd")).toBe("a%09b%0Ac%0Dd");
  });

  it("encodes the full C0 control range U+0000–U+001F", () => {
    for (let code = 0x00; code <= 0x1f; code++) {
      const expected = `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
      expect(escapeIri(String.fromCharCode(code))).toBe(expected);
    }
  });

  it("does NOT touch % (no double-encoding)", () => {
    expect(escapeIri("%")).toBe("%");
    expect(escapeIri("a%20b")).toBe("a%20b");
    expect(escapeIri("http://ex/%3E")).toBe("http://ex/%3E");
  });

  it("leaves urn:/did:/http values with no forbidden chars byte-identical", () => {
    expect(escapeIri("urn:uuid:abc")).toBe("urn:uuid:abc");
    expect(escapeIri("did:example:123#key-1")).toBe("did:example:123#key-1");
    expect(escapeIri("http://example.com/a/b?c=d&e=f")).toBe("http://example.com/a/b?c=d&e=f");
  });

  it("preserves astral (multi-code-unit) characters untouched", () => {
    // A code-point iteration must not corrupt a surrogate pair.
    expect(escapeIri("https://ex/\u{1F600}")).toBe("https://ex/\u{1F600}");
  });

  it("fully neutralises a >-breakout injection payload", () => {
    const payload = "http://evil/> <https://evil/s> <https://evil/o> .";
    const escaped = escapeIri(payload);
    expect(FORBIDDEN.test(escaped)).toBe(false);
    expect(escaped).not.toContain(">");
    expect(escaped).not.toContain("<");
    expect(escaped).toContain("%3E");
  });
});

// ---------------------------------------------------------------------------
// safeHttpIri
// ---------------------------------------------------------------------------

describe("safeHttpIri — clause (a): non-string", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number", 42],
    ["boolean", true],
    ["object", {}],
    ["array", []],
    ["symbol", Symbol("x")],
  ])("returns undefined for %s", (_label, v) => {
    expect(safeHttpIri(v as unknown)).toBeUndefined();
  });
});

describe("safeHttpIri — clause (b): leading/trailing control or space", () => {
  it("rejects a leading space", () => {
    expect(safeHttpIri(" https://example.com/")).toBeUndefined();
  });
  it("rejects a trailing space", () => {
    expect(safeHttpIri("https://example.com/ ")).toBeUndefined();
  });
  it("rejects a leading C0 control (tab)", () => {
    expect(safeHttpIri("\thttps://example.com/")).toBeUndefined();
  });
  it("rejects a trailing C0 control (newline)", () => {
    expect(safeHttpIri("https://example.com/\n")).toBeUndefined();
  });
  it("rejects a leading NUL", () => {
    expect(safeHttpIri("\u0000https://example.com/")).toBeUndefined();
  });
});

describe("safeHttpIri — clauses (c)+(g): escape-first, embedded controls preserved", () => {
  it("percent-encodes an embedded tab/newline/carriage-return in the path", () => {
    // Edge controls are rejected, but INNER ones are escaped and preserved.
    const safe = safeHttpIri("https://example.com/a\tb\nc\rd");
    expect(safe).toBe("https://example.com/a%09b%0Ac%0Dd");
    expect(FORBIDDEN.test(safe as string)).toBe(false);
  });

  it("encodes a path backslash to %5C rather than letting the parser turn it into /", () => {
    const safe = safeHttpIri("https://example.com/a\\b");
    expect(safe).toBe("https://example.com/a%5Cb");
    expect(safe).not.toContain("/a/b");
  });
});

describe("safeHttpIri — clause (d): unparseable / clause (e): non-http scheme", () => {
  it("returns undefined when new URL throws (empty-authority query form)", () => {
    expect(safeHttpIri("https://?x")).toBeUndefined();
  });
  it.each([
    "urn:uuid:abc",
    "did:example:123",
    "ftp://host/x",
    "mailto:a@b.com",
    "file:///etc",
    "javascript:alert(1)",
    "data:text/plain,hi",
  ])("returns undefined for non-http(s) scheme %p", (v) => {
    expect(safeHttpIri(v)).toBeUndefined();
  });
});

describe("safeHttpIri — clause (f): non-empty lexical authority", () => {
  it("rejects authority-less https:example.com", () => {
    expect(safeHttpIri("https:example.com")).toBeUndefined();
  });
  it("rejects empty-authority https:///foo", () => {
    expect(safeHttpIri("https:///foo")).toBeUndefined();
  });
  it("rejects empty-authority http:////foo", () => {
    expect(safeHttpIri("http:////foo")).toBeUndefined();
  });
  it("rejects the authority-backslash form https:\\\\evil.com", () => {
    expect(safeHttpIri("https:\\\\evil.com")).toBeUndefined();
  });
});

describe("safeHttpIri — success returns the escaped LEXICAL value (never u.href)", () => {
  it("accepts a plain http and https IRI unchanged", () => {
    expect(safeHttpIri("http://example.com/x")).toBe("http://example.com/x");
    expect(safeHttpIri("https://example.com/x")).toBe("https://example.com/x");
  });
  it("preserves an explicit :443 default port byte-identical", () => {
    expect(safeHttpIri("https://example.com:443/x")).toBe("https://example.com:443/x");
  });
  it("preserves host case byte-identical", () => {
    expect(safeHttpIri("https://Example.COM/x")).toBe("https://Example.COM/x");
  });
  it("preserves a combined uppercase-host + :443 byte-identical", () => {
    expect(safeHttpIri("https://Example.COM:443/x")).toBe("https://Example.COM:443/x");
  });
  it("preserves dot-segments byte-identical (no canonical collapse)", () => {
    expect(safeHttpIri("https://example.com/a/../b")).toBe("https://example.com/a/../b");
  });
});

describe("safeHttpIri — the >-breakout injection is neutralised, not passed through", () => {
  const payload = "http://evil/> <https://evil/s> <https://evil/o> .";

  it("returns a defined, forbidden-char-free string", () => {
    const safe = safeHttpIri(payload);
    expect(safe).toBeDefined();
    expect(FORBIDDEN.test(safe as string)).toBe(false);
  });

  it("cannot inject extra triples when serialised through n3.Writer", () => {
    const safe = safeHttpIri(payload) as string;
    expect(roundTripQuadCount(safe)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// safeIri
// ---------------------------------------------------------------------------

describe("safeIri — scheme-agnostic", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number", 7],
    ["boolean", false],
    ["object", {}],
  ])("returns undefined for non-string %s", (_label, v) => {
    expect(safeIri(v as unknown)).toBeUndefined();
  });

  it("rejects leading/trailing control or space", () => {
    expect(safeIri(" urn:uuid:abc")).toBeUndefined();
    expect(safeIri("urn:uuid:abc\n")).toBeUndefined();
  });

  it("preserves a urn: IRI as-is", () => {
    expect(safeIri("urn:uuid:abc")).toBe("urn:uuid:abc");
  });
  it("preserves a did: IRI as-is", () => {
    expect(safeIri("did:example:123#key-1")).toBe("did:example:123#key-1");
  });
  it("accepts http(s) IRIs (escaped lexical)", () => {
    expect(safeIri("https://example.com/x")).toBe("https://example.com/x");
  });
  it("accepts other absolute schemes (mailto:)", () => {
    expect(safeIri("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it.each([
    "/foo",
    "foo/bar",
    "#frag",
    "",
    "  ",
  ])("returns undefined for schemeless/relative %p", (v) => {
    expect(safeIri(v)).toBeUndefined();
  });

  it("percent-encodes an embedded forbidden char in an absolute IRI", () => {
    const safe = safeIri("urn:x:a b");
    expect(safe).toBe("urn:x:a%20b");
    expect(FORBIDDEN.test(safe as string)).toBe(false);
  });

  it("neutralises the injection payload (http scheme, returns forbidden-char-free)", () => {
    const safe = safeIri("http://evil/> <https://evil/s> .");
    expect(safe).toBeDefined();
    expect(FORBIDDEN.test(safe as string)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isHttpIri
// ---------------------------------------------------------------------------

describe("isHttpIri — lexical safety predicate (not canonical equality)", () => {
  it("returns true for a clean absolute http/https IRI", () => {
    expect(isHttpIri("http://example.com/x")).toBe(true);
    expect(isHttpIri("https://example.com/x")).toBe(true);
  });

  it("accepts non-canonical-but-safe values (does NOT require === safeHttpIri)", () => {
    // Missing trailing slash — raw-safe, accepted.
    expect(isHttpIri("http://example.com")).toBe(true);
    // Uppercase host — raw-safe, accepted.
    expect(isHttpIri("http://EXAMPLE.com/")).toBe(true);
    // Default :443 + host case — raw-safe, accepted.
    expect(isHttpIri("https://Example.COM:443/x")).toBe(true);
    // The genuine divergence from safeHttpIri: the authority-less form is
    // injection-safe (no forbidden char, parses http(s)) so the PREDICATE
    // accepts it, even though safeHttpIri's strict lexical-authority rule
    // rejects it. isHttpIri is a safety predicate, not `=== safeHttpIri`.
    expect(isHttpIri("https:example.com")).toBe(true);
    expect(safeHttpIri("https:example.com")).toBeUndefined();
  });

  it("returns false when a raw forbidden char is present (the injection payload)", () => {
    expect(isHttpIri("http://evil/> <https://evil/s> <https://evil/o> .")).toBe(false);
    expect(isHttpIri("http://example.com/a b")).toBe(false);
    expect(isHttpIri("http://example.com/a\\b")).toBe(false);
  });

  it.each([
    "urn:uuid:abc",
    "did:example:123",
    "ftp://host/x",
    "mailto:a@b.com",
  ])("returns false for non-http(s) scheme %p", (v) => {
    expect(isHttpIri(v)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number", 5],
    ["boolean", true],
    ["object", {}],
  ])("returns false for non-string %s", (_label, v) => {
    expect(isHttpIri(v as unknown)).toBe(false);
  });

  it.each(["/foo", "foo/bar", "#frag", ""])("returns false for relative/schemeless %p", (v) => {
    expect(isHttpIri(v)).toBe(false);
  });

  it("narrows the type to string when true", () => {
    const v: unknown = "https://example.com/x";
    if (isHttpIri(v)) {
      // Compile-time: v is now `string`. Runtime: exercise a string method.
      expect(v.startsWith("https://")).toBe(true);
    } else {
      throw new Error("expected isHttpIri to narrow");
    }
  });
});
