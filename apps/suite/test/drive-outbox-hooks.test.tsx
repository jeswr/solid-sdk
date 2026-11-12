// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  renderHook,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { DRIVE_FOLDER_TAG, DRIVE_TEXT_TAG } from "../src/apps/drive/lib/offline/guards";
import { useDriveOutbox, useDriveReplay } from "../src/apps/drive/state/outbox";
import type { PodSession } from "../src/lib/session/pod-session";

const mocks = vi.hoisted(() => ({ outbox: null as unknown }));
vi.mock("@/shell/sync/outbox-session", () => ({ useOutboxSession: () => mocks.outbox }));

const WEBID = "https://pod.test/profile/card#me";
const STORAGE = "https://pod.test/";
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

it("registers Drive's policies and delegates for the matching session and removes them", () => {
  const { outbox, offPolicy, offDelegate } = fakeOutbox();
  const invalidate = vi.fn();
  const hook = renderHook(() => useDriveReplay(session(), invalidate));
  expect(outbox.registerGuardPolicy.mock.calls.map(([tag]) => tag)).toEqual([
    DRIVE_FOLDER_TAG,
    DRIVE_TEXT_TAG,
  ]);
  const policy = outbox.registerGuardPolicy.mock.calls[1]?.[1] as (r: object) => boolean;
  expect(policy({ op: "write", url: `${STORAGE}a.txt` })).toBe(true);
  expect(policy({ op: "write", url: "https://elsewhere.test/a.txt" })).toBe(false);
  expect(outbox.registerReplayDelegate.mock.calls.map(([tag]) => tag)).toEqual([
    DRIVE_FOLDER_TAG,
    DRIVE_TEXT_TAG,
  ]);
  expect(typeof outbox.registerReplayDelegate.mock.calls[0]?.[1]).toBe("function");
  hook.unmount();
  expect(offPolicy).toHaveBeenCalledTimes(2);
  expect(offDelegate).toHaveBeenCalledTimes(2);
});

it("registers policies but no delegates while the outbox storage is still opening", () => {
  const { outbox } = fakeOutbox(null);
  renderHook(() => useDriveReplay(session(), vi.fn()));
  expect(outbox.registerGuardPolicy).toHaveBeenCalledTimes(2);
  expect(outbox.registerReplayDelegate).not.toHaveBeenCalled();
});

it("registers nothing without an outbox, in demo mode, or for another account", () => {
  renderHook(() => useDriveReplay(session(), vi.fn()));
  for (const other of [session({ mode: "demo" }), session({ webId: "https://x.test/#me" })]) {
    const { outbox, listeners } = fakeOutbox();
    renderHook(() => useDriveReplay(other, vi.fn()));
    expect(outbox.registerGuardPolicy).not.toHaveBeenCalled();
    expect(outbox.registerReplayDelegate).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  }
});

it("refreshes the listing only when a replay completes", () => {
  const { emit, listeners } = fakeOutbox();
  const invalidate = vi.fn();
  const hook = renderHook(() => useDriveReplay(session(), invalidate));
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
