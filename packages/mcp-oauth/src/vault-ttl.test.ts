// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryGrantStore, MemoryStore } from "./stores.js";
import { createSessionVault } from "./vault.js";
import { FileVaultStore, KvVaultStore, MemoryVaultStore } from "./vault-stores.js";

afterEach(() => {
  vi.useRealTimers();
});

it.each([
  "memory",
  "file",
])("expires %s ciphertext and rejects stale CAS without changing permanent records", async (backend) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const directory = await mkdtemp(join(tmpdir(), "mcp-ttl-"));
  try {
    const store = backend === "memory" ? new MemoryVaultStore() : new FileVaultStore(directory);
    expect(await store.compareAndSwap("ephemeral", undefined, "one", 2)).toBe(true);
    expect(await store.compareAndSwap("permanent", undefined, "forever")).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(await store.get("ephemeral")).toBe("one");
    expect(await store.compareAndSwap("ephemeral", "wrong", "wrong", 100)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(await store.get("ephemeral")).toBeUndefined();
    expect(await store.compareAndSwap("ephemeral", "one", "stale", 2)).toBe(false);
    expect(await store.compareAndSwap("ephemeral", undefined, "two", 1)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(await store.get("ephemeral")).toBeUndefined();
    expect(await store.get("permanent")).toBe("forever");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("passes expiry through the encrypted vault and retains permanent retirement tombstones", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const store = new MemoryVaultStore();
  const vault = createSessionVault({ key: Buffer.alloc(32, 8).toString("base64"), store });
  const secret = Buffer.from("fixture-secret");
  await vault.put("put", secret, 2);
  expect(await vault.compareAndSwap("cas", undefined, secret, 2)).toBe(true);
  await vault.put("retired", secret, 2);
  await vault.delete("retired");
  await vault.put("bounded", secret, 2);
  await vault.delete("bounded", 2);
  vi.advanceTimersByTime(2000);
  expect(await vault.get("put")).toBeUndefined();
  expect(await vault.get("cas")).toBeUndefined();
  expect(await store.get("bounded")).toBeUndefined();
  expect(await store.get("retired")).toBe("deleted");
  expect(await vault.compareAndSwap("retired", undefined, secret)).toBe(false);
});

it("uses Redis EX inside atomic Lua CAS and clears expiry for permanent replacements", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const commands: string[][] = [];
  const values = new Map<string, { value: string; expiresAt?: number }>();
  const store = new KvVaultStore({
    url: "https://kv.example",
    token: "fixture",
    fetch: async (_input, init) => {
      const command = JSON.parse(init?.body as string) as string[];
      commands.push(command);
      const key = command[command[0] === "GET" ? 1 : 3] as string;
      let current = values.get(key);
      if (current?.expiresAt !== undefined && current.expiresAt <= Date.now()) {
        values.delete(key);
        current = undefined;
      }
      if (command[0] === "GET") return Response.json({ result: current?.value ?? null });
      const [, script, , , mode, expected, value, ttl] = command;
      expect(script).toContain("'EX', ARGV[4]");
      const matches = mode === "missing" ? current === undefined : current?.value === expected;
      if (matches)
        values.set(key, {
          value: value as string,
          ...(ttl ? { expiresAt: Date.now() + Number(ttl) * 1000 } : {}),
        });
      return Response.json({ result: matches ? 1 : 0 });
    },
  });
  await store.compareAndSwap("id", undefined, "ciphertext", 600);
  expect(commands[0]?.[7]).toBe("600");
  await store.compareAndSwap("id", "ciphertext", "deleted");
  expect(commands[1]?.[7]).toBe("");
  await store.compareAndSwap("expiring", undefined, "ciphertext", 2);
  expect(await store.get("expiring")).toBe("ciphertext");
  expect(await store.compareAndSwap("expiring", "wrong", "replacement", 100)).toBe(false);
  vi.advanceTimersByTime(2000);
  expect(await store.get("expiring")).toBeUndefined();
  expect(await store.compareAndSwap("expiring", "ciphertext", "stale", 2)).toBe(false);
  expect(await store.compareAndSwap("expiring", undefined, "new", 2)).toBe(true);
  vi.advanceTimersByTime(600_000);
  expect(await store.get("id")).toBe("deleted");
});

it("bounds memory OAuth records and retains consumed code evidence for the requested lifetime", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const store = new MemoryStore<string>();
  await store.put("unused", "one", 1);
  await store.put("used", "two", 1);
  expect(await store.consume("used", 3)).toEqual({ value: "two", firstUse: true });
  vi.advanceTimersByTime(1000);
  expect(await store.get("unused")).toBeUndefined();
  expect(await store.consume("used")).toEqual({ value: "two", firstUse: false });
  vi.advanceTimersByTime(2000);
  expect(await store.consume("used")).toBeUndefined();
});

it("rejects invalid TTLs before mutating any backend", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-ttl-"));
  const transport = vi.fn<typeof fetch>();
  const stores = [
    new MemoryVaultStore(),
    new FileVaultStore(directory),
    new KvVaultStore({
      url: "https://kv.example",
      token: "fixture",
      fetch: transport,
    }),
  ];
  try {
    for (const store of stores) {
      for (const ttl of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
        await expect(store.compareAndSwap("id", undefined, "value", ttl)).rejects.toThrow("TTL");
    }
    expect(transport).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("honors optional grant-store TTLs while keeping session retirement permanent", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const store = new MemoryGrantStore();
  const grant = {
    id: "g",
    clientId: "c",
    session: { id: "s", webId: "https://pod.example/#me" },
    resource: "https://mcp.example/mcp",
    scope: "mcp",
    expiresAt: 123,
    revoked: false,
    refreshAllowed: true,
  };
  await store.put("g", grant, 1);
  await store.revokeSession("s");
  expect(await store.get("g")).toEqual(grant);
  vi.advanceTimersByTime(1000);
  expect(await store.get("g")).toBeUndefined();
  await store.revoke("g");
  expect(await store.isSessionRevoked("s")).toBe(true);
});
