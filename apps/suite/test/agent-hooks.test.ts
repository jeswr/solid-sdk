// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { useDaemonStatus } from "../src/apps/agent/components/status-pill";
import {
  AgentWorkspaceProvider,
  noticeAffects,
  type Query,
  STATUS_REFRESH_MS,
  useAgentInvalidate,
  useAgentQuery,
  useAgentWorkspace,
  type Workspace,
  writtenUrl,
} from "../src/apps/agent/lib/hooks";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";

const BASE = `${DEMO_ROOT}agent/`;
async function session() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const listeners = new Set<(url: string) => void>();
  const session: PodSession = {
    mode: "solid",
    publicFetch: pod.fetch,
    webId: DEMO_WEBID,
    displayName: "Alice",
    storageUrl: DEMO_ROOT,
    fetch: pod.fetch,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    session,
    listeners,
    emit: (url: string) => {
      for (const listener of listeners) listener(url);
    },
  };
}
async function until(condition: () => boolean) {
  for (let attempt = 0; !condition() && attempt < 100; attempt++)
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  expect(condition()).toBe(true);
}
afterEach(() => vi.useRealTimers());
it("requires workspace context", () => {
  function Probe() {
    useAgentWorkspace();
    return null;
  }
  expect(() => renderToString(h(Probe))).toThrow("not ready");
});
it("discovers, retries discovery failure and fences late completion on unmount", async () => {
  const fixture = await session();
  let workspace: Workspace | undefined;
  let fallback: Query<Workspace> | undefined;
  let fail = true;
  const active = {
    ...fixture.session,
    fetch: (async (input, init) =>
      fail
        ? new Response(null, { status: 403 })
        : fixture.session.fetch(input, init)) as typeof fetch,
  };
  function Probe() {
    workspace = useAgentWorkspace();
    return h("span", {}, workspace.client.workspace);
  }
  const view = await mount(
    h(AgentWorkspaceProvider, {
      session: active,
      children: h(Probe),
      fallback: (query) => {
        fallback = query;
        return h("span", {}, query.status);
      },
    }),
  );
  await until(() => fallback?.status === "error");
  fail = false;
  await act(() => fallback?.reload());
  await until(() => workspace !== undefined);
  expect(workspace?.client.workspace).toBe(BASE);
  await view.unmount();
  for (const succeeds of [true, false]) {
    const pending = deferred<Response>();
    let reachedIndex = false;
    const delayed = {
      ...fixture.session,
      fetch: (async (input, init) => {
        if (String(input).includes("privateTypeIndex")) {
          reachedIndex = true;
          return pending.promise;
        }
        return fixture.session.fetch(input, init);
      }) as typeof fetch,
    };
    const stale = await mount(
      h(AgentWorkspaceProvider, { session: delayed, children: h(Probe), fallback: () => null }),
    );
    await until(() => reachedIndex);
    await stale.unmount();
    await act(async () => {
      if (succeeds)
        pending.resolve(await fixture.session.fetch(`${DEMO_ROOT}settings/privateTypeIndex.ttl`));
      else pending.reject(new Error("late failure"));
    });
  }
});
it("refreshes on relevant notifications, retries errors and rejects stale query completions", async () => {
  const fixture = await session();
  let current: Query<string> | undefined;
  let key = `${BASE}accounts`;
  let pending = deferred<string>();
  const loader = vi.fn(() => pending.promise);
  function Probe() {
    current = useAgentQuery(key, loader);
    return h("span", {}, current.status);
  }
  const tree = () =>
    h(AgentWorkspaceProvider, {
      session: fixture.session,
      children: h(Probe),
      fallback: () => null,
    });
  const view = await mount(tree());
  await until(() => loader.mock.calls.length === 1);
  expect(current?.status).toBe("loading");
  await act(() => pending.resolve("first"));
  expect(current).toMatchObject({ status: "ready", data: "first" });
  vi.useFakeTimers();
  await act(() => fixture.emit(`${BASE}accountsmith/a.ttl`));
  await act(() => vi.advanceTimersByTime(200));
  expect(loader).toHaveBeenCalledTimes(1);
  const staleSuccess = deferred<string>();
  pending = staleSuccess;
  await act(() => current?.reload());
  expect(current?.status).toBe("loading");
  await act(() => {
    fixture.emit(`${BASE}accounts/a.ttl`);
    fixture.emit(`${BASE}accounts/b.ttl`);
  });
  pending = deferred<string>();
  await act(() => vi.advanceTimersByTime(150));
  await act(() => staleSuccess.resolve("stale"));
  expect(current?.status).toBe("loading");
  await act(() => pending.reject(new Error("read failed")));
  expect(current?.status).toBe("error");
  pending = deferred<string>();
  await act(() => current?.reload());
  await act(() => pending.resolve("retry"));
  expect(current).toMatchObject({ status: "ready", data: "retry" });
  const supersededError = deferred<string>();
  pending = supersededError;
  await act(() => current?.reload());
  await act(() => fixture.emit(`${BASE}accounts/a.ttl`));
  pending = deferred<string>();
  await act(() => vi.advanceTimersByTime(150));
  await act(() => supersededError.reject(new Error("superseded error")));
  expect(current?.status).toBe("loading");
  await act(() => pending.resolve("after notification"));
  // Change the resource key; a former query's data must not render for the next key.
  const staleError = deferred<string>();
  pending = staleError;
  await act(() => current?.reload());
  pending = deferred<string>();
  key = `${BASE}proposals/`;
  await view.render(tree());
  await act(() => staleError.reject(new Error("old error")));
  expect(current?.status).toBe("loading");
  await act(() => pending.resolve("new resource"));
  expect(current).toMatchObject({ status: "ready", data: "new resource" });
  pending = deferred<string>();
  await act(() => {
    fixture.emit(`${BASE}proposals/`);
    fixture.emit(`${BASE}proposals/a.ttl`);
  });
  await act(() => vi.advanceTimersByTime(150));
  expect(current?.status).toBe("loading");
  await view.unmount();
  await act(() => pending.resolve("after unmount"));
  expect(fixture.listeners.size).toBe(0);
});
it("reloads when the account session changes and unsubscribes the previous one", async () => {
  const first = await session();
  const second = await session();
  let current: Query<string> | undefined;
  let currentSession = first.session;
  function Probe() {
    const workspace = useAgentWorkspace();
    current = useAgentQuery(BASE, async () => workspace.session.displayName);
    return null;
  }
  const tree = () =>
    h(AgentWorkspaceProvider, {
      session: currentSession,
      children: h(Probe),
      fallback: () => null,
    });
  const view = await mount(tree());
  await until(() => current?.status === "ready");
  currentSession = { ...second.session, displayName: "Another session" };
  await view.render(tree());
  await until(() => current?.status === "ready" && current.data === "Another session");
  expect(first.listeners.size).toBe(0);
  expect(second.listeners.size).toBe(1);
  await view.unmount();
});
it("treats a container notice as covering everything inside it, on path boundaries", () => {
  const key = `${BASE}proposals/`;
  expect(noticeAffects(key, key)).toBe(true);
  expect(noticeAffects(`${key}a.ttl`, key)).toBe(true);
  expect(noticeAffects(DEMO_ROOT, key)).toBe(true);
  expect(noticeAffects(BASE, key)).toBe(true);
  expect(noticeAffects(`${BASE}prop/`, key)).toBe(false);
  expect(noticeAffects(`${DEMO_ROOT}age`, key)).toBe(false);
  expect(noticeAffects(`${BASE}approvals/`, key)).toBe(false);
  expect(noticeAffects(`${BASE}heartbeat.ttl`, `${BASE}heartbeat`)).toBe(false);
  expect(noticeAffects(`${BASE}control/x.ttl`, `${BASE}control`)).toBe(true);
});
/** Waits in real time, for assertions behind the 150 ms notice debounce. */
async function eventually(condition: () => boolean) {
  for (let attempt = 0; !condition() && attempt < 100; attempt++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  expect(condition()).toBe(true);
}
it("refreshes on the storage-root focus notice, on its own writes, and quietly on a poll", async () => {
  const fixture = await session();
  let current: Query<number> | undefined;
  let invalidate: ((url: string, quiet?: boolean) => void) | undefined;
  let reads = 0;
  let failNext = false;
  let slow = false;
  const seen: string[] = [];
  function Probe() {
    const { client } = useAgentWorkspace();
    invalidate = useAgentInvalidate();
    current = useAgentQuery(`${BASE}control/`, async () => {
      if (failNext) {
        failNext = false;
        throw new Error("transient");
      }
      // A slow read lets the loading state render before the data arrives.
      if (slow) await new Promise((resolve) => setTimeout(resolve, 30));
      return ++reads;
    });
    seen.push(current.status);
    return h("button", {
      type: "button",
      onClick: () =>
        void client.create(`${BASE}control/new.ttl`, "<#a> <#b> <#c> .", "text/turtle"),
    });
  }
  const view = await mount(
    h(AgentWorkspaceProvider, {
      session: fixture.session,
      children: h(Probe),
      fallback: () => null,
    }),
  );
  await eventually(() => current?.status === "ready" && current.data === 1);
  // The extension announces only its storage root when the window regains focus.
  await act(() => fixture.emit(DEMO_ROOT));
  await eventually(() => current?.status === "ready" && current.data === 2);
  // A successful write through the workspace client announces itself, with no pod notice.
  fixture.listeners.clear();
  await act(async () => view.host.querySelector("button")?.click());
  await eventually(() => current?.status === "ready" && current.data === 3);
  // A quiet poll re-reads its exact key without dropping the ready data.
  seen.length = 0;
  await act(() => invalidate?.(`${BASE}control/`, true));
  await eventually(() => current?.status === "ready" && current.data === 4);
  expect(seen).not.toContain("loading");
  // A failed quiet poll keeps the data on screen.
  failNext = true;
  await act(() => invalidate?.(`${BASE}control/`, true));
  await eventually(() => !failNext);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(current).toMatchObject({ status: "ready", data: 4 });
  // A loud notice keeps its loading state even if a quiet poll lands inside the debounce.
  seen.length = 0;
  slow = true;
  await act(() => {
    invalidate?.(DEMO_ROOT);
    invalidate?.(`${BASE}control/`, true);
  });
  await eventually(() => current?.status === "ready" && current.data === 5);
  expect(seen).toContain("loading");
  slow = false;
  // A quiet poll never fans out: a notice for something inside the key is ignored.
  await act(() => invalidate?.(`${BASE}control/heartbeat.ttl`, true));
  // A sibling container's notice leaves the query alone.
  await act(() => invalidate?.(`${BASE}approvals/`));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(current).toMatchObject({ status: "ready", data: 5 });
  await view.unmount();
});
it("polls daemon status on an interval without a pod notice", async () => {
  const fixture = await session();
  let status: ReturnType<typeof useDaemonStatus> | undefined;
  const statuses: string[] = [];
  const io = vi.fn(fixture.session.fetch);
  function Probe() {
    status = useDaemonStatus();
    statuses.push(status.query.status);
    return null;
  }
  // Only the poll interval is faked; the 150 ms notice debounce runs in real time.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const view = await mount(
    h(AgentWorkspaceProvider, {
      session: { ...fixture.session, fetch: io, subscribe: () => () => {} },
      children: h(Probe),
      fallback: () => null,
    }),
  );
  await eventually(() => status?.query.status === "ready");
  const heartbeatReads = () =>
    io.mock.calls.filter(([url]) => String(url) === `${BASE}control/heartbeat.ttl`).length;
  const before = heartbeatReads();
  statuses.length = 0;
  // Hidden tabs skip the poll.
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(() => vi.advanceTimersByTime(STATUS_REFRESH_MS));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  expect(heartbeatReads()).toBe(before);
  visibility.mockReturnValue("visible");
  await act(() => vi.advanceTimersByTime(STATUS_REFRESH_MS));
  await eventually(() => heartbeatReads() > before && status?.query.status === "ready");
  expect(statuses).not.toContain("loading");
  // Showing the tab again polls at once.
  const shown = heartbeatReads();
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  await eventually(() => heartbeatReads() > shown);
  visibility.mockRestore();
  await view.unmount();
});
it("announces only successful writes, whatever form the request takes", () => {
  const ok = new Response(null, { status: 201 });
  const url = `${BASE}control/a.ttl`;
  expect(writtenUrl(url, { method: "PUT" }, ok)).toBe(url);
  expect(writtenUrl(new URL(url), { method: "delete" }, ok)).toBe(url);
  expect(writtenUrl(new Request(url, { method: "POST" }), { method: "POST" }, ok)).toBe(url);
  expect(writtenUrl(new Request(url, { method: "PUT" }), undefined, ok)).toBe(url);
  expect(writtenUrl(url, undefined, ok)).toBeUndefined();
  expect(writtenUrl(url, { method: "HEAD" }, ok)).toBeUndefined();
  expect(writtenUrl(url, { method: "PUT" }, new Response(null, { status: 412 }))).toBeUndefined();
});
it("keeps the credentialed read for an extension profile inside the storage", async () => {
  const fixture = await session();
  const publicFetch = vi.fn(fixture.session.fetch);
  let workspace: Workspace | undefined;
  function Probe() {
    workspace = useAgentWorkspace();
    return null;
  }
  const extension = {
    ...fixture.session,
    mode: "extension",
    publicFetch,
    disconnect: async () => {},
  } as unknown as PodSession;
  const view = await mount(
    h(AgentWorkspaceProvider, { session: extension, children: h(Probe), fallback: () => null }),
  );
  await until(() => Boolean(workspace));
  expect(workspace?.client.workspace).toBe(BASE);
  // The profile is inside the granted storage, so the public fetch is not needed.
  expect(publicFetch).not.toHaveBeenCalled();
  await view.unmount();
});
