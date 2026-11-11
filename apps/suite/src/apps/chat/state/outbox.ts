// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { Outbox, QueueingStorageClient } from "@jeswr/suite-sdk/offline";
import type { ChatClient, Message } from "../lib/client";
import { messageSubject } from "../lib/model";
import { ChatLocalState } from "./local-state";
import { decodeMessageIntent, type MessageIntent, messageChannel } from "./message-channel";

export interface Outgoing extends Message {
  status?: "sending" | "failed" | undefined;
  localId: string;
  at: Date;
  room: string;
  draft: string;
}
interface Binding {
  outbox: Outbox;
  storage: QueueingStorageClient;
  signal: AbortSignal;
}
interface Transient {
  intent: MessageIntent;
  entry: Outgoing;
  attempt?: Promise<void> | undefined;
}
/** UI adapter. Durable ordering, failures and replay belong to the shared outbox. */
export class ChatOutbox {
  private entries: Outgoing[] = [];
  private listeners = new Set<() => void>();
  private binding: Binding | null = null;
  private generation = 0;
  private durable: Outgoing[] = [];
  private ids = new Map<string, string>();
  // Only the optimistic submission gap and demo deliveries live in memory.
  private transient = new Map<string, Transient>();
  private importing = Promise.resolve();
  constructor(
    private client: Pick<ChatClient, "send" | "webId">,
    private demo = false,
    private local = new ChatLocalState(client.webId),
  ) {}
  snapshot = (): Outgoing[] => this.entries;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update() {
    const combined = new Map(this.durable.map((entry) => [entry.id, entry]));
    for (const [id, item] of this.transient) combined.set(id, item.entry);
    this.entries = [...combined.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const listener of this.listeners) listener();
  }
  private outgoing(intent: MessageIntent, status: Outgoing["status"]): Outgoing {
    const at = new Date(intent.at);
    return {
      id: messageSubject(intent.room, at, intent.id),
      localId: intent.id,
      at,
      room: intent.room,
      draft: intent.content,
      content: intent.content,
      author: this.client.webId,
      published: intent.at,
      mediaType: "text/plain",
      updated: undefined,
      tombstone: false,
      deleted: false,
      edited: false,
      status,
    };
  }
  /** Called only from a committed effect, once the session's storage opens. */
  connect(binding: Binding): () => void {
    binding.signal.throwIfAborted();
    if (binding.outbox.webId !== this.client.webId)
      throw new Error("Chat outbox identity mismatch");
    this.binding = binding;
    const refresh = () => {
      void this.refresh(binding);
    };
    const stop = binding.outbox.on("change", refresh);
    refresh();
    // Effect cleanup/re-registration can overlap an asynchronous legacy import.
    this.importing = this.importing
      .then(() => this.importLegacy(binding))
      .catch(() => {
        /* Retain legacy records on storage failures. */
      });
    this.flush();
    return () => {
      stop();
      if (this.binding === binding) {
        this.binding = null;
        this.generation++;
      }
    };
  }
  private async refresh(binding: Binding) {
    const generation = ++this.generation;
    try {
      const pending = await messageChannel.pending(binding.outbox);
      if (this.binding !== binding || binding.signal.aborted || generation !== this.generation)
        return;
      this.ids.clear();
      this.durable = pending.flatMap((item) => {
        if (!item.intent) return [];
        const entry = this.outgoing(
          item.intent,
          item.status === "failed" || item.status === "conflict" ? "failed" : "sending",
        );
        this.ids.set(entry.id, item.id);
        return [entry];
      });
      this.update();
    } catch {
      /* A later change can refresh an unavailable database. */
    }
  }
  send = (room: string, draft: string): void => {
    const intent = decodeMessageIntent({
      room,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      content: draft,
    });
    const entry = this.outgoing(intent, "sending");
    const item = { intent, entry };
    this.transient.set(entry.id, item);
    this.update();
    this.attempt(item);
  };
  private attempt(item: Transient) {
    const binding = this.binding;
    if (item.attempt || (!this.demo && !binding) || (this.demo && navigator.onLine === false))
      return;
    item.entry = { ...item.entry, status: "sending" };
    this.update();
    item.attempt = (async () => {
      try {
        if (this.demo) {
          const message = await this.client.send(item.intent.room, item.intent.content, {
            id: item.intent.id,
            at: new Date(item.intent.at),
          });
          item.entry = { ...item.entry, ...message, status: undefined };
        } else if (binding) {
          const result = await messageChannel.submit(binding.storage, item.intent);
          if (result.queued) {
            // Once persisted, the outbox owns it even if an effect disconnected
            // during submission. Reconnecting must never resubmit this intent.
            this.transient.delete(item.entry.id);
            if (this.binding?.outbox === binding.outbox && !binding.signal.aborted)
              await this.refresh(this.binding);
          } else item.entry = { ...item.entry, status: undefined };
        }
      } catch {
        if (!binding || (this.binding === binding && !binding.signal.aborted))
          item.entry = {
            ...item.entry,
            status: this.demo && navigator.onLine === false ? "sending" : "failed",
          };
      } finally {
        item.attempt = undefined;
        if (
          this.demo ||
          (this.binding?.outbox === binding?.outbox && !binding?.signal.aborted && this.binding)
        )
          this.update();
      }
    })();
  }
  flush = (): void => {
    // Shell replay owns durable work. Only not-yet-submitted or demo entries need flushing.
    for (const item of this.transient.values())
      if (item.entry.status === "sending") this.attempt(item);
  };
  retry = (id: string): void => {
    const durableId = this.ids.get(id);
    if (durableId && this.binding) void this.binding.outbox.retry(durableId).catch(() => {});
    else {
      const item = this.transient.get(id);
      if (item) this.attempt(item);
    }
  };
  discard = (id: string): void => {
    const durableId = this.ids.get(id);
    const binding = this.binding;
    if (durableId && binding) void binding.outbox.discard(durableId).catch(() => {});
    else {
      this.transient.delete(id);
      this.update();
    }
  };
  acknowledge = (ids: ReadonlySet<string>): void => {
    let changed = false;
    for (const id of ids) changed = this.transient.delete(id) || changed;
    if (changed) this.update();
  };
  private async importLegacy(binding: Binding) {
    const run = () => this.importLegacyLocked(binding);
    // A separate migration lock prevents two tabs importing the same legacy entry.
    // Never take the outbox's own lock here: submit may need to enqueue under it.
    if (typeof navigator !== "undefined" && navigator.locks)
      await navigator.locks.request(`solid-suite:chat:legacy:${this.client.webId}`, run);
    else await run();
  }
  private async importLegacyLocked(binding: Binding) {
    await binding.outbox.ready;
    for (const room of this.local.pendingRooms()) {
      const stored = this.local.read("outbox", room);
      const remaining = Array.isArray(stored) ? [...stored] : [];
      while (remaining.length) {
        if (this.binding !== binding || binding.signal.aborted) return;
        const entry = remaining[0];
        let intent: MessageIntent | undefined;
        try {
          if (!entry || !["sending", "failed"].includes(entry.status))
            throw new Error("Invalid legacy entry");
          intent = decodeMessageIntent({
            room,
            id: entry.localId,
            at: entry.at,
            content: entry.draft,
          });
        } catch {
          /* Drop invalid legacy data without submitting it. */
        }
        if (intent) {
          const id = messageSubject(room, new Date(intent.at), intent.id);
          const existing = await messageChannel.pending(binding.outbox);
          if (this.binding !== binding || binding.signal.aborted) return;
          if (
            !existing.some(
              (item) =>
                item.intent &&
                messageSubject(item.intent.room, new Date(item.intent.at), item.intent.id) === id,
            )
          )
            await messageChannel.submit(binding.storage, intent);
        }
        remaining.shift();
        this.local.write("outbox", room, remaining);
      }
      this.local.write("outbox", room, []);
    }
  }
}
