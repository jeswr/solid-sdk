// AUTHORED-BY Codex GPT-6.1-Sol
import {
  IssuerNotAuthorizedError as EngineIssuerNotAuthorizedError,
  ReactiveAuthenticationError,
} from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth, IssuerNotAuthorizedError, type PodAuthOptions } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture(
  config: Parameters<typeof createMockOp>[0] = {},
  profile?: (request: Request) => Response | Promise<Response>,
) {
  const op = createMockOp({ refreshTokens: true, ...config });
  let profiles = 0;
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    if (request.url.startsWith("https://id.example/")) {
      ++profiles;
      if (profile) return profile(request);
    }
    return op.fetch(request);
  });
  const sessions = createMemoryStore();
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    storage: { sessions, caches: createMemoryStore() },
    boundary: { roots: [op.root], automatic: false },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode: op.getCode },
  };
  return {
    op,
    options,
    sessions,
    requests,
    profiles: () => profiles,
    auth: createPodAuth(options),
  };
}

test.each([
  ["https://op.example/"],
  ["https://op.example"],
  ["https://other.example/", "https://op.example/"],
])("issuer-only login accepts every listed issuer, including origin slash equivalence: %j", async (...issuers) => {
  const f = fixture({ issuers });
  const events = vi.fn();
  f.auth.on("login", events);
  expect((await f.auth.login({ issuer: f.op.issuer })).webId).toBe(f.op.webId);
  expect(f.profiles()).toBe(1);
  expect(events).toHaveBeenCalledOnce();
  expect(await f.auth.remembered()).toEqual([{ webId: f.op.webId, issuer: f.op.issuer }]);
  expect(f.options.ui.getWebId).not.toHaveBeenCalled();
  expect((await f.auth.fetch(f.op.root + "private")).status).toBe(200);
  expect(f.profiles()).toBe(1);
  const profiles = f.requests.filter((request) => request.url.startsWith("https://id.example/"));
  expect(profiles.every((request) => request.credentials === "omit")).toBe(true);
  expect(
    profiles.every(
      (request) => !request.headers.has("authorization") && !request.headers.has("dpop"),
    ),
  ).toBe(true);
});

test.each([
  "different",
  "missing",
])("issuer-only login rejects a %s issuer binding with the re-exported engine error", async (failure) => {
  const f = fixture({
    issuers: failure === "missing" ? [] : ["https://other.example/"],
  });
  expect(IssuerNotAuthorizedError).toBe(EngineIssuerNotAuthorizedError);
  const events = vi.fn();
  f.auth.on("login", events);
  const login = f.auth.login({ issuer: f.op.issuer });
  await expect(login).rejects.toBeInstanceOf(IssuerNotAuthorizedError);
  await expect(login).rejects.toBeInstanceOf(ReactiveAuthenticationError);
  await expect(login).rejects.toMatchObject({
    name: "IssuerNotAuthorizedError",
    webId: f.op.webId,
    issuer: f.op.issuer,
    message: `${f.op.issuer} is not listed as a sign-in provider for ${f.op.webId}`,
  });
  expect(f.profiles()).toBe(1);
  await expectNoSession(f, events);
});

async function expectNoSession(f: ReturnType<typeof fixture>, events: ReturnType<typeof vi.fn>) {
  expect(await f.auth.identity()).toBeNull();
  expect(await f.auth.remembered()).toEqual([]);
  expect(events).not.toHaveBeenCalled();
  expect(f.op.stats.accepted).toBe(0);
  // A protected request still cannot authenticate or reuse a credential from the failed login.
  await expect(f.auth.fetch(f.op.root + "private")).rejects.toThrow();
  expect(await f.auth.identity()).toBeNull();
  expect(await f.auth.remembered()).toEqual([]);
  expect(events).not.toHaveBeenCalled();
  expect(f.op.stats.accepted).toBe(0);
  expect(f.requests.some((request) => request.url.startsWith(f.op.root))).toBe(true);
  expect(
    f.requests.some(
      (request) =>
        request.url.startsWith(f.op.root) &&
        (request.headers.has("authorization") || request.headers.has("dpop")),
    ),
  ).toBe(false);
}

test.each([
  "404",
  "non-RDF",
  "network",
])("issuer-only login preserves a %s profile error and leaves no session", async (failure) => {
  const f = fixture({}, () => {
    if (failure === "404") return new Response(null, { status: 404 });
    if (failure === "non-RDF") return new Response("<html>not a profile</html>");
    throw new Error("offline");
  });
  const events = vi.fn();
  f.auth.on("login", events);
  const login = f.auth.login({ issuer: f.op.issuer });
  await expect(login).rejects.toThrow();
  await expect(login).rejects.not.toBeInstanceOf(IssuerNotAuthorizedError);
  expect(f.profiles()).toBe(1);
  await expectNoSession(f, events);
});

test("issuer-only verification and logout racing a delayed profile cannot publish a session", async () => {
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const f = fixture({}, async (request) => {
    ready.resolve();
    await release.promise;
    return f.op.fetch(request);
  });
  const event = vi.fn();
  f.auth.on("login", event);
  const pending = Promise.allSettled([f.auth.login({ issuer: f.op.issuer })]);
  await ready.promise;
  expect(await f.auth.identity()).toBeNull();
  expect(await f.auth.remembered()).toEqual([]);
  try {
    await f.auth.logout();
  } finally {
    release.resolve();
  }
  expect((await pending)[0]?.status).toBe("rejected");
  expect(await f.auth.identity()).toBeNull();
  expect(await f.auth.remembered()).toEqual([]);
  expect(event).not.toHaveBeenCalled();
  expect(f.op.stats.accepted).toBe(0);
});

test("the engine fences a completed profile while durable logout is still pending", async () => {
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const logoutReady = Promise.withResolvers<void>();
  const logoutRelease = Promise.withResolvers<void>();
  const f = fixture({}, async (request) => {
    ready.resolve();
    await release.promise;
    return f.op.fetch(request);
  });
  const set = f.sessions.setItem;
  f.sessions.setItem = async (key, value) => {
    if (JSON.parse(key)[1] === "generation") {
      logoutReady.resolve();
      await logoutRelease.promise;
    }
    return set(key, value);
  };
  const event = vi.fn();
  f.auth.on("login", event);
  const pending = Promise.allSettled([f.auth.login({ issuer: f.op.issuer })]);
  await ready.promise;
  const logout = f.auth.logout();
  await logoutReady.promise;
  release.resolve();
  try {
    // The engine's credential commit waits behind logout's exclusive fence lock.
    expect(await f.auth.identity()).toBeNull();
    expect(await f.auth.remembered()).toEqual([]);
    expect(event).not.toHaveBeenCalled();
  } finally {
    logoutRelease.resolve();
    await logout;
  }
  expect((await pending)[0]).toMatchObject({
    status: "rejected",
    reason: { name: "SessionSupersededError" },
  });
  expect(event).not.toHaveBeenCalled();
  expect(await f.auth.identity()).toBeNull();
  expect(await f.auth.remembered()).toEqual([]);
});

test("WebID hints add no profile fetch beyond the existing discovery and protocol verification", async () => {
  const f = fixture();
  expect((await f.auth.login({ webId: f.op.webId })).webId).toBe(f.op.webId);
  expect(f.profiles()).toBe(2);
  expect(f.options.ui.getWebId).not.toHaveBeenCalled();
});

test("restoring an issuer-only remembered account reuses its verified identity when refresh omits an ID token", async () => {
  const f = fixture();
  await f.auth.login({ issuer: f.op.issuer });
  const before = f.profiles();
  const restored = createPodAuth(f.options);
  expect((await restored.restore())?.webId).toBe(f.op.webId);
  expect(f.profiles()).toBe(before);
  expect(f.op.stats.refreshes).toBe(1);
});

test("an HTTP WebID on a remote host is refused even when loopback HTTP is enabled", async () => {
  const op = createMockOp({ webId: "http://remote.example/alice#me" });
  vi.stubGlobal("fetch", op.fetch);
  const auth = createPodAuth({
    clientId: { dynamicRegistration: true },
    redirectUri: "http://localhost/callback",
    allowInsecureLoopback: true,
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
  });
  await expect(auth.login({ issuer: op.issuer })).rejects.toThrow("requires HTTPS");
  expect(await auth.identity()).toBeNull();
  expect(await auth.remembered()).toEqual([]);
  expect(op.requests.some((request) => request.url.startsWith("http://remote.example/"))).toBe(
    false,
  );
});
