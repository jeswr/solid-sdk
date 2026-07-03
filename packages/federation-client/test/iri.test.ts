// AUTHORED-BY Claude Fable 5
//
// Unit coverage for the IRI-injection guards (src/iri.ts):
//  - LEXICAL PRESERVATION: guards must NOT canonicalise (no default-port strip,
//    no host lower-casing) — RDF IRI identity is lexical.
//  - SCHEME-AGNOSTIC object guard: a `urn:`/`did:` object IRI must survive as a
//    NamedNode, not be silently dropped (http(s)-only would lose it).
//  - the FULL Turtle IRIREF-forbidden set (incl. the `{ } \` chars) is encoded,
//    so a guarded value can never emit an invalid or injecting `<…>`.

import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import type { AppRegistration } from "../src/index.js";
import { selfDescribe } from "../src/index.js";
import { escapeIri, safeHttpIri, safeIri } from "../src/iri.js";

/** Every character the Turtle IRIREF grammar forbids inside `<…>`. */
const FORBIDDEN = ["<", ">", '"', "{", "}", "|", "^", "`", "\\", " "] as const;

function expectNoForbidden(s: string | undefined): void {
  expect(s).toBeDefined();
  for (const bad of FORBIDDEN) {
    expect(s).not.toContain(bad);
  }
}

describe("escapeIri (shared lexical neutraliser)", () => {
  it("leaves a clean IRI (any scheme) byte-identical", () => {
    expect(escapeIri("https://app.example/clientid")).toBe("https://app.example/clientid");
    expect(escapeIri("did:web:example.com")).toBe("did:web:example.com");
    expect(escapeIri("urn:example:shape")).toBe("urn:example:shape");
  });

  it("preserves a default port + uppercase host (no canonicalisation)", () => {
    expect(escapeIri("https://Example.COM:443/Path")).toBe("https://Example.COM:443/Path");
  });

  it("percent-encodes every IRIREF-forbidden char incl. control chars + space", () => {
    const out = escapeIri('a b<c>d"e{f}g|h^i`j\\k');
    expectNoForbidden(out);
    expect(escapeIri("a\tb")).toBe("a%09b"); // TAB (U+0009)
    expect(escapeIri("a b")).toBe("a%20b"); // SPACE (U+0020)
    expect(escapeIri(String.fromCharCode(0))).toBe("%00"); // NUL (U+0000)
  });
});

describe("safeIri (scheme-agnostic OBJECT guard)", () => {
  it("passes any absolute IRI through, lexically preserved", () => {
    expect(safeIri("https://w3id.org/jeswr/sectors/health#Observation")).toBe(
      "https://w3id.org/jeswr/sectors/health#Observation",
    );
    expect(safeIri("urn:example:shape")).toBe("urn:example:shape");
    expect(safeIri("did:web:example.com:1234")).toBe("did:web:example.com:1234");
    // NOT canonicalised: default port + uppercase host survive.
    expect(safeIri("https://Example.COM:443/Path")).toBe("https://Example.COM:443/Path");
  });

  it("drops a non-string, empty, or schemeless (relative) value", () => {
    expect(safeIri(undefined)).toBeUndefined();
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime type guard.
    expect(safeIri(123 as any)).toBeUndefined();
    expect(safeIri("")).toBeUndefined();
    expect(safeIri("relative/no-scheme")).toBeUndefined();
    expect(safeIri("/absolute-path-no-scheme")).toBeUndefined();
  });

  it("neutralises a `>`/space breakout attempt while staying scheme-agnostic", () => {
    expectNoForbidden(
      safeIri("https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2"),
    );
    expectNoForbidden(safeIri("urn:x> . <urn:evil:s"));
  });
});

describe("safeHttpIri (http(s)-only guard)", () => {
  it("rejects non-http(s) and malformed values", () => {
    expect(safeHttpIri(undefined)).toBeUndefined();
    expect(safeHttpIri("not a url")).toBeUndefined();
    expect(safeHttpIri("urn:example:shape")).toBeUndefined();
    expect(safeHttpIri("did:web:example.com")).toBeUndefined();
    expect(safeHttpIri("ftp://host/x")).toBeUndefined();
    expect(safeHttpIri("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpIri("file:///etc/passwd")).toBeUndefined();
  });

  it("rejects a value with leading/trailing controls or spaces (URL would trim them)", () => {
    // `new URL` trims these before parsing, so without the guard they would PASS
    // validation but be emitted as the invalid `%20https://…` / `https://…%09`.
    expect(safeHttpIri(" https://example.com")).toBeUndefined();
    expect(safeHttpIri("https://example.com ")).toBeUndefined();
    expect(safeHttpIri("https://example.com\t")).toBeUndefined();
    expect(safeHttpIri("\nhttps://example.com")).toBeUndefined();
    expect(safeHttpIri(String.fromCharCode(0) + "https://example.com")).toBeUndefined();
    expect(safeHttpIri("")).toBeUndefined();
  });

  it("passes an http(s) IRI through LEXICALLY (no canonicalisation)", () => {
    const iri = "https://w3id.org/jeswr/sectors/health#Observation";
    expect(safeHttpIri(iri)).toBe(iri);
    // The bug this guards: URL.href would strip :443 + lower-case the host.
    expect(safeHttpIri("https://h:443/x")).toBe("https://h:443/x");
    expect(safeHttpIri("https://Example.COM/Path")).toBe("https://Example.COM/Path");
  });

  it("still encodes the residual set + neutralises breakout", () => {
    expectNoForbidden(safeHttpIri("https://evil.example/p?q={a}|b^c\\d`e#frag{f}"));
    expectNoForbidden(
      safeHttpIri("https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2"),
    );
  });
});

describe("selfDescribe end-to-end", () => {
  it("emits a urn: / did: object IRI as a NamedNode (not dropped, not a literal)", async () => {
    const app: AppRegistration = {
      id: "https://app.example/clientid",
      consumes: ["urn:example:shape/Contact"],
      declaresShape: ["did:web:shapes.example:Profile"],
    };
    const quads = new Parser().parse(await selfDescribe(app).toString());
    const consumes = quads.find((q) => q.predicate.value === "https://w3id.org/jeswr/fed#consumes");
    expect(consumes?.object.termType).toBe("NamedNode");
    expect(consumes?.object.value).toBe("urn:example:shape/Contact");
    const shape = quads.find(
      (q) => q.predicate.value === "https://w3id.org/jeswr/fed#declaresShape",
    );
    expect(shape?.object.termType).toBe("NamedNode");
    expect(shape?.object.value).toBe("did:web:shapes.example:Profile");
  });

  it("round-trips an object IRI BYTE-IDENTICAL (default port + uppercase host preserved)", async () => {
    const app: AppRegistration = {
      id: "https://app.example/clientid",
      consumes: ["https://Example.COM:443/Shapes/Contact"],
    };
    const quads = new Parser().parse(await selfDescribe(app).toString());
    const consumes = quads.find((q) => q.predicate.value === "https://w3id.org/jeswr/fed#consumes");
    // Exact lexical form the caller supplied — NOT canonicalised to
    // https://example.com/Shapes/Contact (which would break IRI matching).
    expect(consumes?.object.value).toBe("https://Example.COM:443/Shapes/Contact");
  });

  it("keeps Turtle valid + injection-free for an untrusted consumes IRI with { } \\ ` (regression)", async () => {
    const app: AppRegistration = {
      id: "https://app.example/clientid",
      consumes: ["https://evil.example/p?x={a}&y=\\z#frag{b}|c^d`e"],
    };
    const turtle = await selfDescribe(app).toString();
    // A raw `{ } \ | ^ ` `` in a `<…>` is invalid IRIREF; the guard must keep the
    // graph parseable (this throws if the residual pass missed a char).
    const quads = new Parser().parse(turtle);
    const consumes = quads.filter(
      (q) => q.predicate.value === "https://w3id.org/jeswr/fed#consumes",
    );
    expect(consumes).toHaveLength(1);
    expectNoForbidden(consumes[0]?.object.value ?? "");
    expect(quads.some((q) => q.subject.value.startsWith("https://evil"))).toBe(false);
  });
});
