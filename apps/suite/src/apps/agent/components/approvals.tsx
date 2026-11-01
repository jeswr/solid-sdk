// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Badge, Button } from "@jeswr/suite-ui";
import { Ban, Brain, Mail } from "lucide-react";
import Link from "next/link";
import type { Row, Unreadable } from "../lib/client";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { resourceSlug } from "../lib/paths";
import { type PendingApproval, pendingApprovals } from "../lib/queue";
import { loadedRecords, readApprovals, readOutbox, readProposals } from "../lib/readers";
import { DetailScreen, DisabledAction, QueryRows, Screen } from "./states";
import { OfflineBanner, useDaemonStatus } from "./status-pill";

function useQueue() {
  const { client } = useAgentWorkspace();
  return useAgentQuery(client.workspace, async (c) => {
    const [proposals, approvals, outbox] = await Promise.all([
      readProposals(c),
      readApprovals(c),
      readOutbox(c),
    ]);
    const errors = [...proposals, ...approvals, ...outbox].filter(
      (row): row is Unreadable => "error" in row,
    );
    return [
      ...errors,
      ...pendingApprovals(
        loadedRecords(proposals),
        loadedRecords(approvals),
        loadedRecords(outbox),
        Date.now(),
      ).map((record) => ({
        record,
        url: record.proposal.id,
        etag: null,
        verified: "unchecked" as const,
      })),
    ] satisfies Row<PendingApproval>[];
  });
}
function ApprovalSummary({ row }: { row: PendingApproval }) {
  const { proposal, reason } = row;
  const Icon = reason === "prohibited" ? Ban : proposal.intent.action === "remember" ? Brain : Mail;
  return (
    <>
      <Icon size={18} aria-hidden="true" />
      <strong>{String(proposal.intent.parameters.summary ?? proposal.intent.action)}</strong>
      <Badge variant="secondary">{proposal.intent.binding}</Badge>
      <Badge variant="outline">{proposal.intent.recipientHash}</Badge>
      <span>
        {proposal.intent.amount.value} {proposal.intent.amount.currency}
      </span>
      <span>Expires in {Math.ceil(row.expiresIn / 3_600_000)} hours</span>
      <Badge variant={reason === "prohibited" ? "destructive" : "secondary"}>
        {reason === "prohibited" ? "Never" : reason}
      </Badge>
      {row.approvedAwaitingSend && <p>Approval recorded (unchecked), waiting for the agent</p>}
    </>
  );
}
export function ApprovalsScreen({ id }: { id?: string }) {
  const query = useQueue();
  const status = useDaemonStatus();
  if (id)
    return (
      <DetailScreen title="Approval details" back="/agent/approvals">
        <OfflineBanner status={status} />
        <QueryRows query={query} empty="Nothing waiting for you">
          {(rows) => {
            const row = rows.find((row) => resourceSlug(row.proposal.id) === id);
            if (!row) return <p>This proposal is no longer waiting for approval.</p>;
            return (
              <article className="agent-card">
                <div className="agent-row">
                  <ApprovalSummary row={row} />
                </div>
                <h2>Exact preview</h2>
                <pre>{row.proposal.renderedPreview}</pre>
                <p>
                  Rule requiring approval:{" "}
                  {String(row.proposal.intent.parameters.approvalRule ?? "Ask before this action")}
                </p>
                <p>Approval records have not been checked on this device.</p>
                <details>
                  <summary>Advanced</summary>
                  <p>Terms digest</p>
                  <code>{row.proposal.intent.termsDigest}</code>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard.writeText(row.proposal.intent.termsDigest)
                    }
                  >
                    Copy digest
                  </Button>
                </details>
                <div className="agent-row">
                  <DisabledAction>Approve</DisabledAction>
                  <DisabledAction>Deny</DisabledAction>
                </div>
              </article>
            );
          }}
        </QueryRows>
      </DetailScreen>
    );
  return (
    <Screen title="Approvals">
      <OfflineBanner status={status} />
      <QueryRows query={query} empty="Nothing waiting for you">
        {(rows) => (
          <ul className="agent-list">
            {rows.map((row) => (
              <li key={row.proposal.id} className="agent-card">
                <div className="agent-row">
                  <ApprovalSummary row={row} />
                </div>
                <Link
                  href={`/agent/approvals/${encodeURIComponent(resourceSlug(row.proposal.id))}`}
                >
                  Review{" "}
                  {String(row.proposal.intent.parameters.summary ?? row.proposal.intent.action)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryRows>
    </Screen>
  );
}
