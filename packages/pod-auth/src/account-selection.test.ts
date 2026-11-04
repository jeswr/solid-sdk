// AUTHORED-BY Codex GPT-6.1-Sol
import { createBrowserCaches, SessionFence } from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth, type PodAuthOptions } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

vi.mock("@jeswr/reactive-authentication", async (original) => ({
  ...(await original<typeof import("@jeswr/reactive-authentication")>()),
  createBrowserCaches: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each([
  ["custom", "ui"],
  ["custom", "hint"],
  ["browser", "ui"],
  ["browser", "hint"],
])("%s persisted sessions and metadata isolate %s account selections at one issuer", async (storageKind, selectionKind) => {
  const alice = createMockOp();
  const bob = createMockOp({
    subject: "https://id.example/bob",
    webId: "https://id.example/bob#me",
  });
  let active = alice;
  let refreshes = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === active.issuer + "token") {
      const params = new URLSearchParams(await request.clone().text());
      if (params.get("grant_type") === "refresh_token") {
        refreshes++;
        expect(params.get("refresh_token")).toBe("refresh-alice");
        expect(request.headers.has("dpop")).toBe(true);
        // OIDC refresh responses may omit the ID token; the engine retains the validated identity.
        return Response.json({
          access_token: "restored-alice",
          token_type: "DPoP",
          expires_in: 300,
        });
      }
      const response = await active.fetch(request);
      return Response.json({
        ...(await response.json()),
        refresh_token: active === alice ? "refresh-alice" : "refresh-bob",
      });
    }
    return active.fetch(request);
  });
  const sessions =
    createMemoryStore<import("@jeswr/reactive-authentication").RefreshSessionRecord>();
  const caches = createMemoryStore();
  if (storageKind === "browser") {
    const memory = <T extends {}>() => ({
      ...createMemoryStore<T>(),
      clear: vi.fn(async () => {}),
    });
    vi.mocked(createBrowserCaches).mockReturnValue({
      issuer: memory(),
      authorizationServer: memory(),
      client: memory(),
      storageContext: memory(),
      token: memory(),
      sessions: { ...sessions, clear: vi.fn(async () => {}) },
      fence: new SessionFence("account-selection", { broadcast: false }),
    });
    vi.stubGlobal("indexedDB", {});
  }
  const options: PodAuthOptions = {
    clientId: alice.clientId,
    redirectUri: alice.redirectUri,
    boundary: { roots: [alice.root], automatic: false },
    ui: {
      getWebId: vi.fn(async () => active.webId!),
      getCode: vi.fn((url, signal) => active.getCode(url, signal)),
    },
    ...(storageKind === "custom" ? { storage: { sessions, caches } } : {}),
  };
  const first = createPodAuth(options);
  await first.login();
  active = bob;
  const second = createPodAuth(options);
  expect(
    (await second.login(selectionKind === "hint" ? { webId: bob.webId } : undefined)).webId,
  ).toBe(bob.webId);
  expect(refreshes).toBe(0);
  expect(bob.stats.tokens).toBe(1);
  expect(options.ui.getCode).toHaveBeenCalledTimes(2);

  active = alice;
  // Switching instances must neither consume nor fence off the first account's session.
  expect((await first.fetch(alice.root + "private")).status).toBe(200);
  const restored = createPodAuth(options);
  expect((await restored.login({ webId: alice.webId })).webId).toBe(alice.webId);
  expect(refreshes).toBe(1);
  expect(alice.stats.tokens).toBe(1);
  expect(options.ui.getCode).toHaveBeenCalledTimes(2);
  expect(options.ui.getWebId).toHaveBeenCalledTimes(selectionKind === "ui" ? 2 : 1);
});
