// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The CLIENT-SIDE ODRL policy evaluator. PURE + DETERMINISTIC: given an OdrlPolicy
// and a RequestContext it decides permit / deny / notApplicable, reporting the
// matched rules, the constraint outcomes and the active duties. It performs NO I/O
// (no fetch, no clock unless the caller omits `now`), so it is fully testable.
//
// ODRL semantics implemented (per the ODRL 2.2 Information Model + the Formal
// Semantics CG draft, scoped to a single policy + request):
//   - A rule MATCHES the request iff its action implies the requested action
//     (odrl:use is the umbrella that implies any concrete action), its target
//     equals the requested target (or the rule has no target), its assignee equals
//     the requesting agent (or the rule has no assignee), AND every one of its
//     constraints is SATISFIED by the request context. A constraint whose
//     left-operand value is not supplied by the context is UNSATISFIED
//     (fail-closed) — so a constrained permission does not silently grant.
//   - If a matching PROHIBITION exists and no matching permission → deny.
//   - If a matching PERMISSION exists and no matching prohibition → permit (with
//     any duties reported; gated only if `requireDuties`).
//   - If BOTH a matching permission and a matching prohibition exist → CONFLICT,
//     resolved by the policy's `conflict` strategy:
//       perm     → permit (permission wins)
//       prohibit → deny    (prohibition wins) — ALSO the safe DEFAULT when the
//                  policy specifies no strategy (deny-biased, matching ODRL's
//                  recommended "prohibit" default and a fail-closed posture).
//       invalid  → the whole policy is void → deny (notApplicable would let a
//                  caller fall through to a less-safe default; deny is fail-closed).
//   - If NEITHER matches → notApplicable (the policy says nothing about this
//     request; the caller decides the default — typically deny for usage control).

import type {
  ActiveDuty,
  Decision,
  DecisionRule,
  EvaluateOptions,
  EvaluationResult,
  OdrlConstraint,
  OdrlDuty,
  OdrlPolicy,
  OdrlRule,
  RequestContext,
} from "./types.js";
import { ACTION_IMPLIED_BY, type OdrlActionName, XSD } from "./vocab.js";

/**
 * Evaluate a {@link RequestContext} against an {@link OdrlPolicy}. Pure +
 * deterministic. See the file header for the exact semantics.
 */
export function evaluate(
  policy: OdrlPolicy,
  request: RequestContext,
  options: EvaluateOptions = {},
): EvaluationResult {
  const now = options.now ?? new Date();

  // Resolve EFFECTIVE rules first: a rule inherits the policy-level assigner /
  // assignee when it omits its own (the documented inheritance — and exactly what
  // policyToRdf writes onto each serialised rule, so in-memory and round-tripped
  // policies evaluate identically). Match on the effective rules.
  const effectivePermissions = (policy.permissions ?? []).map((r) => effectiveRule(r, policy));
  const effectiveProhibitions = (policy.prohibitions ?? []).map((r) => effectiveRule(r, policy));

  // Keep the matched effective RULE OBJECTS (not just their trace) so duty
  // collection can match by object identity, never by action-only fallback.
  const matchedPermissionRules = effectivePermissions.filter((r) => ruleMatches(r, request, now));
  const matchedProhibitionRules = effectiveProhibitions.filter((r) => ruleMatches(r, request, now));

  const matchedPermissions = matchedPermissionRules.map((r) => toDecisionRule(r, "permission"));
  const matchedProhibitions = matchedProhibitionRules.map((r) => toDecisionRule(r, "prohibition"));

  const hasPermit = matchedPermissions.length > 0;
  const hasProhibit = matchedProhibitions.length > 0;
  const conflict = hasPermit && hasProhibit;

  // Collect the duties the matched permission(s) + policy obligations impose,
  // keyed on the matched effective rule objects (identity, not action).
  const duties = collectDuties(policy, matchedPermissionRules, request, now);

  // --- resolve the decision -------------------------------------------------
  if (!hasPermit && !hasProhibit) {
    return result(
      "notApplicable",
      "No permission or prohibition matches the request.",
      matchedPermissions,
      matchedProhibitions,
      [],
      false,
    );
  }

  if (conflict) {
    const strategy = policy.conflict ?? "prohibit"; // safe default: deny wins.
    if (strategy === "perm") {
      return decidePermit(
        matchedPermissions,
        matchedProhibitions,
        duties,
        options,
        "Conflict resolved by odrl:perm — permission overrides prohibition.",
        true,
      );
    }
    if (strategy === "invalid") {
      return result(
        "deny",
        "Conflict resolved by odrl:invalid — the policy is void; denying (fail-closed).",
        matchedPermissions,
        matchedProhibitions,
        [],
        true,
      );
    }
    // "prohibit" (and the default): prohibition wins.
    return result(
      "deny",
      "Conflict resolved by odrl:prohibit — prohibition overrides permission.",
      matchedPermissions,
      matchedProhibitions,
      [],
      true,
    );
  }

  if (hasProhibit) {
    return result(
      "deny",
      "A prohibition matches the request.",
      matchedPermissions,
      matchedProhibitions,
      [],
      false,
    );
  }

  // hasPermit only.
  return decidePermit(
    matchedPermissions,
    matchedProhibitions,
    duties,
    options,
    "A permission matches the request.",
    false,
  );
}

/** Decide a permit (honour `requireDuties`: an unfulfilled required duty → deny). */
function decidePermit(
  perms: DecisionRule[],
  prohibits: DecisionRule[],
  duties: ActiveDuty[],
  options: EvaluateOptions,
  reason: string,
  conflict: boolean,
): EvaluationResult {
  if (options.requireDuties) {
    const outstanding = duties.filter((d) => !d.fulfilled);
    if (outstanding.length > 0) {
      const names = outstanding.map((d) => d.action).join(", ");
      return result(
        "deny",
        `${reason} But requireDuties is set and these duties are unfulfilled: ${names}.`,
        perms,
        prohibits,
        duties,
        conflict,
      );
    }
  }
  return result("permit", reason, perms, prohibits, duties, conflict);
}

/** Assemble an {@link EvaluationResult}. */
function result(
  decision: Decision,
  reason: string,
  matchedPermissions: DecisionRule[],
  matchedProhibitions: DecisionRule[],
  duties: ActiveDuty[],
  conflict: boolean,
): EvaluationResult {
  return { decision, reason, matchedPermissions, matchedProhibitions, duties, conflict };
}

/**
 * Resolve a rule's EFFECTIVE form: inherit the policy-level `assigner` / `assignee`
 * when the rule omits its own. This mirrors what {@link policyToRdf} writes onto
 * each serialised rule, so an in-memory policy and its serialise→parse round-trip
 * evaluate IDENTICALLY (the bug otherwise: a policy-level assignee with a rule that
 * omits one would permit ANY agent in-memory, yet bind to the assignee once
 * round-tripped). Identity-preserving for the matched-rule duty lookup is fine
 * because we map the SAME source array, so each effective rule is a distinct object
 * the filter keeps by reference.
 */
function effectiveRule(rule: OdrlRule, policy: OdrlPolicy): OdrlRule {
  const assignee = rule.assignee ?? policy.assignee;
  const assigner = rule.assigner ?? policy.assigner;
  if (assignee === rule.assignee && assigner === rule.assigner) {
    return rule;
  }
  return {
    ...rule,
    ...(assignee !== undefined && { assignee }),
    ...(assigner !== undefined && { assigner }),
  };
}

/** Project a rule to its decision-trace form. */
function toDecisionRule(rule: OdrlRule, type: "permission" | "prohibition"): DecisionRule {
  return {
    type,
    action: rule.action,
    ...(rule.target !== undefined && { target: rule.target }),
    ...(rule.assignee !== undefined && { assignee: rule.assignee }),
    ...(rule.id !== undefined && { id: rule.id }),
  };
}

/**
 * Does `rule` apply to `request`? Action-implication + target + assignee + every
 * constraint must hold.
 */
function ruleMatches(rule: OdrlRule, request: RequestContext, now: Date): boolean {
  if (!actionApplies(rule.action, request.action)) {
    return false;
  }
  // A rule with a target only applies to that target; a rule with no target is
  // policy-wide (applies to any requested target).
  if (rule.target !== undefined && rule.target !== request.target) {
    return false;
  }
  // A rule with an assignee only applies to that agent; no assignee → any agent.
  if (rule.assignee !== undefined && rule.assignee !== request.agent) {
    return false;
  }
  // ALL constraints must be satisfied (fail-closed on a missing context value).
  for (const c of rule.constraints ?? []) {
    if (!constraintSatisfied(c, request, now)) {
      return false;
    }
  }
  return true;
}

/** Does the rule's action concept cover the requested action (odrl:use umbrella)? */
function actionApplies(ruleAction: OdrlActionName, requested: OdrlActionName): boolean {
  // The rule's action applies if it is the requested action, or the umbrella `use`.
  return ACTION_IMPLIED_BY[requested].has(ruleAction);
}

/**
 * Collect duties (matched-permission duties + policy obligations) into active-duty
 * traces. Takes the matched effective permission RULE OBJECTS and uses them
 * directly — only the duties of a rule that actually matched the request are
 * active. No action-only fallback (the earlier bug: two permissions sharing an
 * action but differing by target/assignee/constraints would leak the non-matching
 * rule's duties, and wrongly deny under `requireDuties`).
 */
function collectDuties(
  policy: OdrlPolicy,
  matchedPermissionRules: readonly OdrlRule[],
  request: RequestContext,
  now: Date,
): ActiveDuty[] {
  const out: ActiveDuty[] = [];
  for (const rule of matchedPermissionRules) {
    for (const duty of rule.duties ?? []) {
      out.push(toActiveDuty(duty, request, now));
    }
  }
  // Policy-level obligations are always active (they are not tied to a permission).
  for (const duty of policy.obligations ?? []) {
    out.push(toActiveDuty(duty, request, now));
  }
  return out;
}

/**
 * Project a duty to its active-duty trace, deciding `fulfilled` from the request
 * context: a duty is FULFILLED when the context asserts it has been discharged
 * (`attributes["fulfilled:<action>"] === true`/`"true"`) AND every duty constraint
 * is satisfied. Absent positive evidence, a duty is reported UNFULFILLED (so a
 * `requireDuties` caller fails closed; an advisory caller still sees it).
 */
function toActiveDuty(duty: OdrlDuty, request: RequestContext, now: Date): ActiveDuty {
  const constraintsOk = (duty.constraints ?? []).every((c) => constraintSatisfied(c, request, now));
  const key = `fulfilled:${duty.action}`;
  const asserted = request.attributes?.[key];
  const dischargedAsserted = asserted === true || asserted === "true" || asserted === 1;
  return {
    action: duty.action,
    ...(duty.target !== undefined && { target: duty.target }),
    ...(duty.id !== undefined && { id: duty.id }),
    fulfilled: constraintsOk && dischargedAsserted,
  };
}

/**
 * Is a single constraint satisfied by the request context? Fail-closed: a
 * constraint whose left-operand value the context does not supply is UNSATISFIED.
 */
export function constraintSatisfied(
  c: OdrlConstraint,
  request: RequestContext,
  now: Date,
): boolean {
  const supplied = requestValueFor(c, request, now);
  if (supplied === undefined) {
    return false; // fail-closed: no context value → not satisfied.
  }
  return compare(supplied, c, c.operator);
}

/**
 * The request value for a constraint's left-operand. `dateTime` falls back to the
 * injected `now` when the context does not assert one (so a time-window constraint
 * evaluates against the evaluation instant); every other left-operand must be
 * supplied explicitly in `request.attributes` (else `undefined` → fail-closed).
 */
function requestValueFor(
  c: OdrlConstraint,
  request: RequestContext,
  now: Date,
): string | number | ReadonlyArray<string | number> | undefined {
  const fromAttrs = request.attributes?.[c.leftOperand];
  if (fromAttrs !== undefined) {
    // A boolean attribute is a duty-discharge flag, not a constraint operand —
    // ignore it for constraint evaluation (fail-closed: undefined → unsatisfied).
    if (typeof fromAttrs === "boolean") {
      return undefined;
    }
    return fromAttrs;
  }
  if (c.leftOperand === "dateTime") {
    return now.toISOString();
  }
  return undefined;
}

/** Apply the operator between the request value and the constraint right-operand. */
function compare(
  requestValue: string | number | ReadonlyArray<string | number>,
  c: OdrlConstraint,
  operator: string,
): boolean {
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  // The ordering / equality operators are SCALAR — reduce an array request value
  // to its first element (a multi-valued request asserted against `eq`/`gt`/… uses
  // the first value; set membership uses the set operators below).
  const scalar = (Array.isArray(requestValue) ? requestValue[0] : requestValue) as string | number;
  const right0 = rights[0] as string | number;

  switch (operator) {
    case "eq":
      return scalarsEqual(scalar, right0, c);
    case "neq":
      return !scalarsEqual(scalar, right0, c);
    case "gt":
      return numericOrTemporalCompare(scalar, right0, c) > 0;
    case "gteq":
      return numericOrTemporalCompare(scalar, right0, c) >= 0;
    case "lt":
      return numericOrTemporalCompare(scalar, right0, c) < 0;
    case "lteq":
      return numericOrTemporalCompare(scalar, right0, c) <= 0;
    case "isAnyOf":
      return asArray(requestValue).some((rv) => rights.some((r) => scalarsEqual(rv, r, c)));
    case "isNoneOf":
      return asArray(requestValue).every((rv) => rights.every((r) => !scalarsEqual(rv, r, c)));
    case "isAllOf": {
      // Every right-operand must be present in the request value set.
      const rvSet = asArray(requestValue);
      return rights.every((r) => rvSet.some((rv) => scalarsEqual(rv, r, c)));
    }
    default:
      return false;
  }
}

/** Coerce a scalar-or-array to an array (for set operators). */
function asArray(
  v: string | number | ReadonlyArray<string | number>,
): ReadonlyArray<string | number> {
  return Array.isArray(v) ? v : [v as string | number];
}

/** Equality with type-aware coercion (numeric / temporal / lexical). */
function scalarsEqual(a: string | number, b: string | number, c: OdrlConstraint): boolean {
  const cmp = tryNumericOrTemporal(a, b, c);
  if (cmp !== undefined) {
    return cmp === 0;
  }
  return String(a) === String(b);
}

/** A 3-way sign compare (-1, 0, +1) over already-typed, comparable primitives. */
function cmp3<T extends string | number>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A 3-way compare (<0, 0, >0) treating the values as numbers when both parse as
 * numbers, as instants when the left-operand is `dateTime`, else lexically. Used by
 * the ordering operators. Throws nothing — falls back to a lexical compare.
 */
function numericOrTemporalCompare(
  a: string | number,
  b: string | number,
  c: OdrlConstraint,
): number {
  const typed = tryNumericOrTemporal(a, b, c);
  if (typed !== undefined) {
    return typed;
  }
  return cmp3(String(a), String(b));
}

/**
 * Attempt a typed 3-way compare; returns `undefined` if the values are not
 * comparably typed (caller falls back to lexical). Temporal when the constraint's
 * left-operand or datatype is dateTime; numeric when both sides parse as finite
 * numbers.
 */
function tryNumericOrTemporal(
  a: string | number,
  b: string | number,
  c: OdrlConstraint,
): number | undefined {
  const isTemporal =
    c.leftOperand === "dateTime" || c.datatype === `${XSD}dateTime` || c.datatype === `${XSD}date`;
  if (isTemporal) {
    const ta = Date.parse(String(a));
    const tb = Date.parse(String(b));
    // Both sides must parse to a valid instant, else fall back to lexical (undefined).
    return Number.isNaN(ta) || Number.isNaN(tb) ? undefined : cmp3(ta, tb);
  }
  // Only treat as numeric when BOTH parse to a finite number and the strings were
  // genuinely numeric (avoid "" → 0). Guard empty/whitespace.
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
    return undefined;
  }
  return cmp3(Number(a), Number(b));
}

/** True if the value is a number, or a non-empty string that parses to a finite number. */
function isFiniteNumber(v: string | number): boolean {
  if (typeof v === "number") {
    return Number.isFinite(v);
  }
  const s = v.trim();
  if (s === "") {
    return false;
  }
  return Number.isFinite(Number(s));
}
