// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * Fitness and item terms: the parts of the gates that read the quality information and the
 * terms of use a statement carries. Fitness applies the reliance profile (method and age per
 * kind of claim); item terms are ODRL policies in the pilot subset, decided by the same policy
 * engine as mandates.
 */
import { z } from "zod";
import type { Iri } from "../core/types.js";
import { OUTSIDE_EFFECT_ACTIONS, type PILOT_ODRL_SUBSET } from "../mechanisms/mandate.js";
import { type PolicyEngine, solidOdrlEngine } from "../mechanisms/policy-engine.js";
import type { QualityInput, StatementQualityNode } from "../model/quality.js";
import type { Namer } from "../trace/packet.js";
import type { ItemTerms, RelianceProfile } from "./common.js";
import { idWords } from "./common.js";

const constraintShape = z
  .object({
    leftOperand: z.string(),
    operator: z.string(),
    rightOperand: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
  })
  .passthrough();
const ruleShape = z
  .object({ action: z.string(), constraints: z.array(constraintShape).optional() })
  .passthrough();
const termsShape = z
  .object({
    policy: z
      .object({
        id: z.string(),
        permissions: z.array(ruleShape).optional(),
        prohibitions: z.array(ruleShape).optional(),
        obligations: z.array(ruleShape).optional(),
      })
      .passthrough(),
    deleteWithinDays: z.number().nonnegative().optional(),
    recipientMustBe: z.object({ task: z.string(), label: z.string() }).optional(),
    minimumGroup: z.number().int().positive().optional(),
  })
  .passthrough();

/** Legacy ingress type; decisions below use the live RDF metadata view. */
export type QualityClaim = QualityInput;

const DAY = 86_400_000;

/** When the claim speaks of: its `asOf`, else the end of its period, else when it was issued. */
export function claimTime(c: StatementQualityNode): string | undefined {
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
  c: StatementQualityNode,
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

/** Validate the entire attached policy before selecting matching rules (UNS-15). */
export function unsupportedTerms(terms: ItemTerms): boolean {
  const p = terms.policy;
  if (
    Object.keys(terms).some(
      (key) =>
        !["policy", "inherited", "deleteWithinDays", "recipientMustBe", "minimumGroup"].includes(
          key,
        ),
    )
  )
    return true;
  const actions = new Set(["pay", "use", "read", "distribute", "compensate", "transfer"]);
  const operands = new Set(["dateTime", "purpose", "recipient"]);
  const operators = new Set(["eq", "neq", "isAnyOf", "isNoneOf", "lt", "lteq", "gt", "gteq"]);
  if (p.conflict && p.conflict !== "prohibit") return true;
  if (p.type && !["Set", "Offer", "Agreement"].includes(p.type)) return true;
  if (
    Object.keys(p).some(
      (key) =>
        ![
          "id",
          "type",
          "assigner",
          "assignee",
          "conflict",
          "permissions",
          "prohibitions",
          "obligations",
        ].includes(key),
    )
  )
    return true;
  for (const r of [...(p.permissions ?? []), ...(p.prohibitions ?? [])]) {
    if (!actions.has(String(r.action))) return true;
    if (r.type && !["permission", "prohibition"].includes(r.type)) return true;
    if (
      Object.keys(r).some(
        (key) =>
          !["id", "type", "action", "target", "assignee", "assigner", "constraints"].includes(key),
      )
    )
      return true;
    for (const c of r.constraints ?? [])
      if (
        !operands.has(c.leftOperand) ||
        !operators.has(c.operator) ||
        Object.keys(c).some((key) => !["leftOperand", "operator", "rightOperand"].includes(key))
      )
        return true;
  }
  for (const duty of p.obligations ?? []) {
    if (
      duty.action !== "delete" ||
      !duty.constraints?.length ||
      Object.keys(duty).some(
        (key) => !["id", "type", "action", "target", "constraints"].includes(key),
      )
    )
      return true;
    for (const c of duty.constraints)
      if (
        c.leftOperand !== "elapsedTime" ||
        c.operator !== "lteq" ||
        !/^P\d+D$/.test(String(c.rightOperand)) ||
        Object.keys(c).some((key) => !["leftOperand", "operator", "rightOperand"].includes(key))
      )
        return true;
  }
  return false;
}

/** Can the principal accept every use the request's offered terms would authorize? */
export function acceptsOfferedTerms(terms: ItemTerms, allowedPurposes: readonly string[]): boolean {
  for (const r of terms.policy.permissions ?? []) {
    const purposes = (r.constraints ?? []).filter((c) => c.leftOperand === "purpose");
    if (
      !purposes.length ||
      !purposes.some((c) => {
        const values = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
        return (
          ["eq", "isAnyOf"].includes(c.operator) &&
          values.length > 0 &&
          values.every((p) => allowedPurposes.includes(String(p)))
        );
      })
    )
      return false;
  }
  return (
    !terms.inherited ||
    terms.inherited.every((i) => !!i.terms && acceptsOfferedTerms(i.terms, allowedPurposes))
  );
}

/** Plain words for an item's terms. */
export function termsSummary(terms: ItemTerms | undefined, name?: Namer): string {
  if (!terms) return "no terms attached";
  if (!termsShape.safeParse(terms).success) return "unsupported terms";
  const uses = new Set<string>();
  const shares = new Set<string>();
  const never = new Set<string>();
  for (const r of terms.policy.permissions ?? []) {
    for (const c of r.constraints ?? [])
      if (c.leftOperand === "purpose") {
        const v = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
        for (const p of v)
          (r.action === "distribute" ? shares : uses).add(idWords(String(p), name));
      }
  }
  for (const r of terms.policy.prohibitions ?? [])
    for (const c of r.constraints ?? []) {
      const v = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
      for (const p of v) never.add(idWords(String(p), name));
    }
  return [
    uses.size > 0 ? `use for ${[...uses].join(" or ")}` : "",
    shares.size > 0
      ? `share${terms.recipientMustBe ? ` with ${terms.recipientMustBe.label}` : ""} for ${[...shares].join(" or ")}`
      : "",
    deletionDays(terms) ? `delete within ${deletionDays(terms)} days` : "",
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
    readonly name?: Namer;
    readonly agent: Iri;
    readonly action: (typeof PILOT_ODRL_SUBSET.actions)[number];
    readonly target: Iri;
    readonly purpose?: Iri;
    readonly recipient?: Iri;
    readonly retentionDays?: number;
    readonly minimumGroup?: number;
    readonly at: string;
    readonly recipientAllowed?: (task: string) => boolean;
  },
  engine: PolicyEngine = solidOdrlEngine,
): TermsVerdict {
  if (terms && !termsShape.safeParse(terms).success)
    return {
      verdict: "indeterminate",
      reason: "indeterminate-policy",
      text: "The attached terms are not understood.",
    };
  if (terms && unsupportedTerms(terms))
    return {
      verdict: "indeterminate",
      reason: "unsupported-term",
      text: "An attached term, prohibition or duty has no supported rule.",
    };
  if (!terms && OUTSIDE_EFFECT_ACTIONS.includes(need.action))
    return {
      verdict: "fail",
      reason: "purpose-not-permitted",
      text: "Default terms permit this interaction only and prohibit onward sharing.",
    };
  if (!terms)
    return {
      verdict: "pass",
      text: "No terms came with it, so the default applies: use for this interaction only, no onward sharing, delete when it ends.",
    };
  if (
    need.action === "distribute" &&
    terms.minimumGroup !== undefined &&
    (need.minimumGroup === undefined || need.minimumGroup < terms.minimumGroup)
  )
    return {
      verdict: "fail",
      reason: "prohibited",
      text: "The source permits only an aggregate meeting its minimum group size.",
    };
  if (
    need.action === "distribute" &&
    terms.recipientMustBe &&
    !need.recipientAllowed?.(terms.recipientMustBe.task)
  )
    return {
      verdict: "fail",
      reason: "not-authorised",
      text: "The recipient does not satisfy the source's registration requirement.",
    };
  if (terms.inherited) {
    if (
      !Array.isArray(terms.inherited) ||
      terms.inherited.length === 0 ||
      terms.inherited.length > 128
    )
      return { verdict: "fail", reason: "indeterminate-policy", text: "Invalid inherited terms." };
    for (const input of terms.inherited) {
      if (
        !input ||
        typeof input !== "object" ||
        typeof input.target !== "string" ||
        !(input.terms === null || (input.terms && typeof input.terms === "object"))
      )
        return {
          verdict: "fail",
          reason: "indeterminate-policy",
          text: "Invalid inherited terms.",
        };
      const result = evaluateItemTerms(
        input.terms ?? undefined,
        { ...need, target: input.target },
        engine,
      );
      if (result.verdict !== "pass") return result;
    }
  }
  // The rules decide whether this use is allowed; the duties (deletion) are what the receiver
  // takes on, checked below against how long it would keep the data (CORE-IN-10).
  const { obligations: _duties, ...rules } = terms.policy;
  const request = {
    agent: need.agent,
    action: need.action,
    target: need.target,
    ...(need.purpose ? { purpose: need.purpose } : {}),
    ...(need.recipient ? { recipient: need.recipient } : {}),
    at: need.at,
  };
  const v = engine.evaluate(rules, request);
  const summary = termsSummary(terms, need.name);
  if (v.effect === "indeterminate")
    return {
      verdict: "indeterminate",
      reason: "indeterminate-policy",
      text: `Its terms cannot be decided (${summary}).`,
    };
  if (v.effect === "prohibited")
    return { verdict: "fail", reason: "prohibited", text: `Its terms forbid this (${summary}).` };
  if (v.effect !== "permit" && !(terms.inherited && !terms.policy.permissions?.length)) {
    const generalUseOnly =
      OUTSIDE_EFFECT_ACTIONS.includes(need.action) &&
      engine.evaluate(rules, { ...request, action: "use" }).effect === "permit";
    return {
      verdict: "fail",
      reason: generalUseOnly ? "not-authorised" : "purpose-not-permitted",
      text: generalUseOnly
        ? `Its terms permit use but do not name this outside-effect action (${summary}).`
        : `Its terms do not allow this purpose (${summary}).`,
    };
  }
  const keep = deletionDays(terms);
  if (keep !== undefined && (need.retentionDays ?? 0) > keep)
    return {
      verdict: "fail",
      reason: "terms-not-acceptable",
      text: `Its terms say delete within ${keep} days; this needs ${need.retentionDays}.`,
    };
  return { verdict: "pass", text: `Its terms allow this: ${summary}.` };
}

/**
 * The deletion duty of a statement's terms, in days: an ODRL obligation to `delete` with an
 * `elapsedTime` constraint (`P<n>D`) inside the policy, else the older side field.
 */
export function deletionDays(terms: ItemTerms): number | undefined {
  for (const duty of terms.policy.obligations ?? []) {
    if (duty.action !== "delete") continue;
    for (const c of duty.constraints ?? []) {
      const m = c.leftOperand === "elapsedTime" ? /^P(\d+)D$/.exec(String(c.rightOperand)) : null;
      if (m) return Number(m[1]);
    }
  }
  return terms.deleteWithinDays;
}
