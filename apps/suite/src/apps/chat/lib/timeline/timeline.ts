// AUTHORED-BY Codex GPT-6.1-Sol
import { type ChatMessage, isUnread, type RoomSnapshot } from "./receipts";
import { sortedMessages, TimelineError } from "./validation";

export interface TimelineOptions {
  readonly timeZone: string;
  /** Inclusive maximum elapsed gap between adjacent messages, in minutes. */
  readonly groupWithinMinutes: number;
}

export interface MessageGroup<T extends ChatMessage = ChatMessage> {
  readonly kind: "message-group";
  readonly senderId: string;
  readonly messages: T[];
}

export type TimelineItem<T extends ChatMessage = ChatMessage> =
  | { readonly kind: "day-divider"; readonly date: string }
  | { readonly kind: "unread-marker"; readonly beforeMessageId: string }
  | MessageGroup<T>;

function dayFormatter(options: TimelineOptions): Intl.DateTimeFormat {
  if (
    !options ||
    typeof options.timeZone !== "string" ||
    options.timeZone.trim() === "" ||
    !Number.isFinite(options.groupWithinMinutes) ||
    options.groupWithinMinutes < 0 ||
    !Number.isSafeInteger(options.groupWithinMinutes * 60_000)
  ) {
    throw new TimelineError("invalid-options");
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: options.timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new TimelineError("invalid-options");
  }
}

function localDay(formatter: Intl.DateTimeFormat, time: number): string {
  const { year, month, day, era } = Object.fromEntries(
    formatter.formatToParts(time).map(({ type, value }) => [type, value]),
  ) as Record<"year" | "month" | "day" | "era", string>;
  if (era !== "AD" || year.length > 4) throw new TimelineError("invalid-timestamp");
  return `${year.padStart(4, "0")}-${month}-${day}`;
}

/** Chronological timeline; preserves original message payloads without mutating inputs. */
export function buildTimeline<T extends ChatMessage>(
  room: RoomSnapshot<T>,
  options: TimelineOptions,
): { items: TimelineItem<T>[]; unreadCount: number } {
  const formatter = dayFormatter(options);
  const messages = sortedMessages(room);
  const items: TimelineItem<T>[] = [];
  let day: string | undefined;
  let group: MessageGroup<T> | undefined;
  let previousTime = 0;
  let unreadCount = 0;
  for (const message of messages) {
    const date = localDay(formatter, message.timestamp);
    if (date !== day) {
      items.push({ kind: "day-divider", date });
      day = date;
      group = undefined;
    }
    if (isUnread(message, room.lastRead)) {
      if (unreadCount === 0) {
        items.push({ kind: "unread-marker", beforeMessageId: message.id });
        group = undefined;
      }
      unreadCount++;
    }
    if (
      !group ||
      group.senderId !== message.senderId ||
      message.timestamp - previousTime > options.groupWithinMinutes * 60_000
    ) {
      group = { kind: "message-group", senderId: message.senderId, messages: [] };
      items.push(group);
    }
    group.messages.push(message);
    previousTime = message.timestamp;
  }
  return { items, unreadCount };
}
