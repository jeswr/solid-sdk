// AUTHORED-BY Codex GPT-6
import { cssStorage, fixtureFetch } from "@jeswr/storage-capabilities/testing";
import type { PushClient, PushLaunchRoute, PushRegistrarState } from "@jeswr/suite-native/push";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pushRelayUrl } from "../src/shell/push/config";
import { NativePushProvider, PushLaunch } from "../src/shell/push/provider";
import {
  consumePushDestination,
  createPushRuntime,
  type PushRuntime,
  pushStateStore,
} from "../src/shell/push/runtime";
import { NativePushSettings } from "../src/shell/push/settings";
import { AccountsContext } from "../src/shell/session/accounts-context";
import {
  type AccountsContextValue,
  AccountsProvider,
  useAccounts,
} from "../src/shell/session/accounts-provider";
import { beforeSignOut } from "../src/shell/session/sign-out-cleanup";
import type { SessionBackend, SuiteAccount } from "../src/shell/session/types";
import { act, click, h, mount } from "./drive-ui-dom";

const navigation = vi.hoisted(() => ({ push: vi.fn(), order: [] as string[] }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("../src/shell/session/demo-backend", () => ({
  DemoBackend: vi.fn(),
  demoAccount: { id: "demo" },
}));
const alice: SuiteAccount = {
  id: "alice",
  kind: "solid",
  webId: "https://id.example/alice#me",
  issuer: "https://id.example",
  storageUrl: "https://pod.example/alice/",
  name: "Alice",
};
const bob: SuiteAccount = {
  ...alice,
  id: "bob",
  name: "Bob",
  webId: "https://id.example/bob#me",
  storageUrl: "https://pod.example/bob/",
};
function shell(active = alice, list = [alice, bob]): AccountsContextValue {
  return {
    active,
    accounts: list,
    status: "ready",
    isActiveAccount: (id) => id === active.id,
    isSignedInAccount: (id) => list.some((account) => account.id === id),
    signIn: vi.fn(),
    signInDemo: vi.fn(),
    signInWith: vi.fn(),
    backendKinds: ["solid"],
    add: vi.fn(),
    switchTo: vi.fn(),
    signOut: vi.fn(),
    signOutAll: vi.fn(),
    reauth: vi.fn(),
    fetch,
    fetchFor: vi.fn(() => fetch),
  };
}
function fixture() {
  let launch: PushLaunchRoute | null = null;
  const push: PushClient = {
    status: vi.fn(async () => ({
      platform: "android" as const,
      permission: "granted" as const,
      installed: true,
      registrationStale: false,
    })),
    enable: vi.fn(),
    setTopicMap: vi.fn(),
    silence: vi.fn(),
    sign: vi.fn(),
    activate: vi.fn(),
    disable: vi.fn(),
    scheduleRenewalReminder: vi.fn(),
    consumeLaunchRoute: vi.fn(async () => {
      const next = launch;
      launch = null;
      return next;
    }),
  };
  const state: PushRegistrarState = {
    version: 1,
    relayUrl: "https://relay.example",
    installationId: "phone",
    registrations: [
      {
        accountId: bob.id,
        webId: bob.webId,
        protocol: "solid",
        storage: bob.storageUrl,
        registrationId: "bob-registration",
        inbox: "https://relay.example/inbox/bob-registration/secret",
        requestedTopics: [
          {
            index: 0,
            kind: "chat",
            topic: `${bob.storageUrl}chat/book/`,
            label: "Book club",
            route: "/chat/Ym9vaw",
            enabled: true,
          },
        ],
        topics: [
          {
            index: 0,
            kind: "chat",
            topic: `${bob.storageUrl}chat/book/`,
            channel: "https://pod.example/.notifications/one",
            expiresAt: Date.now() + 7 * 86_400_000,
          },
        ],
        cleanupTopics: [],
        removing: false,
        refreshedAt: Date.now(),
      },
    ],
  };
  const remove = vi.fn(async (id: string) => {
    for (const entry of state.registrations) if (entry.accountId === id) entry.removing = true;
  });
  const runtime: PushRuntime = {
    push,
    registrar: {
      snapshot: vi.fn(async () => structuredClone(state)),
      enable: vi.fn(),
      renew: vi.fn(),
      remove,
      retryCleanup: vi.fn(),
    },
    enable: vi.fn(),
    removeForSignOut: (account) => remove(account.id),
    resume: vi.fn(),
  };
  return {
    runtime,
    state,
    tap: (next: PushLaunchRoute) => {
      launch = next;
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "android" });
  vi.stubEnv("NEXT_PUBLIC_PUSH_RELAY_URL", "https://relay.example");
  navigation.push.mockImplementation((route) => {
    navigation.order.push(`navigate:${route}`);
  });
  navigation.order = [];
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  navigation.push.mockReset();
  vi.stubGlobal("Capacitor", undefined);
  vi.useRealTimers();
});

it("loads no plugin or settings on web or without a relay", async () => {
  const loader = vi.fn();
  vi.stubGlobal("Capacitor", undefined);
  expect(await createPushRuntime({ accounts: () => shell(), loadPush: loader })).toBeNull();
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
  expect(
    await createPushRuntime({ accounts: () => shell(), relayUrl: null, loadPush: loader }),
  ).toBeNull();
  expect(loader).not.toHaveBeenCalled();
  vi.stubEnv("NEXT_PUBLIC_PUSH_RELAY_URL", "");
  const factory = vi.fn();
  const view = await mount(
    h(AccountsContext, {
      value: shell(),
      children: h(NativePushProvider, { createRuntime: factory, children: h(NativePushSettings) }),
    }),
  );
  expect(factory).not.toHaveBeenCalled();
  expect(view.host.textContent).toBe("");
});

it.each([
  "http://relay.example",
  "https://relay.example/",
  "https://u@relay.example",
  "https://relay.example/path",
  "https://RELAY.example",
  "https://relay.example?x=1",
  "https://relay.example#x",
])("refuses an ambiguous build relay: %s", (value) => {
  expect(() => pushRelayUrl(value)).toThrow();
});

it("stores registration metadata durably, separated by relay, and surfaces failed storage", async () => {
  localStorage.clear();
  const state = fixture().state;
  const store = pushStateStore(localStorage, state.relayUrl);
  expect(await store.load()).toBeNull();
  await store.save(state);
  expect(await store.load()).toEqual(state);
  expect(await pushStateStore(localStorage, "https://other.example").load()).toBeNull();
  const failing = pushStateStore(
    {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    },
    state.relayUrl,
  );
  await expect(failing.save(state)).rejects.toThrow("blocked");
});

it("resolves only live enabled account topics and drops unknown, disabled, silenced or signed-out routes", async () => {
  const test = fixture();
  test.tap({ registrationId: "bob-registration", route: "/chat/Ym9vaw" });
  expect(await consumePushDestination(test.runtime, shell())).toEqual({
    accountId: "bob",
    route: "/chat/r/Ym9vaw",
  });
  for (const launch of [
    { registrationId: "unknown", route: "/chat/Ym9vaw" },
    { registrationId: "bob-registration", route: "https://evil.example" },
    { registrationId: "bob-registration", route: "/chat/different" },
  ]) {
    test.tap(launch);
    expect(await consumePushDestination(test.runtime, shell())).toEqual({
      accountId: null,
      route: "/notifications",
    });
  }
  test.tap({ registrationId: "bob-registration", route: "/chat/Ym9vaw" });
  expect(await consumePushDestination(test.runtime, shell(alice, [alice]))).toEqual({
    accountId: null,
    route: "/notifications",
  });
  const entry = test.state.registrations[0];
  if (!entry) throw new Error("fixture");
  entry.removing = true;
  test.tap({ registrationId: "bob-registration", route: "/chat/Ym9vaw" });
  expect(await consumePushDestination(test.runtime, shell())).toEqual({
    accountId: null,
    route: "/notifications",
  });
});

it.each(["cold", "warm"])("switches to Bob before routing his %s notification", async (mode) => {
  const test = fixture();
  if (mode === "cold") test.tap({ registrationId: "bob-registration", route: "/chat/Ym9vaw" });
  function Harness() {
    const [active, setActive] = useState(alice);
    const value = shell(active);
    value.switchTo = (id) => {
      navigation.order.push(`switch:${id}`);
      setActive(bob);
    };
    return h(AccountsContext, { value, children: h(PushLaunch, { runtime: test.runtime }) });
  }
  const view = await mount(h(Harness));
  if (mode === "warm") {
    expect(navigation.push).not.toHaveBeenCalled();
    test.tap({ registrationId: "bob-registration", route: "/chat/Ym9vaw" });
    await act(() => window.dispatchEvent(new Event("focus")));
  }
  expect(navigation.order).toEqual(["switch:bob", "navigate:/chat/r/Ym9vaw"]);
  await view.unmount();
});

it("leaves the active account alone for a signed-out account tap and waits for restoration", async () => {
  const test = fixture();
  test.tap({ registrationId: "bob-registration", route: "/chat/Ym9vaw" });
  const value = { ...shell(alice, [alice]), status: "loading" as const };
  const view = await mount(
    h(AccountsContext, { value, children: h(PushLaunch, { runtime: test.runtime }) }),
  );
  expect(test.runtime.push.consumeLaunchRoute).not.toHaveBeenCalled();
  await view.render(
    h(AccountsContext, {
      value: { ...value, status: "ready" },
      children: h(PushLaunch, { runtime: test.runtime }),
    }),
  );
  expect(navigation.push).toHaveBeenCalledWith("/notifications");
  expect(value.switchTo).not.toHaveBeenCalled();
});

it("shows per-account controls and the availability notice, and silences before sign-out cleanup", async () => {
  const test = fixture();
  const factory = vi.fn(async () => test.runtime);
  const view = await mount(
    h(AccountsContext, {
      value: shell(),
      children: h(NativePushProvider, { createRuntime: factory, children: h(NativePushSettings) }),
    }),
  );
  expect(view.host.textContent).toContain(
    "Notifications pause if you don't open Solid Suite for a week",
  );
  expect(view.host.textContent).toContain("Permission: granted");
  const on = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Turn on notifications for Alice",
  );
  const off = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Turn off notifications for Bob",
  );
  if (!on || !off) throw new Error("Missing push controls");
  await click(on);
  expect(test.runtime.enable).toHaveBeenCalledWith(alice);
  await click(off);
  expect(test.runtime.registrar.remove).toHaveBeenCalledWith("bob");
  expect(view.host.textContent).toContain("Off · cleanup pending");
  await act(async () => {
    await beforeSignOut(alice);
  });
  expect(test.runtime.registrar.remove).toHaveBeenCalledWith("alice");
  expect(test.runtime.resume).toHaveBeenCalled();
  await view.unmount();
  vi.mocked(test.runtime.registrar.remove).mockClear();
  await beforeSignOut(alice);
  expect(test.runtime.registrar.remove).not.toHaveBeenCalled();
});

it.each([
  204, 503,
])("attempts the authenticated pod DELETE before sign-out (pod returns %s)", async (status) => {
  const test = fixture();
  const account = { ...bob, storageUrl: cssStorage.root };
  const channel = "https://css.example/.notifications/WebhookChannel2023/channel";
  const [entry] = test.state.registrations;
  const requestTopic = entry?.requestedTopics[0];
  const boundTopic = entry?.topics[0];
  if (!entry || !requestTopic || !boundTopic) throw new Error("Missing saved registration");
  entry.storage = account.storageUrl;
  entry.inbox = null;
  requestTopic.topic = cssStorage.resource;
  entry.topics[0] = { ...boundTopic, topic: cssStorage.resource, channel };
  const pod = fixtureFetch({
    ...cssStorage,
    responses: { ...cssStorage.responses, [`DELETE ${channel}`]: { status, headers: {} } },
  });
  const order: string[] = [];
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "DELETE") order.push("pod DELETE");
    return pod(request);
  });
  vi.mocked(test.runtime.push.sign).mockResolvedValue({ proof: "device-proof" });
  const relay = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", relay);
  try {
    const backend: SessionBackend = {
      kind: "solid",
      restore: async () => account,
      signIn: async () => account,
      signOut: vi.fn(async () => {
        order.push("sign out");
      }),
      fetchFor: vi.fn(() => transport),
      onExpired: () => () => {},
    };
    localStorage.removeItem("suite.accounts.v1");
    let accounts!: AccountsContextValue;
    function Probe() {
      accounts = useAccounts();
      return null;
    }
    let runtime: PushRuntime | null = null;
    await mount(
      h(AccountsProvider, {
        backends: [backend],
        children: h(NativePushProvider, {
          createRuntime: async (options) => {
            runtime = await createPushRuntime({
              ...options,
              loadPush: async () => test.runtime.push,
              store: {
                load: async () => structuredClone(test.state),
                save: async () => {},
              },
              // Keep startup renewal from changing the saved registration.
              discoverTopics: async () => {
                throw new Error("Renewal unavailable");
              },
            });
            return runtime;
          },
          children: h(Probe),
        }),
      }),
    );
    expect(accounts.status).toBe("ready");
    expect(runtime).not.toBeNull();
    await act(() => accounts.signOut(account.id));

    expect(order).toEqual(["pod DELETE", "sign out"]);
    expect(pod.calls).toContain(`DELETE ${channel}`);
    expect(backend.fetchFor).toHaveBeenLastCalledWith(account);
    expect(relay).toHaveBeenCalledWith(
      "https://relay.example/push/registrations/bob-registration",
      expect.objectContaining({
        method: "DELETE",
        headers: { "installation-proof": "device-proof" },
      }),
    );
    expect(accounts.status).toBe("signed-out");
    expect(accounts.accounts).toEqual([]);
    const snapshot = await (runtime as PushRuntime | null)?.registrar.snapshot();
    expect(snapshot?.registrations).toEqual(
      status === 204 ? [] : [expect.objectContaining({ removing: true, topics: entry.topics })],
    );
  } finally {
    vi.stubGlobal("fetch", originalFetch);
  }
});

it("offers Try again after activation failure and renews on resume and reconnection", async () => {
  const test = fixture();
  test.state.registrations = [];
  vi.mocked(test.runtime.enable).mockRejectedValue(new Error("challenge timeout"));
  const factory = async () => test.runtime;
  const view = await mount(
    h(AccountsContext, {
      value: shell(),
      children: h(NativePushProvider, { createRuntime: factory, children: h(NativePushSettings) }),
    }),
  );
  const on = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Turn on notifications for Alice",
  );
  if (!on) throw new Error("Missing control");
  await click(on);
  expect(view.host.textContent).toContain("Couldn't turn notifications on");
  expect(view.host.textContent).toContain("Try again for Alice");
  vi.mocked(test.runtime.resume).mockClear();
  await act(() => document.dispatchEvent(new Event("resume")));
  await act(() => window.dispatchEvent(new Event("online")));
  expect(test.runtime.resume).toHaveBeenCalledTimes(2);
});
