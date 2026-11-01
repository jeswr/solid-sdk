// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionVault } from "./vault.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});

import { FileVaultStore, KvVaultStore, MemoryVaultStore } from "./vault-stores.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const secret = Buffer.from("fixture-private-refresh-and-key");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authenticated session vault", () => {
  it("requires a canonical 256-bit key, including env configuration", async () => {
    vi.stubEnv("MCP_VAULT_KEY", undefined);
    for (const key of [undefined, "", "invalid", Buffer.alloc(31).toString("base64"), `${KEY}\n`])
      expect(() => createSessionVault({ key })).toThrow("MCP_VAULT_KEY");
    vi.stubEnv("MCP_VAULT_KEY", KEY);
    vi.stubEnv("KV_REST_API_URL", "https://kv.example");
    vi.stubEnv("KV_REST_API_TOKEN", "fixture-rest-key");
    expect(createSessionVault()).toBeDefined();
    const vault = createSessionVault({ store: new MemoryVaultStore() });
    await vault.put("id", secret);
    expect(await vault.get("id")).toEqual(secret);
  });
  it("randomizes ciphertext, isolates snapshots and retires identifiers", async () => {
    const store = new MemoryVaultStore();
    const vault = createSessionVault({ key: KEY, store });
    expect(await vault.get("id")).toBeUndefined();
    expect(await store.compareAndSwap("id", "absent", "bad")).toBe(false);
    expect(await vault.compareAndSwap("id", secret, secret)).toBe(false);
    expect(await vault.compareAndSwap("id", undefined, secret)).toBe(true);
    const first = await store.get("id");
    expect(first).not.toContain(secret.toString());
    expect(await vault.compareAndSwap("id", undefined, secret)).toBe(false);
    expect(await vault.compareAndSwap("id", Buffer.from("wrong"), secret)).toBe(false);
    expect(await vault.compareAndSwap("id", secret, secret)).toBe(true);
    expect(await store.get("id")).not.toBe(first);
    const snapshot = await vault.get("id");
    snapshot?.fill(0);
    expect(await vault.get("id")).toEqual(secret);
    await vault.put("id", Buffer.alloc(0));
    expect(await vault.get("id")).toEqual(Buffer.alloc(0));
    await vault.delete("id");
    await vault.delete("id");
    await vault.delete("missing");
    expect(await vault.get("id")).toBeUndefined();
    expect(await vault.compareAndSwap("id", undefined, secret)).toBe(false);
    await expect(vault.put("id", secret)).rejects.toThrow("conflict");
  });
  it("rejects tampering, another record identity, malformed envelopes and a wrong key", async () => {
    const store = new MemoryVaultStore();
    const vault = createSessionVault({ key: KEY, store });
    await vault.put("id", secret);
    const ciphertext = (await store.get("id")) as string;
    const wrong = createSessionVault({ key: Buffer.alloc(32, 8).toString("base64"), store });
    await expect(wrong.get("id")).rejects.toThrow("authentication");
    await expect(wrong.put("id", secret)).rejects.toThrow("authentication");
    await expect(wrong.compareAndSwap("id", secret, secret)).rejects.toThrow("authentication");
    await store.compareAndSwap("copy", undefined, ciphertext);
    await expect(vault.get("copy")).rejects.toThrow("authentication");
    const bytes = Buffer.from(ciphertext.slice(2), "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 1;
    for (const value of [
      "2.abc",
      "1.a",
      "1.",
      `${ciphertext}\n`,
      `1.${bytes.toString("base64")}`,
    ]) {
      const current = await store.get("id");
      await store.compareAndSwap("id", current, value);
      await expect(vault.get("id")).rejects.toThrow("authentication");
    }
    // Even corrupt records can be retired without decrypting credentials.
    await vault.delete("id");
  });
  it("fails closed on concurrent writes and store outages", async () => {
    const store = new MemoryVaultStore();
    const vault = createSessionVault({ key: KEY, store });
    vi.spyOn(store, "compareAndSwap").mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await expect(vault.put("id", secret)).rejects.toThrow("conflict");
    expect(await vault.compareAndSwap("id", undefined, secret)).toBe(false);
    vi.spyOn(store, "get").mockRejectedValue(new Error("offline"));
    await expect(vault.get("id")).rejects.toThrow("offline");
    await expect(vault.delete("id")).rejects.toThrow("offline");
  });
  it("retries retirement across credential updates and concurrent retirement", async () => {
    for (const competingRetirement of [false, true]) {
      const store = new MemoryVaultStore();
      const vault = createSessionVault({ key: KEY, store });
      const other = createSessionVault({ key: KEY, store });
      await vault.put("id", secret);
      const swap = store.compareAndSwap.bind(store);
      let conflicts = 0;
      vi.spyOn(store, "compareAndSwap").mockImplementation(async (id, expected, value) => {
        if (value === "deleted" && conflicts < 2) {
          conflicts++;
          if (competingRetirement) await other.delete(id);
          else await other.put(id, Buffer.from(`rotated-${conflicts}`));
        }
        return swap(id, expected, value);
      });
      await vault.delete("id");
      expect(conflicts).toBe(2);
      expect(await store.get("id")).toBe("deleted");
      expect(await other.get("id")).toBeUndefined();
      expect(await other.compareAndSwap("id", undefined, secret)).toBe(false);
      await expect(other.put("id", secret)).rejects.toThrow("conflict");
    }
  });
});

describe("file ciphertext store", () => {
  it("persists across instances, restricts modes, hashes paths and handles CAS contention", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "mcp-vault-"));
    try {
      const store = new FileVaultStore(directory);
      const other = new FileVaultStore(directory);
      const id = "../../outside";
      expect(await store.get(id)).toBeUndefined();
      const results = await Promise.all([
        store.compareAndSwap(id, undefined, "first"),
        other.compareAndSwap(id, undefined, "second"),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const current = await store.get(id);
      expect(await other.get(id)).toBe(current);
      expect(await other.compareAndSwap(id, "wrong", "bad")).toBe(false);
      expect(await other.compareAndSwap(id, current, "updated")).toBe(true);
      const path = join(directory, createHash("sha256").update(id).digest("hex"));
      expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
      expect(await fs.readdir(directory)).toEqual([createHash("sha256").update(id).digest("hex")]);
      const vault = createSessionVault({ key: KEY, store });
      await vault.put("secret", secret);
      expect(await createSessionVault({ key: KEY, store: other }).get("secret")).toEqual(secret);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it("propagates filesystem errors and cleans failed writes", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "mcp-vault-"));
    try {
      const store = new FileVaultStore(directory);
      const id = "id";
      const path = join(directory, createHash("sha256").update(id).digest("hex"));
      await fs.mkdir(path);
      await expect(store.get(id)).rejects.toThrow();
      await expect(store.compareAndSwap(id, undefined, "value")).rejects.toThrow();
      expect(await fs.readdir(directory)).toEqual([createHash("sha256").update(id).digest("hex")]);
      await fs.mkdir(`${path}.lock`);
      expect(await store.compareAndSwap(id, undefined, "value")).toBe(false);
      await fs.rm(`${path}.lock`, { recursive: true });
      await fs.writeFile(`${directory}/file`, "x");
      await expect(
        new FileVaultStore(`${directory}/file/sub`).compareAndSwap(id, undefined, "value"),
      ).rejects.toThrow();
      vi.spyOn(fs, "open").mockRejectedValueOnce(
        Object.assign(new Error("denied"), { code: "EACCES" }),
      );
      await expect(store.compareAndSwap(id, undefined, "value")).rejects.toThrow("denied");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Upstash REST ciphertext store", () => {
  it("uses env configuration, atomic Lua CAS and encrypted payloads", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://kv.example");
    vi.stubEnv("KV_REST_API_TOKEN", "fixture-rest-key");
    const values = new Map<string, string>();
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-rest-key");
      const command = JSON.parse(init?.body as string) as string[];
      const [operation] = command;
      if (operation === "GET")
        return Response.json({ result: values.get(command[1] as string) ?? null });
      expect(command[1]).toContain("redis.call('SET'");
      const [, , count, key, mode, expected, next] = command;
      expect(count).toBe("1");
      const matches =
        mode === "missing" ? !values.has(key as string) : values.get(key as string) === expected;
      if (matches) values.set(key as string, next as string);
      return Response.json({ result: matches ? 1 : 0 });
    });
    const store = new KvVaultStore({ fetch: fetcher });
    const vault = createSessionVault({ key: KEY, store });
    expect(await vault.get("id")).toBeUndefined();
    await vault.put("id", secret);
    expect(await vault.get("id")).toEqual(secret);
    expect([...values.values()].join()).not.toContain(secret.toString());
    expect(await store.compareAndSwap("id", "wrong", "bad")).toBe(false);
    await vault.put("id", secret);
    await vault.delete("id");
    expect(await vault.get("id")).toBeUndefined();
    expect(fetcher).toHaveBeenCalled();
  });
  it("validates configuration and fails closed without exposing REST errors", async () => {
    for (const name of [
      "KV_REST_API_URL",
      "KV_REST_API_TOKEN",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
    ])
      vi.stubEnv(name, undefined);
    expect(() => new KvVaultStore()).toThrow();
    expect(() => new KvVaultStore({ url: "https://kv.example" })).toThrow("configuration");
    expect(() => new KvVaultStore({ url: "https://kv.example?x=1", token: "fixture" })).toThrow(
      "configuration",
    );
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://kv.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fixture");
    expect(new KvVaultStore()).toBeInstanceOf(KvVaultStore);
    const fetcher = vi.fn<typeof fetch>();
    const store = new KvVaultStore({
      url: "https://kv.example",
      token: "fixture",
      prefix: "test:",
      fetch: fetcher,
    });
    for (const body of [{ error: "fixture-private-error" }, {}, null, 1]) {
      fetcher.mockResolvedValueOnce(Response.json(body));
      await expect(store.get("id")).rejects.toThrow("Vault KV request failed");
    }
    fetcher.mockResolvedValueOnce(new Response("fixture-private-error", { status: 302 }));
    await expect(store.get("id")).rejects.toThrow("Vault KV request failed");
    fetcher.mockResolvedValueOnce(Response.json({ result: {} }));
    await expect(store.get("id")).rejects.toThrow("Invalid vault KV result");
    fetcher.mockResolvedValueOnce(Response.json({ result: 2 }));
    await expect(store.compareAndSwap("id", undefined, "ciphertext")).rejects.toThrow(
      "Invalid vault KV result",
    );
    fetcher.mockRejectedValueOnce(new Error("offline"));
    await expect(store.get("id")).rejects.toThrow("offline");
  });
});
