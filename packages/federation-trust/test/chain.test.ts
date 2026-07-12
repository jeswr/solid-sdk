// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Adversarial tests for the DELEGATION CHAIN — the R9 O2 "Scheme-Authority
// composition across scope": a root trust anchor delegates to a sub-authority,
// which issues a membership credential. The verifier trusts the membership because
// the SELF-CERTIFYING chain proves the anchor (transitively) authorized the
// sub-authority for THIS federation. The root link is verified with the anchor's
// PINNED key (never a caller key) and each link carries the next delegate's signed
// key — so a forged "from-anchor" link cannot pass. Every broken-chain attack must
// fail closed.

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

/** A valid one-hop chain: ROOT delegates to SUB (embedding SUB's pubkey) for a federation. */
async function validChain(federation = FEDERATION): Promise<DelegationLink[]> {
  const delegation = await issueDelegation({
    delegator: ROOT,
    authority: SUB,
    delegateKey: subKey.publicKey,
    federation,
    key: rootKey,
  });
  return [{ credential: delegation }];
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
    });
    expect(res.errors).toEqual([]);
    expect(res.verified).toBe(true);
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
      delegateKey: midKey.publicKey,
      federation: FEDERATION,
      key: rootKey,
    });
    const midToSub = await issueDelegation({
      delegator: Mid,
      authority: SUB,
      delegateKey: subKey.publicKey,
      federation: FEDERATION,
      key: midKey,
    });
    const chain: DelegationLink[] = [{ credential: rootToMid }, { credential: midToSub }];
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      expectedApp: APP,
      chain,
    });
    expect(res.errors).toEqual([]);
    expect(res.verified).toBe(true);
  });
});

describe("broken chain → reject (fail closed)", () => {
  it("rejects a FORGED 'from-anchor' link signed by an attacker key (the bypass)", async () => {
    // The attacker mints a delegation claiming issuer=ROOT, delegating ROOT → SUB,
    // but signs it with their OWN key (the anchor IRI as the key id). Because the
    // root link is verified with the ANCHOR'S PINNED key, the forged signature must
    // fail — this is the High-severity bypass the self-certifying chain closes.
    const attackerKey = await generateKeyPairForSuite(ROOT, "Ed25519");
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const forged = await issueDelegation({
      delegator: ROOT, // claims to be the anchor
      authority: SUB,
      delegateKey: subKey.publicKey,
      federation: FEDERATION,
      key: attackerKey, // but signed with the attacker's key
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: [{ credential: forged }],
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects a membership whose issuer key differs from the chain-proven delegate key", async () => {
    // The chain delegates ROOT → SUB embedding SUB's REAL key, but the membership
    // is signed with a DIFFERENT SUB key — the chain-proven key must not verify it.
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const otherSubKey = await generateKeyPairForSuite(SUB, "Ed25519");
    const delegation = await issueDelegation({
      delegator: ROOT,
      authority: SUB,
      delegateKey: otherSubKey.publicKey, // embeds the WRONG key for SUB
      federation: FEDERATION,
      key: rootKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: [{ credential: delegation }],
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("rejects when the first chain link is NOT issued by a trust anchor", async () => {
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    // A delegation issued by SUB (not the root anchor) — the chain does not root in
    // a trusted anchor.
    const rogueDelegation = await issueDelegation({
      delegator: SUB,
      authority: SUB,
      delegateKey: subKey.publicKey,
      federation: FEDERATION,
      key: subKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: [{ credential: rogueDelegation }],
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
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects when the chain leaf does not delegate to the membership issuer", async () => {
    // The membership is issued by SUB, but the chain delegates ROOT → someone-else.
    const other = "https://different-sub.example/card#me";
    const otherKey = await generateKeyPairForSuite(other, "Ed25519");
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const delegation = await issueDelegation({
      delegator: ROOT,
      authority: other,
      delegateKey: otherKey.publicKey,
      federation: FEDERATION,
      key: rootKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: [{ credential: delegation }],
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
      delegateKey: subKey.publicKey,
      federation: FEDERATION,
      key: rootKey,
      validFrom: "2020-01-01T00:00:00Z",
      validUntil: "2020-12-31T00:00:00Z",
      created: new Date("2020-06-01T00:00:00Z"),
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: [{ credential: delegation }],
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects a two-hop chain presented OUT OF ORDER (MID-link first)", async () => {
    const Mid = "https://mid.example/card#me";
    const midKey = await generateKeyPairForSuite(Mid, "Ed25519");
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const rootToMid = await issueDelegation({
      delegator: ROOT,
      authority: Mid,
      delegateKey: midKey.publicKey,
      federation: FEDERATION,
      key: rootKey,
    });
    const midToSub = await issueDelegation({
      delegator: Mid,
      authority: SUB,
      delegateKey: subKey.publicKey,
      federation: FEDERATION,
      key: midKey,
    });
    const outOfOrder: DelegationLink[] = [{ credential: midToSub }, { credential: rootToMid }];
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: outOfOrder,
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("BROKEN_CHAIN");
  });

  it("rejects an empty chain when the issuer is not a direct anchor", async () => {
    const vc = await issueMembershipCredential({
      claim: { federation: FEDERATION, app: APP, status: "Active", assertedBy: SUB },
      key: subKey,
    });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [rootAnchor],
      expectedFederation: FEDERATION,
      chain: [],
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("UNTRUSTED_AUTHORITY");
  });
});
