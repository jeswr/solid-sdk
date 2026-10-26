/**
 * Declared policy module seam: which ODRL evaluator decides ONE policy for ONE request.
 *
 * The mandate layering (autonomous vs with-approval policies, owner approvals bound to the
 * action digest, validity, revocation) and the pilot ODRL subset stay in the composition
 * layer (`mandate.ts`); an engine only answers, for one policy:
 *  - `permit`         — a permission applies and nothing prohibits it;
 *  - `prohibited`     — a prohibition applies (deny-overrides);
 *  - `not-applicable` — no permission applies;
 *  - `indeterminate`  — the answer depends on context the request lacks, or on an
 *                       unsupported term, or the engine itself could not answer.
 * Engines are explicitly selected and never fall back to one another.
 */
import { evaluate, type OdrlPolicy, type OdrlRule } from "@jeswr/solid-odrl";
import type { Iri } from "../core/types.js";

/** One concrete request against one policy. */
export interface EngineRequest {
  /** The subject the policy is evaluated for (the mandate's actor, a grant's assignee). */
  readonly agent: Iri;
  /** ODRL action local name in the pilot subset (use/read/distribute/compensate/transfer). */
  readonly action: string;
  readonly target: Iri;
  readonly purpose?: Iri;
  readonly recipient?: Iri;
  /** Evaluation time (ISO instant). */
  readonly at: string;
}

export interface EngineVerdict {
  readonly effect: "permit" | "prohibited" | "not-applicable" | "indeterminate";
  readonly reason: string;
  readonly matchedRule?: string;
  /** Evaluator identity as reported by the engine for this decision (overrides `id`). */
  readonly evaluator?: string;
}

/**
 * The implementation that evaluates the shared policy profile — shareable metadata only
 * (never a local path or digest). Peers need not run the same evaluator to interoperate.
 */
export interface PolicyModuleInfo {
  readonly name: string;
  readonly version: string;
  readonly interface: string;
}

export type ModuleAvailability =
  | { readonly status: "ready" }
  | { readonly status: "unavailable"; readonly reason: string };

export interface PolicyEngine {
  /** Identity recorded in every authorisation decision this engine makes. */
  readonly id: string;
  /** The evaluator implementation, for implementation descriptions. */
  readonly module?: PolicyModuleInfo;
  /** Current availability, re-checked on every call (long-running services report this). */
  availability?(): ModuleAvailability;
  evaluate(policy: OdrlPolicy, request: EngineRequest): EngineVerdict;
}

export const SOLID_ODRL_ENGINE_ID =
  "@jeswr/solid-odrl@b8fabc729c56245f4b63846261f1f06b6503f1c8 evaluate() via awp pilot-subset adapter 0.1";

export const SOLID_ODRL_MODULE: PolicyModuleInfo = {
  name: "@jeswr/solid-odrl",
  version: "b8fabc729c56245f4b63846261f1f06b6503f1c8",
  interface: "evaluate() via awp pilot-subset adapter 0.1 (in-process)",
};

function requestContext(r: EngineRequest) {
  const attributes: Record<string, string> = { dateTime: r.at };
  if (r.purpose) attributes.purpose = r.purpose;
  if (r.recipient) attributes.recipient = r.recipient;
  return { agent: r.agent, action: r.action as OdrlRule["action"], target: r.target, attributes };
}

/** Operands constrained by rules that would otherwise apply, but absent from the request. */
export function missingContext(p: OdrlPolicy, r: EngineRequest): string[] {
  const ctx = requestContext(r);
  const missing = new Set<string>();
  for (const rule of [...(p.permissions ?? []), ...(p.prohibitions ?? [])]) {
    const assignee = rule.assignee ?? p.assignee;
    if (rule.target && rule.target !== ctx.target) continue;
    if (assignee && assignee !== r.agent) continue;
    if (rule.action !== ctx.action && rule.action !== "use") continue;
    for (const c of rule.constraints ?? []) {
      if (!(c.leftOperand in ctx.attributes)) missing.add(c.leftOperand);
    }
  }
  return [...missing];
}

/**
 * The default engine: `@jeswr/solid-odrl` `evaluate()`, preceded by the pilot's own
 * missing-context check (solid-odrl reads absent context as a non-match, so the adapter
 * turns a would-be-applicable rule with an absent operand into `indeterminate`).
 */
export const solidOdrlEngine: PolicyEngine = {
  id: SOLID_ODRL_ENGINE_ID,
  module: SOLID_ODRL_MODULE,
  availability: () => ({ status: "ready" }),
  evaluate(policy, request) {
    const missing = missingContext(policy, request);
    if (missing.length > 0)
      return { effect: "indeterminate", reason: `missing-context: ${missing.join(", ")}` };
    const r = evaluate(policy, requestContext(request), {
      now: new Date(request.at),
      requireDuties: true,
    });
    const matchedRule = r.matchedPermissions[0]?.id;
    if (r.decision === "permit")
      return { effect: "permit", reason: r.reason, ...(matchedRule ? { matchedRule } : {}) };
    if (r.decision === "deny") return { effect: "prohibited", reason: r.reason };
    return { effect: "not-applicable", reason: r.reason };
  },
};
