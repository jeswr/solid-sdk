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
 * name, a `social:inReplyTo` link to an earlier message of the same chat, the
 * forwarded-from name, and the names of attached files. Attachments are recorded by
 * file name only: the importer never opens them, and a path that is absolute, has a
 * scheme, or contains a `..` segment is not recorded at all. Service messages (joins,
 * pins, calls) are not chat content and are left out.
 *
 * The JSON is streamed with the shared bounded reader: only message objects and chat
 * names/ids are retained, each message is capped at 4 MiB (oversized ones are skipped
 * and counted), and keys are read as own properties only.
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
import { recordFragment } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { CLASSES, Message } from "../core/vocab.js";
import { vocabMap } from "./vocab-map.js";

const ID = "telegram";
const SLUG = "social/telegram-messages.ttl";
const CHAT_LISTS = ["chats.list[]", "left_chats.list[]"];
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
    const doc = ctx.resolve(SLUG);
    const store = new Store();
    const seen = new Set<string>();
    let chat: ChatContext = { index: 0, messages: false };
    let rows = 0;
    for await (const entry of jsonEntries(file, MESSAGE_ARRAYS, CHAT_FIELDS, ctx.skip)) {
      if (!MESSAGE_ARRAYS.includes(entry.path)) {
        // A chat's name/id after messages of an earlier chat opens a new chat.
        if (chat.messages) chat = { index: chat.index + 1, messages: false };
        if (entry.path.endsWith("name")) chat.name = cappedText(entry.value, MAX_TITLE_CHARS);
        else chat.id = chatId(entry.value);
        continue;
      }
      if (rows >= ctx.maxRows) break;
      rows++;
      chat.messages = true;
      const parsed = parseTelegramMessage(entry.value);
      if (parsed === "service") continue;
      if (!parsed) {
        ctx.skip();
        continue;
      }
      const chatKey = chat.id !== undefined ? `id:${chat.id}` : `chat:${chat.index}`;
      const key = `${chatKey}|${parsed.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const message = new Message(subjectFor(doc, chatKey, parsed.id), store, DataFactory).mark();
      message.text = parsed.text;
      message.sender = parsed.sender;
      message.dateCreated = parsed.date;
      message.dateModified = parsed.edited;
      message.forwardedFrom = parsed.forwardedFrom;
      message.conversation = chat.name;
      if (parsed.replyTo !== undefined && seen.has(`${chatKey}|${parsed.replyTo}`))
        message.inReplyTo = subjectFor(doc, chatKey, parsed.replyTo);
      for (const name of parsed.attachments) message.attachmentNames.add(name);
    }

    ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
    if (seen.size === 0) return;
    await ctx.write({ slug: SLUG, category: "social", forClass: CLASSES.Message, dataset: store });
  },
};

interface ChatContext {
  readonly index: number;
  name?: string;
  id?: string;
  messages: boolean;
}

export interface TelegramMessage {
  readonly id: number;
  readonly text?: string;
  readonly sender?: string;
  readonly date?: Date;
  readonly edited?: Date;
  readonly forwardedFrom?: string;
  readonly replyTo?: number;
  readonly attachments: readonly string[];
}

function subjectFor(doc: string, chatKey: string, id: number): string {
  return `${doc}#msg-${recordFragment(String(id), `${chatKey}|${id}`)}`;
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
