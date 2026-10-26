// AUTHORED-BY Codex GPT-6.1-Sol
import type { Clock, ReminderState } from "./types";

export type ReminderErrorCode =
  | "invalid-event"
  | "invalid-trigger"
  | "unsupported-trigger"
  | "invalid-instant"
  | "invalid-window"
  | "invalid-clock"
  | "invalid-state"
  | "invalid-action";

export class ReminderError extends Error {
  constructor(public readonly code: ReminderErrorCode) {
    super(`Calendar reminders: ${code}`);
    this.name = "ReminderError";
  }
}

export function record(value: unknown, keys: readonly string[], code: ReminderErrorCode): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new ReminderError(code);
  }
}

export function id(value: unknown, code: ReminderErrorCode): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new ReminderError(code);
}

export function instant(value: number, code: ReminderErrorCode = "invalid-instant"): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 8_640_000_000_000_000) {
    throw new ReminderError(code);
  }
  return value;
}

export function revision(value: number, code: ReminderErrorCode): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new ReminderError(code);
}

export function now(clock: Clock): number {
  try {
    return instant(clock(), "invalid-clock");
  } catch {
    throw new ReminderError("invalid-clock");
  }
}

export function validateState(state: ReminderState): void {
  if (!(state instanceof Map)) throw new ReminderError("invalid-state");
  for (const [key, entry] of state) {
    id(key, "invalid-state");
    record(entry, ["status", "revision", "until"], "invalid-state");
    revision(entry.revision, "invalid-state");
    if (entry.status === "snoozed") {
      instant(entry.until, "invalid-state");
    } else if ((entry.status !== "delivered" && entry.status !== "dismissed") || "until" in entry) {
      throw new ReminderError("invalid-state");
    }
  }
}
