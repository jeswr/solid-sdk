// AUTHORED-BY Claude Opus 5.5
/**
 * What both gates share: the verdict record every check returns, the context a runtime hands
 * its gates (trace sink, configuration, names, resolver, the principal's limits), and rule
 * text generated from the policy that produced a verdict.
 */
import type { OdrlRule } from "@jeswr/solid-odrl";
import type { Iri } from "../core/types.js";
import type { Configuration, LayerId } from "../suites/registry.js";
import type { Namer } from "../trace/packet.js";
import type { TraceSink } from "../trace/recorder.js";
import type { Check, TraceEventInput, TraceRef, Verdict } from "../trace/types.js";
import type { Resolution, TrustResolver } from "../trust/resolver.js";

/** The record each check returns. No check's verdict can make up for another's. */
export interface CheckVerdict {
  readonly type: "check-verdict";
  readonly gate: "inbound" | "outbound";
  readonly check: Check;
  readonly verdict: Verdict;
  readonly reason?: string;
  readonly rule?: { readonly id: string; readonly text: string };
  /** The message id or action digest the check was about. */
  readonly subject: string;
  readonly at: string;
}

/** Limits the principal set on top of the mandate. Exceeding one asks the principal. */
export interface PrincipalLimits {
  readonly id: Iri;
  /** Longest retention the principal accepts without being asked. */
  readonly maxRetentionDays?: number;
}

/** Gate codes for `not-applicable` verdicts (the pilot's reason codes cover the rest). */
export const NOT_APPLICABLE = {
  notInConfiguration: "not-in-configuration",
  noClaims: "no-claims",
  noAction: "no-action-intent",
  conversationBound: "conversation-bound",
  notYetAgreed: "not-yet-agreed",
  noRegister: "no-register-for-party",
  noPersonalData: "no-personal-data",
} as const;

export interface GateContext {
  readonly sink?: TraceSink;
  readonly configuration?: Configuration;
  readonly name?: Namer;
  readonly resolver?: TrustResolver;
  readonly principalLimits?: PrincipalLimits;
  /** Display label for an operation id ("a mortgage application"). */
  readonly taskLabel?: (operation: Iri) => string;
}

/** The layers each check reads, for trace references into the configuration. */
export const CHECK_LAYERS: Readonly<Record<Check, readonly LayerId[]>> = {
  integrity: ["authenticity", "identity"],
  source: ["trust", "authenticity"],
  authority: ["authority"],
  terms: ["usage-control", "commitments"],
  fitness: ["reliance"],
  mandate: ["authority", "usage-control"],
  recipient: ["trust", "identity"],
  disclosure: ["data-access"],
  "data-terms": ["usage-control"],
  "limits-approval": ["authority"],
  evidence: ["authenticity", "accountability"],
};

export function refsFor(
  ctx: GateContext,
  layers: readonly LayerId[],
): { refs?: readonly TraceRef[] } {
  const c = ctx.configuration;
  return c ? { refs: layers.map((layer) => ({ layer, suite: c.layers[layer] })) } : {};
}

export function defaultName(iri: string | undefined): string {
  return iri ?? "(none)";
}

export function resolutionView(r: Resolution): NonNullable<TraceEventInput["resolution"]> {
  return { question: r.question, path: r.path.map((p) => ({ ...p })), answer: r.answer };
}

const short = (iri: string) => iri.split(/[#/]/).filter(Boolean).pop() ?? iri;

function words(id: string): string {
  return short(id)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
}

/** Plain-English text for one ODRL rule of a mandate. */
export function ruleText(
  rule: OdrlRule,
  opts: { owner: string; name: Namer; withApproval: boolean },
): string {
  const purposes: string[] = [];
  const recipients: string[] = [];
  for (const c of rule.constraints ?? []) {
    const values = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
    if (c.leftOperand === "purpose") purposes.push(...values.map((v) => words(String(v))));
    if (c.leftOperand === "recipient") recipients.push(...values.map((v) => opts.name(String(v))));
  }
  const verb = rule.type === "prohibition" ? "never lets the agent" : "lets the agent";
  return [
    `${opts.owner}'s mandate ${verb} ${rule.action} ${words(rule.target ?? "anything")}`,
    purposes.length > 0 ? ` for ${purposes.join(" or ")}` : "",
    recipients.length > 0 ? ` with ${recipients.join(" or ")}` : "",
    rule.type === "prohibition"
      ? ""
      : opts.withApproval
        ? `, after ${opts.owner} approves`
        : `, on its own`,
    ".",
  ].join("");
}

export { words as idWords };
