// AUTHORED-BY Codex GPT-6.1-Sol
import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, opendir, rename, unlink } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { getuid } from "node:process";
import {
  ConnectorVaultError,
  MAX_SEALED_CHARS,
  MAX_VAULT_RECORDS,
  type VaultStore,
  validateSealed,
  vaultKey,
} from "../vault.js";

const MAX_FILE_BYTES = MAX_SEALED_CHARS + 16 * 1024;
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

/** Private local ciphertext files. Hosts must serialize refreshes across processes. */
export class FileVaultStore implements VaultStore {
  private readonly directory: string;
  constructor(directory: string) {
    try {
      if (typeof directory !== "string" || directory.length > 4096) throw new ConnectorVaultError();
      this.directory = resolve(directory);
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
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (getuid && stat.uid !== 0 && stat.uid !== getuid()) ||
        ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)
      )
        throw new ConnectorVaultError();
    }
    const handle = await open(
      this.directory,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
    );
    try {
      const stat = await handle.stat();
      if ((stat.mode & 0o077) !== 0 || (getuid && stat.uid !== getuid()))
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
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o077) !== 0 ||
        stat.size > MAX_FILE_BYTES ||
        (getuid && stat.uid !== getuid())
      )
        throw new ConnectorVaultError();
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
    const names: string[] = [];
    let count = 0;
    const directory = await opendir(this.directory);
    for await (const entry of directory) {
      if (entry.isSymbolicLink() || !entry.isFile()) throw new ConnectorVaultError();
      if (++count > MAX_VAULT_RECORDS * 2 + 1) throw new ConnectorVaultError();
      if (/^[a-f0-9]{64}$/.test(entry.name)) {
        if (names.length >= MAX_VAULT_RECORDS) throw new ConnectorVaultError();
        names.push(entry.name);
      } else if (!/^[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/.test(entry.name))
        throw new ConnectorVaultError();
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
        if (await this.read(name)) {
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
          const data = await this.read(name);
          if (!data) throw new ConnectorVaultError();
          ids.push(data.id);
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
