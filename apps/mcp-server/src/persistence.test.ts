// AUTHORED-BY Codex GPT-6.1-Sol
import { createSessionVault, type Grant, MemoryVaultStore } from "@jeswr/mcp-oauth";
import { expect, it, vi } from "vitest";
import { createVaultOAuthStores, vaultSigningKey } from "./persistence.js";

it("atomically consumes once across workers and retains replay evidence", async () => {
  const vault = createSessionVault({
    key: Buffer.alloc(32, 7).toString("base64"),
    store: new MemoryVaultStore(),
  });
  const a = createVaultOAuthStores(vault, "issuer");
  const b = createVaultOAuthStores(vault, "issuer");
  const value = {
    authorization: {
      clientId: "client",
      redirectUri: "https://example.org/",
      resource: "https://mcp.example/mcp",
      state: "state",
      scope: "mcp",
      challenge: "pkce",
    },
    grantId: "grant",
    expiresAt: 123,
  };
  await a.codes.put("code-hash", value);
  const results = await Promise.all([a.codes.consume("code-hash"), b.codes.consume("code-hash")]);
  expect(results.filter((r) => r?.firstUse)).toHaveLength(1);
  expect(await b.codes.consume("code-hash")).toEqual({ firstUse: false, value });
  expect(await a.codes.consume("missing")).toBeUndefined();
  await expect(a.codes.put("code-hash", value)).rejects.toThrow("collision");
  const snapshot = await a.codes.get("code-hash");
  if (snapshot) snapshot.grantId = "changed";
  expect((await b.codes.get("code-hash"))?.grantId).toBe("grant");
  expect(
    await createVaultOAuthStores(vault, "other-issuer").codes.get("code-hash"),
  ).toBeUndefined();
});

it("keeps grant and session revocation irreversible under concurrent workers", async () => {
  const vault = createSessionVault({
    key: Buffer.alloc(32, 7).toString("base64"),
    store: new MemoryVaultStore(),
  });
  const a = createVaultOAuthStores(vault, "issuer");
  const b = createVaultOAuthStores(vault, "issuer");
  const grant: Grant = {
    id: "g",
    clientId: "client",
    session: { id: "session", webId: "https://pod.example/#me" },
    resource: "https://mcp.example/mcp",
    scope: "mcp",
    expiresAt: 123,
    revoked: false,
    refreshAllowed: true,
  };
  await a.grants.put("g", grant);
  await Promise.all([
    a.grants.revoke("g"),
    b.grants.revoke("g"),
    a.grants.revokeSession("session"),
    b.grants.revokeSession("session"),
  ]);
  expect((await b.grants.get("g"))?.revoked).toBe(true);
  expect(await b.grants.isSessionRevoked("session")).toBe(true);
  await expect(a.grants.put("g", grant)).rejects.toThrow();
  await a.grants.revoke("missing");
  const keys = await Promise.all([
    vaultSigningKey(vault, "issuer"),
    vaultSigningKey(vault, "issuer"),
  ]);
  expect(keys[0]?.kid).toBe(keys[1]?.kid);
  expect(keys[0]?.privateKey.export({ type: "pkcs8", format: "pem" })).toBe(
    keys[1]?.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
});

it("expires pending records without extending them and keeps consumed code evidence through grant expiry", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const vault = createSessionVault({
      key: Buffer.alloc(32, 7).toString("base64"),
      store: new MemoryVaultStore(),
    });
    const stores = createVaultOAuthStores(vault, "issuer");
    const authorization = {
      clientId: "c",
      redirectUri: "https://client.example/cb",
      resource: "https://mcp.example/mcp",
      state: "state",
      scope: "mcp",
      challenge: "challenge",
    };
    const code = { authorization, grantId: "g", expiresAt: Date.now() / 1000 + 300 };
    await stores.codes.put("unused", code, 300);
    await stores.codes.put("used", code, 300);
    await stores.pending.put("pending", { authorization, expiresAt: Date.now() / 1000 + 600 }, 600);
    vi.advanceTimersByTime(200_000);
    expect((await stores.codes.consume("used", 1000))?.firstUse).toBe(true);
    expect((await stores.pending.consume("pending"))?.firstUse).toBe(true);
    vi.advanceTimersByTime(400_000);
    expect(await stores.codes.get("unused")).toBeUndefined();
    expect(await stores.pending.get("pending")).toBeUndefined();
    expect((await stores.codes.consume("used"))?.firstUse).toBe(false);
    vi.advanceTimersByTime(600_000);
    expect(await stores.codes.get("used")).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it("backstops expired records when the vault ignores TTLs, including consumed evidence", async () => {
  const vault = createSessionVault({
    key: Buffer.alloc(32, 7).toString("base64"),
    store: new MemoryVaultStore(),
  });
  const swap = vault.compareAndSwap.bind(vault);
  vi.spyOn(vault, "compareAndSwap").mockImplementation((id, expected, secret) =>
    swap(id, expected, secret),
  );
  let now = 100;
  const stores = createVaultOAuthStores(vault, "issuer", () => now);
  const authorization = {
    clientId: "c",
    redirectUri: "https://client.example/cb",
    resource: "https://mcp.example/mcp",
    state: "state",
    scope: "mcp",
    challenge: "challenge",
  };
  const value = { authorization, expiresAt: 110 };
  await stores.pending.put("unused", value, 10);
  await stores.pending.put("used", value, 10);
  await stores.pending.consume("used");
  now = 110;
  for (const id of ["unused", "used"]) {
    expect(await stores.pending.get(id)).toBeUndefined();
    expect(await stores.pending.consume(id, 100)).toBeUndefined();
  }
  vi.restoreAllMocks();
});
