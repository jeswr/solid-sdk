// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * What both gates share: the verdict record every check returns, the context a runtime hands
 * its gates (trace sink, configuration, names, resolver, the principal's limits), and rule
 * text generated from the policy that produced a verdict.
 */
import type { OdrlRule } from "@jeswr/solid-odrl";
import type { Iri } from "../core/types.js";
import { vocabularyLabel } from "../model/labels.js";
import { type ContentVocabulary, identifiersIn } from "../profile/content.js";
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
  readonly commitments?: Readonly<
    Record<Iri, { readonly maxAmount: number; readonly currency: string }>
  >;
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
  P1: "terms-acceptable",
  P2: "terms-acceptable",
  P3: "recipient-established",
  P4: "source-accepted",
  P5: "within-mandate",
  P6: "within-limits",
  P7: "evidence-complete",
  P8: "within-limits",
  receipt: "evidence-complete",
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
  readonly precedence?: {
    readonly sources: readonly string[];
    readonly freshness: "source-first" | "newer-first";
  };
  /** Plain words for the rule, shown with the verdict. */
  readonly text: string;
  readonly corroboration?: { readonly sources: number; readonly independent: boolean };
  /** An independently admitted, same-subject/period completeness claim required in this batch. */
  readonly completeness?: string;
}

export interface RelianceProfile {
  readonly id: string;
  readonly rules: readonly RelianceRule[];
}

/** Terms an issuer attaches to a statement: ODRL (pilot subset) plus a deletion duty. */
export interface ItemTerms {
  readonly minimumGroup?: number;
  readonly inherited?: readonly { readonly target: string; readonly terms: ItemTerms | null }[];
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
  /** The unmodified source statement and its proof, beside a locally mapped fact. */
  readonly original?: {
    readonly id: string;
    readonly digest: string;
    readonly statement: import("../core/types.js").JsonObject;
    readonly evidence: import("../core/types.js").EvidenceItem;
  };
  readonly supersededBy?: string;
  readonly disputedWith?: readonly string[];
  readonly id: string;
  readonly label: string;
  readonly claimType: string;
  readonly source: string;
  readonly digest?: string;
  readonly subject?: string;
  readonly method?: string;
  readonly asOf?: string;
  readonly terms?: ItemTerms;
  readonly identifiers?: readonly string[];
  readonly admittedPurpose?: string;
  readonly statement?: import("../core/types.js").JsonObject;
}

/** A request for replacement evidence, built only from the receiver's profile. */
export function claimRequest(
  ctx: GateContext,
  claimType: string,
  sources = ctx.claimSources?.[claimType],
): string {
  const rule = ctx.reliance?.rules.find((r) =>
    r.claimType.endsWith(".*")
      ? claimType.startsWith(r.claimType.slice(0, -1))
      : r.claimType === claimType,
  );
  return `Required claim: ${claimType}. Accepted sources: ${(sources ?? []).join(", ") || "a source accepted by the trust profile"}. Accepted methods: ${rule?.methods.join(", ") || "a method accepted by the reliance profile"}.`;
}

export const CURABLE_CLAIM_FAILURES = new Set([
  "source-unknown",
  "source-not-authoritative",
  "method-not-accepted",
  "stale-data",
  "confidence-too-low",
  "completeness-not-established",
  "superseded-by-better-source",
  "representation-out-of-scope",
]);

/** Every item actually shown to the core, with labels retained across restarts. */
export interface ContextItem extends AdmittedFact {
  readonly kind: "statement" | "memory" | "message" | "reading" | "content";
  readonly accepted?: boolean;
  readonly digest: string;
}

/** Gate-held evidence for a person to inspect; never a fact or a core context item. */
export interface RelianceHold {
  readonly task: string;
  readonly statement: import("../core/types.js").JsonObject;
  readonly digest: string;
  readonly reason: string;
}

export class GateMemory {
  readonly facts = new Map<string, AdmittedFact>();
  constructor(
    readonly contexts: Record<string, ContextItem[]> = {},
    readonly identifiers: Record<string, string[]> = {},
    readonly refusals: Record<string, string> = {},
    readonly relianceHolds: Record<string, RelianceHold> = {},
    readonly relianceBindings: Record<string, string> = {},
    readonly precedenceHolds: Record<string, AdmittedFact> = {},
  ) {}
  rememberIdentifiers(scope: string, value: unknown): void {
    this.identifiers[scope] = [
      ...new Set([...(this.identifiers[scope] ?? []), ...identifiersIn(value)]),
    ];
  }
  knownIdentifiers(task: string, conversation: string, profile: unknown): Set<string> {
    return new Set([
      ...(this.identifiers["*"] ?? []),
      ...(this.identifiers[task] ?? []),
      ...(this.identifiers[conversation] ?? []),
      ...identifiersIn(profile),
      ...this.context(task).flatMap((item) => identifiersIn(item)),
    ]);
  }
  context(task: string): readonly ContextItem[] {
    return [...(this.contexts["*"] ?? []), ...(this.contexts[task] ?? [])];
  }
  enter(task: string, item: ContextItem): void {
    this.contexts[task] ??= [];
    const items = this.contexts[task];
    const index = items.findIndex((prior) => prior.id === item.id && prior.digest === item.digest);
    if (index < 0) items.push(item);
    else if (item.accepted === true) items[index] = item;
  }
}

export interface GateContext {
  readonly negotiatedMeaning?: {
    readonly operation: string;
    readonly term: string;
    readonly approved: (
      exchange: string,
      principal: string | undefined,
      peer: string | undefined,
      at: string,
    ) => boolean;
  };
  readonly qualityCertificate?: {
    readonly policy: import("../suites/reliance-certificate.js").QualityCertificatePolicy;
    readonly reference: string;
    readonly resolver: import("../mechanisms/organizations.js").DocumentResolver;
  };
  readonly statedConfidence?: import("../suites/reliance-confidence.js").StatedConfidenceSettings;
  readonly incomeCorroboration?: import("../suites/reliance-corroboration.js").CorroborationSettings;
  readonly registryMeaning?: {
    readonly settings: import("../suites/meaning-registry.js").RegistryMeaning;
    readonly resolver: import("../mechanisms/organizations.js").DocumentResolver;
  };
  readonly webId?: {
    readonly resolve: (jws: string) => Promise<
      | { readonly ok: true; readonly key: import("../mechanisms/trust.js").PinnedKey }
      | {
          readonly ok: false;
          readonly reason: "sender-key-mismatch" | "lookup-failed" | "unknown-key" | "expired";
        }
      | undefined
    >;
    readonly recipient: (
      actor: string | undefined,
      configuration: string,
    ) => Promise<string | undefined>;
  };
  /** Host-installed independent record store. Only the evidence gate decides release. */
  readonly recordMirror?: {
    readonly flush: () => Promise<boolean>;
    readonly recover?: () => Promise<void>;
  };
  readonly proofCache?: import("../derive/cache.js").ProofCache;
  readonly generateProofs?: boolean;
  readonly proofCredentials?: readonly {
    credential: import("../core/types.js").JsonObject;
    statement: string;
    digest: string;
  }[];
  readonly proofSystems?: ReadonlyMap<string, import("../derive/verifiers.js").ProofSystem>;
  readonly jointProtocols?: ReadonlyMap<string, import("../derive/verifiers.js").JointProtocol>;
  readonly acceptedProofs?: readonly {
    rule: string;
    method: string;
    assurance: "proved" | "attested";
    binds: readonly import("../derive/verifiers.js").ProofBinds[];
    purposes: readonly string[];
  }[];
  readonly acceptedJoint?: readonly {
    rule: string;
    method: string;
    minimumContributors: number;
    purposes: readonly string[];
  }[];
  readonly proofIssuerKeys?: readonly {
    issuer: string;
    key: import("../core/types.js").JsonObject;
    claimTypes: readonly string[];
  }[];
  readonly proofStatusPolicy?: import("../core/types.js").JsonObject;
  readonly proofDatasets?: readonly {
    format: "engine-credential-digests/1";
    rule: string;
    credentialDigests: readonly string[];
    commitment: string;
  }[];
  /** Runtime-owned durable requests, never populated from received evidence. */
  readonly derivedRequests?: Record<string, import("../derive/verifiers.js").DerivedRequest>;
  readonly fixedJointSessions?: Record<string, import("../derive/verifiers.js").FixedJointSession>;
  readonly saveDerivationState?: () => void;
  readonly attestedDerivers?: readonly {
    readonly deriver: string;
    readonly rule: string;
    readonly purposes: readonly string[];
  }[];
  readonly codeMappings?: {
    readonly policy: import("../mechanisms/code-mapping.js").MappingPolicy;
    readonly resolver: import("../mechanisms/organizations.js").DocumentResolver;
  };
  readonly email?: {
    readonly pins: readonly string[];
    readonly from: string;
    readonly structuredReply: string;
  };
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
  readonly claimSources?: Readonly<Record<string, readonly Iri[]>>;
  /** Shared across conversations only when the hosting application declares one task. */
  readonly taskId?: Iri;
  readonly vocabulary?: ContentVocabulary;
  readonly identifiers?: readonly string[];
  /** The claims necessary for each declared purpose. Unknown purposes never pass. */
  readonly purposes?: Readonly<Record<Iri, readonly string[]>>;
  readonly freeTextApproval?: boolean;
  readonly sourceAliases?: Readonly<Record<string, string>>;
  readonly rules?: readonly import("../derive/rules.js").DerivationRule[];
  readonly personDecisions?: readonly {
    readonly action: string;
    readonly decider: "principal" | { readonly role: string };
  }[];
  readonly requester?: string;
  readonly singleUse?: {
    readonly actions: readonly {
      action: string;
      register: string;
      item: string;
      operation: "redeem" | "release";
      maxAgeSeconds: number;
      parameters?: import("../core/types.js").JsonObject;
    }[];
    readonly registers: Readonly<
      Record<string, import("../mechanisms/single-use.js").SingleUseRegister>
    >;
    readonly evidence: readonly string[];
    readonly acceptances: readonly string[];
  };
  readonly agreementDeadlineSeconds?: number;
  readonly referenceAction?: string;
  readonly authorityChains?: {
    readonly policy: import("../mechanisms/authority-chain.js").ChainPolicy;
    readonly resolver: import("../mechanisms/organizations.js").DocumentResolver;
  };
  readonly organizations?: {
    readonly policy: import("../mechanisms/organizations.js").OrganizationPolicy;
    readonly resolver: import("../mechanisms/organizations.js").DocumentResolver;
  };
  readonly notificationRecipients?: Readonly<
    Record<string, { readonly actor: string; readonly party: string }>
  >;
  readonly readings?: readonly {
    readonly claimType: string;
    readonly type: "code" | "number" | "date" | "term";
    readonly values?: readonly (string | number | boolean)[];
  }[];
  readonly personMayRelyOn?: readonly string[];
  readonly termsAcceptance?: { readonly purposes: readonly string[] };
  /** Action names declare outbound requirements; operation IRIs declare inbound requirements. */
  readonly actionClaims?: readonly {
    readonly action: string;
    readonly claims: readonly string[];
  }[];
  readonly trust?: { readonly levels: readonly ["own-list"]; readonly onUnknown: "ask-principal" };
  readonly pins?: readonly {
    readonly kid: string;
    readonly party: string;
    readonly purpose: string;
    readonly expiresAt: string;
  }[];
  readonly assessments?: readonly {
    readonly id: string;
    readonly rule: string;
    readonly purpose: string;
    readonly keep: readonly "output"[];
    readonly discardInputsAfter: "evaluation";
  }[];
  /** What the agent tells its principal when a claim is admitted, if anything. */
  readonly tellPrincipal?: (statement: Readonly<Record<string, unknown>>) => string | undefined;
}

/** The core clause each check applies (01-core). */
export const CHECK_CLAUSE: Readonly<Record<Check, string>> = {
  P1: "CM-10",
  P2: "CM-11",
  P3: "CM-11",
  P4: "CM-11",
  P5: "CM-12",
  P6: "CM-12",
  P7: "CM-13",
  P8: "CM-14",
  receipt: "CM-15",
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
  P1: ["commitments"],
  P2: ["commitments", "settlement"],
  P3: ["commitments", "settlement"],
  P4: ["trust", "settlement"],
  P5: ["authority"],
  P6: ["authority", "commitments"],
  P7: ["commitments", "settlement"],
  P8: ["settlement"],
  receipt: ["settlement", "accountability"],
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
  return iri === undefined ? "(none)" : (vocabularyLabel(iri) ?? "the unlabelled resource");
}

export function resolutionView(r: Resolution): NonNullable<TraceEventInput["resolution"]> {
  return { question: r.question, path: r.path.map((p) => ({ ...p })), answer: r.answer };
}

const short = (iri: string) => iri.split(/[#/]/).filter(Boolean).pop() ?? iri;

function words(id: string, name?: Namer): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(id))
    return vocabularyLabel(id) ?? name?.(id) ?? "the unlabelled resource";
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
    if (c.leftOperand === "purpose")
      purposes.push(...values.map((v) => words(String(v), opts.name)));
    if (c.leftOperand === "recipient") recipients.push(...values.map((v) => opts.name(String(v))));
  }
  const verb = rule.type === "prohibition" ? "never lets the agent" : "lets the agent";
  return [
    `${opts.owner}'s mandate ${verb} ${rule.action} ${words(rule.target ?? "anything", opts.name)}`,
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
