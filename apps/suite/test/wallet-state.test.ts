// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

import type { WalletRecord, WalletRepository } from "@jeswr/solid-wallet";
import { afterEach, expect, it, vi } from "vitest";
import { createWalletState } from "@/apps/wallet/state/wallet-state";

const item: WalletRecord = {
  url: "https://pod.example/wallet/one.ttl",
  etag: '"v1"',
  name: "First",
  kind: "passport",
  created: new Date("2026-11-11"),
  modified: new Date("2026-11-11"),
};
function fixture() {
  const repository = {
    list: vi.fn(async () => [item]),
    save: vi.fn(async (data, existing) => ({
      ...data,
      url: existing?.url ?? "https://pod.example/wallet/new.ttl",
      etag: '"v2"',
    })),
    remove: vi.fn(async () => {}),
    upload: vi.fn(async () => "https://pod.example/wallet/files/one"),
    storeCredential: vi.fn(async () => "https://pod.example/wallet/credentials/one"),
  } as unknown as WalletRepository;
  const failed = vi.fn();
  const state = createWalletState(repository, failed);
  return { repository, state, failed };
}
afterEach(() => vi.useRealTimers());
it("loads, subscribes and saves optimistically without blocking unrelated records", async () => {
  const { state, repository } = fixture();
  const changed = vi.fn();
  const unsubscribe = state.subscribe(changed);
  await state.refresh();
  expect(state.getSnapshot().phase).toBe("ready");
  let finish: (value: WalletRecord) => void = () => {};
  vi.mocked(repository.save).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saving = state.save({ ...item, name: "Changed" }, item);
  expect(state.getSnapshot().items[0]?.name).toBe("Changed");
  expect(state.getSnapshot().busy).toEqual([item.url]);
  await expect(state.save({ ...item, name: "Conflicting" }, item)).rejects.toThrow(/still saving/);
  finish({ ...item, name: "Changed", etag: '"v2"' });
  await saving;
  expect(state.getSnapshot().items[0]?.etag).toBe('"v2"');
  expect(state.getSnapshot().busy).toEqual([]);
  unsubscribe();
  state.dispose();
  expect(changed).toHaveBeenCalled();
});
it("rolls back only the failed record and uploads attachments before metadata", async () => {
  const { state, repository, failed } = fixture();
  await state.refresh();
  vi.mocked(repository.save).mockRejectedValueOnce(new Error("network"));
  await expect(state.save({ ...item, name: "Bad" }, item)).rejects.toThrow("network");
  expect(state.getSnapshot().items).toEqual([item]);
  expect(failed).toHaveBeenCalledOnce();
  await state.save({ ...item, name: "New" }, undefined, new Blob(["file"]), "credential");
  expect(repository.upload).toHaveBeenCalledOnce();
  expect(repository.storeCredential).toHaveBeenCalledWith("credential");
  expect(vi.mocked(repository.save).mock.lastCall?.[0]).toMatchObject({
    file: "https://pod.example/wallet/files/one",
    credential: "https://pod.example/wallet/credentials/one",
  });
});
it("drops failed optimistic creates, and surfaces load errors without retaining private records", async () => {
  const { state, repository } = fixture();
  await state.refresh();
  vi.mocked(repository.save).mockRejectedValueOnce("no");
  await expect(state.save({ ...item, name: "unsaved" })).rejects.toBe("no");
  expect(state.getSnapshot().items).toEqual([item]);
  vi.mocked(repository.list).mockRejectedValueOnce("access denied");
  await state.refresh();
  expect(state.getSnapshot()).toMatchObject({ phase: "error", items: [] });
});
it("does not let an old refresh replace an optimistic edit", async () => {
  const { state, repository } = fixture();
  await state.refresh();
  let finish: (value: WalletRecord[]) => void = () => {};
  vi.mocked(repository.list).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const refreshing = state.refresh();
  await state.save({ ...item, name: "Newer" }, item);
  finish([item]);
  await refreshing;
  expect(state.getSnapshot().items[0]?.name).toBe("Newer");
});
it("undoes delayed deletion without a pod write, then deletes after the undo window", async () => {
  vi.useFakeTimers();
  const { state, repository } = fixture();
  await state.refresh();
  const undo = state.remove(item);
  expect(state.getSnapshot().items).toEqual([]);
  undo();
  undo();
  expect(state.getSnapshot().items).toEqual([item]);
  await vi.advanceTimersByTimeAsync(8001);
  expect(repository.remove).not.toHaveBeenCalled();
  const lateUndo = state.remove(item);
  await vi.advanceTimersByTimeAsync(8001);
  lateUndo();
  expect(repository.remove).toHaveBeenCalledOnce();
  expect(state.getSnapshot().items).toEqual([]);
});
it("restores a failed deletion and flushes pending deletions on session disposal", async () => {
  vi.useFakeTimers();
  const { state, repository, failed } = fixture();
  await state.refresh();
  vi.mocked(repository.remove).mockRejectedValueOnce("offline");
  state.remove(item);
  await vi.advanceTimersByTimeAsync(8001);
  expect(state.getSnapshot().items).toEqual([item]);
  expect(failed).toHaveBeenCalledWith("offline", { action: "delete", item, sessionEnded: false });
  const undo = state.remove(item);
  vi.mocked(repository.remove).mockRejectedValueOnce("stale");
  state.dispose();
  undo();
  await vi.advanceTimersByTimeAsync(8001);
  expect(repository.remove).toHaveBeenCalledTimes(2);
  // A delete flushed by disposal (e.g. an account switch) reports that its view has ended.
  expect(failed).toHaveBeenLastCalledWith("stale", { action: "delete", item, sessionEnded: true });
  await expect(state.save(item, item)).rejects.toThrow(/session has ended/);
});
it("ignores a refresh that finishes after account disposal", async () => {
  const { state, repository } = fixture();
  let finish: (items: WalletRecord[]) => void = () => {};
  vi.mocked(repository.list).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = state.refresh();
  state.dispose();
  finish([item]);
  await loading;
  expect(state.getSnapshot().items).toEqual([]);
});

it("does not refresh while saving or after disposal, and ignores stale failures", async () => {
  const { state, repository } = fixture();
  await state.refresh();
  let rejectRead: (error: unknown) => void = () => {};
  vi.mocked(repository.list).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectRead = reject;
      }),
  );
  const stale = state.refresh();
  await state.refresh();
  rejectRead(new Error("old failure"));
  await stale;
  expect(state.getSnapshot().phase).toBe("ready");
  let finish: (value: WalletRecord) => void = () => {};
  vi.mocked(repository.save).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saving = state.save({ ...item, name: "New" }, item);
  const reads = vi.mocked(repository.list).mock.calls.length;
  await state.refresh();
  expect(vi.mocked(repository.list).mock.calls).toHaveLength(reads);
  state.dispose();
  await state.refresh();
  finish({ ...item, name: "New" });
  await saving;
});
it("finishes mutations across attachment and credential boundaries after disposal", async () => {
  for (const stage of ["upload", "storeCredential"] as const) {
    const { state, repository, failed } = fixture();
    await state.refresh();
    let finish: (value: string) => void = () => {};
    vi.mocked(repository[stage]).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = state.save(
      item,
      item,
      stage === "upload" ? new Blob(["x"]) : undefined,
      stage === "storeCredential" ? "vc" : undefined,
    );
    const completed = expect(saving).resolves.toMatchObject({ name: item.name });
    state.dispose();
    finish("https://pod.example/wallet/resource");
    await completed;
    expect(repository.save).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  }
});
it("keeps simultaneous edits to other records when one write fails", async () => {
  const { state, repository } = fixture();
  const second = { ...item, url: "https://pod.example/wallet/two.ttl", name: "Second" };
  vi.mocked(repository.list).mockResolvedValue([item, second]);
  await state.refresh();
  let rejectFirst: (error: unknown) => void = () => {};
  vi.mocked(repository.save).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectFirst = reject;
      }),
  );
  const first = state.save({ ...item, name: "Unconfirmed" }, item);
  const rejected = expect(first).rejects.toThrow("fail");
  await state.save({ ...second, name: "Confirmed second" }, second);
  rejectFirst(new Error("fail"));
  await rejected;
  expect(
    state
      .getSnapshot()
      .items.map((record) => record.name)
      .sort(),
  ).toEqual(["Confirmed second", "First"]);
});
it("preserves the newest undo when an earlier deletion settles or is undone", async () => {
  vi.useFakeTimers();
  const { state, repository } = fixture();
  const second = { ...item, url: "https://pod.example/wallet/two.ttl", name: "Second" };
  vi.mocked(repository.list).mockResolvedValue([item, second]);
  await state.refresh();
  const undoFirst = state.remove(item);
  state.remove(second);
  undoFirst();
  expect(state.getSnapshot().undo?.item.url).toBe(second.url);
  state.dispose();
  const other = fixture();
  vi.mocked(other.repository.list).mockResolvedValue([item, second]);
  await other.state.refresh();
  other.state.remove(item);
  other.state.remove(second);
  await vi.advanceTimersByTimeAsync(8001);
  expect(other.repository.remove).toHaveBeenCalledTimes(2);
});
it("flushes pending deletes exactly once and reports failures delivered after disposal", async () => {
  vi.useFakeTimers();
  const { state, repository, failed } = fixture();
  await state.refresh();
  const timers = vi.spyOn(globalThis, "setTimeout");
  state.remove(item);
  const callback = timers.mock.calls.at(-1)?.[0];
  state.dispose();
  if (typeof callback === "function") callback();
  expect(repository.remove).toHaveBeenCalledOnce();
  timers.mockRestore();
  const other = fixture();
  await other.state.refresh();
  let fail: (error: unknown) => void = () => {};
  vi.mocked(other.repository.remove).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  other.state.remove(item);
  await vi.advanceTimersByTimeAsync(8001);
  other.state.dispose();
  fail(new Error("late failure"));
  await Promise.resolve();
  expect(other.failed).toHaveBeenCalledWith(new Error("late failure"), {
    action: "delete",
    item,
    sessionEnded: true,
  });
  expect(failed).not.toHaveBeenCalled();
});

it("reports failures from saves finishing after disposal without publishing to a new view", async () => {
  const { state, repository, failed } = fixture();
  await state.refresh();
  let reject: (error: unknown) => void = () => {};
  vi.mocked(repository.upload).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const saving = state.save(item, item, new Blob(["x"]));
  const rejected = expect(saving).rejects.toThrow("upload failed");
  const changed = vi.fn();
  state.subscribe(changed);
  state.dispose();
  reject(new Error("upload failed"));
  await rejected;
  expect(failed).toHaveBeenCalledWith(new Error("upload failed"));
  expect(changed).not.toHaveBeenCalled();
});
it("reports skipped invalid records alongside successfully loaded documents", async () => {
  const { state, repository } = fixture();
  vi.mocked(repository.list).mockImplementationOnce(async (report) => {
    report?.("https://pod.example/wallet/broken.ttl");
    return [item];
  });
  await state.refresh();
  expect(state.getSnapshot()).toMatchObject({ phase: "ready", items: [item], skippedRecords: 1 });
});
