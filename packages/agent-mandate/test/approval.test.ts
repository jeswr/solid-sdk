// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { parseRdf } from "@jeswr/fetch-rdf";
import type { KeyPair, WebIdKeyResolver } from "@jeswr/solid-vc";
import { beforeAll, expect, it } from "vitest";
import { type Approval, issueApproval, verifyApproval } from "../src/approval.js";
import { node, SEC, turtle } from "../src/rdf.js";
import {
  alterProofOptions,
  approvalKey,
  clock,
  edKey,
  NOW,
  OWNER,
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
beforeAll(async () => {
  key = await approvalKey();
  resolver = await profileResolver(key);
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
  const store = await parseRdf(document, "text/turtle");
  const proof = node(store, a.id).one(`${SEC}proof`);
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
  const store = await parseRdf(doc, "text/turtle");
  node(store, a.id).setText(`${SEC}publicKeyJwk`, "test-token-0123456789");
  expect(
    await verifyApproval(await turtle(store), {
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
