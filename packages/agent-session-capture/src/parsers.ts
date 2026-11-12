// AUTHORED-BY Codex GPT-6.1-Sol

import {
  type ChatConversation,
  type ChatMessage,
  normalizeChatAccount,
  redactChatAccount,
} from "@jeswr/solid-chat-interop";
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

/** Optional owner-chosen account label for source identity and redacted provenance. */
export interface AccountOptions {
  account?: string;
}

/** Scope opaque source identity before redacting the label; no-label IDs retain their old bytes. */
export function conversationAccount(conversationId: string, account?: string) {
  const label = normalizeChatAccount(account);
  return label === undefined
    ? { conversationId }
    : {
        conversationId: digest(["chat-account-v1", label, conversationId]),
        account: redactChatAccount(label),
      };
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

function codexSessionId(entries: Record<string, unknown>[], source: string): string {
  const parents = new Map<string, string | undefined>();
  let canonical = source;
  let expected: string | undefined;
  for (const entry of entries) {
    if (entry.type !== "session_meta") continue;
    const metadata = record(entry.payload);
    const id = metadata.id;
    const parent = metadata.forked_from_id ?? undefined;
    if (
      typeof id !== "string" ||
      !id ||
      (parent !== undefined && (typeof parent !== "string" || !parent))
    )
      throw new Error("Invalid Codex session metadata");
    if (parents.has(id)) {
      if (parents.get(id) !== parent) throw new Error("Mixed transcript sessions");
      continue;
    }
    // A fork writes its own metadata first, then the parent's rollout verbatim.
    // Accept only the declared ancestry in that order, including nested forks.
    if (parents.size === 0) canonical = id;
    else if (id !== expected) throw new Error("Mixed transcript sessions");
    parents.set(id, parent);
    if (parent !== undefined && parents.has(parent)) throw new Error("Mixed transcript sessions");
    expected = parent;
  }
  return canonical;
}

function session(
  provider: "claude" | "codex",
  entries: Record<string, unknown>[],
  source: string,
  account?: string,
) {
  const projects = new Set<string>();
  const ids = new Set<string>();
  for (const entry of entries) {
    const metadata = provider === "claude" ? entry : record(entry.payload);
    if (typeof metadata.cwd === "string") projects.add(metadata.cwd);
    const id = entry.sessionId;
    if (provider === "claude" && typeof id === "string" && id) ids.add(id);
  }
  if (ids.size > 1) throw new Error("Mixed transcript sessions");
  const id = provider === "codex" ? codexSessionId(entries, source) : ([...ids][0] ?? source);
  return {
    projectDirectories: [...projects],
    conversation: {
      provider,
      ...conversationAccount(digest([provider, id]), account),
      channel: "hook" as const,
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
  // Identity must survive removal of earlier rows. Capture persists sequence assignments
  // separately before queueing so ChatWriter can also retain timestamp-tie order.
  messages.push({ id: key, role, text: redactSecrets(text), createdAt });
}

/** Parse Claude Code JSONL: user/assistant text and tool names, without arguments/results/thinking. */
export function parseClaudeTranscript(
  jsonl: string,
  source = "claude",
  options: AccountOptions = {},
): CapturedSession {
  const entries = rows(jsonl);
  const result = session("claude", entries, source, options.account);
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
export function parseCodexTranscript(
  jsonl: string,
  source = "codex",
  options: AccountOptions = {},
): CapturedSession {
  const entries = rows(jsonl);
  const result = session("codex", entries, source, options.account);
  const seen = new Set<string>();
  const occurrences = new Map<string, number>();
  let turnId: string | undefined;
  entries.forEach((entry) => {
    if (entry.type === "session_meta") {
      // Replayed rollout segments restart their local occurrence counts.
      occurrences.clear();
      turnId = undefined;
      return;
    }
    const payload = record(entry.payload);
    if (
      entry.type === "turn_context" ||
      (entry.type === "event_msg" &&
        ["task_started", "turn_started"].includes(String(payload.type)))
    ) {
      if (typeof payload.turn_id === "string" && payload.turn_id) turnId = payload.turn_id;
      return;
    }
    if (entry.type !== "response_item") return;
    const createdAt = time(entry.timestamp);
    if (!createdAt) return;
    let key = payload.id ?? payload.call_id ?? undefined;
    if (key === undefined) {
      // Fork rewriting can give identical native rows the same millisecond timestamp.
      // Count each occurrence, scoped by turn when available, rather than dropping it.
      // Per-fingerprint counts survive removal of unrelated rows and earlier turns.
      const fingerprint = digest([createdAt, payload]);
      const scope = turnId ? digest([turnId, fingerprint]) : fingerprint;
      const occurrence = occurrences.get(scope) ?? 0;
      occurrences.set(scope, occurrence + 1);
      key = occurrence === 0 ? scope : digest([scope, occurrence]);
    }
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
