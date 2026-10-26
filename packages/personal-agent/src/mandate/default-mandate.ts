// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The DEFAULT autonomy mandate — "read everything, act (almost) nothing" — plus a
 * documented example of loosening ONE permission. This is the owner's autonomy envelope
 * as an ODRL policy; in production it is issued as a signed `AgentAuthorizationCredential`
 * (see `solid-vc-verifier.ts`), edited + re-signed by the owner to change autonomy — NOT
 * a config file the agent can write.
 *
 * The default permits `read` (the Reader classifies everything the owner receives) and
 * NOTHING autonomous on the outbound side — every send is therefore `confirm-required`
 * (deny-by-default). {@link withAutonomousScheduling} shows the shape of loosening: it
 * ADDS a single permission letting the agent send scheduling replies autonomously, but
 * only for `purpose = SchedulingResponse` and `spend ≤ 0`.
 */
import type { OdrlPolicy, OdrlRule } from "@jeswr/solid-odrl";
import { AGENTIC_PURPOSE_SCHEDULING } from "../vocab.js";

/** Options for {@link defaultAutonomyPolicy}. */
export interface DefaultMandateOptions {
  /** The pod owner (assigner / VC issuer). */
  readonly ownerWebId: string;
  /** The agent (assignee). */
  readonly agentWebId: string;
  /** The policy IRI (defaults to `<agentWebId>#autonomy`). */
  readonly policyId?: string;
}

/**
 * The safe default: `read` permitted, every outbound send `confirm-required`. There is
 * NO autonomous-send permission — the agent proposes and a human confirms each send.
 */
export function defaultAutonomyPolicy(options: DefaultMandateOptions): OdrlPolicy {
  const { ownerWebId, agentWebId } = options;
  const readPermission: OdrlRule = {
    type: "permission",
    action: "read",
    assigner: ownerWebId,
    assignee: agentWebId,
  };
  return {
    id: options.policyId ?? `${agentWebId}#autonomy`,
    type: "Agreement",
    assigner: ownerWebId,
    assignee: agentWebId,
    // `prohibit` = deny wins on a permit/prohibit collision (the safe conflict strategy).
    conflict: "prohibit",
    permissions: [readPermission],
  };
}

/**
 * The documented loosening example: ADD one permission letting the agent send scheduling
 * replies autonomously, constrained to `purpose = SchedulingResponse` AND `spend ≤ 0`.
 * An intent that does not match every constraint (a different purpose, any nonzero spend)
 * falls through to deny-by-default → `confirm-required`.
 *
 * NB constraining by a recipient *class* (rather than an exact recipient / `isAnyOf` list)
 * is a `@jeswr/solid-odrl` API gap — its `recipient` left-operand does value comparison,
 * not class membership. Tracked as a follow-up (see README); do NOT hand-roll class logic.
 */
export function withAutonomousScheduling(policy: OdrlPolicy): OdrlPolicy {
  const schedulingPermission: OdrlRule = {
    type: "permission",
    action: "distribute",
    assigner: policy.assigner,
    assignee: policy.assignee,
    constraints: [
      { leftOperand: "purpose", operator: "isAnyOf", rightOperand: [AGENTIC_PURPOSE_SCHEDULING] },
      { leftOperand: "count", operator: "lteq", rightOperand: 0 },
    ],
  };
  return {
    ...policy,
    permissions: [...(policy.permissions ?? []), schedulingPermission],
  };
}
