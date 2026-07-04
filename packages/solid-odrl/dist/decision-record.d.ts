import type { Quad } from "@rdfjs/types";
import type { EvaluateOptions, EvaluationResult, OdrlPolicy, RequestContext } from "./types.js";
/** The inputs to a decision record (G9). */
export interface DecisionRecordInput {
    /** The record node IRI (`<#decision>`). */
    readonly id: string;
    /** The evaluated policy — the source of the deciding rules' constraints + the policy id. */
    readonly policy: OdrlPolicy;
    /** The request context that was evaluated. */
    readonly request: RequestContext;
    /** The outcome of {@link evaluate}. */
    readonly result: EvaluationResult;
    /**
     * The instant the evaluation was performed. Recorded as `prov:endedAtTime`, AND —
     * CONTRACT — used as the evaluation clock when re-resolving a `dateTime`-sensitive
     * anonymous-sibling deciding constraint, so it MUST be the SAME instant passed as
     * `EvaluateOptions.now` to {@link evaluate} (or the real `new Date()` if `now` was
     * defaulted). Passing a different instant only risks OVER-including a shape-alike
     * sibling's constraints at a time boundary — never omitting the true deciding
     * constraints (the resolver falls back to all shape-matches rather than drop them),
     * and never affects the recorded DECISION (which comes verbatim from `result`).
     */
    readonly evaluatedAt: Date;
}
/**
 * Emit an ODRL decision record (G9) as quads: an `odrld:DecisionRecord` naming the
 * evaluated policy, the request fields, the decision + reason (+ conflict flag when
 * a conflict was resolved), and — as blank-node children — one deciding-rule node
 * per matched permission/prohibition (with the DECIDING constraints located from
 * the policy) and one active-duty node per {@link EvaluationResult.duties} (carrying
 * its `fulfilled` flag). Built via the typed {@link GraphBuilder} write path — no
 * hand-built triples; every IRI is percent-escaped at the same chokepoint the rest
 * of the package uses, so a hostile `id` / `policy.id` / `request.target` / rule
 * descriptor cannot inject a triple.
 */
export declare function decisionRecord(input: DecisionRecordInput): Quad[];
/**
 * The JSON-LD sibling of {@link decisionRecord} — the SAME record as a self-contained
 * `@context`-pinned document (no remote context dependency, same rationale as
 * {@link policyToJsonLd}). Every IRI-valued field is escaped through the SAME
 * `escapeIri` the RDF path applies at its chokepoint, so a hostile value is
 * neutralised identically on both paths (escaping parity); the deciding-rule
 * constraints use {@link decisionConstraintJsonLd}, the JSON-LD half of the
 * non-throwing constraint emitter {@link writeDecisionConstraint} the RDF path uses.
 */
export declare function decisionRecordJsonLd(input: DecisionRecordInput): Record<string, unknown>;
/** An evaluation paired with its decision record — the output of {@link recordEvaluation}. */
export interface EvaluatedDecisionRecord {
    /** The evaluation result (from {@link evaluate}). */
    readonly result: EvaluationResult;
    /** The decision record as RDF quads (from {@link decisionRecord}). */
    readonly quads: Quad[];
    /** The decision record as a JSON-LD document (from {@link decisionRecordJsonLd}). */
    readonly jsonld: Record<string, unknown>;
}
/**
 * Evaluate a policy AND emit its decision record in one call, OWNING the clock so the
 * record's `evaluatedAt` is provably the exact instant used by {@link evaluate}.
 *
 * This is the CLOSED-LOOP path that removes the one residual imprecision of building a
 * record separately (see {@link assignDecidingRules}): when a caller runs
 * {@link evaluate} with a defaulted clock and then builds a record, it cannot recover
 * the internal `new Date()`, so a `dateTime`-boundary re-check for multiple anonymous
 * shape-identical siblings could disagree. Here the clock is captured ONCE
 * (`options.now ?? new Date()`) and threaded into both the evaluation and the record,
 * so the deciding-constraint re-resolution reproduces `evaluate`'s own match decisions
 * EXACTLY. Prefer this over calling `evaluate` + `decisionRecord` separately whenever a
 * record is wanted for a fresh evaluation.
 */
export declare function recordEvaluation(id: string, policy: OdrlPolicy, request: RequestContext, options?: EvaluateOptions): EvaluatedDecisionRecord;
//# sourceMappingURL=decision-record.d.ts.map