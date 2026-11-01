// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteConflictError } from "../src/apps/notes/lib/model/errors";
import type { NotesStore, StoredNote } from "../src/apps/notes/lib/model/store";
import { useNoteDraft } from "../src/apps/notes/state/use-note-draft";
import { act, deferred, h, mount } from "./drive-ui-dom";

vi.mock("@jeswr/suite-ui", () => ({ toast: { error: vi.fn() } }));
afterEach(() => vi.useRealTimers());
const original: StoredNote = {
  url: "https://pod.example/notes/a.ttl",
  title: "Title",
  body: "<p>Original</p>",
  labels: [],
  format: "text/html",
  location: "active",
  revisions: [],
  etag: '"v1"',
};
async function setup(
  save = vi.fn(async (_note, change) => ({ ...original, ...change, etag: '"v2"' })),
  read = vi.fn(async () => ({ ...original, body: "<p>Remote</p>", etag: '"remote"' })),
) {
  let draft!: ReturnType<typeof useNoteDraft>;
  const refresh = vi.fn(async () => {});
  const store = { save, read } as unknown as NotesStore;
  function Harness() {
    draft = useNoteDraft(original, store, refresh);
    return null;
  }
  const rendered = await mount(h(Harness));
  return {
    get draft() {
      return draft;
    },
    save,
    read,
    refresh,
    ...rendered,
  };
}
describe("Notes autosave", () => {
  it("debounces the last edit for 800ms and passes the current If-Match validator", async () => {
    vi.useFakeTimers();
    const ui = await setup();
    await act(() => ui.draft.change({ title: "First" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    await act(() => ui.draft.change({ title: "Last" }));
    await act(() => vi.advanceTimersByTimeAsync(799));
    expect(ui.save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(ui.save).toHaveBeenCalledExactlyOnceWith(
      original,
      { title: "Last", body: original.body, labels: [] },
      '"v1"',
    );
    expect(ui.draft.status).toBe("saved");
  });
  it("serializes edits arriving during a write and flush waits for both", async () => {
    const first = deferred<StoredNote>();
    const second = deferred<StoredNote>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const ui = await setup(save);
    await act(() => ui.draft.change({ body: "<p>First</p>" }));
    let flushing!: Promise<StoredNote>;
    await act(() => {
      flushing = ui.draft.flush();
      expect(ui.draft.flush()).toBe(flushing);
    });
    await act(() => ui.draft.change({ body: "<p>Second</p>", labels: ["Plans"] }));
    expect(save).toHaveBeenCalledTimes(1);
    const saved = { ...original, body: "<p>First</p>", etag: '"v2"' };
    await act(() => first.resolve(saved));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(
      saved,
      { title: "Title", body: "<p>Second</p>", labels: ["Plans"] },
      '"v2"',
    );
    await act(async () => {
      second.resolve({ ...saved, body: "<p>Second</p>", labels: ["Plans"], etag: '"v3"' });
      await flushing;
    });
    expect(ui.draft.status).toBe("saved");
  });
  it("retains failed edits and retries without silently declaring them saved", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(async (_note, change) => ({ ...original, ...change, etag: '"v2"' }));
    const ui = await setup(save);
    await act(() => ui.draft.change({ title: "Keep this" }));
    await act(async () => {
      await expect(ui.draft.flush()).rejects.toThrow("offline");
    });
    expect(ui.draft.status).toBe("failed");
    expect(ui.draft.draft.title).toBe("Keep this");
    await act(() => ui.draft.flush());
    expect(ui.draft.status).toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("blocks on conflict, then Keep mine re-reads the ETag before saving the latest draft", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new NoteConflictError(original.url))
      .mockImplementationOnce(async (_note, change) => ({ ...original, ...change, etag: '"v3"' }));
    const ui = await setup(save);
    await act(() => ui.draft.change({ body: "<p>Mine</p>" }));
    await act(async () => {
      await expect(ui.draft.flush()).rejects.toBeInstanceOf(NoteConflictError);
    });
    expect(ui.draft.status).toBe("conflict");
    await act(() => ui.draft.change({ body: "<p>Newer mine</p>" }));
    await act(async () => {
      await expect(ui.draft.flush()).rejects.toBeInstanceOf(NoteConflictError);
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(() => ui.draft.resolve(true));
    expect(ui.read).toHaveBeenCalledWith(original.url);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ etag: '"remote"' }),
      { title: "Title", body: "<p>Newer mine</p>", labels: [] },
      '"remote"',
    );
    expect(ui.draft.status).toBe("saved");
  });
  it("Load latest discards local edits and does not write them again", async () => {
    const save = vi.fn().mockRejectedValue(new NoteConflictError(original.url));
    const ui = await setup(save);
    await act(() => ui.draft.change({ body: "Mine" }));
    await act(async () => {
      await expect(ui.draft.flush()).rejects.toBeInstanceOf(NoteConflictError);
    });
    await act(() => ui.draft.resolve(false));
    expect(ui.draft.draft.body).toBe("<p>Remote</p>");
    await act(() => ui.draft.flush());
    expect(save).toHaveBeenCalledTimes(1);
    expect(ui.draft.status).toBe("saved");
  });
  it("flushes pending edits on unmount before the debounce fires", async () => {
    const ui = await setup();
    await act(() => ui.draft.change({ title: "Before leaving" }));
    await ui.unmount();
    expect(ui.save).toHaveBeenCalledExactlyOnceWith(
      original,
      { title: "Before leaving", body: original.body, labels: [] },
      '"v1"',
    );
  });
});
