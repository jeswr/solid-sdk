// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// G9 — the ODRL DECISION-RECORD emitter (agent-delegation profile, the sibling of
// G8's `actionProvenance`). Where `actionProvenance` records that an action was
// PERFORMED as a PROV bundle, `decisionRecord` reifies the OUTCOME of one
// `evaluate(policy, request)` call — what was evaluated, what was decided, and (for
// explainability) the DECIDING rules + their constraints and the active duties — as
// a flat, auditor-friendly RDF resource (an `odrld:DecisionRecord`).
//
// DESCRIPTIVE, NOT ENFORCING. The record documents a decision `evaluate` already
// made; it carries NO authorization weight and re-parsing it does not re-decide
// anything. Consequently EVERY IRI the record writes — its own fields (`policy.id`,
// `request.target`, the deciding-rule descriptors) AND the deciding constraints'
// IRI operands — is made breakout-proof by ESCAPING (at the `GraphBuilder`
// chokepoint / `escapeIri`) rather than by throwing: an audit trail must always be
// producible, so a hostile IRI is neutralised in place, never a reason to refuse the
// record. (This is the ONE place the package escapes an evaluation-participating
// constraint operand instead of rejecting a would-mutate one — safe precisely
// because nothing re-evaluates FROM the record; enforcement is `evaluate` on the
// live policy. The constraint DATATYPING still reuses the policy path's
// {@link inferDatatype}/{@link isIriValued} so a recorded constraint types
// identically to the same constraint in a policy.) The RDF and JSON-LD paths escape
// shared fields IDENTICALLY (`escapeIri`), the same parity discipline
// `actionProvenance` / `policyToJsonLd` keep.
//
// DECIDING-CONSTRAINT LOCATION. An {@link EvaluationResult}'s {@link DecisionRule}
// carries no constraints (it is the decision TRACE), so to name the deciding
// constraints we resolve each matched descriptor back to the OdrlPolicy rule it came
// from and emit THAT rule's constraints. Because two anonymous rules with the same
// (action, target, effective-assignee) but different constraints produce IDENTICAL
// descriptors, resolution consumes rules POSITIONALLY (a distinct rule per
// descriptor): `evaluate` emits exactly one descriptor per matched rule in policy
// order, so a greedy 1:1 assignment is a bijection — each deciding-rule node gets
// exactly ONE source rule's constraints, never a union of shape-alike siblings'.
// See {@link assignDecidingRules} for the per-descriptor rule (id vs anonymous
// shape+constraint match, with a clock-mismatch fallback that never omits the true
// deciding constraints). Assignment NEVER throws: a descriptor that finds no rule is
// still recorded, just with no `odrl:constraint`.

import { escapeIri, safeIri } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { constraintSatisfied, evaluate } from "./evaluate.js";
import { inferDatatype, isIriValued } from "./policy.js";
import type {
  ActiveDuty,
  DecisionRule,
  EvaluateOptions,
  EvaluationResult,
  OdrlConstraint,
  OdrlPolicy,
  OdrlRule,
  RequestContext,
} from "./types.js";
import {
  ACTION_IRI,
  DECISION_RECORD_INLINE_CONTEXT,
  LEFT_OPERAND_IRI,
  ODRL_ACTION,
  ODRL_ASSIGNEE,
  ODRL_CONSTRAINT,
  ODRL_DUTY_CLASS,
  ODRL_LEFT_OPERAND,
  ODRL_OPERATOR,
  ODRL_PERMISSION_CLASS,
  ODRL_PROHIBITION_CLASS,
  ODRL_RIGHT_OPERAND,
  ODRL_TARGET,
  ODRLD_ACTIVE_DUTY,
  ODRLD_CONFLICT,
  ODRLD_DECIDING_RULE,
  ODRLD_DECISION,
  ODRLD_DECISION_RECORD_CLASS,
  ODRLD_EVALUATED_POLICY,
  ODRLD_FULFILLED,
  ODRLD_ON_DUTY,
  ODRLD_REASON,
  ODRLD_REQUEST_ACTION,
  ODRLD_REQUEST_AGENT,
  ODRLD_REQUEST_PURPOSE,
  ODRLD_REQUEST_TARGET,
  ODRLD_RULE_KIND,
  OPERATOR_IRI,
  PROV_ENDED_AT_TIME,
  RDF_TYPE,
  XSD_BOOLEAN,
  XSD_DATETIME,
} from "./vocab.js";
import { GraphBuilder, iriRef, type NodeRef } from "./wrappers.js";

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

/** The effective assignee of a rule = its own, else the policy-level one (as `evaluate`). */
function effectiveAssignee(rule: OdrlRule, policy: OdrlPolicy): string | undefined {
  return rule.assignee ?? policy.assignee;
}

/** A deciding-rule descriptor paired with the source policy rule it resolves to (if any). */
interface DecidingAssignment {
  readonly descriptor: DecisionRule;
  /** The policy rule whose constraints are the deciding ones; `undefined` if unlocatable. */
  readonly rule: OdrlRule | undefined;
}

/**
 * Resolve each matched {@link DecisionRule} descriptor back to the EXACT source
 * policy rule whose constraints are the deciding ones, by consuming rules POSITIONALLY
 * (a distinct rule per descriptor), so two shape-identical anonymous siblings never
 * collapse into a union of each other's constraints.
 *
 * Why positional: a {@link DecisionRule} is a constraint-free TRACE, so two anonymous
 * rules with the same (action, target, effective-assignee) but DIFFERENT constraints
 * — both matched — produce two IDENTICAL descriptors, indistinguishable by value.
 * But `evaluate` emits EXACTLY ONE descriptor per matched rule, in policy order
 * (`matchingPermissions` = map-over-`policy.permissions` then filter, no dedup), so a
 * greedy 1:1 assignment is a bijection between the matched descriptors and their
 * source rules: each descriptor claims one not-yet-consumed matching rule, giving each
 * deciding-rule node exactly ONE rule's constraints (which specific rule pairs with
 * which identical descriptor is arbitrary but irrelevant — the descriptors are equal).
 *
 * Per descriptor:
 *  - IDENTIFIED (`id` present — a {@link DecisionRule} carries an `id` iff its source
 *    rule did, see `toDecisionRule`): claim the unclaimed rule with that `id`.
 *  - ANONYMOUS (`id` absent): among the unclaimed anonymous rules matching
 *    (action, target, effective-assignee), PREFER one whose constraints the request
 *    actually satisfied under `now` (excludes a genuinely non-deciding sibling), else
 *    fall back to the first unclaimed shape-match — the re-check is time-sensitive
 *    (a `dateTime` boundary), and `evaluate` DID match a sibling, so an empty
 *    satisfied set signals a clock mismatch (a mis-passed `evaluatedAt`), where
 *    omitting the constraints would lose audit info; the fallback never omits them.
 *
 * EXACTNESS + RESIDUAL LIMIT. Re-checking at `now` (= `evaluatedAt`) reproduces
 * `evaluate`'s OWN per-rule match decisions EXACTLY whenever the caller honours the
 * `evaluatedAt` contract (it IS the instant `evaluate` used — the natural + default
 * path), so even multiple anonymous shape-identical siblings with different
 * `dateTime` constraints resolve to the right rules. The ONE residual case is a
 * CONTRACT VIOLATION combined with the (already unusual) multi-anonymous-sibling +
 * time-sensitive-constraint shape: if `evaluatedAt` differs from the clock `evaluate`
 * used, a sibling that did not decide the original result can look satisfied at
 * `evaluatedAt` and be recorded instead. This affects only a DESCRIPTIVE
 * (non-enforcing) audit record — never a decision — and cannot be closed from the
 * constraint-free {@link DecisionRule} trace: the exact fix is to carry the matched
 * rule's identity/ordinal in {@link EvaluationResult}, a change to the
 * security-critical `evaluate` contract deferred as a maintainer-gated follow-up.
 *
 * Never throws; a descriptor that finds no rule is recorded with no constraints.
 */
function assignDecidingRules(
  decidingRules: readonly DecisionRule[],
  policy: OdrlPolicy,
  request: RequestContext,
  now: Date,
): DecidingAssignment[] {
  const consumed = new Set<OdrlRule>();
  return decidingRules.map((descriptor) => {
    const pool =
      descriptor.type === "prohibition" ? (policy.prohibitions ?? []) : (policy.permissions ?? []);
    const rule = pickSourceRule(descriptor, pool, consumed, policy, request, now);
    if (rule !== undefined) {
      consumed.add(rule);
    }
    return { descriptor, rule };
  });
}

/** Pick the (unconsumed) source rule for one descriptor — see {@link assignDecidingRules}. */
function pickSourceRule(
  descriptor: DecisionRule,
  pool: readonly OdrlRule[],
  consumed: ReadonlySet<OdrlRule>,
  policy: OdrlPolicy,
  request: RequestContext,
  now: Date,
): OdrlRule | undefined {
  const available = pool.filter((rule) => !consumed.has(rule));
  if (descriptor.id !== undefined) {
    return available.find((rule) => rule.id === descriptor.id);
  }
  const shapeMatches = available.filter(
    (rule) =>
      rule.id === undefined &&
      rule.action === descriptor.action &&
      rule.target === descriptor.target &&
      effectiveAssignee(rule, policy) === descriptor.assignee,
  );
  const satisfied = shapeMatches.find((rule) =>
    (rule.constraints ?? []).every((c) => constraintSatisfied(c, request, now)),
  );
  return satisfied ?? shapeMatches[0];
}

/**
 * The purpose IRI(s) the request asserts. `attributes.purpose` may be a single
 * string OR an array (the evaluator satisfies a `purpose` constraint — e.g.
 * `isAnyOf` — from a multi-valued request attribute), so ALL asserted string
 * purposes are recorded; non-string members (a stray number) are dropped.
 */
function requestPurposes(request: RequestContext): string[] {
  const p = request.attributes?.purpose;
  if (typeof p === "string") {
    return [p];
  }
  if (Array.isArray(p)) {
    return p.filter((v): v is string => typeof v === "string");
  }
  return [];
}

/** Is a right-operand emitted as an IRI node? (IRI-valued left operand + an absolute IRI value.) */
function operandIsIri(c: OdrlConstraint, r: string | number): r is string {
  return isIriValued(c.leftOperand) && typeof r === "string" && safeIri(r) !== undefined;
}

/**
 * Write a DECIDING constraint node under `parent`. Unlike the policy path's
 * constraint writer (which REJECTS a would-mutate IRI operand to preserve
 * evaluation identity), this ESCAPES an IRI operand (via the `GraphBuilder`
 * chokepoint) and never throws — the record is descriptive, so a hostile operand is
 * neutralised in place rather than blocking the audit trail. Datatyping reuses the
 * policy path's {@link inferDatatype}/{@link isIriValued} for parity.
 */
function writeDecisionConstraint(b: GraphBuilder, parent: NodeRef, c: OdrlConstraint): void {
  const node = b.linkBlankNode(parent, ODRL_CONSTRAINT);
  b.addIri(node, ODRL_LEFT_OPERAND, LEFT_OPERAND_IRI[c.leftOperand]);
  b.addIri(node, ODRL_OPERATOR, OPERATOR_IRI[c.operator]);
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  for (const r of rights) {
    if (operandIsIri(c, r)) {
      b.addIri(node, ODRL_RIGHT_OPERAND, r); // GraphBuilder escapes → breakout-proof.
    } else {
      b.addLiteral(node, ODRL_RIGHT_OPERAND, String(r), inferDatatype(c, r));
    }
  }
}

/** The JSON-LD projection of a deciding constraint — the escaping-parity sibling of {@link writeDecisionConstraint}. */
function decisionConstraintJsonLd(c: OdrlConstraint): Record<string, unknown> {
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  const emitted = rights.map((r) => {
    if (operandIsIri(c, r)) {
      return { "@id": escapeIri(r) };
    }
    const dt = inferDatatype(c, r);
    return dt !== undefined ? { "@value": String(r), "@type": dt } : String(r);
  });
  return {
    leftOperand: { "@id": LEFT_OPERAND_IRI[c.leftOperand] },
    operator: { "@id": OPERATOR_IRI[c.operator] },
    rightOperand: emitted.length === 1 ? emitted[0] : emitted,
  };
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
export function decisionRecord(input: DecisionRecordInput): Quad[] {
  const { id, policy, request, result, evaluatedAt } = input;
  const b = new GraphBuilder();
  const rec = iriRef(id);

  b.addIri(rec, RDF_TYPE, ODRLD_DECISION_RECORD_CLASS);
  b.addLiteral(rec, PROV_ENDED_AT_TIME, evaluatedAt.toISOString(), XSD_DATETIME);
  b.addIri(rec, ODRLD_EVALUATED_POLICY, policy.id);
  if (request.agent !== undefined) {
    b.addIri(rec, ODRLD_REQUEST_AGENT, request.agent);
  }
  b.addIri(rec, ODRLD_REQUEST_ACTION, ACTION_IRI[request.action]);
  if (request.target !== undefined) {
    b.addIri(rec, ODRLD_REQUEST_TARGET, request.target);
  }
  for (const purpose of requestPurposes(request)) {
    b.addIri(rec, ODRLD_REQUEST_PURPOSE, purpose);
  }
  b.addLiteral(rec, ODRLD_DECISION, result.decision);
  b.addLiteral(rec, ODRLD_REASON, result.reason);
  if (result.conflict) {
    b.addLiteral(rec, ODRLD_CONFLICT, "true", XSD_BOOLEAN);
  }

  const decidingRules: DecisionRule[] = [
    ...result.matchedPermissions,
    ...result.matchedProhibitions,
  ];
  for (const { descriptor, rule } of assignDecidingRules(
    decidingRules,
    policy,
    request,
    evaluatedAt,
  )) {
    writeDecidingRule(b, rec, descriptor, rule);
  }
  for (const duty of result.duties) {
    writeActiveDuty(b, rec, duty);
  }
  return b.quads();
}

/** Write one deciding-rule node under the record (its rule IRI when it has one, else a blank node). */
function writeDecidingRule(
  b: GraphBuilder,
  rec: NodeRef,
  descriptor: DecisionRule,
  rule: OdrlRule | undefined,
): void {
  // Preserve the stable link to the policy rule: use the rule's IRI as the node when
  // the descriptor carries one, else a blank node (linkChild escapes an IRI child).
  const node = b.linkChild(rec, ODRLD_DECIDING_RULE, descriptor.id);
  const cls = descriptor.type === "prohibition" ? ODRL_PROHIBITION_CLASS : ODRL_PERMISSION_CLASS;
  b.addIri(node, RDF_TYPE, cls);
  b.addLiteral(node, ODRLD_RULE_KIND, descriptor.type);
  b.addIri(node, ODRL_ACTION, ACTION_IRI[descriptor.action]);
  if (descriptor.target !== undefined) {
    b.addIri(node, ODRL_TARGET, descriptor.target);
  }
  if (descriptor.assignee !== undefined) {
    b.addIri(node, ODRL_ASSIGNEE, descriptor.assignee);
  }
  // The DECIDING constraints: exactly the assigned source rule's constraints. None if
  // unlocatable.
  for (const c of rule?.constraints ?? []) {
    writeDecisionConstraint(b, node, c);
  }
}

/**
 * Write one active-duty node under the record. The node is ALWAYS a RECORD-SCOPED
 * blank node (never the policy duty IRI), because it carries the per-evaluation
 * `odrld:fulfilled` flag: putting that on the stable duty IRI would let two merged
 * records for the same duty assert both `true` and `false` on one node. The stable
 * duty IRI (when present) is linked via `odrld:onDuty` instead.
 */
function writeActiveDuty(b: GraphBuilder, rec: NodeRef, duty: ActiveDuty): void {
  const node = b.linkBlankNode(rec, ODRLD_ACTIVE_DUTY);
  b.addIri(node, RDF_TYPE, ODRL_DUTY_CLASS);
  if (duty.id !== undefined) {
    b.addIri(node, ODRLD_ON_DUTY, duty.id);
  }
  b.addIri(node, ODRL_ACTION, ACTION_IRI[duty.action]);
  if (duty.target !== undefined) {
    b.addIri(node, ODRL_TARGET, duty.target);
  }
  b.addLiteral(node, ODRLD_FULFILLED, duty.fulfilled ? "true" : "false", XSD_BOOLEAN);
}

/**
 * The JSON-LD sibling of {@link decisionRecord} — the SAME record as a self-contained
 * `@context`-pinned document (no remote context dependency, same rationale as
 * {@link policyToJsonLd}). Every IRI-valued field is escaped through the SAME
 * `escapeIri` the RDF path applies at its chokepoint, so a hostile value is
 * neutralised identically on both paths (escaping parity); the deciding-rule
 * constraints use {@link decisionConstraintJsonLd}, the JSON-LD half of the
 * non-throwing constraint emitter {@link writeDecisionConstraint} the RDF path uses.
 */
export function decisionRecordJsonLd(input: DecisionRecordInput): Record<string, unknown> {
  const { id, policy, request, result, evaluatedAt } = input;

  const doc: Record<string, unknown> = {
    "@context": DECISION_RECORD_INLINE_CONTEXT,
    "@id": escapeIri(id),
    "@type": "odrld:DecisionRecord",
    endedAtTime: evaluatedAt.toISOString(),
    evaluatedPolicy: { "@id": escapeIri(policy.id) },
    requestAction: { "@id": ACTION_IRI[request.action] },
    decision: result.decision,
    reason: result.reason,
  };
  if (request.agent !== undefined) {
    doc.requestAgent = { "@id": escapeIri(request.agent) };
  }
  if (request.target !== undefined) {
    doc.requestTarget = { "@id": escapeIri(request.target) };
  }
  const purposeNodes = requestPurposes(request).map((p) => ({ "@id": escapeIri(p) }));
  if (purposeNodes.length > 0) {
    const [only] = purposeNodes;
    doc.requestPurpose = purposeNodes.length === 1 ? only : purposeNodes;
  }
  if (result.conflict) {
    doc.conflict = true;
  }
  const decidingRules: DecisionRule[] = [
    ...result.matchedPermissions,
    ...result.matchedProhibitions,
  ];
  const assignments = assignDecidingRules(decidingRules, policy, request, evaluatedAt);
  if (assignments.length > 0) {
    doc.decidingRule = assignments.map(({ descriptor, rule }) =>
      decidingRuleJsonLd(descriptor, rule),
    );
  }
  if (result.duties.length > 0) {
    doc.activeDuty = result.duties.map((d) => activeDutyJsonLd(d));
  }
  return doc;
}

/** The JSON-LD projection of a deciding-rule node. */
function decidingRuleJsonLd(
  descriptor: DecisionRule,
  rule: OdrlRule | undefined,
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@type": descriptor.type === "prohibition" ? "odrl:Prohibition" : "odrl:Permission",
    ruleKind: descriptor.type,
    action: { "@id": ACTION_IRI[descriptor.action] },
  };
  // Preserve the stable link to the policy rule (escaping parity with the RDF path).
  if (descriptor.id !== undefined) {
    node["@id"] = escapeIri(descriptor.id);
  }
  if (descriptor.target !== undefined) {
    node.target = { "@id": escapeIri(descriptor.target) };
  }
  if (descriptor.assignee !== undefined) {
    node.assignee = { "@id": escapeIri(descriptor.assignee) };
  }
  const constraints = rule?.constraints ?? [];
  if (constraints.length > 0) {
    node.constraint = constraints.map((c) => decisionConstraintJsonLd(c));
  }
  return node;
}

/**
 * The JSON-LD projection of an active-duty node — a RECORD-SCOPED (blank) node
 * carrying the per-evaluation `fulfilled` flag, linking the stable policy duty IRI
 * via `onDuty` (never using it as the node's own `@id`); see {@link writeActiveDuty}.
 */
function activeDutyJsonLd(duty: ActiveDuty): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@type": "odrl:Duty",
    action: { "@id": ACTION_IRI[duty.action] },
    fulfilled: duty.fulfilled,
  };
  if (duty.id !== undefined) {
    node.onDuty = { "@id": escapeIri(duty.id) };
  }
  if (duty.target !== undefined) {
    node.target = { "@id": escapeIri(duty.target) };
  }
  return node;
}

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
export function recordEvaluation(
  id: string,
  policy: OdrlPolicy,
  request: RequestContext,
  options: EvaluateOptions = {},
): EvaluatedDecisionRecord {
  const now = options.now ?? new Date();
  const result = evaluate(policy, request, { ...options, now });
  const input: DecisionRecordInput = { id, policy, request, result, evaluatedAt: now };
  return { result, quads: decisionRecord(input), jsonld: decisionRecordJsonLd(input) };
}
