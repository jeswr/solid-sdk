// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Adversarial tests for the DELEGATION CHAIN — the R9 O2 "Scheme-Authority
// composition across scope": a root trust anchor delegates to a sub-authority,
// which issues a membership credential. The verifier trusts the membership because
// the chain proves the anchor (transitively) authorized the sub-authority for THIS
// federation. Every broken-chain attack must fail closed.

import { beforeAll, describe, expect, it } from "vitest";
import {
  generateKeyPairForSuite,
  issueDelegation,
  issueMembershipCredential,
  type KeyPair,
  type TrustAnchor,
  verifyMembershipCredential,
} from "../src/index.js";
import type { DelegationLink } from "../src/types.js";

const ROOT = "https://root.example/card#me";
const SUB = "https://regional.example/card#me";
const FEDERATION = "https://root.example/federation";
const APP = "https://music.example/clientid.jsonld";

let rootKey: KeyPair;
let subKey: KeyPair;
let rootAnchor: TrustAnchor;

beforeAll(async () => {
  rootKey = await generateKeyPairForSuite(ROOT, "Ed25519");
  subKey = await generateKeyPairForSuite(SUB, "Ed25519");
  rootAnchor = { authority: ROOT, verificationMethod: ROOT, publicKey: rootKey.publicKey };
});

/** A valid one-hop chain: ROOT delegates to SUB for FEDERATION. */
async function validChain(federation = FEDERATION): Promise<DelegationLink[]> {
  const delegation = await issueDelegation({
    delegator: ROOT,
    authority: SUB,
    federation,
    key: rootKey,
  });
  return [
    {
      credential: delegation,
      delegatorKey: { verificationMethod: ROOT, publicKey: rootKey.publicKey },
    },
  ];
}

describe("valid delegation chain → accept", () => {
  it("verifies a membership issued by a sub-authority a trust anchor delegated to", async () => {
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      expectedApp: APP,
      chain: await validChain(),
      issuerKey: { verificationMethod: SUB, publicKey: subKey.publicKey },
    });
    expect(res.errors).toEqual([]);
    expect(res.verified).toBe(true);
  });
});

describe("broken chain → reject (fail closed)", () => {
  it("rejects when the chain is valid but no issuerKey is supplied", async () => {
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: await validChain(),
      // issuerKey deliberately omitted
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects when the first chain link is NOT signed by a trust anchor", async () => {
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    // A delegation signed by SUB (not the root anchor) — the chain does not root in
    // a trusted anchor.
    const rogueDelegation = await issueDelegation({
      delegator: SUB,
      authority: SUB,
      federation: FEDERATION,
      key: subKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: [
        {
          credential: rogueDelegation,
          delegatorKey: { verificationMethod: SUB, publicKey: subKey.publicKey },
        },
      ],
      issuerKey: { verificationMethod: SUB, publicKey: subKey.publicKey },
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects a chain scoped to a DIFFERENT federation", async () => {
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: await validChain("https://other.example/federation"),
      issuerKey: { verificationMethod: SUB, publicKey: subKey.publicKey },
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects a chain whose link signature is verified against the WRONG delegator key", async () => {
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const wrongKey = await generateKeyPairForSuite(ROOT, "Ed25519");
    const delegation = await issueDelegation({
      delegator: ROOT,
      authority: SUB,
      federation: FEDERATION,
      key: rootKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      // The link carries a delegatorKey whose public key is NOT the one that signed.
      chain: [
        {
          credential: delegation,
          delegatorKey: { verificationMethod: ROOT, publicKey: wrongKey.publicKey },
        },
      ],
      issuerKey: { verificationMethod: SUB, publicKey: subKey.publicKey },
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects when the chain leaf does not delegate to the membership issuer", async () => {
    // The membership is issued by SUB, but the chain delegates ROOT → someone-else.
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const delegation = await issueDelegation({
      delegator: ROOT,
      authority: "https://different-sub.example/card#me",
      federation: FEDERATION,
      key: rootKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: [
        {
          credential: delegation,
          delegatorKey: { verificationMethod: ROOT, publicKey: rootKey.publicKey },
        },
      ],
      issuerKey: { verificationMethod: SUB, publicKey: subKey.publicKey },
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects an expired delegation link", async () => {
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const delegation = await issueDelegation({
      delegator: ROOT,
      authority: SUB,
      federation: FEDERATION,
      key: rootKey,
      validFrom: "2020-01-01T00:00:00Z",
      validUntil: "2020-12-31T00:00:00Z",
      created: new Date("2020-06-01T00:00:00Z"),
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: [
        {
          credential: delegation,
          delegatorKey: { verificationMethod: ROOT, publicKey: rootKey.publicKey },
        },
      ],
      issuerKey: { verificationMethod: SUB, publicKey: subKey.publicKey },
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects a two-hop chain that is out of order", async () => {
    // ROOT → MID, MID → SUB; presented in the WRONG order (MID-link first).
    const Mid = "https://mid.example/card#me";
    const midKey = await generateKeyPairForSuite(Mid, "Ed25519");
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const rootToMid = await issueDelegation({
      delegator: ROOT,
      authority: Mid,
      federation: FEDERATION,
      key: rootKey,
    });
    const midToSub = await issueDelegation({
      delegator: Mid,
      authority: SUB,
      federation: FEDERATION,
      key: midKey,
    });
    const outOfOrder: DelegationLink[] = [
      {
        credential: midToSub,
        delegatorKey: { verificationMethod: Mid, publicKey: midKey.publicKey },
      },
      {
        credential: rootToMid,
        delegatorKey: { verificationMethod: ROOT, publicKey: rootKey.publicKey },
      },
    ];
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: outOfOrder,
      issuerKey: { verificationMethod: SUB, publicKey: subKey.publicKey },
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("verifies a correctly-ordered two-hop chain ROOT → MID → SUB", async () => {
    const Mid = "https://mid.example/card#me";
    const midKey = await generateKeyPairForSuite(Mid, "Ed25519");
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const rootToMid = await issueDelegation({
      delegator: ROOT,
      authority: Mid,
      federation: FEDERATION,
      key: rootKey,
    });
    const midToSub = await issueDelegation({
      delegator: Mid,
      authority: SUB,
      federation: FEDERATION,
      key: midKey,
    });
    const chain: DelegationLink[] = [
      {
        credential: rootToMid,
        delegatorKey: { verificationMethod: ROOT, publicKey: rootKey.publicKey },
      },
      {
        credential: midToSub,
        delegatorKey: { verificationMethod: Mid, publicKey: midKey.publicKey },
      },
    ];
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      expectedApp: APP,
      chain,
      issuerKey: { verificationMethod: SUB, publicKey: subKey.publicKey },
    });
    expect(res.errors).toEqual([]);
    expect(res.verified).toBe(true);
  });
});
