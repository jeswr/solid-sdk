import type { EvaluateOptions, EvaluationResult, OdrlConstraint, OdrlPolicy, OdrlRule, RequestContext } from "./types.js";
/**
 * Evaluate a {@link RequestContext} against an {@link OdrlPolicy}. Pure +
 * deterministic. See the file header for the exact semantics.
 */
export declare function evaluate(policy: OdrlPolicy, request: RequestContext, options?: EvaluateOptions): EvaluationResult;
/**
 * The EFFECTIVE permission rules of `policy` (policy-level assigner/assignee
 * inherited, exactly as {@link evaluate} matches them) that MATCH `request` —
 * action implication + target + assignee + every constraint, fail-closed on a
 * missing context value. This is {@link evaluate}'s own permission-matching step,
 * exposed so a profile walker (the agent-delegation chain evaluator) can inspect
 * the matched RULE OBJECTS (constraints, duties) rather than only the
 * {@link DecisionRule} trace. It reports matching only — it does NOT consider
 * prohibitions, conflict strategy, or duties; use {@link evaluate} for a decision.
 */
export declare function matchingPermissions(policy: OdrlPolicy, request: RequestContext, options?: EvaluateOptions): OdrlRule[];
/**
 * Is a single constraint satisfied by the request context? Fail-closed: a
 * constraint whose left-operand value the context does not supply is UNSATISFIED.
 */
export declare function constraintSatisfied(c: OdrlConstraint, request: RequestContext, now: Date): boolean;
//# sourceMappingURL=evaluate.d.ts.map