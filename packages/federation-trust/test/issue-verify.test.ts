// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Adversarial tests for the SIGNED MEMBERSHIP CHALLENGE. A signed membership
// credential is a security primitive: the tests below are written to be
// EXHAUSTIVE about the ways an attacker tries to make a bad credential verify, and
// every one MUST fail closed. The happy path is one test; the rest are attacks.

import { beforeAll, describe, expect, it } from "vitest";
import {
  generateKeyPairForSuite,
  issueMembershipCredential,
  type KeyPair,
  type MembershipClaim,
  type TrustAnchor,
  verifyMembershipCredential,
} from "../src/index.js";
import type { VerifiableCredential } from "../src/types.js";

const AUTHORITY = "https://registry.example/profile/card#me";
const AUTHORITY_VM = `${AUTHORITY}`; // the authority signs with its WebID as the key id
const FEDERATION = "https://registry.example/federation";
const APP = "https://music.example/clientid.jsonld";

let authorityKey: KeyPair;
let anchor: TrustAnchor;

/** A fresh, fully-specified Active membership claim. */
function activeClaim(overrides: Partial<MembershipClaim> = {}): MembershipClaim {
  return {
    federation: FEDERATION,
    app: APP,
    status: "Active",
    assertedBy: AUTHORITY,
    ...overrides,
  };
}

/** The verify options for the standard, single-anchor verifier. */
function opts(extra: Record<string, unknown> = {}) {
  return {
    trustAnchors: [anchor],
    expectedFederation: FEDERATION,
    expectedApp: APP,
    ...extra,
  };
}

beforeAll(async () => {
  authorityKey = await generateKeyPairForSuite(AUTHORITY_VM, "Ed25519");
  anchor = {
    authority: AUTHORITY,
    verificationMethod: AUTHORITY_VM,
    publicKey: authorityKey.publicKey,
  };
});

describe("issue → verify round-trip (the happy path)", () => {
  it("verifies a valid, Active, anchor-issued membership credential", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const res = await verifyMembershipCredential(vc, opts());
    expect(res.errors).toEqual([]);
    expect(res.verified).toBe(true);
    expect(res.claim).toMatchObject({
      federation: FEDERATION,
      app: APP,
      status: "Active",
      assertedBy: AUTHORITY,
    });
  });

  it("issues a fedtrust:MembershipCredential typed VC with an embedded proof", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    expect(vc.type).toContain("https://w3id.org/jeswr/fedtrust#MembershipCredential");
    expect(vc.issuer).toBe(AUTHORITY);
    expect(vc.proof).toBeDefined();
    const proof = Array.isArray(vc.proof) ? vc.proof[0] : vc.proof;
    expect(proof?.cryptosuite).toBe("eddsa-rdfc-2022");
    expect(proof?.proofValue).toMatch(/^z/); // multibase base58btc
  });

  it("verifies with ECDSA (P-256) keys too", async () => {
    const ecKey = await generateKeyPairForSuite(AUTHORITY_VM, "P-256");
    const ecAnchor: TrustAnchor = {
      authority: AUTHORITY,
      verificationMethod: AUTHORITY_VM,
      publicKey: ecKey.publicKey,
    };
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: ecKey });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [ecAnchor],
      expectedFederation: FEDERATION,
      expectedApp: APP,
    });
    expect(res.verified).toBe(true);
  });
});

describe("tamper → reject (the signature must cover every claim)", () => {
  it("rejects a tampered membership graph (app swapped after signing)", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    // Swap the app in the SIGNED subject after the fact — the signature no longer
    // covers these bytes.
    const subj = (
      Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
    ) as Record<string, unknown>;
    const tampered: VerifiableCredential = {
      ...vc,
      credentialSubject: {
        ...subj,
        "https://w3id.org/jeswr/fedreg#app": "https://evil.example/clientid.jsonld",
        id: "https://evil.example/clientid.jsonld",
      },
    };
    const res = await verifyMembershipCredential(tampered, {
      trustAnchors: [anchor],
      expectedFederation: FEDERATION,
      // do NOT pin expectedApp here, so the failure is the SIGNATURE, not APP_MISMATCH
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("rejects a tampered status (Active downgraded to nothing / changed after signing)", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const subj = (
      Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
    ) as Record<string, unknown>;
    const tampered: VerifiableCredential = {
      ...vc,
      credentialSubject: {
        ...subj,
        "https://w3id.org/jeswr/fedreg#status": "https://w3id.org/jeswr/fedreg#Revoked",
      },
    };
    const res = await verifyMembershipCredential(tampered, opts());
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("rejects a tampered federation (anti-replay across federations, signature break)", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const subj = (
      Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
    ) as Record<string, unknown>;
    const tampered: VerifiableCredential = {
      ...vc,
      credentialSubject: {
        ...subj,
        "https://w3id.org/jeswr/fedtrust#federation": "https://other.example/federation",
      },
    };
    const res = await verifyMembershipCredential(tampered, {
      trustAnchors: [anchor],
      expectedApp: APP,
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });
});

describe("wrong key → reject", () => {
  it("rejects when the trust anchor holds a DIFFERENT public key than the signer", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const otherKey = await generateKeyPairForSuite(AUTHORITY_VM, "Ed25519");
    const wrongAnchor: TrustAnchor = {
      authority: AUTHORITY,
      verificationMethod: AUTHORITY_VM,
      publicKey: otherKey.publicKey, // wrong key for this authority
    };
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [wrongAnchor],
      expectedFederation: FEDERATION,
      expectedApp: APP,
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("rejects an issuer that is not a trust anchor at all (untrusted authority)", async () => {
    const rogueKey = await generateKeyPairForSuite("https://rogue.example/card#me", "Ed25519");
    const vc = await issueMembershipCredential({
      claim: activeClaim({ assertedBy: "https://rogue.example/card#me" }),
      key: rogueKey,
    });
    const res = await verifyMembershipCredential(vc, opts());
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("UNTRUSTED_AUTHORITY");
  });

  it("rejects when NO trust anchors are supplied (verifier trusts nobody)", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const res = await verifyMembershipCredential(vc, {
      trustAnchors: [],
      expectedFederation: FEDERATION,
    });
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("NO_TRUST_ANCHOR");
  });
});

describe("expiry / not-yet-valid → reject", () => {
  it("rejects an expired credential", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ validFrom: "2020-01-01T00:00:00Z", validUntil: "2020-12-31T00:00:00Z" }),
      key: authorityKey,
      created: new Date("2020-06-01T00:00:00Z"),
    });
    const res = await verifyMembershipCredential(
      vc,
      opts({ now: new Date("2026-01-01T00:00:00Z") }),
    );
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("EXPIRED");
  });

  it("rejects a not-yet-valid credential", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ validFrom: "2030-01-01T00:00:00Z" }),
      key: authorityKey,
      created: new Date("2030-01-01T00:00:00Z"),
    });
    const res = await verifyMembershipCredential(
      vc,
      opts({ now: new Date("2026-01-01T00:00:00Z") }),
    );
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("NOT_YET_VALID");
  });

  it("accepts a credential within its validity window", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ validFrom: "2025-01-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z" }),
      key: authorityKey,
      created: new Date("2025-06-01T00:00:00Z"),
    });
    const res = await verifyMembershipCredential(
      vc,
      opts({ now: new Date("2026-06-01T00:00:00Z") }),
    );
    expect(res.verified).toBe(true);
  });
});

describe("status → reject non-Active by default", () => {
  for (const status of ["Proposed", "Suspended", "Revoked"] as const) {
    it(`rejects a ${status} membership by default (only Active is trusted)`, async () => {
      const vc = await issueMembershipCredential({
        claim: activeClaim({ status }),
        key: authorityKey,
      });
      const res = await verifyMembershipCredential(vc, opts());
      expect(res.verified).toBe(false);
      expect(res.errors.map((e) => e.code)).toContain("STATUS_NOT_TRUSTED");
    });
  }

  it("accepts a Suspended membership when the verifier explicitly accepts it", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ status: "Suspended" }),
      key: authorityKey,
    });
    const res = await verifyMembershipCredential(
      vc,
      opts({ acceptStatuses: ["Active", "Suspended"] }),
    );
    expect(res.verified).toBe(true);
  });
});

describe("expectation mismatches → reject (anti-replay)", () => {
  it("rejects a credential for a different federation than expected", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ federation: "https://other.example/federation" }),
      key: authorityKey,
    });
    const res = await verifyMembershipCredential(vc, opts());
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("FEDERATION_MISMATCH");
  });

  it("rejects a credential for a different app than expected", async () => {
    const vc = await issueMembershipCredential({
      claim: activeClaim({ app: "https://other.example/clientid.jsonld" }),
      key: authorityKey,
    });
    const res = await verifyMembershipCredential(vc, opts());
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("APP_MISMATCH");
  });
});

describe("malformed / structural → reject", () => {
  it("rejects a credential whose signed assertedBy != issuer", async () => {
    // Issue normally (issuer = AUTHORITY), then tamper the assertedBy claim to a
    // DIFFERENT authority. This breaks the signature AND triggers ASSERTED_BY_MISMATCH.
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const subj = (
      Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
    ) as Record<string, unknown>;
    const tampered: VerifiableCredential = {
      ...vc,
      credentialSubject: {
        ...subj,
        "https://w3id.org/jeswr/fedreg#assertedBy": "https://someone-else.example/card#me",
      },
    };
    const res = await verifyMembershipCredential(tampered, opts());
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("ASSERTED_BY_MISMATCH");
  });

  it("rejects a credential that is not a fedtrust:MembershipCredential", async () => {
    const vc = await issueMembershipCredential({ claim: activeClaim(), key: authorityKey });
    const notMembership: VerifiableCredential = {
      ...vc,
      type: ["https://example.org/SomethingElse"],
    };
    const res = await verifyMembershipCredential(notMembership, opts());
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("MALFORMED");
  });

  it("rejects a non-object credential without throwing", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately feeding garbage.
    const res = await verifyMembershipCredential(null as any, opts());
    expect(res.verified).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain("MALFORMED");
  });
});
