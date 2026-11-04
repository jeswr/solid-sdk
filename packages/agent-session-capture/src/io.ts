// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { constants } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { lstat, mkdir, open, realpath } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { dirname, isAbsolute, join, resolve } from "path";
import { redactSecrets } from "./redact.js";

export const MAX_BYTES = 16 * 1024 * 1024;

/** Bounded regular-file reads, refusing symlinks, devices and pipes. */
export async function readRegular(path: string, signal: AbortSignal, privateFile = false) {
  signal.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES || (privateFile && (stat.mode & 0o7777) !== 0o600))
      throw new Error("Unsafe capture file");
    const text = await file.readFile("utf8");
    signal.throwIfAborted();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Capture file grew beyond limit");
    return text;
  } finally {
    await file.close();
  }
}

/** Presence of a marker in either the lexical or real ancestor chain opts out. Errors fail closed. */
export async function isIgnored(directories: string[], signal: AbortSignal): Promise<boolean> {
  for (const directory of directories) {
    if (!isAbsolute(directory) || redactSecrets(directory) !== directory) return true;
    for (let current of new Set([resolve(directory), await realpath(directory)])) {
      for (;;) {
        signal.throwIfAborted();
        try {
          await lstat(join(current, ".solid-capture-ignore"));
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
  }
  return false;
}

/** Create only private, non-symlink capture directories under the operator's home. */
export async function queueDirectory(home: string): Promise<string> {
  const base = join(home, ".local", "state", "solid-capture");
  const queue = join(base, "queue");
  for (const path of [base, queue]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (!stat.isDirectory() || (stat.mode & 0o7777) !== 0o700)
      throw new Error("Capture state requires private directories");
  }
  return queue;
}
