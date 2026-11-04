// AUTHORED-BY Codex GPT-6.1-Sol
/** Host filesystem operations are injected: no unguarded I/O or additional layer dependency. */
import { canonicalJson, digestOf, newUrn } from "@jeswr/agent-model";
import { transmissionRecords } from "./accounting.js";
import type { ControlStore, TransmissionRecord, TransmissionStore } from "./types.js";

export interface DurableFile {
  writeFile(data: string, encoding: "utf8"): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface ExecutorFileSystem {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  open(path: string, flags: string, mode?: number): Promise<DurableFile>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  lstat(path: string): Promise<unknown>;
}
function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
/** A dangling HALT symlink counts as present. Only ENOENT means clear; all other errors propagate. */
export function createHaltFileCheck(
  io: Pick<ExecutorFileSystem, "lstat">,
  path: string,
): ControlStore["haltFileExists"] {
  return async () => {
    try {
      await io.lstat(path);
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  };
}

/**
 * Atomic, fsynced local transmission store. Supply a private daemon directory and a
 * store-wide exclusive function. The daemon must hold its single-writer process lease
 * throughout provider calls; transaction locking alone cannot fence an in-flight process.
 * Node hosts may inject fs/promises directly. No credentials or message bodies are stored.
 */
export async function createFileTransmissionStore(options: {
  readonly io: ExecutorFileSystem;
  readonly directory: string;
  readonly exclusive: TransmissionStore["exclusive"];
}): Promise<TransmissionStore> {
  const { io, directory, exclusive } = options;
  await io.mkdir(directory, { recursive: true, mode: 0o700 });
  const path = `${directory}/transmissions.json`;
  async function list(): Promise<TransmissionRecord[]> {
    let text: string;
    try {
      text = await io.readFile(path, "utf8");
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Invalid transmission store");
    return transmissionRecords(data as TransmissionRecord[]);
  }
  return {
    exclusive,
    list,
    get: async (id) => (await list()).find((r) => r.proposal === id),
    async put(record) {
      const records = await list();
      const data = transmissionRecords([...records, record]);
      const temporary = `${directory}/${digestOf(newUrn()).slice("sha-256:".length)}.tmp`;
      try {
        const file = await io.open(temporary, "wx", 0o600);
        try {
          await file.writeFile(canonicalJson(data), "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        await io.rename(temporary, path);
        const parent = await io.open(directory, "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      } catch (error) {
        // Cleanup is best effort; never replace the original durability failure.
        try {
          await io.unlink(temporary);
        } catch {
          /* already renamed or cleanup unavailable */
        }
        throw error;
      }
    },
  };
}
