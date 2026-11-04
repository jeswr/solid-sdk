// AUTHORED-BY Claude Opus 5.5
// The page's automations: drafting a rule from someone's words, turning it on, and running it
// against Harbour & Finch's simulated apps. One apps world is shared by every automation, so
// what one rule does (an issue opened, an email sent) is visible to the others.
import {
  type AgentEvent,
  type AgentModel,
  type Allowance,
  type Audience,
  type AutomationEvent,
  type AutomationRule,
  type CallResult,
  DEMO_START,
  type EnforcementMode,
  type JudgeModel,
  ruleMandate,
  runAutomation,
  type Sandbox,
  scriptedModel,
  type ToolSpec,
  validateRule,
} from "@jeswr/agent-sandbox";
import {
  APPS,
  type AppsWorld,
  AUTOMATION_AGENT,
  AUTOMATION_EXAMPLES,
  AUTOMATION_PURPOSES,
  type AutomationExample,
  closestExample,
  createAppsWorld,
  type InboxEmail,
  PEOPLE,
} from "@jeswr/agent-sandbox/world";
import { claudeDraftRule, DRAFT_MODEL, type DraftContext } from "./claude.js";
import { ICONS } from "./icons.js";
import type { TraceItem } from "./trace.js";

/** An automation the visitor has. */
export interface Automation {
  readonly rule: AutomationRule;
  readonly on: boolean;
  /** Who drafted it. */
  readonly draftedBy: string;
  /** The built-in example it came from, if any (gives the offline stand-in its script). */
  readonly example?: AutomationExample;
}

/** The shared simulated apps and clock. */
export class AppsSession {
  readonly world: AppsWorld = createAppsWorld();
  #now = DEMO_START;
  readonly clock = () => {
    this.#now += 60_000;
    return this.#now;
  };
  #listeners = new Set<() => void>();
  version = 0;
  subscribe(l: () => void) {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }
  changed() {
    this.version++;
    for (const l of this.#listeners) l();
  }
}

/** A drafted rule, or why there is none. */
export type Draft =
  | { readonly ok: true; readonly automation: Automation; readonly note?: string }
  | { readonly ok: false; readonly message: string };

let drafted = 1;

/** Draft without a model: the closest built-in example, clearly labelled. */
export function standInDraft(request: string): Draft {
  const ex = closestExample(request);
  if (!ex)
    return {
      ok: false,
      message:
        "Without a model I can only set up the built-in examples, and this doesn't match one. Add your Claude API key in Settings and Claude will write the rule, or try one of the suggestions.",
    };
  return {
    ok: true,
    automation: {
      rule: { ...ex.rule, id: `${ex.rule.id}-${(drafted++).toString(36)}`, request },
      on: false,
      draftedBy: "Built-in example (no model connected)",
      example: ex,
    },
    note: "No model is connected, so this is the closest built-in example. With your Claude key, Claude writes the rule from your words.",
  };
}

export const EXAMPLE_REQUESTS = AUTOMATION_EXAMPLES.map((e) => ({
  icon: e.rule.icon,
  text: e.rule.request,
  title: e.rule.title,
}));

/** Emails to try a rule on: its own examples first, then the rest of the inbox. */
export function tryEmails(session: AppsSession, automation: Automation): InboxEmail[] {
  const first = automation.example?.tryWith ?? [];
  const inbox = session.world.state.inbox;
  return [
    ...first.map((id) => inbox.find((m) => m.id === id)).filter((m): m is InboxEmail => !!m),
    ...inbox.filter((m) => !first.includes(m.id)),
  ];
}

let ids = 0;
const nextId = () => `a${ids++}`;

/**
 * Run an automation on one event and stream the trace. Model rules use `model` when given (a
 * live Claude), else the example's stand-in script.
 */
export async function runOnce(
  session: AppsSession,
  automation: Automation,
  event: AutomationEvent,
  options: {
    readonly model?: AgentModel;
    readonly mode?: EnforcementMode;
    readonly judge?: JudgeModel;
    readonly onItems: (items: readonly TraceItem[]) => void;
  },
): Promise<{ ran: boolean; sandbox: Sandbox }> {
  const items: TraceItem[] = [];
  const push = (item: TraceItem) => {
    items.push(item);
    options.onItems([...items]);
  };
  const env = session.world.env(session.clock);
  let sandbox: Sandbox | undefined;
  const rule = automation.rule;
  const model =
    rule.runner.kind === "llm"
      ? (options.model ??
        (automation.example?.script
          ? scriptedModel("Stand-in (no model connected)", automation.example.script(event))
          : undefined))
      : undefined;
  const decisionOf = (result: CallResult) =>
    result.entry >= 0 ? sandbox?.record.entries()[result.entry]?.decision : undefined;

  const onEvent = (e: AgentEvent) => {
    if (e.kind === "say") push({ kind: "thinking", id: nextId(), text: e.text });
    else if (e.kind === "call") {
      const tool = env.tools.find((t) => t.name === e.call.tool);
      const decision = decisionOf(e.result);
      const id = nextId();
      const item: Extract<TraceItem, { kind: "call" }> = {
        kind: "call",
        id,
        toolName: e.call.tool,
        args: e.call.args,
        result: e.result,
        ...(tool && { tool }),
        ...(decision && { decision }),
        ...(e.result.status === "held" && {
          answer: async (approved: boolean) => {
            const held = e.result.status === "held" ? e.result.approval : "";
            if (!sandbox) return;
            const result = approved
              ? await sandbox.approve(held, "Priya Shah")
              : sandbox.decline(held, "Priya Shah");
            const at = items.findIndex((x) => x.id === id);
            const current = items[at];
            if (current?.kind === "call") {
              const { answer: _answer, ...rest } = current;
              items[at] = { ...rest, settled: { by: "Priya Shah", approved, result } };
              options.onItems([...items]);
            }
            session.changed();
          },
        }),
      };
      push(item);
    } else if (e.reason !== "done")
      push({ kind: "notice", id: nextId(), text: e.message ?? "The run ended.", tone: "error" });
    session.changed();
  };

  const out = await runAutomation(rule, event, env, {
    ...(model && { model }),
    onEvent,
    onSandbox: (s) => {
      sandbox = s;
      if (options.mode) s.setMode(options.mode);
      if (options.judge) s.setJudge(options.judge);
    },
  });
  if (!out.ran)
    push({
      kind: "notice",
      id: nextId(),
      text: `Not run: this isn't an email the rule handles (${rule.trigger.kind === "email" ? rule.trigger.match : "different trigger"}).`,
      tone: "info",
    });
  session.changed();
  return { ran: out.ran, sandbox: out.sandbox };
}

/** The event for a sample email. */
export function emailEvent(session: AppsSession, email: InboxEmail): AutomationEvent {
  return session.world.receive(email);
}

/** Check a rule against the apps (for Claude's drafts). */
export function problemsWith(session: AppsSession, rule: AutomationRule): string[] {
  return validateRule(rule, session.world.env(session.clock));
}

/** Turn Claude's draft fields into a rule (the policy vocabulary is checked by validateRule). */
export function ruleFromDraft(
  fields: Record<string, unknown>,
  request: string,
  owner: string,
): AutomationRule {
  const f = fields as {
    title?: string;
    icon?: string;
    summary?: string;
    trigger?: { kind?: string; match?: string; keywords?: string[]; every?: string };
    runner?: { kind?: string; source?: string; instructions?: string };
    rationale?: string;
    policy?: {
      purpose?: string;
      allow?: { tool?: string; to?: unknown; approval?: boolean }[];
      sendsPerDay?: number;
    };
  };
  const t = f.trigger ?? {};
  const trigger: AutomationRule["trigger"] =
    t.kind === "schedule"
      ? { kind: "schedule", every: t.every === "hour" || t.every === "day" ? t.every : "week" }
      : t.kind === "manual"
        ? { kind: "manual" }
        : {
            kind: "email",
            match: t.match ?? "",
            ...(Array.isArray(t.keywords) && t.keywords.length
              ? { keywords: t.keywords.map(String) }
              : {}),
          };
  const runner: AutomationRule["runner"] =
    f.runner?.kind === "code"
      ? { kind: "code", source: f.runner.source ?? "" }
      : { kind: "llm", instructions: f.runner?.instructions ?? "" };
  const allow = (f.policy?.allow ?? []).map((a): Allowance => {
    const to: Audience | undefined = Array.isArray(a.to)
      ? a.to.map((x) =>
          String(x).startsWith("mailto:") ? String(x) : `mailto:${String(x).toLowerCase()}`,
        )
      : a.to === "sender" || a.to === "staff" || a.to === "anyone"
        ? a.to
        : undefined;
    return {
      tool: String(a.tool ?? ""),
      ...(to !== undefined && { to }),
      ...(a.approval && { approval: true }),
    };
  });
  const title = (f.title ?? "").trim();
  return {
    id: `${
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "rule"
    }-${Date.now().toString(36)}`,
    title,
    icon: f.icon ?? "workflow",
    owner,
    request,
    summary: f.summary ?? "",
    trigger,
    runner,
    rationale: f.rationale ?? "",
    policy: {
      purpose: f.policy?.purpose ?? "",
      allow,
      ...(typeof f.policy?.sendsPerDay === "number" && { sendsPerDay: f.policy.sendsPerDay }),
    },
  };
}

/** Claude drafts the rule; a draft that fails the checks goes back once with the problems. */
export async function claudeDraft(
  session: AppsSession,
  apiKey: string,
  request: string,
): Promise<Draft> {
  const context: DraftContext = {
    tools: session.world.tools,
    apps: Object.fromEntries(APPS.map((a) => [a.system, a.name])),
    purposes: AUTOMATION_PURPOSES,
    icons: Object.keys(ICONS),
  };
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const fields = await claudeDraftRule(apiKey, request, context, problems);
    const rule = ruleFromDraft(fields, request, PEOPLE.priya);
    problems = problemsWith(session, rule);
    if (problems.length === 0)
      return { ok: true, automation: { rule, on: false, draftedBy: `Claude (${DRAFT_MODEL})` } };
  }
  return {
    ok: false,
    message: `Claude's draft did not pass the checks, so it was not set up: ${problems.join(" ")}`,
  };
}

const APP_NAME = Object.fromEntries(APPS.map((a) => [a.system, a.name]));

/** The app a tool belongs to. */
export const appName = (tool?: ToolSpec) => (tool ? (APP_NAME[tool.system] ?? "an app") : "an app");

/** When a rule runs, in words. */
export function whenText(rule: AutomationRule): string {
  const t = rule.trigger;
  return t.kind === "email"
    ? `When an email arrives: ${t.match}`
    : t.kind === "schedule"
      ? `Every ${t.every}`
      : "When you press Run";
}

/** One line of a rule's own policy, in words. */
export interface PolicyLine {
  readonly tool: ToolSpec | undefined;
  readonly name: string;
  readonly text: string;
  readonly approval: boolean;
}

/** A rule's own policy, in words. */
export function policyLines(rule: AutomationRule, tools: readonly ToolSpec[]): PolicyLine[] {
  return rule.policy.allow.map((a) => {
    const tool = tools.find((t) => t.name === a.tool);
    const who =
      a.to === undefined
        ? ""
        : a.to === "sender"
          ? ", only to the person whose email started the run"
          : a.to === "staff"
            ? ", only to Harbour & Finch staff and the #support channel"
            : a.to === "anyone"
              ? ", to anyone the organisation allows"
              : `, only to ${a.to.map((x) => x.replace(/^mailto:/, "")).join(", ")}`;
    return {
      tool,
      name: a.tool,
      approval: Boolean(a.approval),
      text: `${tool?.title ?? a.tool}${tool?.title.includes(appName(tool)) ? "" : ` in ${appName(tool)}`}${who}${a.approval ? ", after a person approves" : ""}.`,
    };
  });
}

/** The rule's mandate for a sample run (for "view the policy"). */
export function sampleMandate(
  session: AppsSession,
  rule: AutomationRule,
): ReturnType<typeof ruleMandate> {
  const email = session.world.state.inbox[0];
  const event: AutomationEvent =
    rule.trigger.kind === "email" && email
      ? {
          kind: "email",
          message: {
            id: email.id,
            from: email.from,
            fromName: email.fromName,
            subject: email.subject,
            body: email.body,
          },
        }
      : { kind: "manual" };
  return ruleMandate(rule, session.world.env(session.clock), {
    agent: AUTOMATION_AGENT,
    event,
    at: new Date(DEMO_START).toISOString(),
  });
}
