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

  it("watches added issues and closes removed subscriptions after membership changes", async () => {
    const { unmount } = renderHook(() => useIssues(TRACKER, WEBID, OWN));
    await act(async () => {});
    const active = channels.filter((channel) => channel.close.mock.calls.length === 0);
    const container = active.find((channel) => channel.topic === CONTAINER)!;
    list.mockResolvedValue({ issues: [issue("two")], canCreate: true });
    act(() => container.onChange());
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(active.find((channel) => channel.topic === issue("one").url)!.close).toHaveBeenCalledOnce();
    expect(channels.filter((channel) => channel.close.mock.calls.length === 0).map((channel) => channel.topic))
      .toEqual([CONTAINER, issue("two").url]);
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
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(list).toHaveBeenCalledTimes(reads);
  });
});
