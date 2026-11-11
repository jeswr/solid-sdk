// AUTHORED-BY Codex GPT-6.1-Sol
import type { InboxNotification } from "@jeswr/pod-access/notify";
import { beforeEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, h, mount } from "./drive-ui-dom";

const reader = vi.hoisted(() => ({ inbox: vi.fn(), list: vi.fn() }));
vi.mock("@jeswr/pod-access/notify", async (original) => ({
  ...(await original<object>()),
  createInboxReader: () => reader,
}));

import { sharedAccountKey } from "@jeswr/suite-sdk/shared";
import { setPreferencesIdentity, useTasksPreferences } from "../src/apps/tasks/state/preferences";
import { hideSharedForAccount } from "../src/lib/shared/hidden";
import { useSharedItems } from "../src/lib/shared/use-shared-items";

const note: InboxNotification = {
  url: "https://alice.example/inbox/1",
  type: "Announce",
  object: "https://bob.example/docs/plan.ttl",
  summary: "Shared with you as Editor",
  content: "Plan",
};
const makeSession = (webId: string): PodSession => ({
  mode: "demo",
  webId,
  storageUrl: "https://alice.example/",
  displayName: "Alice",
  fetch: vi.fn(),
  subscribe: () => () => {},
  reset: async () => {},
});
let session = makeSession("alice");
let result!: ReturnType<typeof useSharedItems>;
function Probe() {
  result = useSharedItems(session);
  return h("p", {}, result.items.map((item) => item.name).join(","));
}
beforeEach(() => {
  localStorage.clear();
  reader.inbox.mockReset().mockResolvedValue("https://alice.example/inbox/");
  reader.list.mockReset().mockResolvedValue([note]);
  session = makeSession("hook-alice");
});

it("merges inbox, Drive and Tasks sources and keeps hidden resources out", async () => {
  localStorage.setItem(
    `suite.drive.prefs.${session.webId}`,
    JSON.stringify({
      openedShared: [{ url: note.object, openedAt: "2026-11-11", name: "Rich name" }],
    }),
  );
  localStorage.setItem(
    `suite.tasks.shared:${encodeURIComponent(session.webId)}`,
    JSON.stringify([{ url: "https://bob.example/tasks/project.ttl", title: "Team tasks" }]),
  );
  const view = await mount(h(Probe));
  expect(result.items.map((item) => item.name)).toEqual(["Rich name", "Team tasks"]);
  expect(result.items[0]?.role).toBe("Editor");
  await act(async () => result.remove(note.object as string));
  expect(result.items.map((item) => item.name)).toEqual(["Team tasks"]);
  await view.unmount();
});

it("clears stale account data immediately and discards late success and failure", async () => {
  let resolve!: (notes: InboxNotification[]) => void;
  reader.list.mockReturnValueOnce(
    new Promise<InboxNotification[]>((done) => {
      resolve = done;
    }),
  );
  const view = await mount(h(Probe));
  expect(result.loading).toBe(true);
  session = makeSession("hook-bob");
  reader.list.mockResolvedValue([]);
  await view.render(h(Probe));
  expect(result.items).toEqual([]);
  await act(async () => resolve([note]));
  expect(result.items).toEqual([]);
  reader.list.mockRejectedValueOnce(new Error("Unavailable"));
  await act(async () => result.refresh());
  expect(result.error).toBe(true);
  expect(result.items).toEqual([]);
  reader.inbox.mockResolvedValueOnce(null);
  await act(async () => result.refresh());
  expect(result.error).toBe(false);
  expect(result.items).toEqual([]);
  await view.unmount();
});

it("filters storage refreshes to this WebID's Tasks and Drive keys", async () => {
  const view = await mount(h(Probe));
  const count = reader.inbox.mock.calls.length;
  for (const key of [
    "unrelated",
    "suite.drive.prefs.someone-else",
    "suite.tasks.shared:someone-else",
    null,
  ]) {
    await act(async () => window.dispatchEvent(new window.StorageEvent("storage", { key })));
  }
  expect(reader.inbox).toHaveBeenCalledTimes(count);
  for (const key of [
    `suite.drive.prefs.${session.webId}`,
    `suite.tasks.shared:${encodeURIComponent(session.webId)}`,
  ]) {
    await act(async () => window.dispatchEvent(new window.StorageEvent("storage", { key })));
  }
  expect(reader.inbox).toHaveBeenCalledTimes(count + 2);
  await view.unmount();
});
it("hides Tasks through its removal flow and a reopened project returns", async () => {
  const project = { url: "https://bob.example/tasks/team.ttl", title: "Team" };
  localStorage.setItem(
    `suite.tasks.shared:${encodeURIComponent(session.webId)}`,
    JSON.stringify([project]),
  );
  setPreferencesIdentity(session.webId);
  let preferences!: ReturnType<typeof useTasksPreferences>;
  function TasksProbe() {
    preferences = useTasksPreferences();
    return null;
  }
  const tasks = await mount(h(TasksProbe));
  const view = await mount(h(Probe));
  expect(result.items.some((item) => item.url === project.url)).toBe(true);
  await act(async () => result.remove(project.url));
  expect(preferences.preferences.sharedProjects).toEqual([]);
  expect(result.items.some((item) => item.url === project.url)).toBe(false);
  expect(JSON.parse(localStorage.getItem(sharedAccountKey(session.webId)) ?? "[]")).toContainEqual({
    url: project.url,
    hiddenAt: expect.any(String),
  });
  await act(async () => preferences.dispatch({ type: "sharedProject", ...project }));
  expect(result.items.some((item) => item.url === project.url)).toBe(true);
  expect(JSON.parse(localStorage.getItem(sharedAccountKey(session.webId)) ?? "[]")).toEqual([]);
  // A repeated dispatch also clears a hide even when the reducer preserves the list identity.
  await act(async () => hideSharedForAccount(session.webId, project.url));
  expect(result.items.some((item) => item.url === project.url)).toBe(false);
  await act(async () => preferences.dispatch({ type: "sharedProject", ...project }));
  expect(result.items.some((item) => item.url === project.url)).toBe(true);
  await view.unmount();
  await tasks.unmount();
  setPreferencesIdentity(undefined);
});
it("rejects a removal retained across session changes and a later reshare returns", async () => {
  const view = await mount(h(Probe));
  const retained = result.remove;
  const owner = session.webId;
  session = makeSession("shared-hook-other");
  await view.render(h(Probe));
  await act(async () => retained(note.object as string));
  expect(localStorage.getItem(sharedAccountKey(owner))).toBeNull();
  await act(async () => result.remove(note.object as string));
  expect(result.items).toEqual([]);
  reader.list.mockResolvedValue([
    { ...note, published: new Date(Date.now() + 60_000).toISOString() },
  ]);
  await act(async () => result.refresh());
  expect(result.items).toHaveLength(1);
  await view.unmount();
});
