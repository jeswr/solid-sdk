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
import type { OdrlPolicy } from "@jeswr/solid-odrl";
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
export declare function defaultAutonomyPolicy(options: DefaultMandateOptions): OdrlPolicy;
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
export declare function withAutonomousScheduling(policy: OdrlPolicy): OdrlPolicy;
//# sourceMappingURL=default-mandate.d.ts.map