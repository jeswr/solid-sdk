// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The SECURITY-CRITICAL verification surface — exhaustive. A signed credential
// must verify; EVERY tamper / expiry / binding / purpose / trust failure must be
// REJECTED with the correct structured error code, never silently accepted and
// never thrown.

import { describe, expect, it } from "vitest";
import { issue, issueAgentAuthorization } from "../src/issue.js";
import { DataIntegritySuite } from "../src/proof.js";
import type { Credential, VerifiableCredential } from "../src/types.js";
import { verifyCredential } from "../src/verify.js";
import { ACL_READ, AGENT, expectDefined, ISSUER, issuerKey, keyResolver } from "./helpers.js";

const AUTH = {
  principal: ISSUER,
  agent: AGENT,
  action: ACL_READ,
  target: "https://alice.example/notes/",
  policy: "https://alice.example/p.ttl#policy",
} as const;

describe("happy path", () => {
  it("verifies a freshly issued EdDSA agent-authorization credential", async () => {
    const key = await issuerKey("Ed25519");
    const vc = await issueAgentAuthorization(AUTH, key);
    const result = await verifyCredential(vc, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.issuer).toBe(ISSUER);
  });

  it("verifies an ECDSA (P-256) credential too", async () => {
    const key = await issuerKey("P-256");
    const suite = new DataIntegritySuite("ecdsa-rdfc-2019");
    const vc = await issueAgentAuthorization(AUTH, key, { suite });
    expect(vc.proof.cryptosuite).toBe("ecdsa-rdfc-2019");
    const result = await verifyCredential(vc, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(true);
  });

  it("verifies a generic (non-agent) credential with a subject id", async () => {
    const key = await issuerKey();
    const cred: Credential = {
      issuer: ISSUER,
      credentialSubject: { id: "https://carol.example/#me", over18: true },
    };
    const vc = await issue({ credential: cred, key });
    const result = await verifyCredential(vc, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(true);
  });
});

describe("tamper detection (INVALID_SIGNATURE)", () => {
  it("rejects a changed action claim", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key);
    const subj = expectDefined(
      Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject,
      "credential subject",
    );
    const tampered: VerifiableCredential = {
      ...vc,
      credentialSubject: {
        ...subj,
        "https://w3id.org/jeswr/solid-vc#action": "http://www.w3.org/ns/auth/acl#Write",
      },
    };
    const result = await verifyCredential(tampered, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("rejects a swapped issuer", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key);
    const tampered: VerifiableCredential = { ...vc, issuer: "https://mallory.example/#me" };
    const result = await verifyCredential(tampered, {
      resolveKey: keyResolver(key),
      // disable issuer-binding so we isolate the signature failure
      isControlledBy: () => true,
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("rejects a tampered proofValue (flipped byte)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key);
    const flipped = `${vc.proof.proofValue.slice(0, -2)}${vc.proof.proofValue.slice(-2) === "11" ? "22" : "11"}`;
    const tampered: VerifiableCredential = { ...vc, proof: { ...vc.proof, proofValue: flipped } };
    const result = await verifyCredential(tampered, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(false);
  });

  it("rejects a malformed (non-base58) proofValue without throwing", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key);
    const tampered: VerifiableCredential = {
      ...vc,
      proof: { ...vc.proof, proofValue: "not a multibase string!!!" },
    };
    const result = await verifyCredential(tampered, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });

  it("rejects a proof verified against a DIFFERENT key", async () => {
    const key = await issuerKey();
    const attackerKey = await issuerKey(); // same vm IRI, different keypair
    const vc = await issueAgentAuthorization(AUTH, key);
    const result = await verifyCredential(vc, { resolveKey: keyResolver(attackerKey) });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("INVALID_SIGNATURE");
  });
});

describe("expiry + validity window", () => {
  it("rejects an expired credential (EXPIRED)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(
      { ...AUTH, validFrom: "2024-01-01T00:00:00.000Z", validUntil: "2024-06-01T00:00:00.000Z" },
      key,
    );
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("EXPIRED");
  });

  it("accepts a credential that is within its validity window", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(
      { ...AUTH, validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-12-31T00:00:00.000Z" },
      key,
    );
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      now: new Date("2026-06-15T00:00:00.000Z"),
    });
    expect(result.verified).toBe(true);
  });

  it("rejects a not-yet-valid credential (NOT_YET_VALID)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(
      { ...AUTH, validFrom: "2030-01-01T00:00:00.000Z" },
      key,
    );
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("NOT_YET_VALID");
  });
});

describe("issuer binding (ISSUER_MISMATCH)", () => {
  it("rejects a verificationMethod not controlled by the issuer", async () => {
    const key = await issuerKey();
    // sign with a method that is NOT a fragment/path of the issuer
    const foreignKey = { ...key, verificationMethod: "https://mallory.example/keys#k" };
    const vc = await issueAgentAuthorization(AUTH, foreignKey);
    const result = await verifyCredential(vc, { resolveKey: keyResolver(foreignKey) });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("ISSUER_MISMATCH");
  });

  it("accepts the issuer IRI itself as a verificationMethod", async () => {
    const key = { ...(await issuerKey()), verificationMethod: ISSUER };
    const vc = await issueAgentAuthorization(AUTH, key);
    const result = await verifyCredential(vc, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(true);
  });

  it("honours a custom isControlledBy (e.g. a DID controller relationship)", async () => {
    const key = { ...(await issuerKey()), verificationMethod: "did:key:zABC#zABC" };
    const vc = await issueAgentAuthorization(AUTH, key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      isControlledBy: (vm) => vm === "did:key:zABC#zABC",
    });
    expect(result.verified).toBe(true);
  });
});

describe("proof purpose (PROOF_PURPOSE_MISMATCH)", () => {
  it("rejects a proof whose purpose is not the expected one", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key, {
      options: { proofPurpose: "authentication" },
    });
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      expectedProofPurpose: "assertionMethod",
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("PROOF_PURPOSE_MISMATCH");
  });

  it("accepts a matching non-default purpose", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key, {
      options: { proofPurpose: "authentication" },
    });
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      expectedProofPurpose: "authentication",
    });
    expect(result.verified).toBe(true);
  });
});

describe("cryptosuite + trust + structural gates", () => {
  it("rejects an unknown cryptosuite (UNKNOWN_CRYPTOSUITE)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key);
    const forged: VerifiableCredential = {
      ...vc,
      proof: { ...vc.proof, cryptosuite: "totally-made-up-2099" },
    };
    const result = await verifyCredential(forged, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("UNKNOWN_CRYPTOSUITE");
  });

  it("rejects an untrusted issuer when an allowlist is given (UNTRUSTED_ISSUER)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      trustedIssuers: ["https://someone-else.example/#me"],
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("UNTRUSTED_ISSUER");
  });

  it("accepts a trusted issuer in the allowlist", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key);
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      trustedIssuers: [ISSUER],
    });
    expect(result.verified).toBe(true);
  });

  it("rejects a credential with no proof (NO_PROOF)", async () => {
    const malformed = {
      issuer: ISSUER,
      credentialSubject: { id: "https://x.example/#s" },
    } as unknown as VerifiableCredential;
    const result = await verifyCredential(malformed, { resolveKey: () => undefined });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("NO_PROOF");
  });

  it("rejects a structurally-malformed document (MALFORMED)", async () => {
    const result = await verifyCredential({} as unknown as VerifiableCredential, {
      resolveKey: () => undefined,
    });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("MALFORMED");
  });

  it("reports MULTIPLE distinct failures at once (expiry + untrusted)", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(
      { ...AUTH, validUntil: "2024-01-01T00:00:00.000Z" },
      key,
    );
    const result = await verifyCredential(vc, {
      resolveKey: keyResolver(key),
      now: new Date("2026-01-01T00:00:00.000Z"),
      trustedIssuers: ["https://other.example/#me"],
    });
    expect(result.verified).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("EXPIRED");
    expect(codes).toContain("UNTRUSTED_ISSUER");
  });
});

describe("multi-proof credentials", () => {
  it("requires EVERY proof to be valid", async () => {
    const key = await issuerKey();
    const vc = await issueAgentAuthorization(AUTH, key);
    const single = expectDefined(Array.isArray(vc.proof) ? vc.proof[0] : vc.proof, "proof");
    // one good proof + one bad (forged cryptosuite) proof
    const multi: VerifiableCredential = {
      ...vc,
      proof: [single, { ...single, cryptosuite: "unknown-2099" }],
    };
    const result = await verifyCredential(multi, { resolveKey: keyResolver(key) });
    expect(result.verified).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("UNKNOWN_CRYPTOSUITE");
  });
});
