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
