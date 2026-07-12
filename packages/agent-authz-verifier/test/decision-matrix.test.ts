// AUTHORED-BY Claude Fable 5
//
// The GOLDEN-MASTER DECISION MATRIX, ported from the runtime's
// `test/decision-matrix.test.ts` @ 72ec20a: the happy path AND the negatives as
// first-class content. Each case pins the exact verdict — phase + error code —
// so a regression that silently weakens the verifier (a fail-open) is caught.
// Crypto is REAL (a forged signature actually fails to verify); the key and
// status seams are INJECTED in-memory doubles — exactly the seam contract this
// standalone package publishes (the runtime keeps the pod-document-resolved
// end-to-end variant of the same matrix; the verdicts must agree).

import type { OdrlPolicy, RequestContext } from "@jeswr/solid-odrl";
import {
  generateKeyPairForSuite,
  issueAgentAuthorization,
  type VerifiableCredential,
} from "@jeswr/solid-vc";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type PresentedChain,
  type VerifyAuthorityResult,
  verifyAgentAuthority,
} from "../src/index.js";
import {
  buildFixture,
  CAST,
  type Fixture,
  makeStatusResolver,
  VALID_FROM,
  VALID_UNTIL,
} from "./fixture.js";

/** Deep-clone a credential and flip one character of its proof value (a forged hop). */
function forge(vc: VerifiableCredential): VerifiableCredential {
  const copy = structuredClone(vc) as VerifiableCredential & {
    proof: { proofValue: string } | { proofValue: string }[];
  };
  const proof = Array.isArray(copy.proof) ? copy.proof[0] : copy.proof;
  if (proof !== undefined) {
    const v = proof.proofValue;
    // flip the last character to a different base58btc symbol
    proof.proofValue = v.slice(0, -1) + (v.endsWith("z") ? "A" : "z");
  }
  return copy as VerifiableCredential;
}

let base: Fixture;

/** A verify call over the base primary chain with per-case overrides. */
async function verify(overrides: {
  primary?: PresentedChain;
  request?: RequestContext;
  rootPrincipal?: string;
  now?: Date;
  revoked?: readonly string[];
  statusUnreachable?: boolean;
  actor?: string | undefined;
  actorChain?: PresentedChain | undefined;
  maxChainLength?: number;
  /** `undefined` (with the key present) = NO status resolver — the fail-closed case. */
  resolveStatus?: ReturnType<typeof makeStatusResolver> | undefined;
}): Promise<VerifyAuthorityResult> {
  // The default chains present the RAW issuance policy bytes (G1 enforced path).
  const primary: PresentedChain = overrides.primary ?? {
    credentials: [base.credentials.mandate, base.credentials.agreement],
    policies: [base.mandate, base.agreement],
    policyContents: {
      [CAST.mandateId]: { content: base.policyDocuments.mandate },
      [CAST.agreementId]: { content: base.policyDocuments.agreement },
    },
  };
  const actorChain: PresentedChain = overrides.actorChain ?? {
    credentials: [base.credentials.instituteAgent],
    policies: [base.instituteInternal],
    policyContents: {
      [CAST.instituteInternalId]: { content: base.policyDocuments.instituteInternal },
    },
  };
  return verifyAgentAuthority(primary, {
    request: overrides.request ?? {
      action: "read",
      target: CAST.records,
      attributes: {
        purpose: CAST.purpose,
        dateTime: (overrides.now ?? base.now).toISOString(),
      },
    },
    rootPrincipal: overrides.rootPrincipal ?? CAST.alice,
    now: overrides.now ?? base.now,
    resolveKey: base.registry.resolveKey,
    isControlledBy: base.registry.isControlledBy,
    // The injected status seam: an all-clear resolver by default — unless the
    // case explicitly passes `resolveStatus: undefined` (the fail-closed
    // missing-resolver row) or its own outcome.
    ...("resolveStatus" in overrides
      ? overrides.resolveStatus !== undefined && { resolveStatus: overrides.resolveStatus }
      : { resolveStatus: makeStatusResolver("valid") }),
    revoked: overrides.revoked ?? [],
    ...(overrides.statusUnreachable !== undefined && {
      statusUnreachable: overrides.statusUnreachable,
    }),
    ...(overrides.maxChainLength !== undefined && { maxChainLength: overrides.maxChainLength }),
    actor: "actor" in overrides ? overrides.actor : CAST.agentR,
    ...(overrides.actorChain !== undefined
      ? { actorChain: overrides.actorChain }
      : "actorChain" in overrides
        ? {}
        : { actorChain }),
  });
}

beforeAll(async () => {
  base = await buildFixture();
});

describe("the four-phase chain verifier — golden-master decision matrix", () => {
  it("HAPPY: the valid chain permits", async () => {
    const r = await verify({});
    expect({ authorized: r.authorized, phase: r.phase, code: r.code }).toEqual({
      authorized: true,
      phase: "complete",
      code: undefined,
    });
  });

  it("HAPPY: actor IS the leaf assignee — no second chain needed", async () => {
    const r = await verify({ actor: CAST.inst, actorChain: undefined });
    expect(r.authorized).toBe(true);
  });

  it("FORGED HOP: a tampered signature → Phase A INVALID_SIGNATURE (real crypto)", async () => {
    const r = await verify({
      primary: {
        credentials: [base.credentials.mandate, forge(base.credentials.agreement)],
        policies: [base.mandate, base.agreement],
      },
    });
    expect(r.phase).toBe("A");
    expect(r.code).toBe("INVALID_SIGNATURE");
    expect(r.authorized).toBe(false);
  });

  it("EXPIRED: now after the credential validUntil → Phase A EXPIRED", async () => {
    const r = await verify({ now: new Date("2027-08-01T00:00:00Z") });
    expect(r.phase).toBe("A");
    expect(r.code).toBe("EXPIRED");
  });

  it("NOT YET VALID: now before validFrom → Phase A NOT_YET_VALID", async () => {
    const r = await verify({ now: new Date("2026-01-01T00:00:00Z") });
    expect(r.phase).toBe("A");
    expect(r.code).toBe("NOT_YET_VALID");
  });

  it("CHAIN MALFORMED: a broken delegatedUnder edge → assembly CHAIN_MALFORMED", async () => {
    const brokenAgreement: OdrlPolicy = { ...base.agreement, delegatedUnder: "urn:not:present" };
    const r = await verify({
      primary: {
        credentials: [base.credentials.mandate, base.credentials.agreement],
        policies: [base.mandate, brokenAgreement],
      },
    });
    expect(r.phase).toBe("assembly");
    expect(r.code).toBe("CHAIN_MALFORMED");
  });

  it("BINDING MISMATCH: root credential issuer ≠ trusted root principal → Phase B", async () => {
    const r = await verify({ rootPrincipal: "https://attacker.example/profile#me" });
    expect(r.phase).toBe("B");
    expect(r.code).toBe("BINDING_MISMATCH");
  });

  it("POLICY SUBSTITUTED (G1): presented policy content ≠ the signed digest → Phase B POLICY_INTEGRITY", async () => {
    // The credentials are genuine, but the agreement hop is PRESENTED with a
    // different policy document (here: the mandate's bytes) — the substitution the
    // bare-IRI binding could not catch. The signed relatedResource digest no longer
    // matches → deny, fail-closed.
    const r = await verify({
      primary: {
        credentials: [base.credentials.mandate, base.credentials.agreement],
        policies: [base.mandate, base.agreement],
        policyContents: {
          [CAST.mandateId]: { content: base.policyDocuments.mandate },
          [CAST.agreementId]: { content: base.policyDocuments.mandate }, // substituted
        },
      },
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("POLICY_INTEGRITY");
  });

  it("POLICY UNBOUND (G1): content presented but the credential carries NO digest → Phase B POLICY_INTEGRITY", async () => {
    // A bare-IRI credential (no policyContent at issuance) presented WITH content:
    // solid-vc fails closed with RELATED_RESOURCE_MISSING — there is no signed
    // digest to check the presented document against.
    const unboundAgreementVc = await issueAgentAuthorization(
      {
        principal: CAST.agentA,
        agent: CAST.inst,
        action: "read",
        target: CAST.records,
        policy: CAST.agreementId,
        validFrom: VALID_FROM,
        validUntil: VALID_UNTIL,
      },
      base.keys.agentA,
    );
    const r = await verify({
      primary: {
        credentials: [base.credentials.mandate, unboundAgreementVc],
        policies: [base.mandate, base.agreement],
        policyContents: {
          [CAST.mandateId]: { content: base.policyDocuments.mandate },
          [CAST.agreementId]: { content: base.policyDocuments.agreement },
        },
      },
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("POLICY_INTEGRITY");
  });

  it("CONTENT NOT PRESENTED (G1): a chain without raw policy content still permits, but stays policyIntegrityProvisional", async () => {
    const r = await verify({
      primary: {
        credentials: [base.credentials.mandate, base.credentials.agreement],
        policies: [base.mandate, base.agreement],
      },
      actorChain: {
        credentials: [base.credentials.instituteAgent],
        policies: [base.instituteInternal],
      },
    });
    expect(r.authorized).toBe(true);
    expect(r.policyIntegrityProvisional).toBe(true);
  });

  it("HAPPY (G1 enforced): the fully content-bound chain's permit is NOT provisional", async () => {
    const r = await verify({});
    expect(r.authorized).toBe(true);
    expect(r.policyIntegrityProvisional).toBe(false);
    expect(r.actorResult?.policyIntegrityProvisional).toBe(false);
  });

  it("PROVISIONAL PROPAGATES: a content-bound primary chain with a location-trusted ACTOR chain stays provisional", async () => {
    const r = await verify({
      actorChain: {
        credentials: [base.credentials.instituteAgent],
        policies: [base.instituteInternal],
      },
    });
    expect(r.authorized).toBe(true);
    expect(r.policyIntegrityProvisional).toBe(true);
  });

  it("KEY UNRESOLVABLE: a credential signed with a key its issuer never published → Phase A deny", async () => {
    // The signature itself is well-formed, but the verification method is NOT in
    // the registry — resolution fails closed on BOTH seams (no key resolves, and
    // the issuer does not control the method). solid-vc reports the controller
    // failure first, so the pinned code is ISSUER_MISMATCH; the signature failure
    // is also in the reason.
    const ghost = await generateKeyPairForSuite(
      "https://alice.solid.example/keys#ghost",
      "Ed25519",
    );
    const ghostMandateVc = await issueAgentAuthorization(
      {
        principal: CAST.alice,
        agent: CAST.agentA,
        action: ["read", "grantUse"],
        target: CAST.records,
        policy: CAST.mandateId,
        policyContent: base.policyDocuments.mandate,
        validFrom: VALID_FROM,
        validUntil: VALID_UNTIL,
      },
      ghost,
    );
    const r = await verify({
      primary: {
        credentials: [ghostMandateVc, base.credentials.agreement],
        policies: [base.mandate, base.agreement],
        policyContents: {
          [CAST.mandateId]: { content: base.policyDocuments.mandate },
          [CAST.agreementId]: { content: base.policyDocuments.agreement },
        },
      },
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("A");
    expect(r.code).toBe("ISSUER_MISMATCH");
    expect(r.reason).toContain("signature");
  });

  it("KEY NOT ISSUER-CONTROLLED: a credential signed with ANOTHER party's published key → Phase A ISSUER_MISMATCH", async () => {
    // Signed with agent A's (registered, resolvable) key, but the credential
    // claims Alice as issuer/principal. The signature verifies against agent A's
    // key; the injected isControlledBy then fails because the method was
    // registered under agent A, not Alice — the exact cross-actor trust hole,
    // shut fail-closed.
    const crossSignedMandateVc = await issueAgentAuthorization(
      {
        principal: CAST.alice,
        agent: CAST.agentA,
        action: ["read", "grantUse"],
        target: CAST.records,
        policy: CAST.mandateId,
        policyContent: base.policyDocuments.mandate,
        validFrom: VALID_FROM,
        validUntil: VALID_UNTIL,
      },
      base.keys.agentA,
    );
    const r = await verify({
      primary: {
        credentials: [crossSignedMandateVc, base.credentials.agreement],
        policies: [base.mandate, base.agreement],
        policyContents: {
          [CAST.mandateId]: { content: base.policyDocuments.mandate },
          [CAST.agreementId]: { content: base.policyDocuments.agreement },
        },
      },
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("A");
    expect(r.code).toBe("ISSUER_MISMATCH");
  });

  it("REVOKED: a revoked chain hop (policy-level odrld:Revocation) → Phase C REVOKED", async () => {
    const r = await verify({ revoked: [CAST.agreementId] });
    expect(r.phase).toBe("C");
    expect(r.code).toBe("REVOKED");
  });

  it("STATUS UNREACHABLE (external source flag): fail-closed → Phase C STATUS_RETRIEVAL_ERROR", async () => {
    const r = await verify({ statusUnreachable: true });
    expect(r.phase).toBe("C");
    expect(r.code).toBe("STATUS_RETRIEVAL_ERROR");
  });

  it("STATUS REVOKED (G2): the status seam reports the mandate's bit SET → Phase C REVOKED", async () => {
    const r = await verify({ resolveStatus: makeStatusResolver("revoked") });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("C");
    expect(r.code).toBe("REVOKED");
    // and with the all-clear seam, the same chain permits again
    const again = await verify({});
    expect(again.authorized).toBe(true);
  });

  it("STATUS SUSPENDED (G2): the status seam reports suspension → Phase C SUSPENDED", async () => {
    const r = await verify({ resolveStatus: makeStatusResolver("suspended") });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("C");
    expect(r.code).toBe("SUSPENDED");
  });

  it("STATUS LIST UNREACHABLE (G2): the status seam cannot confirm → Phase C STATUS_RETRIEVAL_ERROR (never a silent pass)", async () => {
    const r = await verify({ resolveStatus: makeStatusResolver("unreachable") });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("C");
    expect(r.code).toBe("STATUS_RETRIEVAL_ERROR");
  });

  it("STATUS RESOLVER MISSING (G2): a status-carrying credential verified with NO resolver → Phase C STATUS_RETRIEVAL_ERROR (fail-closed)", async () => {
    const r = await verify({ resolveStatus: undefined });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("C");
    expect(r.code).toBe("STATUS_RETRIEVAL_ERROR");
  });

  it("STATUS RESOLVER THROWS (G2): the seam itself is fail-closed → Phase C STATUS_RETRIEVAL_ERROR", async () => {
    const throwing = () => {
      throw new Error("status backend exploded");
    };
    const r = await verify({ resolveStatus: throwing as ReturnType<typeof makeStatusResolver> });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("C");
    expect(r.code).toBe("STATUS_RETRIEVAL_ERROR");
  });

  it("OUT OF SCOPE: the actual use falls outside the purpose → Phase D POLICY_DENIED", async () => {
    const r = await verify({
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.misusePurpose, dateTime: base.now.toISOString() },
      },
    });
    expect(r.phase).toBe("D");
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("EXPIRED MIDDLE HOP: a hop whose dateTime window has passed → Phase D POLICY_DENIED", async () => {
    const pastAgreement: OdrlPolicy = {
      ...base.agreement,
      permissions: [
        {
          type: "permission",
          action: "read",
          target: CAST.records,
          assignee: CAST.inst,
          constraints: [
            { leftOperand: "purpose", operator: "eq", rightOperand: CAST.purpose },
            { leftOperand: "dateTime", operator: "lteq", rightOperand: "2026-01-01T00:00:00Z" },
          ],
        },
      ],
    };
    const r = await verify({
      primary: {
        credentials: [base.credentials.mandate, base.credentials.agreement],
        policies: [base.mandate, pastAgreement],
      },
    });
    expect(r.phase).toBe("D");
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("PROHIBITION LAUNDERING: an ancestor prohibition blocks a leaf-permitted action → Phase D", async () => {
    // The leaf now PERMITS distribute, but the mandate PROHIBITS it — the chain
    // must not launder the request around the upstream prohibition.
    const launderAgreement: OdrlPolicy = {
      ...base.agreement,
      permissions: [
        ...(base.agreement.permissions ?? []),
        {
          type: "permission",
          action: "distribute",
          target: CAST.records,
          assignee: CAST.inst,
        },
      ],
    };
    const r = await verify({
      primary: {
        credentials: [base.credentials.mandate, base.credentials.agreement],
        policies: [base.mandate, launderAgreement],
      },
      request: { action: "distribute", target: CAST.records },
    });
    expect(r.phase).toBe("D");
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("OVER LENGTH: chain longer than maxChainLength → Phase D POLICY_DENIED", async () => {
    const r = await verify({ maxChainLength: 1 });
    expect(r.phase).toBe("D");
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("IDENTITY COMPOSITION (missing): actor ≠ leaf assignee, no second chain → denied", async () => {
    const r = await verify({ actor: CAST.agentR, actorChain: undefined });
    expect(r.phase).toBe("composition");
    expect(r.code).toBe("IDENTITY_COMPOSITION_FAILED");
  });

  it("IDENTITY COMPOSITION (wrong root): second chain not rooted at the leaf assignee → denied", async () => {
    // Present the Alice-rooted primary chain AS the actor chain — its trusted root
    // would be the leaf assignee (inst), but its root credential issuer is Alice.
    const r = await verify({
      actor: CAST.agentR,
      actorChain: {
        credentials: [base.credentials.mandate, base.credentials.agreement],
        policies: [base.mandate, base.agreement],
      },
    });
    expect(r.phase).toBe("composition");
    expect(r.code).toBe("IDENTITY_COMPOSITION_FAILED");
  });

  it("IDENTITY COMPOSITION (actor ≠ chain₂ leaf): a correctly-rooted second chain that authorizes a DIFFERENT party is rejected for the actor", async () => {
    // Regression for the runtime's roborev round-1 HIGH: the institute chain
    // (rooted at inst, authorizing agentR) must NOT authorize some OTHER acting
    // WebID just because it is rooted correctly. Phase D pins the request to
    // chain₂'s own leaf (agentR), so the actor identity must be checked
    // explicitly (requireLeafAssignee).
    const rogue = "https://institute.example/agents/rogue#it";
    const r = await verify({
      actor: rogue,
      actorChain: {
        credentials: [base.credentials.instituteAgent],
        policies: [base.instituteInternal],
      },
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("composition");
    expect(r.code).toBe("IDENTITY_COMPOSITION_FAILED");
  });

  it("GOLDEN: the full decision matrix (verdict per case)", async () => {
    // The key-deny rows: a mandate-shaped credential signed with an UNREGISTERED
    // key, and one signed with ANOTHER party's registered key (issuer not the
    // controller).
    const mandateInput = {
      principal: CAST.alice,
      agent: CAST.agentA,
      action: ["read", "grantUse"],
      target: CAST.records,
      policy: CAST.mandateId,
      policyContent: base.policyDocuments.mandate,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
    } as const;
    const ghostKey = await generateKeyPairForSuite(
      "https://alice.solid.example/keys#ghost-golden",
      "Ed25519",
    );
    const ghostMandateVc = await issueAgentAuthorization(mandateInput, ghostKey);
    const crossSignedMandateVc = await issueAgentAuthorization(mandateInput, base.keys.agentA);
    const keyDenyChain = (mandateVc: VerifiableCredential): PresentedChain => ({
      credentials: [mandateVc, base.credentials.agreement],
      policies: [base.mandate, base.agreement],
      policyContents: {
        [CAST.mandateId]: { content: base.policyDocuments.mandate },
        [CAST.agreementId]: { content: base.policyDocuments.agreement },
      },
    });

    const rows: Array<[string, Promise<VerifyAuthorityResult>]> = [
      ["status-revoked", verify({ resolveStatus: makeStatusResolver("revoked") })],
      ["status-suspended", verify({ resolveStatus: makeStatusResolver("suspended") })],
      ["status-list-unreachable", verify({ resolveStatus: makeStatusResolver("unreachable") })],
      ["status-resolver-missing", verify({ resolveStatus: undefined })],
      ["key-unresolvable", verify({ primary: keyDenyChain(ghostMandateVc) })],
      ["key-not-issuer-controlled", verify({ primary: keyDenyChain(crossSignedMandateVc) })],
      ["happy", verify({})],
      ["actor-is-leaf-assignee", verify({ actor: CAST.inst, actorChain: undefined })],
      [
        "forged-hop",
        verify({
          primary: {
            credentials: [base.credentials.mandate, forge(base.credentials.agreement)],
            policies: [base.mandate, base.agreement],
          },
        }),
      ],
      ["expired", verify({ now: new Date("2027-08-01T00:00:00Z") })],
      ["not-yet-valid", verify({ now: new Date("2026-01-01T00:00:00Z") })],
      ["revoked", verify({ revoked: [CAST.agreementId] })],
      ["status-unreachable", verify({ statusUnreachable: true })],
      ["binding-mismatch", verify({ rootPrincipal: "https://attacker.example/profile#me" })],
      [
        "out-of-scope",
        verify({
          request: {
            action: "read",
            target: CAST.records,
            attributes: { purpose: CAST.misusePurpose, dateTime: base.now.toISOString() },
          },
        }),
      ],
      ["over-length", verify({ maxChainLength: 1 })],
      ["identity-composition-missing", verify({ actor: CAST.agentR, actorChain: undefined })],
      [
        "policy-substituted",
        verify({
          primary: {
            credentials: [base.credentials.mandate, base.credentials.agreement],
            policies: [base.mandate, base.agreement],
            policyContents: {
              [CAST.mandateId]: { content: base.policyDocuments.mandate },
              [CAST.agreementId]: { content: base.policyDocuments.mandate },
            },
          },
        }),
      ],
      [
        "content-not-presented",
        verify({
          primary: {
            credentials: [base.credentials.mandate, base.credentials.agreement],
            policies: [base.mandate, base.agreement],
          },
          actorChain: {
            credentials: [base.credentials.instituteAgent],
            policies: [base.instituteInternal],
          },
        }),
      ],
    ];
    const matrix: Record<
      string,
      { authorized: boolean; phase: string; code?: string; provisional: boolean }
    > = {};
    for (const [name, p] of rows) {
      const r = await p;
      matrix[name] = {
        authorized: r.authorized,
        phase: r.phase,
        ...(r.code !== undefined && { code: r.code }),
        provisional: r.policyIntegrityProvisional,
      };
    }
    expect(matrix).toMatchSnapshot();
  });
});
