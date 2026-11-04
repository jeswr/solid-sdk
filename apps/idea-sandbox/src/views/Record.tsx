// AUTHORED-BY Claude Opus 5.5
import { DecisionRecord, type RecordEntry } from "@jeswr/agent-sandbox";
import { useState } from "react";
import type { Shared } from "../App.js";
import { Chip, Section } from "../components.js";
import { currentSession } from "./Stories.js";

const short = (hash: string) => hash.replace("sha-256:", "").slice(0, 12);

export function Record(_: { shared: Shared }) {
  const session = currentSession();
  const [tampered, setTampered] = useState<readonly RecordEntry[]>();
  const entries = session?.sandbox.record.entries() ?? [];
  const shown = tampered ?? entries;
  const broken = DecisionRecord.verify(shown);
  return (
    <div className="page">
      <Section
        title="Audit log"
        intro="Every decision is written to a log before anything runs: what was asked, what was decided and why, and a fingerprint of the rules in force. Each entry includes the fingerprint (SHA-256) of the one before, so changing any past entry breaks every fingerprint after it. The agent can add to the log but has no way to change it. In this demo the log lives in your browser; a real deployment would also sign it or keep a copy elsewhere, so that whoever holds the log cannot rewrite it unnoticed either."
      >
        {!session || entries.length === 0 ? (
          <div className="card">
            <p className="hint">Play a story first; its log appears here.</p>
          </div>
        ) : (
          <>
            <div className="card controls">
              <span className={broken === undefined ? "good" : "bad"}>
                {broken === undefined
                  ? `✓ All ${shown.length} entries check out.`
                  : `✕ The log has been changed: entry ${broken} no longer matches its fingerprint.`}
              </span>
              {tampered ? (
                <button type="button" onClick={() => setTampered(undefined)}>
                  Undo the change
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setTampered(
                      entries.map((e, i) =>
                        i === 0
                          ? {
                              ...e,
                              result: e.result === "stopped" ? "ran" : "stopped",
                              decision: { ...e.decision, summary: "(edited)" },
                            }
                          : e,
                      ),
                    )
                  }
                >
                  Try to rewrite the first entry
                </button>
              )}
              <span className="hint">Story: {session.scenario.title}</span>
            </div>
            <div className="card">
              <table className="log-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Time</th>
                    <th scope="col">Action</th>
                    <th scope="col">Decision</th>
                    <th scope="col">Why</th>
                    <th scope="col">Fingerprint</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => (
                    <tr
                      key={e.seq}
                      className={broken !== undefined && e.seq >= broken ? "broken" : ""}
                    >
                      <td>{e.seq}</td>
                      <td>{e.at.slice(11, 16)}</td>
                      <td>
                        <code>{e.tool}</code>
                        <span className="hint"> {e.mode}</span>
                      </td>
                      <td>
                        <Chip
                          outcome={
                            e.result === "held"
                              ? "review"
                              : e.result === "stopped" || e.result === "declined"
                                ? "stop"
                                : "permit"
                          }
                        >
                          {e.result}
                        </Chip>
                        {e.settles !== undefined && (
                          <span className="hint"> answers #{e.settles}</span>
                        )}
                      </td>
                      <td>{e.decision.summary}</td>
                      <td>
                        <code title={`previous ${e.previous}`}>{short(e.hash)}</code>
                        <span className="hint"> ← {short(e.previous)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
