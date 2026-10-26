// AUTHORED-BY Codex GPT-6.1-Sol
import { generateKeyBetween } from "../../../lib/order";
import { NotesError } from "./validation";

export interface OrderableNote {
  readonly pinned: boolean;
  /** Epoch milliseconds, as a safe integer. */
  readonly updatedAt: number;
  /** SH-L1 base-62 fractional key. Omit for recency ordering. */
  readonly orderKey?: string;
}

/**
 * Pinned first; each section uses keys ascending or updatedAt descending.
 * Mixed keyed/unkeyed notes within a section are rejected. Equal ranks are stable.
 * Returns a fresh array, preserving each note object and any additional fields.
 */
export function orderNotes<T extends OrderableNote>(notes: readonly T[]): T[] {
  if (!Array.isArray(notes)) {
    throw new NotesError("invalid-input", "Expected a note array");
  }
  const modes = new Map<boolean, boolean>();
  for (const note of notes) {
    if (
      note === null ||
      typeof note !== "object" ||
      typeof note.pinned !== "boolean" ||
      !Number.isSafeInteger(note.updatedAt)
    ) {
      throw new NotesError("invalid-input", "Invalid note ordering fields");
    }
    const keyed = note.orderKey !== undefined;
    if (keyed) {
      if (typeof note.orderKey !== "string") {
        throw new NotesError("invalid-order-key", "Expected an SH-L1 order key");
      }
      try {
        generateKeyBetween(note.orderKey, null);
      } catch {
        throw new NotesError("invalid-order-key", "Expected an SH-L1 order key");
      }
    }
    if (modes.has(note.pinned) && modes.get(note.pinned) !== keyed) {
      throw new NotesError("mixed-ordering", "Each pinned section must use one ordering mode");
    }
    modes.set(note.pinned, keyed);
  }
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.orderKey !== undefined && b.orderKey !== undefined) {
      return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;
    }
    return b.updatedAt - a.updatedAt;
  });
}
