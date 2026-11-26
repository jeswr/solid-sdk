// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  renderHook,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { DRIVE_TAG } from "../src/apps/drive/lib/offline/guards";
import { useDriveOutbox, useDriveReplay } from "../src/apps/drive/state/outbox";
import type { PodSession } from "../src/lib/session/pod-session";

const mocks = vi.hoisted(() => ({ outbox: null as unknown }));
vi.mock("@/shell/sync/outbox-session", () => ({ useOutboxSession: () => mocks.outbox }));

const WEBID = "https://pod.test/profile/card#me";
const STORAGE = "https://pod.test/";
const ROOT = "https://pod.test/drive/";
const session = (overrides: Partial<PodSession> = {}) =>
  ({ mode: "pod", webId: WEBID, storageUrl: STORAGE, ...overrides }) as PodSession;

function fakeOutbox(storage: object | null = { write: vi.fn() }) {
  let snapshot = { lastSyncedAt: null as number | null, pending: 0 };
  const listeners = new Set<() => void>();
  const offPolicy = vi.fn();
  const offDelegate = vi.fn();
  const outbox = {
    account: { webId: WEBID, storageUrl: STORAGE },
    storage,
    adapter: {
      reconnected: vi.fn(async () => {}),
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    registerGuardPolicy: vi.fn((_tag: string, _policy: unknown) => offPolicy),
    registerReplayDelegate: vi.fn((_tag: string, _factory: unknown) => offDelegate),
  };
  const emit = (next: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  mocks.outbox = outbox;
  return { outbox, emit, offPolicy, offDelegate, listeners };
}

afterEach(() => {
  cleanup();
  mocks.outbox = null;
});

it("offers the queueing storage only to the outbox account's own pod session", () => {
  expect(renderHook(() => useDriveOutbox(session())).result.current).toBeNull();
  const { outbox } = fakeOutbox();
  expect(renderHook(() => useDriveOutbox(session())).result.current).toBe(outbox.storage);
  for (const other of [
    session({ mode: "demo" }),
    session({ webId: "https://other.test/card#me" }),
    session({ storageUrl: "https://pod.test/other/" }),
  ])
    expect(renderHook(() => useDriveOutbox(other)).result.current).toBeNull();
  fakeOutbox(null);
  expect(renderHook(() => useDriveOutbox(session())).result.current).toBeNull();
});

it("registers Drive's policy and delegate for the matching session, replays, and removes them", () => {
  const { outbox, offPolicy, offDelegate } = fakeOutbox();
  const hook = renderHook(() => useDriveReplay(session(), ROOT, vi.fn()));
  expect(outbox.registerGuardPolicy.mock.calls.map(([tag]) => tag)).toEqual([DRIVE_TAG]);
  const policy = outbox.registerGuardPolicy.mock.calls[0]?.[1] as (r: object) => boolean;
  expect(policy({ op: "write", url: `${ROOT}a.txt` })).toBe(true);
  // Outside Drive's root, other apps' queued changes are not claimed.
  expect(policy({ op: "write", url: `${STORAGE}notes/a.txt` })).toBe(false);
  expect(outbox.registerReplayDelegate.mock.calls.map(([tag]) => tag)).toEqual([DRIVE_TAG]);
  expect(typeof outbox.registerReplayDelegate.mock.calls[0]?.[1]).toBe("function");
  // Items queued while Drive was closed replay once its delegate exists.
  expect(outbox.adapter.reconnected).toHaveBeenCalledOnce();
  hook.unmount();
  expect(offPolicy).toHaveBeenCalledOnce();
  expect(offDelegate).toHaveBeenCalledOnce();
});

it("waits for Drive's root before the policy, and replays only when online", () => {
  const { outbox } = fakeOutbox();
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const hook = renderHook(({ root }) => useDriveReplay(session(), root, vi.fn()), {
    initialProps: { root: undefined as string | undefined },
  });
  expect(outbox.registerGuardPolicy).not.toHaveBeenCalled();
  expect(outbox.registerReplayDelegate).toHaveBeenCalledOnce();
  expect(outbox.adapter.reconnected).not.toHaveBeenCalled();
  hook.rerender({ root: ROOT });
  expect(outbox.registerGuardPolicy).toHaveBeenCalledOnce();
  online.mockRestore();
});

it("survives a registration refused because the session ended", () => {
  const { outbox } = fakeOutbox();
  outbox.registerGuardPolicy.mockImplementation(() => {
    throw new Error("The outbox account is no longer active");
  });
  outbox.registerReplayDelegate.mockImplementation(() => {
    throw new Error("The outbox account is no longer active");
  });
  outbox.adapter.reconnected.mockRejectedValue(new Error("cancelled"));
  const hook = renderHook(() => useDriveReplay(session(), ROOT, vi.fn()));
  expect(outbox.registerGuardPolicy).toHaveBeenCalledOnce();
  hook.unmount();
});

it("registers the policy but no delegate while the outbox storage is still opening", () => {
  const { outbox } = fakeOutbox(null);
  renderHook(() => useDriveReplay(session(), ROOT, vi.fn()));
  expect(outbox.registerGuardPolicy).toHaveBeenCalledOnce();
  expect(outbox.registerReplayDelegate).not.toHaveBeenCalled();
});

it("registers nothing without an outbox, in demo mode, or for another account", () => {
  renderHook(() => useDriveReplay(session(), ROOT, vi.fn()));
  for (const other of [session({ mode: "demo" }), session({ webId: "https://x.test/#me" })]) {
    const { outbox, listeners } = fakeOutbox();
    renderHook(() => useDriveReplay(other, ROOT, vi.fn()));
    expect(outbox.registerGuardPolicy).not.toHaveBeenCalled();
    expect(outbox.registerReplayDelegate).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  }
});

it("refreshes the listing only when a replay completes", () => {
  const { emit, listeners } = fakeOutbox();
  const invalidate = vi.fn();
  const hook = renderHook(() => useDriveReplay(session(), ROOT, invalidate));
  act(() => emit({ pending: 1 }));
  expect(invalidate).not.toHaveBeenCalled();
  act(() => emit({ lastSyncedAt: 1 }));
  expect(invalidate).toHaveBeenCalledExactlyOnceWith(STORAGE);
  act(() => emit({ pending: 0 }));
  expect(invalidate).toHaveBeenCalledOnce();
  act(() => emit({ lastSyncedAt: 2 }));
  expect(invalidate).toHaveBeenCalledTimes(2);
  hook.unmount();
  expect(listeners.size).toBe(0);
});
