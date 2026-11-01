// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { parseRdf } from "@jeswr/fetch-rdf";
import { DataIntegritySuite, type KeyPair, type WebIdKeyResolver } from "@jeswr/solid-vc";
import { DataFactory, type Store } from "n3";
import { beforeAll, expect, it } from "vitest";
import {
  type Approval,
  issueApproval,
  readApprovalClaims,
  verifyApproval,
} from "../src/approval.js";
import { Node, node, RDF_TYPE, readProof, SEC, trig, writeProof } from "../src/rdf.js";
import {
  alterProofGraph,
  alterProofOptions,
  approvalKey,
  clock,
  edKey,
  expectStandardProof,
  INVALID_INSTANTS,
  MILLISECOND_FRACTIONS,
  NOW,
  OWNER,
  PROOF_GRAPH_CHANGES,
  profileResolver,
  verifyExportedRdf,
} from "./helpers.js";

let key: KeyPair;
let resolver: WebIdKeyResolver;
const a: Approval = {
  id: "https://pod.example/agent/approvals/1",
  approves: "https://pod.example/agent/proposals/1",
  termsDigest: "sha256:test-terms",
  expires: "2026-10-27T12:00:00Z",
  decision: "approve",
};
const options = () => ({
  id: a.id,
  ownerWebId: OWNER,
  proposal: a.approves,
  termsDigest: a.termsDigest,
  webIdKeyResolver: resolver,
  now: clock,
});
async function signedChange(change: (claims: Store) => void): Promise<string> {
  const doc = await issueApproval(a, key, NOW);
  const { claims } = readProof(await parseRdf(doc, "application/trig"), a.id);
  change(claims);
  const proof = await new DataIntegritySuite("ecdsa-rdfc-2019").sign([...claims], {
    key,
    proofPurpose: "assertionMethod",
    created: NOW,
  });
  writeProof(claims, a.id, proof);
  return trig(claims);
}
it.each([
  ["expires", a.expires, "en"],
  ["expires", a.expires, DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#dateTime")],
  ["termsDigest", a.termsDigest, "en"],
  ["termsDigest", a.termsDigest, DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#token")],
  ["decision", a.decision, "en"],
  ["decision", a.decision, DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#integer")],
  ["approves", a.approves, "en"],
  ["approves", a.approves, DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#anyURI")],
] as const)("rejects signed approval literal with invalid datatype/language: %s %#", async (field, value, datatype) => {
  const doc = await signedChange((claims) => {
    const predicate = `https://jeswr.org/ns/agent#${field}`;
    claims.removeQuads([...claims].filter((q) => q.predicate.value === predicate));
    const subject = node(claims, a.id);
    subject.setValue(
      predicate,
      new Node(DataFactory.literal(value, datatype), claims, subject.factory),
    );
  });
  expect(await verifyExportedRdf(doc, a.id, key.publicKey)).toBe(true);
  expect(await verifyApproval(doc, options())).toEqual({ valid: false, reason: "malformed" });
  expect(await readApprovalClaims(doc, a.id)).toBeUndefined();
});
it("rejects a signed IRI in place of an approval string literal", async () => {
  const doc = await signedChange((claims) => {
    const predicate = "https://jeswr.org/ns/agent#termsDigest";
    claims.removeQuads([...claims].filter((q) => q.predicate.value === predicate));
    node(claims, a.id).setIri(predicate, "urn:terms");
  });
  expect(await verifyApproval(doc, options())).toEqual({ valid: false, reason: "malformed" });
  expect(await readApprovalClaims(doc, a.id)).toBeUndefined();
});
it("rejects a signed record of the wrong approval type", async () => {
  const doc = await signedChange((claims) => {
    claims.removeQuads([...claims].filter((q) => q.predicate.value === RDF_TYPE));
    node(claims, a.id).setIri(RDF_TYPE, "https://jeswr.org/ns/agent#ControlStatement");
  });
  expect(await verifyApproval(doc, options())).toEqual({ valid: false, reason: "proposal" });
  expect(await readApprovalClaims(doc, a.id)).toBeUndefined();
});
it.each(
  INVALID_INSTANTS,
)("rejects a signed invalid or lossy approval expiry: %s", async (expires) => {
  const doc = await issueApproval({ ...a, expires }, key, NOW);
  expect(
    await verifyApproval(doc, {
      ...options(),
      now: () => new Date("2026-01-01T00:00:00Z"),
    }),
  ).toEqual({ valid: false, reason: "expired" });
});
it.each(
  MILLISECOND_FRACTIONS,
)("preserves lossless signed approval fractions: %s", async (fraction) => {
  const approval = { ...a, expires: `2026-10-26T12:00:00.${fraction}Z` };
  const doc = await issueApproval(approval, key, NOW);
  const expiry = Date.parse(approval.expires);
  expect(await verifyApproval(doc, { ...options(), now: () => new Date(expiry - 1) })).toEqual({
    valid: true,
    approval,
  });
  expect(await verifyApproval(doc, { ...options(), now: () => new Date(expiry) })).toEqual({
    valid: false,
    reason: "expired",
  });
});
beforeAll(async () => {
  key = await approvalKey();
  resolver = await profileResolver(key);
});
it.each(PROOF_GRAPH_CHANGES)("rejects altered approval proof graphs: %s", async (change) => {
  const document = await alterProofGraph(await issueApproval(a, key, NOW), a.id, change);
  expect((await verifyApproval(document, options())).valid).toBe(false);
});
it("verifies real P-256 signatures using a fixture WebID assertionMethod", async () => {
  expect(key.privateKey.extractable).toBe(false);
  for (const decision of ["approve", "deny"] as const) {
    const doc = await issueApproval({ ...a, decision }, key, NOW);
    expect(await verifyApproval(doc, options())).toEqual({
      valid: true,
      approval: { ...a, decision },
    });
  }
});
it("verifies the exported approval proof configuration independently with WebCrypto", async () => {
  const document = await issueApproval(a, key, NOW);
  expect(await verifyExportedRdf(document, a.id, key.publicKey)).toBe(true);
  await expectStandardProof(document, a.id);
  const store = await parseRdf(document, "application/trig");
  const { p: proof } = readProof(store, a.id);
  expect(proof.termType).toBe("BlankNode");
  const cryptosuite = proof.one(`${SEC}cryptosuite`);
  expect((cryptosuite as unknown as { datatype: { value: string } }).datatype.value).toBe(
    `${SEC}cryptosuiteString`,
  );
  const created = proof.one("http://purl.org/dc/terms/created");
  expect((created as unknown as { datatype: { value: string } }).datatype.value).toBe(
    "http://www.w3.org/2001/XMLSchema#dateTime",
  );
});
it.each([
  "named",
  "datatype",
  "cryptosuite-datatype",
  "extra",
] as const)("rejects altered approval proof configuration: %s", async (change) => {
  const document = await alterProofOptions(await issueApproval(a, key, NOW), a.id, change);
  expect(await verifyExportedRdf(document, a.id, key.publicKey)).toBe(false);
  expect(await verifyApproval(document, options())).toEqual({ valid: false, reason: "signature" });
});
it("rejects a non-P256 signing key", async () => {
  await expect(issueApproval(a, await edKey(), NOW)).rejects.toThrow("P-256");
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, [
    "sign",
    "verify",
  ]);
  await expect(
    issueApproval(a, { ...pair, verificationMethod: key.verificationMethod }, NOW),
  ).rejects.toThrow("P-256");
});
it("checks proof type before consulting a WebID resolver", async () => {
  const doc = await issueApproval(a, key, NOW);
  for (const changed of [
    doc.replace("ecdsa-rdfc-2019", "eddsa-rdfc-2022"),
    doc.replace("security#DataIntegrityProof", "security#Other"),
    doc.replace("security#assertionMethod", "security#authentication"),
  ]) {
    expect(
      await verifyApproval(changed, {
        ...options(),
        webIdKeyResolver: {
          resolveKey() {
            throw new Error("must not resolve");
          },
          isControlledBy() {
            throw new Error("must not resolve");
          },
        },
      }),
    ).toEqual({ valid: false, reason: "proof-type" });
  }
});
it("rejects unlisted, missing and wrong keys and never uses embedded keys", async () => {
  const doc = await issueApproval(a, key, NOW);
  const wrong = await approvalKey();
  const ed = await edKey();
  const p384 = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, [
    "sign",
    "verify",
  ]);
  for (const [publicKey, controlled, reason] of [
    [key.publicKey, false, "key"],
    [undefined, true, "key"],
    [ed.publicKey, true, "key"],
    [p384.publicKey, true, "key"],
    [wrong.publicKey, true, "signature"],
  ] as const) {
    expect(
      await verifyApproval(doc, {
        ...options(),
        webIdKeyResolver: {
          isControlledBy: async () => controlled,
          resolveKey: async () => publicKey,
        },
      }),
    ).toEqual({ valid: false, reason });
  }
  const store = await parseRdf(doc, "application/trig");
  node(store, a.id).setText(`${SEC}publicKeyJwk`, "test-token-0123456789");
  expect(
    await verifyApproval(await trig(store), {
      ...options(),
      webIdKeyResolver: {
        isControlledBy: async () => false,
        resolveKey: async () => key.publicKey,
      },
    }),
  ).toEqual({ valid: false, reason: "key" });
});
it("rejects changed signed terms before comparing expected terms", async () => {
  const doc = await issueApproval(a, key, NOW);
  expect(await verifyApproval(doc.replace(a.termsDigest, "changed"), options())).toEqual({
    valid: false,
    reason: "signature",
  });
  expect(
    await verifyApproval(doc, { ...options(), proposal: "https://pod.example/other" }),
  ).toEqual({ valid: false, reason: "proposal" });
  expect(await verifyApproval(doc, { ...options(), termsDigest: "different-length" })).toEqual({
    valid: false,
    reason: "terms-digest",
  });
  expect(
    await verifyApproval(
      await issueApproval({ ...a, expires: NOW.toISOString() }, key, NOW),
      options(),
    ),
  ).toEqual({ valid: false, reason: "expired" });
  expect(
    await verifyApproval(await issueApproval({ ...a, expires: "invalid" }, key, NOW), options()),
  ).toEqual({ valid: false, reason: "expired" });
  expect(
    await verifyApproval(
      await issueApproval({ ...a, decision: "maybe" as "approve" }, key, NOW),
      options(),
    ),
  ).toEqual({ valid: false, reason: "decision" });
});
it("rejects malformed RDF and duplicate claims", async () => {
  expect(await verifyApproval("not RDF", options())).toEqual({ valid: false, reason: "malformed" });
  const doc = await issueApproval(a, key, NOW);
  expect(
    await verifyApproval(doc, {
      ...options(),
      webIdKeyResolver: {
        isControlledBy: async () => {
          throw new Error("offline");
        },
        resolveKey: async () => undefined,
      },
    }),
  ).toEqual({ valid: false, reason: "malformed" });
});

it("reads unsigned approval claims for display only, even when expired or tampered", async () => {
  for (const decision of ["approve", "deny"] as const) {
    const approval = { ...a, decision, expires: "2020-01-01T00:00:00Z" };
    const doc = await issueApproval(approval, key, NOW);
    expect(await readApprovalClaims(doc, a.id)).toEqual(approval);
    const changed = doc.replace(a.termsDigest, "unverified display terms");
    expect(await readApprovalClaims(changed, a.id)).toEqual({
      ...approval,
      termsDigest: "unverified display terms",
    });
    expect(await verifyApproval(changed, options())).toEqual({ valid: false, reason: "signature" });
  }
});
it("refuses malformed or ambiguous approval display claims", async () => {
  const doc = await issueApproval(a, key, NOW);
  for (const changed of [
    "garbage",
    doc.replace("agent#Approval", "agent#ControlStatement"),
    doc.replace('"approve"', '"maybe"'),
  ])
    expect(await readApprovalClaims(changed, a.id)).toBeUndefined();
  expect(await readApprovalClaims(doc, "urn:missing")).toBeUndefined();
  const store = await parseRdf(doc, "application/trig");
  node(store, a.id).setText("https://jeswr.org/ns/agent#termsDigest", "duplicate");
  expect(await readApprovalClaims(await trig(store), a.id)).toBeUndefined();
});
