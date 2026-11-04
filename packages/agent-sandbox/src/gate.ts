// AUTHORED-BY Claude Opus 5.5
// The gate: the single, fail-closed checkpoint between an agent and everything it can touch.
//
// Every tool call passes these steps, in this order, and the strictest outcome wins:
//   1. catalogue  - the tool must be declared and visible under the global rules;
//   2. global     - the agent's mandate (agent-mandate evaluateIntent), per recipient;
//   3. data-read  - each record a read returns is released only if ITS policy allows the read;
//   4. data-send  - an outbound call is checked against the policy of EVERY record read so far;
//   5. limits     - send and spend counters from the mandate's limit vocabulary;
//   6. record     - the decision is appended to the hash-chained record, then the call runs
//                   (permit), waits for a person (review) or is refused (stop).
// The enforcement mode only changes who decides: "policy" is the steps above, "off" lets
// everything through (but still records what the policy would have done), "llm" asks a model
// to judge from the written policy, and "hybrid" lets a model classify the purpose of a
// message before the steps above decide.
import { AGENT, evaluateIntent, type Intent, type Mandate, type Rule } from "@jeswr/agent-mandate";
import { digestOf } from "@jeswr/agent-model/core/canonical";
import {
  evaluate,
  matchingPermissions,
  ODRL_ACTIONS,
  type OdrlActionName,
  type OdrlPolicy,
} from "@jeswr/solid-odrl";
import { type Directory, groupResolver, joinNames, nameOf } from "./directory.js";
import { type Commitment, checkLimits } from "./limits.js";
import { describeMandate, describePolicy, limitWords, ruleWords } from "./policy-text.js";
import { DecisionRecord, type RecordEntry } from "./record.js";
import type {
  Args,
  CallContext,
  CallResult,
  DataLabel,
  EnforcementMode,
  GateDecision,
  GlobalRules,
  Grant,
  Json,
  JudgeModel,
  Obligation,
  Outcome,
  StepResult,
  ToolCall,
  ToolOutput,
  ToolSpec,
} from "./types.js";

/** Options for {@link createSandbox}. */
export interface SandboxOptions {
  /** Every tool that exists. Tools the rules never allow are hidden from the agent. */
  readonly tools: readonly ToolSpec[];
  /** The global rules, read afresh on every call so a change or revocation applies at once. */
  readonly rules: () => GlobalRules;
  /** Run-time grants (delegations), read afresh on every call. */
  readonly grants?: () => readonly Grant[];
  readonly directory: Directory;
  /** The agent's IRI; must equal the mandate's subject. */
  readonly agent: string;
  /** The purpose IRI of the task, set by the person who gave it (not by the agent). */
  readonly purpose: string;
  /** Milliseconds since the epoch; injectable for deterministic tests and demos. */
  readonly clock?: () => number;
  readonly mode?: EnforcementMode;
  /**
   * What happens to a call no global rule covers: "stop" (closed world, the default) or
   * "review" (ask a person, agent-mandate's own default).
   */
  readonly unlisted?: "stop" | "review";
  /**
   * Sends and payments already made, shared with other sandboxes for the same agent (for
   * example every run of an automation), so daily limits count across runs. The sandbox
   * appends to it.
   */
  readonly commitments?: Commitment[];
  /** The model used by the "llm" and "hybrid" modes. */
  readonly judge?: JudgeModel;
  /** Purposes the hybrid classifier may choose from (IRI -> name); defaults to the directory's. */
  readonly purposes?: Readonly<Record<string, string>>;
}

/** A call waiting for a person. */
export interface HeldCall {
  readonly id: string;
  readonly call: ToolCall;
  readonly decision: GateDecision;
  readonly entry: number;
  readonly at: string;
}

/** A tool as the catalogue shows it. */
export interface CatalogueEntry {
  readonly tool: ToolSpec;
  readonly visible: boolean;
  /** Offered, but no rule lets the agent use it on its own: each use goes to a person. */
  readonly approval: boolean;
  readonly reason: string;
}

/** The sandbox an agent runs in. */
export interface Sandbox {
  /** Tools the agent can see (the only ones offered to a model or an MCP client). */
  tools(): readonly ToolSpec[];
  /** Every tool, with whether the agent can see it and why. */
  catalogue(): readonly CatalogueEntry[];
  /** Make a call: decided, recorded, then run, held or refused. */
  call(call: ToolCall): Promise<CallResult>;
  /** Decide a call without running or recording it (previews). */
  decide(call: ToolCall): Promise<GateDecision>;
  /** Calls waiting for a person. */
  held(): readonly HeldCall[];
  /** A person approves a held call: it is re-checked, then run if nothing now stops it. */
  approve(id: string, by: string): Promise<CallResult>;
  /** A person declines a held call. */
  decline(id: string, by: string): CallResult;
  /** Records the agent has read in this session (their rules travel with its outputs). */
  labels(): readonly DataLabel[];
  /** Duties the agent owes from permissions it used. */
  obligations(): readonly Obligation[];
  readonly record: DecisionRecord;
  mode(): EnforcementMode;
  setMode(mode: EnforcementMode): void;
  /** The model the "llm" and "hybrid" modes use; replaceable mid-session (undefined disconnects it). */
  judge(): JudgeModel | undefined;
  setJudge(judge: JudgeModel | undefined): void;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const ODRL_NS = "http://www.w3.org/ns/odrl/2/";
const shortAction = (a: string) => (a.startsWith(ODRL_NS) ? a.slice(ODRL_NS.length) : a);
const isOdrlAction = (a: string): a is OdrlActionName =>
  (ODRL_ACTIONS as readonly string[]).includes(a);

/** Whether a rule's action covers a call's action (ODRL implication, e.g. `use` covers `read`). */
export function actionCovers(ruleAction: string, callAction: string): boolean {
  const r = shortAction(ruleAction);
  const c = shortAction(callAction);
  if (r === c) return true;
  if (!isOdrlAction(r) || !isOdrlAction(c)) return false;
  return (
    matchingPermissions(
      { id: "urn:x:covers", permissions: [{ type: "permission", action: r }] },
      { action: c },
    ).length > 0
  );
}

const STRICTNESS: Readonly<Record<Outcome, number>> = { permit: 0, review: 1, stop: 2 };
const strictest = (outcomes: readonly Outcome[]): Outcome =>
  outcomes.reduce<Outcome>((a, b) => (STRICTNESS[b] > STRICTNESS[a] ? b : a), "permit");

/** The mandate with run-time grants folded in. */
export function effectiveMandate(
  mandate: Mandate,
  grants: readonly Grant[],
  askFirst: GlobalRules["askFirst"] = [],
): Mandate {
  const add = (kind: Grant["kind"]) => grants.filter((g) => g.kind === kind).map((g) => g.rule);
  const own = [...(mandate.autonomous.permissions ?? []), ...add("autonomous")];
  // A rule that could cover an ask-first action moves to approval, whatever granted it.
  const mustAsk = (r: Rule) =>
    askFirst.some(
      (x) =>
        (r.target === undefined || r.target === x.target) &&
        (actionCovers(r.action, x.action) || actionCovers(x.action, r.action)),
    );
  return {
    ...mandate,
    autonomous: { ...mandate.autonomous, permissions: own.filter((r) => !mustAsk(r)) },
    withApproval: {
      ...mandate.withApproval,
      permissions: [
        ...(mandate.withApproval.permissions ?? []),
        ...add("withApproval"),
        ...own.filter(mustAsk),
      ],
    },
  };
}

const ruleTargets = (rule: Rule, system: string) =>
  rule.target === undefined || rule.target === system;

/** Create a sandbox around a set of tools. */
export function createSandbox(options: SandboxOptions): Sandbox {
  const clock = options.clock ?? (() => Date.now());
  const directory = options.directory;
  const unlisted = options.unlisted ?? "stop";
  let mode: EnforcementMode = options.mode ?? "policy";
  let currentJudge: JudgeModel | undefined = options.judge;
  const record = new DecisionRecord();
  // Keyed by record AND policy: a record re-read under different rules keeps both, so no
  // restriction acquired earlier can be replaced by a later, looser copy.
  const labels = new Map<string, DataLabel>();
  const labelKey = (l: DataLabel) => `${l.id}\u0000${JSON.stringify(l.policy)}`;
  const obligations: Obligation[] = [];
  const commitments: Commitment[] = options.commitments ?? [];
  const held = new Map<string, HeldCall & { readonly spec: ToolSpec; readonly ctx: CallContext }>();
  let heldCounter = 0;

  const currentMandate = () => {
    const rules = options.rules();
    return effectiveMandate(rules.mandate, options.grants?.() ?? [], rules.askFirst);
  };

  function visibility(
    spec: ToolSpec,
    mandate: Mandate,
    /** A narrowing mandate: what it does not list is hidden, whatever `unlisted` says. */
    scoped = false,
  ): { visible: boolean; approval: boolean; reason: string } {
    const banned = mandate.prohibitions.find(
      (r) =>
        actionCovers(r.action, spec.action) &&
        ruleTargets(r, spec.system) &&
        !(r.constraints ?? []).length,
    );
    if (banned)
      return {
        visible: false,
        approval: false,
        reason: `Hidden: the agent may never ${ruleWords(banned, directory)}.`,
      };
    const covers = (r: Rule) => actionCovers(r.action, spec.action) && ruleTargets(r, spec.system);
    const own = (mandate.autonomous.permissions ?? []).find(covers);
    if (own)
      return {
        visible: true,
        approval: false,
        reason: `Offered: the agent may ${ruleWords(own, directory)}.`,
      };
    const asked = (mandate.withApproval.permissions ?? []).find(covers);
    if (asked)
      return {
        visible: true,
        approval: true,
        reason: `Offered, but each use needs a person's approval: the agent may ${ruleWords(asked, directory)}.`,
      };
    if (unlisted === "review" && !scoped)
      return {
        visible: true,
        approval: true,
        reason: "Offered: no rule covers it, so each use goes to a person.",
      };
    return {
      visible: false,
      approval: false,
      reason: `Hidden: no rule lets the agent ${spec.title.toLowerCase()} (${nameOf(directory, spec.system)}).`,
    };
  }

  /** The tool's visibility under the main mandate and every narrowing one (strictest wins). */
  function combinedVisibility(spec: ToolSpec, mandate: Mandate) {
    const main = visibility(spec, mandate);
    let out = main;
    for (const extra of options.rules().also ?? []) {
      const v = visibility(spec, extra.mandate, true);
      if (!v.visible && out.visible)
        out = { ...v, reason: `${v.reason.replace(/^Hidden: /, `Hidden by ${extra.name}: `)}` };
      else if (v.visible && v.approval && out.visible && !out.approval)
        out = { ...v, reason: `${v.reason} (${extra.name})` };
    }
    return out;
  }

  function catalogue(): CatalogueEntry[] {
    const mandate = currentMandate();
    return options.tools.map((tool) => ({ tool, ...combinedVisibility(tool, mandate) }));
  }

  function rulesDigest(mandate: Mandate): string {
    const also = options.rules().also ?? [];
    return digestOf(JSON.parse(JSON.stringify(also.length ? { mandate, also } : mandate)) as Json);
  }

  /** Step 2: the global mandate, once per recipient (or once if there is none). */
  async function globalStep(
    spec: ToolSpec,
    ctx: CallContext,
    purpose: string,
    mandate: Mandate,
    at: string,
    scoped = false,
  ): Promise<StepResult[]> {
    const recipients = ctx.recipients?.length ? ctx.recipients : [undefined];
    const steps: StepResult[] = [];
    for (const recipient of recipients) {
      const attributes: Record<string, string | number> = { purpose };
      if (recipient !== undefined) attributes.recipient = recipient;
      if (ctx.region !== undefined) attributes.spatial = ctx.region;
      const intent: Intent = {
        agent: options.agent,
        action: spec.action,
        target: spec.system,
        at,
        attributes,
      };
      const result = await evaluateIntent(mandate, intent);
      const to = recipient === undefined ? "" : ` to ${nameOf(directory, recipient)}`;
      const what = `${spec.title.toLowerCase()}${to}`;
      switch (result.decision) {
        case "permit":
          steps.push({
            step: "global",
            outcome: "permit",
            reason: "autonomous",
            explanation: `The rules let the agent ${what} on its own.`,
            ...(recipient !== undefined && { about: recipient }),
          });
          break;
        case "prohibited": {
          const rule = mandate.prohibitions.find(
            (r) => actionCovers(r.action, spec.action) && ruleTargets(r, spec.system),
          );
          steps.push({
            step: "global",
            outcome: "stop",
            reason: "prohibition",
            explanation: rule
              ? `The rules say the agent may never ${ruleWords(rule, directory)}.`
              : `The rules forbid the agent to ${what}.`,
            ...(recipient !== undefined && { about: recipient }),
          });
          break;
        }
        case "refuse-all":
          steps.push({
            step: "global",
            outcome: "stop",
            reason: result.reason,
            explanation: `The agent's mandate is not usable (${result.reason.replace(/-/g, " ")}), so it may do nothing.`,
          });
          break;
        default: {
          const noRule = result.reason === "no-matching-rule";
          const outcome: Outcome = noRule && (scoped || unlisted === "stop") ? "stop" : "review";
          steps.push({
            step: "global",
            outcome,
            reason: result.reason,
            explanation:
              result.reason === "owner-approval"
                ? `The rules let the agent ${what} only with a person's approval.`
                : noRule
                  ? outcome === "stop"
                    ? `No rule lets the agent ${what}, and anything not allowed is refused.`
                    : `No rule covers this, so a person decides whether the agent may ${what}.`
                  : `The rules could not be fully checked for this call, so a person decides.`,
            ...(recipient !== undefined && { about: recipient }),
          });
        }
      }
    }
    return steps;
  }

  /** Step 4: every record read so far must allow this onward sharing. */
  function dataSendStep(
    ctx: CallContext,
    purpose: string,
    now: Date,
  ): {
    steps: StepResult[];
    obligations: Obligation[];
  } {
    const steps: StepResult[] = [];
    const owed: Obligation[] = [];
    const recipients = ctx.recipients ?? [];
    if (recipients.length === 0) return { steps, obligations: owed };
    const involved = new Map(labels);
    for (const label of ctx.uses ?? []) involved.set(labelKey(label), label);
    for (const label of involved.values()) {
      for (const recipient of recipients) {
        const attributes: Record<string, string> = {
          purpose,
          recipient,
          dateTime: now.toISOString(),
        };
        if (ctx.region !== undefined) attributes.spatial = ctx.region;
        const result = evaluate(
          label.policy,
          { agent: options.agent, action: "distribute", target: label.id, attributes },
          { now, resolvePartyCollection: groupResolver(directory) },
        );
        const who = nameOf(directory, recipient);
        if (result.decision === "permit") {
          for (const duty of result.duties)
            owed.push({
              action: duty.action,
              about: label.id,
              explanation: `Because it shared "${label.title}", the agent must ${duty.action === "inform" ? "inform the owner" : duty.action} (${label.category}).`,
              status: "owed",
            });
          continue;
        }
        const rules = describePolicy(label.policy, directory);
        steps.push({
          step: "data-send",
          outcome: "stop",
          reason: result.decision === "deny" ? "data:prohibited" : "data:not-permitted",
          explanation: `"${label.title}" (${label.category}) cannot go to ${who}${ctx.region ? ` in ${nameOf(directory, ctx.region)}` : ""} for ${nameOf(directory, purpose)}. Its owner's rules: ${rules.join(" ")}`,
          about: label.id,
        });
      }
    }
    if (steps.length === 0 && involved.size > 0)
      steps.push({
        step: "data-send",
        outcome: "permit",
        reason: "data:permitted",
        explanation: `The rules on the ${involved.size} record${involved.size === 1 ? "" : "s"} involved allow this.`,
      });
    return { steps, obligations: owed };
  }

  function limitsStep(
    spec: ToolSpec,
    ctx: CallContext,
    now: number,
    mandate: Mandate = options.rules().mandate,
    history: readonly Commitment[] = commitments,
  ): StepResult[] {
    if (spec.kind !== "send" && spec.kind !== "pay") return [];
    const { currency } = options.rules();
    const breaches = checkLimits(
      mandate.limits,
      currency,
      history,
      {
        kind: spec.kind,
        recipients: ctx.recipients?.length ? ctx.recipients : [spec.system],
        ...(ctx.amount !== undefined && { amount: ctx.amount }),
      },
      now,
    );
    if (breaches.length === 0)
      return mandate.limits.length
        ? [
            {
              step: "limits",
              outcome: "permit",
              reason: "within-limits",
              explanation: "Within the agent's limits.",
            },
          ]
        : [];
    return breaches.map((b) => {
      const limit = mandate.limits.find((l) => l.leftOperand.endsWith(b.operand));
      return {
        step: "limits" as const,
        outcome: b.enforcement === "hard" ? ("stop" as const) : ("review" as const),
        reason: `limit:${b.operand}`,
        explanation: `${limit ? limitWords(limit, currency) : `Limit ${b.operand}.`}${
          Number.isNaN(b.used)
            ? " (This limit could not be checked.)"
            : ` Used so far: ${b.used}${b.recipient ? ` with ${nameOf(directory, b.recipient)}` : ""}.`
        }`,
        ...(b.recipient !== undefined && { about: b.recipient }),
      };
    });
  }

  function policyText(mandate: Mandate): string {
    const text = describeMandate(mandate, directory, options.rules().currency);
    const lines = [
      "The agent may, on its own:",
      ...text.onItsOwn.map((s) => `- ${s}`),
      "Only with a person's approval:",
      ...text.withApproval.map((s) => `- ${s}`),
      "Never:",
      ...text.never.map((s) => `- ${s}`),
      "Limits:",
      ...text.limits.map((s) => `- ${s}`),
      unlisted === "stop"
        ? "Anything not allowed above is refused."
        : "Anything not covered goes to a person.",
    ];
    // The judge gets the same history the limits step uses, so the comparison is fair.
    const now = clock();
    const today = commitments.filter((c) => c.at >= now - (now % 86_400_000));
    const sends = today.filter((c) => c.kind === "send");
    const spent = today
      .filter((c) => c.kind === "pay")
      .reduce((sum, c) => sum + (c.amount?.value ?? 0), 0);
    lines.push(
      `So far today the agent has sent ${sends.length} message${sends.length === 1 ? "" : "s"}${
        sends.length
          ? ` (to ${joinNames([...new Set(sends.map((c) => nameOf(directory, c.recipient)))], "and")})`
          : ""
      } and committed ${spent} ${options.rules().currency}.`,
    );
    for (const label of labels.values())
      lines.push(
        `The agent has read "${label.title}" (${label.category}). Its owner's rules: ${describePolicy(label.policy, directory).join(" ")}`,
      );
    return lines.join("\n");
  }

  async function judgeStep(
    spec: ToolSpec,
    args: Args,
    ctx: CallContext,
    mandate: Mandate,
  ): Promise<StepResult> {
    const judge = currentJudge;
    if (!judge)
      return {
        step: "judge",
        outcome: "review",
        reason: "judge:unavailable",
        explanation: "No model is connected to judge this call, so a person decides.",
      };
    const system =
      'You enforce an organisation\'s rules on an AI agent. Read the rules and the proposed action, then answer with JSON only: {"outcome": "permit" | "review" | "stop", "reason": "<one sentence>"}. Use review when a person should decide.';
    const narrowing = (options.rules().also ?? [])
      .map(
        (x) =>
          `\n\nThese rules ALSO apply (${x.name}); the action must satisfy both:\n${policyText(x.mandate)}`,
      )
      .join("");
    const prompt = `${policyText(mandate)}${narrowing}\n\nThe task's purpose: ${nameOf(directory, options.purpose)}.\nProposed action: ${spec.title} (${spec.description}).\nRecipients: ${joinNames((ctx.recipients ?? []).map((r) => nameOf(directory, r))) || "none"}.\nArguments: ${JSON.stringify(args)}`;
    try {
      const raw = await judge.complete(system, prompt);
      const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
        outcome?: unknown;
        reason?: unknown;
      };
      const outcome =
        json.outcome === "permit" || json.outcome === "stop" ? json.outcome : "review";
      return {
        step: "judge",
        outcome,
        reason: `judge:${judge.name}`,
        explanation: `${judge.name} judged: ${typeof json.reason === "string" ? json.reason : "no reason given"}`,
      };
    } catch {
      return {
        step: "judge",
        outcome: "review",
        reason: "judge:unreadable",
        explanation: "The model's judgement could not be read, so a person decides.",
      };
    }
  }

  /** Hybrid mode: a model says what a message is FOR; the rules then decide. */
  async function classifyPurpose(
    ctx: CallContext,
  ): Promise<{ purpose?: string; step?: StepResult }> {
    const judge = currentJudge;
    if (!judge || !ctx.content) return {};
    const purposes = options.purposes ?? {};
    const list = Object.entries(purposes);
    if (list.length === 0) return {};
    const system =
      'Classify what a message is for. Answer with JSON only: {"purpose": "<one IRI from the list>"}.';
    const prompt = `Purposes:\n${list.map(([iri, name]) => `- ${iri} (${name})`).join("\n")}\n\nMessage:\n${ctx.content}`;
    try {
      const raw = await judge.complete(system, prompt);
      const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
        purpose?: unknown;
      };
      if (typeof json.purpose === "string" && Object.hasOwn(purposes, json.purpose))
        return {
          purpose: json.purpose,
          step: {
            step: "judge",
            outcome: "permit",
            reason: `classified:${judge.name}`,
            explanation: `${judge.name} read the message as being for ${nameOf(directory, json.purpose)}; the rules decide from there.`,
          },
        };
    } catch {
      // Fall through: the rules decide on the task's stated purpose.
    }
    return {};
  }

  async function policyDecision(
    spec: ToolSpec,
    ctx: CallContext,
    purpose: string,
    mandate: Mandate,
    approved: boolean,
  ): Promise<{ steps: StepResult[]; obligations: Obligation[] }> {
    const nowMs = clock();
    const now = new Date(nowMs);
    const at = now.toISOString();
    const steps: StepResult[] = [];
    const vis = visibility(spec, mandate);
    steps.push({
      step: "catalogue",
      outcome: vis.visible ? "permit" : "stop",
      reason: vis.visible ? "listed" : "hidden",
      explanation: vis.reason,
    });
    steps.push(...(await globalStep(spec, ctx, purpose, mandate, at)));
    // Reads are filtered record by record when they run; payments carry no data onward.
    const send = dataSendStep(spec.kind === "read" || spec.kind === "pay" ? {} : ctx, purpose, now);
    steps.push(...send.steps);
    steps.push(...limitsStep(spec, ctx, nowMs));
    // Each narrowing mandate (an automation rule's own policy) must allow the call too.
    for (const extra of options.rules().also ?? []) {
      const tag = (x: StepResult): StepResult => ({
        ...x,
        explanation: `${extra.name}: ${x.explanation}`,
        reason: `also:${x.reason}`,
      });
      const v = visibility(spec, extra.mandate, true);
      steps.push(
        tag({
          step: "catalogue",
          outcome: v.visible ? "permit" : "stop",
          reason: v.visible ? "listed" : "hidden",
          explanation: v.reason,
        }),
      );
      steps.push(...(await globalStep(spec, ctx, purpose, extra.mandate, at, true)).map(tag));
      steps.push(...limitsStep(spec, ctx, nowMs, extra.mandate, extra.history).map(tag));
    }
    if (approved)
      return {
        steps: steps.map((s) =>
          s.outcome === "review"
            ? {
                ...s,
                outcome: "permit" as const,
                explanation: `${s.explanation} A person approved it.`,
              }
            : s,
        ),
        obligations: send.obligations,
      };
    return { steps, obligations: send.obligations };
  }

  function summarise(outcome: Outcome, steps: readonly StepResult[]): string {
    const deciding =
      steps.find((s) => s.outcome === outcome && s.step !== "catalogue") ??
      steps.find((s) => s.outcome === outcome);
    return deciding?.explanation ?? "Allowed.";
  }

  async function decideSpec(
    spec: ToolSpec,
    args: Args,
    ctx: CallContext,
    approved = false,
  ): Promise<GateDecision> {
    const mandate = currentMandate();
    const stated = ctx.purpose ?? options.purpose;
    const extra: StepResult[] = [];
    let pac = await policyDecision(spec, ctx, stated, mandate, approved);
    let pacOutcome = strictest(pac.steps.map((s) => s.outcome));
    if (mode === "hybrid") {
      // The model's reading of the purpose can only make the answer stricter: the rules are
      // checked under both the stated and the classified purpose, and the stricter answer wins.
      const classified = await classifyPurpose(ctx);
      if (classified.purpose && classified.purpose !== stated) {
        const alt = await policyDecision(spec, ctx, classified.purpose, mandate, approved);
        const altOutcome = strictest(alt.steps.map((s) => s.outcome));
        if (strictest([pacOutcome, altOutcome]) !== pacOutcome) {
          pac = alt;
          pacOutcome = altOutcome;
          if (classified.step) extra.push(classified.step);
        }
      }
    }
    if (mode === "off")
      return {
        outcome: "permit",
        steps: pac.steps,
        obligations: pac.obligations,
        shadow: pacOutcome,
        summary:
          pacOutcome === "permit"
            ? "No guardrails: it went ahead (the rules would have allowed it)."
            : `No guardrails: it went ahead, but the rules would have said ${pacOutcome === "stop" ? "stop" : "ask a person"}: ${summarise(pacOutcome, pac.steps)}`,
      };
    if (mode === "llm") {
      // An approved call is judged again: a person's approval answers "ask a person", not "stop".
      const fresh = await judgeStep(spec, args, ctx, mandate);
      const judged =
        approved && fresh.outcome === "review"
          ? {
              ...fresh,
              outcome: "permit" as const,
              explanation: `${fresh.explanation} A person approved it.`,
            }
          : fresh;
      // A narrowing mandate (an automation rule's own) still binds: the judge may only make the
      // answer stricter than it. (Approved review steps are already permits in pac.)
      const bound = pac.steps.filter((s) => s.reason.startsWith("also:"));
      const outcome = strictest([judged.outcome, ...bound.map((s) => s.outcome)]);
      return {
        outcome,
        steps: [judged, ...pac.steps],
        obligations: outcome === "permit" ? pac.obligations : [],
        shadow: pacOutcome,
        summary: outcome === judged.outcome ? judged.explanation : summarise(outcome, bound),
      };
    }
    const steps = [...extra, ...pac.steps];
    return {
      outcome: pacOutcome,
      steps,
      obligations: pacOutcome === "permit" ? pac.obligations : [],
      summary: summarise(pacOutcome, steps),
    };
  }

  /** What a call would do, as far as the rules can see it (for binding approvals). */
  const effectsOf = (ctx: CallContext) =>
    JSON.stringify([
      [...(ctx.recipients ?? [])].sort(),
      ctx.amount ?? null,
      ctx.region ?? null,
      ctx.purpose ?? null,
      (ctx.uses ?? []).map((l) => [l.id, l.policy]),
      ctx.content ?? null,
    ]);

  /** An owned, immutable copy, so later changes to the source cannot alter what was checked. */
  const snapshot = <T>(value: T): T => deepFreeze(structuredClone(value));

  function lookup(call: ToolCall): { spec?: ToolSpec; ctx?: CallContext; error?: string } {
    const spec = options.tools.find((t) => t.name === call.tool);
    if (!spec) return { error: `There is no tool called "${call.tool}".` };
    try {
      const ctx = spec.context?.(call.args) ?? {};
      // Each recipient counts once, however often the call names them.
      return {
        spec,
        ctx: snapshot(ctx.recipients ? { ...ctx, recipients: [...new Set(ctx.recipients)] } : ctx),
      };
    } catch (e) {
      return { spec, error: `The call's details are not valid: ${(e as Error).message}` };
    }
  }

  const refusal = (reason: string, explanation: string): GateDecision => ({
    outcome: "stop",
    steps: [{ step: "catalogue", outcome: "stop", reason, explanation }],
    obligations: [],
    summary: explanation,
  });

  function append(
    call: ToolCall,
    decision: GateDecision,
    result: RecordEntry["result"],
    extra: Partial<Pick<RecordEntry, "settles" | "note">> = {},
  ): RecordEntry {
    return record.append({
      at: new Date(clock()).toISOString(),
      mode,
      tool: call.tool,
      args: call.args,
      decision,
      result,
      rulesDigest: rulesDigest(currentMandate()),
      labels: [...new Set([...labels.values()].map((l) => l.id))],
      ...extra,
    });
  }

  /** Run a permitted call: filter what it read through each record's own policy. */
  async function run(
    spec: ToolSpec,
    call: ToolCall,
    ctx: CallContext,
    decision: GateDecision,
    approvedFrom?: number,
  ): Promise<CallResult> {
    // From here to dispatch nothing awaits, so no other call can run in between. Derive the
    // effects once more and dispatch only if they are still exactly the ones decided on (the
    // decision may have awaited a model or a person while the systems changed).
    const now0 = lookup(call);
    if (!now0.ctx || now0.error || effectsOf(now0.ctx) !== effectsOf(ctx)) {
      const explanation = `Not run: ${now0.error ?? "what the call would do changed while it was being decided."}`;
      const stale: GateDecision = {
        outcome: "stop",
        steps: [
          ...decision.steps,
          { step: "dispatch", outcome: "stop", reason: "effects-changed", explanation },
        ],
        obligations: [],
        summary: explanation,
      };
      const entry = append(call, stale, "stopped", {
        ...(approvedFrom !== undefined && { settles: approvedFrom }),
      });
      return { status: "stopped", message: explanation, entry: entry.seq };
    }
    // Count a send or payment against the limits before it is attempted, and keep the count if it
    // fails: a failed call may still have reached the recipient or moved the money.
    if (spec.kind === "send" || spec.kind === "pay") {
      const at = clock();
      // Every history that limits this call counts it: the sandbox's own (possibly shared with
      // other runs) and each narrowing mandate's.
      const histories = new Set<Commitment[]>([commitments]);
      for (const extra of options.rules().also ?? [])
        if (extra.history) histories.add(extra.history);
      for (const recipient of ctx.recipients?.length ? ctx.recipients : [spec.system]) {
        const one = Object.freeze({
          at,
          kind: spec.kind,
          recipient,
          ...(ctx.amount !== undefined && {
            amount: Object.freeze({ value: ctx.amount.value, currency: ctx.amount.currency }),
          }),
        });
        for (const h of histories) h.push(one);
      }
    }
    let output: ToolOutput;
    try {
      output = await spec.run(call.args, ctx);
    } catch (e) {
      const entry = append(call, decision, "failed", { note: (e as Error).message });
      return {
        status: "failed",
        message: `The ${spec.title.toLowerCase()} call failed: ${(e as Error).message}`,
        entry: entry.seq,
      };
    }
    const now = clock();
    const purpose = ctx.purpose ?? options.purpose;
    const released: Json[] = [];
    const withheld: StepResult[] = [];
    for (const item of output.items ?? []) {
      const check = evaluate(
        item.label.policy,
        {
          agent: options.agent,
          action: "read",
          target: item.label.id,
          attributes: { purpose, dateTime: new Date(now).toISOString() },
        },
        { now: new Date(now), resolvePartyCollection: groupResolver(directory) },
      );
      if (check.decision === "permit" || mode === "off") {
        released.push(item.content);
        const owned = snapshot(item.label);
        labels.set(labelKey(owned), owned);
      } else
        withheld.push({
          step: "data-read",
          outcome: "stop",
          reason: check.decision === "deny" ? "data:prohibited" : "data:not-permitted",
          explanation: `Withheld "${item.label.title}" (${item.label.category}): its owner's rules do not allow reading it for ${nameOf(directory, purpose)}. ${describePolicy(item.label.policy, directory).join(" ")}`,
          about: item.label.id,
        });
    }
    for (const o of decision.obligations) obligations.push({ ...o });
    // Refused outright only when nothing at all is left to return.
    const allWithheld =
      (output.items?.length ?? 0) > 0 && released.length === 0 && output.content === undefined;
    const finalDecision: GateDecision = withheld.length
      ? {
          ...decision,
          outcome: allWithheld ? "stop" : decision.outcome,
          steps: [...decision.steps, ...withheld],
          summary: allWithheld
            ? (withheld[0]?.explanation ?? decision.summary)
            : `${decision.summary} ${withheld.length} record${withheld.length === 1 ? " was" : "s were"} withheld by ${withheld.length === 1 ? "its" : "their"} own rules.`,
        }
      : decision;
    const entry = append(call, finalDecision, approvedFrom === undefined ? "ran" : "approved", {
      ...(approvedFrom !== undefined && { settles: approvedFrom }),
    });
    const content: Json =
      output.items === undefined
        ? (output.content ?? null)
        : {
            ...(output.content !== undefined && { note: output.content }),
            records: released,
            withheld: withheld.length,
          };
    if (allWithheld) return { status: "stopped", message: finalDecision.summary, entry: entry.seq };
    return { status: "done", content, withheld: withheld.length, entry: entry.seq };
  }

  // One call at a time: limits are checked before a call runs and counted after it, so calls made
  // together (Promise.all in generated code, parallel MCP requests) must not interleave.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  }

  async function call(c: ToolCall): Promise<CallResult> {
    const { spec, ctx, error } = lookup(c);
    if (!spec || !ctx || error) {
      const decision = refusal(spec ? "invalid-args" : "unknown-tool", error ?? "Unknown tool.");
      const entry = append(c, decision, "stopped");
      return { status: "stopped", message: decision.summary, entry: entry.seq };
    }
    const decision = await decideSpec(spec, c.args, ctx);
    if (decision.outcome === "stop") {
      const entry = append(c, decision, "stopped");
      return { status: "stopped", message: decision.summary, entry: entry.seq };
    }
    if (decision.outcome === "review") {
      const entry = append(c, decision, "held");
      heldCounter += 1;
      const id = `approval-${heldCounter}`;
      held.set(id, { id, call: c, decision, entry: entry.seq, at: entry.at, spec, ctx });
      return {
        status: "held",
        approval: id,
        message: `Waiting for a person's approval: ${decision.summary}`,
        entry: entry.seq,
      };
    }
    return run(spec, c, ctx, decision);
  }

  async function approve(id: string, by: string): Promise<CallResult> {
    const h = held.get(id);
    if (!h) throw new Error(`No held call ${id}`);
    held.delete(id);
    // Derive the call's effects again from the systems as they are now. If they differ from what
    // the person was shown (other recipients, amount, region, purpose or records), the approval
    // does not carry over.
    const fresh = lookup(h.call);
    const changed =
      !fresh.ctx || fresh.error || effectsOf(fresh.ctx) !== effectsOf(h.ctx)
        ? (fresh.error ?? "What the call would do has changed since it was held.")
        : undefined;
    if (changed || !fresh.ctx) {
      const explanation = `Approved by ${by}, but not run: ${changed}`;
      const decision: GateDecision = {
        outcome: "stop",
        steps: [{ step: "approval", outcome: "stop", reason: "approval-stale", explanation }],
        obligations: [],
        summary: explanation,
      };
      const entry = append(h.call, decision, "stopped", { settles: h.entry });
      return { status: "stopped", message: decision.summary, entry: entry.seq };
    }
    // Decide and run on the effects the person was shown; run() checks them once more at dispatch.
    const ctx = h.ctx;
    const decision = await decideSpec(h.spec, h.call.args, ctx, true);
    const stamped: GateDecision = {
      ...decision,
      steps: [
        {
          step: "approval",
          outcome: "permit",
          reason: "approved",
          explanation: `Approved by ${by}.`,
        },
        ...decision.steps,
      ],
    };
    if (decision.outcome !== "permit") {
      const entry = append(h.call, stamped, "stopped", { settles: h.entry });
      return {
        status: "stopped",
        message: `Approved by ${by}, but now refused: ${decision.summary}`,
        entry: entry.seq,
      };
    }
    return run(h.spec, h.call, ctx, stamped, h.entry);
  }

  function decline(id: string, by: string): CallResult {
    const h = held.get(id);
    if (!h) throw new Error(`No held call ${id}`);
    held.delete(id);
    const decision: GateDecision = {
      ...h.decision,
      outcome: "stop",
      steps: [
        {
          step: "approval",
          outcome: "stop",
          reason: "declined",
          explanation: `Declined by ${by}.`,
        },
        ...h.decision.steps,
      ],
      summary: `Declined by ${by}.`,
    };
    const entry = append(h.call, decision, "declined", { settles: h.entry });
    return { status: "stopped", message: decision.summary, entry: entry.seq };
  }

  return {
    // Only the policy modes hide tools; "off" and "llm" offer everything (the LLM judge, not the
    // catalogue, is the control being compared in "llm" mode).
    tools: () =>
      catalogue()
        .filter(
          (e) =>
            e.visible ||
            mode === "off" ||
            (mode === "llm" &&
              (options.rules().also ?? []).every(
                (x) => visibility(e.tool, x.mandate, true).visible,
              )),
        )
        .map((e) => e.tool),
    catalogue,
    call: (c) => serial(() => call(c)),
    async decide(c) {
      const { spec, ctx, error } = lookup(c);
      if (!spec || !ctx || error)
        return refusal(spec ? "invalid-args" : "unknown-tool", error ?? "Unknown tool.");
      return decideSpec(spec, c.args, ctx);
    },
    held: () => [...held.values()].map(({ spec: _s, ctx: _c, ...h }) => h),
    approve: (id, by) => serial(() => approve(id, by)),
    decline,
    labels: () => [...labels.values()],
    obligations: () => obligations,
    record,
    mode: () => mode,
    setMode(m) {
      mode = m;
    },
    judge: () => currentJudge,
    setJudge(j) {
      currentJudge = j;
    },
  };
}

export type { OdrlPolicy };
export { AGENT };
