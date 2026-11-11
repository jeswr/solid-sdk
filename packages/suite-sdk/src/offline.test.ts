// AUTHORED-BY Codex GPT-6.1-Sol
import type { StorageClient } from "@jeswr/storage-client";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { type Outbox, type UseOutboxResult, useOutbox } from "./offline.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let state: UseOutboxResult;
let renders = 0;
function Probe({ outbox }: { outbox: Outbox | null }) {
  state = useOutbox(outbox);
  renders++;
  return null;
}
async function render(outbox: Outbox | null) {
  if (!root) root = createRoot(document.createElement("div"));
  const mounted = root;
  await act(() =>
    mounted.render(createElement(StrictMode, null, createElement(Probe, { outbox }))),
  );
}
function fake() {
  let pending: ReturnType<Outbox["pending"]> = [];
  let conflicts: ReturnType<Outbox["conflicts"]> = [];
  const listeners = { change: new Set<() => void>(), conflict: new Set<() => void>() };
  const outbox: Outbox = {
    webId: "https://pod.example/me",
    ready: Promise.resolve(),
    pending: () => [...pending],
    conflicts: () => [...conflicts],
    enqueue: vi.fn(),
    localBody: vi.fn(),
    replay: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(undefined),
    purge: vi.fn(),
    close: vi.fn(),
    on(event, listener) {
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },
  };
  return {
    outbox,
    listeners,
    setPending() {
      pending = [
        {
          id: "p",
          op: "write",
          url: "https://pod.example/a",
          size: 3,
          createdAt: 1,
          status: "waiting",
        },
      ];
    },
    conflict() {
      conflicts = [
        {
          id: "c",
          itemId: "p",
          url: "https://pod.example/a",
          kind: "binary",
          localEtag: "old",
          remoteEtag: "new",
          contentType: "text/plain",
        },
      ];
      for (const listener of listeners.conflict) listener();
    },
    change() {
      for (const listener of listeners.change) listener();
    },
  };
}
afterEach(async () => {
  if (root) {
    const mounted = root;
    await act(() => mounted.unmount());
  }
  root = undefined;
});

test("null is empty, stable and every action is inert", async () => {
  await render(null);
  const previous = state;
  await render(null);
  expect(state).toBe(previous);
  expect(state.pending).toEqual([]);
  expect(state.conflicts).toEqual([]);
  const storage = {} as StorageClient;
  await state.retry("p");
  await state.retryAll();
  await state.resolve("c", "both");
  await state.replay(storage);
});

test("reads fresh initial state, subscribes to both events and keeps snapshots stable between events", async () => {
  const f = fake();
  f.setPending();
  await render(f.outbox);
  expect(state.pending[0]?.id).toBe("p");
  expect(f.listeners.change.size).toBe(1);
  expect(f.listeners.conflict.size).toBe(1);
  const previous = state;
  const before = renders;
  await render(f.outbox);
  expect(state).toBe(previous);
  expect(renders - before).toBeLessThan(4);
  await act(() => f.conflict());
  expect(state.conflicts[0]?.id).toBe("c");
  await act(() => f.change());
  expect(state.pending).toHaveLength(1);
  expect(state.retry).toBe(previous.retry);
});

test("forwards actions and their failures with the original receiver and arguments", async () => {
  const { outbox } = fake();
  await render(outbox);
  const storage = {} as StorageClient;
  const options = { signal: new AbortController().signal };
  await state.retry("p");
  await state.retry();
  await state.retryAll();
  await state.resolve("c", "both");
  await state.replay(storage, options);
  expect(outbox.retry).toHaveBeenNthCalledWith(1, "p");
  expect(outbox.retry).toHaveBeenNthCalledWith(2, undefined);
  expect(outbox.retry).toHaveBeenNthCalledWith(3);
  expect(outbox.resolve).toHaveBeenCalledWith("c", "both");
  expect(outbox.replay).toHaveBeenCalledWith(storage, options);
  const error = new Error("offline");
  vi.mocked(outbox.retry).mockRejectedValueOnce(error);
  await expect(state.retry()).rejects.toBe(error);
});

test("replacement and null clear the previous identity immediately and release both subscriptions", async () => {
  const a = fake();
  const b = fake();
  a.setPending();
  await render(a.outbox);
  await render(b.outbox);
  expect(state.pending).toEqual([]);
  expect(a.listeners.change.size + a.listeners.conflict.size).toBe(0);
  await act(() => a.conflict());
  expect(state.conflicts).toEqual([]);
  await render(null);
  expect(b.listeners.change.size + b.listeners.conflict.size).toBe(0);
});

test("refreshes after subscribing to cover hydration between render and commit", async () => {
  const f = fake();
  const on = f.outbox.on;
  f.outbox.on = (event, listener) => {
    f.setPending();
    return on(event, listener);
  };
  await render(f.outbox);
  expect(state.pending).toHaveLength(1);
});

test("server rendering supplies an empty hydration snapshot without subscribing", () => {
  const f = fake();
  f.setPending();
  renderToString(createElement(Probe, { outbox: f.outbox }));
  expect(state.pending).toEqual([]);
  expect(f.listeners.change.size).toBe(0);
});
