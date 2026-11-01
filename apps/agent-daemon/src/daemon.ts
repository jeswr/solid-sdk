// AUTHORED-BY Codex GPT-6.1-Sol
import { ChannelParseError, readEnvelope } from "@jeswr/agent-channels";
import { proposalApprovalTerms } from "@jeswr/agent-executor";
import { canonicalJson, digestOf, podRecordSchema } from "@jeswr/agent-model";
import { GatewayError, type ModelCall } from "@jeswr/agent-model-gateway";
import { importInbound } from "@jeswr/agentic-legacy-bridge";
import { type ClientCredentialsOptions, forClientCredentials } from "@jeswr/pod-auth/node";
import { createNotifications, type Subscription, type Timers } from "@jeswr/pod-notifications";
import { createPodClient } from "@jeswr/storage-client";
import { z } from "zod";
import { scrubLog } from "./logging.js";
import { checkedProposalResult } from "./proposal-results.js";
import type { AuthenticatedComposition, Daemon, DaemonAccount, DaemonOptions } from "./types.js";
import { PodWorkspace } from "./workspace.js";

export const POLL_MS = 30_000;
export const HEARTBEAT_MS = 60_000;
export function pollInterval(category: DaemonAccount["category"]): number {
  return { email: 120_000, chat: 30_000, social: 300_000 }[category];
}
const systemTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
const triageSchema = z.object({
  primary: z.enum(["noise", "waiting", "action", "needs_reply", "fyi", "read_later"]),
  urgency: z.enum(["urgent", "not_urgent"]),
  confidence: z.number().min(0).max(1),
});
function hasStructuredEnvelope(blocks: readonly string[] | undefined): boolean {
  if (!blocks || blocks.length > 512) return false;
  return blocks.some((block) => {
    try {
      readEnvelope(block);
      return true;
    } catch {
      return false;
    }
  });
}

/** pod-auth retains credentials and supplies every authenticated pod request. */
export async function composeDaemon(options: {
  credentials: ClientCredentialsOptions;
  storageRoot: string;
  ownerWebId: string;
  privateTypeIndex: string;
  prepare: (
    workspace: PodWorkspace,
  ) => Promise<Omit<DaemonOptions, "workspace" | "notifications" | "ownerWebId">>;
}): Promise<AuthenticatedComposition> {
  const auth = await forClientCredentials(options.credentials);
  try {
    const { storage } = await createPodClient({ fetch: auth.fetch, storage: options.storageRoot });
    const workspace = new PodWorkspace({
      io: auth.fetch,
      root: storage.root,
      ownerWebId: options.ownerWebId,
      privateTypeIndex: options.privateTypeIndex,
    });
    const prepared = await options.prepare(workspace);
    const daemon = createDaemon({
      ...prepared,
      ownerWebId: options.ownerWebId,
      workspace,
      notifications: createNotifications({ fetch: auth.fetch, storage }),
    });
    return { auth, daemon, close: () => auth.logout() };
  } catch {
    await auth.logout();
    throw new Error("Daemon composition failed");
  }
}

/** Serial account passes keep shared bindings and durable cursors ordered. */
export function createDaemon(o: DaemonOptions): Daemon {
  const now = o.now ?? Date.now;
  const timers = o.timers ?? systemTimers;
  const accounts = o.accounts.map((account) => ({ ...account }));
  if (
    new Set(accounts.map((a) => a.id)).size !== accounts.length ||
    accounts.some(
      (a) =>
        !/^[a-z0-9][a-z0-9-]{0,39}$/.test(a.id) ||
        !/^[a-z0-9][a-z0-9-]{0,39}$/.test(a.binding.id) ||
        !["email", "chat", "social"].includes(a.category),
    )
  )
    throw new Error("Invalid daemon accounts");
  const limits = { ...(o.limits ?? { maxItems: 100, maxBytes: 4 * 1024 * 1024 }) };
  if (
    !Number.isSafeInteger(limits.maxItems) ||
    limits.maxItems <= 0 ||
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes <= 0
  )
    throw new Error("Invalid ingest bounds");
  const append = async (record: Parameters<typeof o.audit.append>[0]) => {
    const evidence = { ...record, owner: o.ownerWebId, agent: o.agentWebId };
    const existing = o.audit
      .entries()
      .filter(
        (entry) => entry.record.type !== "ledger-checkpoint" && entry.record.id === evidence.id,
      );
    if (existing.length > 0) {
      if (existing.length !== 1 || canonicalJson(existing[0]?.record) !== canonicalJson(evidence))
        throw new Error("Audit replay conflict");
      await o.audit.sync();
      return;
    }
    await o.audit.append(evidence, new Date(now()).toISOString());
  };
  async function calls(records: readonly ModelCall[], proposal?: string) {
    for (const call of records)
      await append({
        type: "model-call",
        id: call.id,
        owner: o.ownerWebId,
        agent: o.agentWebId,
        context: call.context,
        provider: call.provider,
        model: call.model,
        tokens: call.inputTokens + call.outputTokens,
        toolCalls: call.toolCalls,
        latencyMs: Math.round(call.latencyMs),
        retries: call.retries,
        ...(proposal ? { proposal } : {}),
      });
  }
  async function accountPass(account: DaemonAccount) {
    const cursor = await o.checkpoints.get(account.id);
    let next: string | undefined;
    const parsed: { message: ReturnType<typeof account.binding.ingest.parse>; id: string }[] = [];
    const inbox = await o.workspace.inbox(account.binding.id, account.id);
    await importInbound({
      container: inbox,
      ownerWebId: o.ownerWebId,
      interpretingAgentWebId: o.agentWebId,
      writeFetch: o.workspace.io,
      interpreter: o.interpreter,
      now: new Date(now()),
      adapter: {
        channel: account.binding.id,
        async pullInbound() {
          const batch = await account.binding.ingest.list({ id: account.id }, cursor, limits);
          if (
            batch.items.length > limits.maxItems ||
            batch.items.reduce((n, item) => n + Buffer.byteLength(item.raw), 0) > limits.maxBytes
          )
            throw new Error("Ingest bound exceeded");
          next = batch.next;
          return batch.items;
        },
        parse(item) {
          try {
            const message = account.binding.ingest.parse(item);
            parsed.push({ message, id: item.id });
            return message;
          } catch (error) {
            if (error instanceof ChannelParseError) throw error;
            throw new Error("Reader parse failed");
          }
        },
      },
    });
    for (const { message, id } of parsed) {
      const source = o.workspace.messageUrl(inbox, id);
      await append({
        type: "ingest",
        id: `urn:sha256:${digestOf({ source, digest: message.rawSha256 }).slice(8)}`,
        owner: o.ownerWebId,
        agent: o.agentWebId,
        messageDigest: `sha-256:${message.rawSha256}`,
      });
      let extraction: Awaited<
        ReturnType<typeof o.gateway.reader.extract<z.infer<typeof triageSchema>>>
      >;
      try {
        extraction = await o.gateway.reader.extract(message, triageSchema);
      } catch (error) {
        if (error instanceof GatewayError) await calls(error.calls);
        throw new Error("Reader extraction failed");
      }
      await calls(extraction.calls);
      const triage = triageSchema.parse(extraction.data);
      await o.workspace.triage(source, triage);
      const thread =
        account.binding.ingest.threadKey?.(message) ?? message.threadId ?? message.messageId ?? id;
      const key = digestOf({ account: account.id, source, digest: message.rawSha256 });
      let result = await o.proposalResults.get(key);
      if (result) result = checkedProposalResult(result);
      else {
        const flagged = await o.isFlagged(account.id, thread);
        // A structured part is a processing hint; it never authenticates a sender.
        if (!flagged && !hasStructuredEnvelope(message.jsonLdBlocks)) continue;
        let generated: Awaited<ReturnType<DaemonOptions["gateway"]["proposer"]["propose"]>>;
        try {
          generated = await o.gateway.proposer.propose(
            [{ source, message, triage }],
            o.proposerContext,
          );
        } catch (error) {
          if (error instanceof GatewayError) await calls(error.calls);
          throw new Error("Proposer failed");
        }
        result = checkedProposalResult({
          calls: generated.calls,
          proposals: generated.proposals.map((untrusted) =>
            podRecordSchema.parse({
              ...untrusted,
              type: "action-proposal",
              id: o.workspace.proposalLocation(untrusted.id),
              state: "proposed",
              wasGeneratedBy:
                generated.calls.find((call) => call.id === untrusted.wasGeneratedBy)?.id ??
                `urn:sha256:${digestOf({ source, id: untrusted.id }).slice(8)}`,
            }),
          ),
        });
        // No proposal or model-call evidence may escape before its replay data is durable.
        await o.proposalResults.put(key, result);
      }
      const entries = [];
      for (const proposal of result.proposals) {
        const entry = await o.proposalWritten(proposal);
        if (entry.proposal.id !== proposal.id) throw new Error("Outbox proposal mismatch");
        if (entry.proposal.intent.termsDigest !== digestOf(proposalApprovalTerms(entry)))
          throw new Error("Outbox terms digest mismatch");
        entries.push(entry);
      }
      result = checkedProposalResult({
        calls: result.calls,
        proposals: entries.map((entry) => entry.proposal),
      });
      // Publish only the finalized proposals returned by the trusted outbox projection.
      // Keep the original result durable until this replacement succeeds, so retries
      // retain model-call and proposal identities even if projection or fsync fails.
      await o.proposalResults.put(key, result);
      const task =
        result.proposals.length === 1 && result.proposals[0]
          ? o.workspace.proposalLocation(result.proposals[0].id)
          : undefined;
      await calls(result.calls, task);
      for (const entry of entries) {
        const proposal = entry.proposal;
        await o.workspace.proposal(proposal);
        const terms = proposalApprovalTerms(entry);
        await append({
          type: "proposal",
          id: proposal.id,
          proposal: proposal.id,
          owner: o.ownerWebId,
          agent: o.agentWebId,
          terms,
          termsDigest: digestOf(terms),
        });
      }
    }
    if (next === undefined) throw new Error("Missing ingest cursor");
    await o.checkpoints.put(account.id, next);
  }
  let active = false;
  async function session(repeat: boolean, signal?: AbortSignal) {
    if (active) throw new Error("Daemon already running");
    active = true;
    let release: (() => Promise<void>) | undefined;
    let subscription: Subscription | undefined;
    let fault = false;
    let authority: Promise<unknown> = Promise.resolve();
    let maintenance: Promise<void> = Promise.resolve();
    let maintenanceTimer: unknown;
    let stopped = false;
    let heartbeat = -Infinity;
    const disposers: (() => void)[] = [];
    const invalidate = (kind: "control" | "approval") => {
      // Invoke synchronously: the executor fences in-flight snapshots before waiting.
      try {
        const task =
          kind === "approval"
            ? o.executor.onApprovalChange()
            : o.executor.onControlOrMandateChange();
        authority = Promise.all([authority, task]).catch(() => {
          fault = true;
        });
      } catch {
        fault = true;
      }
    };
    const maintain = async () => {
      invalidate("control");
      invalidate("approval");
      await authority;
      if (fault) throw new Error("Authority reconciliation failed");
      if (now() >= heartbeat) {
        await o.workspace.heartbeat(new Date(now()));
        heartbeat = now() + HEARTBEAT_MS;
      }
    };
    const armMaintenance = () => {
      if (stopped || signal?.aborted) return;
      maintenanceTimer = timers.setTimeout(() => {
        maintenance = maintain()
          .catch(() => {
            fault = true;
          })
          .finally(armMaintenance);
      }, POLL_MS);
    };
    try {
      signal?.throwIfAborted();
      release = await o.lease.acquire();
      await o.workspace.initialize();
      if (signal) {
        try {
          subscription = await o.notifications.subscribe(
            [o.workspace.url("control/"), o.workspace.url("approvals/")],
            { pollIntervalMs: POLL_MS, signal },
          );
          disposers.push(
            subscription.on("change", (change) => {
              if (o.workspace.within(change.object, "approvals/")) invalidate("approval");
              if (o.workspace.within(change.object, "control/")) invalidate("control");
            }),
          );
          disposers.push(
            subscription.on("resync", () => {
              invalidate("control");
              invalidate("approval");
            }),
          );
          disposers.push(
            subscription.on("state", (state) => {
              if (state !== "live") {
                invalidate("control");
                invalidate("approval");
              }
            }),
          );
        } catch {
          o.log?.(scrubLog("Notifications unavailable; polling authority stores"));
        }
      }
      const due = new Map<string, number>();
      await maintain();
      if (signal) armMaintenance();
      do {
        if (signal?.aborted) break;
        const at = now();
        if (fault) throw new Error("Authority reconciliation failed");
        for (const account of accounts) {
          if (signal?.aborted || fault) break;
          if (!account.enabled || at < (due.get(account.id) ?? -Infinity)) continue;
          await accountPass(account);
          due.set(account.id, now() + pollInterval(account.category));
        }
        await authority;
        if (fault) throw new Error("Authority reconciliation failed");
        if (signal?.aborted) break;
        await o.executor.runOutboxOnce();
        if (!repeat || !signal) break;
        await pause(
          Math.max(
            1,
            Math.min(
              now() + POLL_MS,
              ...accounts.filter((a) => a.enabled).map((a) => due.get(a.id) ?? now()),
            ) - now(),
          ),
          signal,
          timers,
        );
      } while (!signal.aborted);
    } finally {
      stopped = true;
      timers.clearTimeout(maintenanceTimer);
      try {
        for (const dispose of disposers) dispose();
        try {
          await subscription?.close();
        } finally {
          await maintenance;
          await authority;
          if (release) await o.executor.drain();
        }
      } finally {
        await release?.();
        active = false;
      }
    }
  }
  return { once: (signal) => session(false, signal), run: (signal) => session(true, signal) };
}
function pause(ms: number, signal: AbortSignal, timers: Timers): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      timers.clearTimeout(handle);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const handle = timers.setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}
