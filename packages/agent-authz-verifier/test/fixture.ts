// AUTHORED-BY Claude Fable 5
//
// The self-contained test fixture — the accountable-agent-runtime §4 cast
// (Alice → agent A → institute → research agent R) rebuilt with REAL
// `@jeswr/solid-vc` crypto and PURELY INJECTED seams: an in-memory key registry
// stands in for WebID-document key resolution and an in-memory status resolver
// for the hosted Bitstring Status List. No pod, no fetch, no network — exactly
// the injectable-seam contract the standalone verifier publishes.
//
// Ported from `@jeswr/accountable-agent-runtime` `src/scenario/{cast,keys}.ts`
// @ 72ec20a, minus the pod double (the runtime keeps the document-resolved
// end-to-end variant; these tests pin the verifier's own composition logic).

import {
  ODRLD_PROFILE_IRI,
  type OdrlPolicy,
  policyToTurtle,
  type RequestContext,
} from "@jeswr/solid-odrl";
import {
  bitstringStatusListEntry,
  type CredentialStatusCheck,
  generateKeyPairForSuite,
  issueAgentAuthorization,
  type KeyPair,
  type VerifiableCredential,
} from "@jeswr/solid-vc";

/** The fixed evaluation windows used throughout (a one-year grant). */
export const VALID_FROM = "2026-07-03T00:00:00Z" as const;
export const VALID_UNTIL = "2027-07-03T00:00:00Z" as const;

/** The mandate credential's bit position in Alice's revocation status list. */
export const MANDATE_STATUS_INDEX = 42;

/** The cast IRIs (the runtime's §4 scenario cast). */
export const CAST = {
  alice: "https://alice.solid.example/profile/card#me",
  aliceKeyVm: "https://alice.solid.example/keys#k1",

  agentA: "https://agent-a.example/id#it",
  agentAKeyVm: "https://agent-a.example/keys#k1",

  inst: "https://institute.example/org#id",
  instKeyVm: "https://institute.example/keys#k1",

  agentR: "https://institute.example/agents/research#it",

  records: "https://alice.solid.example/data/records.ttl",
  purpose: "https://w3id.org/dpv#ResearchAndDevelopment",
  misusePurpose: "https://w3id.org/dpv#DirectMarketing",

  mandateId: "https://alice.solid.example/agents/engagements/e1/mandate.ttl#policy",
  agreementId: "https://alice.solid.example/agents/engagements/e1/agreement.ttl#policy",
  instituteInternalId: "https://institute.example/policies/internal-e1.ttl#policy",

  statusListUrl: "https://alice.solid.example/status/e1-revocation.json",
} as const;

/** The root mandate P (Alice → agent A: read + a depth-1 grantUse, distribute prohibited). */
export function buildMandate(): OdrlPolicy {
  return {
    id: CAST.mandateId,
    type: "Agreement",
    profile: ODRLD_PROFILE_IRI,
    assigner: CAST.alice,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: CAST.records,
        assignee: CAST.agentA,
        constraints: [{ leftOperand: "dateTime", operator: "lteq", rightOperand: VALID_UNTIL }],
      },
      {
        type: "permission",
        action: "grantUse",
        target: CAST.records,
        assignee: CAST.agentA,
        constraints: [
          { leftOperand: "delegationDepth", operator: "lteq", rightOperand: 1 },
          { leftOperand: "dateTime", operator: "lteq", rightOperand: VALID_UNTIL },
        ],
        duties: [
          { action: "nextPolicy", target: CAST.agreementId },
          { action: "inform", target: CAST.alice },
        ],
      },
    ],
    prohibitions: [{ type: "prohibition", action: "distribute", target: CAST.records }],
  };
}

/** The leaf Agreement (Alice-via-A → the institute: read for a stated purpose). */
export function buildAgreement(): OdrlPolicy {
  return {
    id: CAST.agreementId,
    type: "Agreement",
    profile: ODRLD_PROFILE_IRI,
    delegatedUnder: CAST.mandateId,
    assigner: CAST.agentA,
    assignee: CAST.inst,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: CAST.records,
        assignee: CAST.inst,
        constraints: [
          { leftOperand: "purpose", operator: "eq", rightOperand: CAST.purpose },
          { leftOperand: "dateTime", operator: "lteq", rightOperand: VALID_UNTIL },
        ],
        duties: [{ action: "delete" }],
      },
    ],
  };
}

/**
 * The institute's INTERNAL authorization (inst → agentR) — the D9
 * identity-composition second chain, rooted at the primary chain's leaf assignee.
 */
export function buildInstituteInternal(): OdrlPolicy {
  return {
    id: CAST.instituteInternalId,
    type: "Agreement",
    profile: ODRLD_PROFILE_IRI,
    assigner: CAST.inst,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: CAST.records,
        assignee: CAST.agentR,
        constraints: [{ leftOperand: "dateTime", operator: "lteq", rightOperand: VALID_UNTIL }],
      },
    ],
  };
}

/** The read request R performs, with a stated purpose + instant. */
export function buildReadRequest(purpose: string, now: Date): RequestContext {
  return {
    action: "read",
    target: CAST.records,
    attributes: { purpose, dateTime: now.toISOString() },
  };
}

// --- the injected seams -----------------------------------------------------

/**
 * An in-memory key registry standing in for WebID-document key resolution — the
 * seam contract only (`resolveKey` + `isControlledBy`), no fetch:
 *  - `resolveKey` returns a registered verification method's public key, or
 *    `undefined` (an UNPUBLISHED key never resolves — fail-closed);
 *  - `isControlledBy` is true IFF the method was registered under exactly that
 *    controller (another party's published key is resolvable but NOT
 *    issuer-controlled — the cross-signing hole, shut fail-closed).
 */
export class InMemoryKeyRegistry {
  private readonly byMethod = new Map<string, { publicKey: CryptoKey; controller: string }>();

  register(controller: string, key: KeyPair): void {
    this.byMethod.set(key.verificationMethod, { publicKey: key.publicKey, controller });
  }

  readonly resolveKey = (verificationMethod: string): CryptoKey | undefined =>
    this.byMethod.get(verificationMethod)?.publicKey;

  readonly isControlledBy = (verificationMethod: string, issuer: string): boolean =>
    this.byMethod.get(verificationMethod)?.controller === issuer;
}

/**
 * An in-memory credential-status resolver — the `resolveStatus` seam contract
 * only. A credential with NO `credentialStatus` entry is `absent`; one WITH an
 * entry reports the injected `outcome` (`valid` | `revoked` | `suspended` |
 * `unreachable`), standing in for the hosted-Bitstring-list read.
 */
export function makeStatusResolver(
  outcome: "valid" | "revoked" | "suspended" | "unreachable",
): (vc: VerifiableCredential) => CredentialStatusCheck {
  return (vc) => {
    if (vc.credentialStatus === undefined) {
      return { status: "absent" };
    }
    switch (outcome) {
      case "valid":
        return { status: "valid" };
      case "revoked":
        return { status: "revoked", reason: "status list bit set (revocation)" };
      case "suspended":
        return { status: "suspended", reason: "status list bit set (suspension)" };
      case "unreachable":
        return { status: "unreachable", reason: "status list could not be retrieved" };
    }
  };
}

// --- the base fixture ---------------------------------------------------------

/** Everything the decision-matrix tests consume. */
export interface Fixture {
  readonly now: Date;
  readonly keys: { readonly alice: KeyPair; readonly agentA: KeyPair; readonly inst: KeyPair };
  readonly registry: InMemoryKeyRegistry;
  readonly mandate: OdrlPolicy;
  readonly agreement: OdrlPolicy;
  readonly instituteInternal: OdrlPolicy;
  readonly credentials: {
    readonly mandate: VerifiableCredential;
    readonly agreement: VerifiableCredential;
    readonly instituteAgent: VerifiableCredential;
  };
  /**
   * The EXACT policy-document bytes each credential digest-binds (G1) — the same
   * bytes presented to the verifier. Kept on the fixture so tests present the
   * true issuance bytes, never a parse→re-emit.
   */
  readonly policyDocuments: {
    readonly mandate: string;
    readonly agreement: string;
    readonly instituteInternal: string;
  };
}

/** Build the base fixture: real keys, real signed credentials, injected seams. */
export async function buildFixture(): Promise<Fixture> {
  const now = new Date("2026-08-01T00:00:00.000Z");

  const alice = await generateKeyPairForSuite(CAST.aliceKeyVm, "Ed25519");
  const agentA = await generateKeyPairForSuite(CAST.agentAKeyVm, "Ed25519");
  const inst = await generateKeyPairForSuite(CAST.instKeyVm, "Ed25519");

  const registry = new InMemoryKeyRegistry();
  registry.register(CAST.alice, alice);
  registry.register(CAST.agentA, agentA);
  registry.register(CAST.inst, inst);

  const mandate = buildMandate();
  const agreement = buildAgreement();
  const instituteInternal = buildInstituteInternal();

  // Serialize each policy document ONCE — the exact bytes digest-bound at issuance
  // and presented to the verifier (the G1 content-binding discipline).
  const mandateTtl = await policyToTurtle(mandate);
  const agreementTtl = await policyToTurtle(agreement);
  const instituteInternalTtl = await policyToTurtle(instituteInternal);

  // The mandate credential carries a Bitstring status entry, so the fail-closed
  // status gate has a mechanism to (refuse to) skip.
  const mandateVc = await issueAgentAuthorization(
    {
      principal: CAST.alice,
      agent: CAST.agentA,
      action: ["read", "grantUse"],
      target: CAST.records,
      policy: CAST.mandateId,
      policyContent: mandateTtl,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
      credentialStatus: bitstringStatusListEntry({
        statusPurpose: "revocation",
        statusListIndex: MANDATE_STATUS_INDEX,
        statusListCredential: CAST.statusListUrl,
      }),
    },
    alice,
  );
  const agreementVc = await issueAgentAuthorization(
    {
      principal: CAST.agentA,
      agent: CAST.inst,
      action: "read",
      target: CAST.records,
      policy: CAST.agreementId,
      policyContent: agreementTtl,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
    },
    agentA,
  );
  const instAgentVc = await issueAgentAuthorization(
    {
      principal: CAST.inst,
      agent: CAST.agentR,
      action: "read",
      target: CAST.records,
      policy: CAST.instituteInternalId,
      policyContent: instituteInternalTtl,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
    },
    inst,
  );

  return {
    now,
    keys: { alice, agentA, inst },
    registry,
    mandate,
    agreement,
    instituteInternal,
    credentials: { mandate: mandateVc, agreement: agreementVc, instituteAgent: instAgentVc },
    policyDocuments: {
      mandate: mandateTtl,
      agreement: agreementTtl,
      instituteInternal: instituteInternalTtl,
    },
  };
}
