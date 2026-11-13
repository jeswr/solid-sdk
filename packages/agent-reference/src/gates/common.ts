// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * What both gates share: the verdict record every check returns, the context a runtime hands
 * its gates (trace sink, configuration, names, resolver, the principal's limits), and rule
 * text generated from the policy that produced a verdict.
 */
import type { OdrlRule } from "@jeswr/solid-odrl";
import { digestOf } from "../core/canonical.js";
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

/** The closed list of reasons a `not-applicable` verdict may carry (core section 9). */
export const NOT_APPLICABLE = {
  noAction: "no-action",
  noClaims: "no-claims",
  noPrincipal: "no-principal",
  noData: "no-data",
  noPersonalData: "no-personal-data",
} as const;

/** The code a passing check carries when it gives none of its own (registry Pass group). */
export const PASS_CODE: Readonly<Record<Check, string>> = {
  integrity: "intact",
  source: "source-accepted",
  authority: "authority-valid",
  terms: "terms-acceptable",
  fitness: "fit-for-use",
  mandate: "within-mandate",
  recipient: "recipient-established",
  disclosure: "minimal-disclosure",
  "data-terms": "terms-allow",
  "limits-approval": "within-limits",
  evidence: "evidence-complete",
};

/** Precedence and freshness rules for one kind of claim (reliance suite). */
export interface RelianceRule {
  readonly id: string;
  /** Claim type, or a prefix ending in `.*`. */
  readonly claimType: string;
  readonly methods: readonly string[];
  readonly maxAgeDays: number;
  /** Plain words for the rule, shown with the verdict. */
  readonly text: string;
}

export interface RelianceProfile {
  readonly id: string;
  readonly rules: readonly RelianceRule[];
  readonly readingSteps?: readonly string[];
}

/** Terms an issuer attaches to a statement: ODRL (pilot subset) plus a deletion duty. */
export interface ItemTerms {
  readonly policy: import("@jeswr/solid-odrl").OdrlPolicy;
  /**
   * Superseded by an ODRL obligation in `policy` (`delete` with an `elapsedTime` constraint);
   * read only when the policy carries no such duty.
   */
  readonly deleteWithinDays?: number;
  /** Recipients must be registered for this kind of business (checked through the resolver). */
  readonly recipientMustBe?: { readonly task: string; readonly label: string };
}

/** A fact the inbound gate admitted, with its labels (shared with the outbound gate). */
export interface AdmittedFact {
  readonly id: string;
  readonly label: string;
  readonly claimType: string;
  readonly source: string;
  readonly statementDigest?: string;
  readonly subject?: string;
  readonly method?: string;
  readonly asOf?: string;
  readonly terms?: ItemTerms;
}

/** What the two gates of one agent share: the labels of admitted facts. */
export interface ContextItem extends AdmittedFact {
  readonly kind: "statement" | "memory" | "message" | "reading";
  readonly subject: string;
  readonly digest: string;
  /** The interaction purpose where default, non-transferable terms were admitted. */
  readonly purpose?: string;
}

export class GateMemory {
  readonly facts = new Map<string, AdmittedFact>();
  private readonly contexts = new Map<string, Map<string, ContextItem>>();
  constructor(private readonly changed?: () => void) {}
  beginTask(task: string): void {
    if (!this.contexts.has(task)) this.contexts.set(task, new Map());
  }
  enter(task: string, item: ContextItem): void {
    this.beginTask(task);
    // A changed version never erases an item the core already saw.
    this.contexts.get(task)?.set(`${item.id}:${item.digest}`, structuredClone(item));
    this.changed?.();
  }
  context(task: string): readonly ContextItem[] | undefined {
    const items = this.contexts.get(task);
    return items ? structuredClone([...items.values()]) : undefined;
  }
  contextDigest(task: string): string {
    return digestOf(this.context(task) ?? null);
  }
  snapshot(): Record<string, ContextItem[]> {
    return Object.fromEntries(
      [...this.contexts].map(([id, items]) => [id, structuredClone([...items.values()])]),
    );
  }
}

export interface GateContext {
  readonly sink?: TraceSink;
  readonly configuration?: Configuration;
  /**
   * Configurations for exchanges not under the main one, by pilot configuration id: lookups
   * against public services use the public read configuration (model configurationNote).
   */
  readonly configurations?: Readonly<Record<string, Configuration>>;
  /** Set by the runtime: the pilot configuration of the exchange being checked now. */
  readonly carriage?: () => string | undefined;
  readonly name?: Namer;
  readonly resolver?: TrustResolver;
  readonly principalLimits?: PrincipalLimits;
  /** Display label for an operation id ("a mortgage application"). */
  readonly taskLabel?: (operation: Iri) => string;
  /** Plain name for a statement ("Harbour Bank's balance at 31 October 2026"). */
  readonly claimLabel?: (statement: Readonly<Record<string, unknown>>) => string;
  readonly reliance?: RelianceProfile;
  /** Claim kinds that a purpose needs; used for the conservative free-text context rule. */
  readonly purposeClaims?: Readonly<Record<string, readonly string[]>>;
  readonly personDecisions?: readonly string[];
  /** What the agent tells its principal when a claim is admitted, if anything. */
  readonly tellPrincipal?: (statement: Readonly<Record<string, unknown>>) => string | undefined;
}

/** The core clause each check applies (01-core). */
export const CHECK_CLAUSE: Readonly<Record<Check, string>> = {
  integrity: "CORE-IN-1",
  source: "CORE-IN-4",
  authority: "CORE-IN-7",
  terms: "CORE-IN-10",
  fitness: "CORE-IN-13",
  mandate: "CORE-OUT-2",
  recipient: "CORE-OUT-3",
  disclosure: "CORE-OUT-4",
  "data-terms": "CORE-OUT-5",
  "limits-approval": "CORE-OUT-7",
  evidence: "CORE-OUT-9",
};

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
  clause?: string,
): { refs?: readonly TraceRef[] } {
  const c = (ctx.carriage && ctx.configurations?.[ctx.carriage() ?? ""]) || ctx.configuration;
  return c
    ? {
        refs: layers.map((layer) => ({
          layer,
          suite: c.layers[layer],
          ...(clause ? { clause } : {}),
        })),
      }
    : {};
}

/** Refs for a check event, with the core clause the check applies. */
export function checkRefs(ctx: GateContext, check: Check): { refs?: readonly TraceRef[] } {
  return refsFor(ctx, CHECK_LAYERS[check], CHECK_CLAUSE[check]);
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
