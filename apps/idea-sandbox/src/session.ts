// AUTHORED-BY Claude Opus 5.5
// One play-through of a story: a fresh simulated world, a sandbox around its tools, and the
// timeline people see. Settings and mode changes apply to the live sandbox at once (the gate
// reads the rules afresh on every call).
import {
  type AgentEvent,
  type AgentModel,
  agentSystemPrompt,
  type CallResult,
  createWorldSandbox,
  type DemoClock,
  type EnforcementMode,
  type GateDecision,
  type JudgeModel,
  outcomeOf,
  runAgent,
  type Sandbox,
  type Verdict,
  verdict,
} from "@jeswr/agent-sandbox";
import type { Expectation, RuleSettings, Scenario, World } from "@jeswr/agent-sandbox/world";

/** One row of the timeline. */
export type TimelineItem =
  | {
      readonly kind: "call";
      readonly id: number;
      readonly note: string;
      readonly tool: string;
      readonly args: unknown;
      result: CallResult;
      decision?: GateDecision;
      readonly expect?: Expectation;
      readonly why?: string;
      verdict?: Verdict;
      /** For a held call: what happened when a person answered. */
      settled?: { by: string; approved: boolean; result: CallResult; decision?: GateDecision };
    }
  | {
      readonly kind: "notice";
      readonly id: number;
      readonly text: string;
      readonly tone: "grant" | "revoke" | "info";
    }
  | { readonly kind: "say"; readonly id: number; readonly text: string };

/** A live play-through. */
export class Session {
  readonly world: World;
  readonly sandbox: Sandbox;
  readonly clock: DemoClock;
  readonly items: TimelineItem[] = [];
  position = 0;
  busy = false;
  #listeners = new Set<() => void>();
  #id = 0;

  constructor(
    readonly scenario: Scenario,
    mode: EnforcementMode,
    settings: RuleSettings,
    judge: JudgeModel,
  ) {
    const made = createWorldSandbox(scenario, { mode, judge });
    this.world = made.world;
    this.sandbox = made.sandbox;
    this.clock = made.clock;
    this.world.setSettings(settings);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  changed(): void {
    for (const l of this.#listeners) l();
  }

  get done(): boolean {
    return this.position >= this.scenario.steps.length;
  }

  #decision(result: CallResult): GateDecision | undefined {
    return this.sandbox.record.entries()[result.entry]?.decision;
  }

  /** Play the next scripted step. */
  async step(): Promise<void> {
    if (this.busy || this.done) return;
    const step = this.scenario.steps[this.position];
    if (!step) return;
    this.busy = true;
    this.changed();
    this.clock.now += 60_000;
    try {
      if (step.kind === "grant") {
        this.world.setGrants([
          ...this.world.grants().filter((g) => g.id !== step.grant.id),
          step.grant,
        ]);
        this.items.push({
          kind: "notice",
          id: this.#id++,
          text: `${step.note}. ${step.grant.description}`,
          tone: "grant",
        });
      } else if (step.kind === "revoke") {
        this.world.setGrants(this.world.grants().filter((g) => g.id !== step.grant));
        this.items.push({
          kind: "notice",
          id: this.#id++,
          text: `${step.note}. From now on the rules are as they were.`,
          tone: "revoke",
        });
      } else {
        const result = await this.sandbox.call(step.call);
        const decision = this.#decision(result);
        this.items.push({
          kind: "call",
          id: this.#id++,
          note: step.note,
          tool: step.call.tool,
          args: step.call.args,
          result,
          expect: step.expect,
          why: step.why,
          verdict: verdict(step.expect, outcomeOf(result)),
          ...(decision && { decision }),
        });
      }
      this.position++;
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  async playAll(delayMs = 350): Promise<void> {
    while (!this.done) {
      await this.step();
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  /** A person answers a held call. */
  async answer(
    item: Extract<TimelineItem, { kind: "call" }>,
    approved: boolean,
    by: string,
  ): Promise<void> {
    if (item.result.status !== "held" || item.settled) return;
    this.clock.now += 60_000;
    const result = approved
      ? await this.sandbox.approve(item.result.approval, by)
      : this.sandbox.decline(item.result.approval, by);
    const decision = this.#decision(result);
    item.settled = { by, approved, result, ...(decision && { decision }) };
    this.changed();
  }

  /** Give the task to a live model instead of the script. */
  async runLive(model: AgentModel): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.position = this.scenario.steps.length;
    this.items.push({
      kind: "notice",
      id: this.#id++,
      text: `${model.name} is now doing the task, live. Every call it makes goes through the same checks.`,
      tone: "info",
    });
    this.changed();
    try {
      await runAgent(
        this.sandbox,
        model,
        {
          system: agentSystemPrompt("Harbour & Finch", "Finch Assist"),
          task: this.scenario.task,
          maxTurns: 14,
        },
        (e: AgentEvent) => {
          this.clock.now += 60_000;
          if (e.kind === "say") this.items.push({ kind: "say", id: this.#id++, text: e.text });
          else if (e.kind === "call") {
            const decision = this.#decision(e.result);
            this.items.push({
              kind: "call",
              id: this.#id++,
              note: "The live model's own choice",
              tool: e.call.tool,
              args: e.call.args,
              result: e.result,
              ...(decision && { decision }),
            });
          } else if (e.reason !== "done")
            this.items.push({
              kind: "notice",
              id: this.#id++,
              text: e.message ?? "The live run ended.",
              tone: "info",
            });
          this.changed();
        },
      );
    } finally {
      this.busy = false;
      this.changed();
    }
  }
}
