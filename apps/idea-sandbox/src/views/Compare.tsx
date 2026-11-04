// AUTHORED-BY Claude Opus 5.5
import { compareModes, type EnforcementMode, type Score } from "@jeswr/agent-sandbox";
import { SCENARIOS } from "@jeswr/agent-sandbox/world";
import { useState } from "react";
import { MODES, type Shared } from "../App.js";
import { Section } from "../components.js";

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
    </div>
  );
}
