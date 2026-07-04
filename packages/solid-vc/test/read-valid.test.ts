// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// G15(a) — FAIL-CLOSED structural validation of a parsed credential. A well-formed
// credential validates and projects its metadata; EVERY malformed / partial /
// ambiguous graph is REJECTED with a discriminated `{ valid: false }` result, and
// the validator NEVER throws on hostile input.

import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { parseAndValidateCredential, readValidCredential } from "../src/read-valid.js";
import { RDF_TYPE, VC_CREDENTIAL, VC_CREDENTIAL_SUBJECT, VC_ISSUER } from "../src/vocab.js";

const { namedNode, literal, quad } = DataFactory;

const PREFIX = `@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

const VALID = `${PREFIX}<urn:uuid:cred-1> a cred:VerifiableCredential ;
  cred:issuer <https://alice.example/profile#me> ;
  cred:credentialSubject <https://bob.example/#me> ;
  cred:validFrom "2024-01-01T00:00:00Z"^^xsd:dateTime ;
  cred:validUntil "2025-01-01T00:00:00Z"^^xsd:dateTime .`;

describe("readValidCredential — valid", () => {
  it("accepts a well-formed credential and projects issuer/types/subject/validity", async () => {
    const result = await parseAndValidateCredential(VALID);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.error);
    expect(result.credential.id).toBe("urn:uuid:cred-1");
    expect(result.credential.issuer).toBe("https://alice.example/profile#me");
    expect(result.credential.types).toContain(VC_CREDENTIAL);
    expect(result.credential.validFrom).toBe("2024-01-01T00:00:00Z");
    expect(result.credential.validUntil).toBe("2025-01-01T00:00:00Z");
    // The subject is reachable through the node.
    expect(result.credential.node.subjects.size).toBeGreaterThan(0);
  });

  it("accepts a credential with no validFrom/validUntil", async () => {
    const ttl = `${PREFIX}<urn:uuid:c> a cred:VerifiableCredential ;
      cred:issuer <https://alice.example/#me> ;
      cred:credentialSubject <https://bob.example/#me> .`;
    const result = await parseAndValidateCredential(ttl);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.error);
    expect(result.credential.validFrom).toBeUndefined();
    expect(result.credential.validUntil).toBeUndefined();
  });
});

describe("readValidCredential — fail-closed rejections", () => {
  it("rejects an empty dataset (no credential node)", async () => {
    const result = await parseAndValidateCredential(
      "@prefix ex: <http://example.org/> . ex:s ex:p ex:o .",
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/no VerifiableCredential node/);
  });

  it("rejects a credential-shaped node missing the VerifiableCredential type", async () => {
    const ttl = `${PREFIX}<urn:uuid:c>
      cred:issuer <https://alice.example/#me> ;
      cred:credentialSubject <https://bob.example/#me> .`;
    const result = await parseAndValidateCredential(ttl);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/missing the required VerifiableCredential type/);
  });

  it("rejects a missing issuer", async () => {
    const ttl = `${PREFIX}<urn:uuid:c> a cred:VerifiableCredential ;
      cred:credentialSubject <https://bob.example/#me> .`;
    const result = await parseAndValidateCredential(ttl);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/no issuer/);
  });

  it("rejects more than one issuer (ambiguous)", async () => {
    const ttl = `${PREFIX}<urn:uuid:c> a cred:VerifiableCredential ;
      cred:issuer <https://alice.example/#me>, <https://eve.example/#me> ;
      cred:credentialSubject <https://bob.example/#me> .`;
    const result = await parseAndValidateCredential(ttl);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/more than one issuer/);
  });

  it("rejects a literal (non-IRI) issuer", async () => {
    const ttl = `${PREFIX}<urn:uuid:c> a cred:VerifiableCredential ;
      cred:issuer "https://alice.example/#me" ;
      cred:credentialSubject <https://bob.example/#me> .`;
    const result = await parseAndValidateCredential(ttl);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/must be an IRI/);
  });

  it("rejects a non-absolute (relative) issuer IRI", () => {
    // A relative-IRI NamedNode can't survive Turtle parsing (relative IRIs resolve
    // against the base), so build the dataset directly to exercise the isAbsoluteIri
    // branch. Reading such a hostile graph must FAIL CLOSED, not accept.
    const store = new Store();
    const s = namedNode("urn:uuid:c");
    store.add(quad(s, namedNode(RDF_TYPE), namedNode(VC_CREDENTIAL)));
    store.add(quad(s, namedNode(VC_ISSUER), namedNode("alice-no-scheme")));
    store.add(quad(s, namedNode(VC_CREDENTIAL_SUBJECT), namedNode("https://bob.example/#me")));
    const result = readValidCredential(store as unknown as DatasetCore);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/not an absolute IRI/);
  });

  it("rejects a credential with no credentialSubject", async () => {
    const ttl = `${PREFIX}<urn:uuid:c> a cred:VerifiableCredential ;
      cred:issuer <https://alice.example/#me> .`;
    const result = await parseAndValidateCredential(ttl);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/no credentialSubject/);
  });

  it("rejects a malformed validFrom", async () => {
    const ttl = `${PREFIX}<urn:uuid:c> a cred:VerifiableCredential ;
      cred:issuer <https://alice.example/#me> ;
      cred:credentialSubject <https://bob.example/#me> ;
      cred:validFrom "not-a-date"^^xsd:dateTime .`;
    const result = await parseAndValidateCredential(ttl);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/validFrom.*not a well-formed xsd:dateTime/);
  });

  it("rejects a shape-valid-but-impossible validUntil (month 13)", async () => {
    const ttl = `${PREFIX}<urn:uuid:c> a cred:VerifiableCredential ;
      cred:issuer <https://alice.example/#me> ;
      cred:credentialSubject <https://bob.example/#me> ;
      cred:validUntil "2024-13-45T00:00:00Z"^^xsd:dateTime .`;
    const result = await parseAndValidateCredential(ttl);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/validUntil.*not a well-formed xsd:dateTime/);
  });

  it("rejects TWO credential nodes (ambiguity fail-closed)", async () => {
    const ttl = `${PREFIX}<urn:uuid:c1> a cred:VerifiableCredential ;
      cred:issuer <https://alice.example/#me> ;
      cred:credentialSubject <https://bob.example/#me> .
    <urn:uuid:c2> a cred:VerifiableCredential ;
      cred:issuer <https://eve.example/#me> ;
      cred:credentialSubject <https://mallory.example/#me> .`;
    const result = await parseAndValidateCredential(ttl);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected invalid");
    expect(result.error).toMatch(/2 VerifiableCredential nodes.*ambiguous/);
  });
});

describe("readValidCredential — never throws on hostile input", () => {
  const HostileBodies = [
    "", // empty
    "this is not turtle at all >>> {{{", // unparseable
    "@prefix cred: <https://www.w3.org/2018/credentials#> . _:b a cred:VerifiableCredential .", // blank, no issuer/subject
    "@prefix cred: <https://www.w3.org/2018/credentials#> . <urn:x> a cred:VerifiableCredential ; cred:issuer _:blankIssuer ; cred:credentialSubject <urn:s> .", // blank-node issuer
  ];

  for (const body of HostileBodies) {
    it(`returns an invalid result (never throws) for: ${JSON.stringify(body).slice(0, 40)}`, async () => {
      let result: Awaited<ReturnType<typeof parseAndValidateCredential>> | undefined;
      await expect(
        (async () => {
          result = await parseAndValidateCredential(body);
        })(),
      ).resolves.toBeUndefined();
      expect(result?.valid).toBe(false);
    });
  }

  it("readValidCredential itself never throws even on a malformed literal-only graph", () => {
    const store = new Store();
    store.add(
      quad(namedNode("urn:s"), namedNode(RDF_TYPE), literal("not even a class as a literal")),
    );
    expect(() => readValidCredential(store as unknown as DatasetCore)).not.toThrow();
    const result = readValidCredential(store as unknown as DatasetCore);
    expect(result.valid).toBe(false);
  });
});
