// AUTHORED-BY Claude Opus 5.5
import { nameOf } from "@jeswr/agent-sandbox";
import { DIRECTORY, scenario as findScenario, SCENARIOS } from "@jeswr/agent-sandbox/world";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ModePicker, type Shared } from "../App.js";
import { AGENT_MODELS, claudeAgent } from "../claude.js";
import { Chip, Json, OUTCOME_LABEL, OUTCOME_TEXT, outcomeOfResult, Steps } from "../components.js";
import { Session, type TimelineItem } from "../session.js";

/** The live session for the chosen story; rebuilt when the story changes or on restart. */
export function useSession(shared: Shared) {
  const [generation, setGeneration] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new session starts only on story change or restart.
  const session = useMemo(
    () => new Session(findScenario(shared.storyId), shared.mode, shared.settings, shared.judge),
    [shared.storyId, generation],
  );
  useEffect(() => session.world.setSettings(shared.settings), [session, shared.settings]);
  useEffect(() => session.sandbox.setMode(shared.mode), [session, shared.mode]);
  useSyncExternalStore(
    (l) => session.subscribe(l),
    () =>
      `${session.items.length}:${session.position}:${session.busy}:${session.items.filter((i) => i.kind === "call" && i.settled).length}`,
  );
  return { session, restart: () => setGeneration((g) => g + 1) };
}

let sharedSession: Session | undefined;
/** The most recent session (the audit log view reads it). */
export const currentSession = () => sharedSession;

export function Stories({ shared }: { shared: Shared }) {
  const { session, restart } = useSession(shared);
  sharedSession = session;
  const story = session.scenario;
  return (
    <div className="stories">
      <aside className="story-list" aria-label="Stories">
        <h2>Stories</h2>
        {SCENARIOS.filter((s) => !s.code).map((s) => (
          <button
            type="button"
            key={s.id}
            className={s.id === story.id ? "story active" : "story"}
            onClick={() => shared.setStoryId(s.id)}
          >
            <span className="story-title">{s.title}</span>
            <span className="hint">{s.summary}</span>
          </button>
        ))}
        <p className="hint">The code box story is under "Code box".</p>
      </aside>

      <div className="story-main">
        <div className="task card">
          <div className="task-head">
            <span className="eyebrow">Task from {story.askedBy}</span>
            <span className="purpose">Purpose: {nameOf(DIRECTORY, story.purpose)}</span>
          </div>
          <p className="task-text">“{story.task}”</p>
          <div className="controls">
            <button
              type="button"
              className="primary"
              disabled={session.busy || session.done}
              onClick={() => session.step()}
            >
              {session.position === 0 ? "Start" : "Next step"}
            </button>
            <button
              type="button"
              disabled={session.busy || session.done}
              onClick={() => session.playAll()}
            >
              Play all
            </button>
            <button type="button" disabled={session.busy} onClick={restart}>
              Start again
            </button>
            <span className="hint">
              Step {Math.min(session.position, story.steps.length)} of {story.steps.length}
            </span>
          </div>
          <ModePicker shared={shared} compact />
        </div>

        <ol className="timeline" aria-live="polite">
          {session.items.map((item) => (
            <Row key={item.id} item={item} session={session} />
          ))}
        </ol>

        {session.done && (
          <div className="lesson card">
            <span className="eyebrow">What this shows</span>
            <p>{story.lesson}</p>
          </div>
        )}

        <LiveAi shared={shared} session={session} />
      </div>

      <WorldPanel session={session} />
    </div>
  );
}

function Row({ item, session }: { item: TimelineItem; session: Session }) {
  if (item.kind === "notice")
    return (
      <li className={`notice notice-${item.tone}`}>
        <span aria-hidden="true">
          {item.tone === "grant" ? "🔑" : item.tone === "revoke" ? "↩" : "ℹ"}
        </span>{" "}
        {item.text}
      </li>
    );
  if (item.kind === "say")
    return (
      <li className="say">
        <span className="eyebrow">The agent says</span>
        <p>{item.text}</p>
      </li>
    );
  const outcome = outcomeOfResult(item.result);
  const tool = session.sandbox.catalogue().find((e) => e.tool.name === item.tool)?.tool;
  const shadow = item.decision?.shadow;
  return (
    <li className={`call call-${outcome}`}>
      <div className="call-head">
        <div>
          <span className="eyebrow">The agent tries to</span>
          <p className="call-note">{item.note}</p>
          <p className="call-tool">
            <code>{item.tool}</code> {tool && <span className="hint">({tool.title})</span>}
          </p>
        </div>
        <div className="call-outcome">
          <Chip outcome={outcome} />
          {shadow && shadow !== outcome && (
            <span className="shadow">
              Rules as code would say: <Chip outcome={shadow} />
            </span>
          )}
        </div>
      </div>
      <p className="summary">
        <strong>{OUTCOME_TEXT[outcome]}.</strong>{" "}
        {item.result.status === "done" ? (item.decision?.summary ?? "") : item.result.message}
      </p>
      {item.expect && (
        <p className={`expect expect-${item.verdict}`}>
          {item.verdict === "right"
            ? "✓ What Harbour & Finch wants."
            : `✕ Harbour & Finch wants “${OUTCOME_LABEL[item.expect]}”.`}{" "}
          <span className="hint">{item.why}</span>
        </p>
      )}
      {item.result.status === "held" && !item.settled && (
        <div className="approval">
          <span>Priya Shah (support lead) is asked to decide:</span>
          <button
            type="button"
            className="primary"
            onClick={() => session.answer(item, true, "Priya Shah (support lead)")}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => session.answer(item, false, "Priya Shah (support lead)")}
          >
            Decline
          </button>
        </div>
      )}
      {item.settled && (
        <p className="settled">
          {item.settled.approved ? "Approved" : "Declined"} by {item.settled.by}.{" "}
          {item.settled.result.status === "done"
            ? "It then went ahead."
            : item.settled.result.status === "stopped" && item.settled.approved
              ? item.settled.result.message
              : ""}
        </p>
      )}
      <details>
        <summary>Why? See every check</summary>
        {item.decision && <Steps decision={item.decision} />}
        <span className="eyebrow">What the agent asked for</span>
        <Json value={item.args} />
        {item.result.status === "done" && (
          <>
            <span className="eyebrow">What the agent got back</span>
            <Json value={item.result.content} />
          </>
        )}
      </details>
    </li>
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
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<string>(AGENT_MODELS[0].id);
  return (
    <details className="live card">
      <summary>
        <strong>Live AI</strong>{" "}
        <span className="hint">Give this task to Claude instead of the script.</span>
      </summary>
      <p className="hint">
        Use your own Anthropic API key. It is kept only in this browser tab and sent only to
        api.anthropic.com. With a key, the "AI judge" and "Rules + AI" modes also use Claude (Haiku
        5.5) instead of the keyword stand-in.
      </p>
      {shared.apiKey ? (
        <div className="controls">
          <span>Key added.</span>
          <button type="button" onClick={() => shared.setApiKey("")}>
            Remove key
          </button>
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
        <form
          className="controls"
          onSubmit={(e) => {
            e.preventDefault();
            shared.setApiKey(draft.trim());
            setDraft("");
          }}
        >
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            aria-label="Anthropic API key"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" disabled={!draft.trim()}>
            Use key
          </button>
        </form>
      )}
    </details>
  );
}
