// AUTHORED-BY Codex GPT-6.1-Sol
import type { AuthEvent, AuthEventType, Identity, PodAuth } from "@jeswr/pod-auth";
import { PodAuthProvider } from "@jeswr/pod-auth/react";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { notificationKind, type UseInboxResult, useInbox } from "./index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const alice: Identity = {
  webId: "https://8.8.8.8/alice#me",
  issuer: "https://op.example/",
  subject: "alice",
  clientId: "https://app.example/",
  protocol: "solid-oidc",
  storages: [],
};
const bob = { ...alice, webId: "https://8.8.8.8/bob#me", subject: "bob" };
const inbox = "https://8.8.4.4/inbox/";
function turtle(body: string) {
  return new Response(body, { headers: { "content-type": "text/turtle" } });
}
function profile(webId = "https://8.8.8.8/alice#me") {
  return turtle(`<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`);
}
function listing() {
  return turtle(`<${inbox}> <http://www.w3.org/ns/ldp#contains> <${inbox}n>.`);
}
function note(summary = "first") {
  return turtle(
    `@prefix as: <https://www.w3.org/ns/activitystreams#>. <#it> a as:Offer; as:summary "${summary}".`,
  );
}
function response(url: RequestInfo | URL) {
  return String(url).startsWith("https://8.8.8.8/")
    ? profile(`${url}#me`)
    : url === inbox
      ? listing()
      : note();
}
function fakeAuth(identity: Identity | null = alice) {
  let current = identity;
  const handlers = new Map<AuthEventType, (event: AuthEvent) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => response(url));
  const auth: PodAuth = {
    fetch,
    restore: async () => current,
    identity: async () => current,
    remembered: async () => [],
    login: async () => alice,
    logout: async () => {},
    on(type, handler) {
      handlers.set(type, handler);
      return () => {
        handlers.delete(type);
      };
    },
  };
  return {
    auth,
    fetch,
    async emit(identity: Identity | null) {
      current = identity;
      const type = identity ? "login" : "logout";
      await act(async () => handlers.get(type)?.({ type, identity, timestamp: 0 }));
    },
  };
}
let root: Root | undefined;
let result: UseInboxResult;
let options: Parameters<typeof useInbox>[0];
let render = () => {};
const views: { items: string[]; status: string }[] = [];
function Probe() {
  result = useInbox(options);
  views.push({ items: result.items.map((n) => n.summary ?? ""), status: result.status });
  return null;
}
async function mount(auth: PodAuth) {
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  render = () =>
    mounted.render(
      createElement(
        StrictMode,
        null,
        createElement(PodAuthProvider, { auth }, createElement(Probe)),
      ),
    );
  await act(render);
}
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  root = undefined;
  options = undefined;
  views.length = 0;
  document.body.replaceChildren();
});

test("loads the current inbox, stays stable, and refreshes the items", async () => {
  const { auth, fetch } = fakeAuth();
  await mount(auth);
  expect(result.status).toBe("ready");
  expect(result.items.map(notificationKind)).toEqual(["invitation"]);
  expect(result.items[0]?.summary).toBe("first");
  expect(result.error).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(3);
  const refresh = result.refresh;
  await act(render);
  expect(result.refresh).toBe(refresh);
  fetch.mockImplementation(async (url) => (url === `${inbox}n` ? note("second") : response(url)));
  await act(() => result.refresh());
  expect(result.items[0]?.summary).toBe("second");
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(views.some((view) => view.status === "loading")).toBe(true);
});

test("clears items during a WebID switch, rejects retained refreshes, and resets same-account sessions", async () => {
  const { auth, fetch, emit } = fakeAuth();
  await mount(auth);
  const oldRefresh = result.refresh;
  const deferred = Promise.withResolvers<Response>();
  fetch.mockImplementationOnce(async () => deferred.promise);
  const viewStart = views.length;
  await emit(bob);
  expect(result.status).toBe("loading");
  expect(result.items).toEqual([]);
  expect(views.slice(viewStart).every((view) => view.items.length === 0)).toBe(true);
  await expect(oldRefresh()).rejects.toThrow("Notification session changed");
  fetch.mockImplementation(async (url) => (url === `${inbox}n` ? note("bob") : response(url)));
  await act(async () => deferred.resolve(profile(bob.webId)));
  expect(result.items[0]?.summary).toBe("bob");
  await emit(null);
  expect(result).toMatchObject({ status: "idle", items: [] });
  await emit(bob);
  expect(result.items[0]?.summary).toBe("bob");
  expect(fetch.mock.calls.filter(([url]) => url === "https://8.8.8.8/bob")).toHaveLength(2);
});

test.each([
  null,
  { ...alice, webId: null, protocol: "lws" as const },
])("is idle without a WebID and supports a harmless refresh (%j)", async (identity) => {
  const { auth, fetch } = fakeAuth(identity);
  await mount(auth);
  await act(() => result.refresh());
  expect(result).toMatchObject({ status: "idle", items: [] });
  expect(fetch).not.toHaveBeenCalled();
});

test("a profile without an inbox resolves ready with no items", async () => {
  const { auth, fetch } = fakeAuth();
  fetch.mockResolvedValueOnce(turtle(""));
  await mount(auth);
  expect(result).toMatchObject({ status: "ready", items: [] });
  expect(fetch).toHaveBeenCalledOnce();
});

test("reports transport errors and clears the error on refresh", async () => {
  const { auth, fetch } = fakeAuth();
  fetch.mockImplementation(async (url) =>
    url === inbox ? new Response(null, { status: 500 }) : response(url),
  );
  await mount(auth);
  expect(result).toMatchObject({ status: "error", items: [], error: { status: 500 } });
  fetch.mockImplementation(async (url) => response(url));
  await act(() => result.refresh());
  expect(result.status).toBe("ready");
  expect(result.error).toBeUndefined();
});

test.each([
  "profile",
  "container",
  "member",
])("cancels %s reads on unmount and never starts later requests", async (phase) => {
  const { auth, fetch } = fakeAuth();
  const deferred = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  let signal: AbortSignal | null | undefined;
  fetch.mockImplementation(async (url, init) => {
    const blocked =
      phase === "profile"
        ? String(url).startsWith("https://8.8.8.8/")
        : phase === "container"
          ? url === inbox
          : url === `${inbox}n`;
    if (blocked) {
      signal = init?.signal;
      started.resolve();
      return deferred.promise;
    }
    return response(url);
  });
  await mount(auth);
  await started.promise;
  const refresh = result.refresh;
  await act(() => root?.unmount());
  root = undefined;
  expect(signal?.aborted).toBe(true);
  const count = fetch.mock.calls.length;
  await act(async () =>
    deferred.resolve(phase === "profile" ? profile() : phase === "container" ? listing() : note()),
  );
  expect(fetch).toHaveBeenCalledTimes(count);
  await expect(refresh()).rejects.toThrow("Notification session changed");
});

test("cancels a switched account's in-flight member and ignores its late success", async () => {
  const { auth, fetch, emit } = fakeAuth();
  const deferred = Promise.withResolvers<Response>();
  let signal: AbortSignal | null | undefined;
  fetch.mockImplementation(async (url, init) => {
    if (url === `${inbox}n`) {
      signal = init?.signal;
      return deferred.promise;
    }
    return response(url);
  });
  await mount(auth);
  expect(result.status).toBe("loading");
  fetch.mockImplementation(async (url) => (url === `${inbox}n` ? note("bob") : response(url)));
  await emit(bob);
  expect(signal?.aborted).toBe(true);
  expect(result.items[0]?.summary).toBe("bob");
  await act(async () => deferred.resolve(note("alice late")));
  expect(result.items[0]?.summary).toBe("bob");
});

test("a new refresh supersedes pending discovery without starting the old listing", async () => {
  const { auth, fetch } = fakeAuth();
  const deferred = Promise.withResolvers<Response>();
  fetch.mockImplementationOnce(async () => deferred.promise);
  await mount(auth);
  let refreshed: Promise<void>;
  await act(async () => {
    refreshed = result.refresh();
  });
  await act(async () => {
    deferred.resolve(profile());
    await refreshed;
  });
  expect(result.status).toBe("ready");
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("a new refresh aborts an older listing and keeps its ready state", async () => {
  const { auth, fetch } = fakeAuth();
  await mount(auth);
  const deferred = Promise.withResolvers<Response>();
  let signal: AbortSignal | null | undefined;
  fetch.mockImplementationOnce(async (_url, init) => {
    signal = init?.signal;
    return deferred.promise;
  });
  let first: Promise<void>;
  await act(async () => {
    first = result.refresh();
  });
  await act(() => result.refresh());
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    deferred.resolve(listing());
    await first;
  });
  expect(result.status).toBe("ready");
});

test("accepts explicit clock, maxItems and pinned transport options", async () => {
  const { auth, fetch } = fakeAuth();
  const pinned = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => response(url));
  options = { clock: () => 0, maxItems: 0, pinningFetch: pinned };
  await mount(auth);
  expect(result).toMatchObject({ status: "ready", items: [] });
  expect(fetch).not.toHaveBeenCalled();
  expect(pinned).toHaveBeenCalledTimes(2);
});
