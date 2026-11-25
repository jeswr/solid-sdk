// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Badge, Button } from "@jeswr/suite-ui";
import { useMemo } from "react";
import { expiredApprovals, readApprovalHistory } from "../lib/approval-details";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { loadedRecords, readOutbox, readProposals } from "../lib/readers";
import { CollectionNotice } from "./states";
import { useAgentClock } from "./use-agent-clock";

/** Proposal expiry is shown separately from the daemon-authored, hash-chained timeline. */
export function ExpiredApprovalRequests() {
  const { client, session } = useAgentWorkspace();
  const proposals = useAgentQuery(client.paths.proposals, readProposals);
  const outbox = useAgentQuery(client.paths.outbox, readOutbox);
  const approvals = useAgentQuery(client.paths.approvals, (c) => readApprovalHistory(c, session));
  const records = useMemo(
    () => (proposals.status === "ready" ? loadedRecords(proposals.data) : []),
    [proposals],
  );
  const boundaries = useMemo(
    () => records.map((proposal) => Date.parse(proposal.validUntil)),
    [records],
  );
  const now = useAgentClock(boundaries);
  if (
    proposals.status === "loading" ||
    outbox.status === "loading" ||
    approvals.status === "loading"
  )
    return null;
  if (proposals.status === "error" || outbox.status === "error" || approvals.status === "error")
    return <p role="alert">Couldn't check expired requests.</p>;
  const decisions = loadedRecords(approvals.data);
  const expired =
    outbox.data.complete &&
    approvals.data.complete &&
    ![...outbox.data, ...approvals.data].some((row) => "error" in row)
      ? expiredApprovals(records, loadedRecords(outbox.data), decisions, now)
      : [];
  const refused = records.filter((proposal) =>
    decisions.some(
      (a) => a.approves === proposal.id && a.verification === "verified" && a.decision === "deny",
    ),
  );
  return (
    <>
      <CollectionNotice rows={proposals.data} />
      <CollectionNotice rows={outbox.data} />
      <CollectionNotice rows={approvals.data} />
      {[...proposals.data, ...outbox.data, ...approvals.data].some((row) => "error" in row) && (
        <div role="alert">
          <p>Some expired requests couldn't be checked.</p>
          <Button
            variant="outline"
            onClick={() => {
              proposals.reload();
              outbox.reload();
              approvals.reload();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {refused.length > 0 && (
        <section aria-label="Refused approvals">
          <h2>Refused approvals</h2>
          <ul className="agent-list">
            {refused.map((proposal) => (
              <li className="agent-card" key={proposal.id}>
                <strong>
                  {String(proposal.intent.parameters.summary ?? proposal.intent.action)}
                </strong>
                <Badge variant="secondary">Refused</Badge>
                <p>You denied this request.</p>
              </li>
            ))}
          </ul>
        </section>
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
