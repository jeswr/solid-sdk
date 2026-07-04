// AUTHORED-BY Claude Fable 5
//
// G1 POLICY-CONTENT BINDING — the security tests. The claim under test: an
// AgentAuthorizationCredential built with `policyContent` cryptographically
// binds the EXACT ODRL Agreement it authorizes (a signed `relatedResource`
// digest over the policy's RDFC-1.0 canonical form), and the verifier's
// recompute-and-compare is FAIL-CLOSED: a substituted policy, a mutated policy,
// a missing digest, an undigested entry, unparseable content, and a tampered
// digest ALL reject — while a reordered-but-isomorphic serialisation of the
// same policy still verifies (canonicalization stability, no false rejections).

import { describe, expect, it } from "vitest";
import {
  buildAgentAuthorizationCredential,
  buildBoundAgentAuthorizationCredential,
  credentialFromRdf,
  credentialToJsonLd,
  credentialToRdf,
  credentialToTurtle,
  digestQuads,
  digestRdfContent,
  issue,
  issueAgentAuthorization,
  parseCredentialRdf,
  relatedResourcesFromNode,
  SEC_DIGEST_MULTIBASE,
  VC_RELATED_RESOURCE,
  type VerifiableCredential,
  verifyCredential,
  verifyRelatedResources,
} from "../src/index.js";
import { base58btcDecode } from "../src/multibase.js";
import { ACL_READ, AGENT, expectDefined, ISSUER, issuerKey, keyResolver } from "./helpers.js";

const POLICY_IRI = "https://alice.example/policies/notes#agreement";

/** The exact ODRL Agreement the credential authorizes. */
const POLICY_TTL = `@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
<${POLICY_IRI}> a odrl:Agreement ;
  odrl:assigner <${ISSUER}> ;
  odrl:assignee <${AGENT}> ;
  odrl:permission [ odrl:action odrl:read ; odrl:target <https://alice.example/notes/> ] .
`;

/**
 * The SAME graph, serialised differently: no prefixes, reordered triples,
 * different blank-node label. Isomorphic to POLICY_TTL — must digest equal.
 */
const POLICY_TTL_REORDERED = `<${POLICY_IRI}> <http://www.w3.org/ns/odrl/2/permission> _:perm0 .
_:perm0 <http://www.w3.org/ns/odrl/2/target> <https://alice.example/notes/> .
_:perm0 <http://www.w3.org/ns/odrl/2/action> <http://www.w3.org/ns/odrl/2/read> .
<${POLICY_IRI}> <http://www.w3.org/ns/odrl/2/assignee> <${AGENT}> .
<${POLICY_IRI}> <http://www.w3.org/ns/odrl/2/assigner> <${ISSUER}> .
<${POLICY_IRI}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/ns/odrl/2/Agreement> .
`;

/** A SUBSTITUTED policy: same IRI, broader target — the attack G1 closes. */
const POLICY_TTL_SUBSTITUTED = POLICY_TTL.replace(
  "https://alice.example/notes/",
  "https://alice.example/",
);

/** A minimally MUTATED policy: one action changed. */
const POLICY_TTL_MUTATED = POLICY_TTL.replace("odrl:read", "odrl:modify");

const AUTH = {
  principal: ISSUER,
  agent: AGENT,
  action: ACL_READ,
  target: "https://alice.example/notes/",
  policy: POLICY_IRI,
} as const;

describe("digestRdfContent (the canonical policy digest)", () => {
  it("is deterministic for the same content", async () => {
    const a = await digestRdfContent(POLICY_TTL);
    const b = await digestRdfContent(POLICY_TTL);
    expect(a).toBe(b);
  });

  it("is STABLE across reordered/relabelled-but-isomorphic serialisations", async () => {
    const a = await digestRdfContent(POLICY_TTL);
    const b = await digestRdfContent(POLICY_TTL_REORDERED);
    expect(a).toBe(b);
  });

  it("changes for a substituted or mutated policy", async () => {
    const original = await digestRdfContent(POLICY_TTL);
    expect(await digestRdfContent(POLICY_TTL_SUBSTITUTED)).not.toBe(original);
    expect(await digestRdfContent(POLICY_TTL_MUTATED)).not.toBe(original);
  });

  it("emits a multibase(base58btc) sha2-256 multihash (z…, 0x12 0x20 + 32 bytes)", async () => {
    const digest = await digestRdfContent(POLICY_TTL);
    expect(digest.startsWith("z")).toBe(true);
    const bytes = base58btcDecode(digest);
    expect(bytes.length).toBe(34);
    expect(bytes[0]).toBe(0x12);
    expect(bytes[1]).toBe(0x20);
  });

  it("FAILS CLOSED on an empty graph (nothing to bind)", async () => {
    await expect(digestRdfContent("")).rejects.toThrow(/EMPTY RDF graph/);
  });

  it("FAILS CLOSED on unparseable content", async () => {
    await expect(digestRdfContent("this is not turtle <<<")).rejects.toThrow();
  });

  it("digestQuads agrees with digestRdfContent over the parsed quads", async () => {
    const dataset = await parseCredentialRdf(POLICY_TTL);
    const viaQuads = await digestQuads([...dataset.match()]);
    expect(viaQuads).toBe(await digestRdfContent(POLICY_TTL));
  });
});

describe("buildBoundAgentAuthorizationCredential (issuance-side binding)", () => {
  it("emits a relatedResource entry binding the policy IRI to its content digest", async () => {
    const credential = await buildBoundAgentAuthorizationCredential({
      ...AUTH,
      policyContent: POLICY_TTL,
    });
    const related = expectDefined(credential.relatedResource, "relatedResource");
    expect(related).toHaveLength(1);
    expect(related[0]?.id).toBe(POLICY_IRI);
    expect(related[0]?.digestMultibase).toBe(await digestRdfContent(POLICY_TTL));
    expect(related[0]?.mediaType).toBe("text/turtle");
  });

  it("degrades to the bare-IRI builder when policyContent is absent", async () => {
    const credential = await buildBoundAgentAuthorizationCredential(AUTH);
    expect(credential).toEqual(buildAgentAuthorizationCredential(AUTH));
    expect(credential.relatedResource).toBeUndefined();
  });

  it("FAILS CLOSED when policyContent is supplied without a policy IRI", async () => {
    const { policy: _p, ...noPolicy } = AUTH;
    await expect(
      buildBoundAgentAuthorizationCredential({ ...noPolicy, policyContent: POLICY_TTL }),
    ).rejects.toThrow(/requires a policy IRI/);
  });

  it("FAILS CLOSED when policyContent parses to an empty graph", async () => {
    await expect(
      buildBoundAgentAuthorizationCredential({ ...AUTH, policyContent: "# just a comment\n" }),
    ).rejects.toThrow(/EMPTY RDF graph/);
  });

  it("the SYNC builder refuses policyContent rather than silently dropping the binding", () => {
    expect(() => buildAgentAuthorizationCredential({ ...AUTH, policyContent: POLICY_TTL })).toThrow(
      /cannot bind policyContent/,
    );
  });

  it("the binding lands in the SIGNED claim graph (relatedResource + digest quads)", async () => {
    const credential = await buildBoundAgentAuthorizationCredential({
      ...AUTH,
      policyContent: POLICY_TTL,
    });
    const quads = credentialToRdf({ ...credential, id: "urn:uuid:g1-signed-graph" });
    const relatedQuad = quads.find((q) => q.predicate.value === VC_RELATED_RESOURCE);
    expect(expectDefined(relatedQuad, "relatedResource quad").object.value).toBe(POLICY_IRI);
    const digestQuad = quads.find((q) => q.predicate.value === SEC_DIGEST_MULTIBASE);
    expect(expectDefined(digestQuad, "digest quad").subject.value).toBe(POLICY_IRI);
    expect(digestQuad?.object.value).toBe(await digestRdfContent(POLICY_TTL));
  });

  it("round-trips through Turtle: parse → relatedResourcesFromNode returns the binding", async () => {
    const credential = await buildBoundAgentAuthorizationCredential({
      ...AUTH,
      policyContent: POLICY_TTL,
      id: "urn:uuid:g1-roundtrip",
    });
    const turtle = await credentialToTurtle(credential);
    const node = expectDefined(
      credentialFromRdf(await parseCredentialRdf(turtle)),
      "credential node",
    );
    const related = relatedResourcesFromNode(node);
    expect(related).toHaveLength(1);
    expect(related[0]?.id).toBe(POLICY_IRI);
    expect(related[0]?.digestMultibase).toBe(await digestRdfContent(POLICY_TTL));
    expect(related[0]?.mediaType).toBe("text/turtle");
  });

  it("projects relatedResource into the JSON-LD document", async () => {
    const credential = await buildBoundAgentAuthorizationCredential({
      ...AUTH,
      policyContent: POLICY_TTL,
    });
    const doc = credentialToJsonLd(credential);
    expect(doc.relatedResource).toEqual([
      {
        id: POLICY_IRI,
        digestMultibase: await digestRdfContent(POLICY_TTL),
        mediaType: "text/turtle",
      },
    ]);
  });

  it("REFUSES a relatedResource with a non-absolute id in BOTH projections (fail closed)", async () => {
    const credential = await buildBoundAgentAuthorizationCredential({
      ...AUTH,
      policyContent: POLICY_TTL,
    });
    const forged = {
      ...credential,
      relatedResource: [{ id: "not-an-iri", digestMultibase: "zabc" }],
    };
    expect(() => credentialToRdf(forged)).toThrow(/relatedResource\.id/);
    expect(() => credentialToJsonLd(forged)).toThrow(/relatedResource\.id/);
  });
});

describe("verifyCredential presentedResources (the fail-closed digest check)", () => {
  it("VERIFIES a bound credential presented with the exact policy", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization({ ...AUTH, policyContent: POLICY_TTL }, key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      presentedResources: { [POLICY_IRI]: { content: POLICY_TTL, contentType: "text/turtle" } },
    });
    expect(result.verified).toBe(true);
    expect(result.errors).toEqual([]);
    // The signed VC carries the binding.
    expect(vc.relatedResource?.[0]?.digestMultibase).toBe(await digestRdfContent(POLICY_TTL));
  });

  it("VERIFIES when presented a reordered-but-isomorphic serialisation of the same policy", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization({ ...AUTH, policyContent: POLICY_TTL }, key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      presentedResources: { [POLICY_IRI]: { content: POLICY_TTL_REORDERED } },
    });
    expect(result.verified).toBe(true);
  });

  it("REJECTS a SUBSTITUTED policy (same IRI, different content)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization({ ...AUTH, policyContent: POLICY_TTL }, key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      presentedResources: { [POLICY_IRI]: { content: POLICY_TTL_SUBSTITUTED } },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("RELATED_RESOURCE_MISMATCH");
  });

  it("REJECTS a minimally MUTATED policy (one action changed)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization({ ...AUTH, policyContent: POLICY_TTL }, key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      presentedResources: { [POLICY_IRI]: { content: POLICY_TTL_MUTATED } },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("RELATED_RESOURCE_MISMATCH");
  });

  it("REJECTS (missing digest) a bare-IRI credential when a policy is presented", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key); // no policyContent → no binding
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      presentedResources: { [POLICY_IRI]: { content: POLICY_TTL } },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("RELATED_RESOURCE_MISSING");
  });

  it("REJECTS a relatedResource entry that carries NO digestMultibase", async () => {
    const key = await issuerKey();
    const credential = buildAgentAuthorizationCredential(AUTH);
    const vc = await issue({
      credential: { ...credential, relatedResource: [{ id: POLICY_IRI }] },
      key,
    });
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      presentedResources: { [POLICY_IRI]: { content: POLICY_TTL } },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("RELATED_RESOURCE_MISSING");
  });

  it("REJECTS unparseable presented content (fail closed, never throws)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization({ ...AUTH, policyContent: POLICY_TTL }, key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      presentedResources: { [POLICY_IRI]: { content: "not turtle <<<" } },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("RELATED_RESOURCE_MISMATCH");
  });

  it("REJECTS empty presented content (digests nothing, matches nothing)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization({ ...AUTH, policyContent: POLICY_TTL }, key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      presentedResources: { [POLICY_IRI]: { content: "" } },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("RELATED_RESOURCE_MISMATCH");
  });

  it("REJECTS a tampered digestMultibase — the binding is SIGNED (INVALID_SIGNATURE)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization({ ...AUTH, policyContent: POLICY_TTL }, key);
    // The attack: swap the policy AND update the digest so the digest check
    // passes — the signature over the claim graph (which includes the digest
    // triple) must catch it.
    const forgedDigest = await digestRdfContent(POLICY_TTL_SUBSTITUTED);
    const tampered: VerifiableCredential = {
      ...vc,
      relatedResource: [{ id: POLICY_IRI, digestMultibase: forgedDigest }],
    };
    const result = await verifyCredential(tampered, {
      resolveKey: keyResolver(key),
      presentedResources: { [POLICY_IRI]: { content: POLICY_TTL_SUBSTITUTED } },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("REJECTS a tampered relatedResource id (signed graph changed)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization({ ...AUTH, policyContent: POLICY_TTL }, key);
    const related = expectDefined(vc.relatedResource, "relatedResource")[0];
    const tampered: VerifiableCredential = {
      ...vc,
      relatedResource: [
        { ...expectDefined(related, "entry"), id: "https://evil.example/other-policy" },
      ],
    };
    const result = await verifyCredential(tampered, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("REJECTS when ANY of several presented resources mismatches", async () => {
    const key = await issuerKey();
    const otherIri = "https://alice.example/policies/other#agreement";
    const otherTtl = POLICY_TTL.replaceAll(POLICY_IRI, otherIri);
    const credential = await buildBoundAgentAuthorizationCredential({
      ...AUTH,
      policyContent: POLICY_TTL,
    });
    const vc = await issue({
      credential: {
        ...credential,
        relatedResource: [
          ...(credential.relatedResource ?? []),
          { id: otherIri, digestMultibase: await digestRdfContent(otherTtl) },
        ],
      },
      key,
    });
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      presentedResources: {
        [POLICY_IRI]: { content: POLICY_TTL },
        [otherIri]: { content: POLICY_TTL_MUTATED.replaceAll(POLICY_IRI, otherIri) },
      },
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("RELATED_RESOURCE_MISMATCH");
  });

  it("keeps the bare path unchanged: no presentedResources → no binding gate", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key);
    const result = await verifyCredential(vc, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(true);
  });
});

describe("verifyRelatedResources (the standalone digest gate)", () => {
  it("passes for the exact and the isomorphic policy", async () => {
    const credential = await buildBoundAgentAuthorizationCredential({
      ...AUTH,
      policyContent: POLICY_TTL,
    });
    const exact = await verifyRelatedResources(credential, {
      [POLICY_IRI]: { content: POLICY_TTL },
    });
    expect(exact.verified).toBe(true);
    const isomorphic = await verifyRelatedResources(credential, {
      [POLICY_IRI]: { content: POLICY_TTL_REORDERED },
    });
    expect(isomorphic.verified).toBe(true);
  });

  it("fails closed on substitution and on a missing binding", async () => {
    const bound = await buildBoundAgentAuthorizationCredential({
      ...AUTH,
      policyContent: POLICY_TTL,
    });
    const substituted = await verifyRelatedResources(bound, {
      [POLICY_IRI]: { content: POLICY_TTL_SUBSTITUTED },
    });
    expect(substituted.verified).toBe(false);
    expect(substituted.errors[0]?.code).toBe("RELATED_RESOURCE_MISMATCH");

    const bare = buildAgentAuthorizationCredential(AUTH);
    const missing = await verifyRelatedResources(bare, {
      [POLICY_IRI]: { content: POLICY_TTL },
    });
    expect(missing.verified).toBe(false);
    expect(missing.errors[0]?.code).toBe("RELATED_RESOURCE_MISSING");
  });
});
