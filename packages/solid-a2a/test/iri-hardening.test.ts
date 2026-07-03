// AUTHORED-BY Claude Fable 5
//
// Regression suite for the IRI-hardening sweep (roborev 197b7e0 findings + the full
// injection/desync taxonomy). Three failure classes are covered:
//   1. object-desync / fail-open — a REQUIRED object IRI (intent target/recipient/agent,
//      a handshake protocolSource) that cannot be safely emitted must FAIL CLOSED (throw),
//      never be silently dropped while the public object still claims it. A legitimate
//      non-http absolute IRI (urn:/did:) is emitted, not dropped.
//   2. vacuous SHACL shape — buildResponseShape must never silently omit sh:targetClass /
//      sh:hasValue (an unconstrained shape = a validation bypass); an invalid class throws.
//   3. injection — an IRIREF-breakout payload can never inject triples via any emit
//      surface (Turtle subject/object, JSON-LD), and the safe-IRI guards are complete +
//      lexical-preserving + reject edge control/space.
// Plus: the committed dist carries no machine-absolute host path.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import { handshakeToRdf } from "../src/handshake.js";
import { intentToJsonLd, intentToRdf, intentToTurtle } from "../src/intent.js";
import { escapeIri, requireIri, safeHttpIri, safeIri } from "../src/iri.js";
import { buildResponseShape } from "../src/shape.js";
import { parseIntent } from "../src/translate.js";
import type { Intent } from "../src/types.js";
import { SCHEMA_AGENT, SCHEMA_OBJECT, SCHEMA_TARGET, SH } from "../src/vocab.js";

const SH_TARGET_CLASS = `${SH}targetClass`;
const SH_HAS_VALUE = `${SH}hasValue`;
/** A breakout payload that is NOT a parseable absolute IRI (no scheme). */
const NON_IRI_BREAKOUT = "notaniri> . <https://evil/s> <https://evil/p> <https://evil/o";

// --- Class 1: object-desync / fail-open (the two Medium findings' root cause) ---------

describe("intent required object IRIs FAIL CLOSED (no silent drop / object-desync)", () => {
  it("intentToRdf THROWS on a non-absolute-IRI target rather than dropping it", () => {
    const intent: Intent = { id: "urn:a2a:intent:x", action: "read", target: NON_IRI_BREAKOUT };
    expect(() => intentToRdf(intent)).toThrow(/target/);
  });

  it("intentToRdf THROWS on a malformed recipient / agent", () => {
    expect(() =>
      intentToRdf({ id: "urn:i", action: "grant", target: "https://a/x", recipient: "  " }),
    ).toThrow(/recipient/);
    expect(() =>
      intentToRdf({ id: "urn:i", action: "read", target: "https://a/x", agent: "not a url" }),
    ).toThrow(/agent/);
  });

  it("intentToJsonLd (the OTHER emit surface) FAILS CLOSED identically", () => {
    expect(() => intentToJsonLd({ id: "urn:i", action: "read", target: NON_IRI_BREAKOUT })).toThrow(
      /target/,
    );
    expect(() =>
      intentToJsonLd({ id: "urn:i", action: "read", target: "https://a/x", agent: "@@bad" }),
    ).toThrow(/agent/);
  });

  it("emits a legitimate non-http absolute IRI (urn:/did:) as a NamedNode — NOT dropped", async () => {
    const intent: Intent = {
      id: "urn:a2a:intent:did",
      action: "read",
      target: "did:example:123",
      agent: "urn:agent:alice",
    };
    const ttl = await intentToTurtle(intent);
    const quads = new Parser().parse(ttl);
    const objectQuad = quads.find((q) => q.predicate.value === SCHEMA_OBJECT);
    const agentQuad = quads.find((q) => q.predicate.value === SCHEMA_AGENT);
    expect(objectQuad?.object.termType).toBe("NamedNode");
    expect(objectQuad?.object.value).toBe("did:example:123");
    expect(agentQuad?.object.value).toBe("urn:agent:alice");
    // The public object never claims a field the quads dropped: the JSON-LD form agrees.
    const jsonld = intentToJsonLd(intent);
    expect((jsonld.action as { object: { "@id": string } }).object["@id"]).toBe("did:example:123");
  });
});

describe("handshakeToRdf protocolSource FAILS CLOSED (no silent drop)", () => {
  it("throws on a non-http(s) / malformed protocolSource", () => {
    expect(() =>
      handshakeToRdf({
        kind: "upgrade-offer",
        protocolHash: "sha256:a",
        protocolSource: "urn:not-fetchable",
        required: true,
      }),
    ).toThrow(/protocolSource/);
  });

  it("still emits a valid http(s) protocolSource", () => {
    const quads = handshakeToRdf({
      kind: "upgrade-offer",
      protocolHash: "sha256:a",
      protocolSource: "https://alice.pod/p#v1",
      required: false,
    });
    expect(quads.some((q) => q.object.value === "https://alice.pod/p#v1")).toBe(true);
  });
});

// --- Class 2: vacuous SHACL response shape (the Medium finding #2) ---------------------

describe("buildResponseShape is never vacuous (fail-closed)", () => {
  it("THROWS on an invalid responseClassIri (no silent unconstrained shape)", () => {
    expect(() => buildResponseShape(NON_IRI_BREAKOUT)).toThrow(/responseClassIri/);
    expect(() => buildResponseShape("not a url")).toThrow(/responseClassIri/);
  });

  it("always CONSTRAINS the class (sh:targetClass + sh:hasValue present) for a valid IRI", () => {
    for (const cls of ["https://schema.org/ReadAction", "urn:example:ResponseClass"]) {
      const quads = buildResponseShape(cls);
      expect(
        quads.some((q) => q.predicate.value === SH_TARGET_CLASS && q.object.value === cls),
      ).toBe(true);
      expect(quads.some((q) => q.predicate.value === SH_HAS_VALUE && q.object.value === cls)).toBe(
        true,
      );
    }
  });
});

// --- Class 3: injection can never break out of an IRI on any surface -------------------

describe("no IRIREF breakout on any emit surface", () => {
  const HttpBreakout = "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";

  it("a malicious SUBJECT (intent id) cannot inject triples (escaped, never dropped)", async () => {
    const intent: Intent = {
      id: "urn:evil> . <https://evil/s2> <https://evil/p2> <https://evil/o2",
      action: "read",
      target: "https://a/x",
    };
    const quads = new Parser().parse(await intentToTurtle(intent));
    for (const q of quads) {
      expect(q.subject.value).not.toContain(">");
      expect(q.subject.value).not.toContain(" ");
    }
    expect(
      quads.some(
        (q) => q.subject.value === "https://evil/s2" || q.predicate.value === "https://evil/p2",
      ),
    ).toBe(false);
  });

  it("a malicious http(s) OBJECT target survives only as one escaped term (no injection)", async () => {
    const quads = new Parser().parse(
      await intentToTurtle({ id: "urn:i", action: "read", target: HttpBreakout }),
    );
    const objs = quads.filter((q) => q.predicate.value === SCHEMA_OBJECT);
    expect(objs.length).toBe(1);
    for (const q of quads) {
      expect(q.object.value).not.toContain(">");
      expect(q.object.value).not.toContain(" ");
    }
    expect(quads.some((q) => q.object.value === "https://evil/o2")).toBe(false);
  });

  it("a list target uses schema:target and is likewise escaped", async () => {
    const quads = new Parser().parse(
      await intentToTurtle({ id: "urn:i", action: "list", target: HttpBreakout }),
    );
    const targets = quads.filter((q) => q.predicate.value === SCHEMA_TARGET);
    expect(targets.length).toBe(1);
    expect(targets[0]?.object.value).not.toContain(">");
  });
});

// --- The IRI guards themselves --------------------------------------------------------

describe("safeIri / safeHttpIri guard completeness", () => {
  it("safeIri accepts any absolute scheme (urn/did/http) but rejects relative/blank", () => {
    expect(safeIri("https://a/x")).toBe("https://a/x");
    expect(safeIri("urn:a:b")).toBe("urn:a:b");
    expect(safeIri("did:example:123")).toBe("did:example:123");
    expect(safeIri("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeIri("relative/path")).toBeUndefined();
    expect(safeIri("")).toBeUndefined();
    expect(safeIri("   ")).toBeUndefined();
    expect(safeIri(undefined)).toBeUndefined();
  });

  it("safeIri is LEXICAL-preserving (returns the original, not the URL-normalised href)", () => {
    // A trailing-dot host + no path: the WHATWG parser would normalise/append a slash;
    // the lexical original is preserved (only breakout chars are percent-encoded).
    expect(safeIri("https://Example.COM/Path")).toBe("https://Example.COM/Path");
    expect(safeHttpIri("https://Example.COM/Path")).toBe("https://Example.COM/Path");
  });

  it("both guards REJECT a leading/trailing C0-control or space before parsing", () => {
    // The WHATWG URL parser silently trims these, which would validate a mangled value.
    for (const v of [" https://a/x", "https://a/x ", "\thttps://a/x", "https://a/x\n"]) {
      expect(safeIri(v)).toBeUndefined();
      expect(safeHttpIri(v)).toBeUndefined();
    }
  });

  it("escapeIri neutralises the FULL Turtle IRIREF-forbidden residual set", () => {
    for (const [raw, enc] of [
      ["a>b", "a%3Eb"],
      ["a<b", "a%3Cb"],
      ['a"b', "a%22b"],
      ["a{b}", "a%7Bb%7D"],
      ["a|b", "a%7Cb"],
      ["a^b", "a%5Eb"],
      ["a`b", "a%60b"],
      ["a\\b", "a%5Cb"],
      ["a b", "a%20b"],
    ] as const) {
      expect(escapeIri(raw)).toBe(enc);
    }
  });

  it("requireIri throws with the field name for an unemittable value", () => {
    expect(() => requireIri("relative", "myfield")).toThrow(/myfield/);
    expect(requireIri("https://a/x", "myfield")).toBe("https://a/x");
  });

  it("escapeIri covers the FULL C0 control range U+0000-U+001F (not just delimiters)", () => {
    expect(escapeIri("a\u0000\t\n\r\u001fb")).toBe("a%00%09%0A%0D%1Fb");
  });

  it("escape-first: an EMBEDDED tab/newline/CR is never STRIPPED (validated ≡ emitted)", () => {
    // The WHATWG parser strips these before parsing; escaping first means a control in
    // the SCHEME breaks the (now `%XX`-bearing) scheme → rejected, and a control in the
    // PATH is `%XX`-encoded — never silently stripped so that validated ≠ emitted.
    expect(safeIri("ht\ntps://example.org/p")).toBeUndefined();
    expect(safeHttpIri("ht\ntps://example.org/p")).toBeUndefined();
    const encoded = safeHttpIri("https://example.org/p\tx");
    expect(encoded).toBe("https://example.org/p%09x");
    expect(encoded).not.toContain("\t");
    const nlInPath = safeIri("https://example.org/a\nb");
    expect(nlInPath).toBe("https://example.org/a%0Ab");
  });

  it("a normal port (:443) round-trips byte-identically (no normalisation drift)", () => {
    expect(safeHttpIri("https://example.org:443/p")).toBe("https://example.org:443/p");
    expect(safeIri("https://example.org:443/p")).toBe("https://example.org:443/p");
  });
});

// --- The parseIntent contract stays intact (graceful unresolved, never a throw) -------

describe("parseIntent stays graceful on a malformed-IRI translated draft", () => {
  it("a translate draft with a non-IRI target → unresolved (NOT a throw)", async () => {
    const r = await parseIntent("zorp the thing", {
      translate: async () => ({ action: "read", target: "not-an-iri" }),
    });
    expect(r.resolved).toBe(false);
    expect(r.reason).toContain("invalid draft");
  });

  it("a translate draft with a valid urn: agent still resolves", async () => {
    const r = await parseIntent("zorp the thing", {
      translate: async () => ({ action: "read", target: "https://a/x", agent: "urn:agent:me" }),
    });
    expect(r.resolved).toBe(true);
    expect(r.intent?.agent).toBe("urn:agent:me");
    expect(r.quads.length).toBeGreaterThan(0);
  });

  it("a DETERMINISTIC verb match with a MALFORMED url → unresolved, NOT a throw", async () => {
    // `read https://[` matches the read verb and extracts a malformed URL. Before the
    // fix the fail-closed setter would THROW out of parseIntent; the contract is to
    // degrade to an unresolved result on hostile NL input (only direct intentToRdf/
    // serialize callers get the throw).
    let r: Awaited<ReturnType<typeof parseIntent>> | undefined;
    await expect(async () => {
      r = await parseIntent("read https://[");
    }).not.toThrow();
    expect(r?.resolved).toBe(false);
    expect(r?.quads).toEqual([]);
  });

  it("a malformed grant recipient in NL → unresolved, NOT a throw", async () => {
    // `https://[bad` is captured whole by the recipient marker but is not a valid URL
    // (unterminated IPv6 literal) → safeIri rejects it → the draft never lowers.
    let r: Awaited<ReturnType<typeof parseIntent>> | undefined;
    await expect(async () => {
      r = await parseIntent("share https://alice.pod/x with https://[bad");
    }).not.toThrow();
    expect(r?.resolved).toBe(false);
  });

  it("a well-formed deterministic input still resolves (no over-rejection)", async () => {
    const r = await parseIntent("read https://alice.pod/notes.ttl");
    expect(r.resolved).toBe(true);
    expect(r.source).toBe("deterministic");
    expect(r.intent?.target).toBe("https://alice.pod/notes.ttl");
  });
});

// --- The committed dist carries no machine-absolute host path (finding #3) ------------

describe("committed dist/ has no host/home path", () => {
  const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
  for (const file of ["index.js", "index.js.map"]) {
    it(`dist/${file} contains no /Users//home//root//private//var path`, () => {
      const content = readFileSync(`${distDir}${file}`, "utf8");
      for (const prefix of ["/Users/", "/home/", "/root/", "/private/", "/var/"]) {
        expect(content.includes(prefix), `${file} leaks ${prefix}`).toBe(false);
      }
    });
  }
});
