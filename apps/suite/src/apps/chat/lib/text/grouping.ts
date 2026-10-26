// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChatMessage, MessageGroup } from "./types";

export const DEFAULT_GROUP_GAP_MS = 5 * 60 * 1000;

/** Group consecutive messages, preserving order and object identity without mutating input.
 * Boundaries: another author, backwards/invalid time, UTC midnight, or a gap > maxGapMs.
 */
export function groupMessages<T extends ChatMessage>(
  messages: readonly T[],
  maxGapMs = DEFAULT_GROUP_GAP_MS,
): MessageGroup<T>[] {
  if (!Number.isFinite(maxGapMs) || maxGapMs < 0) {
    throw new RangeError("maxGapMs must be a finite non-negative number");
  }
  const groups: MessageGroup<T>[] = [];
  let previous: T | undefined;
  for (const message of messages) {
    const timestamp = new Date(message.timestamp).getTime();
    if (
      previous &&
      message.author === previous.author &&
      Number.isFinite(timestamp) &&
      Number.isFinite(new Date(previous.timestamp).getTime()) &&
      timestamp >= previous.timestamp &&
      timestamp - previous.timestamp <= maxGapMs &&
      Math.floor(timestamp / 86_400_000) === Math.floor(previous.timestamp / 86_400_000)
    ) {
      (groups.at(-1) as MessageGroup<T>).messages.push(message);
    } else {
      groups.push({ author: message.author, messages: [message] });
    }
    previous = message;
  }
  return groups;
}
