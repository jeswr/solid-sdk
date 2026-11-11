// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ChatClient, Message } from "../lib/client";
import { messageSubject } from "../lib/model";
import { ChatLocalState } from "./local-state";
export interface Outgoing extends Message {
  status?: "sending" | "failed" | undefined;
  localId: string;
  at: Date;
  room: string;
  draft: string;
}
/** Stable intent IDs and a per-room write queue, independent of React lifecycles. */
export class ChatOutbox {
  private entries: Outgoing[] = [];
  private listeners = new Set<() => void>();
  private inFlight = new Set<string>();
  private queues = new Map<string, Promise<void>>();
  constructor(
    private client: Pick<ChatClient, "send" | "webId">,
    private online: () => boolean,
    private local = new ChatLocalState(client.webId),
    private onSaved?: (message: Message) => void,
  ) {
    for (const room of local.pendingRooms()) {
      const stored = local.read("outbox", room);
      if (!Array.isArray(stored)) continue;
      for (const entry of stored) {
        if (
          !entry ||
          typeof entry.localId !== "string" ||
          typeof entry.at !== "string" ||
          typeof entry.draft !== "string" ||
          !["sending", "failed"].includes(entry.status)
        )
          continue;
        try {
          this.entries.push(
            this.outgoing(room, entry.draft, entry.localId, new Date(entry.at), entry.status),
          );
        } catch {
          /* Ignore invalid IDs/timestamps, never send a corrupt intent. */
        }
      }
    }
  }
  snapshot = (): Outgoing[] => this.entries;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(entries: Outgoing[]) {
    const rooms = new Set([...this.entries, ...entries].map((entry) => entry.room));
    for (const room of rooms)
      this.local.write(
        "outbox",
        room,
        entries
          .filter((entry) => entry.room === room && entry.status)
          .map(({ localId, at, draft, status }) => ({
            localId,
            at: at.toISOString(),
            draft,
            status,
          })),
      );
    this.entries = entries;
    for (const listener of this.listeners) listener();
  }
  private outgoing(
    room: string,
    draft: string,
    localId: string,
    at: Date,
    status: "sending" | "failed",
  ): Outgoing {
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
      status,
    };
  }
  send = (room: string, draft: string): void => {
    const item = this.outgoing(room, draft, crypto.randomUUID(), new Date(), "sending");
    this.update([...this.entries, item]);
    this.attempt(item);
  };
  private attempt(item: Outgoing) {
    if (!this.online() || this.inFlight.has(item.id)) return;
    this.inFlight.add(item.id);
    this.update(
      this.entries.map((entry) => (entry.id === item.id ? { ...entry, status: "sending" } : entry)),
    );
    const queue = (this.queues.get(item.room) ?? Promise.resolve()).then(async () => {
      try {
        if (!this.online()) return;
        const message = await this.client.send(item.room, item.draft, {
          id: item.localId,
          at: item.at,
        });
        this.onSaved?.(message);
        this.update(
          this.entries.map((entry) =>
            entry.id === item.id
              ? { ...item, ...message, room: item.room, status: undefined }
              : entry,
          ),
        );
      } catch {
        this.update(
          this.entries.map((entry) =>
            entry.id === item.id
              ? { ...entry, status: this.online() ? "failed" : "sending" }
              : entry,
          ),
        );
      } finally {
        this.inFlight.delete(item.id);
      }
    });
    this.queues.set(item.room, queue);
  }
  flush = (): void => {
    for (const item of this.entries) if (item.status === "sending") this.attempt(item);
  };
  retry = (id: string): void => {
    const item = this.entries.find((entry) => entry.id === id);
    if (item) this.attempt(item);
  };
  discard = (id: string): void => {
    this.update(this.entries.filter((entry) => entry.id !== id));
  };
  acknowledge = (ids: ReadonlySet<string>): void => {
    const remaining = this.entries.filter((entry) => !ids.has(entry.id));
    if (remaining.length !== this.entries.length) this.update(remaining);
  };
}
