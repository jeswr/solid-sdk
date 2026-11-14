// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
/**
 * Trace format `agent-trace/0.1`: the ordered events an agent emits as work crosses each part
 * of the architecture. The gates and the runtime emit these events themselves; a scenario
 * driver never writes agent events. Ids follow the explorer model (model.json 0.2).
 */
import type { LayerId, SuiteId } from "../suites/registry.js";

export const TRACE_SCHEMA = "agent-trace/0.1" as const;

export type Part =
  | "principal"
  | "transport"
  | "inbound-gate"
  | "core"
  | "memory"
  | "outbound-gate"
  | "record";

export const INBOUND_CHECKS = ["integrity", "source", "authority", "terms", "fitness"] as const;
export const OUTBOUND_CHECKS = [
  "mandate",
  "recipient",
  "disclosure",
  "data-terms",
  "limits-approval",
  "evidence",
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "receipt",
] as const;
export type InboundCheck = (typeof INBOUND_CHECKS)[number];
export type OutboundCheck = (typeof OUTBOUND_CHECKS)[number];
export type Check = InboundCheck | OutboundCheck;

export type Verdict =
  | "pass"
  | "fail"
  | "ask-more"
  | "ask-principal"
  | "not-applicable"
  | "indeterminate";

/** Gate outcomes, in the model's words. Carried on `decision` events. */
export type InboundOutcome = "admit" | "ask-more" | "refuse" | "ask-principal";
export type OutboundOutcome = "go" | "ask-principal" | "stop" | "ask-more";

export type EventKind =
  | "message-in"
  | "message-out"
  | "check"
  | "decision"
  | "store"
  | "recall"
  | "propose"
  | "ask-principal"
  | "principal-instruction"
  | "principal-reply"
  | "record";

export const PACKET_LAYERS = [
  "header",
  "authority",
  "content",
  "evidence",
  "terms",
  "provenance",
] as const;
export type PacketLayer = (typeof PACKET_LAYERS)[number];

export interface PacketLayerView {
  readonly present: boolean;
  readonly summary: string;
  readonly raw?: unknown;
  readonly digest?: string;
  /** Free text found in this layer: shown as it came, and always untrusted content. */
  readonly untrusted?: readonly { readonly path: string; readonly text: string }[];
}

export interface PacketView {
  readonly jsonld?: string;
  readonly context?: string | readonly string[];
  readonly rdf?: string;
  readonly attachments?: readonly {
    readonly digest: string;
    readonly mediaType: string;
    readonly byteLength: number;
  }[];
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** Message kind. */
  readonly kind: string;
  readonly carriage: { readonly suite: SuiteId; readonly summary: string };
  readonly layers: Readonly<Record<PacketLayer, PacketLayerView>>;
}

export interface TraceRef {
  /** The exact resource identifier rendered by label in a generated annotation. */
  readonly id?: string;
  readonly layer: LayerId;
  readonly suite: SuiteId;
  readonly clause?: string;
}

export interface TraceEvent {
  /** Logical clock: position in the trace. No wall-clock time. */
  readonly seq: number;
  /** Step of the worked example (plan section 8). */
  readonly step: number;
  /** Whose diagram lights up (a party id from the model). */
  readonly agent: string;
  readonly part: Part;
  readonly kind: EventKind;
  readonly check?: Check;
  readonly verdict?: Verdict;
  /** On `decision` events: the gate outcome. (Extension; see the package README.) */
  readonly outcome?: InboundOutcome | OutboundOutcome;
  /** A reason code from the pilot model (or a gate code for `not-applicable`). */
  readonly reason?: string;
  readonly rule?: { readonly id: string; readonly text: string };
  readonly packet?: PacketView;
  readonly settlement?: import("../settlement/types.js").SettlementTrace;
  readonly segment?: "payment";
  readonly segmentEnd?: "payment";
  readonly refs?: readonly TraceRef[];
  readonly chat?: { readonly who: "principal" | "agent"; readonly text: string };
  /** How a trust question was answered: the sources consulted, in order. */
  readonly resolution?: {
    readonly question: string;
    readonly path: readonly {
      readonly at: string;
      readonly kind: "own-list" | "root" | "register" | "federation" | "international";
      readonly says: string;
    }[];
    readonly answer: string;
  };
  /** A fact written to or read from memory (on `store` / `recall` events). */
  readonly fact?: MemoryFact;
  readonly caption: string;
}

/** What a gate or runtime hands to its trace sink; the recorder adds seq, step and agent. */
export type TraceEventInput = Omit<TraceEvent, "seq" | "step" | "agent"> & {
  /** Recorder-only inputs; resolved through the wire writer before publishing a trace. */
  readonly settlementFacts?: import("../model/payment.js").PaymentFacts;
  readonly settlementDocument?: unknown;
};

export interface TraceAgent {
  readonly id: string;
  readonly name: string;
  readonly actsFor: string;
  readonly role: string;
}

export interface TraceFile {
  readonly useCase?: string;
  readonly path?: "main" | { readonly index: number; readonly what: string };
  readonly parties?: readonly { readonly id: string; readonly name: string }[];
  readonly standIns?: readonly { readonly what: string; readonly replacedBy: string }[];
  readonly schema: typeof TRACE_SCHEMA;
  readonly scenario: {
    readonly id: string;
    readonly title: string;
    /** Titles of the worked-example steps this trace covers, by step number. */
    readonly steps?: Readonly<Record<string, string>>;
  };
  readonly configuration: { readonly id: string; readonly layers: Record<LayerId, SuiteId> };
  readonly agents: readonly TraceAgent[];
  readonly assurance?: { readonly kind: "joint"; readonly assumption: string };
  readonly generated: {
    readonly commit: string;
    readonly core: "scripted" | "recorded-model";
    readonly method?: string;
    readonly package?: string;
    readonly packageCommit?: string;
    readonly sha256?: string;
    readonly notice?: string;
  };
  readonly events: readonly TraceEvent[];
}

/** One entry of an expected outline. */
export interface OutlineEntry {
  readonly agent: string;
  readonly part: Part;
  readonly kind: EventKind;
  readonly check?: Check;
  readonly verdict?: Verdict;
  readonly reason?: string;
}

/** The event kinds an outline keeps. */
export const OUTLINE_KINDS: readonly EventKind[] = [
  "check",
  "decision",
  "message-in",
  "message-out",
  "ask-principal",
];

/** The expected outline of a trace: every check, decision, message and ask-principal event. */
export function outlineOf(trace: Pick<TraceFile, "events">): OutlineEntry[] {
  return trace.events
    .filter((e) => OUTLINE_KINDS.includes(e.kind))
    .map((e) => ({
      agent: e.agent,
      part: e.part,
      kind: e.kind,
      ...(e.check ? { check: e.check } : {}),
      ...(e.verdict ? { verdict: e.verdict } : {}),
      ...(e.reason ? { reason: e.reason } : {}),
    }));
}

/**
 * A fact held in memory, with where it came from and how it was produced. The baseline has
 * no numeric confidence: reliance rests on the method and the source's standing.
 */
export interface MemoryFact {
  readonly id: string;
  /** Plain name ("Harbour Bank's balance at 31 October 2026"). */
  readonly label: string;
  readonly claimType: string;
  readonly subject: string;
  readonly value: unknown;
  readonly source: string;
  /** How the claim was produced, as its source states it (e.g. `recorded-by-authority`). */
  readonly method?: string;
  readonly asOf?: string;
  readonly period?: { readonly start: string; readonly end: string };
  /** The issuer's terms of use, kept with the fact. */
  readonly terms?: { readonly id: string; readonly summary: string };
  readonly provenance?: string;
  /** A confidence the source stated, when it states one (none in the baseline). */
  readonly confidence?: number;
}

const METHOD_RANK: Record<string, number> = {
  "recorded-by-authority": 3,
  attested: 2,
  derived: 1,
  "self-reported": 0,
};

/** Precedence when two facts disagree: by method first, then by a stated confidence. */
export function outranks(a: MemoryFact, b: MemoryFact): boolean {
  const ra = METHOD_RANK[a.method ?? ""] ?? -1;
  const rb = METHOD_RANK[b.method ?? ""] ?? -1;
  if (ra !== rb) return ra > rb;
  return (a.confidence ?? 0) > (b.confidence ?? 0);
}
