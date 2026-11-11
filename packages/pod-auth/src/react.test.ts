// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6.1-Sol
// Adapted from solid-auth-core/test/react.test.tsx (AUTHORED-BY Claude Fable 5).
import { webcrypto } from "node:crypto";
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  type AuthEvent,
  type AuthEventType,
  createPodAuth,
  type Identity,
  type PodAuth,
} from "./index.js";
import { PodAuthProvider, type PodAuthSession, usePodAuth } from "./react.js";
import { createMockOp } from "./testing.js";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const identity: Identity = {
  webId: "https://id.example/alice#me",
  issuer: "https://op.example/",
  subject: "https://id.example/alice",
  clientId: "https://app.example/client",
  protocol: "solid-oidc",
  storages: ["https://pod.example/"],
};
class FakeAuth implements PodAuth {
  current: Identity | null = null;
  deferred = Promise.withResolvers<Identity | null>();
  listeners = new Map<AuthEventType, Set<(event: AuthEvent) => void>>();
  fetch = vi.fn(async () => new Response("authenticated")) as typeof fetch;
  restore = vi.fn(() => this.deferred.promise);
  identity = async () => this.current;
  remembered = async () => [];
  retireIfOwnedBy: PodAuth["retireIfOwnedBy"] = async () => ({
    retired: false,
    reason: "no-grant",
  });
  loginError: unknown;
  logoutError: unknown;
  login = vi.fn(async () => {
    if (this.loginError) throw this.loginError;
    this.current = { ...identity };
    this.emit("login", this.current);
    return this.current;
  });
  logout = vi.fn(async () => {
    this.current = null;
    this.emit("logout", null);
    if (this.logoutError) throw this.logoutError;
  });
  on(event: AuthEventType, handler: (event: AuthEvent) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, listeners);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }
  emit(type: AuthEventType, identity: Identity | null) {
    for (const handler of this.listeners.get(type) ?? []) handler({ type, identity, timestamp: 0 });
  }
}
let root: Root | undefined;
let container: HTMLDivElement;
let session: PodAuthSession;
function Probe() {
  session = usePodAuth();
  return createElement(
    "span",
    null,
    session.status + ":" + (session.identity?.subject ?? "anonymous"),
  );
}
async function mount(auth: PodAuth, strict = false, child = createElement(Probe)) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    const tree = createElement(PodAuthProvider, { auth }, child);
    root!.render(strict ? createElement(StrictMode, null, tree) : tree);
  });
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("provider restores identity once in StrictMode, mirrors external lifecycle and keeps handles stable", async () => {
  const auth = new FakeAuth();
  await mount(auth, true);
  expect(session.status).toBe("restoring");
  expect(auth.restore).toHaveBeenCalledTimes(1);
  await act(async () => {
    auth.deferred.resolve(identity);
  });
  expect(container.textContent).toContain(identity.subject);
  expect(session.identity).toEqual(identity);
  expect(session.webId).toBe(identity.webId);
  const handles = { fetch: session.fetch, login: session.login, logout: session.logout };
  expect(await (await session.fetch("https://pod.example/private")).text()).toBe("authenticated");
  await act(async () => {
    auth.emit("expired", null);
  });
  expect(session.status).toBe("unauthenticated");
  await act(async () => {
    await session.login({ issuer: identity.issuer });
  });
  expect(session.status).toBe("authenticated");
  expect(auth.login).toHaveBeenCalledWith({ issuer: identity.issuer });
  await act(async () => {
    auth.emit("restore", { ...identity, webId: null });
  });
  expect(session.webId).toBeNull();
  expect(session.status).toBe("authenticated");
  await act(async () => {
    await session.logout();
  });
  expect(session.status).toBe("unauthenticated");
  expect({ fetch: session.fetch, login: session.login, logout: session.logout }).toEqual(handles);
});

test.each([null, "failure"])("restore %s lands unauthenticated", async (outcome) => {
  const auth = new FakeAuth();
  await mount(auth);
  await act(async () => {
    if (outcome === null) auth.deferred.resolve(null);
    else auth.deferred.reject(Error("unavailable"));
  });
  expect(session.status).toBe("unauthenticated");
  expect(session.identity).toBeNull();
});

test.each([
  false,
  true,
])("rejected restore reconciles an authenticated core during descendant login (StrictMode: %s)", async (strict) => {
  const op = createMockOp();
  vi.stubGlobal("fetch", op.fetch);
  vi.stubGlobal("crypto", webcrypto);
  // Match Node WebCrypto's ArrayBuffer realm while running the real engine in jsdom.
  vi.stubGlobal("ArrayBuffer", Buffer.alloc(0).buffer.constructor);
  vi.stubGlobal("location", { origin: "https://app.example" });
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
    boundary: { roots: [op.root], automatic: false },
  });
  const authenticated = await auth.login();
  const loginEvent = vi.fn();
  auth.on("login", loginEvent);
  const restore = vi.spyOn(auth, "restore");
  function LoginOnMount() {
    useEffect(() => {
      void auth.login();
    }, []);
    return createElement(Probe);
  }
  await mount(auth, strict, createElement(LoginOnMount));
  expect(restore).toHaveBeenCalledTimes(1);
  await expect(restore.mock.results[0]!.value).rejects.toThrow("Authentication is in progress");
  expect(loginEvent).not.toHaveBeenCalled();
  expect(session.status).toBe("authenticated");
  expect(session.identity).toEqual(authenticated);
  expect(session.error).toBeNull();
  await act(async () => {
    await session.login();
  });
  expect(session.identity).toEqual(authenticated);
  expect(op.stats.authorizations).toBe(1);
});

test("failed identity reconciliation lands unauthenticated", async () => {
  const auth = new FakeAuth();
  vi.spyOn(auth, "identity").mockRejectedValue(Error("identity unavailable"));
  await mount(auth);
  await act(async () => auth.deferred.reject(Error("restore unavailable")));
  expect(session.status).toBe("unauthenticated");
  expect(session.identity).toBeNull();
  expect(session.error).toBeNull();
});

test.each([
  "login",
  "logout",
  "expired",
] as const)("late identity reconciliation cannot overwrite a later %s event", async (event) => {
  const auth = new FakeAuth();
  const pending = Promise.withResolvers<Identity | null>();
  const readIdentity = vi.spyOn(auth, "identity").mockReturnValue(pending.promise);
  await mount(auth);
  await act(async () => auth.deferred.reject(Error("restore unavailable")));
  expect(readIdentity).toHaveBeenCalledTimes(1);
  expect(session.status).toBe("restoring");
  await act(async () => {
    auth.emit(event, event === "login" ? identity : null);
    pending.resolve(event === "login" ? null : identity);
  });
  expect(session.status).toBe(event === "login" ? "authenticated" : "unauthenticated");
  expect(session.identity).toEqual(event === "login" ? identity : null);
});

test.each([
  "login",
  "logout",
] as const)("late restore cannot overwrite a later %s event", async (event) => {
  const auth = new FakeAuth();
  await mount(auth);
  await act(async () => {
    auth.emit(event, event === "login" ? identity : null);
  });
  await act(async () => {
    auth.deferred.resolve(event === "login" ? null : identity);
  });
  expect(session.status).toBe(event === "login" ? "authenticated" : "unauthenticated");
});

test("unmount unsubscribes, and ignores late restore and already queued events", async () => {
  const auth = new FakeAuth();
  await mount(auth);
  const late = [...auth.listeners.get("login")!][0]!;
  await act(async () => root!.unmount());
  root = undefined;
  expect([...auth.listeners.values()].every((set) => set.size === 0)).toBe(true);
  await act(async () => {
    late({ type: "login", identity, timestamp: 0 });
    auth.deferred.resolve(identity);
  });
});

test.each([
  Error("cancelled"),
  "string-error",
])("action errors surface and clear on next attempt (%s)", async (failure) => {
  const auth = new FakeAuth();
  await mount(auth);
  await act(async () => auth.deferred.resolve(null));
  auth.loginError = failure;
  await act(async () => {
    await expect(session.login()).rejects.toBe(failure);
  });
  expect(session.error).toBe(failure instanceof Error ? failure.message : failure);
  auth.loginError = undefined;
  await act(async () => {
    await session.login();
  });
  expect(session.error).toBeNull();
  auth.logoutError = failure;
  await act(async () => {
    await expect(session.logout()).rejects.toBe(failure);
  });
  expect(session.status).toBe("unauthenticated");
  expect(session.error).toBe(failure instanceof Error ? failure.message : failure);
  auth.logoutError = undefined;
  await act(async () => {
    await session.logout();
  });
  expect(session.error).toBeNull();
});

test("aborted login is not a user-visible error", async () => {
  const auth = new FakeAuth();
  await mount(auth);
  auth.loginError = new DOMException("cancelled", "AbortError");
  await act(async () => {
    await session.login();
  });
  expect(session.error).toBeNull();
});

test("provider builds real core from config and retains the first auth across rerenders", async () => {
  const op = createMockOp();
  vi.stubGlobal("fetch", op.fetch);
  // The injected mock uses HTTPS; the application callback must match jsdom's origin.
  vi.stubGlobal("location", { origin: "https://app.example" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const config = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
    boundary: { roots: [op.root], automatic: false },
  };
  await act(async () => {
    root!.render(createElement(PodAuthProvider, { config }, createElement(Probe)));
  });
  expect(session.status).toBe("unauthenticated");
  const first = session.auth;
  await act(async () => {
    root!.render(createElement(PodAuthProvider, { auth: new FakeAuth() }, createElement(Probe)));
  });
  expect(session.auth).toBe(first);
});

test("hook outside a provider throws a targeted error", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await expect(
    act(async () => {
      root!.render(createElement(Probe));
    }),
  ).rejects.toThrow("inside a <PodAuthProvider>");
});
