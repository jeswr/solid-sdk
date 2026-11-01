// AUTHORED-BY Codex GPT-6.1-Sol

import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  AgentWorkspaceProvider,
  type Query,
  useAgentQuery,
  useAgentWorkspace,
  type Workspace,
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
    mode: "demo",
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
    reset: async () => {},
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
