// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReadMarker, UnreadMessage } from "./types";

export type UnreadErrorCode =
  | "invalid-marker"
  | "invalid-timestamp"
  | "invalid-message"
  | "invalid-identity"
  | "invalid-event"
  | "invalid-options"
  | "room-mismatch"
  | "duplicate-message";

/** Fail-closed error; diagnostic text never contains caller-supplied data. */
export class UnreadError extends Error {
  constructor(public readonly code: UnreadErrorCode) {
    super(`Chat unread: ${code}`);
    this.name = "UnreadError";
  }
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function identity(value: unknown, code: UnreadErrorCode): void {
  if (typeof value !== "string" || value.trim() === "") throw new UnreadError(code);
}

/** Same UTC year range and millisecond precision as the existing chat timeline. */
function timestamp(value: unknown): void {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < -62_135_596_800_000 ||
    (value as number) > 253_402_300_799_999
  )
    throw new UnreadError("invalid-timestamp");
}

export function validateMarker(value: ReadMarker): void {
  if (!object(value)) throw new UnreadError("invalid-marker");
  identity(value.roomId, "invalid-marker");
  if (value.lastRead !== null) timestamp(value.lastRead);
}

export function validateMessage(value: UnreadMessage, roomId: string): void {
  if (!object(value)) throw new UnreadError("invalid-message");
  identity(value.id, "invalid-message");
  identity(value.senderId, "invalid-message");
  identity(value.roomId, "invalid-message");
  if (value.roomId !== roomId) throw new UnreadError("room-mismatch");
  timestamp(value.timestamp);
  if (!Array.isArray(value.mentionIds)) throw new UnreadError("invalid-message");
  for (const recipient of value.mentionIds) identity(recipient, "invalid-message");
}
