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

function numeric(value: unknown, datatype: string): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  if (!numericPattern.test(String(value)) || !Number.isFinite(Number(value))) return false;
  if (datatype === `${XSD}integer`)
    return /^[+-]?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
  if (datatype === `${XSD}decimal`) return !/[eE]/.test(String(value));
  return true;
}

function temporal(value: unknown, datatype: string): boolean {
  if (typeof value !== "string") return false;
  const pattern =
    datatype === `${XSD}date`
      ? /^\d{4}-\d{2}-\d{2}$/
      : /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  return (
    pattern.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10)
  );
}

/** Both sides must be comparable without the upstream lexical fallback for malformed values. */
function knownOperand(c: Constraint, value: unknown): boolean {
  const rights: unknown[] = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  const lefts: unknown[] = Array.isArray(value) ? value : [value];
  if (rights.length === 0 || lefts.length === 0) return false;
  if (["eq", "neq", "gt", "gteq", "lt", "lteq"].includes(c.operator) && rights.length !== 1)
    return false;
  const datatype =
    c.datatype ??
    (c.leftOperand === "dateTime"
      ? `${XSD}dateTime`
      : numericOperands.has(c.leftOperand) || numeric(rights[0], `${XSD}double`)
        ? `${XSD}double`
        : `${XSD}string`);
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

function candidate(r: Rule, p: Policy, q: Intent): boolean {
  // Use the shared matcher for standard action implications before validating context.
  const actionMatches = (ODRL_ACTIONS as readonly string[]).includes(q.action)
    ? matchingPermissions(
        { id: p.id, permissions: [{ type: "permission", action: r.action as OdrlActionName }] },
        { action: q.action as OdrlActionName },
      ).length > 0
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
    const rules = [...(p.permissions ?? []), ...(p.prohibitions ?? [])].filter((r) =>
      candidate(r, p, q),
    );
    const missing = rules.some((r) =>
      (r.constraints ?? []).some((c) => !knownOperand(c, attributes[c.leftOperand])),
    );
    const lower = (rs: readonly Rule[] = []): OdrlRule[] =>
      rs
        .filter(
          (r) =>
            candidate(r, p, q) &&
            (r.constraints ?? []).every((c) => knownOperand(c, attributes[c.leftOperand])),
        )
        .map((r) => ({
          ...r,
          action: "use",
          constraints: r.constraints as OdrlRule["constraints"],
        }));
    const permissions = lower(p.permissions);
    const lowered: OdrlPolicy = {
      ...p,
      conflict: "prohibit",
      permissions,
      prohibitions: lower(p.prohibitions),
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
    if (!supported || missing || unmetDuty) return { effect: "indeterminate" };
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
    !Number.isFinite(Date.parse(intent.at)) ||
    !Number.isFinite(Date.parse(mandate.validFrom)) ||
    !Number.isFinite(Date.parse(mandate.validUntil))
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
