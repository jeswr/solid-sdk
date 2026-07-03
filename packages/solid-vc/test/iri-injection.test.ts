// AUTHORED-BY Claude Fable 5
//
// Regression test for the n3.Writer IRI-injection bug class: an untrusted IRI
// containing `>` / space / `<` must NOT break out of the serialised `<…>` and
// inject arbitrary triples. Builds a credential whose issuer + a claim value carry
// a triple-injection payload, serialises through the PUBLIC API, re-parses the
// output with n3's Parser, and asserts NO injected statement appears. Also asserts
// a legitimate `urn:` / `did:` subject still round-trips byte-for-byte (the guard
// is scheme-agnostic and must not mangle valid non-http IRIs).

import { Parser, type Quad } from "n3";
import { describe, expect, it } from "vitest";
import { credentialToTurtle } from "../src/credential.js";
import { escapeIri, safeHttpIri, safeObjectIri } from "../src/iri.js";
import type { Credential } from "../src/types.js";

// A payload that, emitted VERBATIM inside `<…>`, closes the issuer IRI (`x>`),
// terminates the statement (` . `), and injects a second, attacker-chosen triple.
const INJECT = "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";
const LINK = "https://example.org/link";

async function turtleQuads(cred: Credential): Promise<Quad[]> {
  const turtle = await credentialToTurtle(cred);
  return new Parser().parse(turtle) as Quad[];
}

describe("n3.Writer IRI-injection hardening", () => {
  it("does not inject triples via an untrusted issuer + claim-value IRI", async () => {
    // A benign credential with the SAME shape (one issuer IRI, one claim IRI) is the
    // triple-count oracle: an injection would make the malicious graph strictly
    // larger. Equal counts prove zero triples were injected.
    const benign: Credential = {
      issuer: "https://good.example/issuer#me",
      credentialSubject: { id: "https://good.example/subject#s", [LINK]: "https://good.example/o" },
    };
    const malicious: Credential = {
      issuer: INJECT,
      credentialSubject: { id: "https://good.example/subject#s", [LINK]: INJECT },
    };

    const benignQuads = await turtleQuads(benign);
    const maliciousQuads = await turtleQuads(malicious);

    // No breakout: the attacker's injected subject/predicate/object never materialise.
    for (const q of maliciousQuads) {
      expect(q.subject.value).not.toBe("https://evil/s2");
      expect(q.predicate.value).not.toBe("https://evil/p2");
      expect(q.object.value).not.toBe("https://evil/o2");
    }
    // Exactly the benign triple count — the payload added no statements.
    expect(maliciousQuads.length).toBe(benignQuads.length);

    // The payload survives as ONE percent-encoded IRI object (data preserved, not
    // dropped, not broken out).
    const encoded = escapeIri(INJECT);
    expect(encoded).not.toMatch(/[ <>]/);
    const linkObj = maliciousQuads.find((q) => q.predicate.value === LINK);
    expect(linkObj?.object.termType).toBe("NamedNode");
    expect(linkObj?.object.value).toContain("%3E");
  });

  it("round-trips a legitimate urn:/did: subject and issuer unchanged", async () => {
    const cred: Credential = {
      id: "urn:uuid:11111111-2222-3333-4444-555555555555",
      issuer: "https://alice.example/profile#me",
      credentialSubject: { id: "did:example:123", [LINK]: "https://ok.example/value" },
    };
    const quads = await turtleQuads(cred);

    // The urn: credential subject and the did: credentialSubject id survive verbatim.
    const subjects = new Set(quads.map((q) => q.subject.value));
    expect(subjects).toContain("urn:uuid:11111111-2222-3333-4444-555555555555");
    expect(subjects).toContain("did:example:123");

    const issuerObj = quads.find((q) => q.predicate.value.endsWith("credentials#issuer"));
    expect(issuerObj?.object.value).toBe("https://alice.example/profile#me");
  });

  it("guard unit behaviour: escape vs http-canonicalise vs drop", () => {
    // escapeIri: scheme-agnostic, non-mutating for valid IRIs.
    expect(escapeIri("did:example:123")).toBe("did:example:123");
    expect(escapeIri("urn:uuid:abc")).toBe("urn:uuid:abc");
    expect(escapeIri(INJECT)).not.toMatch(/[ <>"{}|^`\\]/);

    // safeHttpIri: http(s) only; a non-http / unparseable value is undefined.
    expect(safeHttpIri("https://a.example/p#f")).toBe("https://a.example/p#f");
    expect(safeHttpIri("did:example:123")).toBeUndefined();
    expect(safeHttpIri("not a url")).toBeUndefined();

    // safeObjectIri: http canonicalised, did:/urn: escaped in place, garbage dropped.
    expect(safeObjectIri("https://a.example/p#f")).toBe("https://a.example/p#f");
    expect(safeObjectIri("did:example:123")).toBe("did:example:123");
    expect(safeObjectIri("relative/path")).toBeUndefined();
    expect(safeObjectIri(undefined)).toBeUndefined();
  });
});
