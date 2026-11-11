// AUTHORED-BY Codex GPT-6.1-Sol
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  type Search,
  type SearchPage,
  type SearchQuery,
  type UseSearchResult,
  useSearch,
} from "./index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let state: UseSearchResult;
const page: SearchPage = { source: "local", results: [] };

function Probe({ q, search }: { q: SearchQuery | null; search: Search }) {
  state = useSearch(q, search);
  return null;
}
async function render(q: SearchQuery | null, search: Search) {
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  const mounted = root;
  await act(() =>
    mounted.render(createElement(StrictMode, null, createElement(Probe, { q, search }))),
  );
}
async function advance(ms = 250) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}
function deferred() {
  let resolve!: (page: SearchPage) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<SearchPage>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  if (root) {
    const mounted = root;
    await act(() => mounted.unmount());
  }
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

test("null query is idle and sends no request", async () => {
  const search = vi.fn<Search>();
  await render(null, search);
  await advance(1000);
  expect(state).toEqual({ status: "idle", page: undefined, error: undefined });
  expect(search).not.toHaveBeenCalled();
});

test("debounces for 250ms, cancels previous timers and accepts value-equal inline queries", async () => {
  const search = vi.fn<Search>().mockResolvedValue(page);
  await render({ text: "old" }, search);
  expect(state.status).toBe("loading");
  await advance(200);
  expect(search).not.toHaveBeenCalled();
  const q: SearchQuery = {
    text: "report",
    types: ["https://example.org/Task"],
    within: ["https://pod.example/"],
    limit: 2,
    cursor: btoa("2"),
  };
  await render(q, search);
  await advance(100);
  await render({ ...q }, search);
  await advance(149);
  expect(search).not.toHaveBeenCalled();
  await advance(1);
  expect(search).toHaveBeenCalledExactlyOnceWith(q, { signal: expect.any(AbortSignal) });
  expect(state).toEqual({ status: "ready", page, error: undefined });
});

test("aborts a stale request immediately and ignores late successes", async () => {
  const first = deferred();
  const second = deferred();
  const search = vi
    .fn<Search>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await render({ text: "first" }, search);
  await advance();
  const signal = search.mock.calls[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  await render({ text: "second" }, search);
  expect(signal?.aborted).toBe(true);
  await advance();
  const newer: SearchPage = { source: "server", results: [] };
  await act(() => second.resolve(newer));
  await act(() => first.resolve(page));
  expect(state).toEqual({ status: "ready", page: newer, error: undefined });
});

test("late abort rejections do not replace the current result or idle state", async () => {
  const first = deferred();
  const search = vi.fn<Search>().mockReturnValueOnce(first.promise).mockResolvedValue(page);
  await render({ text: "first" }, search);
  await advance();
  await render({}, search);
  await advance();
  await act(() => first.reject(new DOMException("Aborted", "AbortError")));
  expect(state.status).toBe("ready");
  await render(null, search);
  expect(state.status).toBe("idle");
  await advance();
  expect(search).toHaveBeenCalledTimes(2);
});

test("shows async errors and synchronous throws, clears errors and recovers", async () => {
  const error = new Error("search failed");
  const search = vi
    .fn<Search>()
    .mockRejectedValueOnce(error)
    .mockImplementationOnce(() => {
      throw error;
    })
    .mockResolvedValue(page);
  await render({ text: "fail" }, search);
  await advance();
  expect(state).toEqual({ status: "error", page: undefined, error });
  await render({ text: "throw" }, search);
  expect(state).toEqual({ status: "loading", page: undefined, error: undefined });
  await advance();
  expect(state.error).toBe(error);
  await render({ text: "recover" }, search);
  await advance();
  expect(state).toEqual({ status: "ready", page, error: undefined });
});

test("changing the search callable cancels the previous session; unmount aborts active work", async () => {
  const pending = deferred();
  const old = vi.fn<Search>().mockReturnValue(pending.promise);
  const next = vi.fn<Search>().mockResolvedValue(page);
  await render({}, old);
  await advance();
  await render({}, next);
  expect(old.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await advance();
  expect(next).toHaveBeenCalledTimes(1);
  const mounted = root as Root;
  await act(() => mounted.unmount());
  root = undefined;
  expect(next.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await act(() => pending.resolve(page));
});

test("disabling and unmounting before the debounce expires cancel the timer", async () => {
  const search = vi.fn<Search>().mockResolvedValue(page);
  await render({}, search);
  await render(null, search);
  await advance();
  expect(search).not.toHaveBeenCalled();
  await render({}, search);
  const mounted = root as Root;
  await act(() => mounted.unmount());
  root = undefined;
  await advance();
  expect(search).not.toHaveBeenCalled();
});
