// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6.1-Sol
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "./repository";
import { useIssues } from "./use-issues";

const { list, watch, channels } = vi.hoisted(() => ({
  list: vi.fn(),
  watch: vi.fn(),
  channels: [] as { topic: string; onChange: () => void; close: ReturnType<typeof vi.fn> }[],
}));

vi.mock("./repository", () => ({
  Repository: class {
    containerUrl = "https://pod.example/alice/tracker/issues/";
    list = list;
    async listSprints() { return []; }
  },
}));
vi.mock("./notifications", () => ({ watchContainer: watch }));
vi.mock("./issue-cache", () => ({ readIssueCache: () => undefined, writeIssueCache: vi.fn() }));

const TRACKER = "https://pod.example/alice/tracker/index.ttl";
const CONTAINER = "https://pod.example/alice/tracker/issues/";
const WEBID = "https://pod.example/alice/profile/card#me";
const OWN = ["https://pod.example/alice/"];

function issue(name: string, status = "todo"): IssueRecord {
  return {
    url: `${CONTAINER}${name}.ttl`, title: name, state: "open", status, issueType: "task",
    labels: [], components: [], blockedBy: [], relatesTo: [], attachments: [],
    worklog: [], loggedSeconds: 0, comments: [], fields: {}, canWrite: true,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  list.mockResolvedValue({ issues: [issue("one")], canCreate: true });
  watch.mockImplementation((topic: string, onChange: () => void) => {
    const channel = { topic, onChange, close: vi.fn() };
    channels.push(channel);
    return channel;
  });
});

afterEach(() => {
  cleanup();
  channels.length = 0;
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("useIssues live subscriptions", () => {
  it("refreshes an existing issue from its own topic without a container event", async () => {
    const { result } = renderHook(() => useIssues(TRACKER, WEBID, OWN));
    await act(async () => {});
    expect(watch).toHaveBeenCalledWith(CONTAINER, expect.any(Function), { ownStorageUrls: OWN });
    const resource = channels.findLast((channel) => channel.topic === issue("one").url);
    expect(resource).toBeDefined();
    list.mockResolvedValue({ issues: [issue("one", "in-progress")], canCreate: true });
    act(() => resource!.onChange());
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(result.current.issues[0].status).toBe("in-progress");
  });

  it("debounces a short notification burst without leaving an extra refresh queued", async () => {
    renderHook(() => useIssues(TRACKER, WEBID, OWN));
    await act(async () => {});
    const container = channels.find((channel) => channel.topic === CONTAINER)!;
    act(() => container.onChange());
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    act(() => container.onChange());
    await act(async () => { await vi.advanceTimersByTimeAsync(799); });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps refreshing with 40 polling fallbacks staggered 625 ms apart", async () => {
    const { watchContainer } = await vi.importActual<typeof import("./notifications")>("./notifications");
    const initialIssues = Array.from({ length: 39 }, (_, index) => issue(`issue-${index}`));
    list.mockResolvedValue({ issues: initialIssues, canCreate: true });
    watch.mockImplementation((topic, onChange, options) => {
      const delay = (watch.mock.calls.length - 1) * 625;
      const doFetch: typeof fetch = async (_url, init) => {
        // Stagger discovery failures so the real watcher's 25-second poll
        // timers keep invalidating the board less than 800 ms apart.
        if (init?.method === "HEAD") await new Promise((resolve) => setTimeout(resolve, delay));
        return new Response(null, { status: 404 });
      };
      return watchContainer(topic, onChange, { ...options, fetch: doFetch });
    });
    const { result, unmount } = renderHook(() => useIssues(TRACKER, WEBID, OWN));
    await act(async () => {});
    expect(watch).toHaveBeenCalledTimes(40);
    list.mockResolvedValue({
      issues: initialIssues.map((record) => ({ ...record, status: "in-progress" })), canCreate: true,
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.issues[0].status).toBe("in-progress");
    // Check progress throughout the review's 125-second reproduction window.
    for (const elapsed of [25_000, 25_000, 25_000, 20_000]) {
      const reads = list.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
      expect(list.mock.calls.length).toBeGreaterThan(reads);
    }
    unmount();
    const reads = list.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(list).toHaveBeenCalledTimes(reads);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("watches added issues and closes removed subscriptions after membership changes", async () => {
    list.mockResolvedValue({ issues: [issue("one"), issue("removed")], canCreate: true });
    const { unmount } = renderHook(() => useIssues(TRACKER, WEBID, OWN));
    await act(async () => {});
    const active = channels.filter((channel) => channel.close.mock.calls.length === 0);
    const container = active.find((channel) => channel.topic === CONTAINER)!;
    list.mockResolvedValue({ issues: [issue("one"), issue("two")], canCreate: true });
    act(() => container.onChange());
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(container.close).not.toHaveBeenCalled();
    expect(active.find((channel) => channel.topic === issue("one").url)!.close).not.toHaveBeenCalled();
    expect(active.find((channel) => channel.topic === issue("removed").url)!.close).toHaveBeenCalledOnce();
    expect(watch).toHaveBeenCalledTimes(4);
    expect(channels.filter((channel) => channel.close.mock.calls.length === 0).map((channel) => channel.topic))
      .toEqual([CONTAINER, issue("one").url, issue("two").url]);
    unmount();
    expect(channels.every((channel) => channel.close.mock.calls.length === 1)).toBe(true);
  });

  it.each([CONTAINER, issue("one").url])("preserves a queued %s invalidation when an in-flight fetch changes membership", async (topic) => {
    const { result } = renderHook(() => useIssues(TRACKER, WEBID, OWN));
    await act(async () => {});
    const pending = Promise.withResolvers<{ issues: IssueRecord[]; canCreate: boolean }>();
    list.mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ issues: [issue("one"), issue("two"), issue("three")], canCreate: true });
    const container = channels.findLast((channel) => channel.topic === CONTAINER)!;
    act(() => container.onChange());
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(list).toHaveBeenCalledTimes(2);

    // A second creation invalidates the list while the first membership read is
    // still pending. Its debounce must survive that read adding a subscription.
    act(() => channels.findLast((channel) => channel.topic === topic)!.onChange());
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => { pending.resolve({ issues: [issue("one"), issue("two")], canCreate: true }); });
    expect(result.current.issues.map((record) => record.title)).toEqual(["one", "two"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(399); });
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(list).toHaveBeenCalledTimes(3);
    expect(result.current.issues.map((record) => record.title)).toEqual(["one", "two", "three"]);
    expect(container.close).not.toHaveBeenCalled();
  });

  it.each([
    { change: "tracker", tracker: "https://pod.example/alice/other/index.ttl", creator: WEBID, own: OWN },
    { change: "identity", tracker: TRACKER, creator: "https://pod.example/bob/profile/card#me", own: OWN },
    { change: "storage roots", tracker: TRACKER, creator: WEBID, own: ["https://pod.example/bob/"] },
  ])("closes subscriptions and cancels queued invalidations when $change changes", async (next) => {
    const { rerender, unmount } = renderHook(
      ({ tracker, creator, own }) => useIssues(tracker, creator, own),
      { initialProps: { tracker: TRACKER, creator: WEBID, own: OWN } },
    );
    await act(async () => {});
    const active = channels.filter((channel) => channel.close.mock.calls.length === 0);
    act(() => active.find((channel) => channel.topic === CONTAINER)!.onChange());
    await act(async () => { rerender(next); });
    expect(active.every((channel) => channel.close.mock.calls.length === 1)).toBe(true);
    const reads = list.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(list).toHaveBeenCalledTimes(reads);
    expect(watch).toHaveBeenLastCalledWith(issue("one").url, expect.any(Function), { ownStorageUrls: next.own });
    unmount();
    expect(channels.every((channel) => channel.close.mock.calls.length === 1)).toBe(true);
  });

  it("keeps subscriptions across content refreshes and cancels pending refreshes on unmount", async () => {
    const { result, unmount } = renderHook(() => useIssues(TRACKER, WEBID, OWN));
    await act(async () => {});
    const subscriptions = watch.mock.calls.length;
    await act(async () => { await result.current.refresh(); });
    expect(watch).toHaveBeenCalledTimes(subscriptions);
    const container = channels.findLast((channel) => channel.topic === CONTAINER)!;
    act(() => container.onChange());
    const reads = list.mock.calls.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(list).toHaveBeenCalledTimes(reads);
  });
});
