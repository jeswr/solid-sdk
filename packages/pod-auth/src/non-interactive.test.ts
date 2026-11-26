// AUTHORED-BY Claude Opus 5.5
import { afterEach, expect, test, vi } from "vitest";
import { createAccountManager } from "./accounts.js";
import {
  createPodAuth,
  InteractionRequiredError,
  type PodAuthOptions,
  ReplayBodyTooLargeError,
} from "./index.js";
import { forClientCredentials } from "./node.js";
import { createMemoryStore, createMockLwsAs, createMockOp } from "./testing.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const other = "https://pod.example/other/";

function fixture(config: Parameters<typeof createMockOp>[0] = {}) {
  const op = createMockOp({ protectedUrls: [other], refreshTokens: true, ...config });
  vi.stubGlobal("fetch", op.fetch);
  const ui = {
    getWebId: vi.fn(async () => op.webId!),
    getCode: vi.fn(op.getCode),
    chooseIssuer: vi.fn(async (issuers: string[]) => issuers[0]!),
  };
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    storage: { sessions: createMemoryStore(), caches: createMemoryStore() },
    boundary: { roots: [op.root, other], automatic: false },
    ui,
  };
  const untouched = () => {
    expect(ui.getWebId).not.toHaveBeenCalled();
    expect(ui.chooseIssuer).not.toHaveBeenCalled();
    expect(ui.getCode).not.toHaveBeenCalled();
  };
  return { op, ui, options, untouched, auth: createPodAuth(options) };
}

test("before sign-in a non-interactive fetch returns the 401 and opens no picker or authorization", async () => {
  const f = fixture();
  const challenges: string[] = [];
  f.auth.on("challenge", (event) => challenges.push(event.url!));
  const response = await f.auth.nonInteractiveFetch(f.op.root + "private");
  expect(response.status).toBe(401);
  f.untouched();
  expect(f.op.stats.authorizations).toBe(0);
  expect(await f.auth.identity()).toBeNull();
  // The challenge is still observable; only the sign-in it would have started is withheld.
  expect(challenges).toEqual([f.op.root + "private"]);

  // The same request through the interactive fetch signs in, which is what the option prevents.
  expect((await f.auth.fetch(f.op.root + "private")).status).toBe(200);
  expect(f.ui.getWebId).toHaveBeenCalledOnce();
  expect(f.ui.getCode).toHaveBeenCalledOnce();
});

test("after login a non-interactive fetch reuses the session without any interaction", async () => {
  const f = fixture();
  await f.auth.login({ webId: f.op.webId });
  f.ui.getCode.mockClear();
  const tokens = f.op.stats.tokens;
  const { nonInteractiveFetch } = f.auth; // usable unbound, like fetch
  const response = await nonInteractiveFetch(f.op.root + "private");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("protected Solid");
  expect(f.op.stats.tokens).toBe(tokens);
  f.untouched();
  // Public and out-of-boundary requests behave exactly like fetch.
  expect((await nonInteractiveFetch("https://pod.example/public")).status).toBe(
    (await f.auth.fetch("https://pod.example/public")).status,
  );
});

test("a context without a session gets its 401 instead of a new authorization (WebID selection)", async () => {
  const f = fixture({ issuers: ["https://op.example/", "https://second-op.example/"] });
  await f.auth.login({ webId: f.op.webId });
  expect(f.ui.chooseIssuer).toHaveBeenCalledOnce();
  f.ui.chooseIssuer.mockClear();
  f.ui.getCode.mockClear();
  const authorizations = f.op.stats.authorizations;
  // Another storage is another credential context: its issuer is not chosen yet, so no picker opens.
  expect((await f.auth.nonInteractiveFetch(other + "doc")).status).toBe(401);
  f.untouched();
  expect(f.op.stats.authorizations).toBe(authorizations);
  // The signed-in context still works.
  expect((await f.auth.nonInteractiveFetch(f.op.root + "private")).status).toBe(200);
  // Interactively, the same request asks for the issuer and a new authorization.
  expect((await f.auth.fetch(other + "doc")).status).toBe(200);
  expect(f.ui.chooseIssuer).toHaveBeenCalledOnce();
  expect(f.ui.getCode).toHaveBeenCalledOnce();
});

test("a context without a session gets its 401 instead of a new authorization (issuer selection)", async () => {
  const f = fixture();
  await f.auth.login({ issuer: f.op.issuer });
  f.ui.getCode.mockClear();
  const authorizations = f.op.stats.authorizations;
  expect((await f.auth.nonInteractiveFetch(other + "doc")).status).toBe(401);
  f.untouched();
  expect(f.op.stats.authorizations).toBe(authorizations);
});

test("silent refresh still runs, but a refused refresh never becomes an authorization or prompt=none", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const f = fixture();
  await f.auth.login({ webId: f.op.webId });
  f.ui.getCode.mockClear();
  const authorizations = f.op.stats.authorizations;

  // Past the access token's lifetime: the stored refresh grant is redeemed without the user.
  vi.setSystemTime(Date.now() + 600_000);
  const refreshes = f.op.stats.refreshes;
  expect((await f.auth.nonInteractiveFetch(f.op.root + "private")).status).toBe(200);
  expect(f.op.stats.refreshes).toBe(refreshes + 1);

  vi.setSystemTime(Date.now() + 600_000);
  f.op.failRefresh("invalid_grant");
  const response = await f.auth.nonInteractiveFetch(f.op.root + "private");
  expect(response.status).toBe(401);
  expect(f.op.stats.refreshes).toBe(refreshes + 2);
  expect(f.op.stats.authorizations).toBe(authorizations);
  f.untouched();
});

test("a transient refresh failure rejects as it does for fetch", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const f = fixture();
  await f.auth.login({ webId: f.op.webId });
  f.ui.getCode.mockClear();
  vi.setSystemTime(Date.now() + 600_000);
  f.op.failRefresh("temporarily_unavailable");
  await expect(f.auth.nonInteractiveFetch(f.op.root + "private")).rejects.toThrow();
  f.untouched();
});

test("an expired or disposed core refuses non-interactive fetches like fetch", async () => {
  const f = fixture();
  f.auth.dispose?.();
  await expect(f.auth.nonInteractiveFetch(f.op.root + "private")).rejects.toThrow();
  f.untouched();
});

/** A UMA server on the pod origin protecting `<root>uma` for every root. */
function installUma() {
  const transport = globalThis.fetch;
  let exchanges = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === "https://pod.example/.well-known/uma2-configuration")
      return Response.json({
        issuer: "https://pod.example/",
        token_endpoint: "https://pod.example/uma-token",
        uma_profiles_supported: ["http://openid.net/specs/openid-connect-core-1_0.html#IDToken"],
      });
    if (request.url === "https://pod.example/uma-token") {
      exchanges++;
      return Response.json({ access_token: "uma-access", token_type: "Bearer", expires_in: 300 });
    }
    if (request.url.endsWith("/uma"))
      return request.headers.get("authorization") === "Bearer uma-access"
        ? new Response("protected UMA")
        : new Response(null, {
            status: 401,
            headers: { "www-authenticate": 'UMA as_uri="https://pod.example/", ticket="test"' },
          });
    return transport(request);
  });
  return { exchanges: () => exchanges };
}

test("UMA: no account means a 401 without exchange; a signed-in account exchanges its cached ID token", async () => {
  const f = fixture();
  const uma = installUma();
  // Constructed after the UMA transport is installed, as pod-auth captures its pristine fetch.
  const auth = createPodAuth(f.options);
  expect((await auth.nonInteractiveFetch(f.op.root + "uma")).status).toBe(401);
  expect(uma.exchanges()).toBe(0);
  f.untouched();

  await auth.login({ issuer: f.op.issuer });
  f.ui.getCode.mockClear();
  const response = await auth.nonInteractiveFetch(f.op.root + "uma");
  expect(await response.text()).toBe("protected UMA");
  expect(uma.exchanges()).toBe(1);
  // Another storage has no ID token session: no exchange and no authorization.
  expect((await auth.nonInteractiveFetch(other + "uma")).status).toBe(401);
  expect(uma.exchanges()).toBe(1);
  f.untouched();
});

test("LWS: no account means a 401; after login the OIDC session is exchanged without interaction", async () => {
  const op = createMockOp();
  const as = createMockLwsAs({
    challenge: "resource_metadata",
    subject: {
      issuer: op.issuer,
      subject: op.subject,
      clientId: op.clientId,
      publicKey: op.publicKey,
      tokenType: "id_token",
    },
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return new URL(request.url).origin === new URL(as.issuer).origin
      ? as.fetch(request)
      : op.fetch(request);
  });
  const ui = { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) };
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { roots: [op.root, as.root], automatic: false },
    lws: { subject: "oidc-id-token" },
    ui,
  });
  expect((await auth.nonInteractiveFetch(as.root + "private")).status).toBe(401);
  expect(as.stats.exchanges).toBe(0);
  expect(ui.getWebId).not.toHaveBeenCalled();
  expect(ui.getCode).not.toHaveBeenCalled();

  await auth.login();
  ui.getCode.mockClear();
  ui.getWebId.mockClear();
  expect((await auth.nonInteractiveFetch(as.root + "private")).status).toBe(200);
  expect((await auth.nonInteractiveFetch(as.root + "private")).status).toBe(200);
  expect(as.stats.exchanges).toBe(1);
  expect(ui.getWebId).not.toHaveBeenCalled();
  expect(ui.getCode).not.toHaveBeenCalled();
});

test("the account manager exposes the active and per-account non-interactive fetch", async () => {
  const op = createMockOp({ refreshTokens: true });
  vi.stubGlobal("fetch", op.fetch);
  const ui = { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) };
  const manager = createAccountManager({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    storage: { sessions: createMemoryStore(), caches: createMemoryStore() },
    boundary: { roots: [op.root], automatic: false },
    ui,
  });
  try {
    // No active account: credential-free, so a protected resource simply answers 401.
    expect((await manager.nonInteractiveFetch(op.root + "private")).status).toBe(401);
    expect(manager.authFor(null).nonInteractiveFetch).toBeTypeOf("function");
    expect((await manager.authFor(null).nonInteractiveFetch(op.root + "private")).status).toBe(401);
    expect(ui.getCode).not.toHaveBeenCalled();

    await manager.add({ webId: op.webId });
    ui.getCode.mockClear();
    const auth = manager.authFor(op.webId!);
    expect(manager.fetchFor(op.webId!)).toBe(auth.fetch);
    expect(manager.fetchFor(op.webId!, { interactive: true })).toBe(auth.fetch);
    expect(manager.fetchFor(op.webId!, { interactive: false })).toBe(auth.nonInteractiveFetch);
    expect((await manager.nonInteractiveFetch(op.root + "private")).status).toBe(200);
    expect(ui.getCode).not.toHaveBeenCalled();
  } finally {
    manager.dispose();
  }
  expect(() => manager.nonInteractiveFetch(op.root + "private")).toThrow();
});

test("agents never interact: their non-interactive fetch is their fetch", async () => {
  const credentials = {
    clientId: "https://agent.example/client",
    clientSecret: "agent-test-value",
  };
  const op = createMockOp({ clientCredentials: credentials });
  vi.stubGlobal("fetch", op.fetch);
  const auth = await forClientCredentials({
    issuer: op.issuer,
    ...credentials,
    boundary: [op.root],
  });
  expect(auth.nonInteractiveFetch).toBe(auth.fetch);
  expect((await auth.nonInteractiveFetch(op.root + "private")).status).toBe(200);
});

test("the replay cap rejects with the typed ReplayBodyTooLargeError, also for unbounded streams", async () => {
  const f = fixture();
  const auth = createPodAuth({ ...f.options, maxReplayBodyBytes: 2 });
  await auth.login({ webId: f.op.webId });
  const error = await auth
    .fetch(f.op.root + "upload", { method: "PUT", body: "abc" })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ReplayBodyTooLargeError);
  expect((error as ReplayBodyTooLargeError).maxBytes).toBe(2);
  await expect(
    auth.nonInteractiveFetch(f.op.root + "upload", { method: "PUT", body: "abc" }),
  ).rejects.toBeInstanceOf(ReplayBodyTooLargeError);

  let pulled = 0;
  let cancelled = false;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const sent = f.op.requests.length;
  await expect(
    auth.fetch(f.op.root + "upload", {
      method: "PUT",
      body: endless,
      duplex: "half",
    } as RequestInit),
  ).rejects.toBeInstanceOf(ReplayBodyTooLargeError);
  expect(cancelled).toBe(true);
  expect(pulled).toBeLessThanOrEqual(4);
  expect(f.op.requests.length).toBe(sent);
  expect(InteractionRequiredError).toBeTypeOf("function");
});
