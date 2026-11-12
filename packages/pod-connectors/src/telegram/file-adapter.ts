// AUTHORED-BY Claude Opus 5.5
/**
 * Telegram → Social & interests (Tier-C file import).
 *
 * Telegram Desktop's Settings → Advanced → Export Telegram data (or a chat's ⋮ →
 * Export chat history), with the machine-readable JSON format, writes `result.json`:
 * either the whole account (`chats.list[]` and `left_chats.list[]`, each with `name`,
 * `id` and `messages[]`) or a single chat (`name`, `id`, `messages[]` at the root).
 *
 * Each `type: "message"` entry becomes a `schema:Message` (the WhatsApp model) with the
 * flattened text (the array-of-entities form is joined), the sender, the time
 * (`date_unixtime`, else the zone-less `date` read as UTC), the edit time, the chat
 * name, a `social:inReplyTo` link to an earlier message of the same chat (never when
 * `reply_to_peer_id` names a different chat), the forwarded-from name, and the names of
 * attached files. Attachments are recorded by
 * file name only: the importer never opens them, and a path that is absolute, has a
 * scheme, or contains a `..` segment is not recorded at all. Service messages (joins,
 * pins, calls) are not chat content and are left out.
 *
 * Each chat is its own document, `social/telegram/<chat key>.ttl`, where the chat key is
 * a 128-bit SHA-256 hash of the chat id: a single-chat export replaces only that chat,
 * never the others imported from an account export. Message subjects are
 * `#msg-<chat key>-<message id>`. A chat without an id cannot be keyed and is skipped
 * (counted once).
 *
 * The JSON is streamed with the shared bounded reader: only message objects and chat
 * names/ids are retained, each message is capped at 4 MiB (oversized ones are skipped
 * and counted), and keys are read as own properties only. Each chat's messages are
 * grouped by the reader's member boundaries, so a chat's `messages` may come before its
 * `name` and `id`.
 */
import { DataFactory, Store } from "n3";
import {
  cappedText,
  exportDate,
  MAX_BODY_CHARS,
  MAX_NAME_CHARS,
  MAX_TITLE_CHARS,
  unixSecondsDate,
} from "../core/export-fields.js";
import type { FileImportAdapter, FileImportContext, ImportFile } from "../core/file-import.js";
import { jsonEntries } from "../core/file-json.js";
import { sha256Hex32 } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { CLASSES, Message } from "../core/vocab.js";
import { vocabMap } from "./vocab-map.js";

const ID = "telegram";
/** Container of the per-chat documents. */
const CHATS = "social/telegram/";
const CHAT_LIST_ARRAYS = ["chats.list", "left_chats.list"];
const CHAT_LISTS = CHAT_LIST_ARRAYS.map((list) => `${list}[]`);
const MESSAGE_ARRAYS = ["messages", ...CHAT_LISTS.map((list) => `${list}.messages`)];
const CHAT_FIELDS = ["name", "id", ...CHAT_LISTS.flatMap((list) => [`${list}.name`, `${list}.id`])];
/** Attachment fields that hold an export-relative path. */
const ATTACHMENT_FIELDS = ["photo", "file", "thumbnail"] as const;
export const MAX_TELEGRAM_ATTACHMENTS = 8;

const metadata: IntegrationMetadata = {
  id: ID,
  name: "Telegram",
  tier: "C",
  authKind: "export-file",
  scopes: [],
  categories: ["social"],
  whatYouGet: "Your exported chats, saved as messages in Social & interests.",
  requirements: [],
};

export const telegramFileAdapter: FileImportAdapter = {
  vocabMap,
  metadata,
  accept: ".json,application/json",
  fileHint:
    "Telegram Desktop → Settings → Advanced → Export Telegram data (or a chat's ⋮ → Export chat history), choosing Machine-readable JSON. Select result.json.",

  async importFile(file: ImportFile, ctx: FileImportContext): Promise<void> {
    ctx.progress({ label: "Reading your chats…", done: 0, total: 1 });
    const chats = new Map<string, ChatDocument>();
    // The root chat (single-chat export) and the current member of an account chat list.
    const root: PendingChat = { messages: [] };
    let member: PendingChat = { messages: [] };
    let rows = 0;
    const entries = jsonEntries(file, MESSAGE_ARRAYS, CHAT_FIELDS, ctx.skip, CHAT_LIST_ARRAYS);
    for await (const entry of entries) {
      if (entry.end) {
        await addChat(member, chats, ctx);
        member = { messages: [] };
        continue;
      }
      const chat = entry.path.includes(".") ? member : root;
      if (!MESSAGE_ARRAYS.includes(entry.path)) {
        // The first name and id win: a repeated key never re-homes earlier messages.
        if (entry.path.endsWith("name"))
          chat.name ??= cappedText(entry.value, MAX_TITLE_CHARS) ?? "";
        else chat.id ??= chatId(entry.value) ?? "";
        continue;
      }
      if (rows >= ctx.maxRows) break;
      rows++;
      const parsed = parseTelegramMessage(entry.value);
      if (parsed === "service") continue;
      if (!parsed) {
        ctx.skip();
        continue;
      }
      chat.messages.push(parsed);
    }
    // A row-capped run stops inside a chat: keep what that chat read so far.
    await addChat(member, chats, ctx);
    await addChat(root, chats, ctx);

    ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
    for (const chat of chats.values()) {
      await ctx.write({
        slug: chat.slug,
        category: "social",
        forClass: CLASSES.Message,
        dataset: chat.store,
      });
    }
  },
};

/** One chat as read from the export: its messages wait until the chat has ended. */
interface PendingChat {
  name?: string;
  id?: string;
  readonly messages: TelegramMessage[];
}

/** One chat's document; an id listed twice (chats and left chats) shares it. */
interface ChatDocument {
  readonly slug: string;
  readonly doc: string;
  readonly key: string;
  readonly id: string;
  readonly store: Store;
  readonly seen: Set<number>;
}

/** Map a finished chat's messages into its document; a chat without an id is skipped. */
async function addChat(
  chat: PendingChat,
  chats: Map<string, ChatDocument>,
  ctx: FileImportContext,
): Promise<void> {
  if (chat.messages.length === 0) return;
  if (!chat.id) {
    ctx.skip();
    return;
  }
  let target = chats.get(chat.id);
  if (!target) {
    const key = await sha256Hex32(chat.id);
    const slug = `${CHATS}${key}.ttl`;
    target = {
      slug,
      doc: ctx.resolve(slug),
      key,
      id: chat.id,
      store: new Store(),
      seen: new Set(),
    };
    chats.set(chat.id, target);
  }
  for (const parsed of chat.messages) {
    if (target.seen.has(parsed.id)) continue;
    target.seen.add(parsed.id);
    const message = new Message(subjectFor(target, parsed.id), target.store, DataFactory).mark();
    message.text = parsed.text;
    message.sender = parsed.sender;
    message.dateCreated = parsed.date;
    message.dateModified = parsed.edited;
    message.forwardedFrom = parsed.forwardedFrom;
    message.conversation = chat.name || undefined;
    if (
      parsed.replyTo !== undefined &&
      target.seen.has(parsed.replyTo) &&
      samePeer(parsed.replyPeer, target.id)
    )
      message.inReplyTo = subjectFor(target, parsed.replyTo);
    for (const name of parsed.attachments) message.attachmentNames.add(name);
  }
}

/**
 * Whether a reply's `reply_to_peer_id` (absent for a same-chat reply, else `channel123`,
 * `user123`, `chat123`) names the chat being read. Unreadable values never match.
 */
function samePeer(peer: unknown, chat: string): boolean {
  if (peer === undefined) return true;
  const match = typeof peer === "string" ? peer.match(/^(?:user|chat|channel)?(\d{1,20})$/) : null;
  if (!match) return false;
  const digits = match[1] as string;
  return chat === digits || chat === `-${digits}` || chat === `-100${digits}`;
}

export interface TelegramMessage {
  readonly id: number;
  readonly text?: string;
  readonly sender?: string;
  readonly date?: Date;
  readonly edited?: Date;
  readonly forwardedFrom?: string;
  readonly replyTo?: number;
  /** The raw `reply_to_peer_id`, present when the replied-to message may be in another chat. */
  readonly replyPeer?: unknown;
  readonly attachments: readonly string[];
}

/** `#msg-<chat key>-<message id>`: the whole key is readable, so no hash is needed. */
function subjectFor(chat: ChatDocument, id: number): string {
  return `${chat.doc}#msg-${chat.key}-${id}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Own properties only: `__proto__`, `constructor` and friends never resolve to built-ins. */
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function messageId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function chatId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return typeof value === "string" && /^-?[A-Za-z0-9_]{1,64}$/.test(value) ? value : undefined;
}

/**
 * One export message, `"service"` for a service entry, or undefined when malformed
 * (not an object, no `type`, or no non-negative integer `id`).
 */
export function parseTelegramMessage(value: unknown): TelegramMessage | "service" | undefined {
  if (!isObject(value)) return undefined;
  const type = own(value, "type");
  if (type === "service") return "service";
  const id = messageId(own(value, "id"));
  if (type !== "message" || id === undefined) return undefined;
  const attachments = new Set<string>();
  for (const field of ATTACHMENT_FIELDS) {
    const name = attachmentName(own(value, field));
    if (name && attachments.size < MAX_TELEGRAM_ATTACHMENTS) attachments.add(name);
  }
  return {
    id,
    text: flattenText(own(value, "text")),
    sender: cappedText(own(value, "from"), MAX_NAME_CHARS),
    date: unixSecondsDate(own(value, "date_unixtime")) ?? zonelessDate(own(value, "date")),
    edited: unixSecondsDate(own(value, "edited_unixtime")) ?? zonelessDate(own(value, "edited")),
    forwardedFrom: cappedText(own(value, "forwarded_from"), MAX_NAME_CHARS),
    replyTo: messageId(own(value, "reply_to_message_id")),
    replyPeer: own(value, "reply_to_peer_id"),
    attachments: [...attachments],
  };
}

/** A plain string, or the entity array (strings and `{ type, text }` parts) joined. */
export function flattenText(value: unknown): string | undefined {
  if (typeof value === "string") return cappedText(value, MAX_BODY_CHARS);
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  let length = 0;
  for (const part of value) {
    const text = typeof part === "string" ? part : isObject(part) ? own(part, "text") : undefined;
    if (typeof text !== "string") continue;
    parts.push(text);
    length += text.length;
    if (length > MAX_BODY_CHARS) break;
  }
  return cappedText(parts.join(""), MAX_BODY_CHARS);
}

/** Telegram's `date` is local time without a zone (`2024-01-02T10:00:00`); read it as UTC. */
function zonelessDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as number[];
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day, hour, minute, second));
  if (
    date.getUTCMonth() !== (month as number) - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  )
    return undefined;
  return exportDate(date);
}

/**
 * The file name of an export-relative attachment path, or undefined. Placeholders such as
 * "(File not included. …)", absolute paths, drive letters, schemes (`file:`, `data:`),
 * control characters and any `.`/`..` segment are refused; nothing is ever opened.
 */
export function attachmentName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  const path = value.trim();
  if (!path || path.startsWith("(")) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(path)) return undefined;
  if (/^[\\/]/.test(path) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return undefined;
  const segments = path.split(/[\\/]/);
  if (segments.some((segment) => segment === "." || segment === "..")) return undefined;
  const name = segments[segments.length - 1];
  return name && name.length <= MAX_NAME_CHARS ? name : undefined;
}
