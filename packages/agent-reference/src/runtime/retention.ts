// AUTHORED-BY Codex GPT-6
/**
 * Retention and capacity policy for retained runtime state.
 *
 * What is bounded and how:
 *  - replay entries: kept until the message could no longer be accepted (expiresAt + skew);
 *    when the replay set is full, new input is refused — live entries are never evicted;
 *  - closed conversations with their outbox messages, agreements, settled effects and
 *    handler state: kept `closedRetentionMs` after their last update, and at most
 *    `maxClosedConversations` (oldest compacted first);
 *  - concluded local tasks: `taskRetentionMs` / `maxTasks`;
 *  - expired owner approvals: removed;
 *  - mandate revocations: never removed.
 *
 * Never compacted ("protected"): a conversation that is still open; that has a planned,
 * attempting (uncertain) or receipt-owed effect; that has a pending owner approval; that a
 * live replay entry references (a duplicate must still get its original responses); or —
 * with hand-off tracking — that has outbox messages no binding has taken yet.
 * If protected state alone exceeds the hard budgets, `overCapacity` is reported and the
 * runtime refuses new work instead of discarding anything unresolved.
 *
 * The evidence ledger is bounded separately (segment rotation; see store/ledger.ts).
 */
import { isTerminal } from "../core/conversation.js";
import type { Iri } from "../core/types.js";
import { domainOwner, type RuntimeState } from "../store/state.js";

export interface RetentionPolicy {
  readonly closedRetentionMs: number;
  readonly maxClosedConversations: number;
  readonly taskRetentionMs: number;
  readonly maxTasks: number;
  /** Hard budgets checked after compaction. */
  readonly maxRetainedConversations: number;
  readonly maxOutboxEntries: number;
  readonly maxDomainEntries: number;
}

const DAY = 86_400_000;

export const DEFAULT_RETENTION: RetentionPolicy = Object.freeze({
  closedRetentionMs: 30 * DAY,
  maxClosedConversations: 2_000,
  taskRetentionMs: 30 * DAY,
  maxTasks: 2_000,
  maxRetainedConversations: 5_000,
  maxOutboxEntries: 50_000,
  maxDomainEntries: 50_000,
});

export interface CompactionReport {
  readonly removedConversations: number;
  readonly removedOutbox: number;
  readonly removedEffects: number;
  readonly removedAgreements: number;
  readonly removedDomainKeys: number;
  readonly removedApprovals: number;
  readonly removedTasks: number;
  readonly protectedConversations: number;
  readonly overCapacity?: string;
}

function settled(e: RuntimeState["effects"][string]): boolean {
  return e.status === "concluded";
}

export function protectedConversations(
  state: RuntimeState,
  now: number,
  opts: { trackHandOff: boolean; maxClockSkewMs: number },
): Set<Iri> {
  const keep = new Set<Iri>();
  for (const c of Object.values(state.conversations)) if (!isTerminal(c.phase)) keep.add(c.id);
  for (const e of Object.values(state.effects)) {
    if (
      !settled(e) ||
      (e.status === "concluded" &&
        !e.receiptSent &&
        state.conversations[e.conversation] &&
        !isTerminal(state.conversations[e.conversation]?.phase ?? "completed"))
    ) {
      keep.add(e.conversation);
    }
  }
  for (const p of Object.values(state.pending)) keep.add(p.conversation);
  for (const s of Object.values(state.seen)) {
    if (s.conversation && Date.parse(s.expiresAt) + opts.maxClockSkewMs >= now)
      keep.add(s.conversation);
  }
  if (opts.trackHandOff) {
    for (const o of Object.values(state.outbox)) if (!o.handedOff) keep.add(o.conversation);
  }
  // A provider send that is attempting or uncertain must stay resolvable.
  for (const t of Object.values(state.transmissions)) {
    if (t.status === "attempting" || t.status === "uncertain") {
      const o = state.outbox[t.messageId];
      if (o) keep.add(o.conversation);
    }
  }
  return keep;
}

/** Compact `state` in place according to `policy`. Pure apart from the mutation. */
export function compactState(
  state: RuntimeState,
  now: number,
  policy: RetentionPolicy,
  opts: { trackHandOff: boolean; maxClockSkewMs: number },
): CompactionReport {
  const keep = protectedConversations(state, now, opts);
  const closed = Object.values(state.conversations)
    .filter((c) => isTerminal(c.phase) && !keep.has(c.id))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const allClosed = Object.values(state.conversations).filter((c) => isTerminal(c.phase)).length;
  let excess = Math.max(0, allClosed - policy.maxClosedConversations);
  const remove = new Set<Iri>();
  for (const c of closed) {
    const old = now - Date.parse(c.updatedAt) > policy.closedRetentionMs;
    if (old || excess > 0) {
      remove.add(c.id);
      if (excess > 0) excess--;
    }
  }

  let removedOutbox = 0;
  let removedEffects = 0;
  let removedAgreements = 0;
  let removedDomainKeys = 0;
  const removedOwners = new Set<Iri>(remove);
  for (const id of remove) {
    delete state.conversations[id];
  }
  for (const [id, o] of Object.entries(state.outbox)) {
    if (remove.has(o.conversation)) {
      delete state.outbox[id];
      removedOutbox++;
      // Settled transmission records go with their message (unresolved ones protected it).
      const t = state.transmissions[id];
      if (t && (t.status === "sent" || t.status === "not-sent")) delete state.transmissions[id];
    }
  }
  for (const [id, a] of Object.entries(state.agreements)) {
    if (remove.has(a.conversation)) {
      delete state.agreements[id];
      removedAgreements++;
    }
  }
  for (const [key, e] of Object.entries(state.effects)) {
    if (remove.has(e.conversation) && settled(e)) {
      delete state.effects[key];
      removedEffects++;
    }
  }

  // Local tasks.
  let removedTasks = 0;
  const doneTasks = Object.values(state.tasks)
    .filter(
      (t) =>
        (t.status === "concluded" || t.status === "denied") &&
        (state.effects[t.effectKey]?.status ?? "concluded") === "concluded",
    )
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  let taskExcess = Math.max(0, Object.keys(state.tasks).length - policy.maxTasks);
  for (const t of doneTasks) {
    const old = now - Date.parse(t.updatedAt) > policy.taskRetentionMs;
    if (old || taskExcess > 0) {
      delete state.tasks[t.id];
      if (state.effects[t.effectKey]) {
        delete state.effects[t.effectKey];
        removedEffects++;
      }
      removedOwners.add(t.id);
      removedTasks++;
      if (taskExcess > 0) taskExcess--;
    }
  }

  if (removedOwners.size > 0) {
    for (const [key, record] of Object.entries(state.domain)) {
      const owner = domainOwner(record);
      if (owner !== undefined && removedOwners.has(owner)) {
        delete state.domain[key];
        removedDomainKeys++;
      }
    }
  }

  let removedApprovals = 0;
  for (const [digest, a] of Object.entries(state.approvals)) {
    if (Date.parse(a.validUntil) <= now) {
      delete state.approvals[digest];
      removedApprovals++;
    }
  }

  const over: string[] = [];
  if (Object.keys(state.conversations).length > policy.maxRetainedConversations)
    over.push("conversations");
  if (Object.keys(state.outbox).length > policy.maxOutboxEntries) over.push("outbox");
  if (Object.keys(state.domain).length > policy.maxDomainEntries) over.push("handler state");
  return {
    removedConversations: remove.size,
    removedOutbox,
    removedEffects,
    removedAgreements,
    removedDomainKeys,
    removedApprovals,
    removedTasks,
    protectedConversations: keep.size,
    ...(over.length > 0 ? { overCapacity: over.join(", ") } : {}),
  };
}
