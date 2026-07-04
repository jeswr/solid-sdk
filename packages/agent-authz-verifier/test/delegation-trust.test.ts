// AUTHORED-BY Claude Fable 5
//
// Adversarial regression tests for the DELEGATION-TRUST identity anchor (a HIGH
// roborev finding on the first extraction, 758607c): the delegating principal /
// assigner used for chain-of-authority MUST be the PROOF-VERIFIED `vc.issuer`,
// never the self-asserted `credentialSubject.id`. `verifyCredential` proves the
// signature against `issuer` + key control but does NOT constrain the subject id,
// so an attacker who controls their OWN valid issuer key could otherwise sign a
// credential naming a trusted party in `subject.id` and have the chain accept it
// as that party's grant — a full chain-of-trust bypass.
//
// The forged credentials here are GENUINELY signed by the attacker's own
// (registered, key-controlled) issuer, so they would sail through Phase A — they
// are rejected specifically for the subject↔issuer disagreement, fail-closed.

import {
  bitstringStatusListEntry,
  buildAgentAuthorizationCredential,
  generateKeyPairForSuite,
  issue,
  SVC,
  type VerifiableCredential,
} from "@jeswr/solid-vc";
import { beforeAll, describe, expect, it } from "vitest";
import { type PresentedChain, readBoundAuthorization, verifyAgentAuthority } from "../src/index.js";
import {
  buildFixture,
  CAST,
  type Fixture,
  makeStatusResolver,
  VALID_FROM,
  VALID_UNTIL,
} from "./fixture.js";

const ATTACKER = "https://attacker.example/id#it";
const ATTACKER_KEY_VM = "https://attacker.example/keys#k1";

let base: Fixture;

beforeAll(async () => {
  base = await buildFixture();
  // The attacker owns a REAL, resolvable, self-controlled issuer key — so their
  // signatures verify and pass the issuer↔key-control gate. The only thing wrong
  // is the subject id they claim.
  const attackerKey = await generateKeyPairForSuite(ATTACKER_KEY_VM, "Ed25519");
  base.registry.register(ATTACKER, attackerKey);
  attackerSigningKey = attackerKey;
});

let attackerSigningKey: Awaited<ReturnType<typeof generateKeyPairForSuite>>;

/** Sign a credential built for `principal` but re-attributed to the attacker issuer. */
async function forgeWithAttackerIssuer(input: {
  principal: string;
  agent: string;
  action: string | readonly string[];
  policy: string;
  /** Attach a Bitstring status entry so the G2 status gate has something to gate on. */
  credentialStatus?: Parameters<typeof buildAgentAuthorizationCredential>[0]["credentialStatus"];
}) {
  const unsigned = buildAgentAuthorizationCredential({
    principal: input.principal, // → sets subject.id to the SPOOFED (trusted) party
    agent: input.agent,
    action: input.action,
    target: CAST.records,
    policy: input.policy,
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    ...(input.credentialStatus !== undefined && { credentialStatus: input.credentialStatus }),
  });
  // Re-attribute issuance to the attacker and sign with the attacker's key. The
  // subject id stays the spoofed party; issuer is now the attacker. A genuine,
  // fully-verifiable credential whose subject.id lies about who granted it.
  return issue({ credential: { ...unsigned, issuer: ATTACKER }, key: attackerSigningKey });
}

/** Flip one character of a signed credential's proof value (an invalid signature). */
function tamperProof(vc: VerifiableCredential): VerifiableCredential {
  const copy = structuredClone(vc) as VerifiableCredential & {
    proof: { proofValue: string } | { proofValue: string }[];
  };
  const proof = Array.isArray(copy.proof) ? copy.proof[0] : copy.proof;
  if (proof !== undefined) {
    const v = proof.proofValue;
    proof.proofValue = v.slice(0, -1) + (v.endsWith("z") ? "A" : "z");
  }
  return copy as VerifiableCredential;
}

const statusValid = () => makeStatusResolver("valid");

describe("delegation-trust — the principal is the proof-verified issuer, not subject.id", () => {
  it("SUBJECT-SPOOFED ROOT: attacker-issued credential whose subject.id claims the trusted root → REJECTED (never accepted as the root's grant)", async () => {
    // issuer = attacker (valid signature, key-controlled), subject.id = Alice (the
    // resource owner / trusted root), authorizes = agentA (so the rest of the chain
    // would otherwise line up). The pre-fix reader trusted subject.id and accepted
    // this as Alice's mandate — the impersonation.
    const forgedRoot = await forgeWithAttackerIssuer({
      principal: CAST.alice,
      agent: CAST.agentA,
      action: ["read", "grantUse"],
      policy: CAST.mandateId,
    });
    const chain: PresentedChain = {
      credentials: [forgedRoot, base.credentials.agreement],
      policies: [base.mandate, base.agreement],
    };
    const r = await verifyAgentAuthority(chain, {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.purpose, dateTime: base.now.toISOString() },
      },
      rootPrincipal: CAST.alice, // the party the attacker is trying to impersonate
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: statusValid(),
      actor: CAST.inst,
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("SUBJECT_ISSUER_MISMATCH");
  });

  it("PHASE ORDERING: a credential with BOTH a bad proof AND a spoofed subject reports the Phase-A code, not SUBJECT_ISSUER_MISMATCH", async () => {
    // The subject↔issuer check runs INSIDE Phase B (after Phase A verifies each
    // hop's proof). A credential whose proof is invalid must fail at Phase A and
    // report its Phase-A code — a genuine proof failure wins over the downstream
    // identity check. (The spoofed-subject attack still reaches the Phase-B check
    // because that attacker's credential IS validly signed by their real key.)
    const spoofedButValidlySigned = await forgeWithAttackerIssuer({
      principal: CAST.alice,
      agent: CAST.agentA,
      action: ["read", "grantUse"],
      policy: CAST.mandateId,
    });
    const badProofSpoof = tamperProof(spoofedButValidlySigned);
    const chain: PresentedChain = {
      credentials: [badProofSpoof, base.credentials.agreement],
      policies: [base.mandate, base.agreement],
    };
    const r = await verifyAgentAuthority(chain, {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.purpose, dateTime: base.now.toISOString() },
      },
      rootPrincipal: CAST.alice,
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: statusValid(),
      actor: CAST.inst,
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("A");
    expect(r.code).toBe("INVALID_SIGNATURE");
  });

  it("GATE PRECEDENCE — spoofed subject + bad policy-content digest: reports SUBJECT_ISSUER_MISMATCH, not POLICY_INTEGRITY", async () => {
    // The forged root has a VALID proof (attacker's own key) and a SPOOFED
    // subject.id (Alice), and — because it was built WITHOUT `policyContent` —
    // carries no `relatedResource` digest at all. Presenting the mandate's raw
    // content for this hop therefore ALSO fails the G1 digest gate
    // (RELATED_RESOURCE_MISSING). Pre-fix this reported `POLICY_INTEGRITY`
    // (Phase B) because the digest gate ran bundled into the same
    // `verifyCredential` call as the proof, before the separate subject-issuer
    // loop ever ran. The fix must report `SUBJECT_ISSUER_MISMATCH` — the
    // subject-issuer anchor now runs BEFORE the digest gate, per hop.
    const forgedRootBadDigest = await forgeWithAttackerIssuer({
      principal: CAST.alice,
      agent: CAST.agentA,
      action: ["read", "grantUse"],
      policy: CAST.mandateId,
    });
    const chain: PresentedChain = {
      credentials: [forgedRootBadDigest, base.credentials.agreement],
      policies: [base.mandate, base.agreement],
      policyContents: {
        [CAST.mandateId]: { content: base.policyDocuments.mandate },
      },
    };
    const r = await verifyAgentAuthority(chain, {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.purpose, dateTime: base.now.toISOString() },
      },
      rootPrincipal: CAST.alice,
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: statusValid(),
      actor: CAST.inst,
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("SUBJECT_ISSUER_MISMATCH");
  });

  it("GATE PRECEDENCE — spoofed subject + revoked status: reports SUBJECT_ISSUER_MISMATCH, not REVOKED", async () => {
    // The forged root also carries a Bitstring `credentialStatus` entry, and
    // the injected status resolver reports it revoked. Pre-fix this reported
    // `REVOKED` (Phase C) because the bundled `verifyCredential` call ran the
    // status gate before the separate subject-issuer loop. The fix must still
    // report `SUBJECT_ISSUER_MISMATCH`.
    const forgedRootRevoked = await forgeWithAttackerIssuer({
      principal: CAST.alice,
      agent: CAST.agentA,
      action: ["read", "grantUse"],
      policy: CAST.mandateId,
      credentialStatus: bitstringStatusListEntry({
        statusPurpose: "revocation",
        statusListIndex: 7,
        statusListCredential: CAST.statusListUrl,
      }),
    });
    const chain: PresentedChain = {
      credentials: [forgedRootRevoked, base.credentials.agreement],
      policies: [base.mandate, base.agreement],
    };
    const r = await verifyAgentAuthority(chain, {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.purpose, dateTime: base.now.toISOString() },
      },
      rootPrincipal: CAST.alice,
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: makeStatusResolver("revoked"),
      actor: CAST.inst,
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("SUBJECT_ISSUER_MISMATCH");
  });

  it("GATE PRECEDENCE — spoofed subject + unreachable status: reports SUBJECT_ISSUER_MISMATCH, not STATUS_RETRIEVAL_ERROR", async () => {
    // Same shape as the revoked case, but the injected status resolver reports
    // the entry unreachable (a retrieval failure). Pre-fix this reported
    // `STATUS_RETRIEVAL_ERROR` (Phase C); the fix must still report
    // `SUBJECT_ISSUER_MISMATCH`.
    const forgedRootUnreachable = await forgeWithAttackerIssuer({
      principal: CAST.alice,
      agent: CAST.agentA,
      action: ["read", "grantUse"],
      policy: CAST.mandateId,
      credentialStatus: bitstringStatusListEntry({
        statusPurpose: "revocation",
        statusListIndex: 7,
        statusListCredential: CAST.statusListUrl,
      }),
    });
    const chain: PresentedChain = {
      credentials: [forgedRootUnreachable, base.credentials.agreement],
      policies: [base.mandate, base.agreement],
    };
    const r = await verifyAgentAuthority(chain, {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.purpose, dateTime: base.now.toISOString() },
      },
      rootPrincipal: CAST.alice,
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: makeStatusResolver("unreachable"),
      actor: CAST.inst,
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("SUBJECT_ISSUER_MISMATCH");
  });

  it("SUBJECT-SPOOFED CHILD: attacker-issued hop whose subject.id claims the parent-authorized delegatee → REJECTED", async () => {
    // The mandate authorizes agentA as the delegatee. The attacker issues the
    // agreement hop with subject.id = agentA (spoofing the authorized delegatee)
    // but issuer = attacker. Pre-fix, principal = subject.id = agentA lined the hop
    // up under the mandate; now the subject↔issuer check rejects it.
    const forgedChild = await forgeWithAttackerIssuer({
      principal: CAST.agentA,
      agent: CAST.inst,
      action: "read",
      policy: CAST.agreementId,
    });
    const chain: PresentedChain = {
      credentials: [base.credentials.mandate, forgedChild],
      policies: [base.mandate, base.agreement],
    };
    const r = await verifyAgentAuthority(chain, {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.purpose, dateTime: base.now.toISOString() },
      },
      rootPrincipal: CAST.alice,
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: statusValid(),
      actor: CAST.inst,
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("SUBJECT_ISSUER_MISMATCH");
  });

  it("CHILD ISSUER ≠ PARENT-AUTHORIZED DELEGATEE: a self-consistent hop NOT issued by the authorized delegatee → REJECTED (BINDING_MISMATCH)", async () => {
    // A well-formed (subject.id == issuer == attacker) agreement hop — but the
    // mandate authorized agentA, not the attacker, as the delegatee. The
    // issuer-anchored linkage catches it: principal (= issuer = attacker) ≠ the
    // hop's assigner (agentA, from the policy) and ≠ the parent's authorized
    // delegate. Proves the delegation edge is bound to the proof-verified issuer.
    const selfConsistentRogue = await issue({
      credential: buildAgentAuthorizationCredential({
        principal: ATTACKER, // issuer == subject.id == attacker (self-consistent)
        agent: CAST.inst,
        action: "read",
        target: CAST.records,
        policy: CAST.agreementId,
        validFrom: VALID_FROM,
        validUntil: VALID_UNTIL,
      }),
      key: attackerSigningKey,
    });
    const chain: PresentedChain = {
      credentials: [base.credentials.mandate, selfConsistentRogue],
      policies: [base.mandate, base.agreement],
    };
    const r = await verifyAgentAuthority(chain, {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.purpose, dateTime: base.now.toISOString() },
      },
      rootPrincipal: CAST.alice,
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: statusValid(),
      actor: CAST.inst,
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("BINDING_MISMATCH");
  });

  it("LEGITIMATE SELF-ISSUED still passes: subject.id == issuer for every hop → authorized", async () => {
    const chain: PresentedChain = {
      credentials: [base.credentials.mandate, base.credentials.agreement],
      policies: [base.mandate, base.agreement],
      policyContents: {
        [CAST.mandateId]: { content: base.policyDocuments.mandate },
        [CAST.agreementId]: { content: base.policyDocuments.agreement },
      },
    };
    const r = await verifyAgentAuthority(chain, {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.purpose, dateTime: base.now.toISOString() },
      },
      rootPrincipal: CAST.alice,
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: statusValid(),
      actor: CAST.inst, // actor IS the leaf assignee — no second chain needed
    });
    expect(r.authorized).toBe(true);
    expect(r.phase).toBe("complete");
  });

  it("readBoundAuthorization anchors principal to the proof-verified issuer, NOT a spoofed subject.id", () => {
    // Directly at the reader: even a (here unsigned) credential whose subject.id
    // names the trusted root reports the ISSUER as principal — the trust decision
    // never reads the spoofable subject id.
    const auth = readBoundAuthorization({
      issuer: ATTACKER,
      type: ["AgentAuthorizationCredential"],
      credentialSubject: { id: CAST.alice, [`${SVC}authorizes`]: CAST.agentA },
      proof: {
        type: "DataIntegrityProof",
        cryptosuite: "eddsa-rdfc-2022",
        proofPurpose: "assertionMethod",
        proofValue: "z1",
        verificationMethod: ATTACKER_KEY_VM,
      },
    });
    expect(auth?.principal).toBe(ATTACKER);
    expect(auth?.principal).not.toBe(CAST.alice);
  });
});
