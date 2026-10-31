// AUTHORED-BY Codex GPT-6.1-Sol
import { createBrowserCaches, SessionFence } from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

vi.mock("@jeswr/reactive-authentication", async (original) => ({
  ...(await original<typeof import("@jeswr/reactive-authentication")>()),
  createBrowserCaches: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("browser defaults use browser metadata and refresh-only session caches", async () => {
  const sessions =
    createMemoryStore<import("@jeswr/reactive-authentication").RefreshSessionRecord>();
  const memory = <T extends {}>() => ({ ...createMemoryStore<T>(), clear: vi.fn(async () => {}) });
  vi.mocked(createBrowserCaches).mockReturnValue({
    issuer: memory(),
    authorizationServer: memory(),
    client: memory(),
    storageContext: memory(),
    token: memory(),
    sessions: { ...sessions, clear: vi.fn(async () => {}) },
    fence: new SessionFence("test-browser", { broadcast: false }),
  });
  vi.stubGlobal("indexedDB", {});
  const op = createMockOp();
  vi.stubGlobal("fetch", op.fetch);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
    lws: { subject: "oidc-id-token" },
  });
  await auth.login();
  expect(createBrowserCaches).toHaveBeenCalledWith(expect.any(String), { persistSessions: true });
  expect((await auth.identity())?.webId).toBe(op.webId);
});
