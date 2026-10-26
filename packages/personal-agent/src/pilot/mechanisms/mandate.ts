/**
 * The bounded OWNER MANDATE and the pilot ODRL adapter (framework A4/A5, profile C1 rules).
 *
 * A mandate is an owner-signed statement bounding what ONE software actor may do:
 *  - `autonomous`   — an ODRL policy of actions the actor may take without asking;
 *  - `withApproval` — an ODRL policy of actions it may take only with an owner approval
 *                     bound to the exact action digest;
 *  - a validity window. Anything matching neither policy is denied (no grant = deny).
 *
 * Policy evaluation is delegated to `@jeswr/solid-odrl`'s `evaluate` (the declared ODRL
 * evaluator already in this package). This adapter does NOT add policy semantics; it
 * narrows the accepted input to an explicitly limited PILOT SUBSET and makes the failure
 * modes explicit, as profile C1 requires:
 *  - an action/operand/operator/duty outside the subset → `indeterminate` (never permit);
 *  - a candidate rule constraining an operand the request context lacks → `indeterminate`;
 *  - expired, not-yet-valid or wrongly-issued mandate → `deny` (fail closed).
 * General policy work (duties, conflict strategies, richer operands, audit) belongs in
 * SPARQ; see docs/PILOT-PROFILE.md "SPARQ integration gaps".
 */
import type { OdrlPolicy, OdrlRule } from "@jeswr/solid-odrl";
import { z } from "zod";
import { digestOf, isIri } from "../core/canonical.js";
import type { PilotLimits } from "../core/limits.js";
import { isIsoInstant } from "../core/schema.js";
import type {
  ActionIntent,
  AuthorisationDecision,
  Iri,
  VerificationResult,
} from "../core/types.js";
import type { SigningKey } from "./jws.js";
import {
  type EngineRequest,
  type PolicyEngine,
  SOLID_ODRL_ENGINE_ID,
  solidOdrlEngine,
} from "./policy-engine.js";
import {
  approvalSchema,
  type OwnerApproval,
  signStatement,
  TYP,
  verifyStatement,
} from "./statements.js";
import type { TrustStore } from "./trust.js";

/** Identity of the default policy engine (kept for existing importers). */
export const POLICY_EVALUATOR_ID = SOLID_ODRL_ENGINE_ID;

/** The ODRL subset this pilot profile accepts. Anything else is `indeterminate`. */
export const PILOT_ODRL_SUBSET = {
  actions: ["use", "read", "distribute", "compensate", "transfer"],
  leftOperands: ["dateTime", "purpose", "recipient"],
  operators: ["eq", "neq", "isAnyOf", "isNoneOf", "lt", "lteq", "gt", "gteq"],
  conflict: ["prohibit"],
} as const;

const instant = z.string().max(64).refine(isIsoInstant);
// Identifiers must be valid IRIs (profile 0.1.1): legacy `<iri#frag>#x` ids are rejected, so a
// mandate minted by an earlier pilot version fails to load and the agent must be re-initialised.
const iri = z.string().min(3).max(512).refine(isIri, "not a valid IRI (profile 0.1.1)");
const constraint = z
  .object({
    leftOperand: z.string(),
    operator: z.string(),
    rightOperand: z.union([
      z.string(),
      z.number(),
      z.array(z.union([z.string(), z.number()])).max(64),
    ]),
    datatype: z.string().optional(),
  })
  .strict();
const rule = z
  .object({
    id: iri.optional(),
    type: z.enum(["permission", "prohibition", "obligation"]),
    action: z.string(),
    target: iri.optional(),
    assignee: z.string().optional(),
    assigner: z.string().optional(),
    constraints: z.array(constraint).max(16).optional(),
    duties: z.array(z.unknown()).max(8).optional(),
  })
  .strict();
const policy = z
  .object({
    id: iri,
    type: z.enum(["Set", "Offer", "Agreement"]).optional(),
    profile: z.union([z.string(), z.array(z.string())]).optional(),
    assigner: z.string().optional(),
    assignee: z.string().optional(),
    conflict: z.string().optional(),
    permissions: z.array(rule).max(64).optional(),
    prohibitions: z.array(rule).max(64).optional(),
    obligations: z.array(z.unknown()).max(16).optional(),
  })
  .strict();

export const mandateSchema = z
  .object({
    type: z.literal("OwnerMandate"),
    id: iri,
    version: z.number().int().min(1),
    issuer: iri,
    subject: iri,
    operator: iri.optional(),
    validFrom: instant,
    validUntil: instant,
    autonomous: policy,
    withApproval: policy,
    note: z.string().max(1024).optional(),
  })
  .strict();

export type OwnerMandate = Omit<z.infer<typeof mandateSchema>, "autonomous" | "withApproval"> & {
  readonly autonomous: OdrlPolicy;
  readonly withApproval: OdrlPolicy;
};

export interface LoadedMandate {
  readonly mandate: OwnerMandate;
  readonly digest: string;
  readonly verification: VerificationResult;
}

export function signMandate(ownerKey: SigningKey, mandate: OwnerMandate): Promise<string> {
  return signStatement(ownerKey, TYP.mandate, mandate);
}

/**
 * Verify a mandate JWS against the PINNED owner party key and check it names the
 * expected owner and actor. Fails closed with a reason; never returns a partial mandate.
 */
export async function loadMandate(
  jws: string,
  options: { trust: TrustStore; actor: Iri; limits: PilotLimits; at: string },
): Promise<
  | { ok: true; loaded: LoadedMandate }
  | { ok: false; reason: string; verification: VerificationResult }
> {
  const check = await verifyStatement(jws, {
    trust: options.trust,
    typ: TYP.mandate,
    role: "party",
    schema: mandateSchema,
    limits: options.limits,
    verifier: options.actor,
    at: options.at,
  });
  if (!check.payload || check.verification.outcome !== "valid") {
    return {
      ok: false,
      reason: `mandate not verified (${check.error ?? "invalid"})`,
      verification: check.verification,
    };
  }
  const mandate = check.payload as unknown as OwnerMandate;
  if (
    check.signer?.subject !== options.trust.data.owner ||
    mandate.issuer !== options.trust.data.owner
  ) {
    return {
      ok: false,
      reason: "mandate not issued by the local owner",
      verification: check.verification,
    };
  }
  if (mandate.subject !== options.actor) {
    return {
      ok: false,
      reason: "mandate is for a different actor",
      verification: check.verification,
    };
  }
  return {
    ok: true,
    loaded: { mandate, digest: digestOf(mandate), verification: check.verification },
  };
}

type SubsetIssue = { term: string; where: string };

/** List every term in `p` outside the pilot subset. */
export function subsetIssues(p: OdrlPolicy, label: string): SubsetIssue[] {
  const issues: SubsetIssue[] = [];
  if (p.conflict && !(PILOT_ODRL_SUBSET.conflict as readonly string[]).includes(p.conflict)) {
    issues.push({ term: `conflict=${p.conflict}`, where: label });
  }
  if (p.profile) issues.push({ term: `profile=${String(p.profile)}`, where: label });
  if ((p.obligations ?? []).length > 0) issues.push({ term: "obligation", where: label });
  const rules: OdrlRule[] = [...(p.permissions ?? []), ...(p.prohibitions ?? [])];
  for (const r of rules) {
    const where = `${label}/${r.id ?? r.action}`;
    if (!(PILOT_ODRL_SUBSET.actions as readonly string[]).includes(r.action)) {
      issues.push({ term: `action=${r.action}`, where });
    }
    if ((r.duties ?? []).length > 0) issues.push({ term: "duty", where });
    if (r.type === "permission" && !r.target) issues.push({ term: "untargeted permission", where });
    for (const c of r.constraints ?? []) {
      if (!(PILOT_ODRL_SUBSET.leftOperands as readonly string[]).includes(c.leftOperand)) {
        issues.push({ term: `leftOperand=${c.leftOperand}`, where });
      }
      if (!(PILOT_ODRL_SUBSET.operators as readonly string[]).includes(c.operator)) {
        issues.push({ term: `operator=${c.operator}`, where });
      }
    }
  }
  return issues;
}

function engineRequest(intent: ActionIntent, agent: Iri, at: string): EngineRequest {
  return {
    agent,
    action: intent.action,
    target: intent.target,
    ...(intent.purpose ? { purpose: intent.purpose } : {}),
    ...(intent.recipient ? { recipient: intent.recipient } : {}),
    at,
  };
}

export function actionDigest(intent: ActionIntent): string {
  return digestOf(intent);
}

export interface EvaluateInput {
  readonly loaded: LoadedMandate | undefined;
  readonly loadFailure?: string;
  readonly intent: ActionIntent;
  readonly decider: Iri;
  readonly at: string;
  /** Verified, unexpired owner approvals keyed by action digest. */
  readonly approvals?: ReadonlyMap<string, { id: Iri; decision: "approve" | "deny" }>;
  /** The declared policy module (default: `@jeswr/solid-odrl`). Never falls back. */
  readonly engine?: PolicyEngine;
}

/**
 * Evaluate one action intent against the owner mandate. Deterministic given `at` (and a
 * deterministic engine). The mandate layering — validity, the pilot subset, autonomous vs
 * with-approval policies and owner approvals — is decided here; each policy is decided by
 * the selected engine.
 */
export function evaluateIntent(input: EvaluateInput): AuthorisationDecision {
  const engine = input.engine ?? solidOdrlEngine;
  const digest = actionDigest(input.intent);
  let policyRef = {
    id: input.loaded?.mandate.id ?? "urn:awp:mandate:none",
    digest: input.loaded?.digest ?? "none",
    evaluator: engine.id,
  };
  const base = {
    type: "authorisation-decision" as const,
    decider: input.decider,
    actionDigest: digest,
    action: input.intent,
    policy: policyRef,
    at: input.at,
  };
  if (!input.loaded) {
    return {
      ...base,
      outcome: "deny",
      reason: `mandate-invalid: ${input.loadFailure ?? "absent"}`,
    };
  }
  const m = input.loaded.mandate;
  const now = Date.parse(input.at);
  if (now < Date.parse(m.validFrom)) {
    return { ...base, outcome: "deny", reason: "mandate-invalid: not yet valid" };
  }
  if (now >= Date.parse(m.validUntil)) {
    return { ...base, outcome: "deny", reason: "mandate-invalid: expired" };
  }
  const issues = [
    ...subsetIssues(m.autonomous, "autonomous"),
    ...subsetIssues(m.withApproval, "withApproval"),
  ];
  if (issues.length > 0) {
    return {
      ...base,
      outcome: "indeterminate",
      reason: `unsupported-term: ${issues.map((i) => `${i.term} @${i.where}`).join("; ")}`,
    };
  }
  if (!(PILOT_ODRL_SUBSET.actions as readonly string[]).includes(input.intent.action)) {
    return {
      ...base,
      outcome: "indeterminate",
      reason: `unsupported-term: action ${input.intent.action}`,
    };
  }
  const request = engineRequest(input.intent, m.subject, input.at);
  const auto = engine.evaluate(m.autonomous, request);
  const withApproval = engine.evaluate(m.withApproval, request);
  const evaluator = auto.evaluator ?? withApproval.evaluator;
  if (evaluator) {
    policyRef = { ...policyRef, evaluator };
    base.policy = policyRef;
  }
  // Undecidable in either policy → indeterminate (never permit, never ask for approval).
  if (auto.effect === "indeterminate" || withApproval.effect === "indeterminate") {
    const reasons = [auto, withApproval].filter((v) => v.effect === "indeterminate");
    return { ...base, outcome: "indeterminate", reason: reasons.map((v) => v.reason).join("; ") };
  }
  if (auto.effect === "prohibited") {
    return { ...base, outcome: "deny", reason: `prohibited (autonomous policy): ${auto.reason}` };
  }
  if (withApproval.effect === "prohibited") {
    return {
      ...base,
      outcome: "deny",
      reason: `prohibited (with-approval policy): ${withApproval.reason}`,
    };
  }
  if (auto.effect === "permit") {
    return {
      ...base,
      outcome: "permit",
      basis: "autonomous",
      ...(auto.matchedRule ? { matchedRule: auto.matchedRule } : {}),
      reason: auto.reason,
    };
  }
  if (withApproval.effect === "permit") {
    const approval = input.approvals?.get(digest);
    const matchedRule = withApproval.matchedRule;
    if (approval?.decision === "approve") {
      return {
        ...base,
        outcome: "permit",
        basis: "owner-approval",
        approval: approval.id,
        ...(matchedRule ? { matchedRule } : {}),
        reason: "permitted with owner approval bound to this action digest",
      };
    }
    if (approval?.decision === "deny") {
      return {
        ...base,
        outcome: "deny",
        approval: approval.id,
        reason: "approval-denied by owner",
      };
    }
    return {
      ...base,
      outcome: "approval-required",
      ...(matchedRule ? { matchedRule } : {}),
      reason: "action is within the with-approval policy; no approval for this exact action",
    };
  }
  return {
    ...base,
    outcome: "deny",
    reason: "no applicable grant in the mandate (deny by default)",
  };
}

export interface GrantRequest {
  /** The assignee identity the grant is matched against (e.g. the recipient organisation). */
  readonly assignee: Iri;
  readonly action: string;
  readonly target: Iri;
  readonly purpose?: Iri;
  readonly recipient?: Iri;
}

/**
 * Evaluate a data-use grant (an ODRL policy derived from agreed terms) for one concrete
 * request, with the same pilot-subset rules as mandates: unsupported terms or missing
 * context → `indeterminate`; prohibition → `deny`; no matching permission → `deny`.
 */
export function evaluateGrantPolicy(
  policy: OdrlPolicy,
  request: GrantRequest,
  at: string,
  engine: PolicyEngine = solidOdrlEngine,
): {
  outcome: "permit" | "deny" | "indeterminate";
  reason: string;
  matchedRule?: string;
  evaluator: string;
} {
  const issues = subsetIssues(policy, "grant");
  if (issues.length > 0) {
    return {
      outcome: "indeterminate",
      reason: `unsupported-term: ${issues.map((i) => i.term).join("; ")}`,
      evaluator: engine.id,
    };
  }
  const v = engine.evaluate(policy, {
    agent: request.assignee,
    action: request.action,
    target: request.target,
    ...(request.purpose ? { purpose: request.purpose } : {}),
    ...(request.recipient ? { recipient: request.recipient } : {}),
    at,
  });
  const evaluator = v.evaluator ?? engine.id;
  switch (v.effect) {
    case "permit":
      return {
        outcome: "permit",
        reason: v.reason,
        evaluator,
        ...(v.matchedRule ? { matchedRule: v.matchedRule } : {}),
      };
    case "prohibited":
      return { outcome: "deny", reason: v.reason, evaluator };
    case "not-applicable":
      return { outcome: "deny", reason: "no applicable permission in the grant", evaluator };
    case "indeterminate":
      return { outcome: "indeterminate", reason: v.reason, evaluator };
  }
}

/** Sign an owner approval for one exact action digest. */
export function signApproval(ownerKey: SigningKey, approval: OwnerApproval): Promise<string> {
  return signStatement(ownerKey, TYP.approval, approval);
}

/** Verify an owner approval against the pinned owner key and the expected actor. */
export async function verifyApproval(
  jws: string,
  options: { trust: TrustStore; actor: Iri; limits: PilotLimits; at: string },
): Promise<
  | { ok: true; approval: OwnerApproval; verification: VerificationResult }
  | { ok: false; reason: string; verification: VerificationResult }
> {
  const check = await verifyStatement(jws, {
    trust: options.trust,
    typ: TYP.approval,
    role: "party",
    schema: approvalSchema,
    limits: options.limits,
    verifier: options.actor,
    at: options.at,
  });
  if (!check.payload || check.verification.outcome !== "valid") {
    return { ok: false, reason: check.error ?? "invalid", verification: check.verification };
  }
  const a = check.payload;
  if (check.signer?.subject !== options.trust.data.owner || a.issuer !== options.trust.data.owner) {
    return {
      ok: false,
      reason: "approval not issued by the local owner",
      verification: check.verification,
    };
  }
  if (a.actor !== options.actor) {
    return {
      ok: false,
      reason: "approval is for a different actor",
      verification: check.verification,
    };
  }
  if (Date.parse(a.validUntil) <= Date.parse(options.at)) {
    return { ok: false, reason: "approval expired", verification: check.verification };
  }
  return { ok: true, approval: a, verification: check.verification };
}
