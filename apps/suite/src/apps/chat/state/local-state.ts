// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol

const PREFIX = "solid-suite:chat:v1:";
type Kind = "outbox" | "draft";
const keyFor = (kind: Kind, webId: string, room: string) =>
  `${PREFIX}${kind}:${JSON.stringify([webId, room])}`;

/** Best-effort local intent storage. Identity and room are checked twice on read. */
export class ChatLocalState {
  private drafts = new Map<string, string>();
  private listeners = new Set<() => void>();
  constructor(readonly webId: string) {}
  /** Remove legacy room queues after importing them into the SDK outbox. */
  removeOutbox(room: string): void {
    try {
      localStorage.removeItem(keyFor("outbox", this.webId, room));
    } catch {
      /* Best effort. */
    }
  }
  read(kind: Kind, room: string): unknown {
    try {
      const raw = localStorage.getItem(keyFor(kind, this.webId, room));
      if (!raw) return undefined;
      const envelope = JSON.parse(raw);
      if (envelope.v === 1 && envelope.webId === this.webId && envelope.room === room)
        return envelope.data;
    } catch {
      /* Disabled storage and corrupt entries are cache misses. */
    }
    return undefined;
  }
  write(kind: Kind, room: string, data: unknown): boolean {
    try {
      localStorage.setItem(
        keyFor(kind, this.webId, room),
        JSON.stringify({ v: 1, webId: this.webId, room, data }),
      );
      return true;
    } catch {
      /* Keep the live intent usable when storage is unavailable/full. */
    }
    return false;
  }
  outboxRoom(key: string | null): string | undefined {
    if (!key?.startsWith(`${PREFIX}outbox:`)) return undefined;
    try {
      const pair: unknown = JSON.parse(key.slice(`${PREFIX}outbox:`.length));
      if (
        Array.isArray(pair) &&
        pair.length === 2 &&
        pair[0] === this.webId &&
        typeof pair[1] === "string"
      )
        return pair[1];
    } catch {
      /* A corrupt key must not hide other rooms' pending sends. */
    }
    return undefined;
  }
  pendingRooms(): string[] {
    const rooms: string[] = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const room = this.outboxRoom(localStorage.key(index));
        if (room !== undefined) rooms.push(room);
      }
    } catch {
      /* Unavailable storage is an empty outbox. */
    }
    return rooms;
  }
  draft = (room: string): string => {
    if (!this.drafts.has(room)) {
      const stored = this.read("draft", room);
      this.drafts.set(room, typeof stored === "string" ? stored : "");
    }
    return this.drafts.get(room) as string;
  };
  setDraft = (room: string, text: string): void => {
    this.write("draft", room, text);
    this.drafts.set(room, text);
    for (const listener of this.listeners) listener();
  };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
