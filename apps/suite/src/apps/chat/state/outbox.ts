// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import type { Outbox, OutboxItem } from "@jeswr/suite-sdk/offline";
import type { ChatClient, Message } from "../lib/client";
import { ChatModelError, messageSubject, roomContainer } from "../lib/model";
import { ChatLocalState } from "./local-state";

const TAG = "chat.message.v1";
/**
 * Chat's own solid-offline queue for one account: the shell's queue and sync sheet never see its
 * records, and each (WebID, storage) pair gets its own database, channel and replay lock (the
 * SDK adds the WebID), so a session on another storage never sees or fails this one's rows. The
 * storage is hashed (53-bit cyrb53) to fit the SDK's namespace alphabet; a collision could only
 * share a database, and every intent also carries its exact storage URL, which `decode` checks.
 */
export function chatOutboxNamespace(storageUrl: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < storageUrl.length; i++) {
    const code = storageUrl.charCodeAt(i);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  const hash = (4294967296 * (2097151 & b) + (a >>> 0)).toString(16).padStart(14, "0");
  return `chat-${hash}`;
}
const DAY_DOCUMENT = /\/\d{4}\/\d{2}\/\d{2}\.ttl$/;
export interface Outgoing extends Message {
  status?: "sending" | "failed" | undefined;
  localId: string;
  at: Date;
  room: string;
  draft: string;
  queueId?: string | undefined;
  /** Held only in memory (a room outside the user's storage): a failure fails the row. */
  unsaved?: true | undefined;
}
export interface ChatOutboxConnection {
  outbox: Outbox;
  storage(): Promise<StorageClient>;
}
const isDuplicate = (error: unknown): error is ChatModelError =>
  error instanceof ChatModelError && error.code === "duplicate";
/**
 * The message a resend that reported a duplicate refers to. A v2 room stores it in the sender's
 * member container, so the stored ID (not the room-level intent ID) is the one the timeline holds.
 */
const duplicateOf = (item: Outgoing, error: ChatModelError): Message => ({
  ...item,
  id: error.subject ?? item.id,
});
/** The SDK's rejection of a destination it can never replay (enqueue's `describeRequest`). */
const invalidDestination = (error: unknown) =>
  error instanceof TypeError ||
  (error instanceof StorageError && (error.code === "scope" || error.code === "bad-request"));
/** How often rows waiting on an unusable session check whether it is usable again. */
const SESSION_POLL_MS = 2000;
const documentOf = (item: Outgoing) => item.id.split("#")[0]!;
/**
 * Chat presentation and delivery policy over the SDK's durable, cross-tab queue. Without a
 * working IndexedDB (no factory, or one that cannot open) rows are held in memory and sent
 * directly, as before the queue moved to the SDK.
 */
export class ChatOutbox {
  private entries: Outgoing[] = [];
  private listeners = new Set<() => void>();
  /** The durable queue, only while it is open and usable. */
  private connection: ChatOutboxConnection | undefined;
  private revision = 0;
  private removing = new Set<string>();
  private enqueuing = new Map<string, Promise<unknown>>();
  /** Decoded intents by queue item ID; an intent's bytes never change. */
  private intents = new Map<string, Outgoing>();
  private storages = new WeakMap<ChatOutboxConnection, Promise<StorageClient>>();
  /** Storage discovery failed while online: waiting rows show Retry until it succeeds. */
  private unreachable = false;
  private flushing: Promise<void> | undefined;
  /** In-flight direct sends, and the entries that are delivered directly (not queued). */
  private direct = new Set<string>();
  private local = new Set<string>();
  /** The tail of the direct sends to each day document: one read-modify-write at a time. */
  private lanes = new Map<string, Promise<void>>();
  /** In-memory rows whose legacy localStorage copy is kept until they are sent or discarded. */
  private legacy = new Set<string>();
  /** Intent IDs delivered under another stored ID (v2 rooms) whose record is not yet pruned. */
  private settled = new Set<string>();
  /** Replay failed while online (say, IndexedDB writes keep failing): rows show Retry. */
  private stalled = false;
  /** A flush was requested during a pass: run another once it ends. */
  private again = false;
  /** A send was cut short by a session rebuild: it stays pending and a later pass resumes it. */
  private interrupted = false;
  /** Direct sends interrupted by a session rebuild, to resume once their turn has ended. */
  private resend = new Set<string>();
  /** Checks for a usable session while rows wait; no replay runs until it is. */
  private waker: ReturnType<typeof setTimeout> | undefined;
  /** True once the queue was disconnected (or before it first connects): no timer may be armed. */
  private closed = true;
  ready: Promise<void> = Promise.resolve();
  constructor(
    private client: Pick<ChatClient, "send" | "webId" | "storageUrl">,
    private online: () => boolean,
    private open: () => ChatOutboxConnection,
    private onSaved?: (message: Message) => void,
    /**
     * False once the account was switched or signed out, possibly before React retires this
     * queue (the session's fetch then throws). Fences delivery as the shell's `outboxTransport`
     * does: a send that fails then is not the message's fault, so it stays pending.
     */
    private active: () => boolean = () => true,
    /**
     * The identity of the current session. A send that fails after it changed (a same-account
     * rebuild) was cut short by the rebuild, not refused: it stays pending.
     */
    private session: () => unknown = () => undefined,
  ) {}
  snapshot = (): Outgoing[] => this.entries;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(entries: Outgoing[]) {
    this.entries = entries;
    for (const listener of this.listeners) listener();
  }
  private patch(id: string, change: (entry: Outgoing) => Outgoing) {
    if (this.entries.some((entry) => entry.id === id))
      this.update(this.entries.map((entry) => (entry.id === id ? change(entry) : entry)));
  }
  private outgoing(room: string, draft: string, localId: string, at: Date): Outgoing {
    return {
      id: messageSubject(room, at, localId),
      localId,
      at,
      room,
      draft,
      content: draft,
      author: this.client.webId,
      published: at.toISOString(),
      mediaType: "text/plain",
      updated: undefined,
      tombstone: false,
      deleted: false,
      edited: false,
      reactions: [],
      status: "sending",
    };
  }
  private decode(body: Uint8Array | null, url: string): Outgoing {
    const value = JSON.parse(new TextDecoder().decode(body ?? new Uint8Array()));
    if (
      value?.webId !== this.client.webId ||
      value.storageUrl !== this.client.storageUrl ||
      typeof value.room !== "string" ||
      typeof value.draft !== "string" ||
      typeof value.localId !== "string" ||
      typeof value.at !== "string"
    )
      throw new TypeError("Invalid chat intent");
    const item = this.outgoing(value.room, value.draft, value.localId, new Date(value.at));
    if (item.id.split("#")[0] !== url) throw new TypeError("Chat intent destination mismatch");
    return item;
  }
  private queued(connection: ChatOutboxConnection): OutboxItem[] {
    return connection.outbox.pending().filter((item) => item.guard?.tag === TAG);
  }
  /** Read each intent's body once; a read failure is retried on the next refresh. */
  private async intent(
    connection: ChatOutboxConnection,
    item: OutboxItem,
  ): Promise<Outgoing | undefined> {
    const known = this.intents.get(item.id);
    if (known) return known;
    try {
      const decoded = this.decode(await connection.outbox.localBody(item.id), item.url);
      this.intents.set(item.id, decoded);
      return decoded;
    } catch {
      return undefined;
    }
  }
  /** Entries this tab could replay now: waiting or left mid-send, and not blocked. */
  private deliverable(connection: ChatOutboxConnection): boolean {
    return this.queued(connection).some(
      (item) => (item.status === "waiting" || item.status === "replaying") && !item.blocked,
    );
  }
  /** Replay progress marker: a pass that changes nothing (say, held behind a conflict) stops. */
  private progress(connection: ChatOutboxConnection): string {
    return JSON.stringify(this.queued(connection).map((item) => [item.id, item.status]));
  }
  private async refresh(connection: ChatOutboxConnection) {
    if (this.connection !== connection) return;
    const revision = ++this.revision;
    const pending = this.queued(connection);
    const entries = await Promise.all(
      pending.map(async (item) => {
        const entry = await this.intent(connection, item);
        if (!entry) return undefined;
        const failed =
          item.status === "failed" ||
          item.status === "conflict" ||
          this.unreachable ||
          this.stalled;
        return { ...entry, queueId: item.id, status: failed ? "failed" : "sending" } as Outgoing;
      }),
    );
    if (this.connection !== connection || revision !== this.revision) return;
    const live = new Set(pending.map((item) => item.id));
    for (const id of this.intents.keys()) if (!live.has(id)) this.intents.delete(id);
    const decoded = new Set(entries.map((entry) => entry?.id));
    for (const id of this.settled) if (!decoded.has(id)) this.settled.delete(id);
    const kept = this.entries.filter((entry) => !entry.queueId || !entry.status);
    const byId = new Map(kept.map((entry) => [entry.id, entry]));
    for (const entry of entries)
      if (
        entry &&
        !this.removing.has(entry.id) &&
        !this.settled.has(entry.id) &&
        (!byId.has(entry.id) || byId.get(entry.id)?.status !== undefined)
      )
        byId.set(entry.id, entry);
    this.update([...byId.values()]);
  }
  /**
   * Whether solid-offline can replay this entry: it replays only within the user's storage, the
   * canonical scope check storage-client's `isWithinStorage` applies. Anything else (a room on
   * another pod, joined from an invite link) would be stored but never deliverable.
   */
  private queueable(item: Outgoing): boolean {
    const url = documentOf(item);
    // Fails closed: an unusable storage URL sends directly rather than queuing.
    return isWithinPodScope(this.client.storageUrl, url) && new URL(url).href === url;
  }
  private enqueue(connection: ChatOutboxConnection, item: Outgoing): Promise<OutboxItem> {
    return connection.outbox.enqueue({
      op: "write",
      url: documentOf(item),
      body: JSON.stringify({
        webId: this.client.webId,
        storageUrl: this.client.storageUrl,
        room: item.room,
        draft: item.draft,
        localId: item.localId,
        at: item.at.toISOString(),
      }),
      contentType: "application/vnd.solid-suite.chat-intent+json",
      label: "Send chat message",
      guard: { tag: TAG },
      initialStatus: item.status === "failed" ? "failed" : "waiting",
    });
  }
  /** The valid legacy entries of one room's localStorage envelope; corrupt ones are skipped. */
  private legacyEntries(local: ChatLocalState, room: string) {
    const stored = local.read("outbox", room);
    const entries: { value: { localId: string; status: string }; item: Outgoing }[] = [];
    for (const value of Array.isArray(stored) ? stored : []) {
      try {
        const item = this.decode(
          new TextEncoder().encode(
            JSON.stringify({
              ...value,
              webId: this.client.webId,
              storageUrl: this.client.storageUrl,
              room,
            }),
          ),
          documentOf(this.outgoing(room, "", String(value.localId), new Date(value.at))),
        );
        if (["sending", "failed"].includes(value.status)) {
          item.status = value.status;
          entries.push({ value, item });
        }
      } catch {
        // Corrupt: dropped, and must not block the rest or hydration.
      }
    }
    return entries;
  }
  /** Show a legacy entry that only lives in memory; its localStorage copy goes once it is sent. */
  private hold(item: Outgoing) {
    this.legacy.add(item.id);
    this.local.add(item.id);
    if (!this.entries.some((entry) => entry.id === item.id)) this.update([...this.entries, item]);
  }
  /**
   * Without a durable queue (no IndexedDB), legacy localStorage entries are still shown and sent
   * from memory; each leaves localStorage only once delivered or discarded.
   */
  private holdLegacy() {
    const local = new ChatLocalState(this.client.webId);
    for (const room of local.pendingRooms())
      for (const { item } of this.legacyEntries(local, room)) this.hold(item);
  }
  /** One-time import only: localStorage no longer participates in live queue state. */
  private async migrate(connection: ChatOutboxConnection) {
    const local = new ChatLocalState(this.client.webId);
    const run = async () => {
      for (const room of local.pendingRooms()) {
        const kept: unknown[] = [];
        for (const { value, item } of this.legacyEntries(local, room)) {
          try {
            if (!this.queueable(item)) throw new Error("Not replayable from the queue");
            await this.enqueue(connection, item);
          } catch (error) {
            if (invalidDestination(error)) continue;
            // A room outside the storage, or a storage failure (quota, a write error): keep
            // the legacy copy and show the entry so it can still be sent.
            kept.push(value);
            this.hold(item);
          }
        }
        // Processed, including invalid envelopes and non-array values: never re-read.
        if (kept.length) local.write("outbox", room, kept);
        else local.removeOutbox(room);
      }
    };
    if (typeof navigator !== "undefined" && navigator.locks)
      await navigator.locks.request(`solid-suite:chat-migrate:${this.client.webId}`, run);
    else await run();
  }
  /** One pod client per connection; a failed discovery is retried by the next delivery. */
  private async storage(connection: ChatOutboxConnection): Promise<StorageClient> {
    let pending = this.storages.get(connection);
    if (!pending) {
      pending = Promise.resolve().then(() => connection.storage());
      this.storages.set(connection, pending);
    }
    try {
      const storage = await pending;
      this.setUnreachable(connection, false);
      return storage;
    } catch (error) {
      this.storages.delete(connection);
      if (this.online() && this.active()) this.setUnreachable(connection, true);
      throw error;
    }
  }
  private setUnreachable(connection: ChatOutboxConnection, value: boolean) {
    if (this.unreachable === value) return;
    this.unreachable = value;
    void this.refresh(connection);
  }
  /** Drop the legacy localStorage copy of a row that was sent or discarded. */
  private forget(item: Outgoing) {
    if (!this.legacy.delete(item.id)) return;
    const local = new ChatLocalState(this.client.webId);
    const stored = local.read("outbox", item.room);
    const rest = (Array.isArray(stored) ? stored : []).filter(
      (value) => value?.localId !== item.localId,
    );
    if (rest.length) local.write("outbox", item.room, rest);
    else local.removeOutbox(item.room);
  }
  private delivered(item: Outgoing, message: Message) {
    this.forget(item);
    if (message.id !== item.id) this.settled.add(item.id);
    this.onSaved?.(message);
    this.patch(item.id, (entry) => ({
      ...entry,
      ...message,
      room: item.room,
      status: undefined,
    }));
  }
  /**
   * In-memory delivery when the durable queue is unavailable for this entry. Sends to one day
   * document run one at a time, as replay does, so quick sends never race on one ETag.
   */
  private async deliver(item: Outgoing): Promise<void> {
    this.local.add(item.id);
    if (this.direct.has(item.id)) return;
    this.direct.add(item.id);
    this.patch(item.id, (entry) => ({ ...entry, status: "sending" }));
    const document = documentOf(item);
    const turn = (this.lanes.get(document) ?? Promise.resolve()).then(() => this.attempt(item));
    this.lanes.set(document, turn);
    try {
      await turn;
    } finally {
      this.direct.delete(item.id);
      if (this.lanes.get(document) === turn) this.lanes.delete(document);
    }
    if (this.resend.delete(item.id)) void this.flush();
  }
  private async attempt(item: Outgoing): Promise<void> {
    // Discarded while waiting for its turn: never post it.
    if (!this.entries.some((entry) => entry.id === item.id)) return;
    const started = this.session();
    try {
      let message: Message = item;
      try {
        message = await this.client.send(item.room, item.draft, { id: item.localId, at: item.at });
      } catch (error) {
        if (!isDuplicate(error)) {
          if (this.session() !== started) {
            // Cut short by a session rebuild: stays pending, resumed once this turn has ended.
            this.resend.add(item.id);
            this.patch(item.id, (entry) => ({ ...entry, status: "sending" }));
            return;
          }
          throw error;
        }
        message = duplicateOf(item, error);
      }
      this.delivered(item, message);
    } catch {
      // Offline rows wait for reconnection, unless nothing would keep them over a reload; any
      // failure while online offers Retry and Discard.
      this.patch(item.id, (entry) => ({
        ...entry,
        status: (this.online() && this.active()) || entry.unsaved ? "failed" : "sending",
      }));
    }
  }
  /** Open storage and register the delegate only after React commits. */
  connect = (): (() => void) => {
    this.closed = false;
    const close = (): void => {
      this.closed = true;
      this.stopWaiting();
    };
    this.intents.clear();
    this.unreachable = false;
    this.stalled = false;
    let connection: ChatOutboxConnection;
    try {
      connection = this.open();
    } catch {
      // No IndexedDB (blocked site data, some embedded webviews): deliver directly.
      this.connection = undefined;
      this.holdLegacy();
      this.ready = Promise.resolve();
      return close;
    }
    if (connection.outbox.webId !== this.client.webId) {
      connection.outbox.close();
      throw new Error("Chat outbox identity mismatch");
    }
    this.connection = connection;
    const chatRoot = `${roomContainer(this.client.storageUrl)}chat/`;
    const stops = [
      connection.outbox.registerGuardPolicy(
        TAG,
        ({ url }) => url.startsWith(chatRoot) && DAY_DOCUMENT.test(url),
      ),
      connection.outbox.on("change", () => {
        // Also picks up entries another tab returned to waiting or left mid-send on close.
        void this.refresh(connection).then(() => this.kick());
      }),
      connection.outbox.registerDelegate(TAG, async (delivery, { signal }) => {
        signal.throwIfAborted();
        if (delivery.op !== "write" || delivery.purpose !== "replay")
          throw new TypeError("Invalid chat delivery");
        const item = this.decode(delivery.body, delivery.url);
        const network = () => new StorageError("network", { url: delivery.url, method: "PATCH" });
        const fenced = () => !this.online() || !this.active() || this.connection !== connection;
        if (fenced()) throw network();
        const started = this.session();
        let message: Message = item;
        try {
          message = await this.client.send(item.room, item.draft, {
            id: item.localId,
            at: item.at,
          });
        } catch (error) {
          if (!isDuplicate(error)) {
            // Offline, or the account left (or this queue was retired) mid-replay: the SDK keeps
            // the entry waiting. Otherwise every failure (5xx, 429 and fetch errors included)
            // fails the row so Retry and Discard show.
            if (signal.aborted || fenced()) throw network();
            if (this.session() !== started) {
              this.interrupted = true;
              throw network();
            }
            throw new Error(error instanceof Error ? error.message : "Couldn't send the message");
          }
          message = duplicateOf(item, error);
        }
        if (this.connection === connection) this.delivered(item, message);
      }),
    ];
    let open = true;
    const disconnect = () => {
      if (!open) return;
      open = false;
      for (const stop of stops) stop();
      this.stopWaiting();
      if (this.connection === connection) this.connection = undefined;
      connection.outbox.close();
    };
    this.ready = connection.outbox.ready.then(
      async () => {
        if (this.connection !== connection) return;
        await this.migrate(connection).catch(() => undefined);
        await this.refresh(connection);
      },
      () => {
        // IndexedDB exists but cannot open: keep Chat usable by sending directly.
        if (this.connection !== connection) return;
        disconnect();
        this.holdLegacy();
        for (const entry of this.entries) this.local.add(entry.id);
        this.update(this.entries.map((entry) => ({ ...entry, queueId: undefined })));
      },
    );
    void this.ready.then(() => this.flush());
    // Unmount closes the queue even when the open-failure path already disconnected it.
    return () => {
      close();
      disconnect();
    };
  };
  /** Flush again after a completed pass, or on change, while this tab has work it could send. */
  private kick() {
    const connection = this.connection;
    if (!connection || this.flushing) return;
    // A row that arrived (or was retried) while the session is unusable resumes once it is.
    if (!this.active()) return this.waitForSession();
    if (!this.unreachable && this.online() && this.deliverable(connection)) void this.flush();
  }
  send = async (room: string, draft: string): Promise<void> => {
    const item = this.outgoing(room, draft, crypto.randomUUID(), new Date());
    // Never enqueued: solid-offline could store it but never replay it (the SDK scope check).
    if (!this.queueable(item)) item.unsaved = true;
    this.update([...this.entries, item]);
    await this.ready;
    const connection = this.connection;
    if (!connection || item.unsaved) return this.deliver(item);
    let queued: OutboxItem;
    try {
      const enqueue = this.enqueue(connection, item);
      this.enqueuing.set(
        item.id,
        enqueue.catch(() => undefined),
      );
      queued = await enqueue.finally(() => this.enqueuing.delete(item.id));
    } catch {
      // A quota or storage error after opening: this entry is sent directly instead.
      return this.deliver(item);
    }
    this.patch(item.id, (entry) => ({ ...entry, queueId: queued.id }));
    await this.refresh(connection);
    await this.flush();
  };
  /**
   * One pass at a time. A request that arrives during a pass (a rebuilt session's flush, say)
   * is not lost: another pass runs once this one ends, and after a pass a rebuild cut short.
   */
  flush = (): Promise<void> => {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      let progressed = false;
      try {
        do {
          this.again = false;
          this.interrupted = false;
          progressed = await this.flushOnce();
          if (this.interrupted && this.active()) this.again = true;
        } while (this.again);
      } finally {
        this.flushing = undefined;
      }
      if (progressed) this.kick();
      this.waitForSession();
    })();
    return this.flushing;
  };
  /**
   * While the session is unusable nothing replays: rows wait, and a timer checks (without any
   * request) whether it is usable again, so the rows are retried exactly then.
   */
  private waitForSession() {
    if (
      this.closed ||
      this.waker ||
      this.active() ||
      !this.entries.some((entry) => entry.status === "sending")
    )
      return;
    this.waker = setTimeout(() => {
      this.waker = undefined;
      if (this.closed) return;
      if (this.active()) void this.flush();
      else this.waitForSession();
    }, SESSION_POLL_MS);
  }
  private stopWaiting() {
    clearTimeout(this.waker);
    this.waker = undefined;
  }
  /** True only after a replay pass that changed the queue, so failures and holds never spin. */
  private async flushOnce(): Promise<boolean> {
    await this.ready;
    if (!this.online() || !this.active()) return false;
    const direct = this.entries.filter(
      (entry) => entry.status === "sending" && this.local.has(entry.id),
    );
    await Promise.all(direct.map((entry) => this.deliver(entry)));
    const connection = this.connection;
    if (!connection || !this.deliverable(connection)) return false;
    const before = this.progress(connection);
    const storage = await this.storage(connection).catch(() => undefined);
    // Durable entries stay for the next trigger.
    if (!storage || !(await this.replay(connection, storage))) return false;
    await this.refresh(connection);
    return this.progress(connection) !== before;
  }
  /** Replay, showing queued rows as failed while it keeps failing online. */
  private async replay(connection: ChatOutboxConnection, storage: StorageClient): Promise<boolean> {
    let replayed = true;
    try {
      await connection.outbox.replay(storage);
    } catch {
      replayed = false;
    }
    // Offline, the rows keep waiting for reconnection as before.
    const stalled = !replayed && this.online() && this.active();
    if (this.stalled !== stalled) {
      this.stalled = stalled;
      await this.refresh(connection);
    }
    return replayed;
  }
  retry = async (id: string): Promise<void> => {
    await this.ready;
    const item = this.entries.find((entry) => entry.id === id);
    if (!item) return;
    const connection = this.connection;
    if (!connection || !item.queueId) return this.deliver(item);
    const queueId = item.queueId;
    try {
      // Replay first so retry has a client; it also delivers rows left waiting.
      if (
        (await this.replay(connection, await this.storage(connection))) &&
        connection.outbox.pending().some((p) => p.id === queueId && p.status === "failed")
      )
        await connection.outbox.retry(queueId);
    } catch {
      /* The row stays failed (or waiting) with Retry and Discard. */
    }
    await this.refresh(connection);
    // Retried while the session is unusable: the row waits for it, with a timer to resume it.
    this.waitForSession();
  };
  private remove = async (ids: ReadonlySet<string>): Promise<void> => {
    if (!ids.size) return;
    for (const id of ids) this.removing.add(id);
    for (const entry of this.entries) if (ids.has(entry.id)) this.forget(entry);
    this.update(this.entries.filter((entry) => !ids.has(entry.id)));
    try {
      await this.ready;
      const connection = this.connection;
      if (!connection) return;
      await Promise.all([...ids].map((id) => this.enqueuing.get(id)));
      // One read from IndexedDB: acknowledgement can precede a channel update.
      await connection.outbox.localBody([...ids][0] as string);
      for (const item of this.queued(connection)) {
        const entry = await this.intent(connection, item);
        if (entry && ids.has(entry.id)) await connection.outbox.discard(item.id);
      }
      await this.refresh(connection);
    } catch {
      /* The row is already hidden; a later acknowledgement or Discard prunes the intent. */
    } finally {
      for (const id of ids) this.removing.delete(id);
    }
  };
  discard = (id: string): Promise<void> => this.remove(new Set([id]));
  acknowledge = (ids: ReadonlySet<string>): Promise<void> => this.remove(ids);
}
