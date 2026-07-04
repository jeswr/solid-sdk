// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// G15(b) — countersigning as a Data Integrity PROOF SET. A countersignature is a
// parallel, independent attestation over the SAME claim graph; verify requires
// EVERY proof valid. Exhaustive + adversarial: proof-set (not chain) semantics,
// existing-proof-byte preservation, the fail-closed producer guards, and the
// verify-side conjunction.

import { describe, expect, it } from "vitest";
import { countersign } from "../src/countersign.js";
import { issueAgentAuthorization } from "../src/issue.js";
import { generateKeyPairForSuite } from "../src/keys.js";
import type { DataIntegrityProof, VerifiableCredential } from "../src/types.js";
import { verifyCredential } from "../src/verify.js";
import { ACL_READ, AGENT, ISSUER, issuerKey, keyResolver } from "./helpers.js";

const AUTH = {
  principal: ISSUER,
  agent: AGENT,
  action: ACL_READ,
  target: "https://alice.example/notes/",
  policy: "https://alice.example/p.ttl#policy",
} as const;

const VM2 = `${ISSUER}#key-2`;
const VM3 = `${ISSUER}#key-3`;

function proofArray(vc: VerifiableCredential): DataIntegrityProof[] {
  return Array.isArray(vc.proof) ? [...vc.proof] : [vc.proof];
}

describe("countersign — proof SET semantics", () => {
  it("appends a second proof; both verify (verified true)", async () => {
    const key1 = await issuerKey();
    const key2 = await generateKeyPairForSuite(VM2);
    const vc = await issueAgentAuthorization(AUTH, key1);
    const cvc = await countersign(vc, key2);

    const proofs = proofArray(cvc);
    expect(proofs).toHaveLength(2);

    const result = await verifyCredential(cvc, { resolveKey: keyResolver(key1, key2) });
    expect(result.verified).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("preserves the original proof bytes exactly (unchanged, in order)", async () => {
    const key1 = await issuerKey();
    const key2 = await generateKeyPairForSuite(VM2);
    const vc = await issueAgentAuthorization(AUTH, key1);
    const original = Array.isArray(vc.proof) ? vc.proof[0] : vc.proof;
    const cvc = await countersign(vc, key2);
    const proofs = proofArray(cvc);
    // First proof is byte-for-byte the original (same object, deep-equal).
    expect(proofs[0]).toEqual(original);
    expect(proofs[0]?.proofValue).toBe(original?.proofValue);
    // The new proof is a distinct, different signature by the co-signer.
    expect(proofs[1]?.verificationMethod).toBe(VM2);
    expect(proofs[1]?.proofValue).not.toBe(original?.proofValue);
  });

  it("does not mutate the claims (non-proof fields deep-equal)", async () => {
    const key1 = await issuerKey();
    const key2 = await generateKeyPairForSuite(VM2);
    const vc = await issueAgentAuthorization(AUTH, key1);
    const { proof: _p1, ...restOrig } = vc;
    const cvc = await countersign(vc, key2);
    const { proof: _p2, ...restNew } = cvc;
    expect(restNew).toEqual(restOrig);
    // And the input object was not mutated in place.
    expect(Array.isArray(vc.proof)).toBe(false);
  });

  it("is a proof SET not a chain: each proof verifies independently over the proofless graph", async () => {
    const key1 = await issuerKey();
    const key2 = await generateKeyPairForSuite(VM2);
    const vc = await issueAgentAuthorization(AUTH, key1);
    const cvc = await countersign(vc, key2);
    const proofs = proofArray(cvc);

    // The SECOND proof alone (first proof REMOVED) must still verify — proof-set
    // independence. A proof CHAIN would fail here (it would need the first proof
    // present in the signed bytes).
    const onlySecond: VerifiableCredential = { ...cvc, proof: proofs[1] as DataIntegrityProof };
    const r2 = await verifyCredential(onlySecond, { resolveKey: keyResolver(key2) });
    expect(r2.verified).toBe(true);

    // The FIRST proof alone likewise verifies.
    const onlyFirst: VerifiableCredential = { ...cvc, proof: proofs[0] as DataIntegrityProof };
    const r1 = await verifyCredential(onlyFirst, { resolveKey: keyResolver(key1) });
    expect(r1.verified).toBe(true);
  });

  it("a third countersignature appends a 3rd proof and all three verify", async () => {
    const key1 = await issuerKey();
    const key2 = await generateKeyPairForSuite(VM2);
    const key3 = await generateKeyPairForSuite(VM3);
    const vc = await issueAgentAuthorization(AUTH, key1);
    const cvc = await countersign(await countersign(vc, key2), key3);
    expect(proofArray(cvc)).toHaveLength(3);
    const result = await verifyCredential(cvc, { resolveKey: keyResolver(key1, key2, key3) });
    expect(result.verified).toBe(true);
  });

  it("supports a genuinely third-party co-signer with a custom issuer-binding check", async () => {
    // A countersignature by a DIFFERENT WebID: verify needs an isControlledBy that
    // authorizes the co-signer's method too (default binding requires the issuer).
    const key1 = await issuerKey();
    const carolVm = "https://carol.example/profile#me#key";
    const carolKey = await generateKeyPairForSuite(carolVm);
    const vc = await issueAgentAuthorization(AUTH, key1);
    const cvc = await countersign(vc, carolKey);
    const result = await verifyCredential(cvc, {
      resolveKey: keyResolver(key1, carolKey),
      isControlledBy: (vm, issuer) =>
        vm === carolVm || vm === issuer || vm.startsWith(`${issuer}#`),
    });
    expect(result.verified).toBe(true);
  });
});

describe("countersign — the verify-side conjunction (every proof must be valid)", () => {
  it("fails on the countersignature's proof when the co-signer key is wrong", async () => {
    const key1 = await issuerKey();
    const key2 = await generateKeyPairForSuite(VM2);
    const wrong = await generateKeyPairForSuite(VM2); // same vm, different keys
    const vc = await issueAgentAuthorization(AUTH, key1);
    const cvc = await countersign(vc, key2);
    // Resolver returns the WRONG public key for VM2 → that proof's signature fails.
    const result = await verifyCredential(cvc, { resolveKey: keyResolver(key1, wrong) });
    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_SIGNATURE")).toBe(true);
  });

  it("fails the whole credential if ANY one of three proofs' key is wrong", async () => {
    const key1 = await issuerKey();
    const key2 = await generateKeyPairForSuite(VM2);
    const key3 = await generateKeyPairForSuite(VM3);
    const wrong2 = await generateKeyPairForSuite(VM2);
    const vc = await issueAgentAuthorization(AUTH, key1);
    const cvc = await countersign(await countersign(vc, key2), key3);
    // key1 + key3 resolve correctly; key2 resolves to a wrong key → conjunction fails.
    const result = await verifyCredential(cvc, {
      resolveKey: keyResolver(key1, wrong2, key3),
    });
    expect(result.verified).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_SIGNATURE")).toBe(true);
  });
});

describe("countersign — fail-closed producer guards", () => {
  it("throws when countersigning a credential that carries NO proof", async () => {
    const key2 = await generateKeyPairForSuite(VM2);
    const unsignedVc = {
      issuer: ISSUER,
      credentialSubject: { id: "https://bob.example/#me", over18: true },
    } as unknown as VerifiableCredential;
    await expect(countersign(unsignedVc, key2)).rejects.toThrow(/already carries a proof/);
  });

  it("throws when the input is not structurally a signed credential (no issuer)", async () => {
    const key2 = await generateKeyPairForSuite(VM2);
    const bogus = { credentialSubject: { id: "x" }, proof: [] } as unknown as VerifiableCredential;
    await expect(countersign(bogus, key2)).rejects.toThrow(/structurally signed credential/);
  });

  it("throws when the input has no credentialSubject", async () => {
    const key2 = await generateKeyPairForSuite(VM2);
    const bogus = {
      issuer: ISSUER,
      proof: { type: "DataIntegrityProof" },
    } as unknown as VerifiableCredential;
    await expect(countersign(bogus, key2)).rejects.toThrow(/structurally signed credential/);
  });
});
