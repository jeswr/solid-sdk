// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readBoundAuthorization, verifyAgentAuthority } from "@jeswr/agent-authz-verifier";
import {
  buildAgentAuthorizationCredential,
  type Credential,
  credentialToRdf,
  digestQuads,
  issue,
  type KeyPair,
  readValidCredential,
  type VerifiableCredential,
  type VerifyCredentialOptions,
  type WebIdKeyResolver,
} from "@jeswr/solid-vc";
import { Store } from "n3";
import {
  bindingPolicy,
  decodeLimit,
  decodePolicy,
  decodeProhibitions,
  encodeLimit,
  encodePolicy,
  encodeProhibitions,
} from "./codec.js";
import { validInstant } from "./instant.js";
import { node, RDF_TYPE } from "./rdf.js";
import {
  AGENT,
  LIMIT_OPERANDS,
  type Limit,
  type Mandate,
  type MandateVerifier,
  ODRL,
} from "./types.js";

/** Build a limit; enforcement occurs exclusively in agent-executor. */
export function limitConstraint(
  operand: string,
  value: number,
  enforcement: "hard" | "soft",
): Limit {
  if (
    !LIMIT_OPERANDS.includes(operand) ||
    !Number.isFinite(value) ||
    value < 0 ||
    !["hard", "soft"].includes(enforcement)
  )
    throw new Error("Invalid mandate limit");
  return { leftOperand: operand, operator: "lteq", rightOperand: value, enforcement };
}
/** Default v1 mandate: no autonomous sends, Gmail and own-account hashes require approval. */
export function defaultMandate(options: {
  id: string;
  ownerWebId: string;
  agentWebId: string;
  recipientHashes: readonly string[];
  now: Date;
}): Mandate {
  if (
    options.recipientHashes.length === 0 ||
    options.recipientHashes.some((h) => !/^sha256:[a-f0-9]{64}$/.test(h))
  )
    throw new Error("Expected salted SHA-256 account hashes");
  return {
    id: options.id,
    issuer: options.ownerWebId,
    subject: options.agentWebId,
    validFrom: options.now.toISOString(),
    validUntil: new Date(options.now.getTime() + 30 * 86400000).toISOString(),
    autonomous: { id: `${options.id}/autonomous`, type: "Set", permissions: [] },
    withApproval: {
      id: `${options.id}/with-approval`,
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: `${AGENT}SendMessage`,
          constraints: [
            {
              leftOperand: `${AGENT}recipientSet`,
              operator: "isAnyOf",
              rightOperand: [...options.recipientHashes],
            },
            { leftOperand: `${AGENT}binding`, operator: "isAnyOf", rightOperand: ["gmail"] },
          ],
        },
      ],
    },
    prohibitions: [
      { type: "prohibition", action: `${AGENT}Transfer` },
      { type: "prohibition", action: `${AGENT}Sign` },
      {
        type: "prohibition",
        action: `${AGENT}BookAppointment`,
        constraints: [{ leftOperand: `${AGENT}costExceeds`, operator: "gt", rightOperand: 0 }],
      },
    ],
    limits: [],
  };
}
/** Build the package's canonical embedded Agreement claim graph (internal transport helper). */
export function mandateCredential(
  m: Mandate,
  status: { statusListCredential: string; statusListIndex: string; id?: string },
): Credential {
  // The signed status is mandatory; the verifier checks the reserved status-list location.
  const credential = buildAgentAuthorizationCredential({
    id: m.id,
    principal: m.issuer,
    agent: m.subject,
    action: `${ODRL}use`,
    policy: `${m.id}/agreement`,
    validFrom: m.validFrom,
    validUntil: m.validUntil,
    credentialStatus: { type: "BitstringStatusListEntry", statusPurpose: "revocation", ...status },
  });
  const subject = {
    ...credential.credentialSubject,
    [`${AGENT}agreement`]: {
      [RDF_TYPE]: `${ODRL}Agreement`,
      [`${ODRL}uid`]: `${m.id}/agreement`,
      [`${ODRL}assigner`]: m.issuer,
      [`${ODRL}assignee`]: m.subject,
      [`${AGENT}autonomous`]: encodePolicy(m.autonomous),
      [`${AGENT}withApproval`]: encodePolicy(m.withApproval),
      [`${ODRL}prohibition`]: encodeProhibitions(m.prohibitions),
      [`${ODRL}constraint`]: m.limits.map(encodeLimit),
    },
  };
  return { ...credential, credentialSubject: subject };
}
/** Sign an AgentAuthorizationCredential with the entire Agreement embedded in its claim graph. */
export async function issueMandate(
  m: Mandate,
  key: KeyPair,
  status: { statusListCredential: string; statusListIndex: string; id?: string },
): Promise<VerifiableCredential> {
  return issue({
    credential: mandateCredential(m, status),
    key,
    options: { created: new Date(m.validFrom) },
  });
}
/** Injected loader, WebID resolver, status resolver and clock; no ambient network or key trust. */
export interface VcMandateOptions {
  readonly read: () => Promise<VerifiableCredential | undefined>;
  readonly ownerWebId: string;
  readonly agentWebId: string;
  readonly statusListCredential: string;
  readonly webIdKeyResolver: WebIdKeyResolver;
  readonly resolveStatus: NonNullable<VerifyCredentialOptions["resolveStatus"]>;
  readonly now: () => Date;
}
/** Verify integrity, issuer/subject/policy binding and revocation before exposing policy sets. */
export function createVcMandateVerifier(options: VcMandateOptions): MandateVerifier {
  return {
    async load() {
      try {
        const resolver = options.webIdKeyResolver;
        const { resolveKey, isControlledBy } = resolver;
        if (typeof resolveKey !== "function" || typeof isControlledBy !== "function")
          return undefined;
        const vc = await options.read();
        if (!vc?.id || vc.issuer !== options.ownerWebId || !vc.validFrom || !vc.validUntil)
          return undefined;
        // Match the Turtle path's structural date-time checks before comparing instants.
        const store = new Store(credentialToRdf(vc));
        if (
          !readValidCredential(store).valid ||
          !validInstant(vc.validFrom) ||
          !validInstant(vc.validUntil)
        )
          return undefined;
        const now = options.now();
        if (
          !(Date.parse(vc.validFrom) <= now.getTime()) ||
          !(Date.parse(vc.validUntil) > now.getTime())
        )
          return undefined;
        const proofs = Array.isArray(vc.proof) ? vc.proof : [vc.proof];
        if (proofs.length !== 1 || proofs[0]?.cryptosuite !== "eddsa-rdfc-2022") return undefined;
        const statuses = Array.isArray(vc.credentialStatus)
          ? vc.credentialStatus
          : [vc.credentialStatus];
        if (
          statuses.length !== 1 ||
          statuses[0]?.statusPurpose !== "revocation" ||
          statuses[0].statusListCredential !== options.statusListCredential ||
          !options.statusListCredential.endsWith("/agent/mandates/status.ttl")
        )
          return undefined;
        const root = node(store, vc.issuer).one(`${AGENT}agreement`);
        if (root.iri(RDF_TYPE) !== `${ODRL}Agreement`) return undefined;
        const id = root.iri(`${ODRL}uid`);
        const issuer = root.iri(`${ODRL}assigner`);
        const subject = root.iri(`${ODRL}assignee`);
        const auth = readBoundAuthorization(vc);
        if (issuer !== options.ownerWebId || subject !== options.agentWebId || auth?.policy !== id)
          return undefined;
        const check = await verifyAgentAuthority(
          { credentials: [vc], policies: [bindingPolicy(id, issuer, subject)] },
          {
            request: { action: "use", agent: subject },
            rootPrincipal: issuer,
            now,
            resolveKey: resolveKey.bind(resolver),
            isControlledBy: isControlledBy.bind(resolver),
            resolveStatus: async (credential) => {
              const result = await options.resolveStatus(credential);
              return result.status === "valid"
                ? result
                : { status: "revoked", reason: "Mandate status could not be confirmed clear" };
            },
            requireLeafAssignee: subject,
          },
        );
        // Phase D is intentionally left to PolicyEngine. Reaching D proves A/B/C passed.
        if (!check.authorized && !(check.phase === "D" && check.code === "POLICY_DENIED"))
          return undefined;
        const limits = root.values(`${ODRL}constraint`).map(decodeLimit);
        if (limits.some((c) => !LIMIT_OPERANDS.includes(c.leftOperand))) return undefined;
        const mandate: Mandate = {
          id: vc.id,
          issuer,
          subject,
          validFrom: vc.validFrom,
          validUntil: vc.validUntil,
          autonomous: decodePolicy(root.one(`${AGENT}autonomous`)),
          withApproval: decodePolicy(root.one(`${AGENT}withApproval`)),
          prohibitions: decodeProhibitions(root),
          limits,
        };
        // Every entry path must preserve the entire signed claim graph, including restrictions.
        // Decoding a known subset must never erase a signed field before evaluation.
        const reconstructed = mandateCredential(mandate, statuses[0]);
        if (
          (await digestQuads(credentialToRdf(vc))) !==
          (await digestQuads(credentialToRdf(reconstructed)))
        )
          return undefined;
        return mandate;
      } catch {
        return undefined;
      }
    },
  };
}
