// AUTHORED-BY Codex GPT-6.1-Sol
import { sortedMessages, TimelineError } from "./validation";

export interface ChatMessage {
  readonly id: string;
  readonly roomId: string;
  readonly senderId: string;
  /** Integer Unix milliseconds; timestamp parsing belongs to the data layer. */
  readonly timestamp: number;
}

export interface RoomSnapshot<T extends ChatMessage = ChatMessage> {
  readonly roomId: string;
  readonly messages: readonly T[];
  /** null explicitly means never read; equality with a message timestamp is read. */
  readonly lastRead: number | null;
}

export function isUnread(message: ChatMessage, lastRead: number | null): boolean {
  return lastRead === null || message.timestamp > lastRead;
}

/** Counts supplied messages only. Empty rooms are retained with zero. */
export function unreadCountsByRoom(rooms: readonly RoomSnapshot[]): Map<string, number> {
  if (!Array.isArray(rooms)) throw new TimelineError("invalid-room");
  const counts = new Map<string, number>();
  for (const room of rooms) {
    const messages = sortedMessages(room);
    if (counts.has(room.roomId)) throw new TimelineError("invalid-room");
    counts.set(room.roomId, messages.filter((message) => isUnread(message, room.lastRead)).length);
  }
  return counts;
}
