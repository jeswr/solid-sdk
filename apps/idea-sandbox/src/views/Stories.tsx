// AUTHORED-BY Claude Opus 5.5
// A story, played as the agent's live trace: what it is thinking, each action it tries, and
// the policy check that passes, holds or blocks it.
import { type Args, nameOf } from "@jeswr/agent-sandbox";
import { DIRECTORY } from "@jeswr/agent-sandbox/world";
import { Bot, Lightbulb, Play, RotateCcw, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModePicker, type Shared } from "../App.js";
import { AGENT_MODELS, claudeAgent } from "../claude.js";
import { STORY_ICONS } from "../icons.js";
import type { Session } from "../session.js";
import { THOUGHTS } from "../thoughts.js";
import { revealIsInstant, Trace, type TraceItem, useReveal } from "../trace.js";

const APPROVER = "Priya Shah (support lead)";

/** The session's timeline as a trace, with the agent's thinking before each action. */
export function storyTrace(session: Session): TraceItem[] {
  const out: TraceItem[] = [
    { kind: "user", id: "task", text: session.scenario.task, who: session.scenario.askedBy },
  ];
  for (const item of session.items) {
    if (item.kind === "notice") out.push({ ...item, id: `n${item.id}` });
    else if (item.kind === "say") out.push({ kind: "say", id: `s${item.id}`, text: item.text });
    else {
      const thought = THOUGHTS[item.note];
      if (thought || item.note !== "The live model's own choice")
        out.push({ kind: "thinking", id: `t${item.id}`, text: thought ?? item.note });
      const tool = session.sandbox.catalogue().find((e) => e.tool.name === item.tool)?.tool;
      out.push({
        kind: "call",
        id: `c${item.id}`,
        toolName: item.tool,
        args: item.args as Args,
        result: item.result,
        ...(tool && { tool }),
        ...(item.decision && { decision: item.decision }),
        ...(item.expect && { expect: item.expect }),
        ...(item.why && { why: item.why }),
        ...(item.verdict && { verdict: item.verdict }),
        ...(item.settled && { settled: item.settled }),
        ...(item.result.status === "held" &&
          !item.settled && {
            answer: (approved: boolean) => void session.answer(item, approved, APPROVER),
          }),
      });
    }
  }
  return out;
}

export function Stories({ shared }: { shared: Shared }) {
  const { session, restart } = shared;
  const story = session.scenario;
  const StoryIcon = STORY_ICONS[story.id] ?? Bot;
  // Start playing as soon as the story opens.
  useEffect(() => {
    if (session.position === 0 && !session.busy && session.items.length === 0)
      void session.playAll(revealIsInstant() ? 0 : 2000);
  }, [session]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt whenever the session changes.
  const items = useMemo(() => storyTrace(session), [session, session.items.length, shared.version]);
  const { shown, total } = useReveal(items, false);
  const finished = session.done && !session.busy && shown >= total;
  return (
    <div className="story-page">
      <div className="story-main">
        <header className="page-head">
          <span className="page-icon">
            <StoryIcon size={22} aria-hidden="true" />
          </span>
          <div className="page-title">
            <h1>{story.title}</h1>
            <p className="hint">
              <UserRound size={13} aria-hidden="true" /> Asked by {story.askedBy} · for{" "}
              {nameOf(DIRECTORY, story.purpose)}
            </p>
          </div>
          <button type="button" disabled={session.busy} onClick={restart}>
            {session.items.length === 0 ? (
              <>
                <Play size={15} aria-hidden="true" /> Play
              </>
            ) : (
              <>
                <RotateCcw size={15} aria-hidden="true" /> Play again
              </>
            )}
          </button>
        </header>
        <ModePicker shared={shared} compact />
        <div className="timeline" aria-live="polite">
          <Trace items={items} busy={session.busy} />
        </div>
        {finished && (
          <div className="lesson">
            <Lightbulb size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">What this shows</span>
              <p>{story.lesson}</p>
            </div>
          </div>
        )}
        <LiveAi shared={shared} session={session} />
      </div>
      <WorldPanel session={session} />
    </div>
  );
}

function WorldPanel({ session }: { session: Session }) {
  const { state } = session.world;
  const labels = session.sandbox.labels();
  const duties = session.sandbox.obligations();
  return (
    <aside className="world" aria-label="What happened">
      <h2>What actually happened</h2>
      <div className="card">
        <h3>Emails sent ({state.outbox.length})</h3>
        {state.outbox.length === 0 ? (
          <p className="hint">None yet.</p>
        ) : (
          <ul className="plain">
            {state.outbox.map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list.
              <li key={i}>
                <strong>{m.to.join(", ")}</strong>: {m.subject}
              </li>
            ))}
          </ul>
        )}
        {state.chat.length > 0 && (
          <>
            <h3>Team chat</h3>
            <ul className="plain">
              {state.chat.map((m, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list.
                <li key={i}>{m.message}</li>
              ))}
            </ul>
          </>
        )}
        {state.refunds.length > 0 && (
          <>
            <h3>Money paid out</h3>
            <ul className="plain">
              {state.refunds.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list.
                <li key={i} className={r.to.includes("FAKE") ? "bad" : ""}>
                  £{r.amount} to{" "}
                  {r.to.includes("FAKE") ? "an unknown account" : `${r.customer}'s account`}
                </li>
              ))}
            </ul>
          </>
        )}
        {state.uploads.length > 0 && (
          <>
            <h3>Sent to InsightPro AI (US)</h3>
            <ul className="plain">
              {state.uploads.map((u, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list.
                <li key={i} className="bad">
                  {u.records} lines of data
                </li>
              ))}
            </ul>
          </>
        )}
        <h3>Production orders table</h3>
        <p className={state.dbRows.length < 3 ? "bad" : "hint"}>
          {state.dbRows.length} of 3 rows left{state.dbRows.length < 3 ? ": data was deleted" : ""}.
        </p>
      </div>
      <div className="card">
        <h3>Records the agent has seen</h3>
        <p className="hint">Their rules now travel with anything the agent sends.</p>
        {labels.length === 0 ? (
          <p className="hint">None yet.</p>
        ) : (
          <ul className="labels">
            {labels.map((l) => (
              <li key={l.id}>
                <span className="label-cat">{l.category}</span> {l.title}
              </li>
            ))}
          </ul>
        )}
      </div>
      {duties.length > 0 && (
        <div className="card">
          <h3>Duties the agent now owes</h3>
          <ul className="plain">
            {duties.map((d, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list.
              <li key={i}>{d.explanation}</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function LiveAi({ shared, session }: { shared: Shared; session: Session }) {
  const [model, setModel] = useState<string>(AGENT_MODELS[0].id);
  return (
    <details className="live card">
      <summary>
        <strong>Live AI</strong>{" "}
        <span className="hint">Give this task to Claude instead of the script.</span>
      </summary>
      {shared.apiKey ? (
        <div className="controls">
          <label>
            Model{" "}
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {AGENT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            disabled={session.busy}
            onClick={() => session.runLive(claudeAgent(shared.apiKey, model))}
          >
            Run this task live
          </button>
        </div>
      ) : (
        <p className="hint">
          Add your own Anthropic API key in{" "}
          <button type="button" className="text-button" onClick={shared.openSettings}>
            Settings
          </button>{" "}
          to run this task with Claude.
        </p>
      )}
    </details>
  );
}
