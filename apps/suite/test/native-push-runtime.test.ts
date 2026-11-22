// AUTHORED-BY Codex GPT-6
import { resolveStorageDescription, type StorageDescription } from "@jeswr/storage-capabilities";
import {
  createPushRegistrar,
  type PushClient,
  type PushRegistrar,
  type PushRegistrarOptions,
  type PushRegistrarState,
  type PushTopicSpec,
} from "@jeswr/suite-native/push";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPushRuntime } from "../src/shell/push/runtime";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import type { SuiteAccount } from "../src/shell/session/types";

vi.mock("@jeswr/storage-capabilities", () => ({ resolveStorageDescription: vi.fn() }));
vi.mock("@jeswr/suite-native/push", async (original) => ({
  ...(await original<object>()),
  createPushRegistrar: vi.fn(),
}));
const account: SuiteAccount = {
  id: "alice",
  kind: "solid",
  name: "Alice",
  webId: "https://id.example/alice#me",
  issuer: "https://id.example",
  storageUrl: "https://pod.example/alice/",
};
const topic: PushTopicSpec = {
  index: 0,
  kind: "inbox",
  label: "Inbox",
  topic: `${account.storageUrl}inbox/`,
  route: "/notifications",
  enabled: true,
};
const description: StorageDescription = {
  protocol: "lws",
  id: "https://pod.example/.well-known/storage/alice",
  root: account.storageUrl,
  services: [],
  capabilities: [],
  descriptionUrl: null,
  owner: null,
  fetchedAt: 0,
  maxAgeMs: 0,
  etag: null,
  sources: [],
  verificationMethods: [],
};
function fixture() {
  const transport = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const accounts: AccountsContextValue = {
    active: account,
    accounts: [account],
    status: "ready",
    isActiveAccount: (id) => id === account.id,
    isSignedInAccount: (id) => id === account.id,
    fetch: transport,
    fetchFor: vi.fn(() => transport),
    signIn: vi.fn(),
    signInDemo: vi.fn(),
    signInWith: vi.fn(),
    backendKinds: ["solid"],
    add: vi.fn(),
    switchTo: vi.fn(),
    signOut: vi.fn(),
    signOutAll: vi.fn(),
    reauth: vi.fn(),
  };
  const state: PushRegistrarState = {
    version: 1,
    relayUrl: "https://relay.example",
    installationId: "phone",
    registrations: [
      {
        accountId: account.id,
        webId: account.webId,
        protocol: "lws",
        storage: description.id,
        registrationId: "registration",
        inbox: null,
        requestedTopics: [topic],
        topics: [],
        cleanupTopics: [],
        removing: false,
        refreshedAt: 0,
      },
    ],
  };
  const registrar: PushRegistrar = {
    enable: vi.fn(),
    renew: vi.fn(),
    remove: vi.fn(),
    retryCleanup: vi.fn(),
    snapshot: vi.fn(async () => structuredClone(state)),
  };
  vi.mocked(createPushRegistrar).mockReturnValue(registrar);
  const push = {} as PushClient;
  const discoverTopics = vi.fn(async () => [topic]);
  const store = { load: vi.fn(async () => state), save: vi.fn() };
  return {
    accounts,
    transport,
    state,
    registrar,
    push,
    discoverTopics,
    create: () =>
      createPushRuntime({
        accounts: () => accounts,
        relayUrl: "https://relay.example",
        loadPush: async () => push,
        store,
        discoverTopics,
      }),
  };
}
beforeEach(() => {
  vi.mocked(createPushRegistrar).mockClear();
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "ios" });
  vi.mocked(resolveStorageDescription).mockResolvedValue(description);
});
afterEach(() => vi.stubGlobal("Capacitor", undefined));

it("pins relay requests to the requested account and a build-selected origin, and discovers LWS protocol/id", async () => {
  const test = fixture();
  const runtime = await test.create();
  if (!runtime) throw new Error("native runtime");
  await runtime.enable(account);
  expect(test.registrar.enable).toHaveBeenCalledWith({
    accountId: "alice",
    webId: account.webId,
    protocol: "lws",
    storage: description.id,
    topics: [topic],
  });
  const options: PushRegistrarOptions | undefined =
    vi.mocked(createPushRegistrar).mock.calls[0]?.[0];
  if (!options?.fetchFor) throw new Error("Missing bound fetch");
  await options.fetchFor("alice")("https://relay.example/push/installations", { method: "POST" });
  expect(test.accounts.fetchFor).toHaveBeenLastCalledWith(account, {
    extraResourceOrigins: ["https://relay.example"],
  });
  expect(() => options.fetchFor?.("signed-out")).toThrow();
  test.accounts.active = null;
  // Inactive signed-in accounts retain their own fetch, independently of the active pointer.
  await options.fetchFor("alice")("https://relay.example/push/registrations/id");
  expect(test.accounts.fetchFor).toHaveBeenLastCalledWith(account, {
    extraResourceOrigins: ["https://relay.example"],
  });
});

it("fences a sign-out while topic discovery is pending", async () => {
  const test = fixture();
  test.discoverTopics.mockImplementation(async () => {
    test.accounts.isSignedInAccount = () => false;
    return [topic];
  });
  const runtime = await test.create();
  await expect(runtime?.enable(account)).rejects.toThrow("Account changed");
  expect(test.registrar.enable).not.toHaveBeenCalled();
});

it("single-flights resume, refreshes joined topics and uses renewal for an unchanged map", async () => {
  const test = fixture();
  const runtime = await test.create();
  if (!runtime) throw new Error("native runtime");
  await Promise.all([runtime.resume(), runtime.resume()]);
  expect(test.registrar.renew).toHaveBeenCalledTimes(1);
  expect(test.registrar.enable).not.toHaveBeenCalled();
  test.discoverTopics.mockResolvedValue([{ ...topic, label: "Updated inbox" }]);
  await runtime.resume();
  expect(test.registrar.enable).toHaveBeenCalledWith(
    expect.objectContaining({ topics: [{ ...topic, label: "Updated inbox" }] }),
  );
});

it("cleans signed-out accounts first and continues another account's renewal when cleanup fails", async () => {
  const test = fixture();
  const previous = test.state.registrations[0];
  if (!previous) throw new Error("fixture");
  test.state.registrations.unshift({ ...previous, accountId: "signed-out", registrationId: "old" });
  vi.mocked(test.registrar.retryCleanup).mockRejectedValue(new Error("offline"));
  const runtime = await test.create();
  await expect(runtime?.resume()).rejects.toThrow("pending");
  expect(test.registrar.remove).toHaveBeenCalledWith("signed-out");
  expect(test.registrar.renew).toHaveBeenCalledWith("alice");
});
