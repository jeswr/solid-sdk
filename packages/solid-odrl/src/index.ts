// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `@jeswr/solid-odrl` — express + evaluate ODRL usage-control policies for Solid
 * resources and agent interactions (M3 of the agentic-Solid roadmap: "ODRL contract
 * negotiation between agents, attached to pod resources").
 *
 * This is the EXPRESSION + EVALUATION layer that the M3 negotiation state machine
 * (`@jeswr/agent-odrl`) and the CORE-PSS M5a pod-side authorizer build ON. It does
 * three things, all CLIENT-SIDE and pure:
 *
 * 1. **Express** — {@link policyToRdf} / {@link policyToTurtle} / {@link policyToJsonLd}
 *    build an ODRL 2.2 Policy / Permission / Prohibition / Duty / Constraint graph
 *    using the REAL W3C ODRL vocabulary (`http://www.w3.org/ns/odrl/2/`), through
 *    typed `@rdfjs/wrapper` accessors + `n3.Writer` (never a hand-built triple).
 * 2. **Parse** — {@link parsePolicy} / {@link policyFromRdf} read a policy back from
 *    Turtle / JSON-LD via `@jeswr/fetch-rdf` (the sanctioned parser; never bespoke),
 *    lossless on the policy fields (round-trips).
 * 3. **Evaluate** — {@link evaluate} decides permit / deny / notApplicable for a
 *    {@link RequestContext} (agent WebID, action, target, constraint inputs like
 *    time / purpose / recipient), reporting matched rules, conflict resolution, and
 *    active duties. PURE + DETERMINISTIC (injectable `now`), so it is exhaustively
 *    testable and does NO I/O.
 *
 * 4. **Delegate** — the AGENT-DELEGATION PROFILE (`docs/delegation-profile.md`,
 *    profile IRI {@link ODRLD_PROFILE_IRI}): an agent grants a sub-agent a SUBSET
 *    of its own permissions via `odrl:grantUse` Agreements chained with
 *    `odrld:delegatedUnder`; {@link evaluateDelegated} walks the chain FAIL-CLOSED
 *    (in-scope intersection, unexpired, unrevoked, depth-bounded, acyclic) and
 *    {@link delegationProvenance} emits the PROV-O audit overlay that traces every
 *    delegated action to the delegating principal.
 *
 * Composition (the roadmap's "a policy attaches to an agent interaction / a
 * resource"): {@link requestContextFromA2AIntent} turns an `@jeswr/solid-a2a`
 * intent into an ODRL request context (gate an A2A action with a policy), and
 * {@link requestContextFromWac} turns a Solid WAC-mode request into one (a policy
 * attached to a pod resource). Both are structural adapters — this package does NOT
 * import `solid-a2a` / `solid-agent-card`, only mirrors their shared field shapes.
 *
 * SCOPE: this is the client-side EXPRESSION + EVALUATION library only. The
 * SERVER-SIDE ENFORCEMENT (a pod-side ODRL authorizer beside WAC, request-time duty
 * /constraint enforcement) is the CORE-PSS M5a item and is deliberately NOT here —
 * it requires prod-solid-server `src/` changes + an ADR + maintainer approval.
 *
 * Experimental, AI-agent-generated — not production-hardened.
 *
 * @packageDocumentation
 */

export type { A2AIntentLike } from "./compose.js";
export {
  A2A_ACTION_TO_ODRL,
  requestContextFromA2AIntent,
  requestContextFromWac,
} from "./compose.js";
export type {
  DelegatedEvaluationResult,
  DelegationEvaluateOptions,
  DelegationHopTrace,
} from "./delegation.js";
export {
  DEFAULT_MAX_CHAIN_LENGTH,
  delegationProvenance,
  evaluateDelegated,
} from "./delegation.js";
export { constraintSatisfied, evaluate, matchingPermissions } from "./evaluate.js";
export {
  IRI_TO_ACTION,
  IRI_TO_LEFT_OPERAND,
  IRI_TO_OPERATOR,
  parsePolicy,
  policyFromRdf,
  policyToJsonLd,
  policyToRdf,
  policyToTurtle,
} from "./policy.js";
export { serialize } from "./serialize.js";
export type {
  ActiveDuty,
  Decision,
  DecisionRule,
  EvaluateOptions,
  EvaluationResult,
  OdrlConstraint,
  OdrlDuty,
  OdrlPolicy,
  OdrlRule,
  PolicyType,
  RequestContext,
  RuleType,
} from "./types.js";
export {
  ACL,
  ACL_MODE_TO_ACTION,
  ACL_MODES,
  ACTION_IRI,
  type AclMode,
  CONFLICT_IRI,
  CONFLICT_STRATEGIES,
  type ConflictStrategy,
  DPV,
  LEFT_OPERAND_IRI,
  LEFT_OPERANDS,
  type LeftOperandName,
  ODRL,
  ODRL_ACTIONS,
  ODRL_GRANT_USE,
  ODRL_INLINE_CONTEXT,
  ODRL_NEXT_POLICY,
  ODRL_TRANSFER,
  ODRLD,
  ODRLD_DELEGATED_UNDER,
  ODRLD_DELEGATION_DEPTH,
  ODRLD_INLINE_CONTEXT_EXTENSION,
  ODRLD_PROFILE_IRI,
  ODRLD_REVOCATION_CLASS,
  ODRLD_REVOKED_POLICY,
  type OdrlActionName,
  OPERATOR_IRI,
  OPERATORS,
  type OperatorName,
  PROV,
  PROV_ACTED_ON_BEHALF_OF,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_DERIVED_FROM,
  VALID_ACTION_IRIS,
} from "./vocab.js";
