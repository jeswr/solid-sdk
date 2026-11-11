// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolidBackend } from "../src/shell/session/solid-backend";
import { SignInError, type SuiteAccount } from "../src/shell/session/types";

const alice = {
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
function harness() {
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
  const backend = new SolidBackend({ createAuth, resolveTarget, publicFetch, openPopup });
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
    expect(h.auth.logout).toHaveBeenCalledOnce();
    await expect(fetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
    expect(await h.backend.restore()).toBeNull();
    await h.backend.signIn({ issuer: alice.issuer });
    await expect(fetch(account.storageUrl)).rejects.toThrow("Sign in to continue");
  });

  it("signs out a remembered account after reload without requiring a live session", async () => {
    const h = harness();
    h.auth.remembered.mockResolvedValue([{ webId: bob.webId, issuer: bob.issuer }]);
    await h.backend.signOut({ ...bob, webId: bob.webId, id: bob.id });
    expect(h.auth.logout).toHaveBeenCalledOnce();
  });

  it("fences a restore completing after sign-out", async () => {
    const h = harness();
    h.setIdentity(alice);
    const gate = deferred<Identity | null>();
    h.auth.restore.mockReturnValueOnce(gate.promise);
    const restoring = h.backend.restore();
    await h.backend.signOut({ ...bob, id: `solid:${alice.webId}`, webId: alice.webId });
    gate.resolve(alice);
    expect(await restoring).toBeNull();
    await expect(
      h.backend.fetchFor({ ...bob, id: `solid:${alice.webId}` })(bob.storageUrl),
    ).rejects.toThrow();
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
    expect(h.auth.logout).toHaveBeenCalledOnce();
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
    const identity = deferred<Identity | null>();
    h.auth.identity.mockImplementationOnce(() => {
      entered.resolve();
      return identity.promise;
    });
    const cancel = new AbortController();
    const signingIn = h.backend.signIn({ issuer: alice.issuer }, { signal: cancel.signal });
    const rejected = expect(signingIn).rejects.toMatchObject({ code: "cancelled" });
    await entered.promise;
    cancel.abort();
    identity.resolve(alice);
    await rejected;
    expect(h.auth.logout).not.toHaveBeenCalled();
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
    expect(h.auth.logout).toHaveBeenCalledOnce();
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
    expect(h.auth.logout).toHaveBeenCalledOnce();
    expect(await h.backend.restore()).toBeNull();
    const reload = new SolidBackend({ createAuth: h.createAuth, publicFetch: h.publicFetch });
    expect(await reload.restore()).toBeNull();
    expect((await h.backend.signIn({ issuer: alice.issuer })).webId).toBe(alice.webId);
  });

  it.each([
    "identity",
    "remembered",
  ])("does not purge a newer account found through %s while rejecting a grant", async (replacement) => {
    const h = harness();
    const rejected = { ...alice, storages: [] };
    h.auth.login.mockImplementationOnce(async () => {
      h.setIdentity(rejected);
      if (replacement === "identity")
        h.setIdentity({ ...alice, webId: bob.webId, subject: "bob", storages: [bob.storageUrl] });
      else h.auth.remembered.mockResolvedValue([{ webId: bob.webId, issuer: bob.issuer }]);
      return rejected;
    });
    await expect(h.backend.signIn({ issuer: alice.issuer })).rejects.toEqual(
      new SignInError("invalid-identity"),
    );
    expect(h.auth.logout).not.toHaveBeenCalled();
  });

  it("does not purge again if sign-out supersedes rejection during an ownership read", async () => {
    const h = harness();
    const rejected = { ...alice, storages: [] };
    const entered = deferred<void>();
    const pointer = deferred<Awaited<ReturnType<PodAuth["remembered"]>>>();
    h.auth.login.mockImplementationOnce(async () => {
      h.setIdentity(rejected);
      return rejected;
    });
    h.auth.remembered.mockImplementationOnce(() => {
      entered.resolve();
      return pointer.promise;
    });
    const signingIn = h.backend.signIn({ issuer: alice.issuer });
    const failure = expect(signingIn).rejects.toEqual(new SignInError("invalid-identity"));
    await entered.promise;
    await h.backend.signOut({ ...bob, id: `solid:${alice.webId}`, webId: alice.webId });
    h.setIdentity({ ...alice, webId: bob.webId, subject: "bob", storages: [bob.storageUrl] });
    pointer.resolve([{ webId: alice.webId, issuer: alice.issuer }]);
    await failure;
    expect(h.auth.logout).toHaveBeenCalledOnce();
    expect((await h.auth.identity())?.webId).toBe(bob.webId);
  });

  it("keeps the identity error after failed revocation once pod-auth has cleared local state", async () => {
    const h = harness();
    h.auth.login.mockImplementationOnce(async () => {
      const identity = { ...alice, storages: [] };
      h.setIdentity(identity);
      return identity;
    });
    h.auth.logout.mockImplementationOnce(async () => {
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
