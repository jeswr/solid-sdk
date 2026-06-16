import type { EvaluateOptions, EvaluationResult, OdrlConstraint, OdrlPolicy, RequestContext } from "./types.js";
/**
 * Evaluate a {@link RequestContext} against an {@link OdrlPolicy}. Pure +
 * deterministic. See the file header for the exact semantics.
 */
export declare function evaluate(policy: OdrlPolicy, request: RequestContext, options?: EvaluateOptions): EvaluationResult;
/**
 * Is a single constraint satisfied by the request context? Fail-closed: a
 * constraint whose left-operand value the context does not supply is UNSATISFIED.
 */
export declare function constraintSatisfied(c: OdrlConstraint, request: RequestContext, now: Date): boolean;
//# sourceMappingURL=evaluate.d.ts.map