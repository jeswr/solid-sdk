// AUTHORED-BY Codex GPT-6.1-Sol
import { AgentReadError, createAgentClient } from "../../apps/agent/lib/client";
import { discoverWorkspace, resourceSlug } from "../../apps/agent/lib/paths";
import { pendingApprovals } from "../../apps/agent/lib/queue";
import {
  loadedRecords,
  readApprovals,
  readAudit,
  readOutbox,
  readProposals,
} from "../../apps/agent/lib/readers";
import { createAgentVerifier } from "../../apps/agent/lib/verify";
import type { NotificationSource, SuiteNotification } from "../lib/notifications-model";
import type { SuiteAccount } from "../session/types";

/** Reuses the agent's readers and conservative verified approval reducer; grants no authority. */
export function createAgentNotificationSource(
  account: SuiteAccount,
  fetch: typeof globalThis.fetch,
): NotificationSource {
  return {
    id: `agent:${account.id}`,
    async list(signal) {
      const bounded: typeof fetch = (input, init) => {
        signal.throwIfAborted();
        return fetch(input, { ...init, signal });
      };
      try {
        const publicFetch: typeof fetch = (input, init) => {
          signal.throwIfAborted();
          return globalThis.fetch(input, { ...init, signal, credentials: "omit" });
        };
        const workspace = await discoverWorkspace(
          bounded,
          account.webId,
          account.storageUrl,
          publicFetch,
        );
        const client = createAgentClient({
          fetch: bounded,
          storage: account.storageUrl,
          workspace,
        });
        const session = {
          webId: account.webId,
          storageUrl: account.storageUrl,
          fetch: bounded,
          publicFetch,
        };
        const [audit, proposals, approvals, outbox] = await Promise.all([
          readAudit(client, { limit: 100 }),
          readProposals(client),
          readApprovals(client, createAgentVerifier(session)),
          readOutbox(client),
        ]);
        signal.throwIfAborted();
        const actions = loadedRecords(audit).flatMap((entry): SuiteNotification[] => {
          const record = entry.record;
          if (record.type !== "transmission" || record.status !== "sent") return [];
          return [
            {
              id: `agent-action:${entry.hash}`,
              kind: "task",
              app: "agent",
              category: "agent-action",
              title: "Your agent sent a message",
              href: "/agent/activity",
              createdAt: new Date(entry.at),
              read: false,
              target: { id: record.proposal ?? entry.hash, title: "Agent activity" },
            },
          ];
        });
        const waiting: SuiteNotification[] = pendingApprovals(
          loadedRecords(proposals),
          loadedRecords(approvals),
          loadedRecords(outbox),
          Date.now(),
          approvals.complete && outbox.complete,
        )
          .filter((row) => row.state === "pending")
          .map((row) => ({
            id: `agent-approval:${row.proposal.id}:${row.proposal.intent.termsDigest}`,
            kind: "task",
            app: "agent",
            category: "agent-approval",
            blocking: true,
            title: String(row.proposal.intent.parameters.summary ?? "Your agent needs approval"),
            href: `/agent/approvals/${encodeURIComponent(resourceSlug(row.proposal.id) ?? "")}`,
            createdAt: new Date(row.proposal.createdAt),
            read: false,
          }));
        return [...actions, ...waiting];
      } catch (error) {
        // No agent workspace is the normal state for an account that has not set one up.
        if (error instanceof AgentReadError && error.status === 404) return [];
        throw error;
      }
    },
  };
}
