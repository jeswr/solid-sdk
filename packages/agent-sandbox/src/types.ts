// AUTHORED-BY Claude Opus 5.5
// The sandbox's shared shapes. A tool is the ONLY way an agent touches the world; every
// tool call is a request the gate decides before anything runs.
import type { Mandate, Rule } from "@jeswr/agent-mandate";
import type { OdrlPolicy } from "@jeswr/solid-odrl";

/** JSON values that cross the sandbox boundary (tool arguments and results). */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [k: string]: Json };
/** Tool arguments: a JSON object. */
export type Args = { readonly [k: string]: Json };

/** What kind of effect a tool has; decides which gate steps apply. */
export type ToolKind = "read" | "send" | "write" | "pay";

/** A monetary amount (refunds, payments). */
export interface Amount {
  readonly value: number;
  readonly currency: string;
}

/**
 * The context a tool call asserts, derived by the TRUSTED tool spec from the call's arguments
 * (never supplied by the agent directly). One outbound call may address several recipients;
 * the gate evaluates each one.
 */
export interface CallContext {
  /** Recipient party IRIs (e.g. `mailto:` IRIs) for send/write/pay calls. */
  readonly recipients?: readonly string[];
  /** The money committed by this call. */
  readonly amount?: Amount;
  /** The region IRI the data lands in (for data sovereignty rules). */
  readonly region?: string;
  /** A purpose IRI this tool always serves (overrides the session purpose), e.g. a marketing tool. */
  readonly purpose?: string;
  /** Free text the call carries out (message body); hybrid mode may classify it. */
  readonly content?: string;
  /**
   * Records the TRUSTED tool will transmit on the agent's behalf without the agent seeing them
   * (e.g. a reminder filled in from the customer's own record). Checked like records read.
   */
  readonly uses?: readonly DataLabel[];
}

/** A record or source the agent read, carrying the policy its owner attached to it. */
export interface DataLabel {
  /** The record IRI (the ODRL target). */
  readonly id: string;
  /** A short human title ("Sickness note: Sam Patel"). */
  readonly title: string;
  /** The system the record came from. */
  readonly source: string;
  /** A human category name ("Health data", "Customer record"). */
  readonly category: string;
  /** The owner's policy for this record. */
  readonly policy: OdrlPolicy;
}

/** A record returned by a read tool, before the gate applies its policy. */
export interface DataItem {
  readonly label: DataLabel;
  /** The content the agent may see if the record's policy allows the read. */
  readonly content: Json;
}

/** What a tool's implementation returns. */
export interface ToolOutput {
  /** Plain content for the agent. */
  readonly content?: Json;
  /** Records the tool read; the gate filters them through their own policies. */
  readonly items?: readonly DataItem[];
}

/** JSON Schema subset for tool inputs (exposed to models and MCP clients as-is). */
export interface InputSchema {
  readonly type: "object";
  readonly properties: { readonly [k: string]: { readonly [k: string]: Json } };
  readonly required?: readonly string[];
}

/** A tool the agent may be offered. The spec is trusted; the arguments are not. */
export interface ToolSpec {
  readonly name: string;
  /** Short human title for the UI. */
  readonly title: string;
  readonly description: string;
  /** The system IRI this tool acts on (the ODRL target of the global rules). */
  readonly system: string;
  /** The ODRL (or agent-profile) action IRI or short name the call performs. */
  readonly action: string;
  readonly kind: ToolKind;
  readonly inputSchema: InputSchema;
  /** Derive the trusted call context from the arguments. Throwing refuses the call. */
  context?(args: Args): CallContext;
  /** Perform the call (only ever invoked after the gate permits it). */
  run(args: Args): Promise<ToolOutput> | ToolOutput;
}

/** A grant layered onto the mandate at run time (e.g. a delegation credential), revocable. */
export interface Grant {
  readonly id: string;
  /** Who granted it, for the record ("Andrew Hill"). */
  readonly grantedBy: string;
  readonly description: string;
  readonly rule: Rule;
  readonly kind: "autonomous" | "withApproval";
}

/** How the gate decides. */
export type EnforcementMode = "off" | "policy" | "llm" | "hybrid";

/** The three outcomes people see: send, review, stop. */
export type Outcome = "permit" | "review" | "stop";

/** One step of the gate's reasoning, for the record and the UI. */
export interface StepResult {
  readonly step:
    | "catalogue"
    | "global"
    | "data-read"
    | "data-send"
    | "limits"
    | "judge"
    | "approval";
  readonly outcome: Outcome;
  /** Stable machine reason ("prohibition", "limit:sendsPerDay", "data:deny"). */
  readonly reason: string;
  /** Plain-English explanation. */
  readonly explanation: string;
  /** The record or rule this step was about, if any. */
  readonly about?: string;
}

/** A duty the agent owes because a permission it used carried one. */
export interface Obligation {
  readonly action: string;
  readonly about: string;
  readonly explanation: string;
  status: "owed" | "done";
}

/** The gate's full decision on one call. */
export interface GateDecision {
  readonly outcome: Outcome;
  readonly steps: readonly StepResult[];
  readonly obligations: readonly Obligation[];
  /** What the policy-as-code gate WOULD have decided (shown in "off" and "llm" modes). */
  readonly shadow?: Outcome;
  /** The one-line reason a person reads. */
  readonly summary: string;
}

/** A tool call as the agent made it. */
export interface ToolCall {
  readonly tool: string;
  readonly args: Args;
}

/** What the agent gets back from a call. */
export type CallResult =
  | {
      readonly status: "done";
      readonly content: Json;
      readonly withheld: number;
      readonly entry: number;
    }
  | {
      readonly status: "held";
      readonly approval: string;
      readonly message: string;
      readonly entry: number;
    }
  | { readonly status: "stopped"; readonly message: string; readonly entry: number }
  | { readonly status: "failed"; readonly message: string; readonly entry: number };

/** Something a model can be asked (LLM-as-enforcer judge and hybrid purpose classifier). */
export interface JudgeModel {
  /** Return the model's raw text answer for a prompt. */
  complete(system: string, prompt: string): Promise<string>;
  readonly name: string;
}

/** The global rules: a mandate plus run-time grants. */
export interface GlobalRules {
  readonly mandate: Mandate;
  readonly currency: string;
}
