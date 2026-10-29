// AUTHORED-BY Codex GPT-6.1-Sol
export type {
  MessageEvent,
  NotificationContext,
  NotificationDecision,
  ReadMarker,
  UnreadCounts,
  UnreadMessage,
  UnreadSnapshot,
} from "./types";
export { advanceReadMarker, countUnread, decideNotification } from "./unread";
export { UnreadError, type UnreadErrorCode } from "./validation";
