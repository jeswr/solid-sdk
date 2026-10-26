// AUTHORED-BY Codex GPT-6.1-Sol

import type { KeyPair, WebIdKeyResolver } from "@jeswr/solid-vc";
import { beforeAll, expect, it } from "vitest";
import { type Approval, issueApproval, verifyApproval } from "../src/approval.js";
import { approvalKey, clock, edKey, NOW, OWNER, profileResolver } from "./helpers.js";

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
  expect(
    await verifyApproval(
      `${doc}\n<${a.id}> <https://w3id.org/security#publicKeyJwk> "test-token-0123456789" .`,
      {
        ...options(),
        webIdKeyResolver: {
          isControlledBy: async () => false,
          resolveKey: async () => key.publicKey,
        },
      },
    ),
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
