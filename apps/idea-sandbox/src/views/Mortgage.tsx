// AUTHORED-BY Claude Opus 5.5
// The mortgage story: three agents for two organisations, each in its own sandbox, played as
// one trace. Alex's personal agent, Northgate's customer-facing assistant and Northgate's
// internal underwriting agent each answer to their own rules, and Alex's rules travel with
// Alex's data.
import { outcomeOf, verdict } from "@jeswr/agent-sandbox";
import {
  createMortgageWorld,
  MORTGAGE_AGENTS,
  MORTGAGE_STORY,
  type MortgageAgent,
  type MortgageWorld,
  runMortgageStep,
} from "@jeswr/agent-sandbox/world";
import {
  ArrowLeftRight,
  Building2,
  FileCheck2,
  Landmark,
  Lightbulb,
  RotateCcw,
  Send,
  ShieldX,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { type AgentTag, revealIsInstant, Trace, type TraceItem, useReveal } from "../trace.js";

const TAGS: Record<MortgageAgent, AgentTag> = {
  personal: { name: MORTGAGE_AGENTS.personal.name, hue: 160 },
  assistant: { name: MORTGAGE_AGENTS.assistant.name, hue: 250 },
  underwriter: { name: MORTGAGE_AGENTS.underwriter.name, hue: 305 },
};

/** One play-through of the mortgage story. */
export class MortgageSession {
  readonly world: MortgageWorld = createMortgageWorld();
  readonly items: TraceItem[] = [
    { kind: "user", id: "task", text: MORTGAGE_STORY.task, who: MORTGAGE_STORY.askedBy },
  ];
  position = 0;
  busy = false;
  version = 0;
  #listeners = new Set<() => void>();
  subscribe(l: () => void) {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }
  #changed() {
    this.version++;
    for (const l of this.#listeners) l();
  }
  get done() {
    return this.position >= MORTGAGE_STORY.steps.length;
  }

  async step(): Promise<void> {
    const step = MORTGAGE_STORY.steps[this.position];
    if (!step || this.busy) return;
    this.busy = true;
    this.#changed();
    try {
      const { result, decision } = await runMortgageStep(this.world, step);
      const agent = TAGS[step.agent];
      if (step.kind === "approve") {
        // Settle the agent's held call in place, and say who decided.
        const at = this.items.findLastIndex(
          (i) => i.kind === "call" && i.agent === agent && i.result.status === "held" && !i.settled,
        );
        const held = this.items[at];
        if (held?.kind === "call")
          this.items[at] = { ...held, settled: { by: step.by, approved: true, result } };
        this.items.push({
          kind: "notice",
          id: `n${this.position}`,
          text: `${step.by} approved. ${step.why}`,
          tone: "grant",
        });
      } else {
        const tool = this.world.sandboxes[step.agent]
          .catalogue()
          .find((e) => e.tool.name === step.call.tool)?.tool;
        this.items.push(
          { kind: "thinking", id: `t${this.position}`, text: step.thought, agent },
          {
            kind: "call",
            id: `c${this.position}`,
            agent,
            toolName: step.call.tool,
            args: step.call.args,
            result,
            expect: step.expect,
            why: step.why,
            verdict: verdict(step.expect, outcomeOf(result)),
            wantedBy: "Alex and Northgate",
            ...(tool && { tool }),
            ...(decision && { decision }),
          },
        );
      }
      this.position++;
    } finally {
      this.busy = false;
      this.#changed();
    }
  }

  async playAll(delayMs: number): Promise<void> {
    while (!this.done) {
      await this.step();
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export function Mortgage() {
  const [generation, setGeneration] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new play-through on restart.
  const session = useMemo(() => new MortgageSession(), [generation]);
  useSyncExternalStore(
    (l) => session.subscribe(l),
    () => session.version,
  );
  useEffect(() => {
    if (session.position === 0 && !session.busy) void session.playAll(revealIsInstant() ? 0 : 2000);
  }, [session]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt as the session changes.
  const items = useMemo(() => [...session.items], [session, session.version]);
  const { shown, total } = useReveal(items, false);
  const finished = session.done && !session.busy && shown >= total;
  const s = session.world.state;
  return (
    <div className="story-page">
      <div className="story-main">
        <header className="page-head">
          <span className="page-icon">
            <Landmark size={22} aria-hidden="true" />
          </span>
          <div className="page-title">
            <h1>{MORTGAGE_STORY.title}</h1>
            <p className="hint">
              <UserRound size={13} aria-hidden="true" /> Asked by {MORTGAGE_STORY.askedBy} · a
              personal agent, a customer-facing agent and an internal agent
            </p>
          </div>
          <button type="button" disabled={session.busy} onClick={() => setGeneration((g) => g + 1)}>
            <RotateCcw size={15} aria-hidden="true" /> Play again
          </button>
        </header>
        <AgentMap />
        <div className="timeline" aria-live="polite">
          <Trace items={items} busy={session.busy} />
        </div>
        {finished && (
          <div className="lesson">
            <Lightbulb size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">What this shows</span>
              <p>{MORTGAGE_STORY.lesson}</p>
            </div>
          </div>
        )}
      </div>
      <aside className="world" aria-label="What happened">
        <h2>What happened</h2>
        <div className="panel-block">
          <span className="eyebrow">Northgate holds</span>
          {s.received.length === 0 ? (
            <p className="hint">Nothing from Alex yet.</p>
          ) : (
            <ul className="plain">
              {s.received.map((k) => (
                <li key={k}>
                  <FileCheck2 size={13} aria-hidden="true" /> Alex's {k}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel-block">
          <span className="eyebrow">Shared with Homecover Insurance</span>
          <p className={s.partnerShares.length ? "bad" : "hint"}>
            {s.partnerShares.length ? `${s.partnerShares.length} shares` : "Nothing."}
          </p>
        </div>
        <div className="panel-block">
          <span className="eyebrow">Offers</span>
          {s.offers.length === 0 ? (
            <p className="hint">None yet.</p>
          ) : (
            <ul className="plain">
              {s.offers.map((o, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list.
                <li key={i}>
                  £{o.amount.toLocaleString("en-GB")} at {o.rate}% over {o.years} years
                  {o.accepted ? ", accepted" : ", waiting for Alex"}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel-block">
          <span className="eyebrow">Alex is told</span>
          <ul className="plain">
            {session.world.sandboxes.personal.obligations().length === 0 ? (
              <li className="hint">Nothing shared yet.</li>
            ) : (
              <li>
                <Send size={13} aria-hidden="true" /> Each time the agent shares Alex's records (
                {session.world.sandboxes.personal.obligations().length} so far)
              </li>
            )}
          </ul>
        </div>
      </aside>
    </div>
  );
}

/** Who is involved, and whose rules each agent answers to. */
function AgentMap() {
  return (
    <section className="agent-map" aria-label="The agents">
      <div className="org">
        <span className="org-name">
          <UserRound size={14} aria-hidden="true" /> Alex Morgan
        </span>
        <AgentCard who="personal" />
      </div>
      <ArrowLeftRight size={18} className="agent-map-arrow" aria-hidden="true" />
      <div className="org">
        <span className="org-name">
          <Building2 size={14} aria-hidden="true" /> Northgate Building Society
        </span>
        <div className="org-agents">
          <AgentCard who="assistant" />
          <AgentCard who="underwriter" />
        </div>
      </div>
      <div className="org outsider">
        <span className="org-name">
          <ShieldX size={14} aria-hidden="true" /> Homecover Insurance
        </span>
        <span className="hint">A Northgate partner</span>
      </div>
    </section>
  );
}

function AgentCard({ who }: { who: MortgageAgent }) {
  const a = MORTGAGE_AGENTS[who];
  return (
    <span className="agent-card" style={{ "--hue": TAGS[who].hue } as React.CSSProperties}>
      <strong>{a.name}</strong>
      <span className="hint">
        {a.role} · rules from {a.org}
      </span>
    </span>
  );
}
