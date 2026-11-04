// AUTHORED-BY Claude Opus 5.5
import { createWorldSandbox, type GateDecision } from "@jeswr/agent-sandbox";
import { type CodeRun, runCode } from "@jeswr/agent-sandbox/code";
import { scenario } from "@jeswr/agent-sandbox/world";
import { useState } from "react";
import { ModePicker, type Shared } from "../App.js";
import { Chip, Json, outcomeOfResult, Section, Steps } from "../components.js";

const STORY = scenario("generated-script");

export function CodeBox({ shared }: { shared: Shared }) {
  const [code, setCode] = useState(STORY.code ?? "");
  const [run, setRun] = useState<{ result: CodeRun; decisions: (GateDecision | undefined)[] }>();
  const [busy, setBusy] = useState(false);

  async function execute() {
    setBusy(true);
    try {
      const { sandbox, world, clock } = createWorldSandbox(STORY, {
        mode: shared.mode,
        judge: shared.judge,
      });
      world.setSettings(shared.settings);
      const result = await runCode(sandbox, code, { onCall: () => (clock.now += 60_000) });
      const entries = sandbox.record.entries();
      setRun({
        result,
        decisions: result.calls.map((c) =>
          "entry" in c.result ? entries[c.result.entry]?.decision : undefined,
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <Section
        title="Code the agent wrote"
        intro={
          <>
            Agents increasingly write and run their own code. Here the code runs in a sealed box
            (QuickJS compiled to WebAssembly) with no network, no files and no timers. Its only way
            out is <code>tools.&lt;name&gt;(…)</code>, and each of those calls goes through exactly
            the same checks as any other action. Edit the script and try to get round the rules.
          </>
        }
      >
        <div className="card">
          <p className="task-text">
            “{STORY.task}” <span className="hint">({STORY.askedBy})</span>
          </p>
          <textarea
            className="code"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Agent script"
          />
          <div className="controls">
            <button type="button" className="primary" disabled={busy} onClick={execute}>
              {busy ? "Running…" : "Run in the box"}
            </button>
            <button type="button" onClick={() => setCode(STORY.code ?? "")}>
              Restore the agent's script
            </button>
          </div>
          <ModePicker shared={shared} compact />
        </div>
      </Section>
      {run && (
        <Section title="What happened">
          <div className="card">
            <h3>Script output</h3>
            {run.result.error && (
              <p className="bad">The box stopped the script: {run.result.error}</p>
            )}
            <pre className="log">{run.result.logs.join("\n") || "(nothing logged)"}</pre>
          </div>
          <ol className="timeline">
            {run.result.calls.map((c, i) => {
              const d = run.decisions[i];
              const outcome = c.result.status === "refused" ? "stop" : outcomeOfResult(c.result);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: calls are an ordered log.
                <li key={i} className={`call call-${outcome}`}>
                  <div className="call-head">
                    <p className="call-tool">
                      <code>tools.{c.tool}</code>
                    </p>
                    <Chip outcome={outcome} />
                  </div>
                  <p className="summary">
                    {c.result.status === "done" ? (d?.summary ?? "") : c.result.message}
                  </p>
                  <details>
                    <summary>Why? See every check</summary>
                    {d && <Steps decision={d} />}
                    <Json value={c.args} />
                  </details>
                </li>
              );
            })}
          </ol>
        </Section>
      )}
    </div>
  );
}
