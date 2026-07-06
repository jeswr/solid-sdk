/**
 * The ODRL evaluation the outbox executor runs against the owner's signed mandate for
 * EVERY outbound intent (the enforcement point, §5/§7). All policy logic is delegated to
 * `@jeswr/solid-odrl`'s pure `evaluate()` — we NEVER hand-roll policy matching. This
 * module only (a) projects an {@link ActionProposal} into an ODRL {@link RequestContext}
 * and (b) maps the library's `permit`/`deny`/`notApplicable` verdict onto the executor's
 * fail-closed {@link AutonomyDecision} (deny-by-default → confirm-required).
 */
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { type RequestContext } from "@jeswr/solid-odrl";
import type { ActionProposal } from "../pod/proposals.js";
import type { AutonomyEvaluation } from "./types.js";
/** Options for {@link evaluateAutonomy}. */
export interface EvaluateAutonomyOptions {
    /** The agent's WebID (matched against the mandate's `assignee`). */
    readonly agentWebId?: string;
    /** "Now" for `dateTime` constraints (injectable → deterministic tests). */
    readonly now?: Date;
}
/**
 * Project an outbound proposal into an ODRL request context. The `purpose`, `recipient`,
 * and `count` (spend) attributes are the constrainable left-operands the mandate refines;
 * the `target` is the message the action derives from (its raw-anchor), when a reply.
 */
export declare function buildRequestContext(proposal: ActionProposal, agentWebId?: string): RequestContext;
/**
 * Evaluate one outbound intent against the mandate policy, fail-closed:
 *  - a matching PERMIT with no outstanding duty → `permit` (autonomous);
 *  - a matching permit whose duties the request can't show fulfilled → `confirm-required`;
 *  - an explicit PROHIBITION → `prohibited` (never, even if confirmed);
 *  - anything else (no matching rule / deny-by-default) → `confirm-required`.
 */
export declare function evaluateAutonomy(policy: OdrlPolicy, proposal: ActionProposal, options?: EvaluateAutonomyOptions): AutonomyEvaluation;
//# sourceMappingURL=evaluate.d.ts.map