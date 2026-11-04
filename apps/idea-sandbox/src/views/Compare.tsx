// AUTHORED-BY Claude Opus 5.5
import {
  checkPaths,
  compareModes,
  ENFORCEMENT_PATHS,
  type EnforcementMode,
  type EnforcementPath,
  type PathCheck,
  type Score,
} from "@jeswr/agent-sandbox";
import { SCENARIOS } from "@jeswr/agent-sandbox/world";
import { useState } from "react";
import { MODES, type Shared } from "../App.js";
import { Chip, Section } from "../components.js";

const STORIES = SCENARIOS.filter((s) => !s.code);

export function Compare({ shared }: { shared: Shared }) {
  const [scores, setScores] = useState<Record<string, Score>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [judgeName, setJudgeName] = useState<string>();

  async function run() {
    setBusy(true);
    setError(undefined);
    try {
      setScores(
        await compareModes(
          STORIES,
          MODES.map((m) => m.id),
          shared.judge,
        ),
      );
      setJudgeName(shared.judge.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const total = STORIES.reduce((n, s) => n + s.steps.filter((x) => x.kind === "call").length, 0);
  return (
    <div className="page">
      <Section
        title="Compare who decides"
        intro={`Every story is played in each mode: ${STORIES.length} stories and ${total} agent actions. Each action is scored against what Harbour & Finch wants. "Let through" means something went ahead that should have been stopped or checked by a person; "blocked needlessly" means a harmless action was stopped or held.`}
      >
        <div className="card">
          <div className="controls">
            <button type="button" className="primary" disabled={busy} onClick={run}>
              {busy ? "Playing every story…" : "Run the comparison"}
            </button>
            <span className="hint">
              AI modes use{" "}
              {shared.judgeIsModel
                ? "Claude Haiku 5.5 (your key; this makes real API calls)"
                : "the keyword stand-in, which is not a model. Add a key under Stories → Live AI for a real comparison"}
              .
            </span>
          </div>
          {error && <p className="bad">{error}</p>}
        </div>
        {scores && (
          <div className="card">
            <table className="scores">
              <thead>
                <tr>
                  <th scope="col">Who decides</th>
                  <th scope="col">Right</th>
                  <th scope="col">Let through</th>
                  <th scope="col">Blocked needlessly</th>
                  <th scope="col">Stop vs review mix-up</th>
                  <th scope="col" className="bar-col">
                    Share right
                  </th>
                </tr>
              </thead>
              <tbody>
                {MODES.map((m) => {
                  const s = scores[m.id as EnforcementMode];
                  if (!s) return null;
                  const pct = Math.round((100 * s.right) / Math.max(1, s.calls));
                  return (
                    <tr key={m.id}>
                      <th scope="row">{m.label}</th>
                      <td>{s.right}</td>
                      <td className={s.letThrough ? "bad" : ""}>{s.letThrough}</td>
                      <td className={s.overBlocked ? "warn" : ""}>{s.overBlocked}</td>
                      <td>{s.different}</td>
                      <td className="bar-col">
                        <span className="bar">
                          <span className="bar-fill" style={{ width: `${pct}%` }} />
                        </span>
                        {pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="hint">
              AI modes judged by: {judgeName}. Model answers vary between runs; the rules-as-code
              row is the same every time. Rules alone miss the marketing pitch hidden in a support
              email (they can only check what they are told); a model reading the message catches
              it, and the rules then decide.
            </p>
          </div>
        )}
      </Section>
      <Routes />
    </div>
  );
}

const ROUTE_LABEL: Record<EnforcementPath, string> = {
  direct: "Tool call",
  code: "Code it wrote",
  mcp: "MCP client",
};

/** Every refused or held action, tried again by each route an agent has to the systems. */
function Routes() {
  const [checks, setChecks] = useState<PathCheck[]>();
  const [busy, setBusy] = useState(false);
  const titleOf = (id: string) => STORIES.find((s) => s.id === id)?.title ?? id;
  async function run() {
    setBusy(true);
    try {
      setChecks(await checkPaths(STORIES));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      title="Is there a way round?"
      intro="An agent can reach the same systems by more than one route: an ordinary tool call, code it writes and runs, or an MCP client. Every action the stories want stopped or held is tried again by each route, with the rules as code deciding. Each route must give the same answer."
    >
      <div className="card">
        <div className="controls">
          <button type="button" className="primary" disabled={busy} onClick={run}>
            {busy ? "Trying every route…" : "Try every route"}
          </button>
        </div>
        {checks && (
          <>
            <p>
              {checks.filter((c) => c.holds).length} of {checks.length} actions gave the same answer
              by every route, and none of those got through.
            </p>
            <table className="scores">
              <thead>
                <tr>
                  <th scope="col">Story and action</th>
                  {ENFORCEMENT_PATHS.map((p) => (
                    <th key={p} scope="col">
                      {ROUTE_LABEL[p]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={`${c.scenario}-${c.step}`}>
                    <th scope="row">
                      {c.step}
                      <span className="hint"> ({titleOf(c.scenario)})</span>
                    </th>
                    {ENFORCEMENT_PATHS.map((p) => (
                      <td key={p}>
                        <Chip outcome={c.outcomes[p]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              {checks.every((c) => new Set(Object.values(c.outcomes)).size === 1)
                ? "No route behaves differently from the others."
                : "Some routes gave different answers: that is a way round the rules."}{" "}
              Where every route says "Allowed", the rules themselves let the action through (the
              sales pitch in a support email, which only rules plus AI catch).
            </p>
          </>
        )}
      </div>
    </Section>
  );
}
