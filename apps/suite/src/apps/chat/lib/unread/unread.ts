// AUTHORED-BY Codex GPT-6.1-Sol
import type {
  MessageEvent,
  NotificationContext,
  NotificationDecision,
  ReadMarker,
  UnreadCounts,
  UnreadSnapshot,
} from "./types";
import { identity, object, UnreadError, validateMarker, validateMessage } from "./validation";

/** Merge two same-room markers. Null is the minimum; neither input is mutated. */
export function advanceReadMarker(current: ReadMarker, candidate: ReadMarker): ReadMarker {
  validateMarker(current);
  validateMarker(candidate);
  if (current.roomId !== candidate.roomId) throw new UnreadError("room-mismatch");
  const lastRead =
    current.lastRead === null
      ? candidate.lastRead
      : candidate.lastRead === null
        ? current.lastRead
        : Math.max(current.lastRead, candidate.lastRead);
  return { roomId: current.roomId, lastRead };
}

/** Counts supplied live messages only; equality is read, independent of sender or mute. */
export function countUnread(snapshot: UnreadSnapshot, viewerId: string): UnreadCounts {
  validateMarker(snapshot);
  identity(viewerId, "invalid-identity");
  if (!Array.isArray(snapshot.messages)) throw new UnreadError("invalid-message");
  const ids = new Set<string>();
  let unreadCount = 0;
  let mentionCount = 0;
  for (const message of snapshot.messages) {
    validateMessage(message, snapshot.roomId);
    if (ids.has(message.id)) throw new UnreadError("duplicate-message");
    ids.add(message.id);
    if (snapshot.lastRead === null || message.timestamp > snapshot.lastRead) {
      unreadCount++;
      if (message.mentionIds.includes(viewerId)) mentionCount++;
    }
  }
  return { unreadCount, mentionCount };
}

/** Pure eligibility rule; the caller owns event classification and delivery deduplication. */
export function decideNotification(
  event: MessageEvent,
  context: NotificationContext,
): NotificationDecision {
  if (!object(context) || typeof context.muted !== "boolean")
    throw new UnreadError("invalid-options");
  validateMarker(context.marker);
  identity(context.viewerId, "invalid-identity");
  if (!object(event) || (event.type !== "create" && event.type !== "edit")) {
    throw new UnreadError("invalid-event");
  }
  validateMessage(event.message, context.marker.roomId);
  // Validate all inputs even when a later rule would suppress the notification.
  if (event.type === "edit") return { notify: false, reason: "edit" };
  if (event.message.senderId === context.viewerId) return { notify: false, reason: "own-message" };
  if (context.marker.lastRead !== null && event.message.timestamp <= context.marker.lastRead) {
    return { notify: false, reason: "already-read" };
  }
  if (event.message.mentionIds.includes(context.viewerId))
    return { notify: true, reason: "mention" };
  if (context.muted) return { notify: false, reason: "muted" };
  return { notify: true, reason: "message" };
}
