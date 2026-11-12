// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  ConnectorTokenVault,
  ConnectorVaultError,
  generateBrowserVaultKey,
  importVaultKey,
  MAX_VAULT_RECORDS,
  MemoryVaultStore,
  type VaultRecord,
  type VaultStore,
  vaultId,
} from "./vault.js";

const key = { connectorId: "spotify", account: "synthetic-owner" };
const secret = "synthetic-refresh-sensitive";
const encodedKey = Buffer.alloc(32, 111).toString("base64");
const value: VaultRecord = {
  refreshToken: secret,
  obtainedAt: 1234,
  expiresAt: 9876,
  scope: "read",
  tokenType: "Bearer",
  providerMeta: { id: "fixture", flags: [true, null, 1] },
};
async function fixture() {
  const store = new MemoryVaultStore();
  const cryptoKey = await importVaultKey(encodedKey);
  return { store, cryptoKey, vault: new ConnectorTokenVault(cryptoKey, store) };
}
async function fails(operation: Promise<unknown>) {
  const error = await operation.then(
    () => {
      throw new Error("Expected failure");
    },
    (error) => error,
  );
  expect(error).toBeInstanceOf(ConnectorVaultError);
  expect(error.message).toBe("Connector vault operation failed.");
  expect(String(error)).not.toContain(secret);
  expect(String(error)).not.toContain(encodedKey);
  expect(error.cause).toBeUndefined();
}

describe("encrypted connector vault", () => {
  it("provides bounded per-key locks, releases on throw, and masks acquisition failures", async () => {
    const { store, vault } = await fixture();
    const id = vaultId(key);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const order: number[] = [];
    const first = store
      .withLock(id, async () => {
        order.push(1);
        started.resolve();
        await release.promise;
        throw new Error("callback");
      })
      .catch((error) => expect(error.message).toBe("callback"));
    await started.promise;
    const waiting = Array.from({ length: MAX_VAULT_RECORDS - 1 }, () =>
      store.withLock(id, async () => {
        order.push(2);
      }),
    );
    await fails(store.withLock(id, async () => {}));
    expect(order).toEqual([1]);
    release.resolve();
    await Promise.all([first, ...waiting]);
    expect(order).toHaveLength(MAX_VAULT_RECORDS);
    expect(await vault.withLock?.(key, async () => 42)).toBe(42);
    const bad = new ConnectorTokenVault(await generateBrowserVaultKey(), {
      get: store.get.bind(store),
      put: store.put.bind(store),
      delete: store.delete.bind(store),
      list: store.list.bind(store),
      withLock: async () => {
        throw new Error(secret);
      },
    });
    await fails(bad.withLock!(key, async () => {}));
  });
  it("snapshots record and key before awaiting storage", async () => {
    const { vault, store } = await fixture();
    const blocked = Promise.withResolvers<void>();
    const originalPut = store.put.bind(store);
    vi.spyOn(store, "put").mockImplementationOnce(async (id, sealed) => {
      await blocked.promise;
      return originalPut(id, sealed);
    });
    const inputKey = { connectorId: "spotify", account: "first" };
    const inputRecord = {
      refreshToken: "first-refresh",
      obtainedAt: 1,
      providerMeta: { label: "first" },
    };
    const pending = vault.put(inputKey, inputRecord);
    inputKey.account = "second";
    inputRecord.refreshToken = "second-refresh";
    inputRecord.providerMeta.label = "second";
    blocked.resolve();
    await pending;
    expect(await vault.get({ connectorId: "spotify", account: "first" })).toEqual({
      refreshToken: "first-refresh",
      obtainedAt: 1,
      providerMeta: { label: "first" },
    });
    expect(await vault.get(inputKey)).toBeUndefined();
  });
  it("round trips bounded JSON metadata scalars, arrays and objects", async () => {
    const { vault } = await fixture();
    for (const providerMeta of [
      null,
      true,
      42,
      "fixture",
      ["fixture", { nested: false }],
      { nested: [null] },
    ]) {
      await vault.put(key, { refreshToken: secret, obtainedAt: 1, providerMeta });
      expect((await vault.get(key))?.providerMeta).toEqual(providerMeta);
    }
  });
  it("round trips only refresh records, lists authenticated keys, replaces and deletes", async () => {
    const { vault, store } = await fixture();
    expect(await vault.get(key)).toBeUndefined();
    await vault.put(key, value);
    const sealed = await store.get(vaultId(key));
    expect(sealed).toMatch(/^1\.[\w-]{16}\.[\w-]+$/);
    expect(sealed).not.toContain(secret);
    expect(await vault.get(key)).toEqual(value);
    expect(await vault.list()).toEqual([key]);
    await vault.put(key, value);
    expect(await store.get(vaultId(key))).not.toBe(sealed);
    await vault.put(key, { refreshToken: "rotated", obtainedAt: 2222 });
    expect(await vault.get(key)).toEqual({ refreshToken: "rotated", obtainedAt: 2222 });
    await vault.delete(key);
    await vault.delete(key);
    expect(await vault.list()).toEqual([]);
  });
  it("rejects changes to every IV, ciphertext and tag byte, plus format/version", async () => {
    const { vault, store } = await fixture();
    await vault.put(key, value);
    const sealed = (await store.get(vaultId(key)))!;
    const original = sealed.split(".");
    for (const part of [1, 2]) {
      const bytes = Buffer.from(original[part]!, "base64url");
      for (let index = 0; index < bytes.length; index++) {
        const changed = Buffer.from(bytes);
        changed[index]! ^= 1;
        const fields = [...original];
        fields[part] = changed.toString("base64url");
        await store.put(vaultId(key), fields.join("."));
        await fails(vault.get(key));
      }
    }
    for (const malformed of [
      `2${sealed.slice(1)}`,
      `01${sealed.slice(1)}`,
      `${sealed}.extra`,
      `${sealed}=`,
      "1.AA.AA",
      "1.////////////////.AAAA",
      "invalid",
      "x".repeat(65537),
    ]) {
      const hostile: VaultStore = {
        ...store,
        get: async () => malformed,
        put: async () => {},
        delete: async () => {},
        list: async () => [vaultId(key)],
      };
      await fails(new ConnectorTokenVault(await importVaultKey(encodedKey), hostile).get(key));
    }
  });
  it("binds both identity fields as AAD and rejects another key", async () => {
    const { vault, store } = await fixture();
    await vault.put(key, value);
    const sealed = (await store.get(vaultId(key)))!;
    for (const changed of [
      { ...key, account: "another" },
      { ...key, connectorId: "github" },
    ]) {
      await store.put(vaultId(changed), sealed);
      await fails(vault.get(changed));
    }
    await fails(new ConnectorTokenVault(await generateBrowserVaultKey(), store).get(key));
    const wrong = new ConnectorTokenVault(await generateBrowserVaultKey(), store);
    await wrong.put(key, value);
    expect(await wrong.get(key)).toEqual(value);
    await fails(vault.get(key));
    await fails(vault.list());
  });
  it("authenticates every byte of the canonical AAD, including version and tuple separators", async () => {
    const { vault, store, cryptoKey } = await fixture();
    const aad = Buffer.from(JSON.stringify([1, key.connectorId, key.account]));
    for (let index = 0; index < aad.length; index++) {
      const changed = Buffer.from(aad);
      changed[index] = (changed[index] ?? 0) ^ 1;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: changed },
        cryptoKey,
        Buffer.from(JSON.stringify(value)),
      );
      await store.put(
        vaultId(key),
        `1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(encrypted).toString("base64url")}`,
      );
      await fails(vault.get(key));
    }
  });
  it("rejects malformed authenticated plaintext with the same generic failure", async () => {
    const { vault, store, cryptoKey } = await fixture();
    for (const plaintext of [
      "not json",
      "null",
      '{"refreshToken":"x"}',
      JSON.stringify({ ...value, accessToken: secret }),
      `"${"x".repeat(32769)}"`,
    ]) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(
            JSON.stringify([1, key.connectorId, key.account]),
          ),
        },
        cryptoKey,
        new TextEncoder().encode(plaintext),
      );
      await store.put(
        vaultId(key),
        `1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(encrypted).toString("base64url")}`,
      );
      await fails(vault.get(key));
    }
  });
  it("fails closed on bounded invalid keys, records, metadata and malicious accessors", async () => {
    const { vault } = await fixture();
    for (const invalid of ["", " ", "x\n", "x".repeat(257), "\uD800"])
      await fails(vault.put({ ...key, account: invalid }, value));
    for (const invalid of ["", "../x", "Upper", "x".repeat(65)])
      await fails(vault.get({ ...key, connectorId: invalid }));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const accessor = {
      get refreshToken() {
        throw new Error(secret + encodedKey);
      },
      obtainedAt: 1,
    };
    const toJSON = Object.defineProperty({}, "toJSON", {
      value: () => {
        throw new Error(secret);
      },
    });
    // Non-enumerable toJSON is not called; records are projected into safe objects.
    await vault.put(key, { ...value, providerMeta: toJSON });
    for (const invalid of [
      null,
      {},
      { ...value, refreshToken: "" },
      { ...value, refreshToken: "x".repeat(16385) },
      { ...value, scope: "x".repeat(4097) },
      { ...value, tokenType: "x".repeat(65) },
      { ...value, accessToken: secret },
      { ...value, obtainedAt: NaN },
      { ...value, obtainedAt: -1 },
      { ...value, expiresAt: Infinity },
      accessor,
      ...[
        cyclic,
        { x: "x".repeat(4097) },
        { x: Array(257).fill(1) },
        { x: BigInt(1) },
        { access_token: secret },
        {
          get x() {
            throw new Error(secret);
          },
        },
        { x: new Date() },
        { x: Array(1) },
        { x: () => 1 },
        { x: Infinity },
        { x: { x: { x: { x: { x: { x: { x: { x: { x: 1 } } } } } } } } },
      ].map((providerMeta) => ({ ...value, providerMeta })),
    ]) {
      await fails(vault.put(key, invalid as VaultRecord));
    }
  });
  it("masks arbitrary storage and crypto errors for every operation", async () => {
    const bad = async () => {
      throw new Error(secret + encodedKey);
    };
    const vault = new ConnectorTokenVault(await generateBrowserVaultKey(), {
      get: bad,
      put: bad,
      delete: bad,
      list: bad,
    });
    await Promise.all(
      [vault.get(key), vault.put(key, value), vault.delete(key), vault.list()].map(fails),
    );
    const { vault: working } = await fixture();
    const spy = vi
      .spyOn(crypto.subtle, "encrypt")
      .mockRejectedValue(new Error(secret + encodedKey));
    await fails(working.put(key, value));
    spy.mockRestore();
    for (const ids of [["invalid"], Array(1001).fill(vaultId(key)), [vaultId(key), vaultId(key)]]) {
      await fails(
        new ConnectorTokenVault(await generateBrowserVaultKey(), {
          get: async () => undefined,
          put: bad,
          delete: bad,
          list: async () => ids,
        }).list(),
      );
    }
  });
  it("caps the memory store and permits replacement/deletion at capacity", async () => {
    const store = new MemoryVaultStore();
    for (let index = 0; index < MAX_VAULT_RECORDS; index++)
      await store.put(vaultId({ ...key, account: String(index) }), "sealed");
    await fails(store.put(vaultId(key), "sealed"));
    await store.put(vaultId({ ...key, account: "0" }), "replaced");
    await store.delete(vaultId({ ...key, account: "0" }));
    await store.put(vaultId(key), "sealed");
  });
});

describe("vault key helpers", () => {
  it("imports canonical 32 byte base64 and generates non-extractable AES-256 keys", async () => {
    for (const key of [await importVaultKey(encodedKey), await generateBrowserVaultKey()]) {
      expect(key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
      expect(key.extractable).toBe(false);
      await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    }
  });
  it("rejects wrong lengths, whitespace, URL alphabet, missing padding and pad bits without echoing", async () => {
    for (const input of [
      "",
      secret,
      ` ${encodedKey}`,
      `${encodedKey}\n`,
      encodedKey.slice(0, -1),
      Buffer.alloc(31).toString("base64"),
      Buffer.alloc(33).toString("base64"),
      `${"_".repeat(43)}=`,
      `${"A".repeat(42)}B=`,
      "A".repeat(100000),
    ])
      await fails(importVaultKey(input));
    for (const key of [
      null,
      {},
      {
        type: "secret",
        algorithm: { name: "AES-GCM", length: 256 },
        usages: ["encrypt", "decrypt"],
        extractable: false,
      },
      await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, [
        "encrypt",
        "decrypt",
      ]),
      await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]),
    ]) {
      expect(() => new ConnectorTokenVault(key as CryptoKey, new MemoryVaultStore())).toThrow(
        "Connector vault operation failed.",
      );
    }
  });
});
