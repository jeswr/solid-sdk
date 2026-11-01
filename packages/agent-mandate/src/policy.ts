// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  constraintSatisfied,
  evaluate,
  LEFT_OPERANDS,
  matchingPermissions,
  ODRL_ACTIONS,
  type OdrlActionName,
  type OdrlDuty,
  type OdrlPolicy,
  type OdrlRule,
  OPERATORS,
} from "@jeswr/solid-odrl";
import { validInstant } from "./instant.js";
import {
  AGENT,
  type Constraint,
  type Decision,
  type Intent,
  LIMIT_OPERANDS,
  type Mandate,
  type Policy,
  type PolicyEngine,
  type Rule,
} from "./types.js";

const actions = new Set<string>([
  ...ODRL_ACTIONS,
  ...["SendMessage", "Transfer", "Sign", "BookAppointment"].map((x) => `${AGENT}${x}`),
]);
const operands = new Set<string>([
  ...LEFT_OPERANDS,
  ...LIMIT_OPERANDS,
  ...["recipientSet", "binding", "costExceeds"].map((x) => `${AGENT}${x}`),
]);

function supportedDuty(d: OdrlDuty): boolean {
  return (
    (ODRL_ACTIONS as readonly string[]).includes(d.action) &&
    (d.constraints ?? []).every(
      (c) => operands.has(c.leftOperand) && (OPERATORS as readonly string[]).includes(c.operator),
    )
  );
}

/** Validate the profile before asking an engine; unsupported terms never grant authority. */
export function supportedPolicy(p: Policy): boolean {
  return (
    (p.conflict === undefined || p.conflict === "prohibit") &&
    p.profile === undefined &&
    (p.obligations ?? []).every(supportedDuty) &&
    [...(p.permissions ?? []), ...(p.prohibitions ?? [])].every(
      (r) =>
        actions.has(r.action) &&
        (r.duties ?? []).every(supportedDuty) &&
        (r.constraints ?? []).every(
          (c) =>
            operands.has(c.leftOperand) && (OPERATORS as readonly string[]).includes(c.operator),
        ),
    )
  );
}

const XSD = "http://www.w3.org/2001/XMLSchema#";
const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const numericOperands = new Set([
  "count",
  "delegationDepth",
  ...LIMIT_OPERANDS,
  `${AGENT}costExceeds`,
]);

/** Canonical decimal identity, including exponent notation from Number#toString. */
function decimalIdentity(value: string): string {
  const [mantissa, exponent = "0"] = value.toLowerCase().split("e") as [string, string?];
  const [integer, fraction = ""] = mantissa.replace(/^[+-]/, "").split(".") as [string, string?];
  const digits = `${integer}${fraction}`.replace(/^0+/, "");
  const significant = digits.replace(/0+$/, "");
  if (significant === "") return "0";
  const power = Number(exponent) - fraction.length + digits.length - significant.length;
  return `${mantissa.startsWith("-") ? "-" : ""}${significant}e${power}`;
}

function numeric(value: unknown, datatype: string): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  if (!numericPattern.test(String(value)) || !Number.isFinite(Number(value))) return false;
  // Both evaluators compare binary64 numbers: accept float only when binary32 agrees.
  if (datatype === `${XSD}float`) return Math.fround(Number(value)) === Number(value);
  if (datatype === `${XSD}integer`)
    return /^[+-]?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
  if (datatype === `${XSD}decimal`)
    return (
      !/[eE]/.test(String(value)) &&
      decimalIdentity(String(value)) === decimalIdentity(String(Number(value)))
    );
  return true;
}

function temporal(value: unknown, datatype: string): boolean {
  if (typeof value !== "string") return false;
  const pattern =
    datatype === `${XSD}date`
      ? /^\d{4}-\d{2}-\d{2}$/
      : /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3}0*)?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;
  return (
    pattern.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10)
  );
}

/** Resolve scalar semantics once for validation and optional backend serialization. */
export function operandDatatype(c: Constraint): string {
  const first = Array.isArray(c.rightOperand) ? c.rightOperand[0] : c.rightOperand;
  return (
    c.datatype ??
    (c.leftOperand === "dateTime"
      ? `${XSD}dateTime`
      : numericOperands.has(c.leftOperand) || numeric(first, `${XSD}double`)
        ? `${XSD}double`
        : `${XSD}string`)
  );
}

/** Both sides must be comparable without the upstream lexical fallback for malformed values. */
export function knownOperand(c: Constraint, value: unknown): boolean {
  const rights: unknown[] = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  const lefts: unknown[] = Array.isArray(value) ? value : [value];
  if (rights.length === 0 || lefts.length === 0) return false;
  if (
    ["eq", "neq", "gt", "gteq", "lt", "lteq"].includes(c.operator) &&
    (lefts.length !== 1 || rights.length !== 1)
  )
    return false;
  const datatype = operandDatatype(c);
  if (c.leftOperand === "dateTime" && ![`${XSD}dateTime`, `${XSD}date`].includes(datatype))
    return false;
  return [...lefts, ...rights].every((v) => {
    if ([`${XSD}integer`, `${XSD}decimal`, `${XSD}double`, `${XSD}float`].includes(datatype))
      return numeric(v, datatype);
    if (datatype === `${XSD}dateTime` || datatype === `${XSD}date`) return temporal(v, datatype);
    if (datatype === `${XSD}anyURI`)
      return typeof v === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/.test(v);
    // Numeric-looking strings would be coerced by the upstream evaluator even with xsd:string.
    if (datatype === `${XSD}string`)
      return typeof v === "string" && (v.trim() === "" || !Number.isFinite(Number(v)));
    return false;
  });
}

const isOdrlAction = (action: string): action is OdrlActionName =>
  (ODRL_ACTIONS as readonly string[]).includes(action);

/** Whether a rule on `broad` covers a request for `narrow` (the shared ODRL implications). */
function covers(policyId: string, broad: string, narrow: OdrlActionName): boolean {
  return (
    matchingPermissions(
      { id: policyId, permissions: [{ type: "permission", action: broad as OdrlActionName }] },
      { action: narrow },
    ).length > 0
  );
}

/** Which side of a policy a rule sits on. */
export type RuleKind = "permission" | "prohibition";

/**
 * Match action, target and effective assignee before lowering for either backend.
 * A prohibition also matches a request for a BROADER action that covers the
 * prohibited one (a `write` request covers a prohibited `append`), so "any
 * prohibition wins" cannot be sidestepped by asking for the umbrella action.
 * Callers pass `kind` from the array the rule came from; without it the rule's
 * membership in `p.prohibitions` decides.
 */
export function candidate(
  r: Rule,
  p: Policy,
  q: Intent,
  kind: RuleKind = (p.prohibitions ?? []).includes(r) ? "prohibition" : "permission",
): boolean {
  const prohibition = kind === "prohibition";
  // Use the shared matcher for standard action implications before validating context.
  const actionMatches = isOdrlAction(q.action)
    ? covers(p.id, r.action, q.action) ||
      (prohibition && isOdrlAction(r.action) && covers(p.id, q.action, r.action))
    : r.action === q.action;
  return (
    actionMatches &&
    (r.target === undefined || r.target === q.target) &&
    ((r.assignee ?? p.assignee) === undefined || (r.assignee ?? p.assignee) === q.agent)
  );
}

/** Shared standard action implications and exact profile actions, then lowered to odrl:use. */
export const solidOdrlEngine: PolicyEngine = {
  id: "@jeswr/solid-odrl",
  evaluate(p, q) {
    const supported = supportedPolicy(p);
    const attributes: NonNullable<Intent["attributes"]> = { ...q.attributes, dateTime: q.at };
    const permitted = (p.permissions ?? []).filter((r) => candidate(r, p, q, "permission"));
    const prohibited = (p.prohibitions ?? []).filter((r) => candidate(r, p, q, "prohibition"));
    const missing = [...permitted, ...prohibited].some((r) =>
      (r.constraints ?? []).some((c) => !knownOperand(c, attributes[c.leftOperand])),
    );
    // A set-valued request operand is safe only where its operator errs toward
    // denial for the rule kind. isAnyOf is satisfied when ANY element matches, so
    // one allowed recipient would carry unlisted ones through a permission (or a
    // duty) allowlist; isNoneOf fails when one element is listed, so one listed
    // recipient would switch off a "never outside this set" prohibition. Leave
    // both to confirmation (the sparq adapter refuses set-valued operands outright).
    // isAllOf only requires the listed values to be present, so an unlisted extra
    // value would also ride through a permission: confirm unless every request
    // value is literally listed.
    const unsafeSet = (kind: RuleKind) => (c: Constraint) => {
      const value = attributes[c.leftOperand];
      if (!Array.isArray(value)) return false;
      if (kind === "prohibition") return c.operator === "isNoneOf";
      if (c.operator === "isAnyOf") return true;
      if (c.operator !== "isAllOf") return false;
      const listed = (Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand]).map(
        String,
      );
      return value.some((v) => !listed.includes(String(v)));
    };
    const setValued =
      permitted.some(
        (r) =>
          (r.constraints ?? []).some(unsafeSet("permission")) ||
          (r.duties ?? []).some((d) => (d.constraints ?? []).some(unsafeSet("permission"))),
      ) ||
      prohibited.some((r) => (r.constraints ?? []).some(unsafeSet("prohibition"))) ||
      (p.obligations ?? []).some((d) => (d.constraints ?? []).some(unsafeSet("permission")));
    const lower = (rs: readonly Rule[] | undefined, kind: RuleKind): OdrlRule[] =>
      (rs ?? [])
        .filter(
          (r) =>
            candidate(r, p, q, kind) &&
            (r.constraints ?? []).every((c) => knownOperand(c, attributes[c.leftOperand])),
        )
        .map((r) => ({
          ...r,
          action: "use",
          constraints: r.constraints as OdrlRule["constraints"],
        }));
    const permissions = lower(p.permissions, "permission");
    const lowered: OdrlPolicy = {
      ...p,
      conflict: "prohibit",
      permissions,
      prohibitions: lower(p.prohibitions, "prohibition"),
      obligations: [], // Checked independently below, including when no rule matches.
    };
    const request = { ...q, action: "use" as const, attributes };
    const now = new Date(q.at);
    const activeDuties = matchingPermissions(lowered, request, { now }).flatMap(
      (r) => r.duties ?? [],
    );
    // Duty constraints are checked below before calling the upstream comparison fallback.
    const result = evaluate(
      {
        ...lowered,
        permissions: permissions.map((r) => ({ ...r, duties: [] })),
      },
      request,
      { now },
    );
    // A definite prohibition takes precedence even when another rule lacks context.
    if (result.matchedProhibitions.length > 0) return { effect: "prohibited" };
    // Policy obligations remain active even when the evaluator returns no matching rules/duties.
    const unmetDuty = [...(p.obligations ?? []), ...activeDuties].some((d) => {
      const fulfilled = attributes[`fulfilled:${d.action}`];
      return (
        (fulfilled !== true && fulfilled !== "true" && fulfilled !== 1) ||
        (d.constraints ?? []).some(
          (c) =>
            !knownOperand(c, attributes[c.leftOperand]) || !constraintSatisfied(c, request, now),
        )
      );
    });
    if (!supported || missing || setValued || unmetDuty) return { effect: "indeterminate" };
    return { effect: result.decision === "permit" ? "permit" : "not-applicable" };
  },
};

/** Compose every policy set with prohibition precedence and fail-closed validity. */
export async function evaluateIntent(
  mandate: Mandate | undefined,
  intent: Intent,
  engine: PolicyEngine = solidOdrlEngine,
): Promise<Decision> {
  if (
    !mandate ||
    !validInstant(intent.at) ||
    !validInstant(mandate.validFrom) ||
    !validInstant(mandate.validUntil)
  )
    return { decision: "refuse-all", reason: "mandate-invalid" };
  if (Date.parse(mandate.validUntil) <= Date.parse(intent.at))
    return { decision: "refuse-all", reason: "mandate-expired" };
  if (Date.parse(mandate.validFrom) > Date.parse(intent.at))
    return { decision: "refuse-all", reason: "mandate-not-yet-valid" };
  if (mandate.subject !== intent.agent) return { decision: "refuse-all", reason: "wrong-agent" };
  const policies: Policy[] = [
    mandate.autonomous,
    mandate.withApproval,
    { id: mandate.id, prohibitions: mandate.prohibitions },
  ];
  const effects = await Promise.all(
    policies.map(async (p) => {
      try {
        return (await engine.evaluate(p, intent)).effect;
      } catch {
        return "indeterminate";
      }
    }),
  );
  if (effects.includes("prohibited")) return { decision: "prohibited", reason: "prohibition" };
  if (
    policies.some((p) => !supportedPolicy(p)) ||
    effects.some((e) => !["permit", "not-applicable"].includes(e))
  )
    return { decision: "confirm-required", reason: "indeterminate" };
  if (effects[0] === "permit") return { decision: "permit", reason: "autonomous" };
  return {
    decision: "confirm-required",
    reason: effects[1] === "permit" ? "owner-approval" : "no-matching-rule",
  };
}
