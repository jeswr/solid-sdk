// AUTHORED-BY Codex GPT-6.1-Sol
import { createBrowserCaches, SessionFence } from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth, type KvStore } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

vi.mock("@jeswr/reactive-authentication", async (original) => ({
  ...(await original<typeof import("@jeswr/reactive-authentication")>()),
  createBrowserCaches: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function browserCaches(
  sessions: KvStore<
    import("@jeswr/reactive-authentication").RefreshSessionRecord
  > = createMemoryStore(),
  fenceStore: KvStore<number> = createMemoryStore(),
) {
  const memory = <T extends {}>() => ({ ...createMemoryStore<T>(), clear: vi.fn(async () => {}) });
  const caches: ReturnType<typeof createBrowserCaches> = {
    issuer: memory(),
    authorizationServer: memory(),
    client: memory(),
    storageContext: memory(),
    token: memory(),
    sessions: { ...sessions, clear: vi.fn(async () => {}) },
    fence: new SessionFence("test-browser", { broadcast: false }),
  };
  vi.mocked(createBrowserCaches).mockImplementation((namespace, options) => {
    const policy = typeof options === "object" ? options : undefined;
    caches.fence = new SessionFence(namespace, {
      store: policy?.wrapFenceStore?.(fenceStore) ?? fenceStore,
      broadcast: false,
    });
    return caches;
  });
  vi.stubGlobal("indexedDB", {});
  return caches;
}

test("browser defaults use browser metadata and refresh-only session caches", async () => {
  browserCaches();
  const op = createMockOp();
  vi.stubGlobal("fetch", op.fetch);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
    lws: { subject: "oidc-id-token" },
  });
  await auth.login();
  expect(createBrowserCaches).toHaveBeenCalledWith(expect.any(String), {
    persistSessions: true,
    wrapFenceStore: expect.any(Function),
  });
  expect((await auth.identity())?.webId).toBe(op.webId);
});

test.each([
  2, 3, 4,
])("browser restore propagates a fence storage failure on generation read %s and remains retryable", async (failedRead) => {
  const sessions =
    createMemoryStore<import("@jeswr/reactive-authentication").RefreshSessionRecord>();
  const fenceStore = createMemoryStore<number>();
  browserCaches(sessions, fenceStore);
  const op = createMockOp({ refreshTokens: true });
  vi.stubGlobal("fetch", op.fetch);
  const options = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { roots: [op.root], automatic: false },
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
  };
  await createPodAuth(options).login();
  browserCaches(sessions, fenceStore);
  const failure = new Error("Browser fence storage unavailable");
  const get = fenceStore.getItem;
  let reads = 0;
  vi.spyOn(fenceStore, "getItem").mockImplementation(async (key) => {
    if (++reads === failedRead) throw failure;
    return await get(key);
  });
  const auth = createPodAuth(options);
  const restored = vi.fn(),
    expired = vi.fn();
  auth.on("restore", restored);
  auth.on("expired", expired);
  await expect(auth.restore()).rejects.toBe(failure);
  expect(await auth.identity()).toBeNull();
  expect(await auth.remembered()).toEqual([{ webId: op.webId, issuer: op.issuer }]);
  expect(op.stats.refreshes).toBe(0);
  expect(restored).not.toHaveBeenCalled();
  expect(expired).not.toHaveBeenCalled();
  await expect(auth.restore()).resolves.toMatchObject({ webId: op.webId });
  expect(op.stats.refreshes).toBe(1);
  expect(op.stats.authorizations).toBe(1);
});

test.each([
  ["issuer", "getItem"],
  ["issuer", "setItem"],
  ["authorizationServer", "getItem"],
  ["authorizationServer", "setItem"],
] as const)("browser restore propagates %s metadata %s failures and remains retryable", async (cache, operation) => {
  const sessions =
    createMemoryStore<import("@jeswr/reactive-authentication").RefreshSessionRecord>();
  browserCaches(sessions);
  const op = createMockOp({ refreshTokens: true });
  vi.stubGlobal("fetch", op.fetch);
  const options = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { roots: [op.root], automatic: false },
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
  };
  await createPodAuth(options).login();
  const caches = browserCaches(sessions);
  const failure = new Error("Browser metadata storage unavailable");
  const failing = vi.spyOn(caches[cache], operation).mockRejectedValue(failure);
  const auth = createPodAuth(options);
  await expect(auth.restore()).rejects.toBe(failure);
  expect(await auth.identity()).toBeNull();
  expect(await auth.remembered()).toEqual([{ webId: op.webId, issuer: op.issuer }]);
  expect(op.stats.refreshes).toBe(0);
  failing.mockRestore();
  await expect(auth.restore()).resolves.toMatchObject({ webId: op.webId });
  expect(op.stats.refreshes).toBe(1);
  expect(op.stats.authorizations).toBe(1);
});
