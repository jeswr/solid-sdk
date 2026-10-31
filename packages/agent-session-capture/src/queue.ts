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

/** Persist a complete redacted snapshot before attempting network I/O. */
export async function enqueue(directory: string, entry: QueueEntry, signal: AbortSignal) {
  signal.throwIfAborted();
  const text = JSON.stringify(entry);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Capture queue entry exceeds limit");
  const temp = join(directory, `.tmp-${randomUUID()}`);
  try {
    await writeFile(temp, text, { flag: "wx", mode: 0o600, signal });
    signal.throwIfAborted();
    await rename(temp, join(directory, `${digest(entry)}.json`));
  } finally {
    await unlink(temp).catch(() => {});
  }
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
) {
  const files = (await readdir(directory))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .sort();
  for (const name of files.slice(0, 100)) {
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
        signal.throwIfAborted();
        await save(chat);
      }
      signal.throwIfAborted();
      await unlink(path);
    } catch {
      // Corrupt/private-file violations and failed/partial uploads remain local for retry.
      // Continue so a single broken entry cannot starve the rest of the queue.
    }
  }
}
