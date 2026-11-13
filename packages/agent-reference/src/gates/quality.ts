// AUTHORED-BY Claude Opus 5.5
/**
 * Fitness and item terms: the parts of the gates that read the quality information and the
 * terms of use a statement carries. Fitness applies the reliance profile (method and age per
 * kind of claim); item terms are ODRL policies in the pilot subset, decided by the same policy
 * engine as mandates.
 */
import type { Iri } from "../core/types.js";
import { type PolicyEngine, solidOdrlEngine } from "../mechanisms/policy-engine.js";
import type { ItemTerms, RelianceProfile } from "./common.js";
import { idWords } from "./common.js";

export interface QualityClaim {
  readonly claimType: string;
  readonly method?: string;
  readonly asOf?: string;
  readonly issuedAt?: string;
  readonly period?: { readonly start: string; readonly end: string };
  readonly validUntil?: string;
}

const DAY = 86_400_000;

/** When the claim speaks of: its `asOf`, else the end of its period, else when it was issued. */
export function claimTime(c: QualityClaim): string | undefined {
  if (c.asOf) return c.asOf;
  if (c.period?.end && /^\d{4}-\d{2}$/.test(c.period.end)) {
    const [y, m] = c.period.end.split("-").map((x) => Number.parseInt(x, 10));
    return new Date(Date.UTC(y ?? 0, m ?? 1, 0, 23, 59, 59)).toISOString();
  }
  return c.issuedAt;
}

export interface Fitness {
  readonly verdict: "pass" | "fail" | "indeterminate";
  readonly reason?: string;
  readonly rule?: { readonly id: string; readonly text: string };
  readonly ageDays?: number;
}

/** Is this claim fit for the task under the reliance profile? */
export function fitnessOf(
  c: QualityClaim,
  profile: RelianceProfile | undefined,
  at: string,
): Fitness {
  const rule = profile?.rules.find((r) =>
    r.claimType.endsWith(".*")
      ? c.claimType.startsWith(r.claimType.slice(0, -1))
      : r.claimType === c.claimType,
  );
  if (!rule) return { verdict: "indeterminate", reason: "missing-context" };
  const ruleRef = { id: rule.id, text: rule.text };
  if (!c.method || !rule.methods.includes(c.method))
    return { verdict: "fail", reason: "method-not-accepted", rule: ruleRef };
  if (c.validUntil && Date.parse(c.validUntil) <= Date.parse(at))
    return { verdict: "fail", reason: "stale-data", rule: ruleRef };
  const when = claimTime(c);
  if (!when) return { verdict: "indeterminate", reason: "missing-context", rule: ruleRef };
  const ageDays = Math.floor((Date.parse(at) - Date.parse(when)) / DAY);
  if (ageDays > rule.maxAgeDays)
    return { verdict: "fail", reason: "stale-data", rule: ruleRef, ageDays };
  return { verdict: "pass", rule: ruleRef, ageDays };
}

export interface TermsVerdict {
  readonly verdict: "pass" | "fail" | "indeterminate";
  readonly reason?: string;
  readonly text: string;
}

/** Plain words for an item's terms. */
export function termsSummary(terms: ItemTerms | undefined): string {
  if (!terms) return "no terms attached";
  const uses = new Set<string>();
  const shares = new Set<string>();
  const never = new Set<string>();
  for (const r of terms.policy.permissions ?? []) {
    for (const c of r.constraints ?? [])
      if (c.leftOperand === "purpose") {
        const v = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
        for (const p of v) (r.action === "distribute" ? shares : uses).add(idWords(String(p)));
      }
  }
  for (const r of terms.policy.prohibitions ?? [])
    for (const c of r.constraints ?? []) {
      const v = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
      for (const p of v) never.add(idWords(String(p)));
    }
  return [
    uses.size > 0 ? `use for ${[...uses].join(" or ")}` : "",
    shares.size > 0
      ? `share${terms.recipientMustBe ? ` with ${terms.recipientMustBe.label}` : ""} for ${[...shares].join(" or ")}`
      : "",
    terms.deleteWithinDays ? `delete within ${terms.deleteWithinDays} days` : "",
    never.size > 0 ? `never for ${[...never].join(" or ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Can the holder keep these terms for what it needs: use (or share) for `purpose`, keeping
 * the data `retentionDays`? Terms are decided by the policy engine; the deletion duty is
 * compared with the retention needed.
 */
export function evaluateItemTerms(
  terms: ItemTerms | undefined,
  need: {
    readonly agent: Iri;
    readonly action: "use" | "distribute";
    readonly target: Iri;
    readonly purpose?: Iri;
    readonly recipient?: Iri;
    readonly retentionDays?: number;
    readonly at: string;
  },
  engine: PolicyEngine = solidOdrlEngine,
): TermsVerdict {
  if (!terms)
    return {
      verdict: "pass",
      text: "No terms came with it, so the default applies: use for this interaction only, no onward sharing, delete when it ends.",
    };
  const v = engine.evaluate(terms.policy, {
    agent: need.agent,
    action: need.action,
    target: need.target,
    ...(need.purpose ? { purpose: need.purpose } : {}),
    ...(need.recipient ? { recipient: need.recipient } : {}),
    at: need.at,
  });
  const summary = termsSummary(terms);
  if (v.effect === "indeterminate")
    return {
      verdict: "indeterminate",
      reason: "indeterminate-policy",
      text: `Its terms cannot be decided (${summary}).`,
    };
  if (v.effect === "prohibited")
    return { verdict: "fail", reason: "prohibited", text: `Its terms forbid this (${summary}).` };
  if (v.effect !== "permit")
    return {
      verdict: "fail",
      reason: "purpose-not-permitted",
      text: `Its terms do not allow this purpose (${summary}).`,
    };
  if (terms.deleteWithinDays !== undefined && (need.retentionDays ?? 0) > terms.deleteWithinDays)
    return {
      verdict: "fail",
      reason: "terms-not-acceptable",
      text: `Its terms say delete within ${terms.deleteWithinDays} days; this needs ${need.retentionDays}.`,
    };
  return { verdict: "pass", text: `Its terms allow this: ${summary}.` };
}
