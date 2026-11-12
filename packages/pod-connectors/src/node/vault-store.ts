// AUTHORED-BY Codex GPT-6.1-Sol
import { constants, lstatSync, mkdirSync, opendirSync, realpathSync, unlinkSync } from "node:fs";
import {
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { getuid, platform } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import {
  ConnectorVaultError,
  MAX_SEALED_CHARS,
  MAX_VAULT_RECORDS,
  type VaultStore,
  validateSealed,
  vaultKey,
} from "../vault.js";

const MAX_FILE_BYTES = MAX_SEALED_CHARS + 16 * 1024;
const TEMP_NAME =
  /^[a-f0-9]{64}\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/;
const STALE_NAME =
  /^[a-f0-9]{64}\.lock\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.stale$/;
const RECORD_NAME = /^[a-f0-9]{64}$/;
const MAX_SCAN_ENTRIES = 10000;
function leftover(name: string): boolean {
  return TEMP_NAME.test(name) || STALE_NAME.test(name);
}
function sameFile(a: import("node:fs").Stats, b: import("node:fs").Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}
function safeFile(stat: import("node:fs").Stats): boolean {
  return (
    stat.isFile() &&
    stat.nlink === 1 &&
    (stat.mode & 0o077) === 0 &&
    stat.size <= MAX_FILE_BYTES &&
    stat.uid === getuid?.()
  );
}
function safeAncestor(stat: import("node:fs").Stats): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    (stat.uid === 0 || stat.uid === getuid?.()) &&
    ((stat.mode & 0o022) === 0 || (stat.mode & 0o1000) !== 0)
  );
}
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function removeTemporary(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!missing(error)) throw new ConnectorVaultError();
  }
}

/** Private POSIX ciphertext files with per-record refresh ownership across processes. */
export class FileVaultStore implements VaultStore {
  private readonly directory: string;
  constructor(directory: string) {
    if (platform === "win32") throw new Error("FileVaultStore requires a POSIX filesystem");
    try {
      if (typeof directory !== "string" || directory.length > 4096) throw new ConnectorVaultError();
      const requested = resolve(directory);
      // The final directory must never be a link. Ancestor aliases (e.g. macOS /tmp)
      // are resolved once, then all creation and safety checks use that canonical path.
      try {
        if (lstatSync(requested).isSymbolicLink()) throw new ConnectorVaultError();
      } catch (error) {
        if (!missing(error)) throw error;
      }
      let ancestor = requested;
      const suffix: string[] = [];
      for (;;) {
        try {
          ancestor = realpathSync(ancestor);
          break;
        } catch (error) {
          if (!missing(error) || suffix.length >= 64) throw error;
          suffix.unshift(parse(ancestor).base);
          ancestor = dirname(ancestor);
        }
      }
      this.directory = join(ancestor, ...suffix);
      const parts: string[] = [];
      for (let path = this.directory; path !== parse(path).root; path = dirname(path)) {
        if (parts.length >= 64) throw new ConnectorVaultError();
        parts.push(path);
      }
      for (const path of parts.reverse()) {
        try {
          mkdirSync(path, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        if (!safeAncestor(lstatSync(path))) throw new ConnectorVaultError();
      }
      const stat = lstatSync(this.directory);
      if ((stat.mode & 0o077) !== 0 || stat.uid !== getuid?.()) throw new ConnectorVaultError();
      this.cleanupTemps();
    } catch {
      throw new ConnectorVaultError();
    }
  }
  private cleanupTemps(): void {
    const directory = opendirSync(this.directory);
    try {
      let count = 0;
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++count > MAX_SCAN_ENTRIES) throw new ConnectorVaultError();
        if (!leftover(entry.name)) continue;
        const path = join(this.directory, entry.name);
        try {
          const stat = lstatSync(path);
          if (
            stat.isFile() &&
            stat.nlink === 1 &&
            stat.uid === getuid?.() &&
            Date.now() - stat.mtimeMs > 10 * 60 * 1000
          )
            unlinkSync(path);
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
    } finally {
      directory.closeSync();
    }
  }
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    let dir: FileHandle | undefined;
    let lock: FileHandle | undefined;
    let path = "";
    try {
      path = join(this.directory, `${await this.filename(id)}.lock`);
      dir = await this.dir();
      const deadline = Date.now() + 65000;
      while (!lock) {
        if (Date.now() >= deadline) throw new ConnectorVaultError();
        let created: FileHandle;
        try {
          created = await open(
            path,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600,
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (await this.breakStaleLock(path)) continue;
          if (Date.now() >= deadline) throw new ConnectorVaultError();
          await delay(25);
          continue;
        }
        try {
          const stat = await created.stat();
          if (!safeFile(stat)) {
            // Remove the name only while it still refers to the file this handle created.
            const current = await lstat(path);
            if (sameFile(current, stat)) await unlink(path);
            throw new ConnectorVaultError();
          }
        } catch (error) {
          await created.close().catch(() => {});
          throw error;
        }
        lock = created;
      }
    } catch {
      await Promise.allSettled([lock?.close(), dir?.close()]);
      throw new ConnectorVaultError();
    }
    // Long-running refreshes keep ownership alive; a crashed owner stops updating mtime.
    const held = lock;
    let heartbeat = Promise.resolve();
    const timer = setInterval(() => {
      heartbeat = heartbeat
        .then(async () => {
          const now = new Date();
          await held.utimes(now, now);
        })
        .catch(() => {});
    }, 15000);
    try {
      return await fn();
    } finally {
      clearInterval(timer);
      await heartbeat;
      try {
        await this.releaseLock(path, held, dir);
      } catch {
        // Keep the callback's value or error. An unreleased lock goes stale after 60 seconds.
      }
    }
  }
  /**
   * Take over a lock whose owner stopped renewing it. Returns true to retry acquisition now.
   * The atomic rename claims exactly one file; it is deleted only if it is the file judged stale.
   * Any other file is a live owner's lock and is restored without clobbering the lock path.
   */
  private async breakStaleLock(path: string): Promise<boolean> {
    let stat: import("node:fs").Stats;
    try {
      stat = await lstat(path);
    } catch (error) {
      if (missing(error)) return true;
      throw error;
    }
    if (stat.isSymbolicLink() || !safeFile(stat)) throw new ConnectorVaultError();
    if (Date.now() - stat.mtimeMs <= 60000) return false;
    const claimed = `${path}.${globalThis.crypto.randomUUID()}.stale`;
    try {
      await rename(path, claimed);
    } catch (error) {
      if (missing(error)) return true;
      throw error;
    }
    let moved: import("node:fs").Stats;
    try {
      moved = await lstat(claimed);
    } catch (error) {
      if (missing(error)) return true;
      throw error;
    }
    if (sameFile(moved, stat)) {
      await removeTemporary(claimed);
      return true;
    }
    // Another waiter replaced the lock first. link() never overwrites, so a lock created at the
    // path meanwhile is kept; the claimed file then ages out and its owner's release mismatches.
    try {
      await link(claimed, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return true;
      throw error;
    }
    await removeTemporary(claimed);
    return true;
  }
  private async releaseLock(path: string, held: FileHandle, dir: FileHandle): Promise<void> {
    try {
      try {
        const stat = await held.stat();
        const current = await lstat(path);
        if (!safeFile(current) || !sameFile(current, stat)) throw new ConnectorVaultError();
        await unlink(path);
      } finally {
        try {
          await held.close();
        } finally {
          await dir.close();
        }
      }
    } catch {
      throw new ConnectorVaultError();
    }
  }
  private async filename(id: string): Promise<string> {
    vaultKey(id);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
  private async dir(): Promise<FileHandle> {
    // Do not follow symlinks in any component, including when creating the directory.
    const parts: string[] = [];
    for (let path = this.directory; path !== parse(path).root; path = dirname(path)) {
      if (parts.length >= 64) throw new ConnectorVaultError();
      parts.push(path);
    }
    parts.reverse();
    for (const path of parts) {
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const stat = await lstat(path);
      if (!safeAncestor(stat)) throw new ConnectorVaultError();
    }
    const handle = await open(
      this.directory,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
    );
    try {
      const stat = await handle.stat();
      if ((stat.mode & 0o077) !== 0 || (getuid && stat.uid !== getuid?.()))
        throw new ConnectorVaultError();
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  private async read(name: string): Promise<{ id: string; sealed: string } | undefined> {
    let handle: FileHandle;
    try {
      const entry = await lstat(join(this.directory, name));
      if (entry.isSymbolicLink()) throw new ConnectorVaultError();
      handle = await open(
        join(this.directory, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
    try {
      const stat = await handle.stat();
      if (!safeFile(stat)) throw new ConnectorVaultError();
      const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_FILE_BYTES) throw new ConnectorVaultError();
      const data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
      );
      if (!data || typeof data.id !== "string" || (await this.filename(data.id)) !== name)
        throw new ConnectorVaultError();
      validateSealed(data.sealed);
      return { id: data.id, sealed: data.sealed };
    } finally {
      await handle.close();
    }
  }
  private async names(): Promise<string[]> {
    this.cleanupTemps();
    const names: string[] = [];
    let count = 0;
    let scanned = 0;
    const directory = await opendir(this.directory);
    for await (const entry of directory) {
      // Unsafe record entries are returned for list() to skip and still count toward budgets.
      if (!RECORD_NAME.test(entry.name) && (entry.isSymbolicLink() || !entry.isFile()))
        throw new ConnectorVaultError();
      if (++scanned > MAX_SCAN_ENTRIES) throw new ConnectorVaultError();
      if (leftover(entry.name)) continue;
      if (++count > MAX_VAULT_RECORDS * 2 + 1) throw new ConnectorVaultError();
      if (RECORD_NAME.test(entry.name)) {
        if (names.length >= MAX_VAULT_RECORDS) throw new ConnectorVaultError();
        names.push(entry.name);
      } else if (!/^[a-f0-9]{64}\.lock$/.test(entry.name)) throw new ConnectorVaultError();
    }
    return names;
  }
  async get(id: string): Promise<string | undefined> {
    try {
      const name = await this.filename(id);
      const dir = await this.dir();
      try {
        return (await this.read(name))?.sealed;
      } finally {
        await dir.close();
      }
    } catch {
      throw new ConnectorVaultError();
    }
  }
  async put(id: string, sealed: string): Promise<void> {
    try {
      const name = await this.filename(id);
      validateSealed(sealed);
      const temporary = join(this.directory, `${name}.${globalThis.crypto.randomUUID()}.tmp`);
      const dir = await this.dir();
      try {
        this.cleanupTemps();
        const existing = await this.read(name);
        if (!existing && (await this.names()).length >= MAX_VAULT_RECORDS)
          throw new ConnectorVaultError();
        const file = await open(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await file.writeFile(JSON.stringify({ id, sealed }), "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        // Refuse an unsafe destination even when replacing it would not follow its symlink.
        await this.read(name);
        await rename(temporary, join(this.directory, name));
        await dir.sync();
      } finally {
        try {
          await removeTemporary(temporary);
        } finally {
          await dir.close();
        }
      }
    } catch {
      throw new ConnectorVaultError();
    }
  }
  async delete(id: string): Promise<void> {
    try {
      const name = await this.filename(id);
      const dir = await this.dir();
      try {
        // Disconnect must work even after a record's mode was loosened: unlink any regular
        // file this user owns, but never a symlink or another user's file.
        let stat: import("node:fs").Stats | undefined;
        try {
          stat = await lstat(join(this.directory, name));
        } catch (error) {
          if (!missing(error)) throw error;
        }
        if (stat) {
          if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== getuid?.())
            throw new ConnectorVaultError();
          await unlink(join(this.directory, name));
          await dir.sync();
        }
      } finally {
        await dir.close();
      }
    } catch {
      throw new ConnectorVaultError();
    }
  }
  async list(): Promise<string[]> {
    try {
      const dir = await this.dir();
      try {
        const ids: string[] = [];
        for (const name of await this.names()) {
          // Unsafe entries (loosened mode, links, foreign owner) are skipped; get() refuses them.
          let stat: import("node:fs").Stats;
          try {
            stat = await lstat(join(this.directory, name));
          } catch (error) {
            if (missing(error)) continue;
            throw error;
          }
          if (stat.isSymbolicLink() || !safeFile(stat)) continue;
          const data = await this.read(name);
          if (data) ids.push(data.id);
        }
        return ids;
      } finally {
        await dir.close();
      }
    } catch {
      throw new ConnectorVaultError();
    }
  }
}
