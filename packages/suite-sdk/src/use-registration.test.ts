// AUTHORED-BY Codex GPT-6.1-Sol
import type { AuthEvent, AuthEventType, Identity, PodAuth } from "@jeswr/pod-auth";
import { PodAuthProvider } from "@jeswr/pod-auth/react";
import { act, createElement, StrictMode, Suspense, startTransition, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  type Registration,
  RegistrationError,
  type UseRegistrationOptions,
  useRegistration,
} from "./index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const issuer = "https://provider.example/";
const pod = `${issuer}alice/`;
const webId = `${pod}profile/card#me`;
const alice: Identity = {
  webId,
  issuer,
  subject: webId,
  clientId: null,
  protocol: "solid-oidc",
  storages: [pod],
};
const request = { username: "alice", displayName: "Alice", password: "test-password" };
let options: UseRegistrationOptions | undefined;
let action: Registration;
let root: Root | undefined;
let update: () => void;
function Probe() {
  action = useRegistration(options);
  return null;
}
function fixture() {
  let current: Identity | null = null;
  const handlers = new Map<AuthEventType, Set<(event: AuthEvent) => void>>();
  const emit = (type: AuthEventType, identity: Identity | null) => {
    current = identity;
    for (const handler of handlers.get(type) ?? []) handler({ type, identity, timestamp: 0 });
  };
  const profile = vi.fn<typeof fetch>(async () => new Response(null, { status: 205 }));
  const login = vi.fn(async () => {
    emit("login", alice);
    return alice;
  });
  const auth: PodAuth = {
    fetch: profile,
    login,
    restore: async () => current,
    identity: async () => current,
    remembered: async () => [],
    retireIfOwnedBy: async () => ({ retired: false, reason: "no-grant" }),
    logout: async () => emit("logout", null),
    on: (type, handler) => {
      const listeners = handlers.get(type) ?? new Set();
      handlers.set(type, listeners);
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
  const publicFetch = vi.fn<typeof fetch>(async (input, init) => {
    const captured = new Request(input, init);
    const path = new URL(captured.url).pathname;
    if (path === "/alice/") return new Response(null, { status: 404 });
    if (path === "/create" || path === "/login")
      return Response.json({ authorization: "account-token" });
    if (path === "/pod") return Response.json({ pod, webId });
    if (path === "/webid") return Response.json({ webIdLinks: { [webId]: "/link" } });
    return Response.json({
      controls: {
        account: { create: "/create", pod: "/pod", webId: "/webid" },
        password: { create: "/password", login: "/login" },
      },
    });
  });
  options = { accountApi: `${issuer}.account/`, fetch: publicFetch };
  return { auth, publicFetch, profile, login, emit, handlers };
}
async function mount(auth: PodAuth, Component = Probe) {
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  update = () =>
    mounted.render(
      createElement(
        StrictMode,
        null,
        createElement(
          PodAuthProvider,
          { auth },
          createElement(Suspense, { fallback: "loading" }, createElement(Component)),
        ),
      ),
    );
  await act(update);
}
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  root = undefined;
  options = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test("delegates preview, methods, availability, username checks and authenticated registration; handles stay stable", async () => {
  const f = fixture();
  await mount(f.auth);
  const retained = action;
  await act(update);
  expect(action).toBe(retained);
  expect(action.methods).toEqual(["password"]);
  expect(action.previewUrls("alice")).toEqual({ pod, webId });
  expect(await action.available()).toBe(true);
  expect(await action.checkUsername("alice")).toBe("available");
  const steps: string[] = [];
  await act(async () => {
    expect(await retained.register(request, { onStep: (step) => steps.push(step) })).toEqual(alice);
  });
  expect(steps).toEqual(["account", "password", "pod", "webid", "profile", "sign-in"]);
  expect(f.profile).toHaveBeenCalledTimes(1);
  expect(f.login).toHaveBeenCalledTimes(2);
  expect(
    f.publicFetch.mock.calls.every(
      ([input]) =>
        !(input instanceof Request ? input.url : String(input)).includes(request.password),
    ),
  ).toBe(true);
  expect(action).not.toBe(retained);
  expect(() => retained.previewUrls("alice")).toThrow("Registration session changed");
  await expect(retained.register(request)).rejects.toThrow("Registration session changed");
  expect(f.handlers.get("login")?.size).toBe(2);
});

test("no configuration disables registration; pure preview and invalid inputs keep typed errors", async () => {
  const f = fixture();
  options = undefined;
  await mount(f.auth);
  expect(await action.available()).toBe(false);
  expect(() => action.previewUrls("alice")).toThrow(RegistrationError);
  await expect(action.register(request)).rejects.toMatchObject({ code: "registration-closed" });
});

test("rejects overlapping registrations, cleans invalid inputs, and supports login without lifecycle emission", async () => {
  const f = fixture();
  f.login.mockImplementation(async () => alice);
  await mount(f.auth);
  await expect(action.register({ ...request, username: "../" })).rejects.toMatchObject({
    code: "invalid-username",
  });
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  f.publicFetch.mockImplementationOnce(async () => {
    ready.resolve();
    return release.promise;
  });
  const pending = action.register(request);
  await ready.promise;
  await expect(action.register(request)).rejects.toMatchObject({
    code: "registration-in-progress",
  });
  release.resolve(new Response(null, { status: 404 }));
  expect(await pending).toEqual(alice);
});

test.each([
  "logout",
  "expired",
  "restore",
  "login",
] as const)("fences pending account work and retained actions across unrelated %s", async (type) => {
  const f = fixture();
  await mount(f.auth);
  const old = action;
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  f.publicFetch.mockImplementationOnce(async () => {
    ready.resolve();
    return release.promise;
  });
  const pending = old.register(request).catch((error) => error);
  await ready.promise;
  await act(async () =>
    f.emit(
      type,
      type === "logout" || type === "expired"
        ? null
        : { ...alice, webId: "https://bob.example/#me" },
    ),
  );
  release.resolve(new Response(null, { status: 404 }));
  expect(await pending).toMatchObject({ name: "RegistrationError", code: "registration-failed" });
  await expect(old.available()).rejects.toThrow("Registration session changed");
  await expect(old.checkUsername("alice")).rejects.toThrow("Registration session changed");
  expect(f.publicFetch).toHaveBeenCalledTimes(1);
  expect(f.login).not.toHaveBeenCalled();
});

test.each([
  "available",
  "checkUsername",
] as const)("late %s results are fenced after same-account logout/login", async (operation) => {
  const f = fixture();
  await mount(f.auth);
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  f.publicFetch.mockImplementationOnce(async () => {
    ready.resolve();
    return release.promise;
  });
  const pending = (
    operation === "available" ? action.available() : action.checkUsername("alice")
  ).catch((error) => error);
  await ready.promise;
  await act(async () => {
    f.emit("logout", null);
    f.emit("login", alice);
  });
  release.resolve(
    operation === "available" ? Response.json({}) : new Response(null, { status: 404 }),
  );
  expect(await pending).toMatchObject({ message: "Registration session changed" });
});

test.each([
  "unmount",
  "options",
])("aborts in-flight authenticated writes and removes run listeners on %s", async (change) => {
  const f = fixture();
  await mount(f.auth);
  const ready = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<Response>();
  f.profile.mockImplementation(async (_input, init) => {
    ready.resolve(init?.signal as AbortSignal);
    return release.promise;
  });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = action.register(request).catch((error) => error);
  });
  const signal = await ready.promise;
  if (change === "unmount") {
    await act(() => root?.unmount());
    root = undefined;
  } else {
    options = { ...options!, podHost: issuer };
    await act(update);
  }
  expect(signal.aborted).toBe(true);
  release.resolve(new Response(null, { status: 205 }));
  expect(await pending).toMatchObject({ code: "registration-failed", step: "profile" });
  expect(f.login).toHaveBeenCalledTimes(1);
  expect(f.handlers.get("login")?.size).toBe(change === "unmount" ? 0 : 2);
});

test("caller cancellation propagates through registration and failures release the registration lock", async () => {
  const f = fixture();
  await mount(f.auth);
  const controller = new AbortController();
  controller.abort();
  await expect(action.register(request, { signal: controller.signal })).rejects.toMatchObject({
    code: "registration-failed",
  });
  f.login.mockRejectedValueOnce(new Error("secret must be sanitized"));
  await act(async () => {
    await expect(action.register(request)).rejects.toMatchObject({
      step: "profile",
      code: "registration-failed",
    });
  });
  await act(async () => {
    expect(await action.register(request)).toEqual(alice);
  });
});

test("uses the pristine default transport and rejects an unrelated login during its own authorization", async () => {
  const f = fixture();
  vi.stubGlobal("fetch", f.publicFetch);
  options = { accountApi: `${issuer}.account/` };
  f.login.mockImplementation(async () => {
    f.emit("login", null);
    return alice;
  });
  await mount(f.auth);
  await act(async () => {
    await expect(action.register(request)).rejects.toMatchObject({
      code: "registration-failed",
      step: "profile",
    });
  });
  expect(f.profile).not.toHaveBeenCalled();
});

test.each([
  "commit",
  "discard",
])("suspended renders cannot activate registration authority (%s)", async (outcome) => {
  const f = fixture();
  const original = options;
  let suspended = false;
  const blocker = Promise.withResolvers<void>();
  let attempted: Registration | undefined;
  function Suspending() {
    const registration = useRegistration(options);
    useLayoutEffect(() => {
      action = registration;
    }, [registration]);
    if (suspended) {
      attempted = registration;
      throw blocker.promise;
    }
    return createElement("p", null, "ready");
  }
  await mount(f.auth, Suspending);
  const committed = action;
  options = { ...options!, podHost: issuer };
  suspended = true;
  await act(() => startTransition(update));
  expect(action).toBe(committed);
  expect(attempted).not.toBe(committed);
  await expect(attempted?.available()).rejects.toThrow("Registration session changed");
  expect(await committed.available()).toBe(true);
  suspended = false;
  if (outcome === "discard") options = original;
  await act(async () => {
    if (outcome === "discard") update();
    blocker.resolve();
  });
  if (outcome === "commit") {
    expect(action).not.toBe(committed);
    await expect(committed.available()).rejects.toThrow("Registration session changed");
  } else expect(action).toBe(committed);
  expect(await action.available()).toBe(true);
});
