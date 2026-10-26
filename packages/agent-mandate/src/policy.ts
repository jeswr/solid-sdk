// AUTHORED-BY Codex GPT-6.1-Sol
import {
  evaluate,
  LEFT_OPERANDS,
  ODRL_ACTIONS,
  type OdrlDuty,
  type OdrlPolicy,
  type OdrlRule,
  OPERATORS,
} from "@jeswr/solid-odrl";
import {
  AGENT,
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

function candidate(r: Rule, p: Policy, q: Intent): boolean {
  return (
    (r.action === q.action || r.action === "use") &&
    (r.target === undefined || r.target === q.target) &&
    ((r.assignee ?? p.assignee) === undefined || (r.assignee ?? p.assignee) === q.agent)
  );
}

/** In-process ODRL engine. Profile actions are matched exactly, then lowered to odrl:use. */
export const solidOdrlEngine: PolicyEngine = {
  id: "@jeswr/solid-odrl",
  evaluate(p, q) {
    const supported = supportedPolicy(p);
    const attributes = { ...q.attributes, dateTime: q.at };
    const rules = [...(p.permissions ?? []), ...(p.prohibitions ?? [])].filter((r) =>
      candidate(r, p, q),
    );
    const missing = rules.some((r) =>
      (r.constraints ?? []).some((c) => !Object.hasOwn(attributes, c.leftOperand)),
    );
    const lower = (rs: readonly Rule[] = []): OdrlRule[] =>
      rs
        .filter((r) => candidate(r, p, q))
        .map((r) => ({
          ...r,
          action: "use",
          constraints: r.constraints as OdrlRule["constraints"],
        }));
    const lowered: OdrlPolicy = {
      ...p,
      conflict: "prohibit",
      permissions: lower(p.permissions),
      prohibitions: lower(p.prohibitions),
    };
    const result = evaluate(lowered, { ...q, action: "use", attributes }, { now: new Date(q.at) });
    // A definite prohibition takes precedence even when another rule lacks context.
    if (result.matchedProhibitions.length > 0) return { effect: "prohibited" };
    if (!supported || missing || result.duties.some((d) => !d.fulfilled))
      return { effect: "indeterminate" };
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
