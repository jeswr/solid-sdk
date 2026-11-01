// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import Link from "next/link";
import { isLoaded } from "../lib/client";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { readAudit, readControl } from "../lib/readers";
import { createAgentVerifier } from "../lib/verify";
import { DetailScreen, QueryRows, Screen } from "./states";
export function ActivityScreen({ seq }: { seq?: string }) {
  const { client, session } = useAgentWorkspace();
  const query = useAgentQuery(client.paths.audit, readAudit);
  const controls = useAgentQuery(session.storageUrl, (c) =>
    readControl(c, createAgentVerifier(session)),
  );
  const selected =
    query.status === "ready" && seq !== undefined
      ? {
          ...query,
          data: query.data.filter((row) => !isLoaded(row) || String(row.record.seq) === seq),
        }
      : query;
  const content = (
    <QueryRows query={selected} empty="No activity yet">
      {(rows) => (
        <ol className="agent-list">
          {rows
            .filter((row) => seq === undefined || String(row.seq) === seq)
            .map((row) => (
              <li className="agent-card" key={row.id}>
                <h2>{String(row.record.summary ?? row.record.type)}</h2>
                <p>
                  <time dateTime={row.at}>{new Date(row.at).toLocaleString()}</time> · Record{" "}
                  {row.seq}
                </p>
                {seq === undefined ? (
                  <Link href={`/agent/activity/${row.seq}`}>View activity record {row.seq}</Link>
                ) : (
                  <>
                    <p>Chain verification is coming soon.</p>
                    <details>
                      <summary>Technical details</summary>
                      <dl>
                        <dt>Previous hash</dt>
                        <dd>{row.prev}</dd>
                        <dt>Entry hash</dt>
                        <dd>{row.hash}</dd>
                      </dl>
                      <pre>{JSON.stringify(row.record, null, 2)}</pre>
                    </details>
                  </>
                )}
              </li>
            ))}
        </ol>
      )}
    </QueryRows>
  );
  return seq === undefined ? (
    <Screen title="Activity">
      {content}
      {controls.status === "ready" &&
        controls.data
          .filter((row) => !isLoaded(row) || row.verified !== "verified")
          .map((row) => (
            <article className="agent-card" key={row.url}>
              <h2>Unverified record</h2>
              <p>This record could not be verified and has no effect on your agent's status.</p>
            </article>
          ))}
    </Screen>
  ) : (
    <DetailScreen title={`Activity record ${seq}`} back="/agent/activity">
      {content}
    </DetailScreen>
  );
}
