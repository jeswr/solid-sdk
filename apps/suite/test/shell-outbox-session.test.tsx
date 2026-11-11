// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { createPodClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import type { SuiteAccount } from "../src/shell/session/types";
import { h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, render, waitFor } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const fixture = vi.hoisted(() => ({ accounts: {} as AccountsContextValue }));
vi.mock("../src/shell/session/accounts-provider", () => ({ useAccounts: () => fixture.accounts }));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));

import { OutboxSessionProvider, useOutboxSession } from "../src/shell/sync/outbox-session";

const alice: SuiteAccount = {
  id: "alice",
  webId: "https://pod.example/alice/profile#me",
  name: "Alice",
  kind: "solid",
  storageUrl: "https://pod.example/alice/",
};
const bob: SuiteAccount = {
  ...alice,
  id: "bob",
  webId: "https://pod.example/bob/profile#me",
  name: "Bob",
  storageUrl: "https://pod.example/bob/",
};
let session: ReturnType<typeof useOutboxSession>;
type DelegateFactory = Parameters<
  NonNullable<ReturnType<typeof useOutboxSession>>["registerReplayDelegate"]
>[1];
function present<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected a session fixture value");
  return value;
}
function Probe() {
  session = useOutboxSession();
  return null;
}
function contents() {
  return h(OutboxSessionProvider, {
    children: [h(Probe, { key: "probe" })],
  });
}
beforeEach(() => {
  fixture.accounts = {
    active: alice,
    status: "ready",
    fetch: vi.fn().mockResolvedValue(new Response()),
    isActiveAccount: (id: string) =>
      fixture.accounts.active?.id === id && fixture.accounts.status === "ready",
  } as unknown as AccountsContextValue;
  vi.mocked(createPodClient).mockReset();
  vi.mocked(createPodClient).mockImplementation(
    async ({ storage }) =>
      ({ storage: createMemoryStorage({ root: storage as string }) }) as Awaited<
        ReturnType<typeof createPodClient>
      >,
  );
});
afterEach(() => cleanup());

test("binds one real queue per WebID, uses existing authentication, aborts replacement and never purges", async () => {
  const view = render(contents());
  await waitFor(() => expect(session?.storage).toBeTruthy());
  const first = present(session);
  expect(first.outbox.webId).toBe(alice.webId);
  const options = present(vi.mocked(createPodClient).mock.calls[0])[0];
  await options.fetch(alice.storageUrl);
  expect(fixture.accounts.fetch).toHaveBeenCalledTimes(1);
  const isActive = fixture.accounts.isActiveAccount;
  fixture.accounts.isActiveAccount = () => false;
  await expect(first.adapter.resolve("missing", "theirs")).rejects.toThrow("still opening");
  fixture.accounts.isActiveAccount = isActive;
  await first.outbox.enqueue({ op: "write", url: `${alice.storageUrl}notes`, body: "unsent" });
  const purge = vi.spyOn(first.outbox, "purge");
  fixture.accounts = { ...fixture.accounts, active: bob };
  view.rerender(contents());
  await waitFor(() => expect(session?.storage?.root).toBe(bob.storageUrl));
  expect(first.signal.aborted).toBe(true);
  await expect(options.fetch(bob.storageUrl)).rejects.toThrow();
  expect(session?.outbox.pending()).toEqual([]);
  fixture.accounts = { ...fixture.accounts, active: alice };
  view.rerender(contents());
  await waitFor(() => expect(session?.storage?.root).toBe(alice.storageUrl));
  await present(session).outbox.ready;
  expect(session?.outbox.pending()).toHaveLength(1);
  expect(purge).not.toHaveBeenCalled();
  fixture.accounts = { ...fixture.accounts, status: "expired" };
  view.rerender(contents());
  expect(session).toBeNull();
  fixture.accounts = { ...fixture.accounts, active: null, status: "signed-out" };
  view.rerender(contents());
  expect(session).toBeNull();
});

test("storage discovery failure preserves the queue and online retries discovery", async () => {
  vi.mocked(createPodClient).mockRejectedValueOnce(new Error("Offline"));
  render(contents());
  await waitFor(() => expect(session?.outbox).toBeTruthy());
  await act(async () => {
    await Promise.resolve();
  });
  expect(session?.storage).toBeNull();
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() => expect(session?.storage).toBeTruthy());
  expect(createPodClient).toHaveBeenCalledTimes(2);
});

test("late storage discovery cannot bind after sign-out and demo accounts do not open queues", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof createPodClient>>) => void;
  vi.mocked(createPodClient).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(contents());
  await waitFor(() => expect(createPodClient).toHaveBeenCalled());
  fixture.accounts = { ...fixture.accounts, active: null, status: "signed-out" };
  view.rerender(contents());
  await act(async () => {
    resolve({ storage: createMemoryStorage({ root: alice.storageUrl }) } as Awaited<
      ReturnType<typeof createPodClient>
    >);
  });
  expect(session).toBeNull();
  fixture.accounts = { ...fixture.accounts, active: { ...alice, kind: "demo" }, status: "ready" };
  view.rerender(contents());
  expect(session).toBeNull();
  expect(createPodClient).toHaveBeenCalledTimes(1);
});

test("the session storage writes through, queues network failures and surfaces other failures", async () => {
  render(contents());
  await waitFor(() => expect(session?.storage).toBeTruthy());
  const client = present(session?.storage);
  const body = JSON.stringify({ hello: "pod" });
  const sent = await client.create(client.root, body, {
    name: "note.json",
    contentType: "application/json",
    offline: "queue",
  });
  expect(sent.queued).toBeUndefined();
  expect(JSON.parse(await (await client.read(sent.url)).text())).toEqual({ hello: "pod" });
  const raw = (await present(vi.mocked(createPodClient).mock.results[0]).value).storage;
  const create = vi
    .spyOn(raw, "create")
    .mockRejectedValueOnce(new TypeError("Network fetch failed"));
  const queued = await client.create(client.root, body, {
    name: "later.json",
    contentType: "application/json",
    offline: "queue",
  });
  expect(queued.queued).toBe(true);
  expect(present(session).outbox.pending()).toHaveLength(1);
  create.mockRejectedValueOnce(new Error("Denied"));
  await expect(
    client.create(client.root, body, {
      name: "denied.json",
      contentType: "application/json",
      offline: "queue",
    }),
  ).rejects.toThrow("Denied");
});

test("replay factories receive the session transport and registration expires on account replacement", async () => {
  const view = render(contents());
  await waitFor(() => expect(session?.storage).toBeTruthy());
  const first = present(session);
  const delegate = vi.fn().mockResolvedValue(undefined);
  const factory = vi.fn<DelegateFactory>(() => delegate);
  const unregister = first.registerReplayDelegate("test.policy", factory);
  const bound = present(factory.mock.calls[0])[0];
  expect(bound.webId).toBe(alice.webId);
  expect(bound.storageUrl).toBe(alice.storageUrl);
  expect(bound.storage).toBe(
    (await present(vi.mocked(createPodClient).mock.results[0]).value).storage,
  );
  expect(bound.signal).toBe(first.signal);
  expect(bound.fetch).toBe(present(vi.mocked(createPodClient).mock.calls[0])[0].fetch);
  await bound.fetch(alice.storageUrl);
  expect(fixture.accounts.fetch).toHaveBeenCalledOnce();
  await first.outbox.enqueue({
    op: "write",
    url: `${alice.storageUrl}guarded`,
    body: "local",
    guard: { tag: "test.policy", assertions: { policy: "captured" } },
  });
  await first.outbox.replay(present(first.storage));
  expect(delegate).toHaveBeenCalledOnce();
  fixture.accounts = { ...fixture.accounts, active: bob };
  view.rerender(contents());
  await waitFor(() => expect(session?.storage?.root).toBe(bob.storageUrl));
  const second = present(session);
  expect(bound.signal.aborted).toBe(true);
  await expect(bound.fetch(bob.storageUrl)).rejects.toThrow();
  expect(() => first.registerReplayDelegate("test.policy", factory)).toThrow();
  await second.outbox.enqueue({
    op: "write",
    url: `${bob.storageUrl}guarded`,
    guard: { tag: "test.policy" },
  });
  await second.outbox.replay(present(second.storage));
  expect(second.outbox.pending()).toMatchObject([{ status: "waiting", blocked: "no-delegate" }]);
  expect(delegate).toHaveBeenCalledOnce();
  expect(factory).toHaveBeenCalledOnce();
  const nextDelegate = vi.fn().mockResolvedValue(undefined);
  const nextFactory = vi.fn(() => nextDelegate);
  const stop = second.registerReplayDelegate("test.policy", nextFactory);
  unregister(); // Old cleanup cannot unregister the new account's delegate.
  await second.outbox.replay(present(second.storage));
  expect(nextDelegate).toHaveBeenCalledOnce();
  expect(second.outbox.pending()).toEqual([]);
  stop();
});

test("a retained registration refuses inactive sessions even before cleanup and does not invoke its factory", async () => {
  render(contents());
  await waitFor(() => expect(session?.storage).toBeTruthy());
  const first = present(session);
  const factory = vi.fn(() => vi.fn().mockResolvedValue(undefined));
  fixture.accounts.isActiveAccount = () => false;
  expect(() => first.registerReplayDelegate("test.policy", factory)).toThrow("no longer active");
  expect(factory).not.toHaveBeenCalled();
});

test("registered delivery and fetch are fenced when account authority changes without a new render", async () => {
  render(contents());
  await waitFor(() => expect(session?.storage).toBeTruthy());
  const first = present(session);
  const delegate = vi.fn().mockResolvedValue(undefined);
  let transport!: typeof fetch;
  first.registerReplayDelegate("test.policy", (bound) => {
    transport = bound.fetch;
    return delegate;
  });
  await first.outbox.enqueue({
    op: "write",
    url: `${alice.storageUrl}guarded`,
    guard: { tag: "test.policy" },
  });
  fixture.accounts.isActiveAccount = () => false;
  await first.outbox.replay(present(first.storage));
  expect(delegate).not.toHaveBeenCalled();
  expect(first.outbox.pending()).toMatchObject([
    { status: "failed", error: expect.stringContaining("no longer active") },
  ]);
  await expect(transport(alice.storageUrl)).rejects.toThrow("no longer active");
});

test("trusted guard policies block bare delivery and expire on account replacement", async () => {
  const view = render(contents());
  await waitFor(() => expect(session?.storage).toBeTruthy());
  const first = present(session);
  const raw = (await present(vi.mocked(createPodClient).mock.results[0]).value).storage;
  const write = vi.spyOn(raw, "write");
  const matches = vi.fn((operation: { url: string }) => operation.url.startsWith(alice.storageUrl));
  const stop = first.registerGuardPolicy("test.policy", matches);
  const target = `${alice.storageUrl}guard-stripped`;
  await first.outbox.enqueue({ op: "write", url: target, body: "unsent" });
  await first.outbox.replay(present(first.storage));
  expect(first.outbox.pending()).toMatchObject([{ status: "waiting", blocked: "guard-required" }]);
  expect(write).not.toHaveBeenCalled();
  await expect(
    present(first.storage).write(target, "body", {
      contentType: "text/plain",
      ifMatch: "*",
    }),
  ).rejects.toThrow("guard required");
  expect(write).not.toHaveBeenCalled();
  const delegate = vi.fn().mockResolvedValue(undefined);
  first.registerReplayDelegate("test.policy", () => delegate);
  await present(first.storage).write(target, "body", {
    contentType: "text/plain",
    ifMatch: "*",
    guard: { tag: "test.policy" },
    keepalive: true,
  });
  expect(delegate).toHaveBeenCalledWith(
    expect.objectContaining({ keepalive: true }),
    expect.anything(),
  );

  fixture.accounts = { ...fixture.accounts, active: bob };
  view.rerender(contents());
  await waitFor(() => expect(session?.storage?.root).toBe(bob.storageUrl));
  expect(() => first.registerGuardPolicy("test.policy", matches)).toThrow();
  const second = present(session);
  const bobRaw = (await present(vi.mocked(createPodClient).mock.results[1]).value).storage;
  const bobWrite = vi
    .spyOn(bobRaw, "write")
    .mockResolvedValue({ url: `${bob.storageUrl}file`, etag: null, created: false });
  const opts = { contentType: "text/plain", ifMatch: "*" };
  await present(second.storage).write(`${bob.storageUrl}file`, "legacy", opts);
  expect(bobWrite).toHaveBeenCalledOnce();
  const stopBob = second.registerGuardPolicy("test.policy", () => true);
  stop();
  await expect(
    present(second.storage).write(`${bob.storageUrl}file`, "local", opts),
  ).rejects.toThrow("guard required");
  expect(bobWrite).toHaveBeenCalledOnce();
  stopBob();
  stopBob();
  await present(second.storage).write(`${bob.storageUrl}file`, "legacy", opts);
  expect(bobWrite).toHaveBeenCalledTimes(2);
});

test("policies can register while storage opens and retained registrations reject inactive accounts", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof createPodClient>>) => void;
  vi.mocked(createPodClient).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(contents());
  await waitFor(() => expect(session?.outbox).toBeTruthy());
  const first = present(session);
  const matches = vi.fn(() => true);
  first.registerGuardPolicy("test.policy", matches);
  expect(first.storage).toBeNull();
  const raw = createMemoryStorage({ root: alice.storageUrl });
  const write = vi.spyOn(raw, "write");
  await act(async () => {
    resolve({ storage: raw } as Awaited<ReturnType<typeof createPodClient>>);
  });
  await waitFor(() => expect(session?.storage).toBeTruthy());
  fixture.accounts.isActiveAccount = () => false;
  expect(() => first.registerGuardPolicy("other.policy", matches)).toThrow("no longer active");
  await expect(
    present(session?.storage).write(`${alice.storageUrl}file`, "body", {
      contentType: "text/plain",
      ifMatch: "*",
    }),
  ).rejects.toThrow("guard required");
  expect(matches).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
