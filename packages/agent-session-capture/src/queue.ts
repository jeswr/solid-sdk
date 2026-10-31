// AUTHORED-BY Codex GPT-6.1-Sol

import type { ChatConversation } from "@jeswr/solid-chat-interop";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { randomUUID } from "crypto";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { readdir, rename, unlink, writeFile } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { isIgnored, MAX_BYTES, readRegular } from "./io.js";
import { type CapturedSession, digest, record } from "./parsers.js";
import { redactSecrets } from "./redact.js";

/** Local queue envelope. It never contains authentication credentials or raw transcript records. */
export interface QueueEntry extends CapturedSession {
  version: 1;
  target: { podRoot: string; webId: string };
}

async function persist(directory: string, name: string, value: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Capture queue entry exceeds limit");
  const temp = join(directory, `.tmp-${randomUUID()}`);
  try {
    await writeFile(temp, text, { flag: "wx", mode: 0o600, signal });
    signal.throwIfAborted();
    await rename(temp, join(directory, name));
    return name;
  } finally {
    await unlink(temp).catch(() => {});
  }
}

function progressKey(entry: Pick<QueueEntry, "target" | "conversation">) {
  return digest([entry.target, entry.conversation.provider, entry.conversation.conversationId]);
}

async function storedIds(directory: string, name: string, key: string, signal: AbortSignal) {
  let text: string;
  try {
    text = await readRegular(join(directory, name), signal, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
    throw error;
  }
  const progress = record(JSON.parse(text));
  if (
    progress.version !== 1 ||
    progress.key !== key ||
    !Array.isArray(progress.messageIds) ||
    !progress.messageIds.every((id) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))
  )
    throw new Error("Invalid capture progress");
  return progress.messageIds as string[];
}

async function acknowledged(directory: string, key: string, signal: AbortSignal) {
  return new Set(await storedIds(directory, `.progress-${key}`, key, signal));
}

/** Persist source-identity sequence assignments before snapshots, independent of transcript trimming. */
export async function sequenceConversation(
  directory: string,
  target: QueueEntry["target"],
  chat: ChatConversation,
  signal: AbortSignal,
): Promise<ChatConversation> {
  const key = progressKey({ target, conversation: chat });
  const name = `.sequence-${key}`;
  const ids = await storedIds(directory, name, key, signal);
  const positions = new Map(ids.map((id, index) => [id, index]));
  if (positions.size !== ids.length) throw new Error("Invalid capture sequence");
  const previousLength = ids.length;
  const messages = chat.messages.map((message) => {
    const id = message.id as string;
    let position = positions.get(id);
    if (position === undefined) {
      position = ids.length;
      ids.push(id);
      positions.set(id, position);
    }
    // ChatWriter sorts timestamp ties by ID. Keep the existing 64-hex format and
    // opaque source suffix, but never recompute a sequence from retained blocks.
    return { ...message, id: `${position.toString(16).padStart(8, "0")}${id.slice(8)}` };
  });
  if (ids.length !== previousLength)
    await persist(directory, name, { version: 1, key, messageIds: ids }, signal);
  return { ...chat, messages };
}

/** Persist a complete redacted snapshot before network I/O, unless all messages were saved. */
export async function enqueue(directory: string, entry: QueueEntry, signal: AbortSignal) {
  const saved = await acknowledged(directory, progressKey(entry), signal);
  if (entry.conversation.messages.every((message) => saved.has(message.id as string))) return;
  return persist(directory, `${digest(entry)}.json`, entry, signal);
}

function conversation(value: unknown): ChatConversation {
  const c = record(value);
  if (
    (c.provider !== "claude" && c.provider !== "codex") ||
    typeof c.conversationId !== "string" ||
    !/^[a-f0-9]{64}$/.test(c.conversationId) ||
    typeof c.title !== "string" ||
    !Array.isArray(c.messages)
  )
    throw new Error("Invalid capture conversation");
  return {
    provider: c.provider,
    conversationId: c.conversationId,
    title: redactSecrets(c.title),
    messages: c.messages.map((value) => {
      const m = record(value);
      if (
        typeof m.id !== "string" ||
        !/^[a-f0-9]{64}$/.test(m.id) ||
        (m.role !== "user" && m.role !== "assistant" && m.role !== "tool") ||
        typeof m.text !== "string" ||
        typeof m.createdAt !== "string"
      )
        throw new Error("Invalid capture message");
      return { id: m.id, role: m.role, text: redactSecrets(m.text), createdAt: m.createdAt };
    }),
  };
}

/** Replay only this account's snapshots; opt-outs added while offline also apply to old entries. */
export async function replay(
  directory: string,
  target: QueueEntry["target"],
  save: (conversation: ChatConversation) => Promise<unknown>,
  signal: AbortSignal,
  only?: string,
) {
  const files = (await readdir(directory))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name) && (only === undefined || name === only))
    .sort();
  for (const name of files) {
    signal.throwIfAborted();
    const path = join(directory, name);
    let entry: Record<string, unknown>;
    try {
      entry = record(JSON.parse(await readRegular(path, signal, true)));
      if (name !== `${digest(entry)}.json` || entry.version !== 1) continue;
      const account = record(entry.target);
      if (account.podRoot !== target.podRoot || account.webId !== target.webId) continue;
      if (
        !Array.isArray(entry.projectDirectories) ||
        entry.projectDirectories.length === 0 ||
        !entry.projectDirectories.every((value) => typeof value === "string")
      )
        continue;
      if (!(await isIgnored(entry.projectDirectories, signal))) {
        const chat = conversation(entry.conversation);
        const key = progressKey({ target, conversation: chat });
        const saved = await acknowledged(directory, key, signal);
        for (const message of chat.messages) {
          const id = message.id as string;
          if (saved.has(id)) continue;
          signal.throwIfAborted();
          // A resolved one-message save acknowledges the ACL checks and create-only write.
          // Keep receipts across snapshot versions so appends and repeated scans resume too.
          await save({ ...chat, messages: [message] });
          saved.add(id);
          await persist(
            directory,
            `.progress-${key}`,
            { version: 1, key, messageIds: [...saved] },
            signal,
          );
        }
      }
      signal.throwIfAborted();
      await unlink(path);
    } catch {
      // Corrupt/private-file violations and failed/partial uploads remain local for retry.
      // Continue so a single broken entry cannot starve the rest of the queue.
    }
  }
}
