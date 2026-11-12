// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { StatusPill, useDaemonStatus } from "../src/apps/agent/components/status-pill";
import { AgentReadError, createAgentClient } from "../src/apps/agent/lib/client";
import {
  DEMO_HEARTBEAT_MS,
  isDemoAgentSession,
  startDemoAgent,
} from "../src/apps/agent/lib/demo-agent";
import { AgentWorkspaceProvider } from "../src/apps/agent/lib/hooks";
import { readHeartbeat } from "../src/apps/agent/lib/readers";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";

vi.mock("../src/apps/agent/components/approval-key-setup-sheet", () => ({
  useApprovalDevice: () => ({ requireKey: vi.fn() }),
}));

const NOW = Date.parse("2026-11-01T12:00:00Z");
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function until(condition: () => boolean) {
  for (let i = 0; i < 300; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });
    if (condition()) return;
  }
  expect(condition()).toBe(true);
}
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW - 600_000) });
  const io = vi.fn(pod.fetch);
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: "Alice",
    fetch: io,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const client = createAgentClient({
    fetch: io,
    storage: DEMO_ROOT,
    workspace: `${DEMO_ROOT}agent/`,
  });
  return { pod, session, client, io };
}
const writes = (io: ReturnType<typeof vi.fn<typeof fetch>>) =>
  io.mock.calls.filter(([, init]) => init?.method === "PUT");

it("refreshes a stale demo heartbeat through the workspace and stops on session switch/unmount", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  let status: ReturnType<typeof useDaemonStatus> | undefined;
  function Probe() {
    status = useDaemonStatus();
    return h(StatusPill, { status });
  }
  const tree = (session: PodSession) =>
    h(AgentWorkspaceProvider, { session, children: h(Probe), fallback: () => null });
  const view = await mount(tree(f.session));
  await until(() => Boolean(view.host.textContent?.includes("Agent running")));
  expect(view.host.textContent).toContain("Demo agent");
  expect(
    view.host.querySelector('button[aria-label="Agent status: Agent running (demo)"]'),
  ).not.toBeNull();
  for (let tick = 0; tick < 4; tick++) {
    await act(() => vi.advanceTimersByTime(DEMO_HEARTBEAT_MS));
    await until(() => writes(f.io).length === tick + 2);
    await until(() => status?.lastSeen === new Date(Date.now()).toISOString());
    expect(status?.state).toBe("running");
  }
  const realIo = vi.fn(f.pod.fetch);
  const real: PodSession = { ...f.session, mode: "solid", fetch: realIo, publicFetch: realIo };
  await view.render(tree(real));
  await until(() => Boolean(view.host.textContent?.includes("Agent running")));
  expect(view.host.textContent).not.toContain("Demo agent");
  const before = writes(f.io).length;
  await act(() => vi.advanceTimersByTime(DEMO_HEARTBEAT_MS * 3));
  expect(writes(realIo)).toHaveLength(0);
  expect(writes(f.io)).toHaveLength(before);
  expect(new Set(writes(f.io).map(([url]) => url))).toEqual(new Set([f.client.paths.heartbeat]));
  expect(view.host.textContent).toContain("Agent offline");
  await view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("does no I/O for real sessions, mismatched demo identities, pods or workspaces", async () => {
  const f = await fixture();
  for (const session of [
    { ...f.session, mode: "solid", publicFetch: f.io },
    { ...f.session, mode: "extension", publicFetch: f.io, disconnect: async () => {} },
    { ...f.session, storageUrl: "https://real.example/" },
    { ...f.session, webId: "https://real.example/profile#me" },
  ] as PodSession[]) {
    expect(isDemoAgentSession(session)).toBe(false);
    startDemoAgent(session, f.client)();
  }
  startDemoAgent(f.session, { ...f.client, workspace: "https://real.example/agent/" })();
  expect(f.io).not.toHaveBeenCalled();
});

it("recreates missing heartbeats, uses conditional writes, and retries failed reads/writes", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  const f = await fixture();
  const graph = vi.spyOn(f.client, "graph");
  graph.mockRejectedValueOnce(new AgentReadError(404));
  const create = vi.spyOn(f.client, "create").mockResolvedValueOnce(null);
  const stop = startDemoAgent(f.session, f.client);
  await until(() => create.mock.calls.length === 1);
  expect(create.mock.calls[0]?.[0]).toBe(f.client.paths.heartbeat);
  const replace = vi.spyOn(f.client, "replace");
  await act(() => vi.advanceTimersByTime(DEMO_HEARTBEAT_MS));
  await until(() => replace.mock.calls.length === 1);
  expect(replace.mock.calls[0]?.[2]).toBeTruthy();
  const doc = await f.client.graph(f.client.paths.heartbeat);
  for (const error of [new Error("offline"), new AgentReadError(403)]) {
    graph.mockRejectedValueOnce(error);
    await act(() => vi.advanceTimersByTime(DEMO_HEARTBEAT_MS));
    await until(() => graph.mock.results.at(-1)?.type === "return");
  }
  graph.mockResolvedValueOnce({ ...doc, etag: null });
  await act(() => vi.advanceTimersByTime(DEMO_HEARTBEAT_MS));
  await until(() => graph.mock.results.at(-1)?.type === "return");
  expect(replace).toHaveBeenCalledTimes(1);
  graph.mockRejectedValueOnce(new AgentReadError(410));
  await act(() => document.dispatchEvent(new Event("visibilitychange")));
  await until(() => create.mock.calls.length === 2);
  // The real create conflicts with the existing heartbeat; the next refresh still succeeds.
  await act(() => vi.advanceTimersByTime(DEMO_HEARTBEAT_MS));
  await until(() => replace.mock.calls.length === 2);
  stop();
});

it("coalesces concurrent refreshes, skips hidden focus, and fences a late read after cleanup", async () => {
  const f = await fixture();
  const pending = deferred<Awaited<ReturnType<typeof f.client.graph>>>();
  const documentValue = await f.client.graph(f.client.paths.heartbeat);
  const graph = vi.spyOn(f.client, "graph").mockReturnValueOnce(pending.promise);
  const stop = startDemoAgent(f.session, f.client);
  const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  hidden.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(graph).toHaveBeenCalledTimes(1);
  stop();
  pending.resolve(documentValue);
  await until(() => writes(f.io).length === 0);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(writes(f.io)).toHaveLength(0);
  expect((await readHeartbeat(f.client))[0]).toBeDefined();
});
