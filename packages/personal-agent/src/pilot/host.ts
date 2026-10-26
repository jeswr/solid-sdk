/**
 * The HOST of one persistent agent: a serialised service over the single runtime owner of an
 * agent directory (`openAgent`), shared by every local interface (MCP on stdio, the optional
 * A2A listener). There is exactly one runtime implementation; interfaces are adapters.
 *
 * Two kinds of input stay distinct:
 *  - OPERATOR calls (the local owner/operator): inspect, run the role's declared domain
 *    operations, submit an OWNER-SIGNED approval, list/acknowledge outbound envelopes;
 *  - PEER DELIVERY (`deliver`): one signed peer message, carried by some binding. Whichever
 *    interface carried it, the runtime verifies integrity, pinned keys, representation,
 *    policy, audience and replay before any effect.
 *
 * Calls are serialised (one at a time against the agent). Once `stopAccepting()` is called no
 * new call is accepted (atomically), at most MAX_QUEUED_CALLS may wait, and `drain()` waits for
 * the accepted ones.
 */
import type { OpenAgent } from "./cli.js";
import { PILOT_PROFILE_VERSION } from "./profile/vocabulary.js";
import type { OperationContext, OperatorOperation } from "./roles/index.js";
import type { OutboundMessage } from "./runtime/agent.js";
import {
  type InputFormat,
  NOT_SENT_NOTICE,
  type ProcessedOutbound,
  type ProcessReport,
  prepareOutbound,
  processInput,
  summariseStep,
} from "./service.js";
import { FileLedger, verifyLedger } from "./store/ledger.js";

export type Json = Record<string, unknown>;

/** Largest inbound peer message accepted by `deliver`. */
export const MAX_INBOUND_BYTES = 256 * 1024;
/** Largest serialised result of one call (tools and resources alike). */
export const MAX_RESULT_BYTES = 512 * 1024;
/** Most calls that may wait for the agent at once; more are refused (busy). */
export const MAX_QUEUED_CALLS = 32;
/** Largest owner approval (a compact JWS). */
export const MAX_APPROVAL_BYTES = 16 * 1024;
export const MAX_LIST = 50;
export const MAX_EVIDENCE = 100;

/** Outbound items as shown to the operator: signed envelope + email payload if prepared. */
export function showOutbound(items: readonly ProcessedOutbound[]): Json[] {
  return items.map((o) => ({
    id: o.id,
    kind: o.kind,
    conversation: o.conversation,
    ...(o.toActor ? { toActor: o.toActor } : {}),
    status: o.status,
    // A protected disclosure whose basis no longer holds is not rendered.
    ...(o.withheld ? { withheld: o.withheld } : { envelope: o.envelope }),
    ...(o.email && !o.withheld
      ? {
          email: {
            from: o.email.from,
            to: o.email.to,
            subject: o.email.subject,
            emailMessageId: o.email.emailMessageId,
            gmailSend: o.email.gmailSend,
          },
        }
      : {}),
    checks: o.checks,
  }));
}

export function showReport(r: ProcessReport): Json {
  return {
    input: r.input,
    ...(r.step ? { step: r.step } : {}),
    outbound: showOutbound(r.outbound),
    notice: r.notice,
  };
}

/** A local interface this host is reachable through (shown in the profile). */
export interface HostInterface {
  readonly binding: string;
  readonly transport: string;
  readonly notAuthentication: string;
  readonly [k: string]: unknown;
}

/** A call was not admitted (nothing ran against the agent). */
export class HostRefusal extends Error {}

/** Most prepared outbound renderings kept in memory (a cache; the outbox itself is durable). */
export const MAX_PREPARED_CACHE = 200;

export class AgentHost {
  readonly #prepared = new Map<string, ProcessedOutbound>();
  readonly #interfaces: HostInterface[] = [];
  readonly #listeners = new Set<() => void>();
  #chain: Promise<unknown> = Promise.resolve();
  #pending = 0;
  #closing = false;
  /** The role's declared domain operations (operator-side; never peer-reachable). */
  readonly operations: readonly OperatorOperation[];

  constructor(
    readonly agent: OpenAgent,
    readonly now: () => Date,
  ) {
    const ctx: OperationContext = {
      rt: agent.rt,
      now,
      trust: agent.trustData,
      calendar: agent.calendar,
      pinnedPeer: (actor) => {
        const peer = agent.trustData.keys.find((k) => k.role === "actor" && k.subject === actor);
        if (!peer?.party)
          throw new Error("not a pinned peer actor with a pinned party; pin its card first");
        return { actor: peer.subject, party: peer.party };
      },
      prepare: (outbound) => this.prepare(outbound),
      show: showOutbound,
    };
    this.operations = agent.domain.operations(ctx);
    const names = new Set<string>();
    for (const op of this.operations) {
      if (names.has(op.name)) throw new Error(`duplicate role operation ${op.name}`);
      names.add(op.name);
    }
  }

  get pending(): number {
    return this.#pending;
  }

  get closing(): boolean {
    return this.#closing;
  }

  addInterface(info: HostInterface): void {
    this.#interfaces.push(info);
  }

  /** Called (synchronously, after the call that produced them) when new outbound exists. */
  onOutbound(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const l of this.#listeners) l();
  }

  /**
   * Run one call against the agent, serialised and bounded. Admission refusals (shutting
   * down, busy) reject with `HostRefusal` BEFORE `fn` runs; any other rejection comes from `fn`.
   */
  call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#closing)
      return Promise.reject(new HostRefusal("server is shutting down; call refused"));
    if (this.#pending >= MAX_QUEUED_CALLS)
      return Promise.reject(new HostRefusal(`server busy: ${this.#pending} calls already queued`));
    this.#pending++;
    const run = this.#chain.then(fn, fn).finally(() => {
      this.#pending--;
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  /** Stop accepting calls (atomic: every later `call` is refused). */
  stopAccepting(): void {
    this.#closing = true;
  }

  /** Wait until every accepted call has finished. */
  async drain(): Promise<void> {
    while (this.#pending > 0) await this.#chain;
  }

  // ---------------------------------------------------------------- operations (call inside `call`)

  async prepare(outbound: readonly OutboundMessage[]): Promise<ProcessedOutbound[]> {
    const items = await prepareOutbound(
      this.agent.rt,
      outbound,
      this.#emailSettings(),
      this.agent.threads,
      this.now(),
    );
    this.#remember(items);
    if (items.length > 0) this.#notify();
    return items;
  }

  /**
   * The ONE insertion path into the prepared-rendering cache, bounded to MAX_PREPARED_CACHE
   * (oldest evicted). Eviction loses nothing: pending messages stay in the durable outbox and
   * are re-prepared on demand by `listOutbound`.
   */
  #remember(items: readonly ProcessedOutbound[]): void {
    for (const i of items) this.#prepared.set(i.id, i);
    while (this.#prepared.size > MAX_PREPARED_CACHE)
      this.#prepared.delete(this.#prepared.keys().next().value as string);
  }

  /** Size of the prepared-rendering cache (for bound checks). */
  get preparedCacheSize(): number {
    return this.#prepared.size;
  }

  #emailSettings() {
    return this.agent.email ? { selfAddress: this.agent.email } : {};
  }

  pinnedPeers(): Json[] {
    return this.agent.trustData.keys
      .filter((k) => k.role === "actor")
      .map((k) => ({
        actor: k.subject,
        ...(k.party ? { party: k.party } : {}),
        endpoints: k.endpoints ?? [],
        keyThumbprint: k.kid,
      }));
  }

  profile(): Json {
    const a = this.agent;
    return {
      agent: {
        name: a.name,
        actor: a.rt.identity.actor,
        ...(a.rt.identity.party ? { party: a.rt.identity.party } : {}),
        ...(a.rt.identity.operator ? { operator: a.rt.identity.operator } : {}),
        role: a.role,
      },
      profileVersion: PILOT_PROFILE_VERSION,
      description: a.rt.description() as unknown as Json,
      policyModule: { ...a.rt.policyModule(), source: a.policy.source },
      pinnedPeers: this.pinnedPeers(),
      operations: this.operations.map((o) => ({ name: o.name, title: o.title })),
      interfaces: [...this.#interfaces],
    };
  }

  status(): Json {
    const a = this.agent;
    return {
      role: a.role,
      policyModule: { ...a.rt.policyModule(), source: a.policy.source },
      mandate: a.rt.mandateStatus(),
      conversations: a.rt
        .conversations()
        .slice(-MAX_LIST)
        .map((c) => ({
          id: c.id,
          role: c.role,
          peer: c.peer,
          phase: c.phase,
          ...(c.closedReason ? { closedReason: c.closedReason } : {}),
          outcomes: c.outcomes,
          ...(c.agreement ? { agreement: c.agreement } : {}),
        })),
      pendingApprovals: a.rt.pendingApprovals().slice(0, MAX_LIST),
      effects: a.rt
        .effectStates()
        .slice(-MAX_LIST)
        .map((e) => ({ key: e.key, status: e.status, conclusion: e.conclusion })),
      ...(a.role === "personal" ? { holds: a.calendar.data.holds } : {}),
      undeliveredOutbound: a.rt.undeliveredOutbound().length,
      transmissions: a.rt.transmissions().slice(-MAX_LIST),
      ...(a.domain.status ? { domain: a.domain.status() } : {}),
    };
  }

  evidence(args: { type?: string; limit?: number }): Json {
    const entries = new FileLedger(`${this.agent.dir}/ledger.jsonl`).entries();
    const selected = entries
      .filter((e) => !args.type || e.record.type === args.type)
      .slice(-(args.limit ?? 20));
    return {
      verification: verifyLedger(entries),
      total: entries.length,
      records: selected.map((e) => {
        const text = JSON.stringify(e.record);
        return {
          seq: e.seq,
          at: e.at,
          hash: e.hash,
          record: text.length > 4096 ? { type: e.record.type, truncated: true } : e.record,
        };
      }),
    };
  }

  /** PEER DELIVERY: one signed peer message carried by `carrier`; verified by the runtime. */
  async deliver(input: {
    format: InputFormat;
    data: string;
    carrier: string;
  }): Promise<ProcessReport> {
    if (Buffer.byteLength(input.data) > MAX_INBOUND_BYTES)
      throw new Error(`inbound message exceeds ${MAX_INBOUND_BYTES} bytes`);
    const report = await processInput(
      this.agent.rt,
      { format: input.format, data: Buffer.from(input.data, "utf8"), carrier: input.carrier },
      { ...this.#emailSettings(), strictParity: true },
      this.agent.threads,
      this.now(),
    );
    this.#remember(report.outbound);
    if (report.outbound.length > 0) this.#notify();
    return report;
  }

  /**
   * OWNER decision: an approval statement signed with the OWNER key (made out of band, e.g. by
   * `awp-pilot sign-approval`). The runtime verifies the owner signature and that it binds to
   * the exact pending action; this host holds no owner key and cannot approve by itself.
   */
  async submitApproval(approval: string): Promise<Json> {
    if (Buffer.byteLength(approval) > MAX_APPROVAL_BYTES)
      throw new Error(`approval exceeds ${MAX_APPROVAL_BYTES} bytes`);
    const step = await this.agent.rt.submitApproval(approval.trim());
    const items = await this.prepare(step.outbound);
    return { step: summariseStep(step), outbound: showOutbound(items), notice: NOT_SENT_NOTICE };
  }

  async runOperation(name: string, args: Record<string, unknown>): Promise<Json> {
    const op = this.operations.find((o) => o.name === name);
    if (!op) throw new Error(`unknown operation ${name}`);
    return op.run(args);
  }

  /** Undelivered outbound messages (optionally only those addressed to one actor). */
  undelivered(toActor?: string): OutboundMessage[] {
    const all = this.agent.rt.undeliveredOutbound() as OutboundMessage[];
    return toActor ? all.filter((m) => m.toActor === toActor) : all;
  }

  /** Byte-aware page of undelivered outbound items (see `list_outbound`). */
  async listOutbound(args: { cursor?: string; limit?: number }): Promise<Json> {
    const all = this.undelivered();
    let start = 0;
    if (args.cursor) {
      const at = all.findIndex((m) => m.id === args.cursor);
      if (at < 0) throw new Error("cursor is no longer pending; list again without a cursor");
      start = at + 1;
    }
    const window = all.slice(start, start + (args.limit ?? MAX_LIST));
    // This page's renderings are held locally, so cache eviction can never drop one of them.
    const byId = new Map<string, ProcessedOutbound>();
    for (const m of window) {
      const cached = this.#prepared.get(m.id);
      if (cached) byId.set(m.id, cached);
    }
    const missing = window.filter((m) => !byId.has(m.id));
    if (missing.length > 0) {
      const items = await prepareOutbound(
        this.agent.rt,
        missing,
        this.#emailSettings(),
        this.agent.threads,
        this.now(),
      );
      for (const i of items) byId.set(i.id, i);
      this.#remember(items);
    }
    // Stop before the result bound; always return at least one item (its email payload is
    // dropped if needed — the signed envelope is what peers verify).
    const page: Json[] = [];
    let used = 1024;
    for (const m of window) {
      let prepared = byId.get(m.id);
      if (!prepared) continue; // could not be prepared (never expected): not shown, stays pending
      // Cached renderings may predate a revocation: re-check a protected disclosure NOW.
      const hold = this.agent.rt.disclosureHold(m.id);
      if (hold.protected && !hold.holds)
        prepared = { ...prepared, status: "blocked", withheld: hold.reason ?? "condition fails" };
      let [item] = showOutbound([prepared]) as [Json];
      let size = Buffer.byteLength(JSON.stringify(item));
      if (page.length === 0 && used + size > MAX_RESULT_BYTES) {
        const { email: _dropped, ...rest } = item;
        item = { ...rest, emailOmitted: "exceeds the result bound; carry the envelope" };
        size = Buffer.byteLength(JSON.stringify(item));
      }
      if (page.length > 0 && used + size > MAX_RESULT_BYTES) break;
      page.push(item);
      used += size;
    }
    const last = page.at(-1)?.id as string | undefined;
    const more = start + page.length < all.length;
    return {
      outbound: page,
      total: all.length,
      ...(more && last ? { nextCursor: last } : {}),
      notice: NOT_SENT_NOTICE,
    };
  }

  /** Record that these outbound messages were handed to a carrier. */
  async ack(ids: readonly string[]): Promise<{ acknowledged: string[]; unknown: string[] }> {
    const pending = new Set(this.agent.rt.undeliveredOutbound().map((m) => m.id));
    const known = ids.filter((id) => pending.has(id));
    if (known.length > 0) await this.agent.rt.markHandedOff(known);
    for (const id of known) this.#prepared.delete(id);
    return { acknowledged: known, unknown: ids.filter((id) => !pending.has(id)) };
  }
}
