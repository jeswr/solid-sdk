// AUTHORED-BY Claude Opus 4.8
//
// suite-tracker-c77v — evidence for the DECISION to make `safeHttpIri`
// LEXICAL-PRESERVING (adopt the single suite-wide @jeswr/rdf-serialize invariant)
// rather than canonicalise via `new URL().href`.
//
// The tests prove the change is SAFE and CORRECT:
//
//  1. RE-VERIFICATION ROUND-TRIP — a credential whose issuer / relatedResource /
//     credentialStatus / type IRIs are NON-CANONICAL (default `:443`/`:80` port,
//     mixed-case host, empty path, a dot segment) issues and verifies. Because
//     `issue()` and `verifyCredential()` both lower through the SAME
//     `credentialToRdf`, the round-trip is INVARIANT to whether safeHttpIri
//     canonicalises or preserves — so no already-issuable credential's signature
//     outcome changes. (This is the "does it break verification of already-issued
//     VCs?" evidence the decision required — it does not.)
//
//  2. LEXICAL IDENTITY — the SIGNED RDF now preserves the issuer/relatedResource/
//     status IRI byte-for-byte (no `:443` strip, no host lower-casing, no trailing
//     `/` insertion, no dot-segment resolution), the regression this fixes.
//
//  3. TURTLE ⇄ JSON-LD LOCK-STEP — the RDF lowering and the JSON-LD projection now
//     agree on the issuer IRI byte-for-byte. Before the change `credentialToRdf`
//     canonicalised the issuer while `credentialToJsonLd` emitted it verbatim, so a
//     non-canonical issuer produced DISAGREEING projections (the latent bug).
//
//  4. WEBID PUBLISH ⇄ RESOLVE — a non-canonical controller/key id publishes and
//     resolves symmetrically (both sides lexical), over an offline fetch fixture.

import { Parser, type Quad } from "n3";
import { describe, expect, it } from "vitest";
import {
  credentialToJsonLd,
  credentialToRdf,
  credentialToTurtle,
  parseCredentialRdf,
} from "../src/credential.js";
import { issue } from "../src/issue.js";
import { generateKeyPairForSuite } from "../src/keys.js";
import type { Credential, KeyPair } from "../src/types.js";
import { verifyCredential } from "../src/verify.js";
import { publishVerificationMethod, resolveWebIdKey } from "../src/webid.js";
import { keyResolver } from "./helpers.js";

const VC_ISSUER_PRED = "https://www.w3.org/2018/credentials#issuer";

/** Parse a Turtle string to quads with n3's Parser (never through the code under test). */
function ttlQuads(turtle: string): Quad[] {
  return new Parser().parse(turtle) as Quad[];
}

/** The single `cred:issuer` object IRI in a credential's RDF, via n3 re-parse of Turtle. */
async function issuerFromTurtle(cred: Credential): Promise<string | undefined> {
  const quads = ttlQuads(await credentialToTurtle(cred));
  return quads.find((q) => q.predicate.value === VC_ISSUER_PRED)?.object.value;
}

/** The single `cred:issuer` object IRI via the JSON-LD projection, re-parsed to RDF. */
async function issuerFromJsonLd(cred: Credential): Promise<string | undefined> {
  const doc = credentialToJsonLd(cred);
  const dataset = await parseCredentialRdf(JSON.stringify(doc), "application/ld+json");
  for (const q of dataset.match()) {
    if (q.predicate.value === VC_ISSUER_PRED) return q.object.value;
  }
  return undefined;
}

// Non-canonical http(s) issuer IRIs a real issuer might legitimately supply, each
// of which `new URL().href` would have MUTATED (the value AFTER the arrow), but
// which the lexical guard preserves byte-for-byte (the value BEFORE the arrow).
const NON_CANONICAL_ISSUERS: ReadonlyArray<{ readonly lexical: string; readonly canon: string }> = [
  { lexical: "https://alice.example:443/profile#me", canon: "https://alice.example/profile#me" },
  { lexical: "http://alice.example:80/profile#me", canon: "http://alice.example/profile#me" },
  { lexical: "https://alice.example#me", canon: "https://alice.example/#me" }, // empty path → `/`
  { lexical: "https://Alice.EXAMPLE/Profile#me", canon: "https://alice.example/Profile#me" }, // host case
];

describe("suite-tracker-c77v — safeHttpIri is lexical-preserving (evidence for DECISION a)", () => {
  describe("1. re-verification round-trip over non-canonical identity IRIs", () => {
    for (const { lexical } of NON_CANONICAL_ISSUERS) {
      it(`issues + verifies a credential whose issuer is ${JSON.stringify(lexical)}`, async () => {
        // A key whose verificationMethod is a fragment of THIS non-canonical issuer,
        // so the default issuer-binding gate (vm startsWith `${issuer}#`) also passes.
        const vm = `${lexical}#key-1`;
        const key: KeyPair = await generateKeyPairForSuite(vm, "Ed25519");
        const cred: Credential = {
          issuer: lexical,
          credentialSubject: { id: "https://carol.example/#me", over18: true },
        };
        const vc = await issue({ credential: cred, key });
        // The issuer survives in the RETURNED VC verbatim (no canonicalisation).
        expect(vc.issuer).toBe(lexical);
        // Full verify passes — signature (re-lowered through the SAME credentialToRdf),
        // issuer-binding, purpose, validity all green.
        const result = await verifyCredential(vc, { resolveKey: keyResolver(key) });
        expect(result.verified).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.issuer).toBe(lexical);
      });
    }

    it("round-trips a credential with non-canonical relatedResource + credentialStatus IRIs", async () => {
      const issuer = "https://alice.example:443/profile#me";
      const key: KeyPair = await generateKeyPairForSuite(`${issuer}#key-1`, "Ed25519");
      const cred: Credential = {
        issuer,
        type: ["https://Vocab.EXAMPLE:443/MyType"], // a non-canonical http type IRI
        credentialSubject: { id: "https://carol.example/#me", over18: true },
        relatedResource: [
          {
            id: "https://policy.example:443/p#doc",
            digestMultibase: "zQm",
            mediaType: "text/turtle",
          },
        ],
        credentialStatus: {
          type: "BitstringStatusListEntry",
          statusPurpose: "revocation",
          statusListIndex: "94567",
          statusListCredential: "https://status.example:443/list#1",
        },
      };
      const vc = await issue({ credential: cred, key });
      const result = await verifyCredential(vc, { resolveKey: keyResolver(key) });
      expect(result.verified).toBe(true);
    });
  });

  describe("2. the SIGNED RDF preserves the lexical IRI (regression guard)", () => {
    for (const { lexical, canon } of NON_CANONICAL_ISSUERS) {
      it(`credentialToRdf keeps ${JSON.stringify(lexical)} (NOT ${JSON.stringify(canon)})`, async () => {
        const cred: Credential = {
          issuer: lexical,
          credentialSubject: { id: "https://carol.example/#me", over18: true },
        };
        // Via the raw quads.
        const quads = credentialToRdf(cred);
        const issuerObj = quads.find((q) => q.predicate.value === VC_ISSUER_PRED)?.object.value;
        expect(issuerObj).toBe(lexical);
        expect(issuerObj).not.toBe(canon);
        // And after a full serialise → n3 re-parse (the emitted Turtle carries it).
        expect(await issuerFromTurtle(cred)).toBe(lexical);
      });
    }

    it("preserves a non-canonical relatedResource.id + statusListCredential in the signed graph", () => {
      const cred: Credential = {
        issuer: "https://alice.example/profile#me",
        credentialSubject: { id: "https://carol.example/#me" },
        relatedResource: [{ id: "https://policy.example:443/p#doc", digestMultibase: "zQm" }],
        credentialStatus: {
          type: "BitstringStatusListEntry",
          statusPurpose: "revocation",
          statusListIndex: "1",
          statusListCredential: "https://status.example:443/list#1",
        },
      };
      const objs = new Set(credentialToRdf(cred).map((q) => q.object.value));
      expect(objs).toContain("https://policy.example:443/p#doc");
      expect(objs).toContain("https://status.example:443/list#1");
      // The canonicalised forms must NOT appear.
      expect(objs).not.toContain("https://policy.example/p#doc");
      expect(objs).not.toContain("https://status.example/list#1");
    });
  });

  describe("3. Turtle ⇄ JSON-LD lock-step on the issuer IRI (the bug this fixes)", () => {
    for (const { lexical } of NON_CANONICAL_ISSUERS) {
      it(`both projections agree on ${JSON.stringify(lexical)}`, async () => {
        const cred: Credential = {
          issuer: lexical,
          credentialSubject: { id: "https://carol.example/#me", over18: true },
        };
        const fromTurtle = await issuerFromTurtle(cred);
        const fromJsonLd = await issuerFromJsonLd(cred);
        // The JSON-LD projection always kept the issuer verbatim; the RDF lowering now
        // does too — so the two RDF projections carry an IDENTICAL issuer NamedNode.
        expect(fromTurtle).toBe(lexical);
        expect(fromJsonLd).toBe(lexical);
        expect(fromTurtle).toBe(fromJsonLd);
      });
    }
  });

  describe("4. WebID publish ⇄ resolve round-trip with non-canonical IRIs", () => {
    it("publishes + resolves a key under a non-canonical controller/keyId (both sides lexical)", async () => {
      const controller = "https://alice.example:443/profile#me";
      const keyId = "https://alice.example:443/profile#key-1";
      const key: KeyPair = await generateKeyPairForSuite(keyId, "Ed25519");

      const published = await publishVerificationMethod({ controller, key });
      // The published RDF carries the lexical (port-preserved) IRIs, not canonicalised.
      expect(published.controller).toBe(controller);
      expect(published.verificationMethod).toBe(keyId);
      expect(published.turtle).toContain(":443");

      // The document is FETCHED from the canonical doc URL (port stripped for transport);
      // the RDF-term match against it still uses the lexical IRI, so resolution succeeds.
      const docUrl = "https://alice.example/profile";
      const fetchImpl = (async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;
        if (url === docUrl) {
          return new Response(published.turtle, {
            status: 200,
            headers: { "content-type": "text/turtle" },
          });
        }
        return new Response("not found", { status: 404 });
      }) as typeof globalThis.fetch;

      const resolved = await resolveWebIdKey(controller, keyId, { fetch: fetchImpl });
      expect(resolved).toBeDefined();
      expect(resolved?.controller).toBe(controller);
      expect(resolved?.verificationMethod).toBe(keyId);
      expect(resolved?.keyType).toBe("Ed25519");
    });
  });
});
