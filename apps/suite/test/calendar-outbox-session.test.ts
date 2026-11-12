// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox, withOutbox } from "@jeswr/suite-sdk/offline";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import type { useOutboxSession } from "../src/shell/sync/outbox-session";
import { act, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  pod: undefined as PodSession | undefined,
  outbox: null as ReturnType<typeof useOutboxSession>,
}));
vi.mock("@/lib/session/pod-session", () => ({
  usePodSessionState: () => ({ status: "ready", session: mocks.pod }),
}));
vi.mock("@/shell/sync/outbox-session", () => ({ useOutboxSession: () => mocks.outbox }));

import {
  CalendarProvider,
  useCalendarState,
  useEventMutations,
} from "../src/apps/calendar/state/calendar-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

const boxes: ReturnType<typeof createOutbox>[] = [];
let api: ReturnType<typeof useEventMutations>;
let ready = false;
let state: ReturnType<typeof useCalendarState>;
function Probe() {
  api = useEventMutations();
  state = useCalendarState();
  ready = state.calendars.status === "ready";
  return null;
}
const tree = () => h(StrictMode, null, h(CalendarProvider, { children: h(Probe) }));
async function fixture(webId = DEMO_WEBID) {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.UTC(2026, 10, 1)) });
  const transport = vi.fn<typeof globalThis.fetch>((input, init) => pod.fetch(input, init));
  const controller = new AbortController();
  const outbox = createOutbox({ webId });
  boxes.push(outbox);
  const storage = createMemoryStorage({ root: DEMO_ROOT, protocol: "solid" });
  const registerGuardPolicy = vi.fn(outbox.registerGuardPolicy);
  const registerReplayDelegate = vi.fn<
    NonNullable<ReturnType<typeof useOutboxSession>>["registerReplayDelegate"]
  >((tag, factory) =>
    outbox.registerDelegate(
      tag,
      factory({
        fetch: transport,
        webId,
        storageUrl: DEMO_ROOT,
        storage,
        signal: controller.signal,
      }),
    ),
  );
  const session = {
    account: { webId },
    outbox,
    adapter: { reconnected: vi.fn().mockResolvedValue(undefined) },
    storage: null,
    signal: controller.signal,
    registerReplayDelegate,
    registerGuardPolicy,
  } as unknown as NonNullable<ReturnType<typeof useOutboxSession>>;
  const account: PodSession = {
    mode: "solid",
    webId,
    displayName: "Alice",
    storageUrl: DEMO_ROOT,
    fetch: transport,
    publicFetch: transport,
    subscribe: () => () => {},
  };
  return {
    session,
    account,
    controller,
    outbox,
    storage,
    registerReplayDelegate,
    registerGuardPolicy,
    pod,
    transport,
  };
}
afterEach(() => {
  for (const box of boxes.splice(0)) box.close();
  mocks.outbox = null;
  ready = false;
  vi.restoreAllMocks();
});
it("registers only after discovery and storage opening, re-registers after remount, and refuses a foreign identity", async () => {
  const f = await fixture();
  mocks.pod = f.account;
  mocks.outbox = f.session;
  const view = await mount(tree());
  await vi.waitFor(() => expect(ready).toBe(true));
  expect(f.registerReplayDelegate).not.toHaveBeenCalled();
  await expect(
    api.create(`${DEMO_ROOT}calendar/work/opening.ttl`, { name: "Early", start: "2026-11-01" }),
  ).rejects.toThrow("storage is still opening");
  f.session.storage = withOutbox(f.storage, f.outbox);
  await view.render(tree());
  expect(f.registerReplayDelegate).toHaveBeenCalledOnce();
  expect(f.registerGuardPolicy).toHaveBeenCalledOnce();
  expect(f.session.adapter.reconnected).toHaveBeenCalledOnce();
  await act(() =>
    f.outbox.enqueue({
      op: "write",
      url: `${DEMO_ROOT}calendar/work/e.ttl`,
      contentType: "application/json",
      body: "{}",
      guard: { tag: "calendar.event-v1" },
    }),
  );
  await view.unmount();
  expect(f.outbox.pending()[0]?.blocked).toBe("no-delegate");
  const again = await mount(tree());
  await vi.waitFor(() => expect(f.registerReplayDelegate).toHaveBeenCalledTimes(2));
  const other = await fixture(`${DEMO_ROOT}bob#me`);
  other.session.storage = withOutbox(other.storage, other.outbox);
  mocks.outbox = other.session;
  await again.render(tree());
  expect(other.registerReplayDelegate).not.toHaveBeenCalled();
  await again.unmount();
});

it("shows and reloads conflicts found while checking a prerequisite, and ignores retired discovery state", async () => {
  const f = await fixture();
  mocks.pod = f.account;
  mocks.outbox = f.session;
  f.session.storage = withOutbox(f.storage, f.outbox);
  const view = await mount(tree());
  await vi.waitFor(() => expect(f.registerReplayDelegate).toHaveBeenCalledOnce());
  const matcher = f.registerGuardPolicy.mock.calls[0]?.[1];
  expect(matcher?.({ op: "write", url: `${DEMO_ROOT}outside/e.ttl` })).toBe(false);
  const { eventIntent } = await import("../src/apps/calendar/state/event-channel");
  const target = `${DEMO_ROOT}calendar/work/absent.ttl`;
  await act(() =>
    f.outbox.enqueue({
      op: "write",
      url: target,
      contentType: "application/json",
      body: JSON.stringify(
        eventIntent({ kind: "delete", url: target, etag: "" }, undefined, {
          name: "Prior",
          start: "2026-11-01",
        }),
      ),
      guard: { tag: "calendar.event-v1" },
    }),
  );
  const revision = state.revision;
  await act(() => f.outbox.replay(f.storage));
  await vi.waitFor(() => expect(state.revision).toBeGreaterThan(revision));
  expect(f.outbox.conflicts()).toHaveLength(1);
  await f.pod.fetch(`${DEMO_ROOT}profile/card`, {
    method: "PUT",
    body: "invalid Turtle",
    headers: { "Content-Type": "text/turtle" },
  });
  await act(() => state.reload());
  await vi.waitFor(() => expect(state.calendars.status).toBe("error"));
  expect(matcher?.({ op: "write", url: `${DEMO_ROOT}outside/e.ttl` })).toBe(false);
  await view.unmount();
});
it("waits for reconnect while offline and tolerates replay failures after registration", async () => {
  const f = await fixture();
  mocks.pod = f.account;
  mocks.outbox = f.session;
  f.session.storage = withOutbox(f.storage, f.outbox);
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const view = await mount(tree());
  await vi.waitFor(() => expect(f.registerReplayDelegate).toHaveBeenCalledOnce());
  await act(async () => {
    await Promise.resolve();
  });
  expect(f.session.adapter.reconnected).not.toHaveBeenCalled();
  await view.unmount();
  online.mockRestore();
  f.session.adapter.reconnected = vi.fn().mockRejectedValue(new Error("replay unavailable"));
  const next = await mount(tree());
  await vi.waitFor(() => expect(f.session.adapter.reconnected).toHaveBeenCalled());
  await next.unmount();
});

it("handles a failed active save when reconnect recovery is requested at the same time", async () => {
  const f = await fixture();
  mocks.pod = f.account;
  mocks.outbox = f.session;
  const original = f.pod.fetch;
  let finish!: () => void;
  f.transport.mockImplementation(async (input, init) => {
    if (init?.method === "PUT")
      return new Promise<Response>((resolve) => {
        finish = () => resolve(new Response(null, { status: 500 }));
      });
    return original(input, init);
  });
  f.session.storage = withOutbox(f.storage, f.outbox);
  const view = await mount(tree());
  await vi.waitFor(() => expect(f.registerReplayDelegate).toHaveBeenCalledOnce());
  const task = api.create(`${DEMO_ROOT}calendar/work/failed.ttl`, {
    name: "Failure",
    start: "2026-11-01",
  });
  const rejected = expect(task).rejects.toThrow("500");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(() => window.dispatchEvent(new Event("online")));
  await act(async () => {
    finish();
    await rejected;
  });
  await view.unmount();
});
