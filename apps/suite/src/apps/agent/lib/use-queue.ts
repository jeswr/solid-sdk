// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { useCallback, useMemo } from "react";
import type { Row, Unreadable } from "./client";
import { collection } from "./collections";
import { type Query, useAgentQuery, useAgentTick, useAgentWorkspace } from "./hooks";
import { type PendingApproval, pendingApprovals } from "./queue";
import { loadedRecords, readApprovals, readOutbox, readProposals } from "./readers";
import { createAgentVerifier } from "./verify";

export function useApprovalQueue(): Query<Row<PendingApproval>[]> {
  const { client, session } = useAgentWorkspace();
  // A stable tick: Date.now() per render would rebuild the queue and re-run its consumers'
  // effects on every render.
  const now = useAgentTick();
  // One query per container, so a change reloads only the affected reader.
  const proposals = useAgentQuery(client.paths.proposals, readProposals, 300);
  const approvals = useAgentQuery(
    client.paths.approvals,
    (c) => readApprovals(c, createAgentVerifier(session)),
    300,
  );
  const outbox = useAgentQuery(client.paths.outbox, readOutbox, 300);
  const reloadProposals = proposals.reload;
  const reloadApprovals = approvals.reload;
  const reloadOutbox = outbox.reload;
  const reload = useCallback(() => {
    reloadProposals();
    reloadApprovals();
    reloadOutbox();
  }, [reloadProposals, reloadApprovals, reloadOutbox]);
  // Memoised so consumers can key effects on the result without re-running every render.
  return useMemo((): Query<Row<PendingApproval>[]> => {
    if (proposals.status !== "ready") return { ...proposals, reload };
    if (approvals.status !== "ready") return { ...approvals, reload };
    if (outbox.status !== "ready") return { ...outbox, reload };
    const complete = approvals.data.complete && outbox.data.complete;
    const errors = [...proposals.data, ...approvals.data, ...outbox.data].filter(
      (row): row is Unreadable => "error" in row,
    );
    return {
      status: "ready",
      reload,
      data: collection(
        [
          ...errors,
          ...pendingApprovals(
            loadedRecords(proposals.data),
            loadedRecords(approvals.data),
            loadedRecords(outbox.data),
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
          truncated: proposals.data.truncated,
          total: proposals.data.total,
          newest: proposals.data.newest,
          complete,
          incompleteMessage: "Too many approval records to check",
        },
      ),
    };
  }, [proposals, approvals, outbox, reload, now]);
}
