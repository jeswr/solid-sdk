// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import {
  AmbiguousIssuerError,
  type AuthEvent,
  type AuthEventType,
  type Identity,
  IssuerNotAuthorizedError,
  type PodAuth,
  type PodAuthOptions,
} from "@jeswr/pod-auth";
import { NotALoginAddressError, type resolveLoginTarget } from "@jeswr/pod-auth/directory";
import {
  type AuthSessionPlugin,
  createNativeCodeDriver,
  MOBILE_REDIRECT_URI,
  USER_CANCELLED,
} from "@jeswr/suite-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ID_URL } from "../src/lib/urls";
import { SolidBackend, type SolidBackendOptions } from "../src/shell/session/solid-backend";
import { SignInError, type SuiteAccount } from "../src/shell/session/types";

const nativeBindings = vi.hoisted(() => ({
  authSessionPlugin: { authenticate: vi.fn(), cancel: vi.fn(async () => {}) },
}));
vi.mock("@jeswr/suite-native/capacitor", () => nativeBindings);

const alice = {
  grantId: "alice-grant",
  webId: "https://pod.example/alice/profile#me",
  issuer: "https://id.example/",
  subject: "alice",
  clientId: "https://suite.example/.well-known/solid-client-id.jsonld",
  protocol: "solid-oidc",
  storages: ["https://pod.example/alice/"],
} satisfies Identity;
const bob = {
  id: "solid:https://pod.example/bob/profile#me",
  webId: "https://pod.example/bob/profile#me",
  issuer: alice.issuer,
  name: "Bob",
  storageUrl: "https://pod.example/bob/",
  kind: "solid",
} satisfies SuiteAccount;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness(options: SolidBackendOptions = {}) {
  let identity: Identity | null = null;
  let config!: PodAuthOptions;
  const listeners = new Map<AuthEventType, Set<(event: AuthEvent) => void>>();
  const emit = (type: AuthEventType) => {
    for (const listener of listeners.get(type) ?? [])
      listener({ type, identity: null, timestamp: 0 });
  };
  const auth = {
    login: vi.fn<PodAuth["login"]>(async () => {
      identity = alice;
      return alice;
    }),
    restore: vi.fn<PodAuth["restore"]>(async () => identity),
    identity: vi.fn<PodAuth["identity"]>(async () => identity),
    remembered: vi.fn<PodAuth["remembered"]>(async () =>
      identity?.webId ? [{ webId: identity.webId, issuer: identity.issuer }] : [],
    ),
    logout: vi.fn<PodAuth["logout"]>(async () => {
      identity = null;
      emit("logout");
    }),
    retireIfOwnedBy: vi.fn<PodAuth["retireIfOwnedBy"]>(async (expected) => {
      if (!expected.grantId) return { retired: false, reason: "missing-grant" };
      if (!identity) return { retired: false, reason: "no-grant" };
      if (identity.webId !== expected.webId || identity.issuer !== expected.issuer)
        return { retired: false, reason: "owner-changed" };
      if (identity.grantId !== expected.grantId) return { retired: false, reason: "grant-changed" };
      identity = null;
      emit("logout");
      return { retired: true };
    }),
    fetch: vi.fn<typeof fetch>(async () => new Response("private content")),
    on: vi.fn<PodAuth["on"]>((type, listener) => {
      const handlers = listeners.get(type) ?? new Set();
      listeners.set(type, handlers);
      handlers.add(listener);
      return () => {
        handlers.delete(listener);
      };
    }),
  };
  const createAuth = vi.fn((options: PodAuthOptions) => {
    config = options;
    return auth;
  });
  const resolveTarget = vi.fn<typeof resolveLoginTarget>(async (input) =>
    input.includes("profile") ? { kind: "webid", webId: input } : { kind: "issuer", issuer: input },
  );
  const publicFetch = vi.fn<typeof fetch>(
    async () =>
      new Response(
        `<${alice.webId}> <http://xmlns.com/foaf/0.1/name> "Alice"; <http://www.w3.org/2006/vcard/ns#hasPhoto> "https://images.example/alice.png".`,
        { headers: { "content-type": "text/turtle" } },
      ),
  );
  const popup = {
    getCode: vi.fn(
      async () => "https://suite.example/auth/callback.html?code=example&state=example",
    ),
    close: vi.fn(),
  };
  const openPopup = vi.fn(() => popup);
  const backend = new SolidBackend({
    createAuth,
    resolveTarget,
    publicFetch,
    openPopup,
    ...options,
  });
  return {
    backend,
    auth,
    createAuth,
    resolveTarget,
    publicFetch,
    popup,
    openPopup,
    config: () => config,
    emit,
    setIdentity: (value: Identity | null) => {
      identity = value;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("location", new URL("https://suite.example/"));
});

const nativeCallback = `${MOBILE_REDIRECT_URI}?code=example&state=example&iss=https%3A%2F%2Fid.example%2F`;
function nativeAuthorizationUrl(prompt = "consent") {
  const url = new URL("https://id.example/authorize");
  url.search = new URLSearchParams({
    client_id: CLIENT_ID_URL,
    redirect_uri: MOBILE_REDIRECT_URI,
    response_type: "code",
    code_challenge: "example",
    code_challenge_method: "S256",
    state: "example",
    prompt,
  }).toString();
  return url;
}
function nativeHarness(options: SolidBackendOptions = {}) {
  const plugin = {
    authenticate: vi.fn<AuthSessionPlugin["authenticate"]>(async () => ({ url: nativeCallback })),
    cancel: vi.fn<AuthSessionPlugin["cancel"]>(async () => {}),
  };
  const loadPlugin = vi.fn<() => Promise<AuthSessionPlugin>>(async () => plugin);
  const createDriver = vi.fn(createNativeCodeDriver);
  return {
    ...harness({
      isNativeApp: () => true,
      loadAuthSessionPlugin: loadPlugin,
      createNativeCodeDriver: createDriver,
      ...options,
    }),
    plugin,
    loadPlugin,
    createDriver,
  };
}

describe("native Solid shell over pod-auth", () => {
  it("loads the registered SuiteAuthSession binding by default", async () => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "android" });
    const h = harness();
    nativeBindings.authSessionPlugin.authenticate.mockResolvedValue({ url: nativeCallback });
    h.auth.login.mockImplementation(async (_hint, options) => {
      if (!options?.signal) throw new Error("Expected a login signal");
      expect(await h.config().ui.getCode(nativeAuthorizationUrl(), options.signal)).toBe(
        nativeCallback,
      );
      return alice;
    });
    await h.backend.signIn({ issuer: alice.issuer });
    expect(nativeBindings.authSessionPlugin.authenticate).toHaveBeenCalledExactlyOnceWith({
      url: nativeAuthorizationUrl().href,
      callbackScheme: "org.jeswr.suite",
    });
    expect(h.openPopup).not.toHaveBeenCalled();
  });

  it.each([
    "capacitor://localhost/",
    "https://localhost/",
    "http://localhost:3210/",
    "https://suite.example/",
  ])("uses the public mobile identity and scheme callback from %s", async (origin) => {
    vi.stubGlobal("location", new URL(origin));
    const h = nativeHarness();
    h.auth.login.mockImplementation(async (_hint, options) => {
      if (!options?.signal) throw new Error("Expected a login signal");
      expect(await h.config().ui.getCode(nativeAuthorizationUrl(), options.signal)).toBe(
        nativeCallback,
      );
      const identity = { ...alice, clientId: CLIENT_ID_URL };
      h.setIdentity(identity);
      return identity;
    });
    await h.backend.signIn({ issuer: alice.issuer });
    expect(h.config()).toMatchObject({
      clientId: CLIENT_ID_URL,
      redirectUri: MOBILE_REDIRECT_URI,
      allowInsecureLoopback: false,
      nativeRedirect: true,
    });
    expect(CLIENT_ID_URL).toBe(
      "https://solid-suite.vercel.app/.well-known/solid-client-id-mobile.jsonld",
    );
    expect(h.resolveTarget).toHaveBeenCalledWith(
      alice.issuer,
      expect.objectContaining({ allowInsecureLoopback: false }),
    );
    expect(h.createDriver).toHaveBeenCalledExactlyOnceWith({
      plugin: h.plugin,
      redirectUri: MOBILE_REDIRECT_URI,
      returns: "callback",
    });
    expect(h.plugin.authenticate).toHaveBeenCalledExactlyOnceWith({
      url: nativeAuthorizationUrl().href,
      callbackScheme: "org.jeswr.suite",
    });
    expect(h.openPopup).not.toHaveBeenCalled();
    expect(h.popup.getCode).not.toHaveBeenCalled();
    expect(h.popup.close).not.toHaveBeenCalled();
    await expect(
      h.config().ui.getCode(nativeAuthorizationUrl(), new AbortController().signal),
    ).rejects.toEqual(new SignInError("cancelled"));
    expect(h.plugin.authenticate).toHaveBeenCalledOnce();
  });

  it("rejects HTTP loopback providers even in a development WebView", async () => {
    vi.stubGlobal("location", new URL("https://localhost/"));
    const h = nativeHarness();
    await expect(h.backend.signIn({ issuer: "http://localhost:3000/" })).rejects.toEqual(
      new SignInError("invalid-url"),
    );
    expect(h.createAuth).not.toHaveBeenCalled();
    expect(h.loadPlugin).not.toHaveBeenCalled();
    expect(h.openPopup).not.toHaveBeenCalled();
  });

  it.each([
    { prompt: "consent", signingIn: false },
    { prompt: "none", signingIn: false },
    { prompt: "consent", signingIn: true },
    { prompt: "none", signingIn: true },
  ])("blocks restore prompt=$prompt (inside sign-in: $signingIn)", async ({
    prompt,
    signingIn,
  }) => {
    const h = nativeHarness();
    h.auth.restore.mockImplementation(async () => {
      await expect(
        h.config().ui.getCode(nativeAuthorizationUrl(prompt), new AbortController().signal),
      ).rejects.toEqual(new SignInError("cancelled"));
      return null;
    });
    if (signingIn) await h.backend.signIn({ issuer: alice.issuer });
    else expect(await h.backend.restore()).toBeNull();
    expect(h.auth.restore).toHaveBeenCalledOnce();
    expect(h.auth.login).toHaveBeenCalledTimes(signingIn ? 1 : 0);
    expect(h.loadPlugin).not.toHaveBeenCalled();
    expect(h.createDriver).not.toHaveBeenCalled();
    expect(h.plugin.authenticate).not.toHaveBeenCalled();
    expect(h.openPopup).not.toHaveBeenCalled();
  });

  it.each([
    "none",
    "consent none",
  ])("blocks prompt=%s even during explicit authorization", async (prompt) => {
    const h = nativeHarness();
    h.auth.login.mockImplementation(async (_hint, options) => {
      if (!options?.signal) throw new Error("Expected a login signal");
      await h.config().ui.getCode(nativeAuthorizationUrl(prompt), options.signal);
      return alice;
    });
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
      new SignInError("cancelled"),
    );
    expect(h.loadPlugin).not.toHaveBeenCalled();
    expect(h.createDriver).not.toHaveBeenCalled();
    expect(h.plugin.authenticate).not.toHaveBeenCalled();
    expect(h.openPopup).not.toHaveBeenCalled();
  });

  it("expires on background authorization without reaching the native driver", async () => {
    const h = nativeHarness();
    const expired = vi.fn();
    h.backend.onExpired(expired);
    const account = await h.backend.signIn({ issuer: alice.issuer });
    h.auth.fetch.mockImplementation(async () => {
      await h.config().ui.getCode(nativeAuthorizationUrl(), new AbortController().signal);
      return new Response();
    });
    await expect(h.backend.fetchFor(account)(account.storageUrl)).rejects.toEqual(
      new SignInError("cancelled"),
    );
    expect(expired).toHaveBeenCalledOnce();
    expect(h.loadPlugin).not.toHaveBeenCalled();
    expect(h.plugin.authenticate).not.toHaveBeenCalled();
    expect(h.openPopup).not.toHaveBeenCalled();
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("maps a dismissed system browser to cancelled", async () => {
    const h = nativeHarness();
    h.plugin.authenticate.mockRejectedValue({ code: USER_CANCELLED });
    h.auth.login.mockImplementation(async (_hint, options) => {
      if (!options?.signal) throw new Error("Expected a login signal");
      await h.config().ui.getCode(nativeAuthorizationUrl(), options.signal);
      return alice;
    });
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
      new SignInError("cancelled"),
    );
    expect(h.plugin.authenticate).toHaveBeenCalledOnce();
    expect(h.openPopup).not.toHaveBeenCalled();
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("aborts the native driver without logging out or opening a popup", async () => {
    const h = nativeHarness();
    const entered = deferred<void>();
    const callback = deferred<{ url: string }>();
    h.plugin.authenticate.mockImplementation(() => {
      entered.resolve();
      return callback.promise;
    });
    h.auth.login.mockImplementation(async (_hint, options) => {
      if (!options?.signal) throw new Error("Expected a login signal");
      await h.config().ui.getCode(nativeAuthorizationUrl(), options.signal);
      return alice;
    });
    const cancel = new AbortController();
    const signingIn = h.backend.signIn({ issuer: alice.issuer }, { signal: cancel.signal });
    const rejected = expect(signingIn).rejects.toEqual(new SignInError("cancelled"));
    await entered.promise;
    cancel.abort();
    await rejected;
    callback.resolve({ url: nativeCallback });
    expect(h.plugin.cancel).toHaveBeenCalledOnce();
    expect(h.openPopup).not.toHaveBeenCalled();
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("does not open a late-loaded plugin after cancellation", async () => {
    const h = nativeHarness();
    const entered = deferred<void>();
    const loaded = deferred<AuthSessionPlugin>();
    h.loadPlugin.mockImplementationOnce(async () => {
      entered.resolve();
      return loaded.promise;
    });
    h.auth.login.mockImplementation(async (_hint, options) => {
      if (!options?.signal) throw new Error("Expected a login signal");
      await h.config().ui.getCode(nativeAuthorizationUrl(), options.signal);
      return alice;
    });
    const cancel = new AbortController();
    const signingIn = h.backend.signIn({ issuer: alice.issuer }, { signal: cancel.signal });
    const rejected = expect(signingIn).rejects.toEqual(new SignInError("cancelled"));
    await entered.promise;
    cancel.abort();
    loaded.resolve(h.plugin);
    await rejected;
    expect(h.plugin.authenticate).not.toHaveBeenCalled();
    expect(h.openPopup).not.toHaveBeenCalled();
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("keeps the web popup path without loading native bindings", async () => {
    const h = nativeHarness({ isNativeApp: () => false });
    h.auth.login.mockImplementation(async (_hint, options) => {
      if (!options?.signal) throw new Error("Expected a login signal");
      expect(await h.config().ui.getCode(nativeAuthorizationUrl(), options.signal)).toContain(
        "/auth/callback.html?",
      );
      return alice;
    });
    await h.backend.signIn({ issuer: alice.issuer });
    expect(h.config()).toMatchObject({
      clientId: alice.clientId,
      redirectUri: "https://suite.example/auth/callback.html",
      allowInsecureLoopback: false,
    });
    expect(h.config()).not.toHaveProperty("nativeRedirect");
    expect(h.openPopup).toHaveBeenCalledExactlyOnceWith("https://suite.example/auth/callback.html");
    expect(h.popup.getCode).toHaveBeenCalledOnce();
    expect(h.popup.close).toHaveBeenCalledOnce();
    expect(h.loadPlugin).not.toHaveBeenCalled();
    expect(h.createDriver).not.toHaveBeenCalled();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Solid shell over pod-auth", () => {
  it.each([
    { issuer: alice.issuer },
    { webId: alice.webId as string },
  ])("maps and authenticates %j without storing credentials", async (hint) => {
    const h = harness();
    const localStorage = { setItem: vi.fn() };
    vi.stubGlobal("localStorage", localStorage);
    const account = await h.backend.signIn(hint);
    expect(h.auth.login).toHaveBeenCalledWith(hint, { signal: expect.any(AbortSignal) });
    expect(account).toEqual({
      id: `solid:${alice.webId}`,
      kind: "solid",
      webId: alice.webId,
      issuer: alice.issuer,
      name: "Alice",
      photoUrl: "https://images.example/alice.png",
      storageUrl: alice.storages[0],
    });
    expect(h.config()).toMatchObject({
      clientId: alice.clientId,
      redirectUri: "https://suite.example/auth/callback.html",
      allowInsecureLoopback: false,
    });
    expect(h.config().boundary).toBeUndefined();
    expect(h.publicFetch).toHaveBeenCalledWith(
      alice.webId,
      expect.objectContaining({ credentials: "omit" }),
    );
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(h.openPopup).toHaveBeenCalledBefore(h.resolveTarget);
    expect(h.popup.close).toHaveBeenCalledOnce();
    const init = { method: "GET", headers: { accept: "text/turtle" } };
    expect(
      await (await h.backend.fetchFor(account)(`${account.storageUrl}private`, init)).text(),
    ).toBe("private content");
    expect(h.auth.fetch).toHaveBeenCalledWith(`${account.storageUrl}private`, init);
  });

  it("passes the complete popup callback to pod-auth's UI seam", async () => {
    const h = harness();
    h.auth.login.mockImplementation(async (_hint, options) => {
      const url = new URL("https://id.example/authorize?prompt=consent");
      if (!options?.signal) throw new Error("Expected a login signal");
      expect(await h.config().ui.getCode(url, options.signal)).toContain("&state=example");
      h.setIdentity(alice);
      return alice;
    });
    await h.backend.signIn({ issuer: alice.issuer });
    expect(h.popup.getCode).toHaveBeenCalledOnce();
  });

  it.each([
    "http://localhost:3210/",
    "http://127.0.0.1:3210/",
    "http://[::1]:3210/",
  ])("reuses Drive's development registration at %s", async (origin) => {
    vi.stubGlobal("location", new URL(origin));
    const h = harness();
    await h.backend.signIn({ issuer: "http://localhost:3000/" });
    expect(h.config()).toMatchObject({
      clientId: { dynamicRegistration: true },
      allowInsecureLoopback: true,
      redirectUri: new URL("/auth/callback.html", origin).href,
    });
  });

  it("keeps production HTTPS-only even when served on localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("location", new URL("https://localhost/"));
    const h = harness();
    await h.backend.signIn({ issuer: alice.issuer });
    expect(h.config().clientId).toBe("https://localhost/.well-known/solid-client-id.jsonld");
    expect(h.config().allowInsecureLoopback).toBe(false);
    await expect(h.backend.signIn({ issuer: "http://localhost:3000/" })).rejects.toMatchObject({
      code: "invalid-url",
    });
  });

  it("restores through pod-auth once across StrictMode replay and a fresh backend after reload", async () => {
    const h = harness();
    const gate = deferred<Identity | null>();
    h.auth.restore.mockReturnValue(gate.promise);
    const first = h.backend.restore();
    expect(h.backend.restore()).toBe(first);
    h.setIdentity(alice);
    gate.resolve(alice);
    const account = await first;
    expect(account?.name).toBe("Alice");
    const reload = new SolidBackend({ createAuth: h.createAuth, publicFetch: h.publicFetch });
    expect(await reload.restore()).toEqual(account);
    expect(h.auth.login).not.toHaveBeenCalled();
    expect(h.openPopup).not.toHaveBeenCalled();
  });

  it("restores a signed-out account as null", async () => {
    const h = harness();
    expect(await h.backend.restore()).toBeNull();
    expect(h.auth.login).not.toHaveBeenCalled();
  });

  it("signs in after cold restore expires with a missing credential and no identity snapshot", async () => {
    const h = harness();
    h.auth.restore.mockImplementationOnce(async () => {
      h.emit("expired");
      return null;
    });
    expect(await h.backend.restore()).toBeNull();
    expect((await h.backend.signIn({ issuer: alice.issuer })).webId).toBe(alice.webId);
    // No accepted snapshot means no grant to retire; nothing is remembered, so login proceeds.
    expect(h.auth.retireIfOwnedBy).not.toHaveBeenCalled();
    expect(h.auth.login).toHaveBeenCalledOnce();
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("gates sign-in after a cold restore expires but keeps the remembered pointer", async () => {
    const h = harness();
    h.auth.restore.mockImplementation(async () => {
      h.emit("expired");
      return null;
    });
    h.auth.remembered.mockResolvedValue([{ webId: alice.webId, issuer: alice.issuer }]);
    expect(await h.backend.restore()).toBeNull();
    for (const hint of [{ issuer: alice.issuer }, { webId: bob.webId }]) {
      await expect(h.backend.signIn(hint)).rejects.toEqual(new SignInError("session-elsewhere"));
    }
    expect(h.auth.login).not.toHaveBeenCalled();
    const account = await h.backend.signIn({ webId: alice.webId });
    expect(account.webId).toBe(alice.webId);
    expect(h.auth.login).toHaveBeenCalledExactlyOnceWith({ webId: alice.webId }, expect.anything());
    expect(h.auth.retireIfOwnedBy).not.toHaveBeenCalled();
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect((await h.backend.fetchFor(account)(account.storageUrl)).ok).toBe(true);
  });

  it("signs in again after another tab signs out and removes the owner record", async () => {
    const h = harness();
    const account = await h.backend.signIn({ issuer: alice.issuer });
    const oldFetch = h.backend.fetchFor(account);
    h.setIdentity(null);
    await expect(oldFetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
    expect((await h.backend.signIn({ issuer: alice.issuer })).webId).toBe(alice.webId);
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledExactlyOnceWith(alice);
    expect(h.auth.login).toHaveBeenCalledTimes(2);
    expect(h.auth.logout).not.toHaveBeenCalled();
    await expect(oldFetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
  });

  it("allows retry after a transient restore error without logging out", async () => {
    const h = harness();
    h.auth.restore.mockRejectedValueOnce(new TypeError("offline"));
    await expect(h.backend.restore()).rejects.toThrow("offline");
    h.setIdentity(alice);
    expect((await h.backend.restore())?.webId).toBe(alice.webId);
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("does not resurrect a session that expires while display metadata is loading", async () => {
    const h = harness();
    h.setIdentity(alice);
    const metadata = deferred<Response>();
    const entered = deferred<void>();
    h.publicFetch.mockImplementationOnce(() => {
      entered.resolve();
      return metadata.promise;
    });
    const restoring = h.backend.restore();
    await entered.promise;
    h.emit("expired");
    metadata.resolve(new Response("", { headers: { "content-type": "text/turtle" } }));
    expect(await restoring).toBeNull();
    expect(await h.backend.restore()).toBeNull();
  });

  it("keeps the active session and refuses a second sign-in, including the same issuer", async () => {
    const h = harness();
    const account = await h.backend.signIn({ issuer: alice.issuer });
    for (const hint of [{ webId: bob.webId }, { issuer: alice.issuer }])
      await expect(h.backend.signIn(hint)).rejects.toMatchObject({ code: "account-active" });
    expect(h.auth.login).toHaveBeenCalledOnce();
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect((await h.backend.fetchFor(account)("https://pod.example/alice/private")).ok).toBe(true);
  });

  it("signs out only the matching account and invalidates previously returned fetch handles", async () => {
    const h = harness();
    const account = await h.backend.signIn({ issuer: alice.issuer });
    const fetch = h.backend.fetchFor(account);
    await h.backend.signOut(bob);
    await h.backend.signOut({ ...account, kind: "demo" });
    await h.backend.signOut({ ...account, issuer: "https://other.example/" });
    expect(h.auth.logout).not.toHaveBeenCalled();
    await h.backend.signOut(account);
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledExactlyOnceWith(alice);
    expect(h.auth.logout).not.toHaveBeenCalled();
    await expect(fetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
    expect(await h.backend.restore()).toBeNull();
    await h.backend.signIn({ issuer: alice.issuer });
    await expect(fetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
  });

  it.each([
    { operation: "sign-out", sameAccount: true, restore: false },
    { operation: "sign-out", sameAccount: false, restore: false },
    { operation: "reauthenticate", sameAccount: true, restore: false },
    { operation: "reauthenticate", sameAccount: false, restore: false },
    { operation: "sign-out", sameAccount: true, restore: true },
    { operation: "sign-out", sameAccount: false, restore: true },
    { operation: "reauthenticate", sameAccount: true, restore: true },
    { operation: "reauthenticate", sameAccount: false, restore: true },
  ])("preserves a grant committed at cleanup: $operation, sameAccount=$sameAccount, restore=$restore", async ({
    operation,
    sameAccount,
    restore,
  }) => {
    const h = harness();
    if (restore) h.setIdentity(alice);
    const account = restore
      ? await h.backend.restore()
      : await h.backend.signIn({ issuer: alice.issuer });
    if (!account) throw new Error("Expected an accepted account");
    const newer = {
      ...alice,
      grantId: "newer-grant",
      ...(sameAccount ? {} : { webId: bob.webId, subject: "bob", storages: [bob.storageUrl] }),
    };
    // The other tab commits after any ownership reads and immediately before cleanup locks.
    const retire = h.auth.retireIfOwnedBy.getMockImplementation();
    const logout = h.auth.logout.getMockImplementation();
    if (!retire || !logout) throw new Error("Expected cleanup implementations");
    h.auth.retireIfOwnedBy.mockImplementationOnce(async (expected) => {
      h.setIdentity(newer);
      return retire(expected);
    });
    h.auth.logout.mockImplementationOnce(async () => {
      h.setIdentity(newer);
      await logout();
    });
    if (operation === "sign-out") await h.backend.signOut(account);
    else {
      h.emit("expired");
      await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
        new SignInError("account-active"),
      );
    }
    expect(await h.auth.identity()).toEqual(newer);
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledExactlyOnceWith(alice);
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect(h.auth.login).toHaveBeenCalledTimes(restore ? 0 : 1);
  });

  it.each([
    "missing-grant",
    "no-grant",
    "owner-changed",
    "grant-changed",
  ] as const)("diagnoses skipped retirement and handles each operation: %s", async (reason) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      for (const operation of ["sign-out", "reauthenticate", "reject-identity"]) {
        const h = harness();
        const account = await h.backend.signIn({ issuer: alice.issuer });
        h.auth.retireIfOwnedBy.mockResolvedValue({ retired: false, reason });
        if (operation === "sign-out") {
          // Only an ownership change implies a live session in another tab.
          expect(await h.backend.signOut(account)).toEqual(
            reason === "owner-changed" || reason === "grant-changed"
              ? { notice: "Signed out here. A session in another tab may still be active." }
              : undefined,
          );
          expect(await h.backend.restore()).toBeNull();
          await expect(h.backend.fetchFor(account)(account.storageUrl)).rejects.toThrow(
            "Sign in to continue",
          );
        } else {
          h.emit("expired");
          if (operation === "reject-identity") {
            // A new backend receives a rejected identity during restore.
            h.setIdentity({ ...alice, storages: [] });
            const reload = new SolidBackend({ createAuth: h.createAuth });
            await expect(reload.restore()).rejects.toEqual(new SignInError("invalid-identity"));
          } else {
            if (reason === "missing-grant" || reason === "no-grant") {
              expect((await h.backend.signIn({ issuer: alice.issuer })).webId).toBe(alice.webId);
              expect(h.auth.login).toHaveBeenCalledTimes(2);
            } else {
              await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
                new SignInError("account-active"),
              );
              expect(await h.backend.restore()).toBeNull();
              expect(h.auth.login).toHaveBeenCalledOnce();
            }
          }
        }
        expect(h.auth.logout).not.toHaveBeenCalled();
        expect(
          reason === "missing-grant" || reason === "no-grant" ? warning : info,
        ).toHaveBeenLastCalledWith("Solid session retirement skipped", { operation, reason });
      }
    } finally {
      warning.mockRestore();
      info.mockRestore();
    }
  });

  it.each([
    "missing-grant",
    "no-grant",
  ] as const)("blocks reauthentication of a different remembered legacy account after %s", async (reason) => {
    for (const remembered of [
      { webId: bob.webId, issuer: alice.issuer },
      { webId: alice.webId, issuer: "https://other.example/" },
    ]) {
      const h = harness();
      await h.backend.signIn({ issuer: alice.issuer });
      h.emit("expired");
      h.auth.retireIfOwnedBy.mockResolvedValue({ retired: false, reason });
      h.auth.remembered.mockResolvedValue([remembered]);
      await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
        new SignInError("account-active"),
      );
      expect(h.auth.login).toHaveBeenCalledOnce();
      expect(h.auth.logout).not.toHaveBeenCalled();
    }
  });

  it("clears this tab on a skipped sign-out without restoring or retiring the newer grant", async () => {
    const h = harness();
    const account = await h.backend.signIn({ issuer: alice.issuer });
    const oldFetch = h.backend.fetchFor(account);
    const newer = { ...alice, grantId: "newer-grant" };
    h.setIdentity(newer);
    await h.backend.signOut(account);
    expect(await h.auth.identity()).toEqual(newer);
    expect(await h.backend.restore()).toBeNull();
    await expect(oldFetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
    await expect(h.backend.fetchFor(account)(account.storageUrl)).rejects.toThrow(
      "Sign in to continue",
    );
    expect(h.auth.fetch).not.toHaveBeenCalled();
    // A provider hint cannot name the account, so it refuses rather than replace the grant.
    h.auth.restore.mockClear();
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
      new SignInError("session-elsewhere"),
    );
    expect(h.auth.restore).not.toHaveBeenCalled();
    // The exact WebID adopts the newer grant for the same account instead of replacing it.
    expect((await h.backend.signIn({ webId: alice.webId })).webId).toBe(alice.webId);
    expect(h.auth.login).toHaveBeenCalledOnce();
    expect(await h.auth.identity()).toEqual(newer);
    expect(h.auth.logout).not.toHaveBeenCalled();
    await expect(oldFetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
  });

  describe("signs in after a skipped sign-out while another account owns the namespace", () => {
    const bobIdentity = {
      ...alice,
      grantId: "bob-grant",
      webId: bob.webId,
      subject: "bob",
      storages: [bob.storageUrl],
    } satisfies Identity;
    async function skippedSignOut() {
      const h = harness();
      const account = await h.backend.signIn({ issuer: alice.issuer });
      // Another tab signed out Alice and signed in as Bob.
      h.setIdentity(bobIdentity);
      expect(await h.backend.signOut(account)).toEqual({
        notice: "Signed out here. A session in another tab may still be active.",
      });
      h.auth.login.mockClear();
      h.auth.restore.mockClear();
      return h;
    }

    it.each([
      { webId: alice.webId },
      { issuer: "https://other-id.example/" },
      // A shared issuer cannot identify the account to adopt.
      { issuer: bob.issuer },
    ])("refuses %o without calling login or replacing the owner", async (hint) => {
      const h = await skippedSignOut();
      await expect(h.backend.signIn(hint)).rejects.toEqual(new SignInError("session-elsewhere"));
      expect(h.auth.login).not.toHaveBeenCalled();
      expect(h.auth.restore).not.toHaveBeenCalled();
      expect(h.auth.logout).not.toHaveBeenCalled();
      expect(await h.auth.identity()).toEqual(bobIdentity);
      expect(await h.backend.restore()).toBeNull();
    });

    it("adopts the live session that the exact WebID hint names without login", async () => {
      const h = await skippedSignOut();
      const account = await h.backend.signIn({ webId: bob.webId });
      expect(account).toMatchObject({ id: bob.id, webId: bob.webId, storageUrl: bob.storageUrl });
      expect(h.auth.login).not.toHaveBeenCalled();
      expect(h.auth.restore).toHaveBeenCalledOnce();
      expect(await h.auth.identity()).toEqual(bobIdentity);
      expect(await h.backend.restore()).toEqual(account);
      expect((await h.backend.fetchFor(account)(account.storageUrl)).ok).toBe(true);
      // The adopted snapshot retires Bob's grant on sign-out.
      expect(await h.backend.signOut(account)).toBeUndefined();
      expect(h.auth.retireIfOwnedBy).toHaveBeenLastCalledWith(bobIdentity);
      expect(await h.auth.identity()).toBeNull();
    });

    it("refuses when the remembered session changes to another account before adoption", async () => {
      const h = await skippedSignOut();
      h.auth.restore.mockImplementationOnce(async () => {
        h.setIdentity(alice);
        return alice;
      });
      await expect(h.backend.signIn({ webId: bob.webId })).rejects.toEqual(
        new SignInError("session-elsewhere"),
      );
      expect(h.auth.login).not.toHaveBeenCalled();
      expect(await h.backend.restore()).toBeNull();
    });

    it("logs in once a remembered session that cannot be restored has gone", async () => {
      const h = await skippedSignOut();
      h.auth.restore.mockImplementationOnce(async () => {
        h.setIdentity(null);
        return null;
      });
      expect((await h.backend.signIn({ webId: bob.webId })).webId).toBe(alice.webId);
      expect(h.auth.login).toHaveBeenCalledOnce();
    });

    it("lets the named account replace its own unrestorable grant, but refuses a provider hint", async () => {
      const h = await skippedSignOut();
      h.auth.restore.mockResolvedValue(null);
      await expect(h.backend.signIn({ issuer: bob.issuer })).rejects.toEqual(
        new SignInError("session-elsewhere"),
      );
      expect(h.auth.restore).not.toHaveBeenCalled();
      await h.backend.signIn({ webId: bob.webId });
      expect(h.auth.login).toHaveBeenCalledExactlyOnceWith({ webId: bob.webId }, expect.anything());
    });

    it("refuses when an unrestorable pointer changes to another account", async () => {
      const h = await skippedSignOut();
      h.auth.restore.mockImplementationOnce(async () => {
        h.setIdentity(alice);
        return null;
      });
      await expect(h.backend.signIn({ webId: bob.webId })).rejects.toEqual(
        new SignInError("session-elsewhere"),
      );
      expect(h.auth.login).not.toHaveBeenCalled();
      expect(await h.auth.identity()).toEqual(alice);
    });

    it("cancels while reading the remembered session without restoring or logging in", async () => {
      const h = await skippedSignOut();
      const remembered = deferred<Awaited<ReturnType<PodAuth["remembered"]>>>();
      const entered = deferred<void>();
      h.auth.remembered.mockImplementationOnce(() => {
        entered.resolve();
        return remembered.promise;
      });
      const controller = new AbortController();
      const signingIn = h.backend.signIn({ webId: bob.webId }, { signal: controller.signal });
      const failure = expect(signingIn).rejects.toEqual(new SignInError("cancelled"));
      await entered.promise;
      controller.abort();
      remembered.resolve([{ webId: bob.webId, issuer: bob.issuer }]);
      await failure;
      expect(h.auth.restore).not.toHaveBeenCalled();
      expect(h.auth.login).not.toHaveBeenCalled();
    });

    it("fences an adoption that a sign-out overtakes", async () => {
      const h = await skippedSignOut();
      const restored = deferred<Identity | null>();
      const entered = deferred<void>();
      h.auth.restore.mockImplementationOnce(() => {
        entered.resolve();
        return restored.promise;
      });
      const signingIn = h.backend.signIn({ webId: bob.webId });
      const failure = expect(signingIn).rejects.toEqual(new SignInError("cancelled"));
      await entered.promise;
      await h.backend.signOut(bob);
      restored.resolve(bobIdentity);
      await failure;
      expect(h.auth.login).not.toHaveBeenCalled();
      expect(await h.backend.restore()).toBeNull();
    });
  });

  it("refuses sign-in over a remembered session that a cold restore did not return", async () => {
    const h = harness();
    h.auth.restore.mockResolvedValueOnce(null);
    h.auth.remembered.mockResolvedValue([{ webId: bob.webId, issuer: bob.issuer }]);
    await expect(h.backend.signIn({ webId: alice.webId })).rejects.toEqual(
      new SignInError("session-elsewhere"),
    );
    expect(h.auth.login).not.toHaveBeenCalled();
  });

  it("recovers from a persistent non-invalid_grant restore failure with the exact WebID", async () => {
    const h = harness();
    // An invalid_client-style refresh failure keeps the pointer, returns null and emits no expiry.
    h.auth.restore.mockResolvedValue(null);
    h.auth.remembered.mockResolvedValue([{ webId: alice.webId, issuer: alice.issuer }]);
    expect(await h.backend.restore()).toBeNull();
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
      new SignInError("session-elsewhere"),
    );
    expect(h.auth.login).not.toHaveBeenCalled();
    const account = await h.backend.signIn({ webId: alice.webId });
    expect(account.webId).toBe(alice.webId);
    expect(h.auth.login).toHaveBeenCalledExactlyOnceWith({ webId: alice.webId }, expect.anything());
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect((await h.backend.fetchFor(account)(account.storageUrl)).ok).toBe(true);
  });

  it("continues to login when the adopted session expires during restore", async () => {
    const h = harness();
    h.setIdentity(alice);
    // This tab's restore missed the session; adoption's restore then hits invalid_grant, which
    // clears the pointer and emits expiry.
    h.auth.restore.mockResolvedValueOnce(null).mockImplementationOnce(async () => {
      h.setIdentity(null);
      h.emit("expired");
      return null;
    });
    expect((await h.backend.signIn({ webId: alice.webId })).webId).toBe(alice.webId);
    expect(h.auth.restore).toHaveBeenCalledTimes(2);
    expect(h.auth.login).toHaveBeenCalledOnce();
  });

  it("clears this tab even if retirement rejects after attempting cleanup", async () => {
    const h = harness();
    const account = await h.backend.signIn({ issuer: alice.issuer });
    h.auth.retireIfOwnedBy.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(h.backend.signOut(account)).rejects.toThrow("storage unavailable");
    expect(await h.backend.restore()).toBeNull();
    await expect(h.backend.fetchFor(account)(account.storageUrl)).rejects.toThrow(
      "Sign in to continue",
    );
  });

  it("ignores expiry from detached work after skipped sign-out", async () => {
    const h = harness();
    const account = await h.backend.signIn({ issuer: alice.issuer });
    h.setIdentity({ ...alice, grantId: "newer-grant" });
    await h.backend.signOut(account);
    h.emit("expired");
    expect((await h.backend.signIn({ webId: alice.webId })).webId).toBe(alice.webId);
  });

  it("fences an old fetch identity read across skipped sign-out and explicit sign-in", async () => {
    const h = harness();
    const account = await h.backend.signIn({ issuer: alice.issuer });
    const identity = deferred<Identity | null>();
    h.auth.identity.mockReturnValueOnce(identity.promise);
    const fetching = h.backend.fetchFor(account)(account.storageUrl);
    const failure = expect(fetching).rejects.toThrow("Sign in to continue");
    h.setIdentity({ ...alice, grantId: "newer-grant" });
    await h.backend.signOut(account);
    const signedIn = await h.backend.signIn({ webId: alice.webId });
    identity.resolve(null);
    await failure;
    expect((await h.backend.fetchFor(signedIn)(signedIn.storageUrl)).ok).toBe(true);
  });

  it("aborts an in-flight sign-in even when sign-out retirement skips", async () => {
    const h = harness();
    const entered = deferred<void>();
    let signal: AbortSignal | undefined;
    h.auth.login.mockImplementationOnce(
      (_hint, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal;
          signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
          entered.resolve();
        }),
    );
    const signingIn = h.backend.signIn({ issuer: alice.issuer });
    const settled = signingIn.then(
      (value) => value,
      (error: unknown) => error,
    );
    await entered.promise;
    await h.backend.signOut({ ...bob, id: `solid:${alice.webId}`, webId: alice.webId });
    expect(signal?.aborted).toBe(true);
    expect(await settled).toEqual(new SignInError("cancelled"));
    expect(await h.backend.restore()).toBeNull();
  });

  it("fences sign-in display reads that finish after skipped sign-out", async () => {
    const h = harness();
    const entered = deferred<void>();
    const profile = deferred<Response>();
    h.publicFetch.mockImplementationOnce(() => {
      entered.resolve();
      return profile.promise;
    });
    const signingIn = h.backend.signIn({ issuer: alice.issuer });
    const failure = expect(signingIn).rejects.toEqual(new SignInError("cancelled"));
    await entered.promise;
    await h.backend.signOut({ ...bob, id: `solid:${alice.webId}`, webId: alice.webId });
    profile.resolve(new Response("", { headers: { "content-type": "text/turtle" } }));
    await failure;
    expect(await h.backend.restore()).toBeNull();
    expect(await h.auth.identity()).toEqual(alice);
  });

  it("preserves a remembered account after reload without an accepted grant snapshot", async () => {
    const h = harness();
    h.auth.remembered.mockResolvedValue([{ webId: bob.webId, issuer: bob.issuer }]);
    await h.backend.signOut({ ...bob, webId: bob.webId, id: bob.id });
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledExactlyOnceWith({
      webId: bob.webId,
      issuer: bob.issuer,
    });
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect(h.auth.remembered).not.toHaveBeenCalled();
  });

  it("fences a pending restore when sign-out has no accepted grant snapshot", async () => {
    const h = harness();
    h.setIdentity(alice);
    const gate = deferred<Identity | null>();
    h.auth.restore.mockReturnValueOnce(gate.promise);
    const restoring = h.backend.restore();
    await h.backend.signOut({ ...bob, id: `solid:${alice.webId}`, webId: alice.webId });
    gate.resolve(alice);
    expect(await restoring).toBeNull();
    expect(await h.backend.restore()).toBeNull();
    expect(await h.auth.identity()).toEqual(alice);
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("forwards definitive expiry, supports unsubscribe and reauthenticates explicitly", async () => {
    const h = harness();
    const expired = vi.fn();
    const stop = h.backend.onExpired(expired);
    const account = await h.backend.signIn({ issuer: alice.issuer });
    h.emit("expired");
    h.emit("expired");
    expect(expired).toHaveBeenCalledOnce();
    await expect(h.backend.fetchFor(account)(account.storageUrl)).rejects.toThrow();
    await h.backend.signIn({ issuer: alice.issuer });
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledExactlyOnceWith(alice);
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect(h.auth.login).toHaveBeenCalledTimes(2);
    stop();
    stop();
    h.emit("expired");
    expect(expired).toHaveBeenCalledOnce();
  });

  it("ends the shell session when background refresh needs authorization, without opening a popup", async () => {
    const h = harness();
    const expired = vi.fn();
    h.backend.onExpired(expired);
    const account = await h.backend.signIn({ issuer: alice.issuer });
    h.auth.fetch.mockImplementation(async () => {
      await h
        .config()
        .ui.getCode(
          new URL("https://id.example/authorize?prompt=consent"),
          new AbortController().signal,
        );
      return new Response();
    });
    await expect(h.backend.fetchFor(account)(account.storageUrl)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(expired).toHaveBeenCalledOnce();
    expect(h.openPopup).toHaveBeenCalledOnce();
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("does not purge a newer account in another tab when reauthenticating an expired account", async () => {
    const h = harness();
    await h.backend.signIn({ issuer: alice.issuer });
    h.emit("expired");
    h.setIdentity({ ...alice, webId: bob.webId, subject: "bob", storages: [bob.storageUrl] });
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toMatchObject({
      code: "account-active",
    });
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect(h.auth.login).toHaveBeenCalledOnce();
  });

  it("does not mistake transient fetch errors or unrelated 401s for expiry", async () => {
    const h = harness();
    const expired = vi.fn();
    h.backend.onExpired(expired);
    const account = await h.backend.signIn({ issuer: alice.issuer });
    h.auth.fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(h.backend.fetchFor(account)(account.storageUrl)).rejects.toThrow("offline");
    h.auth.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await h.backend.fetchFor(account)("https://foreign.example/")).status).toBe(401);
    expect(expired).not.toHaveBeenCalled();
  });

  it("detects logout in another tab before sending a fetch", async () => {
    const h = harness();
    const expired = vi.fn();
    h.backend.onExpired(expired);
    const account = await h.backend.signIn({ issuer: alice.issuer });
    h.setIdentity(null);
    await expect(h.backend.fetchFor(account)(account.storageUrl)).rejects.toThrow();
    expect(expired).toHaveBeenCalledOnce();
    expect(h.auth.fetch).not.toHaveBeenCalled();
  });

  it("cancels login with a signal, closes the popup, and never calls logout to cancel", async () => {
    const h = harness();
    const entered = deferred<void>();
    h.auth.login.mockImplementation(
      (_hint, options) =>
        new Promise((_resolve, reject) => {
          entered.resolve();
          const signal = options?.signal;
          if (!signal) throw new Error("Expected a login signal");
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const cancel = new AbortController();
    const signingIn = h.backend.signIn({ issuer: alice.issuer }, { signal: cancel.signal });
    const rejected = expect(signingIn).rejects.toMatchObject({ code: "cancelled" });
    await entered.promise;
    cancel.abort();
    await rejected;
    expect(h.popup.close).toHaveBeenCalledOnce();
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("does not log out an expired account if reauthentication is cancelled before cleanup", async () => {
    const h = harness();
    await h.backend.signIn({ issuer: alice.issuer });
    h.emit("expired");
    const entered = deferred<void>();
    const target = deferred<Awaited<ReturnType<typeof resolveLoginTarget>>>();
    h.resolveTarget.mockImplementationOnce(() => {
      entered.resolve();
      return target.promise;
    });
    const cancel = new AbortController();
    const signingIn = h.backend.signIn({ issuer: alice.issuer }, { signal: cancel.signal });
    const rejected = expect(signingIn).rejects.toMatchObject({ code: "cancelled" });
    await entered.promise;
    cancel.abort();
    target.resolve({ kind: "issuer", issuer: alice.issuer });
    await rejected;
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect(h.auth.retireIfOwnedBy).not.toHaveBeenCalled();
    expect(h.auth.login).toHaveBeenCalledOnce();
  });

  it("cancels immediately while restore is pending, preserving that independent session", async () => {
    const h = harness();
    const gate = deferred<Identity | null>();
    h.auth.restore.mockReturnValueOnce(gate.promise);
    const restoring = h.backend.restore();
    const cancel = new AbortController();
    const signingIn = h.backend.signIn({ issuer: alice.issuer }, { signal: cancel.signal });
    const rejected = expect(signingIn).rejects.toMatchObject({ code: "cancelled" });
    cancel.abort();
    await rejected;
    expect(h.popup.close).toHaveBeenCalled();
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect(h.auth.login).not.toHaveBeenCalled();
    h.setIdentity(alice);
    gate.resolve(alice);
    expect((await restoring)?.webId).toBe(alice.webId);
  });

  it("does not abandon a committed grant when cancellation arrives during optional display reads", async () => {
    const h = harness();
    const entered = deferred<void>();
    const profile = deferred<Response>();
    h.publicFetch.mockImplementationOnce(() => {
      entered.resolve();
      return profile.promise;
    });
    const cancel = new AbortController();
    const signingIn = h.backend.signIn({ issuer: alice.issuer }, { signal: cancel.signal });
    await entered.promise;
    cancel.abort();
    profile.resolve(new Response("", { headers: { "content-type": "text/turtle" } }));
    const account = await signingIn;
    expect((await h.backend.fetchFor(account)(account.storageUrl)).ok).toBe(true);
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it.each([
    [new IssuerNotAuthorizedError(alice.webId, alice.issuer), "issuer-not-authorized"],
    [new AmbiguousIssuerError(), "ambiguous-issuer"],
    [new DOMException("cancel", "AbortError"), "cancelled"],
    [new Error("secret access_token=must-not-be-shown"), "failed"],
  ] as const)("maps protocol failures safely: %s", async (error, code) => {
    const h = harness();
    h.auth.login.mockRejectedValue(error);
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(new SignInError(code));
    expect(h.publicFetch).not.toHaveBeenCalled();
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it.each([
    new NotALoginAddressError("example"),
    new TypeError("offline"),
    new DOMException("timeout", "TimeoutError"),
  ])("keeps discovery failures invalid-url: %s", async (error) => {
    const h = harness();
    h.resolveTarget.mockRejectedValue(error);
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
      new SignInError("invalid-url"),
    );
    expect(h.auth.login).not.toHaveBeenCalled();
  });

  it("preserves the field semantics when directory resolution finds the other kind", async () => {
    const h = harness();
    h.resolveTarget.mockResolvedValue({ kind: "webid", webId: alice.webId });
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toMatchObject({
      code: "invalid-url",
    });
    expect(h.auth.login).not.toHaveBeenCalled();
  });

  it("delegates rejected grant cleanup to pod-auth with the original identity snapshot", async () => {
    const h = harness();
    const rejected = { ...alice, storages: [], grantId: "rejected-grant" };
    h.auth.login.mockImplementationOnce(async () => {
      h.setIdentity(rejected);
      return rejected;
    });
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
      new SignInError("invalid-identity"),
    );
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledExactlyOnceWith(rejected);
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it.each([
    { ...alice, webId: null },
    { ...alice, storages: [] },
    { ...alice, storages: [...alice.storages, "https://second.example/"] },
  ])("does not invent a WebID or storage, or select between pods", async (identity) => {
    const h = harness();
    h.auth.login.mockImplementationOnce(async () => {
      h.setIdentity(identity);
      return identity;
    });
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toMatchObject({
      code: "invalid-identity",
    });
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledExactlyOnceWith(identity);
    expect(await h.backend.restore()).toBeNull();
    expect(await h.auth.identity()).toBeNull();
    await expect(h.backend.fetchFor(bob)(bob.storageUrl)).rejects.toThrow();
    expect((await h.backend.signIn({ issuer: alice.issuer })).webId).toBe(alice.webId);
    expect(h.auth.login).toHaveBeenCalledTimes(2);
  });

  it.each([
    { storages: [] },
    { storages: [...alice.storages, "https://second.example/"] },
  ])("cleans up a rejected restored identity with $storages without repeating the failure", async ({
    storages,
  }) => {
    const h = harness();
    h.setIdentity({ ...alice, storages });
    await expect(h.backend.restore()).rejects.toEqual(new SignInError("invalid-identity"));
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledOnce();
    expect(await h.backend.restore()).toBeNull();
    const reload = new SolidBackend({ createAuth: h.createAuth, publicFetch: h.publicFetch });
    expect(await reload.restore()).toBeNull();
    expect((await h.backend.signIn({ issuer: alice.issuer })).webId).toBe(alice.webId);
  });

  it.each([
    "owner-changed",
    "grant-changed",
  ] as const)("preserves the namespace when pod-auth skips retirement: %s", async (reason) => {
    const h = harness();
    const rejected = { ...alice, storages: [] };
    const newer =
      reason === "owner-changed"
        ? { ...alice, webId: bob.webId, subject: "bob", storages: [bob.storageUrl] }
        : { ...alice, grantId: "newer-grant" };
    h.auth.login.mockImplementationOnce(async () => {
      h.setIdentity(rejected);
      h.setIdentity(newer);
      return rejected;
    });
    h.auth.retireIfOwnedBy.mockResolvedValue({ retired: false, reason });
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
      new SignInError("invalid-identity"),
    );
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledExactlyOnceWith(rejected);
    expect(await h.auth.identity()).toBe(newer);
  });

  it("does not purge again if sign-out has no accepted grant while rejection is retiring", async () => {
    const h = harness();
    const rejected = { ...alice, storages: [] };
    const entered = deferred<void>();
    const retirement = deferred<Awaited<ReturnType<PodAuth["retireIfOwnedBy"]>>>();
    h.auth.login.mockImplementationOnce(async () => {
      h.setIdentity(rejected);
      return rejected;
    });
    h.auth.retireIfOwnedBy.mockImplementationOnce(() => {
      entered.resolve();
      return retirement.promise;
    });
    const signingIn = h.backend.signIn({ issuer: alice.issuer });
    const failure = expect(signingIn).rejects.toEqual(new SignInError("invalid-identity"));
    await entered.promise;
    await h.backend.signOut({ ...bob, id: `solid:${alice.webId}`, webId: alice.webId });
    h.setIdentity({ ...alice, webId: bob.webId, subject: "bob", storages: [bob.storageUrl] });
    retirement.resolve({ retired: false, reason: "grant-changed" });
    await failure;
    expect(h.auth.logout).not.toHaveBeenCalled();
    expect(h.auth.retireIfOwnedBy).toHaveBeenCalledTimes(2);
    expect((await h.auth.identity())?.webId).toBe(bob.webId);
  });

  it("keeps the identity error after failed revocation once pod-auth has cleared local state", async () => {
    const h = harness();
    h.auth.login.mockImplementationOnce(async () => {
      const identity = { ...alice, storages: [] };
      h.setIdentity(identity);
      return identity;
    });
    h.auth.retireIfOwnedBy.mockImplementationOnce(async () => {
      h.setIdentity(null);
      h.emit("logout");
      throw new Error("revocation failed");
    });
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
      new SignInError("invalid-identity"),
    );
    expect(await h.backend.restore()).toBeNull();
    expect((await h.backend.signIn({ issuer: alice.issuer })).webId).toBe(alice.webId);
  });

  it("keeps verified roots and a WebID fallback when profile display reads fail", async () => {
    const h = harness();
    h.publicFetch.mockRejectedValue(new Error("offline"));
    const account = await h.backend.signIn({ issuer: alice.issuer });
    expect(account.name).toBe(alice.webId);
    expect(account.storageUrl).toBe(alice.storages[0]);
    expect(account.photoUrl).toBeUndefined();
  });
});
