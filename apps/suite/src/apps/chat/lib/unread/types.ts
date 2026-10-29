// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChatMessage, RoomSnapshot } from "../timeline";

export interface ReadMarker {
  readonly roomId: string;
  /** Integer Unix milliseconds, or null explicitly meaning never read. */
  readonly lastRead: number | null;
}

/** Live message snapshot, not a tombstone or a revision event log. */
export interface UnreadMessage extends ChatMessage {
  /** Resolved exact recipient identities from the typed data layer; no text parsing. */
  readonly mentionIds: readonly string[];
}

export type UnreadSnapshot = RoomSnapshot<UnreadMessage>;

export interface UnreadCounts {
  readonly unreadCount: number;
  readonly mentionCount: number;
}

export interface MessageEvent {
  /** The caller must distinguish new messages from edits, including edits adding mentions. */
  readonly type: "create" | "edit";
  readonly message: UnreadMessage;
}

export interface NotificationContext {
  readonly marker: ReadMarker;
  readonly viewerId: string;
  readonly muted: boolean;
}

export type NotificationDecision =
  | { readonly notify: true; readonly reason: "message" | "mention" }
  | { readonly notify: false; readonly reason: "edit" | "own-message" | "already-read" | "muted" };
