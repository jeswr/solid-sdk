/**
 * Durable handler state for roles. Several existing domain handlers keep working state in
 * memory (the comparator's collected plans, the patient agent's grant and validated resources,
 * the telemetry provider's agreements). A persistent agent must not lose it on restart, and
 * must not double-apply it when a message is replayed.
 *
 * `durableHandler` keeps that state in the RUNTIME's own domain state (`ctx.setState`), which
 * is persisted in the same snapshots as the conversation, the replay seen-set and the outbox.
 * The handler's business logic is unchanged: the wrapper restores state before EVERY stateful
 * callback and snapshots it after.
 *
 * INTERRUPTION SEMANTICS (what actually holds — there is no whole-message transaction):
 *  - The runtime snapshots once after processing an inbound message. If nothing is persisted
 *    during processing, a crash loses the message's processing AND its state change together;
 *    the message is not in the seen-set and is processed afresh when redelivered.
 *  - Processing that runs an effect persists a WRITE-AHEAD snapshot first (effect `planned` /
 *    `attempting`). That snapshot already contains the seen entry (`processing`), the state set
 *    by callbacks so far, conversation transitions and outbound messages emitted so far. A
 *    crash after it leaves the message `interrupted`: it is NEVER re-dispatched (a redelivery
 *    is a duplicate); `recover()` completes only the RECORDED work — the planned/attempting
 *    effects (reconciled) and owed receipts. Handler steps after the snapshot point that were
 *    not recorded (e.g. a later callback's state change) are not re-run; the operator sees the
 *    `recovery` record and the interrupted message.
 *  - A replayed message is a duplicate at the runtime and never reaches the handler twice.
 * Multi-step side effects are therefore recoverable step by step (write-ahead + reconciliation),
 * not atomic.
 *
 * Scope: the runtime scopes domain state by the CONVERSATION's operation. Restoring before every
 * callback (from that scope, or the handler's initial state when the scope has none) keeps the
 * in-memory state equal to the persisted state of the conversation being processed — including
 * when several handlers of one agent share state (e.g. an offer and its transfer, both acting
 * in the agreement's conversation), and when a callback's effects were not persisted.
 */
import type { Json } from "../core/types.js";
import type { HandlerContext, OperationHandler } from "../runtime/operations.js";

/** Callbacks that may change handler state (all receive a HandlerContext first). */
const STATEFUL = new Set(["onProposal", "onAgreement", "onInvoke", "onDeliver", "onReceipt"]);

export interface DurableState<H, S extends Json> {
  /** Domain-state key (scoped by the handler's operation in the runtime). */
  readonly key: string;
  snapshot(handler: H): S;
  restore(handler: H, state: S): void;
}

export function durableHandler<H extends OperationHandler, S extends Json>(
  handler: H,
  state: DurableState<H, S>,
): H {
  // A deep copy of the state the handler started with (restored where a scope has none).
  const initial = JSON.parse(JSON.stringify(state.snapshot(handler))) as S;
  const hydrate = (ctx: HandlerContext) => {
    const saved = ctx.getState<S>(state.key);
    state.restore(handler, saved ?? (JSON.parse(JSON.stringify(initial)) as S));
  };
  return new Proxy(handler, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function" || !STATEFUL.has(prop))
        return value;
      return async (ctx: HandlerContext, ...rest: unknown[]) => {
        hydrate(ctx);
        const reply = await (value as (...a: unknown[]) => unknown).call(target, ctx, ...rest);
        ctx.setState(state.key, state.snapshot(target));
        return reply;
      };
    },
  });
}

/** The runtime domain-state key a role operation reads for a handler's durable state. */
export function scopedStateKey(op: { id: string; version: string }, key: string): string {
  return `${op.id}@${op.version}:${key}`;
}
