// AUTHORED-BY Codex GPT-6.1-Sol
import { type ReactNode, useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { ConnectionContext } from "../../src/shell/sync/connection-state";
import { act, click, h, mount } from "../drive-ui-dom";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let connection: "online" | "offline" = "offline";
const choose = vi.fn().mockResolvedValue(undefined);
const shareAdapter = vi.fn();
const conflict = {
  id: "conflict",
  itemId: "edit",
  url: "https://pod.test/alice/tasks/projects/inbox/task.ttl",
};
let conflicts: (typeof conflict)[] = [];
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/inbox",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("../../src/shell/sync/outbox-session", () => ({
  useOutboxSession: () => ({ outbox: {}, adapter: { resolve: choose } }),
}));
vi.mock("@jeswr/suite-sdk/offline", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useOutbox: () => ({
    pending: conflicts.length
      ? [{ id: "edit", guard: { tag: "tasks.intent.v1" }, label: "Local task", createdAt: 0 }]
      : [],
    conflicts,
  }),
}));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    inboxUrl: cache.inboxUrl,
    createTask: cache.createTask.bind(cache),
    updateTask: cache.updateTask.bind(cache),
    addSection: cache.addSection,
    shareAdapter,
  }),
}));

import { ShareProject } from "../../src/apps/tasks/components/share-project";
import { ProjectView } from "../../src/apps/tasks/components/views/project-view";
import { TasksConflicts } from "../../src/apps/tasks/state/offline-session";

function Offline({ children }: { children: ReactNode }) {
  return h(
    ConnectionContext,
    { value: { subscribe: () => () => {}, getSnapshot: () => connection } },
    children,
  );
}
beforeEach(() => {
  localStorage.clear();
  conflicts = [];
  connection = "offline";
  choose.mockClear();
  shareAdapter.mockClear();
});

it("renders cached task rows offline and the not-available-offline state for an uncached project", async () => {
  const f = await frameCache();
  cache = f.cache;
  await cache.createTask(f.inbox, { title: "Cached row" });
  const view = await mount(h(Offline, null, h(ProjectView, { inbox: true })));
  expect(view.host.textContent).toContain("Cached row");
  expect(view.host.textContent).not.toContain("Not available offline");
  await view.unmount();
  const missing = await mount(
    h(
      Offline,
      null,
      h(ProjectView, { projectUrl: "https://pod.test/alice/tasks/projects/uncached.ttl" }),
    ),
  );
  expect(missing.host.textContent).toContain("Not available offline");
});

it("explains why sharing is unavailable offline without opening a sharing adapter", async () => {
  const f = await frameCache();
  cache = f.cache;
  const view = await mount(
    h(Offline, null, h(ShareProject, { project: f.inbox, onClose: vi.fn() })),
  );
  expect(view.host.querySelector('[role="status"]')?.textContent).toBe(
    "Sharing needs a connection",
  );
  expect(shareAdapter).not.toHaveBeenCalled();
});

it.each([
  ["Keep mine", "mine"],
  ["Keep theirs", "theirs"],
  ["Keep both", "both"],
])("opens ConflictDialog and dispatches %s to the shell", async (label, choice) => {
  cache = (await frameCache()).cache;
  conflicts = [conflict];
  await mount(h(TasksConflicts, { cache }));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Title, due date or completion changed elsewhere",
  );
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => {
    click(button);
  });
  expect(choose).toHaveBeenCalledWith(conflict.id, choice);
});
