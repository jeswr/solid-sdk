import { AGENTIC_PURPOSE_SCHEDULING } from "../vocab.js";
/**
 * The safe default: `read` permitted, every outbound send `confirm-required`. There is
 * NO autonomous-send permission — the agent proposes and a human confirms each send.
 */
export function defaultAutonomyPolicy(options) {
    const { ownerWebId, agentWebId } = options;
    const readPermission = {
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
export function withAutonomousScheduling(policy) {
    const schedulingPermission = {
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
//# sourceMappingURL=default-mandate.js.map