import type { Quad } from "@rdfjs/types";
import type { ActiveDuty, EvaluateOptions, EvaluationResult, OdrlPolicy, RequestContext } from "./types.js";
/**
 * Options for {@link evaluateDelegated}. Extends the base {@link EvaluateOptions}
 * (`now` for deterministic temporal evaluation; `requireDuties` gates the permit
 * on the AGGREGATE duties of the whole chain).
 */
export interface DelegationEvaluateOptions extends EvaluateOptions {
    /**
     * Policy IRIs known to be REVOKED (withdrawn before expiry — spec §7). The
     * caller assembles this set (e.g. from the assigners' published
     * `odrld:Revocation` statements); the evaluator itself performs no I/O. Any
     * chain hop whose id is in this set → deny.
     */
    readonly revoked?: Iterable<string>;
    /**
     * Absolute cap on the chain length (root + delegation hops), independent of any
     * policy-declared depth budget — a structural guard against pathological input.
     * Default {@link DEFAULT_MAX_CHAIN_LENGTH}.
     */
    readonly maxChainLength?: number;
}
/** The default absolute chain-length cap (root + up to 7 delegation hops). */
export declare const DEFAULT_MAX_CHAIN_LENGTH = 8;
/** The per-hop trace of a delegation-chain evaluation (explainability). */
export interface DelegationHopTrace {
    /** The hop's position in the chain (0 = root). */
    readonly index: number;
    /** The hop policy's IRI. */
    readonly policyId: string;
    /** Whether every check on this hop passed. */
    readonly ok: boolean;
    /** Which check failed (or "ok"). */
    readonly reason: string;
}
/**
 * The result of a delegation-chain evaluation. Deliberately TWO-VALUED: a chain
 * either affirmatively proves the grant (`permit`) or it does not (`deny`) —
 * there is no `notApplicable` fall-through for a delegated request (spec §5).
 */
export interface DelegatedEvaluationResult {
    /** The bottom-line decision. */
    readonly decision: "permit" | "deny";
    /** Which check drove the decision. */
    readonly reason: string;
    /** Per-hop trace, in chain order, up to and including the failing hop. */
    readonly hops: readonly DelegationHopTrace[];
    /** The leaf policy's own evaluation, when the chain was well-formed enough to reach it. */
    readonly leaf?: EvaluationResult;
    /**
     * The AGGREGATE duties the permit is contingent on — the union of the duties
     * every hop's matched grant imposes plus the leaf's (delegation never sheds a
     * duty: conditions accumulate down the chain, spec §6.3). Empty on a deny,
     * EXCEPT a `requireDuties` deny, which reports the aggregate duties so the
     * caller can see exactly what remains outstanding.
     */
    readonly duties: readonly ActiveDuty[];
}
/**
 * Evaluate a {@link RequestContext} against a DELEGATION CHAIN of ODRL policies
 * (root first, leaf last), per the agent-delegation profile
 * (`docs/delegation-profile.md`). Pure + deterministic; fail-closed on every hop.
 *
 * A single-element chain degenerates to `evaluate(chain[0], request)` plus the
 * chain-level checks (revocation, id presence) — so callers can use this uniformly
 * for both direct and delegated grants.
 */
export declare function evaluateDelegated(chain: readonly OdrlPolicy[], request: RequestContext, options?: DelegationEvaluateOptions): DelegatedEvaluationResult;
/**
 * Emit the PROV-O attribution triple set for a delegation chain (spec §8) — the
 * audit overlay that makes every hop traceable to its delegating principal:
 *
 *  - `<policy_i> prov:wasAttributedTo <assigner_i>` — who issued each hop;
 *  - `<policy_i> odrld:delegatedUnder <policy_{i-1}>` and the generic
 *    `prov:wasDerivedFrom` super-property — the authority edge, readable by both
 *    profile verifiers and plain PROV consumers;
 *  - `<assignee_i> prov:actedOnBehalfOf <assigner_i>` — the standing PROV-O
 *    delegation assertion between the agents themselves.
 *
 * Triples whose parties are absent are skipped (never guessed). Quads are built
 * through the typed {@link GraphBuilder} write path (the house rule — no
 * hand-concatenated triples); serialise with `policyToTurtle`'s `serialize`.
 */
export declare function delegationProvenance(chain: readonly OdrlPolicy[]): Quad[];
//# sourceMappingURL=delegation.d.ts.map