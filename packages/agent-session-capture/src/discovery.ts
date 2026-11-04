// AUTHORED-BY Codex GPT-6.1-Sol

// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { readdir } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { readRegular } from "./io.js";
import { digest } from "./parsers.js";
import { persist, type QueueEntry } from "./queue.js";

async function* rollouts(
  directory: string,
  signal: AbortSignal,
  thread: string | undefined,
  preferred: boolean,
): AsyncGenerator<string> {
  signal.throwIfAborted();
  let entries: import("fs").Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    signal.throwIfAborted();
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* rollouts(path, signal, thread, preferred);
    if (
      entry.isFile() &&
      /^rollout-.*\.jsonl$/.test(entry.name) &&
      (thread !== undefined && entry.name.endsWith(`-${thread}.jsonl`)) === preferred
    )
      yield path;
  }
}

/** Prioritize native notification filenames, then resume a bounded scan using an opaque cursor. */
export async function* discoverRollouts(
  root: string,
  directory: string,
  target: QueueEntry["target"],
  signal: AbortSignal,
  thread?: string,
): AsyncGenerator<string> {
  // Filenames are only a priority hint. Capture still validates the parsed session identity.
  if (thread !== undefined) yield* rollouts(root, signal, thread, true);
  const name = `.scan-${digest([target, thread ?? null])}`;
  let cursor: string | undefined;
  try {
    const stored = JSON.parse(await readRegular(join(directory, name), signal, true));
    if (typeof stored !== "string" || !/^[a-f0-9]{64}$/.test(stored))
      throw new Error("Invalid capture scan cursor");
    cursor = stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Walk past the previous cursor without reading transcripts, then wrap once. If its
  // file was removed, the second pass scans everything rather than losing the frontier.
  for (let pass = 0; pass < (cursor === undefined ? 1 : 2); pass++) {
    let resumed = cursor === undefined || pass === 1;
    for await (const path of rollouts(root, signal, thread, false)) {
      const key = digest(path);
      if (!resumed) {
        if (key === cursor) resumed = true;
        continue;
      }
      // Commit the frontier before parsing: one slow/malformed rollout cannot consume
      // every invocation's deadline. The next complete cycle retries it.
      await persist(directory, name, key, signal);
      yield path;
      if (key === cursor) return;
    }
  }
}
