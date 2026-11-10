// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useMemo } from "react";
import type { Row, Unreadable } from "./client";
import { collection } from "./collections";
import { type Query, useAgentQuery, useAgentTick, useAgentWorkspace } from "./hooks";
import { type PendingApproval, pendingApprovals } from "./queue";
import { loadedRecords, readApprovals, readOutbox, readProposals } from "./readers";
import { createAgentVerifier } from "./verify";

export function useApprovalQueue(): Query<Row<PendingApproval>[]> {
  const { session } = useAgentWorkspace();
  // A stable tick: Date.now() per render would rebuild the queue and re-run its consumers'
  // effects on every render.
  const now = useAgentTick();
  const query = useAgentQuery(session.storageUrl, async (client) => {
    const [proposals, approvals, outbox] = await Promise.all([
      readProposals(client),
      readApprovals(client, createAgentVerifier(session)),
      readOutbox(client),
    ]);
    return { proposals, approvals, outbox };
  });
  // Memoised so consumers can key effects on the result without re-running every render.
  return useMemo((): Query<Row<PendingApproval>[]> => {
    if (query.status !== "ready") return query;
    const { proposals, approvals, outbox } = query.data;
    const complete = approvals.complete && outbox.complete;
    const errors = [...proposals, ...approvals, ...outbox].filter(
      (row): row is Unreadable => "error" in row,
    );
    return {
      ...query,
      data: collection(
        [
          ...errors,
          ...pendingApprovals(
            loadedRecords(proposals),
            loadedRecords(approvals),
            loadedRecords(outbox),
            now,
            complete,
          ).map((record) => ({
            record,
            url: record.proposal.id,
            etag: null,
            verified: record.verification,
          })),
        ],
        {
          truncated: proposals.truncated,
          total: proposals.total,
          newest: proposals.newest,
          complete,
          incompleteMessage: "Too many approval records to check",
        },
      ),
    };
  }, [query, now]);
}
