// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { Row, Unreadable } from "./client";
import { type Query, useAgentClock, useAgentQuery, useAgentWorkspace } from "./hooks";
import { type PendingApproval, pendingApprovals } from "./queue";
import { loadedRecords, readApprovals, readOutbox, readProposals } from "./readers";
import { createAgentVerifier } from "./verify";

export function useApprovalQueue(): Query<Row<PendingApproval>[]> {
  const { session } = useAgentWorkspace();
  const now = useAgentClock();
  const query = useAgentQuery(session.storageUrl, async (client) => {
    const [proposals, approvals, outbox] = await Promise.all([
      readProposals(client),
      readApprovals(client, createAgentVerifier(session)),
      readOutbox(client),
    ]);
    return { proposals, approvals, outbox };
  });
  if (query.status !== "ready") return query;
  const { proposals, approvals, outbox } = query.data;
  const errors = [...proposals, ...approvals, ...outbox].filter(
    (row): row is Unreadable => "error" in row,
  );
  return {
    ...query,
    data: [
      ...errors,
      ...pendingApprovals(
        loadedRecords(proposals),
        loadedRecords(approvals),
        loadedRecords(outbox),
        now,
      ).map((record) => ({
        record,
        url: record.proposal.id,
        etag: null,
        verified: record.verification,
      })),
    ],
  };
}
