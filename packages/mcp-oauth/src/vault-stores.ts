// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash, randomUUID } from "node:crypto";
import { type FileHandle, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { secureUrl } from "./protocol.js";

/** Opaque ciphertext storage. CAS must be atomic across every worker sharing the store. */
export interface VaultStore {
  get(id: string): Promise<string | undefined>;
  compareAndSwap(id: string, expected: string | undefined, value: string): Promise<boolean>;
}

/** Single-process fixture store; reads/writes contain ciphertext only. */
export class MemoryVaultStore implements VaultStore {
  private readonly values = new Map<string, string>();
  async get(id: string) {
    return this.values.get(id);
  }
  async compareAndSwap(id: string, expected: string | undefined, value: string) {
    if (this.values.get(id) !== expected) return false;
    this.values.set(id, value);
    return true;
  }
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Local filesystem store. Atomic rename + exclusive lock file; contention fails closed. */
export class FileVaultStore implements VaultStore {
  private readonly directory: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
  }
  private path(id: string) {
    return resolve(this.directory, createHash("sha256").update(id).digest("hex"));
  }
  async get(id: string): Promise<string | undefined> {
    try {
      return await readFile(this.path(id), "utf8");
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }
  async compareAndSwap(id: string, expected: string | undefined, value: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(id);
    let lock: FileHandle;
    try {
      lock = await open(`${path}.lock`, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      if ((await this.get(id)) !== expected) return false;
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(value, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
      return true;
    } finally {
      await rm(temporary, { force: true });
      await lock.close();
      await rm(`${path}.lock`);
    }
  }
}

/** Upstash Redis REST transport. Credentials are configuration, never part of stored values. */
export interface KvVaultStoreOptions {
  url?: string;
  token?: string;
  prefix?: string;
  /** Trusted SSRF/DNS-pinned transport, or a fixture. Redirects are always refused. */
  fetch?: typeof fetch;
}

const CAS = `local current = redis.call('GET', KEYS[1])
if (ARGV[1] == 'missing' and not current) or (ARGV[1] == 'present' and current == ARGV[2]) then
  redis.call('SET', KEYS[1], ARGV[3])
  return 1
end
return 0`;

/** Shared encrypted storage via Upstash/Vercel KV; atomic operations use Redis Lua. */
export class KvVaultStore implements VaultStore {
  private readonly url: string;
  private readonly token: string;
  private readonly prefix: string;
  private readonly fetcher: typeof fetch;
  constructor(options: KvVaultStoreOptions = {}) {
    this.url =
      options.url ?? process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
    this.token =
      options.token ?? process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
    secureUrl(this.url);
    if (!this.token || new URL(this.url).search) throw new Error("Invalid vault KV configuration");
    this.prefix = options.prefix ?? "mcp-vault:";
    this.fetcher =
      options.fetch ??
      createNodeGuardedFetch({ maxBytes: 1024 * 1024, timeoutMs: 8_000, maxRedirects: 0 });
  }
  private key(id: string) {
    return this.prefix + createHash("sha256").update(id).digest("hex");
  }
  private async command(command: string[]): Promise<unknown> {
    const response = await this.fetcher(this.url, {
      method: "POST",
      redirect: "manual",
      credentials: "omit",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    if (response.status !== 200) throw new Error("Vault KV request failed");
    const data = await response.json();
    if (!data || typeof data !== "object" || data.error || !("result" in data))
      throw new Error("Vault KV request failed");
    return data.result;
  }
  async get(id: string): Promise<string | undefined> {
    const value = await this.command(["GET", this.key(id)]);
    if (value === null) return undefined;
    if (typeof value !== "string") throw new Error("Invalid vault KV result");
    return value;
  }
  async compareAndSwap(id: string, expected: string | undefined, value: string) {
    const result = await this.command([
      "EVAL",
      CAS,
      "1",
      this.key(id),
      expected === undefined ? "missing" : "present",
      expected ?? "",
      value,
    ]);
    if (result !== 0 && result !== 1) throw new Error("Invalid vault KV result");
    return result === 1;
  }
}
