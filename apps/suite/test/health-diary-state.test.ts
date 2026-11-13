// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import {
  createDiaryStore,
  type DiaryDraft,
  type DiaryEntry,
} from "../src/apps/health/lib/data/diary";
import { createHealthDataStore } from "../src/apps/health/lib/data/store";
import { useDiary } from "../src/apps/health/state/diary-context";
import { HealthProvider, useHealth } from "../src/apps/health/state/health-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";

const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast: notifications }));
const ROOT = "https://diary-state.test/",
  OWNER = `${ROOT}profile#me`;
const draft: DiaryDraft = {
  kind: "meal",
  at: new Date("2026-10-31T12:00:00Z"),
  foods: ["Rice"],
  ingredients: "",
  tags: [],
  note: "Lunch",
};
let context: ReturnType<typeof useDiary>, health: ReturnType<typeof useHealth>;
function Probe() {
  context = useDiary();
  health = useHealth();
  return null;
}
async function eventually(assert: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {});
      assert();
    },
    { timeout: 5000 },
  );
}
function entries() {
  return context.state.status === "ready" || context.state.status === "empty"
    ? context.state.data
    : [];
}
async function setup(
  intercept?: (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    fetch: typeof globalThis.fetch,
  ) => Promise<Response>,
) {
  notifications.success.mockClear();
  notifications.error.mockClear();
  const pod = createDemoPod({ root: ROOT });
  await createHealthDataStore(pod.fetch, ROOT, OWNER).initialize();
  const fetch: typeof globalThis.fetch = intercept
    ? (input, init) => intercept(input, init, pod.fetch)
    : pod.fetch;
  const session: PodSession = {
    mode: "demo",
    storageUrl: ROOT,
    webId: OWNER,
    displayName: "Alice",
    fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await mount(h(HealthProvider, { session, children: h(Probe) }));
  await eventually(() => expect(context.state.status).toBe("empty"));
  return { pod, diary: createDiaryStore(pod.fetch, ROOT, OWNER) };
}
function undo(message: string) {
  const args = notifications.success.mock.calls.findLast(
    (args) => args[0] === message && args[1]?.action,
  );
  if (!args) throw new Error("Missing undo action");
  args[1].action.onClick();
}
it("shows a meal immediately and rolls only that failed operation back", async () => {
  const write = deferred<Response>(),
    started = deferred<void>();
  await setup(async (input, init, fetch) => {
    if (String(input).endsWith("slow.ttl") && init?.method === "PUT") {
      started.resolve();
      return write.promise;
    }
    return fetch(input, init);
  });
  let save!: Promise<void>;
  await act(async () => {
    save = context.save(draft, "slow");
  });
  await started.promise;
  expect(entries()).toHaveLength(1);
  expect(context.busy).toHaveLength(1);
  await act(async () => {
    write.resolve(new Response(null, { status: 500 }));
    await expect(save).rejects.toMatchObject({ status: 500 });
  });
  await eventually(() => expect(entries()).toHaveLength(0));
  expect(context.busy).toHaveLength(0);
  expect(notifications.error).toHaveBeenCalled();
});
it("shows one toast with Undo for each edit and deletion, and restores a cross-month edit", async () => {
  const { diary } = await setup();
  await act(async () => context.save(draft, "entry"));
  await eventually(() => expect(entries()).toHaveLength(1));
  const original = entries()[0] as DiaryEntry;
  notifications.success.mockClear();
  await act(async () =>
    context.save(
      { ...draft, at: new Date("2026-11-01T12:00:00Z"), note: "Edited" },
      "entry",
      original,
    ),
  );
  await eventually(() => expect(entries()[0]?.note).toBe("Edited"));
  expect(notifications.success).toHaveBeenCalledTimes(1);
  expect(notifications.success).toHaveBeenLastCalledWith(
    "Diary entry updated",
    expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
  );
  await act(async () => undo("Diary entry updated"));
  await eventually(() => expect(entries()[0]?.note).toBe("Lunch"));
  const restored = entries()[0] as DiaryEntry;
  expect(restored.url).toBe(original.url);
  notifications.success.mockClear();
  await act(async () => context.remove(restored));
  await eventually(() => expect(entries()).toHaveLength(0));
  expect(notifications.success).toHaveBeenCalledTimes(1);
  expect(notifications.success).toHaveBeenLastCalledWith(
    "Diary entry deleted",
    expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
  );
  await act(async () => undo("Diary entry deleted"));
  await eventually(() => expect(entries()[0]?.url).toBe(original.url));
  expect((await diary.read(original.url)).note).toBe("Lunch");
});
it("keeps a concurrent recreation when delete undo conflicts, and refreshes external edits", async () => {
  const { diary } = await setup();
  await act(async () => context.save(draft, "entry"));
  await eventually(() => expect(entries()).toHaveLength(1));
  const original = entries()[0] as DiaryEntry;
  await act(async () => context.remove(original));
  const recreated = await diary.save({ ...draft, note: "Another device" }, "entry");
  await act(async () => undo("Diary entry deleted"));
  await eventually(() =>
    expect(notifications.error).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere")),
  );
  await eventually(() => expect(entries()[0]?.note).toBe("Another device"));
  await diary.save({ ...draft, note: "External edit" }, "entry", recreated);
  await eventually(() => expect(entries()[0]?.note).toBe("External edit"));
});
it("surfaces read failures, retries and rolls back stale deletions", async () => {
  let fail = false;
  const { diary } = await setup(async (input, init, fetch) => {
    if (fail && String(input).endsWith("diary/") && !init?.method)
      return new Response(null, { status: 503 });
    return fetch(input, init);
  });
  await act(async () => context.save(draft, "entry"));
  await eventually(() => expect(entries()).toHaveLength(1));
  const original = entries()[0] as DiaryEntry;
  await diary.save({ ...draft, note: "Changed elsewhere" }, "entry", original);
  await act(async () => {
    await expect(context.remove(original)).rejects.toMatchObject({ status: 412 });
  });
  await eventually(() => expect(entries()[0]?.note).toBe("Changed elsewhere"));
  fail = true;
  await act(async () => context.retry());
  await eventually(() => expect(context.state.status).toBe("error"));
  fail = false;
  await act(async () => context.retry());
  await eventually(() => expect(entries()[0]?.note).toBe("Changed elsewhere"));
});
it("loads only for diary consumers, reuses the account cache on navigation and ignores unrelated Health writes", async () => {
  const pod = createDemoPod({ root: ROOT });
  const store = createHealthDataStore(pod.fetch, ROOT, OWNER);
  await store.initialize();
  await createDiaryStore(pod.fetch, ROOT, OWNER).save(draft, "cached");
  const reads: string[] = [];
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    storageUrl: ROOT,
    displayName: "Alice",
    reset: async () => {},
    subscribe: pod.subscribe,
    fetch: async (input, init) => {
      if (!init?.method && String(input).includes("/diary/")) reads.push(String(input));
      return pod.fetch(input, init);
    },
  };
  function OtherPage() {
    health = useHealth();
    return null;
  }
  const view = await mount(h(HealthProvider, { session, children: h(OtherPage) }));
  await eventually(() => expect(health.boot.status).toBe("ready"));
  expect(reads).toEqual([]);
  await view.render(h(HealthProvider, { session, children: h(Probe) }));
  await eventually(() => expect(entries()).toHaveLength(1));
  const before = reads.length;
  await act(async () => health.mutate(async () => {}, "Other Health write"));
  await act(async () => health.invalidate());
  expect(reads).toHaveLength(before);
  await view.render(h(HealthProvider, { session, children: h(OtherPage) }));
  await view.render(h(HealthProvider, { session, children: h(Probe) }));
  await eventually(() => expect(entries()).toHaveLength(1));
  expect(reads).toHaveLength(before);
  await act(async () => context.save({ ...draft, note: "Diary write" }, "cached", entries()[0]));
  await eventually(() => expect(reads.length).toBeGreaterThan(before));
});
