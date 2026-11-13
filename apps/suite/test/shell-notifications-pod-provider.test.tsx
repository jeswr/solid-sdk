// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { createInboxReader, type InboxNotification } from "@jeswr/pod-access/notify";
import { act, useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SuiteNotification } from "../src/shell/lib/notifications-model";
import { addLocalNotification } from "../src/shell/notifications/local-store";
import { createPodNotificationSource } from "../src/shell/notifications/pod-source";
import { NotificationsProvider, useNotifications } from "../src/shell/notifications/provider";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import type { SessionStatus, SuiteAccount } from "../src/shell/session/types";
import { deferred, h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, waitFor } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const accounts = vi.hoisted(() => ({ current: {} as AccountsContextValue }));
vi.mock("../src/shell/session/accounts-provider", () => ({ useAccounts: () => accounts.current }));
vi.mock("@jeswr/pod-access/notify", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-access/notify")>()),
  createInboxReader: vi.fn(),
}));
vi.mock("../src/shell/notifications/pod-source", async (original) => {
  const actual = await original<typeof import("../src/shell/notifications/pod-source")>();
  return { ...actual, createPodNotificationSource: vi.fn(actual.createPodNotificationSource) };
});

const alice: SuiteAccount = {
  id: "pod-notifications-alice",
  webId: "https://alice.example/profile#me",
  storageUrl: "https://alice.example/",
  name: "Alice",
  kind: "solid",
};
const bob: SuiteAccount = {
  ...alice,
  id: "pod-notifications-bob",
  webId: "https://bob.example/profile#me",
  name: "Bob",
};
const notification = (owner: string): InboxNotification => ({
  url: `https://inbox.example/${encodeURIComponent(owner)}/one`,
  type: "Announce",
  summary: `Shared with you as ${owner}`,
});
const readers: { list: ReturnType<typeof vi.fn<ReturnType<typeof createInboxReader>["list"]>> }[] =
  [];
let actions: ReturnType<typeof useNotifications>;
let mounts: number;
const renders: string[][] = [];
function Consumer() {
  actions = useNotifications();
  const [draft, setDraft] = useState("");
  useEffect(() => {
    mounts++;
  }, []);
  renders.push(actions.items.map((item) => item.id));
  return h(
    "main",
    null,
    h("p", { "data-testid": "items" }, actions.items.map((item) => item.title).join(", ")),
    h("p", { "data-testid": "error" }, actions.error),
    h("input", {
      "aria-label": "Unsaved draft",
      value: draft,
      onChange: (event) => setDraft(event.currentTarget.value),
    }),
  );
}
const tree = () => h(NotificationsProvider, { children: h(Consumer) });
const created = (index: number) =>
  vi.mocked(createPodNotificationSource).mock.results[index]?.value as ReturnType<
    typeof createPodNotificationSource
  >;
const fencedFetch = (index: number) => {
  const options = vi.mocked(createPodNotificationSource).mock.calls[index]?.[0];
  if (!options) throw new Error("Expected a pod source");
  return options.fetch;
};

beforeEach(() => {
  vi.clearAllMocks();
  readers.length = 0;
  renders.length = 0;
  mounts = 0;
  vi.stubGlobal("indexedDB", undefined);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  localStorage.clear();
  accounts.current = {
    active: alice,
    status: "ready",
    isActiveAccount: vi.fn(
      (id: string) => accounts.current.active?.id === id && accounts.current.status === "ready",
    ),
    fetch: vi.fn().mockResolvedValue(new Response()),
  } as unknown as AccountsContextValue;
  vi.mocked(createInboxReader).mockImplementation(() => {
    const list = vi
      .fn<ReturnType<typeof createInboxReader>["list"]>()
      .mockImplementation(async (owner, options) => {
        options?.signal?.throwIfAborted();
        return [notification(owner)];
      });
    readers.push({ list });
    return { inbox: async (webId) => webId, list, listPage: vi.fn() };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("adds a ready real account's inbox using its fenced authenticated fetch and keeps read state local", async () => {
  render(tree());
  await screen.findByText(`Shared with you as ${alice.webId}`);
  expect(createPodNotificationSource).toHaveBeenCalledOnce();
  expect(createPodNotificationSource).toHaveBeenCalledWith({
    webId: alice.webId,
    fetch: expect.any(Function),
  });
  const fetch = fencedFetch(0);
  expect(fetch).not.toBe(accounts.current.fetch);
  const request = { method: "GET", signal: new AbortController().signal };
  await fetch(alice.webId, request);
  expect(accounts.current.fetch).toHaveBeenCalledExactlyOnceWith(alice.webId, request);
  const item = actions.items[0];
  if (!item) throw new Error("Expected an inbox notification");
  await act(async () => {
    await actions.markRead(item.id);
    await actions.refresh();
  });
  expect(actions.unread).toBe(0);
  expect(actions.items[0]?.read).toBe(true);
});

it("fences a live session change before React has rerendered", async () => {
  render(tree());
  await screen.findByText(`Shared with you as ${alice.webId}`);
  vi.mocked(accounts.current.isActiveAccount).mockReturnValue(false);
  await expect(fencedFetch(0)(alice.webId)).rejects.toThrow("Sign in to read notifications");
  expect(accounts.current.fetch).not.toHaveBeenCalled();
});

it("disposes on switch/sign-out, drops items synchronously, and ignores late source results", async () => {
  const view = render(tree());
  await screen.findByText(`Shared with you as ${alice.webId}`);
  const old = created(0);
  const dispose = vi.spyOn(old, "dispose");
  const fetch = fencedFetch(0);
  const late = deferred<InboxNotification[]>();
  readers[0]?.list.mockReturnValueOnce(late.promise);
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = actions.refresh();
  });
  const oldSignal = readers[0]?.list.mock.calls.at(-1)?.[1]?.signal;
  accounts.current = { ...accounts.current, active: bob };
  const switchStart = renders.length;
  view.rerender(tree());
  expect(
    renders.slice(switchStart).every((ids) => !ids.includes(notification(alice.webId).url)),
  ).toBe(true);
  expect(dispose).toHaveBeenCalledOnce();
  expect(oldSignal?.aborted).toBe(true);
  await expect(fetch(alice.webId)).rejects.toThrow("Sign in to read notifications");
  await act(async () => {
    late.resolve([notification(alice.webId)]);
    await refresh;
  });
  await screen.findByText(`Shared with you as ${bob.webId}`);
  expect(screen.queryByText(`Shared with you as ${alice.webId}`)).toBeNull();
  const bobDispose = vi.spyOn(created(1), "dispose");
  accounts.current = { ...accounts.current, active: null, status: "signed-out" };
  view.rerender(tree());
  expect(screen.getByTestId("items").textContent).toBe("");
  expect(bobDispose).toHaveBeenCalledOnce();
  await expect(fencedFetch(1)(bob.webId)).rejects.toThrow("Sign in to read notifications");
  await expect(old.list(new AbortController().signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});

it("rejects a response from an expired session even if fetch ignores abort, and never revives that fetch", async () => {
  const view = render(tree());
  await screen.findByText(`Shared with you as ${alice.webId}`);
  const oldFetch = fencedFetch(0);
  const late = deferred<Response>();
  vi.mocked(accounts.current.fetch).mockReturnValueOnce(late.promise);
  const pending = oldFetch(alice.webId);
  const rejected = expect(pending).rejects.toThrow("Sign in to read notifications");
  accounts.current = { ...accounts.current, status: "expired" };
  view.rerender(tree());
  expect(screen.getByTestId("items").textContent).toBe("");
  late.resolve(new Response());
  await rejected;
  accounts.current = { ...accounts.current, status: "ready" };
  view.rerender(tree());
  await screen.findByText(`Shared with you as ${alice.webId}`);
  await expect(oldFetch(alice.webId)).rejects.toThrow("Sign in to read notifications");
  expect(createPodNotificationSource).toHaveBeenCalledTimes(2);
});

it("rebuilds for a changed WebID on the same account id", async () => {
  const view = render(tree());
  await screen.findByText(`Shared with you as ${alice.webId}`);
  const dispose = vi.spyOn(created(0), "dispose");
  accounts.current = { ...accounts.current, active: { ...alice, webId: bob.webId } };
  view.rerender(tree());
  expect(screen.queryByText(`Shared with you as ${alice.webId}`)).toBeNull();
  await screen.findByText(`Shared with you as ${bob.webId}`);
  expect(dispose).toHaveBeenCalledOnce();
  expect(createPodNotificationSource).toHaveBeenLastCalledWith({
    webId: bob.webId,
    fetch: expect.any(Function),
  });
});

it("keeps children mounted and preserves unsaved state across session status changes", async () => {
  const view = render(tree());
  await screen.findByText(`Shared with you as ${alice.webId}`);
  fireEvent.change(screen.getByRole("textbox", { name: "Unsaved draft" }), {
    target: { value: "Unsaved text" },
  });
  for (const status of ["expired", "loading", "ready"] as const) {
    accounts.current = { ...accounts.current, status };
    view.rerender(tree());
    expect(mounts).toBe(1);
    expect((screen.getByRole("textbox", { name: "Unsaved draft" }) as HTMLInputElement).value).toBe(
      "Unsaved text",
    );
  }
  await screen.findByText(`Shared with you as ${alice.webId}`);
  expect(mounts).toBe(1);
});

it.each([
  "loading",
  "expired",
  "signed-out",
] satisfies SessionStatus[])("doesn't read a real pod while %s", async (status) => {
  accounts.current = { ...accounts.current, status };
  render(tree());
  await act(async () => {});
  expect(createPodNotificationSource).not.toHaveBeenCalled();
  expect(accounts.current.fetch).not.toHaveBeenCalled();
  expect(actions.items).toEqual([]);
});

it("doesn't create a pod source without a WebID", async () => {
  accounts.current = { ...accounts.current, active: { ...alice, webId: "" } };
  render(tree());
  await act(async () => {});
  expect(createPodNotificationSource).not.toHaveBeenCalled();
});

it("keeps demo's six synthetic items and four unread without reading a pod", async () => {
  accounts.current = {
    ...accounts.current,
    active: { ...alice, id: "pod-notifications-demo", kind: "demo" },
  };
  render(tree());
  await waitFor(() => expect(actions.items).toHaveLength(6));
  expect(actions.unread).toBe(4);
  expect(actions.items.find((item) => item.id === "demo-request")?.request).toBeDefined();
  expect(createPodNotificationSource).not.toHaveBeenCalled();
  expect(accounts.current.fetch).not.toHaveBeenCalled();
});

it.each([
  "solid",
  "demo",
] as const)("persists individual and all read flags when a %s notification session is recreated", async (kind) => {
  accounts.current = { ...accounts.current, active: { ...alice, kind } };
  let view = render(tree());
  await waitFor(() => expect(actions.unread).toBe(kind === "demo" ? 4 : 1));
  const item = actions.items[0];
  if (!item) throw new Error("Expected a notification");
  const id = item.id;
  await act(async () => {
    await actions.markRead(id);
    // Reconcile the source acknowledgement before recreating the controller.
    await actions.refresh();
  });
  view.unmount();
  view = render(tree());
  await waitFor(() => expect(actions.items.some((item) => item.id === id)).toBe(true));
  expect(actions.items.find((item) => item.id === id)?.read).toBe(true);
  expect(actions.unread).toBe(kind === "demo" ? 3 : 0);
  await act(async () => {
    await actions.markAllRead();
    await actions.refresh();
  });
  view.unmount();
  render(tree());
  await waitFor(() => expect(actions.items).toHaveLength(kind === "demo" ? 6 : 1));
  expect(actions.unread).toBe(0);
  expect(actions.items.every((item) => item.read)).toBe(true);
  expect(accounts.current.fetch).not.toHaveBeenCalled();
});

it("keeps local notifications available when the pod source fails", async () => {
  const local: SuiteNotification = {
    id: "local-pod-failure",
    kind: "storage",
    title: "Local storage update",
    createdAt: new Date(),
    read: false,
  };
  await addLocalNotification(alice.id, local);
  vi.mocked(createInboxReader).mockReturnValue({
    inbox: async () => {
      throw new Error("Pod offline");
    },
    list: vi.fn(),
    listPage: vi.fn(),
  });
  render(tree());
  await screen.findByText(local.title);
  expect(screen.getByTestId("error").textContent).toBe(
    "Couldn't load all notifications. Try again.",
  );
});
