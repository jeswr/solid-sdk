// AUTHORED-BY Codex GPT-6.1-Sol

import type { ChatConversation, ChatMessage } from "@jeswr/solid-chat-interop";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { createHash } from "crypto";
import { redactSecrets } from "./redact.js";

/** Redacted canonical conversation and local-only project locations used for opt-out checks. */
export interface CapturedSession {
  conversation: ChatConversation;
  projectDirectories: string[];
}

/** Internal deterministic opaque identifiers; source identifiers never become pod paths. */
export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Narrow untrusted JSON without coercing foreign values. */
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rows(jsonl: string): Record<string, unknown>[] {
  return jsonl.split(/\r?\n/).map((line) => {
    try {
      return record(JSON.parse(line));
    } catch {
      // Rollouts may be read while being appended; ignore incomplete/malformed rows.
      return {};
    }
  });
}

function time(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return undefined;
  return new Date(value).toISOString();
}

function session(provider: "claude" | "codex", entries: Record<string, unknown>[], source: string) {
  const projects = new Set<string>();
  const ids = new Set<string>();
  for (const entry of entries) {
    const metadata = provider === "claude" ? entry : record(entry.payload);
    if (typeof metadata.cwd === "string") projects.add(metadata.cwd);
    const id =
      provider === "claude" ? entry.sessionId : entry.type === "session_meta" && metadata.id;
    if (typeof id === "string" && id) ids.add(id);
  }
  if (ids.size > 1) throw new Error("Mixed transcript sessions");
  const id = [...ids][0] ?? source;
  return {
    projectDirectories: [...projects],
    conversation: {
      provider,
      conversationId: digest([provider, id]),
      title: provider === "claude" ? "Claude Code session" : "Codex session",
      messages: [] as ChatMessage[],
    },
  };
}

function append(
  messages: ChatMessage[],
  seen: Set<string>,
  id: unknown,
  role: "user" | "assistant" | "tool",
  text: unknown,
  createdAt: string,
) {
  if (typeof text !== "string" || text.length === 0) return;
  if (role === "tool" && !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(text)) return;
  const key = digest(id);
  if (seen.has(key)) return;
  seen.add(key);
  // ChatWriter sorts timestamp ties by ID. Prefix the retained block sequence,
  // keeping the queue's 64-hex format and a 224-bit opaque source-identity suffix.
  const messageId = `${messages.length.toString(16).padStart(8, "0")}${key.slice(8)}`;
  messages.push({ id: messageId, role, text: redactSecrets(text), createdAt });
}

/** Parse Claude Code JSONL: user/assistant text and tool names, without arguments/results/thinking. */
export function parseClaudeTranscript(jsonl: string, source = "claude"): CapturedSession {
  const entries = rows(jsonl);
  const result = session("claude", entries, source);
  const seen = new Set<string>();
  entries.forEach((entry, line) => {
    if (entry.type !== "user" && entry.type !== "assistant") return;
    const message = record(entry.message);
    const role = message.role;
    const createdAt = time(entry.timestamp);
    if ((role !== "user" && role !== "assistant") || !createdAt) return;
    const key = entry.uuid ?? message.id ?? line;
    const blocks = Array.isArray(message.content)
      ? message.content
      : [{ type: "text", text: message.content }];
    blocks.forEach((value, index) => {
      const block = record(value);
      if (block.type === "text")
        append(result.conversation.messages, seen, [key, index], role, block.text, createdAt);
      if (role === "assistant" && block.type === "tool_use")
        append(result.conversation.messages, seen, [key, index], "tool", block.name, createdAt);
    });
  });
  return result;
}

/** Parse Codex rollout response_item rows; event_msg mirrors, reasoning and tool outputs are dropped. */
export function parseCodexTranscript(jsonl: string, source = "codex"): CapturedSession {
  const entries = rows(jsonl);
  const result = session("codex", entries, source);
  const seen = new Set<string>();
  entries.forEach((entry, line) => {
    if (entry.type !== "response_item") return;
    const payload = record(entry.payload);
    const createdAt = time(entry.timestamp);
    if (!createdAt) return;
    const key = payload.id ?? payload.call_id ?? line;
    if (payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
      const role = payload.role;
      if (!Array.isArray(payload.content)) return;
      payload.content.forEach((value, index) => {
        const block = record(value);
        if (["input_text", "output_text", "text"].includes(String(block.type)))
          append(result.conversation.messages, seen, [key, index], role, block.text, createdAt);
      });
    }
    if (payload.type === "function_call" || payload.type === "custom_tool_call")
      append(result.conversation.messages, seen, [key, "tool"], "tool", payload.name, createdAt);
    if (payload.type === "local_shell_call")
      append(result.conversation.messages, seen, [key, "tool"], "tool", "shell", createdAt);
    if (payload.type === "web_search_call")
      append(result.conversation.messages, seen, [key, "tool"], "tool", "web_search", createdAt);
    if (payload.type === "image_generation_call")
      append(
        result.conversation.messages,
        seen,
        [key, "tool"],
        "tool",
        "image_generation",
        createdAt,
      );
  });
  return result;
}
