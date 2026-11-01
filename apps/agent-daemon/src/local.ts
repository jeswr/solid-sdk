// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { CredentialStore } from "@jeswr/agent-credentials";
import { canonicalJson } from "@jeswr/agent-model";
import { randomUUID } from "crypto";
import { constants } from "fs";
import { lstat, open, rename, unlink } from "fs/promises";
import { join } from "path";
import { checkedProposalResult, proposalResultKey } from "./proposal-results.js";
import type { Checkpoints, ProcessLease, ProposalResults } from "./types.js";

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
async function syncDirectory(directory: string) {
  const file = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
async function readPrivate(path: string): Promise<string | undefined> {
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.mode & 0o077 ||
      stat.uid !== process.getuid?.() ||
      stat.size > 1024 * 1024
    )
      throw new Error("Unsafe local state");
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}
async function writePrivate(directory: string, name: string, text: string) {
  const temporary = join(directory, `${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(text, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, join(directory, name));
    await syncDirectory(directory);
  } finally {
    try {
      await unlink(temporary);
    } catch {
      // Preserve the original durability failure if temporary cleanup also fails.
    }
  }
}
/** A crash leaves the lease present. Recovery requires the operator to establish quiescence. */
export function createProcessLease(directory: string): ProcessLease {
  return {
    async acquire() {
      new CredentialStore({ dir: directory });
      const path = join(directory, "daemon.lock");
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(String(process.pid));
        await file.sync();
        await syncDirectory(directory);
      } catch (error) {
        await file.close();
        throw error;
      }
      const identity = await file.stat();
      let released = false;
      return async () => {
        if (released) return;
        const current = await lstat(path);
        if (current.ino !== identity.ino || current.dev !== identity.dev) {
          await file.close();
          throw new Error("Process lease replaced");
        }
        try {
          await unlink(path);
          await syncDirectory(directory);
        } finally {
          await file.close();
        }
        released = true;
      };
    },
  };
}
export function createLocalState(directory: string) {
  new CredentialStore({ dir: directory });
  const proposalResults: ProposalResults = {
    async get(key) {
      const text = await readPrivate(join(directory, `proposal-${proposalResultKey(key)}.json`));
      return text === undefined ? undefined : checkedProposalResult(JSON.parse(text));
    },
    async put(key, result) {
      await writePrivate(
        directory,
        `proposal-${proposalResultKey(key)}.json`,
        canonicalJson(checkedProposalResult(result)),
      );
    },
  };
  const checkpoints: Checkpoints = {
    async get(account) {
      const text = await readPrivate(join(directory, `cursor-${key(account)}.json`));
      if (text === undefined) return undefined;
      const cursor: unknown = JSON.parse(text);
      if (typeof cursor !== "string") throw new Error("Invalid cursor state");
      return cursor;
    },
    async put(account, cursor) {
      if (typeof cursor !== "string" || Buffer.byteLength(cursor) > 512 * 1024)
        throw new Error("Invalid cursor");
      await writePrivate(directory, `cursor-${key(account)}.json`, JSON.stringify(cursor));
    },
  };
  const halted = async () => {
    try {
      await lstat(join(directory, "HALT"));
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  };
  return {
    checkpoints,
    proposalResults,
    halted,
    async halt() {
      await writePrivate(directory, "HALT", "halted\n");
    },
    async status() {
      let leasePresent = false;
      try {
        await lstat(join(directory, "daemon.lock"));
        leasePresent = true;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      return { halted: await halted(), leasePresent };
    },
  };
}
function key(account: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(account)) throw new Error("Invalid account identifier");
  return account;
}
