// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The AUTONOMY MANDATE — the owner's explicit, SIGNED statement of how much the agent
 * may do on its own (maintainer directive, NOW-PERSONAL-AGENT.md §5/§7). It is an ODRL
 * policy (`@jeswr/solid-odrl`) wrapped in a signed `AgentAuthorizationCredential`
 * (`@jeswr/solid-vc`): the owner (assigner) authorizes the agent (assignee) to perform
 * enumerated action classes under constraints; everything else is prohibited or carries
 * a duty of owner-confirmation. The credential-holding OUTBOX EXECUTOR (no LLM) is the
 * ENFORCEMENT POINT — it evaluates every outbound intent against the mandate deny-by-
 * default before acting. The LLM-side Actor may pre-evaluate for UX, but it can never
 * bypass this: it holds no send tokens and cannot write its own mandate.
 *
 * The mandate is loaded READ-ONLY. If it cannot be loaded + signature-verified, the
 * executor REFUSES ALL ACTIONS (fail-closed) — the OpenClaw failure mode (untrusted
 * content → config/policy hijack → credentialed action) is unrepresentable here.
 */
import type { ActiveDuty, DecisionRule, OdrlPolicy } from "@jeswr/solid-odrl";

/** A loaded, signature-verified mandate: the ODRL policy + its verified issuer. */
export interface LoadedMandate {
  /** The autonomy-envelope ODRL policy (parsed from the signed, content-bound graph). */
  readonly policy: OdrlPolicy;
  /** The verified issuer — MUST be the pod owner (the mandate is the owner's statement). */
  readonly issuer: string;
  /** The mandate credential IRI (for the PROV `agentic:underMandate` back-reference). */
  readonly credentialId?: string;
}

/**
 * Load + verify the signed autonomy mandate from the pod. Returns `undefined` when the
 * mandate is absent, unverifiable, tampered, or not issued by the owner — the executor
 * treats `undefined` as REFUSE-ALL (fail-closed). Injectable so the executor is testable
 * without crypto; the concrete `@jeswr/solid-vc` adapter is the credential seam.
 */
export interface MandateVerifier {
  load(): Promise<LoadedMandate | undefined>;
}

/**
 * The executor's autonomy decision for one outbound intent, derived from the ODRL
 * evaluation:
 *  - `permit` — the owner PRE-AUTHORIZED this action class (a matching permit with no
 *    outstanding duty): the agent may send autonomously, no per-action human confirm.
 *  - `confirm-required` — no matching permit (deny-by-default), OR a permit contingent
 *    on an unfulfilled duty of owner-confirmation: send ONLY on an explicit human confirm.
 *  - `prohibited` — an explicit ODRL prohibition matched: NEVER sent, even if confirmed.
 */
export type AutonomyDecision = "permit" | "confirm-required" | "prohibited";

/** The explainable result of evaluating one intent against the mandate. */
export interface AutonomyEvaluation {
  readonly decision: AutonomyDecision;
  /** Why — which rule / conflict / "no matching permit" drove it (for the audit trail). */
  readonly reason: string;
  /** The permit rule that authorized an autonomous action (present only on `permit`). */
  readonly permit?: DecisionRule;
  /** Duties the owner must discharge (confirm) before a `confirm-required` intent runs. */
  readonly outstandingDuties: readonly ActiveDuty[];
}
