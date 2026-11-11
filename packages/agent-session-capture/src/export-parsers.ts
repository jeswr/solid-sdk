// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChatConversation, ChatMessage } from "@jeswr/solid-chat-interop";
import { MAX_BYTES } from "./io.js";
import { digest, record } from "./parsers.js";
import { redactConversation } from "./redact.js";

const MAX_CONVERSATIONS = 10000;
const MAX_MESSAGES = 100000;
const MAX_PARTS = 10000;
const EPOCH = "1970-01-01T00:00:00.000Z";

function iso(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value))
    return undefined;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : undefined;
}

function seconds(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parts(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  if (values.length > MAX_PARTS) throw new Error("Export content exceeds limit");
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      const block = record(value);
      return (block.type === undefined || block.type === "text") && typeof block.text === "string"
        ? block.text
        : "";
    })
    .filter(Boolean);
}

function parse(text: string, provider: "chatgpt" | "claude"): ChatConversation[] {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Export exceeds limit");
  const data: unknown = JSON.parse(text);
  const list = Array.isArray(data) ? data : record(data).conversations;
  if (!Array.isArray(list)) throw new Error("Invalid conversations export");
  if (list.length > MAX_CONVERSATIONS) throw new Error("Export conversation count exceeds limit");
  let count = 0;
  const result: ChatConversation[] = [];
  for (const value of list) {
    const raw = record(value);
    const title = string(provider === "chatgpt" ? raw.title : raw.name) ?? "Untitled conversation";
    const created = provider === "chatgpt" ? seconds(raw.create_time) : iso(raw.created_at);
    const sourceId =
      string(raw.id) ?? string(raw.conversation_id) ?? string(raw.uuid) ?? digest(raw);
    // Separate Claude.ai exports from Claude Code hooks, even if a source ID is reused.
    const conversationId = digest([`${provider}-export`, sourceId]);
    const messages: ChatMessage[] = [];
    const contents = new Map<string, string[]>();
    const seen = new Set<string>();
    const entries =
      provider === "chatgpt"
        ? Object.entries(record(raw.mapping))
        : Array.isArray(raw.chat_messages)
          ? raw.chat_messages.map((message, index) => [String(index), message] as const)
          : [];
    count += entries.length;
    if (count > MAX_MESSAGES) throw new Error("Export message count exceeds limit");
    for (const [key, value] of entries) {
      const message = provider === "chatgpt" ? record(record(value).message) : record(value);
      const role = provider === "chatgpt" ? record(message.author).role : message.sender;
      if (role !== "user" && role !== "human" && role !== "assistant") continue;
      if (message.channel === "analysis" || message.channel === "reasoning") continue;
      let chunks: string[];
      let stamp: string | undefined;
      if (provider === "chatgpt") {
        if (message.recipient !== undefined && message.recipient !== "all") continue;
        const content = record(message.content);
        if (
          content.content_type !== undefined &&
          content.content_type !== "text" &&
          content.content_type !== "multimodal_text"
        )
          continue;
        chunks = parts(content.parts);
        stamp = seconds(message.create_time);
      } else {
        if (Array.isArray(message.content) && message.content.length > MAX_PARTS)
          throw new Error("Export content exceeds limit");
        chunks =
          Array.isArray(message.content) && message.content.length > 0
            ? parts(message.content.filter((block) => record(block).type === "text"))
            : [string(message.text) ?? ""];
        stamp = iso(message.created_at);
      }
      const text = chunks.join("\n").trim();
      if (!text) continue;
      const id = digest([conversationId, string(message.id) ?? string(message.uuid) ?? key]);
      if (seen.has(id)) continue;
      seen.add(id);
      contents.set(id, chunks);
      messages.push({
        id,
        role: role === "assistant" ? "assistant" : "user",
        text,
        createdAt: stamp ?? created ?? EPOCH,
      });
    }
    messages.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (messages.length > 0) {
      // Keep source parts until all adjacent boundaries (including message/batch joins)
      // have been checked. Redacting each part early can hide a token's prefix.
      result.push(
        redactConversation(
          { provider, conversationId, title: title.trim(), messages },
          { chunks: messages.map((message) => contents.get(message.id as string) as string[]) },
        ),
      );
    }
  }
  return result;
}

/** Parse bounded ChatGPT conversation arrays (or a conversations wrapper), retaining textual turns.
 * All mapping branches are retained chronologically, as in the Pod Manager importer.
 * Missing timestamps use the conversation timestamp, then the Unix epoch. IDs are opaque and stable.
 */
export function parseChatgptExport(text: string): ChatConversation[] {
  return parse(text, "chatgpt");
}

/** Parse bounded Claude.ai conversations.json exports, dropping attachments, tools and thinking.
 * Text and titles are redacted before returning; missing timestamps use the same deterministic fallback.
 */
export function parseClaudeExport(text: string): ChatConversation[] {
  return parse(text, "claude");
}
