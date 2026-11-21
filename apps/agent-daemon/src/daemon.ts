// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { AuditHeadChangedError, type AuditRecord, verifyLedger } from "@jeswr/agent-audit";
import { linkedGateHead } from "@jeswr/agent-audit/verify";
import {
  type BridgeMessage,
  ChannelParseError,
  type InboundRawMessage,
} from "@jeswr/agent-channels";
import { ProposalRefusedError, proposalApprovalTerms } from "@jeswr/agent-executor";
import { canonicalJson, digestBytes, digestOf, podRecordSchema } from "@jeswr/agent-model";
import { GatewayError, type ModelCall } from "@jeswr/agent-model-gateway";
import { CONFIG_ED25519 } from "@jeswr/agent-reference";
import { importInbound } from "@jeswr/agentic-legacy-bridge";
import { type ClientCredentialsOptions, forClientCredentials } from "@jeswr/pod-auth/node";
import { createNotifications, type Subscription, type Timers } from "@jeswr/pod-notifications";
import { createPodClient } from "@jeswr/storage-client";
import { z } from "zod";
import {
  type Gate,
  type GateVerdict,
  inboundAuditDecision,
  outboundAuditDecision,
  type ParseRefusal,
} from "./gate.js";
import type { TaskContext } from "./instrumentation.js";
import { scrubLog } from "./logging.js";
import { checkedProposalResult } from "./proposal-results.js";
import type {
  AuthenticatedComposition,
  Daemon,
  DaemonAccount,
  DaemonOptions,
  ProposalResult,
} from "./types.js";
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
      storage,
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
  if (!o.gate || typeof o.gate.check !== "function") throw new Error("Missing inbound gate");
  if (typeof o.memory?.recall !== "function") throw new Error("Missing runtime memory");
  const proposerContext = {
    ...o.proposerContext,
    memoryRecall: (query: string) => o.memory.recall(query),
  };
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
  const identity = { owner: o.ownerWebId, agent: o.agentWebId };
  const append = async (record: AuditRecord) => {
    const evidence = { ...record, ...identity };
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
  async function calls(records: readonly ModelCall[], task: TaskContext, proposal?: string) {
    for (const call of records)
      await append({
        type: "model-call",
        id: call.id,
        context: call.context,
        provider: call.provider,
        model: call.model,
        tokens: call.inputTokens + call.outputTokens,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        toolCalls: call.toolCalls,
        latencyMs: Math.round(call.latencyMs),
        retries: call.retries,
        ...(proposal ? { proposal } : {}),
        ...task,
      });
  }
  /** Whether the ledger holds evidence that an earlier pass reached this result's projection. */
  function auditedEarlier(result: ProposalResult): boolean {
    const calls = new Set(result.calls.map((call) => call.id));
    const proposals = new Set(result.proposals.map((proposal) => proposal.id));
    return o.audit
      .entries()
      .some(
        ({ record }) =>
          (record.type === "model-call" && calls.has(record.id)) ||
          (record.type === "proposal" && proposals.has(record.id)),
      );
  }
  type SessionGate = Pick<Gate, "check" | "head" | "anchor" | "release"> &
    Partial<
      Pick<
        Gate,
        "recordParseRefusal" | "decisions" | "evidence" | "recoverAnchor" | "setReleaseAudit"
      >
    >;
  // Check/release, head capture and audit append must stay together relative to witnessing.
  let gateWork: Promise<unknown> = Promise.resolve();
  function inGateOrder<T>(work: () => Promise<T>): Promise<T> {
    const next = gateWork.then(work);
    gateWork = next.catch(() => undefined);
    return next;
  }
  type GateDecision = Extract<AuditRecord, { type: "gate-decision" }>;
  function gateDecision(
    fields: Pick<
      GateDecision,
      | "direction"
      | "outcome"
      | "reason"
      | "messageDigest"
      | "gateSeq"
      | "gateHash"
      | "taskId"
      | "conversation"
    >,
  ) {
    const { gateSeq, gateHash } = fields;
    return append({
      ...fields,
      type: "gate-decision",
      id: `urn:sha256:${digestOf({ gateSeq, gateHash }).slice(8)}`,
      configuration: CONFIG_ED25519,
      ...identity,
    });
  }
  async function reconcileGate(gate: SessionGate) {
    if (!gate.decisions) return;
    const after = o.audit
      .entries()
      .reduce((max, { record }) => Math.max(max, linkedGateHead(record)?.seq ?? 0), 0);
    for (const decision of gate.decisions(after)) await gateDecision(decision);
  }
  async function recoverGate(gate: SessionGate) {
    if (gate.evidence) {
      const entries = o.audit.entries();
      const evidence = gate.evidence();
      const verified = verifyLedger(entries, { ...evidence, allowUnwitnessedAnchors: true });
      if (!verified.ok)
        throw new Error(`Audit ledger ${verified.problem} at record ${verified.firstBadSeq}`);
      const witnessed = new Set(evidence.witnessedHeads.map(({ seq, hash }) => `${seq}:${hash}`));
      let recovered = false;
      for (const { record } of entries) {
        if (record.type !== "record-anchor" || witnessed.has(`${record.seq}:${record.hash}`))
          continue;
        if (!gate.recoverAnchor) throw new Error("Gate cannot recover the retained audit anchor");
        await gate.recoverAnchor(record);
        recovered = true;
      }
      if (recovered) await o.audit.sync();
    }
    await reconcileGate(gate);
  }
  async function recordGate(gate: SessionGate, fields: ReturnType<typeof inboundAuditDecision>) {
    if (gate.decisions) return reconcileGate(gate);
    const head = gate.head();
    await gateDecision({ ...fields, gateSeq: head.seq, gateHash: head.hash });
  }
  function anchorAudit(gate: SessionGate) {
    return inGateOrder(async () => {
      for (;;) {
        const entries = o.audit.entries();
        const head = entries.at(-1);
        if (!head) return;
        if (!verifyLedger(entries).ok) throw new Error("Audit ledger integrity failure");
        if (head.record.type === "record-anchor") {
          await o.audit.sync();
          return;
        }
        const { seq, hash } = head;
        let mirrorFailure: { error: unknown } | undefined;
        let published = false;
        try {
          await gate.anchor({ seq, hash }, async (jws) => {
            const record = {
              type: "record-anchor",
              id: `urn:sha256:${digestOf({ seq, hash, event: "record-anchor" }).slice(8)}`,
              seq,
              hash,
              jws,
              ...identity,
            } as const;
            try {
              await append(record);
            } catch (error) {
              // A failed mirror can follow a successful local append. The gate can
              // witness that durable row while the daemon reports the mirror failure.
              if (
                !o.audit
                  .entries()
                  .some((entry) => canonicalJson(entry.record) === canonicalJson(record))
              )
                throw error;
              mirrorFailure = { error };
            }
            published = true;
          });
          if (!published) throw new Error("Gate did not publish its audit anchor");
          if (mirrorFailure) throw mirrorFailure.error;
          return;
        } catch (error) {
          // An executor write can win the race. No witness is persisted for a stale head.
          if (!(error instanceof AuditHeadChangedError) || o.audit.entries().at(-1)?.hash === hash)
            throw error;
        }
      }
    });
  }
  async function accountPass(account: DaemonAccount, gate: SessionGate) {
    const cursor = await o.checkpoints.get(account.id);
    const batch = await account.binding.ingest.list({ id: account.id }, cursor, limits);
    if (
      batch.items.length + (batch.refusals?.length ?? 0) > limits.maxItems ||
      batch.items.reduce((n, item) => n + Buffer.byteLength(item.raw), 0) > limits.maxBytes
    )
      throw new Error("Ingest bound exceeded");
    if (batch.next === undefined) throw new Error("Missing ingest cursor");
    const cache = new Map<InboundRawMessage, BridgeMessage>();
    const parsed: { message: BridgeMessage; id: string; verdict: GateVerdict }[] = [];
    const source = { binding: account.binding.id, account: account.id };
    const batchKey = { ...source, cursor: cursor ?? null };
    await inGateOrder(() => reconcileGate(gate));
    async function recordRefusal(refusal: ParseRefusal, item: string | number) {
      await inGateOrder(async () => {
        const digest = "raw" in refusal ? digestBytes(refusal.raw) : refusal.digest;
        const replayKey = digestOf({ ...batchKey, item, digest, reason: refusal.reason });
        const verdict = await gate.recordParseRefusal?.({ ...source, ...refusal, replayKey });
        if (verdict?.outcome === "refused") await recordGate(gate, inboundAuditDecision(verdict));
        if (verdict?.outcome !== "refused" || verdict.reason === "indeterminate")
          throw new Error("Inbound gate could not record the parser refusal");
      });
    }
    // importInbound prepares its ACL before pulling. Complete all checks before invoking it.
    for (const [index, { digest, reason }] of (batch.refusals ?? []).entries()) {
      await recordRefusal({ digest, reason }, index);
    }
    for (const item of batch.items) {
      let message: BridgeMessage;
      try {
        message = account.binding.ingest.parse(item);
      } catch (error) {
        if (!(error instanceof ChannelParseError)) throw new Error("Reader parse failed");
        await recordRefusal({ raw: item.raw, reason: error.reason }, item.id);
        continue;
      }
      const verdict = await inGateOrder(async () => {
        const replayKey = digestOf({ ...batchKey, item: item.id, digest: message.rawSha256 });
        const checked = await gate.check({ ...source, message, replayKey });
        await recordGate(gate, inboundAuditDecision(checked));
        return checked;
      });
      if (verdict.outcome === "admitted" || verdict.outcome === "unstructured") {
        cache.set(item, message);
        parsed.push({ message, id: item.id, verdict });
      } else if (verdict.outcome !== "refused" || verdict.reason === "indeterminate") {
        throw new Error("Inbound gate could not check the batch");
      }
    }
    if (cache.size === 0) {
      await o.checkpoints.put(account.id, batch.next);
      return;
    }
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
          return [...cache.keys()];
        },
        parse(item) {
          const observed = cache.get(item);
          if (!observed) throw new Error("Missing checked message");
          return observed;
        },
      },
    });
    for (const { message, id, verdict } of parsed) {
      const source = o.workspace.messageUrl(inbox, id);
      const thread =
        account.binding.ingest.threadKey?.(message) ?? message.threadId ?? message.messageId ?? id;
      const key = digestOf({ account: account.id, source, digest: message.rawSha256 });
      // Identity precedes any model call and is stable across cursor replay/restart.
      // Hash routing context so untrusted titles, labels and proposal IDs cannot select it.
      const task: TaskContext = Object.freeze({
        taskId: `task-${key.slice(8)}`,
        conversation: `urn:sha256:${digestOf({ account: account.id, thread }).slice(8)}`,
        agent: o.agentWebId,
        owner: o.ownerWebId,
      });
      await append({
        type: "ingest",
        id: `urn:sha256:${digestOf({ source, digest: message.rawSha256 }).slice(8)}`,
        messageDigest: `sha-256:${message.rawSha256}`,
        ...task,
      });
      let extraction: Awaited<
        ReturnType<typeof o.gateway.reader.extract<z.infer<typeof triageSchema>>>
      >;
      try {
        const labelled = { ...message, gate: verdict };
        extraction = await o.gateway.reader.extract(labelled, triageSchema);
      } catch (error) {
        if (error instanceof GatewayError) await calls(error.calls, task);
        throw new Error("Reader extraction failed");
      }
      await calls(extraction.calls, task);
      const triage = triageSchema.parse(extraction.data);
      await o.workspace.triage(source, triage);
      let result = await o.proposalResults.get(key);
      if (result) {
        const cached = checkedProposalResult(result);
        result = cached;
        const legacy = cached.proposals.filter(
          (proposal) => o.workspace.proposalLocation(proposal.id) !== proposal.id,
        );
        if (legacy.length > 0) {
          const published: boolean[] = [];
          for (const proposal of legacy)
            published.push(
              o.workspace.legacyProposal(proposal.id) &&
                (await o.workspace.legacyProposalPublished(proposal.id)),
            );
          if (auditedEarlier(cached) || published.includes(true)) {
            // An earlier release projected this result into the outbox before auditing or
            // publishing it. Keep its IDs end to end: re-projection is then idempotent, while
            // a repaired ID would add a second outbox entry for the same proposal.
            if (published.includes(false))
              throw new Error("Legacy proposal already projected; manual migration needed");
          } else {
            result = checkedProposalResult({
              calls: cached.calls,
              proposals: cached.proposals.map((proposal) => ({
                ...proposal,
                id: o.workspace.proposalLocation(proposal.id),
              })),
            });
            // No evidence of projection: repair durably before the outbox sees the new IDs.
            await o.proposalResults.put(key, result);
          }
        }
      } else {
        const flagged = await o.isFlagged(account.id, thread);
        if (!flagged && verdict.outcome !== "admitted") continue;
        let generated: Awaited<ReturnType<DaemonOptions["gateway"]["proposer"]["propose"]>>;
        try {
          generated = await o.gateway.proposer.propose(
            [{ source, message, triage, gate: verdict }],
            proposerContext,
          );
        } catch (error) {
          if (error instanceof GatewayError) await calls(error.calls, task);
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
      const refused = [...(result.refused ?? [])];
      for (const proposal of result.proposals) {
        let entry: Awaited<ReturnType<DaemonOptions["project"]>>;
        let signed: ReturnType<Gate["release"]> | undefined;
        let audited: ReturnType<Gate["release"]> | undefined;
        const taskFields = { taskId: task.taskId, conversation: task.conversation };
        const recordRelease = (result: Awaited<ReturnType<Gate["release"]>>) =>
          recordGate(gate, { ...outboundAuditDecision(proposal, result), ...taskFields }).then(
            () => result,
          );
        gate.setReleaseAudit?.({
          proposalDigest: digestOf(proposal),
          task: taskFields,
          record(result) {
            if (audited) throw new Error("Outbox gate release mismatch");
            audited = recordRelease(result);
            return audited;
          },
        });
        const sign = () => {
          signed ??= inGateOrder(async () => {
            const result = await gate.release(proposal);
            return audited ?? recordRelease(result);
          });
          return signed;
        };
        try {
          entry = await o.project(proposal, sign);
          const released = (await signed) ?? (await audited);
          if (!released?.ok || entry.renderable.compactJws !== released.renderable.compactJws)
            throw new Error("Outbox gate release mismatch");
        } catch (error) {
          // Surface a failed audit even if a projector converts it to a typed refusal.
          await signed;
          await audited;
          if (!(error instanceof ProposalRefusedError)) throw error;
          refused.push({ id: proposal.id, reason: error.reason });
          continue;
        } finally {
          gate.setReleaseAudit?.(undefined);
        }
        if (entry.proposal.id !== proposal.id) throw new Error("Outbox proposal mismatch");
        if (entry.proposal.intent.termsDigest !== digestOf(proposalApprovalTerms(entry)))
          throw new Error("Outbox terms digest mismatch");
        entries.push(entry);
      }
      result = checkedProposalResult({
        calls: result.calls,
        proposals: entries.map((entry) => entry.proposal),
        ...(refused.length > 0 && { refused }),
      });
      // Publish only the finalized proposals returned by the trusted outbox projection.
      // Keep the original result durable until this replacement succeeds, so retries
      // retain model-call and proposal identities even if projection or fsync fails.
      await o.proposalResults.put(key, result);
      const proposalIds = [...result.proposals, ...refused].map(({ id }) => id);
      await calls(result.calls, task, proposalIds.length === 1 ? proposalIds[0] : undefined);
      for (const { id, reason } of refused) {
        await append({
          type: "decision",
          id: `urn:sha256:${digestOf({ proposal: id, task: task.taskId, event: "gate-refusal" }).slice(8)}`,
          proposal: id,
          status: "refused",
          reason: /^[a-z][a-z0-9-]{0,63}$/.test(reason) ? reason : "gate-refused",
          ...task,
        });
      }
      for (const entry of entries) {
        const proposal = entry.proposal;
        if (o.workspace.proposalLocation(proposal.id) === proposal.id)
          await o.workspace.proposal(proposal);
        else await o.workspace.confirmLegacyProposal(proposal);
        const terms = proposalApprovalTerms(entry);
        await append({
          type: "proposal",
          id: proposal.id,
          proposal: proposal.id,
          terms,
          termsDigest: digestOf(terms),
          ...task,
        });
      }
    }
    await o.checkpoints.put(account.id, batch.next);
  }
  let active = false;
  async function session(repeat: boolean, signal?: AbortSignal) {
    if (active) throw new Error("Daemon already running");
    active = true;
    let release: (() => Promise<void>) | undefined;
    let gateSession: Gate | undefined;
    let recordingGate: SessionGate | undefined;
    let sealFailure: unknown;
    let sealing = Promise.resolve();
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
      if (fault) throw sealFailure ?? new Error("Authority reconciliation failed");
      if (now() >= heartbeat) {
        await o.workspace.heartbeat(new Date(now()), await o.executor.status());
        heartbeat = now() + HEARTBEAT_MS;
        const gate = recordingGate;
        if (gate) {
          // A slow mirror must not delay control or approval reconciliation.
          sealing = sealing
            .then(async () => {
              if (!sealFailure) await anchorAudit(gate);
            })
            .catch((error) => {
              sealFailure = error;
              fault = true;
            });
        }
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
      gateSession = await o.gate.open?.({ actor: o.agentWebId, party: o.ownerWebId });
      const gate = gateSession ?? o.gate;
      if (!("head" in gate && "anchor" in gate && "release" in gate))
        throw new Error("Missing gate record capability");
      await inGateOrder(() => recoverGate(gate));
      await o.workspace.initialize();
      recordingGate = gate;
      await o.workspace.introduce(o.agentWebId);
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
      armMaintenance();
      await sealing;
      do {
        if (signal?.aborted) break;
        const at = now();
        if (fault) throw sealFailure ?? new Error("Authority reconciliation failed");
        for (const account of accounts) {
          if (signal?.aborted || fault) break;
          if (!account.enabled || at < (due.get(account.id) ?? -Infinity)) continue;
          await accountPass(account, gate);
          due.set(account.id, now() + pollInterval(account.category));
        }
        await authority;
        await sealing;
        if (fault) throw sealFailure ?? new Error("Authority reconciliation failed");
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
          await sealing;
          try {
            if (release) await o.executor.drain();
            if (recordingGate && !sealFailure) await anchorAudit(recordingGate);
          } finally {
            await gateSession?.close();
          }
        }
      } finally {
        await release?.();
        active = false;
      }
    }
    if (sealFailure) throw sealFailure;
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
