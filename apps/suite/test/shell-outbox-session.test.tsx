// AUTHORED-BY Codex GPT-6.1-Sol
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
