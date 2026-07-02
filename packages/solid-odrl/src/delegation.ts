// AUTHORED-BY Claude Fable 5
//
// The AGENT-DELEGATION PROFILE chain evaluator (docs/delegation-profile.md) — the
// accountability keystone of the agentic-Solid roadmap: an agent grants a sub-agent
// a SUBSET of its own permissions, and every delegated action remains traceable to
// the delegating principal.
//
// Model (spec §2): a delegation CHAIN is an ordered list of ODRL policies, ROOT
// FIRST — chain[0] is the originating grant (the resource owner's policy) and each
// later hop is an `odrl:Agreement` issued by the previous hop's grantee
// (`odrl:assigner` = the delegator, `odrl:assignee` = the delegate) that declares
// its authority with `odrld:delegatedUnder <parent-policy>`. Authority to delegate
// is ODRL's own `odrl:grantUse` action ("enables the assignee to create policies
// for the use of the Asset for third parties" — ODRL Vocab §4.4.22), bounded by an
// `odrld:delegationDepth` constraint and optionally pinned to a mandated downstream
// policy via a duty whose action is `odrl:nextPolicy` (Vocab §4.4.29).
//
// Evaluation is FAIL-CLOSED end to end (spec §5): the result is `permit` ONLY if
// EVERY check on EVERY hop affirmatively passes — a delegated permission is valid
// only if every hop is in-scope, unexpired, unrevoked, depth-bounded, structurally
// well-formed and acyclic; anything malformed, over-broad, or unverifiable is a
// `deny` (never `notApplicable` — a chain either proves the grant or it does not).
// Subset semantics are CONSERVATIVE: the delegate's effective permissions are the
// per-request INTERSECTION of the whole chain — the concrete request must be
// permitted by the leaf grant AND by every ancestor's grant to its own delegate
// (deciding syntactic policy-subset in general is not tractable over arbitrary
// constraints; per-request intersection is decidable and never over-grants).
//
// PURE + DETERMINISTIC like `evaluate`: no I/O, injectable `now`, so the whole
// decision matrix is golden-master tested (test/characterization.test.ts).

import type { Quad } from "@rdfjs/types";
import { evaluate, matchingPermissions } from "./evaluate.js";
import type {
  ActiveDuty,
  EvaluateOptions,
  EvaluationResult,
  OdrlPolicy,
  OdrlRule,
  RequestContext,
} from "./types.js";
import {
  ODRLD_DELEGATED_UNDER,
  PROV_ACTED_ON_BEHALF_OF,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_DERIVED_FROM,
} from "./vocab.js";
import { GraphBuilder, iriRef } from "./wrappers.js";

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
   *
   * Typed as an array/Set — NOT `Iterable<string>` — because a bare string IS an
   * `Iterable<string>`, so `revoked: oneIri` would typecheck yet silently become
   * a set of CHARACTERS and never match a policy id (a fail-open foot-gun). A
   * bare string is also rejected at runtime for plain-JS callers.
   */
  readonly revoked?: readonly string[] | ReadonlySet<string>;
  /**
   * Absolute cap on the chain length (root + delegation hops), independent of any
   * policy-declared depth budget — a structural guard against pathological input.
   * Default {@link DEFAULT_MAX_CHAIN_LENGTH}.
   */
  readonly maxChainLength?: number;
}

/** The default absolute chain-length cap (root + up to 7 delegation hops). */
export const DEFAULT_MAX_CHAIN_LENGTH = 8;

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
export function evaluateDelegated(
  chain: readonly OdrlPolicy[],
  request: RequestContext,
  options: DelegationEvaluateOptions = {},
): DelegatedEvaluationResult {
  const now = options.now ?? new Date();
  const maxLen = options.maxChainLength ?? DEFAULT_MAX_CHAIN_LENGTH;
  const hops: DelegationHopTrace[] = [];

  if (chain.length === 0) {
    return denied("Empty delegation chain — nothing grants the request.", hops);
  }
  if (!Number.isInteger(maxLen) || maxLen < 1) {
    return denied(`Invalid maxChainLength ${String(maxLen)} — must be a positive integer.`, hops);
  }
  if (chain.length > maxLen) {
    return denied(
      `Chain length ${chain.length} exceeds the maximum ${maxLen} (maxChainLength).`,
      hops,
    );
  }

  // `delegationDepth` is a WALKER-RESERVED left-operand: only the evaluator may
  // assert it (it injects the true remaining depth per edge). Strip any
  // caller-supplied value so a request can never satisfy a depth bound by fiat.
  const req = stripDelegationDepth(request);

  // --- chain-level checks: ids, acyclicity, revocation ----------------------
  const seen = new Set<string>();
  for (const [i, policy] of chain.entries()) {
    if (policy.id === undefined || policy.id === "") {
      return denied(`Hop ${i} has no policy id — the chain edge cannot be verified.`, hops);
    }
    if (seen.has(policy.id)) {
      return denied(`Cyclic chain: policy <${policy.id}> appears more than once.`, hops);
    }
    seen.add(policy.id);
  }
  // Runtime guard for plain-JS callers: a bare string would iterate as
  // characters and silently disable revocation (see the option's doc).
  const revoked = new Set(
    typeof options.revoked === "string" ? [options.revoked as string] : (options.revoked ?? []),
  );
  for (const [i, policy] of chain.entries()) {
    if (revoked.has(policy.id)) {
      return denied(`Hop ${i} (<${policy.id}>) has been revoked.`, hops);
    }
  }

  // --- per-edge checks: structure + delegation authorization ----------------
  for (let i = 1; i < chain.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i bounded by chain.length
    const parent = chain[i - 1]!;
    // biome-ignore lint/style/noNonNullAssertion: i bounded by chain.length
    const child = chain[i]!;
    // The number of delegation hops at-or-below this edge (the edge itself plus
    // every descendant edge) — the depth this edge's grantUse budget must cover.
    const remainingDepth = chain.length - i;
    const failure = checkDelegationEdge(parent, child, remainingDepth, req, now);
    if (failure !== undefined) {
      hops.push({ index: i, policyId: child.id, ok: false, reason: failure });
      return denied(`Hop ${i} (<${child.id}>): ${failure}`, hops);
    }
    hops.push({ index: i, policyId: child.id, ok: true, reason: "ok" });
  }

  // --- scope intersection: every ancestor must grant the REQUESTED capability
  // to its own delegate (conservative subset semantics, spec §6) --------------
  const aggregateDuties: ActiveDuty[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i bounded by chain.length
    const ancestor = chain[i]!;
    // biome-ignore lint/style/noNonNullAssertion: i+1 bounded by chain.length
    const delegator = chain[i + 1]!.assigner as string; // defined — checked per edge
    const scope = evaluate(ancestor, { ...req, agent: delegator }, { now });
    if (scope.decision !== "permit") {
      return denied(
        `Hop ${i} (<${ancestor.id}>) does not grant the requested capability to its delegate <${delegator}> (${scope.decision}: ${scope.reason}) — a delegate cannot receive more than the delegator holds.`,
        hops,
      );
    }
    // An ancestor PROHIBITION against the actual requesting agent also denies —
    // delegation must never launder a request around an upstream prohibition.
    const direct = evaluate(ancestor, req, { now });
    if (direct.decision === "deny") {
      return denied(
        `Hop ${i} (<${ancestor.id}>) prohibits the request directly (${direct.reason}).`,
        hops,
      );
    }
    aggregateDuties.push(...scope.duties);
  }

  // --- the leaf grant itself -------------------------------------------------
  // biome-ignore lint/style/noNonNullAssertion: non-empty checked above
  const leafPolicy = chain[chain.length - 1]!;
  const leaf = evaluate(leafPolicy, req, { now });
  if (leaf.decision !== "permit") {
    return {
      ...denied(`Leaf policy <${leafPolicy.id}> does not permit: ${leaf.reason}`, hops),
      leaf,
    };
  }
  aggregateDuties.push(...leaf.duties);
  const duties = dedupeDuties(aggregateDuties);

  // `requireDuties` gates on the AGGREGATE chain duties (a delegation never sheds
  // an upstream duty), so it is applied here rather than inside the leaf evaluate.
  if (options.requireDuties) {
    const outstanding = duties.filter((d) => !d.fulfilled);
    if (outstanding.length > 0) {
      const names = outstanding.map((d) => d.action).join(", ");
      return {
        ...denied(
          `Chain permits, but requireDuties is set and these chain duties are unfulfilled: ${names}.`,
          hops,
        ),
        leaf,
        duties,
      };
    }
  }

  return {
    decision: "permit",
    reason:
      chain.length === 1
        ? "The policy permits the request (single-policy chain)."
        : `Every hop of the ${chain.length - 1}-hop delegation chain is valid and the request is within the chain intersection.`,
    hops,
    leaf,
    duties,
  };
}

/**
 * Check one delegation edge parent→child (spec §5.2): the child's structural form,
 * the `odrld:delegatedUnder` back-edge, and the parent's `grantUse` authorization
 * (explicit assignee, depth budget, mandated `nextPolicy`). Returns the failure
 * reason, or `undefined` when the edge is valid.
 */
function checkDelegationEdge(
  parent: OdrlPolicy,
  child: OdrlPolicy,
  remainingDepth: number,
  req: RequestContext,
  now: Date,
): string | undefined {
  // Structural profile requirements on a delegated hop.
  if (child.type !== "Agreement") {
    return `a delegated hop must be an odrl:Agreement (got ${child.type ?? "Set"}).`;
  }
  if (child.assigner === undefined || child.assignee === undefined) {
    return "a delegated hop must name both assigner (the delegator) and assignee (the delegate).";
  }
  if (child.delegatedUnder !== parent.id) {
    return `the hop must declare odrld:delegatedUnder <${parent.id}> (got ${
      child.delegatedUnder === undefined ? "none" : `<${child.delegatedUnder}>`
    }).`;
  }

  // The delegation-authorization request: "may `child.assigner` grantUse this
  // target, with `remainingDepth` hops still below this edge?" The TRUE remaining
  // depth is injected as the `delegationDepth` operand (caller-supplied values
  // were stripped at entry), so an `odrld:delegationDepth lteq N` constraint on
  // the grantUse permission is evaluated against reality.
  const authRequest: RequestContext = {
    agent: child.assigner,
    action: "grantUse",
    ...(req.target !== undefined && { target: req.target }),
    attributes: { ...(req.attributes ?? {}), delegationDepth: remainingDepth },
  };

  // Full evaluation first, so prohibitions on grantUse and the policy's conflict
  // strategy are honoured (a "permit grantUse + prohibit grantUse" parent denies
  // under the default prohibit strategy).
  const auth = evaluate(parent, authRequest, { now });
  if (auth.decision !== "permit") {
    return `the parent policy does not authorise delegation by <${child.assigner}> (${auth.decision}: ${auth.reason}).`;
  }

  // Candidate authorizing rules: explicit `grantUse` action AND an explicit
  // (effective) assignee naming the delegator. An assignee-FREE grantUse would
  // let ANY agent re-delegate — the profile requires delegation authority to be
  // individually granted (spec §5.2.4), so such a rule never authorises an edge.
  const candidates = matchingPermissions(parent, authRequest, { now }).filter(
    (r) => r.action === "grantUse" && r.assignee === child.assigner,
  );
  if (candidates.length === 0) {
    return `the parent policy has no grantUse permission explicitly naming <${child.assigner}> as assignee (an assignee-free grantUse does not authorise delegation).`;
  }

  // At least one candidate must clear the depth budget + any mandated nextPolicy.
  const failures: string[] = [];
  for (const rule of candidates) {
    const failure = checkGrantUseRule(rule, child, remainingDepth);
    if (failure === undefined) {
      return undefined; // this rule authorises the edge.
    }
    failures.push(failure);
  }
  return failures.join(" / ");
}

/**
 * Check a matched `grantUse` permission's profile obligations for one edge:
 * the implicit depth budget (no `delegationDepth` constraint → depth 1, spec
 * §5.2.5) and every `nextPolicy` duty (the child must BE the mandated policy,
 * spec §5.2.6). The explicit `delegationDepth` constraint itself was already
 * evaluated (against the injected true depth) during matching.
 */
function checkGrantUseRule(
  rule: OdrlRule,
  child: OdrlPolicy,
  remainingDepth: number,
): string | undefined {
  const hasDepthConstraint = (rule.constraints ?? []).some(
    (c) => c.leftOperand === "delegationDepth",
  );
  if (!hasDepthConstraint && remainingDepth > 1) {
    return `grantUse permission carries no delegationDepth constraint, so its budget is the profile default of 1 hop — ${remainingDepth} remaining hops exceed it`;
  }
  for (const duty of rule.duties ?? []) {
    if (duty.action !== "nextPolicy") {
      continue;
    }
    if (duty.target === undefined) {
      return "grantUse permission carries a nextPolicy duty with no target policy (malformed)";
    }
    if (duty.target !== child.id) {
      return `grantUse permission mandates nextPolicy <${duty.target}> but the delegated hop is <${child.id}>`;
    }
  }
  return undefined;
}

/** Assemble a deny result. */
function denied(reason: string, hops: readonly DelegationHopTrace[]): DelegatedEvaluationResult {
  return { decision: "deny", reason, hops, duties: [] };
}

/** Strip the walker-reserved `delegationDepth` attribute from a request context. */
function stripDelegationDepth(request: RequestContext): RequestContext {
  if (request.attributes === undefined || !("delegationDepth" in request.attributes)) {
    return request;
  }
  const { delegationDepth: _reserved, ...rest } = request.attributes;
  const { attributes: _dropped, ...requestWithout } = request;
  return Object.keys(rest).length > 0 ? { ...requestWithout, attributes: rest } : requestWithout;
}

/** De-duplicate duties by (action, target, id, fulfilled), keeping first occurrence. */
function dedupeDuties(duties: readonly ActiveDuty[]): ActiveDuty[] {
  const seen = new Set<string>();
  const out: ActiveDuty[] = [];
  for (const d of duties) {
    const key = `${d.action} ${d.target ?? ""} ${d.id ?? ""} ${d.fulfilled}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

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
export function delegationProvenance(chain: readonly OdrlPolicy[]): Quad[] {
  const b = new GraphBuilder();
  for (const [i, policy] of chain.entries()) {
    if (policy.id === undefined || policy.id === "") {
      continue;
    }
    const subject = iriRef(policy.id);
    if (policy.assigner !== undefined) {
      b.addIri(subject, PROV_WAS_ATTRIBUTED_TO, policy.assigner);
    }
    if (i > 0) {
      // biome-ignore lint/style/noNonNullAssertion: i > 0 within chain bounds
      const parent = chain[i - 1]!;
      if (parent.id !== undefined && parent.id !== "") {
        b.addIri(subject, ODRLD_DELEGATED_UNDER, parent.id);
        b.addIri(subject, PROV_WAS_DERIVED_FROM, parent.id);
      }
      if (policy.assignee !== undefined && policy.assigner !== undefined) {
        b.addIri(iriRef(policy.assignee), PROV_ACTED_ON_BEHALF_OF, policy.assigner);
      }
    }
  }
  return b.quads();
}
