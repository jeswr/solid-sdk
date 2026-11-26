// AUTHORED-BY Codex GPT-6.1-Sol
import { toast } from "@jeswr/suite-ui";
import { describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import {
  applySkip,
  planSkip,
  skipMatches,
  skipToastCopy,
} from "../../src/apps/tasks/lib/views/skip";
import { skipTask } from "../../src/apps/tasks/state/actions";
import type { TasksContextValue } from "../../src/apps/tasks/state/tasks-context";
import { now } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";
import { storedTask } from "./tasks-views-fixtures";

vi.mock("@jeswr/suite-ui", () => ({ toast: { success: vi.fn() } }));

async function setup(count?: number, until?: string) {
  const frame = await frameCache();
  const item = await frame.cache.createTask(frame.inbox, {
    title: "Review",
    allDay: "2026-10-25",
    recurrence: { frequency: "DAILY", count, until },
    reminders: [{ offset: "-PT1H" }, { time: new Date("2026-10-24T18:00:00Z") }],
  });
  if (!item) throw new Error("Missing task");
  return { ...frame, item };
}

describe("skip occurrence", () => {
  it("supports tasks without a due date or reminders and restores their absence", async () => {
    const { cache, inbox, store } = await frameCache();
    const item = await cache.createTask(inbox, {
      title: "Untimed",
      recurrence: { frequency: "DAILY" },
    });
    if (!item) throw new Error("Missing task");
    const plan = await cache.skipTask(item, now);
    if (!plan) throw new Error("Missing plan");
    expect((await store.readTask(item.url)).task.dueDate).toBeDefined();
    await cache.undoSkip(item, plan);
    expect((await store.readTask(item.url)).task.dueDate).toBeUndefined();
    expect((await store.readTask(item.url)).task.reminders).toEqual([]);
    const bare = storedTask("Bare");
    applySkip(bare.task, { title: "Bare", state: "open" });
    expect(skipMatches(bare.task, { title: "Bare", state: "open" })).toBe(true);
  });
  it("advances without history or COUNT changes, including repeated skips and reload", async () => {
    const { cache, store, pod, inbox, item } = await setup(3);
    const start = pod.requests.length;
    const previousReminders = item.task.reminders;
    const plan = await cache.skipTask(item, now);
    expect(plan?.kind).toBe("advance");
    if (!plan) throw new Error("Missing skip plan");
    const first = await store.readTask(item.url);
    expect(first.task.allDay).toBe("2026-10-26");
    expect(first.task.recurrence?.count).toBe(3);
    expect(first.task.reminders).toMatchObject([
      { offset: "-PT1H" },
      { time: new Date("2026-10-25T19:00:00Z") },
    ]);
    await cache.skipTask(first, now);
    await cache.loadTasks(inbox, true);
    const second = await store.readTask(item.url);
    expect(second.task.allDay).toBe("2026-10-27");
    expect(second.task.recurrence?.count).toBe(3);
    expect(cache.getSnapshot().views).toHaveLength(1);
    expect(cache.getSnapshot().views[0]?.state).toBe("open");
    expect(
      pod.requests
        .slice(start)
        .filter((r) => r.method !== "GET")
        .every((r) => r.url === item.url && r.headers.has("If-Match")),
    ).toBe(true);
    // Undo from an older occurrence cannot rewind the newer skip.
    expect(await cache.undoSkip(item, plan)).toBeUndefined();
    expect((await store.readTask(item.url)).task.allDay).toBe("2026-10-27");
    expect(item.task.reminders).toEqual(previousReminders);
  });

  it("undo restores due, all-day and absolute/offset reminders while preserving newer title edits", async () => {
    const { cache, store, item } = await setup();
    const plan = await cache.skipTask(item, now);
    if (!plan) throw new Error("Missing skip plan");
    await cache.updateTask(item, (task) => {
      task.title = "New title";
    });
    expect(await cache.undoSkip(item, plan)).toBeDefined();
    const restored = (await store.readTask(item.url)).task;
    expect(restored.title).toBe("New title");
    expect(restored.allDay).toBe(item.task.allDay);
    expect(restored.dueDate).toEqual(item.task.dueDate);
    expect(restored.reminders).toEqual(item.task.reminders);
    expect(restored.state).toBe("open");
    expect(restored.endedAt).toBeUndefined();
  });

  it.each([
    [1, undefined],
    [undefined, "2026-10-25"],
  ] as const)("ends exhausted series without a copy and can undo (%s, %s)", async (count, until) => {
    const { cache, store, item } = await setup(count, until);
    const plan = await cache.skipTask(item, now);
    if (!plan) throw new Error("Missing skip plan");
    expect(plan.kind).toBe("close");
    expect(skipToastCopy(plan)).toBe("Series ended");
    expect(cache.getSnapshot().views).toHaveLength(1);
    expect((await store.readTask(item.url)).task.state).toBe("closed");
    await cache.undoSkip(item, plan);
    expect((await store.readTask(item.url)).task.state).toBe("open");
  });

  it("counts only completed copies when checking exhaustion", async () => {
    const { cache, store, item } = await setup(2);
    await cache.completeTask(item, now);
    const plan = await cache.skipTask(await store.readTask(item.url), now);
    expect(plan?.kind).toBe("close");
    expect(cache.getSnapshot().views.filter((v) => v.derivedFrom === item.task.id)).toHaveLength(1);
  });

  it("rolls back failed writes and retries the same target date", async () => {
    const { cache, store, item, failures } = await setup();
    vi.spyOn(store, "updateTask").mockRejectedValueOnce(new ModelError(403, item.url));
    expect(await cache.skipTask(item, now)).toBeUndefined();
    expect(cache.getSnapshot().views[0]?.allDay).toBe("2026-10-25");
    failures.mock.calls.at(-1)?.[1]();
    await vi.waitFor(() => expect(cache.getSnapshot().views[0]?.allDay).toBe("2026-10-26"));
  });

  it("does nothing for closed, non-recurring, removed and malformed tasks", async () => {
    expect(planSkip(storedTask("Plain"), [], now)).toBeUndefined();
    expect(
      planSkip(
        storedTask("Closed", { state: "closed", recurrence: { frequency: "DAILY" } }),
        [],
        now,
      ),
    ).toBeUndefined();
    const malformed = storedTask("Invalid");
    for (const quad of malformed.dataset) malformed.dataset.delete(quad);
    expect(() => planSkip(malformed, [], now)).toThrow("wf:Task");
    const { cache, item } = await setup();
    await cache.deleteTask(item);
    expect(await cache.skipTask(item, now)).toBeUndefined();
  });

  it.each([
    false,
    true,
  ])("shares an in-flight action and shows the exact Undo toast (ended: %s)", async (ended) => {
    vi.mocked(toast.success).mockClear();
    const { cache, item } = await setup(ended ? 1 : undefined);
    const tasks = { ...cache.getSnapshot(), cache } as TasksContextValue;
    const view = cache.getSnapshot().views[0];
    if (!view) throw new Error("Missing view");
    const first = skipTask(view, tasks);
    expect(skipTask(view, tasks)).toBe(first);
    await first;
    expect(toast.success).toHaveBeenCalledOnce();
    const call = vi.mocked(toast.success).mock.calls[0];
    if (!call) throw new Error("Missing toast");
    const [message, options] = call;
    expect(message).toBe(ended ? "Series ended" : "Skipped to Mon 26 Oct");
    expect(options).toMatchObject({ duration: 8000, action: { label: "Undo" } });
    const action = options?.action;
    if (!action || typeof action !== "object" || !("onClick" in action))
      throw new Error("Missing Undo action");
    action.onClick({} as never);
    await vi.waitFor(() => expect(cache.getSnapshot().views[0]?.allDay).toBe(item.task.allDay));
    expect(cache.getSnapshot().views[0]?.state).toBe("open");
    expect(await skipTask({ ...view, url: "https://pod.test/missing.ttl" }, tasks)).toBeUndefined();
  });
});
