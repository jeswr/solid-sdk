// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { h, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let pathname = "/tasks/inbox";
let cache: TasksCache;
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/refs", async () => import("../../src/lib/refs"));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: { webId } }),
}));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ actions, children }: { actions: ReactNode; children: ReactNode }) =>
    h("div", null, h("header", null, actions), h("main", null, children)),
}));
vi.mock("../../src/apps/tasks/components/sidebar", () => ({ TasksSidebar: () => null }));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  TasksProvider: ({ children }: { children: ReactNode }) => children,
  useTasks: () => ({ ...cache.getSnapshot(), cache }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
}));

import { TasksApp } from "../../src/apps/tasks/components/tasks-app";

beforeEach(async () => {
  localStorage.clear();
  cache = (await frameCache()).cache;
});

it.each([
  "/tasks/completed",
  "/tasks/today",
  "/tasks/upcoming",
  "/tasks/l/bills",
])("shows view options on %s", async (path) => {
  pathname = path;
  const { host } = await mount(h(TasksApp, null, "View content"));
  expect(host.querySelector(".tsk-sort")).not.toBeNull();
  expect(host.querySelector("main")?.textContent).toBe("View content");
});

it.each([
  "/tasks/inbox",
  "/tasks/p/aHR0cHM6Ly9hbGljZS5leGFtcGxlL2hvbWUudHRs",
])("keeps the saved sort control on %s", async (path) => {
  pathname = path;
  localStorage.setItem("suite.tasks.prefs", JSON.stringify({ sort: { [path]: "priority" } }));
  const { host } = await mount(h(TasksApp, null, "View content"));
  expect(host.querySelector(".tsk-sort")?.textContent).toBe("Sort: Priority");
});
