// AUTHORED-BY Codex GPT-6
import { createAccountIdSet } from "@/lib/account-id-set";

const PREFIX = "solid-suite:chat:v1:";
export const INVITATIONS_JOINED = "chat-invitations-joined";
export const DISMISSALS_CHANGED = "chat-invitation-dismissals-changed";
export const invitationDismissalKey = (webId: string) =>
  `${PREFIX}invitation-dismissals:${JSON.stringify([webId])}`;
export const invitationDismissals = (webId: string) =>
  createAccountIdSet(invitationDismissalKey(webId), webId, 200);
type Kind = "outbox" | "draft";
const keyFor = (kind: Kind, webId: string, room: string) =>
  `${PREFIX}${kind}:${JSON.stringify([webId, room])}`;

/** Best-effort local intent storage. Identity and room are checked twice on read. */
export class ChatLocalState {
  private drafts = new Map<string, string>();
  private listeners = new Set<() => void>();
  constructor(readonly webId: string) {}
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
  write(kind: Kind, room: string, data: unknown): void {
    try {
      localStorage.setItem(
        keyFor(kind, this.webId, room),
        JSON.stringify({ v: 1, webId: this.webId, room, data }),
      );
    } catch {
      /* Keep the live intent usable when storage is unavailable/full. */
    }
  }
  pendingRooms(): string[] {
    const rooms: string[] = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(`${PREFIX}outbox:`)) continue;
        try {
          const pair: unknown = JSON.parse(key.slice(`${PREFIX}outbox:`.length));
          if (
            Array.isArray(pair) &&
            pair.length === 2 &&
            pair[0] === this.webId &&
            typeof pair[1] === "string"
          )
            rooms.push(pair[1]);
        } catch {
          /* A corrupt key must not hide other rooms' pending sends. */
        }
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
