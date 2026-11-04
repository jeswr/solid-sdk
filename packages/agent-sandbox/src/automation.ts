// AUTHORED-BY Claude Opus 5.5
/**
 * Automation rules: a process someone described in their own words, turned into something the
 * sandbox can run and check. A rule says when it runs (its trigger), how it runs (fixed code in
 * the code box, or a model following written instructions), which tools it may use, and its own
 * policy. That policy becomes an ODRL mandate which is checked IN ADDITION to the
 * organisation's rules, so a rule can only narrow what the organisation allows.
 *
 * Rules are plain data. A model may draft one, but `validateRule` checks every part of it
 * against the tool catalogue before it can run, and the policy is built here from a small,
 * closed vocabulary (who it may contact, how often, what needs a person), never written as
 * free ODRL by the model.
 */
import { AGENT, type Constraint, type Limit, type Mandate, type Rule } from "@jeswr/agent-mandate";
import {
  actionCovers,
  type CallLock,
  createSandbox,
  type Sandbox,
  type SandboxOptions,
} from "./gate.js";
import type { Commitment } from "./limits.js";
import type { AgentEvent, AgentModel, ModelToolCall, ModelTurn } from "./runners/agent.js";
import { agentSystemPrompt, runAgent } from "./runners/agent.js";
import { runCode } from "./runners/code.js";
import type { GlobalRules, ScopedMandate, ToolSpec } from "./types.js";

/** When a rule runs. */
export type Trigger =
  | {
      readonly kind: "email";
      /** Plain-English description of which emails, e.g. "someone asks to meet". */
      readonly match: string;
      /** Words that make an email worth handing to the rule (any, case-insensitive). */
      readonly keywords?: readonly string[];
    }
  | { readonly kind: "schedule"; readonly every: "hour" | "day" | "week" }
  | { readonly kind: "manual" };

/** How a rule runs. */
export type Runner =
  | {
      readonly kind: "code";
      /** JavaScript for the code box. `event` and `tools.<name>()` are in scope. */
      readonly source: string;
    }
  | {
      readonly kind: "llm";
      /** Instructions a model follows each time the rule runs. */
      readonly instructions: string;
    };

/** Who a sending tool may reach. */
export type Audience = "sender" | "staff" | "anyone" | readonly string[];

/** One tool the rule may use, and on what terms. */
export interface Allowance {
  readonly tool: string;
  /** For tools that send: who may receive. "sender" is whoever triggered this run. */
  readonly to?: Audience;
  /** Every use waits for a person. */
  readonly approval?: boolean;
}

/** The rule's own policy, in a closed vocabulary. */
export interface RulePolicy {
  /** The purpose IRI every call is made for. */
  readonly purpose: string;
  readonly allow: readonly Allowance[];
  /** At most this many messages a day from this rule. */
  readonly sendsPerDay?: number;
}

/** An automation rule. */
export interface AutomationRule {
  readonly id: string;
  readonly title: string;
  /** An icon name for the page (e.g. "calendar", "ticket"). */
  readonly icon: string;
  /** What the person asked for, in their words. */
  readonly request: string;
  /** What it does, in one sentence. */
  readonly summary: string;
  readonly trigger: Trigger;
  readonly runner: Runner;
  /** Why it runs as code or as a model. */
  readonly rationale: string;
  readonly policy: RulePolicy;
  /** Who set it up (the issuer of its mandate). */
  readonly owner: string;
}

/** Something that starts a run. */
export type AutomationEvent =
  | {
      readonly kind: "email";
      readonly message: {
        readonly id: string;
        readonly from: string;
        readonly fromName: string;
        readonly subject: string;
        readonly body: string;
      };
    }
  | { readonly kind: "schedule"; readonly at: string }
  | { readonly kind: "manual" };

/** Vocabulary the rule policy may draw on (from the organisation's directory). */
export interface RuleContext {
  readonly tools: readonly ToolSpec[];
  /** Purpose IRI -> name. */
  readonly purposes: Readonly<Record<string, string>>;
  /** The organisation's staff and internal channels (for `to: "staff"`). */
  readonly staff: readonly string[];
}

const MAX_SENDS = 200;

/** Check a rule a person or a model drafted. Returns the problems found (empty when valid). */
export function validateRule(rule: AutomationRule, context: RuleContext): string[] {
  const problems: string[] = [];
  const names = new Set(context.tools.map((t) => t.name));
  if (!rule.title.trim()) problems.push("The rule has no title.");
  if (!Object.hasOwn(context.purposes, rule.policy.purpose))
    problems.push(`"${rule.policy.purpose}" is not one of the organisation's purposes.`);
  if (rule.policy.allow.length === 0) problems.push("The rule may not use any tool.");
  const seen = new Set<string>();
  for (const a of rule.policy.allow) {
    if (!names.has(a.tool)) problems.push(`There is no tool called "${a.tool}".`);
    if (seen.has(a.tool)) problems.push(`"${a.tool}" is listed twice.`);
    seen.add(a.tool);
    const spec = context.tools.find((t) => t.name === a.tool);
    if (spec && spec.kind === "send" && a.to === undefined)
      problems.push(`"${a.tool}" sends messages, so the rule must say who it may send to.`);
    if (a.to !== undefined && spec && spec.kind !== "send")
      problems.push(`"${a.tool}" does not send messages, so it cannot have recipients.`);
    if (a.to !== undefined && !audienceIsValid(a.to))
      problems.push(
        `"${a.tool}" names its recipients wrongly: use "sender", "staff", "anyone" or a list of mailto: addresses.`,
      );
    if (a.to === "sender" && rule.trigger.kind !== "email")
      problems.push(
        `"${a.tool}" may only reply to the sender, but this rule is not started by an email.`,
      );
  }
  problems.push(...siblingProblems(rule, context.tools));
  const s = rule.policy.sendsPerDay;
  if (s !== undefined && (!Number.isInteger(s) || s < 1 || s > MAX_SENDS))
    problems.push(`The daily message limit must be a whole number from 1 to ${MAX_SENDS}.`);
  if (rule.runner.kind === "code" && !rule.runner.source.trim())
    problems.push("The rule's code is empty.");
  if (rule.runner.kind === "llm" && !rule.runner.instructions.trim())
    problems.push("The rule's instructions are empty.");
  if (rule.trigger.kind === "email" && !rule.trigger.match.trim())
    problems.push("The rule does not say which emails start it.");
  return problems;
}

/** A recipient list in one canonical form, for comparing two allowances. */
const audienceKey = (to: Audience | undefined) =>
  Array.isArray(to) ? JSON.stringify([...to].map((x) => x.toLowerCase()).sort()) : String(to);

/**
 * The policy is written per action and system, so two listed tools that share both (say,
 * "reply" and "send" in Gmail) must be allowed on the same terms; otherwise the looser one's
 * permission would cover the other.
 */
function siblingProblems(rule: AutomationRule, tools: readonly ToolSpec[]): string[] {
  const problems: string[] = [];
  const listed: { a: Allowance; spec: ToolSpec }[] = [];
  for (const a of rule.policy.allow) {
    const spec = tools.find((t) => t.name === a.tool);
    if (!spec) continue;
    // Overlapping, not only equal: a permission for one action also covers the actions it
    // includes (ODRL "use" covers "read"), so either tool's permission could authorise the other.
    const other = listed.find(
      (x) =>
        x.spec.system === spec.system &&
        (actionCovers(x.spec.action, spec.action) || actionCovers(spec.action, x.spec.action)),
    );
    listed.push({ a, spec });
    if (
      other &&
      (audienceKey(other.a.to) !== audienceKey(a.to) || !other.a.approval !== !a.approval)
    )
      problems.push(
        `"${other.a.tool}" and "${a.tool}" do overlapping things in the same system, so they must have the same recipients and approval.`,
      );
  }
  return problems;
}

/** The tools a rule's agent is given: only those the rule lists. */
export function ruleTools(rule: AutomationRule, tools: readonly ToolSpec[]): ToolSpec[] {
  const allowed = new Set(rule.policy.allow.map((a) => a.tool));
  return tools.filter((t) => allowed.has(t.name));
}

/** Whether a recipient list is one the policy vocabulary allows. */
function audienceIsValid(to: unknown): to is Audience {
  if (to === "sender" || to === "staff" || to === "anyone") return true;
  return (
    Array.isArray(to) &&
    to.length > 0 &&
    to.every((x) => typeof x === "string" && /^mailto:[^@\s,;<>]+@[^@\s,;<>]+$/.test(x))
  );
}

/** One email address, lowercased, or undefined if the text is not exactly one address. */
export function singleAddress(text: string): string | undefined {
  const bare = text.trim().replace(/^mailto:/i, "");
  return /^[^@\s,;<>"']+@[^@\s,;<>"']+$/.test(bare) ? bare.toLowerCase() : undefined;
}

/** The sender of the event that started a run, as a party IRI (none if it is not one address). */
export function senderOf(event: AutomationEvent): string | undefined {
  if (event.kind !== "email") return undefined;
  const one = singleAddress(event.message.from);
  return one ? `mailto:${one}` : undefined;
}

const c = (leftOperand: string, operator: string, rightOperand: unknown): Constraint =>
  ({ leftOperand, operator, rightOperand }) as Constraint;

/**
 * The rule's policy as an ODRL mandate for one run. "sender" is bound to whoever started this
 * run, so a rule that may only reply cannot be steered into writing to anyone else.
 */
export function ruleMandate(
  rule: AutomationRule,
  context: RuleContext,
  run: { readonly agent: string; readonly event: AutomationEvent; readonly at: string },
): Mandate {
  const base = `urn:automation:${encodeURIComponent(rule.id)}`;
  const sender = senderOf(run.event);
  const own: Rule[] = [];
  const ask: Rule[] = [];
  const siblings = siblingProblems(rule, context.tools);
  if (siblings.length) throw new Error(siblings[0]);
  for (const a of rule.policy.allow) {
    const spec = context.tools.find((t) => t.name === a.tool);
    if (!spec) continue;
    if (a.to !== undefined && !audienceIsValid(a.to))
      throw new Error(`"${a.tool}" names its recipients wrongly`);
    // A sending tool with no recipients would compile to "anyone": refuse instead.
    if (spec.kind === "send" && a.to === undefined)
      throw new Error(`"${a.tool}" sends messages, so the rule must say who it may send to`);
    const constraints: Constraint[] = [c("purpose", "eq", rule.policy.purpose)];
    if (a.to === "sender") constraints.push(c("recipient", "isAnyOf", sender ? [sender] : []));
    else if (a.to === "staff") constraints.push(c("recipient", "isAnyOf", [...context.staff]));
    else if (Array.isArray(a.to))
      constraints.push(
        c(
          "recipient",
          "isAnyOf",
          a.to.map((x) => x.toLowerCase()),
        ),
      );
    const r: Rule = { type: "permission", action: spec.action, target: spec.system, constraints };
    (a.approval ? ask : own).push(r);
  }
  return {
    id: `${base}#mandate`,
    issuer: rule.owner,
    subject: run.agent,
    validFrom: run.at,
    validUntil: new Date(Date.parse(run.at) + 86_400_000).toISOString(),
    autonomous: { id: `${base}#autonomous`, permissions: own },
    withApproval: { id: `${base}#with-approval`, permissions: ask },
    prohibitions: [],
    limits:
      rule.policy.sendsPerDay !== undefined
        ? [
            {
              leftOperand: `${AGENT}sendsPerDay`,
              operator: "lteq",
              rightOperand: rule.policy.sendsPerDay,
              enforcement: "hard",
            } satisfies Limit,
          ]
        : [],
  };
}

/** A model that replays fixed turns: a stand-in for a live model in demos and tests. */
export function scriptedModel(name: string, turns: readonly ModelTurn[]): AgentModel {
  return {
    name,
    start: () => {
      let i = 0;
      return { next: async () => turns[i++] ?? { text: "", calls: [] } };
    },
  };
}

/** What the run's agent is told about the event that started it. */
export function eventText(event: AutomationEvent): string {
  if (event.kind === "email")
    return [
      `A new email arrived (message id ${event.message.id}).`,
      `From: ${event.message.fromName} <${event.message.from}>`,
      `Subject: ${event.message.subject}`,
      "",
      event.message.body,
    ].join("\n");
  if (event.kind === "schedule") return `The scheduled time has come (${event.at}).`;
  return "Someone pressed Run now.";
}

/** Whether an event is one this rule wants. Model rules see every event of their kind. */
export function wants(rule: AutomationRule, event: AutomationEvent): boolean {
  if (rule.trigger.kind !== event.kind) return false;
  if (rule.trigger.kind !== "email" || event.kind !== "email") return true;
  const words = rule.trigger.keywords ?? [];
  if (words.length === 0) return true;
  const text = `${event.message.subject}\n${event.message.body}`.toLowerCase();
  return words.some((w) => text.includes(w.toLowerCase()));
}

/** One run of a rule. */
export interface AutomationRun {
  readonly rule: AutomationRule;
  readonly event: AutomationEvent;
  readonly sandbox: Sandbox;
  readonly events: readonly AgentEvent[];
  /** False when the event was not one the rule handles. */
  readonly ran: boolean;
}

/** What a run needs from the organisation. */
export interface RunEnvironment extends RuleContext {
  readonly rules: () => GlobalRules;
  readonly directory: SandboxOptions["directory"];
  readonly agent: string;
  readonly clock: () => number;
  readonly mode?: SandboxOptions["mode"];
  readonly judge?: SandboxOptions["judge"];
  /** The organisation's name, for the model's instructions. */
  readonly company?: string;
  /** Sends already made by any automation (so the organisation's daily limits span runs). */
  readonly commitments?: Commitment[];
  /** Sends already made by one rule (so its own daily limit spans runs). */
  readonly ruleHistory?: (ruleId: string) => Commitment[];
  /**
   * The lock every run's calls go through. Runs share their histories, so they must share this
   * too, or two runs could each pass a daily limit before either counts its send.
   */
  readonly lock?: CallLock;
}

/**
 * Run a rule for one event in a fresh sandbox: only the rule's tools, the organisation's rules
 * plus the rule's own mandate, and the rule's purpose. Code rules run in the code box; model
 * rules run the tool loop with `model` (a live model, or `scriptedModel` for a demo).
 */
export async function runAutomation(
  rule: AutomationRule,
  event: AutomationEvent,
  env: RunEnvironment,
  options: {
    readonly model?: AgentModel;
    readonly onEvent?: (event: AgentEvent) => void;
    readonly onSandbox?: (sandbox: Sandbox) => void;
  } = {},
): Promise<AutomationRun> {
  // Whoever drafted the rule, it is checked again here, where it is about to run.
  const problems = validateRule(rule, env);
  if (problems.length)
    throw new Error(`The rule "${rule.title}" cannot run: ${problems.join(" ")}`);
  const at = new Date(env.clock()).toISOString();
  const narrowing: ScopedMandate = {
    name: `Automation rule "${rule.title}"`,
    mandate: ruleMandate(rule, env, { agent: env.agent, event, at }),
    tools: rule.policy.allow.map((a) => a.tool),
    ...(env.ruleHistory && { history: env.ruleHistory(rule.id) }),
  };
  const sandbox = createSandbox({
    // Every connected tool is present, but the rule's own mandate hides and refuses what it
    // does not allow, so an attempt outside the rule is a recorded policy decision.
    tools: env.tools,
    rules: () => {
      const org = env.rules();
      return { ...org, also: [...(org.also ?? []), narrowing] };
    },
    directory: env.directory,
    agent: env.agent,
    purpose: rule.policy.purpose,
    purposes: env.purposes,
    clock: env.clock,
    ...(env.commitments && { commitments: env.commitments }),
    ...(env.lock && { lock: env.lock }),
    ...(env.mode && { mode: env.mode }),
    ...(env.judge && { judge: env.judge }),
  });
  options.onSandbox?.(sandbox);
  const events: AgentEvent[] = [];
  const emit = (e: AgentEvent) => {
    events.push(e);
    options.onEvent?.(e);
  };
  if (!wants(rule, event)) return { rule, event, sandbox, events, ran: false };

  if (rule.runner.kind === "code") {
    let n = 0;
    const out = await runCode(
      sandbox,
      `const event = ${JSON.stringify(event)};\n${rule.runner.source}`,
      {
        maxCalls: 20,
        onLog: (text) => emit({ kind: "say", text }),
        onResult: (call) =>
          emit({
            kind: "call",
            call: {
              id: `code-${n++}`,
              tool: call.tool,
              args: (call.args ?? {}) as ModelToolCall["args"],
            },
            result:
              call.result.status === "refused"
                ? { status: "stopped", message: call.result.message, entry: -1 }
                : call.result,
          }),
      },
    );
    emit(
      out.ok
        ? { kind: "end", reason: "done" }
        : { kind: "end", reason: "error", message: out.error ?? "The code stopped." },
    );
    return { rule, event, sandbox, events, ran: true };
  }

  if (!options.model) {
    emit({ kind: "end", reason: "error", message: "No model is connected to run this rule." });
    return { rule, event, sandbox, events, ran: true };
  }
  await runAgent(
    sandbox,
    options.model,
    {
      system: `${agentSystemPrompt(env.company ?? "the organisation", `the automation "${rule.title}"`)} Your standing instructions: ${rule.runner.instructions}`,
      task: eventText(event),
      maxTurns: 8,
    },
    emit,
  );
  return { rule, event, sandbox, events, ran: true };
}
