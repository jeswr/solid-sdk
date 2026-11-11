// AUTHORED-BY Codex GPT-6
import { createPageCache, purgeForWebId } from "@jeswr/suite-sdk/offline";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openNativePodCache, purgeNativePodCache } from "../src/lib/session/native-pod-cache";
import { ShellPodSessionProvider, usePodSessionState } from "../src/lib/session/shell-pod-session";
import {
  type AccountsContextValue,
  AccountsProvider,
  useAccounts,
} from "../src/shell/session/accounts-provider";
import type { SessionBackend, SuiteAccount } from "../src/shell/session/types";
import { registerServiceWorker, rememberPage } from "../src/shell/sync/service-worker";
import { act, deferred, h, mount } from "./drive-ui-dom";

vi.mock("@jeswr/suite-sdk/offline", async (original) => {
  const api = await original<typeof import("@jeswr/suite-sdk/offline")>();
  return {
    ...api,
    purgeForWebId: vi.fn(api.purgeForWebId),
    createPageCache: vi.fn((options) => {
      const cache = api.createPageCache(options);
      // Transport subscription lifecycle is covered in solid-offline; these tests
      // exercise real IndexedDB reads through the actual suite session provider.
      vi.spyOn(cache, "start").mockResolvedValue();
      return cache;
    }),
  };
});

const alice: SuiteAccount = {
  id: "solid:alice",
  kind: "solid",
  name: "Alice",
  webId: "https://pod.example/alice/#me",
  storageUrl: "https://pod.example/alice/",
};
const bob: SuiteAccount = {
  ...alice,
  id: "solid:bob",
  webId: "https://pod.example/bob/#me",
  storageUrl: "https://pod.example/bob/",
};
const url = `${alice.storageUrl}doc`;
let state: ReturnType<typeof usePodSessionState>;
function Probe() {
  state = usePodSessionState();
  return null;
}
function session() {
  if (state.status !== "ready") throw new Error("Expected session");
  return state.session;
}
function accounts(active: SuiteAccount | null = alice): AccountsContextValue {
  return {
    active,
    accounts: active ? [active] : [],
    status: active ? "ready" : "signed-out",
    isActiveAccount: (id) => active?.id === id,
    fetch: vi.fn(async () => new Response("private body", { headers: { etag: "v1" } })),
    signIn: vi.fn(),
    signInDemo: vi.fn(),
    signInWith: vi.fn(),
    add: vi.fn(),
    switchTo: vi.fn(),
    signOut: vi.fn(),
    signOutAll: vi.fn(),
    reauth: vi.fn(),
    backendKinds: ["solid"],
  };
}
const tree = (value: AccountsContextValue) =>
  h(ShellPodSessionProvider, { accounts: value, children: h(Probe) });
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.mocked(createPageCache).mockClear();
  vi.mocked(purgeForWebId).mockClear();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each(["native", "web"])("uses the page adapter only for the %s target", async (target) => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", target);
  const value = accounts();
  const mounted = await mount(tree(value));
  const pod = session();
  const fresh = await pod.fetch(url);
  expect(await fresh.text()).toBe("private body");
  if (target === "web") {
    expect(createPageCache).not.toHaveBeenCalled();
    expect(fresh.headers.has("x-solid-offline-cache")).toBe(false);
  } else {
    expect(createPageCache).toHaveBeenCalledOnce();
    expect(fresh.headers.get("x-solid-offline-cache")).toBe("miss");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.mocked(value.fetch).mockRejectedValue(new TypeError("Offline"));
    const cached = await pod.fetch(url);
    expect(await cached.text()).toBe("private body");
    expect(cached.headers.get("x-solid-offline-cache")).toBe("stale");
    expect(value.fetch).toHaveBeenCalledOnce();
    await mounted.unmount();
    // A page reload can reopen the same durable data for the same active account.
    await mount(tree(value));
    expect(await (await session().fetch(url)).text()).toBe("private body");
  }
});

it("fences cached and in-flight native reads using the live account before React commits", async () => {
  const value = accounts();
  let live = true;
  value.isActiveAccount = () => live;
  const mounted = await mount(tree(value));
  const pod = session();
  await pod.fetch(url);
  live = false;
  await expect(pod.fetch(url)).rejects.toThrow("Sign in");
  live = true;
  const late = deferred<Response>();
  vi.mocked(value.fetch).mockReturnValueOnce(late.promise);
  const pending = pod.fetch(url);
  const rejected = expect(pending).rejects.toThrow("Sign in");
  await vi.waitFor(() => expect(value.fetch).toHaveBeenCalledTimes(2));
  live = false;
  late.resolve(new Response("late"));
  await rejected;
  await mounted.render(tree(accounts(bob)));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await expect(pod.fetch(url)).rejects.toThrow("Sign in");
});

it("relays adapter updates to the session subscribers, and keeps Strict Mode cleanup restartable", async () => {
  const { StrictMode } = await import("react");
  const value = accounts();
  await mount(h(StrictMode, null, tree(value)));
  expect(await (await session().fetch(url)).text()).toBe("private body");
  const listener = vi.fn();
  const stop = session().subscribe(listener);
  const options = vi.mocked(createPageCache).mock.calls.at(-1)?.[0];
  options?.onEvent?.({ event: "updated", url });
  expect(listener).toHaveBeenCalledWith(url);
  stop();
  options?.onEvent?.({ event: "updated", url });
  expect(listener).toHaveBeenCalledOnce();
});

it.each([
  "no-store",
  "private",
  "no-etag",
  "unchanged-etag",
])("does not feed %s read completions back into subscribers that reread", async (policy) => {
  const value = accounts();
  vi.mocked(value.fetch).mockImplementation(
    async () =>
      new Response("same bytes", {
        headers:
          policy === "no-etag"
            ? {}
            : policy === "unchanged-etag"
              ? { etag: "v1" }
              : { "cache-control": policy },
      }),
  );
  await mount(tree(value));
  const pod = session();
  const reads: Promise<string>[] = [];
  const listener = vi.fn((changed: string) => {
    // The bound makes a broken relay terminate deterministically, while still
    // performing real subscriber reads through the provider and IndexedDB.
    if (reads.length < 5) reads.push(pod.fetch(changed).then((response) => response.text()));
  });
  const stop = pod.subscribe(listener);
  try {
    expect(await (await pod.fetch(url)).text()).toBe("same bytes");
    const options = vi.mocked(createPageCache).mock.calls.at(-1)?.[0];
    // A real resource-change event must still prompt a read.
    options?.onEvent?.({ event: "updated", url });
    for (let index = 0; index < reads.length; index++) await reads[index];
    expect(listener).toHaveBeenCalledOnce();
    expect(value.fetch).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});

it("relays a changed body once even if the ETag is unchanged and the subscriber rereads", async () => {
  const value = accounts();
  await mount(tree(value));
  const pod = session();
  await pod.fetch(url);
  vi.mocked(value.fetch).mockImplementation(
    async () => new Response("changed body", { headers: { etag: "v1" } }),
  );
  const reads: Promise<string>[] = [];
  const listener = vi.fn((changed: string) => {
    if (reads.length < 5) reads.push(pod.fetch(changed).then((response) => response.text()));
  });
  const stop = pod.subscribe(listener);
  try {
    expect(await (await pod.fetch(url)).text()).toBe("changed body");
    for (let index = 0; index < reads.length; index++)
      expect(await reads[index]).toBe("changed body");
    expect(listener).toHaveBeenCalledOnce();
    expect(value.fetch).toHaveBeenCalledTimes(3);
  } finally {
    stop();
  }
});

it.each([
  "switch",
  "switch-back",
  "sign-out",
  "sign-out-all",
  "sign-out-failure",
  "sign-out-all-failure",
])("purges native persisted reads through the existing %s path", async (operation) => {
  let current!: AccountsContextValue;
  const backend = (account: SuiteAccount): SessionBackend => ({
    kind: account.kind,
    restore: async () => account,
    signIn: async () => account,
    signOut: vi.fn(async () => {}),
    fetchFor: () => async () => new Response("private body"),
    onExpired: () => () => {},
  });
  const first = backend(alice);
  if (operation.endsWith("failure"))
    vi.mocked(first.signOut).mockRejectedValue(new Error("Provider unavailable"));
  const second = backend({ ...bob, kind: "extension" });
  localStorage.setItem(
    "suite.accounts.v1",
    JSON.stringify({ activeId: alice.id, accounts: [alice, { ...bob, kind: "extension" }] }),
  );
  function Connected() {
    current = useAccounts();
    return tree(current);
  }
  await mount(h(AccountsProvider, { backends: [first, second], children: h(Connected) }));
  await session().fetch(url);
  expect((await indexedDB.databases()).length).toBeGreaterThan(0);
  const old = session();
  await act(async () => {
    if (operation === "switch") current.switchTo(bob.id);
    else if (operation === "switch-back") {
      current.switchTo(bob.id);
      current.switchTo(alice.id);
    } else if (operation === "sign-out") await current.signOut();
    else if (operation === "sign-out-failure")
      await expect(current.signOut()).rejects.toThrow("Provider unavailable");
    else if (operation === "sign-out-all-failure")
      await expect(current.signOutAll()).rejects.toThrow("Provider unavailable");
    else await current.signOutAll();
  });
  await vi.waitFor(async () =>
    expect(
      (await indexedDB.databases()).some((db) =>
        db.name?.includes(encodeURIComponent(alice.webId)),
      ),
    ).toBe(false),
  );
  await expect(old.fetch(url)).rejects.toThrow("Sign in");
  if (operation.startsWith("switch")) {
    expect(first.signOut).not.toHaveBeenCalled();
    expect(
      await (await session().fetch(operation === "switch" ? bob.storageUrl : url)).text(),
    ).toBe("private body");
  } else expect(first.signOut).toHaveBeenCalledWith(alice);
});

it("blocks reopened caches after incomplete purge and allows an explicit cleanup retry", async () => {
  const identity = "https://pod.example/cleanup-retry/#me";
  vi.mocked(purgeForWebId).mockResolvedValueOnce({
    cacheName: "",
    dbName: "",
    cacheDeleted: false,
    dbDeleted: false,
    dbBlocked: true,
    errors: [],
  });
  await expect(purgeNativePodCache(identity)).rejects.toThrow("could not be cleared");
  const options = {
    webId: identity,
    storageRoot: alice.storageUrl,
    usable: () => true,
    fetch: vi.fn(async () => new Response("fresh")),
  };
  const blocked = openNativePodCache(options);
  await expect(blocked.cache.fetch(url)).rejects.toThrow("could not be cleared");
  await purgeNativePodCache(identity);
  const reopened = openNativePodCache(options);
  try {
    expect(await (await reopened.cache.fetch(url)).text()).toBe("fresh");
  } finally {
    blocked.close();
    reopened.close();
  }
});

it.each([
  "native",
  "web",
])("registers and messages the service worker only on the web target (%s)", async (target) => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", target);
  vi.stubEnv("NODE_ENV", "production");
  const postMessage = vi.fn();
  const register = vi.fn(async () => ({}));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register, ready: Promise.resolve({ active: { postMessage } }) },
  });
  registerServiceWorker();
  rememberPage("/drive/my");
  await Promise.resolve();
  expect(register).toHaveBeenCalledTimes(target === "web" ? 1 : 0);
  expect(postMessage).toHaveBeenCalledTimes(target === "web" ? 1 : 0);
  Reflect.deleteProperty(navigator, "serviceWorker");
});
