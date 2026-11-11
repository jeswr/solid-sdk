// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Badge, Button } from "@jeswr/suite-ui";
import { useMemo } from "react";
import { expiredApprovals } from "../lib/approval-details";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { loadedRecords, readOutbox, readProposals } from "../lib/readers";
import { CollectionNotice } from "./states";
import { useAgentClock } from "./use-agent-clock";

/** Proposal expiry is shown separately from the daemon-authored, hash-chained timeline. */
export function ExpiredApprovalRequests() {
  const { client } = useAgentWorkspace();
  const proposals = useAgentQuery(client.paths.proposals, readProposals);
  const outbox = useAgentQuery(client.paths.outbox, readOutbox);
  const records = useMemo(
    () => (proposals.status === "ready" ? loadedRecords(proposals.data) : []),
    [proposals],
  );
  const boundaries = useMemo(
    () => records.map((proposal) => Date.parse(proposal.validUntil)),
    [records],
  );
  const now = useAgentClock(boundaries);
  if (proposals.status === "loading" || outbox.status === "loading") return null;
  if (proposals.status === "error" || outbox.status === "error")
    return <p role="alert">Couldn't check expired requests.</p>;
  const expired =
    outbox.data.complete && !outbox.data.some((row) => "error" in row)
      ? expiredApprovals(records, loadedRecords(outbox.data), now)
      : [];
  return (
    <>
      <CollectionNotice rows={proposals.data} />
      <CollectionNotice rows={outbox.data} />
      {[...proposals.data, ...outbox.data].some((row) => "error" in row) && (
        <div role="alert">
          <p>Some expired requests couldn't be checked.</p>
          <Button
            variant="outline"
            onClick={() => {
              proposals.reload();
              outbox.reload();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {expired.length > 0 && (
        <section aria-label="Expired approvals">
          <h2>Expired approvals</h2>
          <ul className="agent-list">
            {expired.map((proposal) => (
              <li className="agent-card" key={proposal.id}>
                <strong>
                  {String(proposal.intent.parameters.summary ?? proposal.intent.action)}
                </strong>
                <Badge variant="secondary">Expired</Badge>
                <p>Reason: expired</p>
                <time dateTime={proposal.validUntil}>
                  {new Date(proposal.validUntil).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
