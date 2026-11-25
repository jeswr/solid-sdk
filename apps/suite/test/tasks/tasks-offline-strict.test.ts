// AUTHORED-BY Claude Sonnet 5.5
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import type { TasksOffline } from "../../src/apps/tasks/state/offline";
import { TasksProvider, useTasks } from "../../src/apps/tasks/state/tasks-context";
import type { PodSession } from "../../src/lib/session/types";
import { h, mount } from "../drive-ui-dom";
import { Pod, storage, webId } from "./pod";

let captured: TasksOffline | undefined;
vi.mock("../../src/shell/sync/connection-state", () => ({ useConnectionState: () => "online" }));
vi.mock("../../src/shell/sync/outbox-session", () => ({ useOutboxSession: () => null }));
vi.mock("../../src/apps/tasks/state/offline-session", async (original) => {
  const real = await original<typeof import("../../src/apps/tasks/state/offline-session")>();
  return {
    ...real,
    useTasksOffline: (session: PodSession) => {
      const offline = real.useTasksOffline(session);
      captured = offline;
      return offline;
    },
  };
});

it("binds the Issues guard to the kept store under StrictMode", async () => {
  const pod = new Pod();
  const session: PodSession = {
    mode: "solid",
    webId,
    storageUrl: storage,
    displayName: "Alice",
    fetch: pod.fetch,
    publicFetch: pod.fetch,
    subscribe: () => () => {},
  };
  let store: { isIssueResource(url: string): boolean } | undefined;
  function Probe() {
    store = useTasks().cache.store as unknown as typeof store;
    return null;
  }
  await mount(h(StrictMode, null, h(TasksProvider, { session, children: h(Probe) })));
  if (!store || !captured) throw new Error("Missing store");
  const spy = vi.spyOn(store, "isIssueResource").mockReturnValue(true);
  expect(captured.direct("https://pod.test/alice/issues/1.ttl")).toBe(true);
  expect(spy).toHaveBeenCalledOnce();
});
