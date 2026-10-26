// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChatMessage, RoomSnapshot } from "./receipts";

export type TimelineErrorCode =
  | "invalid-message"
  | "invalid-room"
  | "invalid-timestamp"
  | "invalid-options"
  | "invalid-reaction"
  | "invalid-identity";

/** Fail-closed input error; messages never include caller-supplied data. */
export class TimelineError extends Error {
  constructor(public readonly code: TimelineErrorCode) {
    super(`Chat timeline: ${code}`);
    this.name = "TimelineError";
  }
}

export function nonblank(value: string, code: TimelineErrorCode): void {
  if (typeof value !== "string" || value.trim() === "") throw new TimelineError(code);
}

/** No coercion, fractional milliseconds, or date-parser rollover. */
export function timestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < -62_135_596_800_000 || value > 253_402_300_799_999) {
    throw new TimelineError("invalid-timestamp");
  }
}

/** Only compare already-validated unique keys, using locale-independent UTF-16 order. */
export function compareUniqueId(a: string, b: string): number {
  return a < b ? -1 : 1;
}

export function sortedMessages<T extends ChatMessage>(room: RoomSnapshot<T>): T[] {
  if (!room || typeof room !== "object") throw new TimelineError("invalid-room");
  nonblank(room.roomId, "invalid-room");
  if (!Array.isArray(room.messages)) throw new TimelineError("invalid-message");
  if (room.lastRead !== null) timestamp(room.lastRead);
  const ids = new Set<string>();
  for (const message of room.messages) {
    if (!message || typeof message !== "object") throw new TimelineError("invalid-message");
    nonblank(message.id, "invalid-message");
    nonblank(message.senderId, "invalid-message");
    if (message.roomId !== room.roomId || ids.has(message.id)) {
      throw new TimelineError("invalid-message");
    }
    timestamp(message.timestamp);
    ids.add(message.id);
  }
  return [...room.messages].sort(
    (a, b) => a.timestamp - b.timestamp || compareUniqueId(a.id, b.id),
  );
}
