// AUTHORED-BY Codex GPT-6.1-Sol
import type { OdrlConstraint, OdrlPolicy, OdrlRule } from "@jeswr/solid-odrl";

/** Agent vocabulary fixed by DESIGN J1. */
export const AGENT = "https://jeswr.org/ns/agent#";
/** ODRL vocabulary. */
export const ODRL = "http://www.w3.org/ns/odrl/2/";
/** Supported accounting operands; accounting itself belongs to agent-executor. */
export const LIMIT_OPERANDS = [
  "spendPerDay",
  "spendPerWeek",
  "perRecipientPerDay",
  "sendsPerDay",
].map((x) => `${AGENT}${x}`);
/** An ODRL constraint, including agent profile operands. */
export interface Constraint extends Omit<OdrlConstraint, "leftOperand"> {
  readonly leftOperand: string;
}
/** An ODRL rule, including agent profile actions. */
export interface Rule extends Omit<OdrlRule, "action" | "constraints"> {
  readonly action: string;
  readonly constraints?: readonly Constraint[];
}
/** A policy set within a mandate. */
export interface Policy extends Omit<OdrlPolicy, "permissions" | "prohibitions"> {
  readonly permissions?: readonly Rule[];
  readonly prohibitions?: readonly Rule[];
}
/** An ODRL limit vocabulary item, interpreted by the executor. */
export interface Limit extends Constraint {
  readonly operator: "lteq";
  readonly rightOperand: number;
  readonly enforcement: "hard" | "soft";
}
/** The verified owner's mandate. */
export interface Mandate {
  readonly id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly autonomous: Policy;
  readonly withApproval: Policy;
  readonly prohibitions: readonly Rule[];
  readonly limits: readonly Limit[];
}
/** A loader must verify provenance before returning any mandate. Undefined means refuse-all. */
export interface MandateVerifier {
  load(): Promise<Mandate | undefined>;
}
/** One action and its trusted executor-supplied evaluation context. */
export interface Intent {
  readonly agent: string;
  readonly action: string;
  readonly target: string;
  readonly at: string;
  readonly attributes?: Readonly<
    Record<string, string | number | boolean | readonly (string | number)[]>
  >;
}
/** Single-policy effect, prior to the mandate composition. */
export type Effect = "permit" | "prohibited" | "not-applicable" | "indeterminate";
/** Evaluators may be asynchronous (e.g. a local binary adapter). */
export interface PolicyEngine {
  readonly id: string;
  evaluate(
    policy: Policy,
    request: Intent,
  ): { readonly effect: Effect } | Promise<{ readonly effect: Effect }>;
}
/** Refuse-all cannot be overridden by an approval. */
export interface Decision {
  readonly decision: "permit" | "confirm-required" | "prohibited" | "refuse-all";
  readonly reason:
    | "mandate-invalid"
    | "mandate-expired"
    | "mandate-not-yet-valid"
    | "wrong-agent"
    | "prohibition"
    | "indeterminate"
    | "autonomous"
    | "owner-approval"
    | "no-matching-rule";
}
