// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { NoteConflictError } from "../src/apps/notes/lib/model/errors";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { createPendingDrafts, type PendingDraft } from "../src/apps/notes/state/pending-drafts";

const note: StoredNote = {
  url: "https://pod.example/notes/a.ttl",
  title: "Original",
  body: "Body",
  labels: [],
  etag: '"v1"',
  location: "active",
  format: "text/html",
  revisions: [],
};
const draft = { title: "Latest", body: "Latest body", labels: ["A"] };
function fixture(initial: PendingDraft[] = []) {
  const persist = vi.fn();
  return { pending: createPendingDrafts({ initial, persist }), persist };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("does nothing without edits, and warns only while a draft is unsaved", async () => {
  const { pending } = fixture();
  const save = vi.fn();
  const event = { preventDefault: vi.fn(), returnValue: "unchanged" };
  expect(pending.all()).toEqual([]);
  expect(pending.get(note.url)).toBeUndefined();
  expect(await pending.flush(note, save)).toBe(note);
  expect(await pending.retry()).toEqual([]);
  pending.resolve(note, false);
  pending.beforeUnload(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(event.returnValue).toBe("unchanged");
  pending.change(note, draft, save);
  pending.beforeUnload(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.returnValue).toBe("");
  expect(save).not.toHaveBeenCalled();
});

it("persists the latest complete draft and ETag synchronously, independently of its caller", async () => {
  const { pending, persist } = fixture();
  const save = vi.fn(async (baseline, input) => ({ ...baseline, ...input, etag: '"v2"' }));
  const listener = vi.fn();
  const unsubscribe = pending.subscribe(listener);
  pending.change(note, draft, save);
  const updated = { ...draft, title: "Newest", labels: ["A", "B"] };
  pending.change({ ...note, etag: '"stale"' }, updated, save);
  updated.labels.push("Must not leak");
  expect(persist).toHaveBeenLastCalledWith([
    {
      note,
      draft: { ...draft, title: "Newest", labels: ["A", "B"] },
      status: "saving",
    },
  ]);
  expect(save).not.toHaveBeenCalled();
  await pending.retry();
  expect(save).toHaveBeenCalledExactlyOnceWith(
    note,
    { ...draft, title: "Newest", labels: ["A", "B"] },
    '"v1"',
  );
  expect(persist).toHaveBeenLastCalledWith([]);
  expect(listener).toHaveBeenLastCalledWith(note.url, expect.objectContaining({ etag: '"v2"' }));
  const calls = listener.mock.calls.length;
  unsubscribe();
  pending.change(note, draft, save);
  expect(listener).toHaveBeenCalledTimes(calls);
});

it("single-flights writes, drains edits made mid-save with the acknowledged ETag, and retains the prompt", async () => {
  const { pending, persist } = fixture();
  const first = deferred<StoredNote>();
  const second = deferred<StoredNote>();
  const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  pending.change(note, draft, save);
  const saving = pending.flush(note, save);
  expect(pending.flush(note, save)).toBe(saving);
  const latest = { ...draft, body: "Even newer" };
  pending.change(note, latest, save);
  const saved = { ...note, ...draft, etag: '"v2"' };
  first.resolve(saved);
  await Promise.resolve();
  expect(save).toHaveBeenLastCalledWith(saved, latest, '"v2"');
  expect(persist).toHaveBeenLastCalledWith([{ note: saved, draft: latest, status: "saving" }]);
  const event = { preventDefault: vi.fn(), returnValue: "" };
  pending.beforeUnload(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  second.resolve({ ...saved, ...latest, etag: '"v3"' });
  expect(await saving).toMatchObject({ ...latest, etag: '"v3"' });
  expect(pending.all()).toEqual([]);
  event.preventDefault.mockClear();
  pending.beforeUnload(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
});

it("hydrates failed drafts after reload, retains them on reconnect failure, then retries successfully", async () => {
  const { pending, persist } = fixture([{ note, draft, status: "failed" }]);
  expect(await pending.retry()).toEqual([]); // No authenticated writer until Notes opens.
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockImplementationOnce(async (baseline, input) => ({ ...baseline, ...input, etag: '"v2"' }));
  pending.bind(note, save);
  expect((await pending.retry())[0]?.status).toBe("rejected");
  expect(pending.get(note.url)).toEqual({ note, draft, status: "failed" });
  expect(persist).toHaveBeenLastCalledWith([{ note, draft, status: "failed" }]);
  await pending.retry();
  expect(pending.get(note.url)).toBeUndefined();
  expect(save).toHaveBeenCalledTimes(2);
});

it("retains conflicts across unmount/reload and edits; only Keep mine rebases their validator", async () => {
  const { pending, persist } = fixture();
  const save = vi
    .fn()
    .mockRejectedValueOnce(new NoteConflictError(note.url))
    .mockImplementationOnce(async (baseline, input) => ({ ...baseline, ...input, etag: '"v3"' }));
  pending.change(note, draft, save);
  await expect(pending.flush(note, save)).rejects.toBeInstanceOf(NoteConflictError);
  const edited = { ...draft, title: "My newest title" };
  pending.change(note, edited, save);
  await expect(pending.flush(note, save)).rejects.toBeInstanceOf(NoteConflictError);
  expect(await pending.retry()).toEqual([]);
  expect(save).toHaveBeenCalledOnce();
  const stored = persist.mock.lastCall?.[0] as PendingDraft[];
  const reopened = fixture(stored).pending;
  expect(reopened.get(note.url)?.status).toBe("conflict");
  const remote = { ...note, body: "Remote", etag: '"remote"' };
  reopened.resolve(remote, true);
  await reopened.flush(remote, save);
  expect(save).toHaveBeenLastCalledWith(remote, edited, '"remote"');
  expect(reopened.all()).toEqual([]);
});

it("Load latest discards the retained conflict and prevents another local write", async () => {
  const { pending, persist } = fixture([{ note, draft, status: "conflict" }]);
  const listener = vi.fn();
  pending.subscribe(listener);
  const remote = { ...note, title: "Remote", etag: '"remote"' };
  pending.resolve(remote, false);
  expect(persist).toHaveBeenLastCalledWith([]);
  expect(listener).toHaveBeenCalledExactlyOnceWith(note.url, remote);
  expect(await pending.retry()).toEqual([]);
  expect(pending.all()).toEqual([]);
});
