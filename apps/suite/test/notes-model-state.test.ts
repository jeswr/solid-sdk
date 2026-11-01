// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import "./drive-ui-dom";
import { toast } from "@jeswr/suite-ui";
import { afterEach, expect, it, vi } from "vitest";
import { NoteConflictError } from "../src/apps/notes/lib/model/errors";
import { notesPreferencesSchema, togglePinned } from "../src/apps/notes/lib/model/prefs";
import { NotesStore, type StoredNote } from "../src/apps/notes/lib/model/store";
import { useNotesMutations } from "../src/apps/notes/state/mutations";
import { useNotesPreferences } from "../src/apps/notes/state/prefs";
import { useNote } from "../src/apps/notes/state/use-note";
import { useNotes } from "../src/apps/notes/state/use-notes";
import { act, deferred, h, mount } from "./drive-ui-dom";

const subscription = vi.hoisted(() => {
  const listeners = new Set<(url: string) => void>();
  return {
    listeners,
    subscribe: (listener: (url: string) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});
vi.mock("../src/lib/session/pod-session", () => ({
  usePodSessionState: () => ({ status: "ready", session: { subscribe: subscription.subscribe } }),
}));
afterEach(() => vi.restoreAllMocks());

const ROOT = "https://state.pod/notes/";
const note: StoredNote = {
  url: `${ROOT}note.ttl`,
  title: "Baseline",
  body: "<p>Body</p>",
  format: "text/html",
  labels: [],
  location: "active",
  revisions: [],
  etag: '"v1"',
};
function store() {
  return new NotesStore({
    podRoot: "https://state.pod/",
    webId: "https://state.pod/profile#me",
    fetch: vi.fn(),
  });
}

it("fences old refreshes, reloads on scoped session hints, and clears data on errors", async () => {
  const model = store();
  const first = deferred<StoredNote[]>();
  const second = deferred<StoredNote[]>();
  const list = vi
    .spyOn(model, "list")
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockResolvedValue([note]);
  let result!: ReturnType<typeof useNotes>;
  function Harness() {
    result = useNotes(model, { location: "active" });
    return null;
  }
  const view = await mount(h(Harness));
  expect(result.loading).toBe(true);
  let refresh!: Promise<void>;
  await act(() => {
    refresh = result.refresh();
  });
  await act(async () => {
    second.resolve([note]);
    await refresh;
  });
  expect(result.data).toEqual([note]);
  await act(() => first.resolve([]));
  expect(result.data).toEqual([note]);
  const count = list.mock.calls.length;
  await act(() => {
    for (const listener of subscription.listeners) {
      listener("broken");
      listener("https://evil.example/notes/note.ttl");
      listener("https://state.pod/notes-other/file");
    }
  });
  expect(list).toHaveBeenCalledTimes(count);
  await act(() => {
    for (const listener of subscription.listeners) listener(`${ROOT}archive/file.ttl`);
  });
  expect(list).toHaveBeenCalledTimes(count + 1);
  list.mockRejectedValueOnce(new Error("forbidden"));
  await act(() => result.refresh());
  expect(result.data).toBeUndefined();
  expect(result.error).toEqual(new Error("forbidden"));
  expect(result.loading).toBe(false);
  await view.unmount();
  expect(subscription.listeners.size).toBe(0);
});

it("switches note URLs without publishing an old note response", async () => {
  const model = store();
  const pending = deferred<StoredNote | undefined>();
  vi.spyOn(model, "read")
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ ...note, url: `${ROOT}new.ttl` });
  let result!: ReturnType<typeof useNote>;
  function Harness({ url }: { url: string }) {
    result = useNote(model, url);
    return null;
  }
  const view = await mount(h(Harness, { url: note.url }));
  await view.render(h(Harness, { url: `${ROOT}new.ttl` }));
  expect(result.data?.url).toBe(`${ROOT}new.ttl`);
  await act(() => pending.resolve(note));
  expect(result.data?.url).toBe(`${ROOT}new.ttl`);
});

it("keeps preferences per account, synchronizes consumers, handles storage events and unavailable storage", async () => {
  localStorage.clear();
  let a!: ReturnType<typeof useNotesPreferences>;
  let b!: ReturnType<typeof useNotesPreferences>;
  function Harness({ account }: { account: string }) {
    a = useNotesPreferences(account);
    b = useNotesPreferences(account);
    return null;
  }
  const view = await mount(h(Harness, { account: "alice" }));
  await act(() => a[1]((prefs) => togglePinned(prefs, note.url)));
  expect(b[0].pinned).toEqual([note.url]);
  expect(JSON.parse(localStorage.getItem("suite.notes.prefs.alice") as string).pinned).toEqual([
    note.url,
  ]);
  await view.render(h(Harness, { account: "bob" }));
  expect(a[0].pinned).toEqual([]);
  localStorage.setItem("suite.notes.prefs.bob", JSON.stringify({ view: "list" }));
  await act(() =>
    window.dispatchEvent(new window.StorageEvent("storage", { key: "suite.notes.prefs.bob" })),
  );
  expect(a[0].view).toBe("list");
  localStorage.setItem("suite.notes.prefs.bob", "invalid json");
  await act(() => window.dispatchEvent(new window.StorageEvent("storage", { key: null })));
  expect(a[0]).toEqual(notesPreferencesSchema.parse({}));
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  await act(() => a[1]((prefs) => togglePinned(prefs, "memory")));
  expect(b[0].pinned).toEqual(["memory"]);
  await view.render(h(Harness, { account: "alice" }));
  expect(a[0].pinned).toEqual([note.url]);
  await view.render(h(Harness, { account: "bob" }));
  expect(a[0].pinned).toEqual(["memory"]);
});

it("replays pending optimistic patches and removes only failed intents before reconciling success", async () => {
  const model = store();
  const first = deferred<StoredNote>();
  const second = deferred<StoredNote>();
  vi.spyOn(model, "save")
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockResolvedValue(note);
  const refresh = vi.fn(async () => {});
  let mutations!: ReturnType<typeof useNotesMutations>;
  function Harness() {
    mutations = useNotesMutations(model, refresh);
    return null;
  }
  await mount(h(Harness));
  let a!: Promise<unknown>, b!: Promise<unknown>;
  await act(() => {
    a = mutations.save(note, { title: "First" }).catch((error) => error);
    b = mutations.save(note, { title: "Second", body: "New body" }).catch((error) => error);
  });
  expect(mutations.project([note])[0]).toMatchObject({ title: "Second", body: "New body" });
  await act(async () => {
    first.reject(new Error("first"));
    await a;
  });
  expect(mutations.project([note])[0]).toMatchObject({ title: "Second", body: "New body" });
  await act(async () => {
    second.reject(new Error("second"));
    await b;
  });
  expect(mutations.project([note])).toEqual([note]);
  expect(mutations.pending).toBe(false);
  expect(mutations.error).toEqual(new Error("second"));
  await act(() => mutations.save(note, { labels: ["home"] }));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(mutations.error).toBeUndefined();
});

it("passes the confirmed ETag through permanent deletion, refreshes on conflict, and shows the change", async () => {
  const model = store();
  const conflict = new NoteConflictError(note.url);
  const deletion = vi.spyOn(model, "deleteForever").mockRejectedValue(conflict);
  const refresh = vi.fn(async () => {});
  const message = vi.spyOn(toast, "error").mockReturnValue("conflict");
  let mutations!: ReturnType<typeof useNotesMutations>;
  function Harness() {
    mutations = useNotesMutations(model, refresh);
    return null;
  }
  await mount(h(Harness));
  await act(async () => {
    await expect(mutations.deleteForever(note)).rejects.toBe(conflict);
  });
  expect(deletion).toHaveBeenCalledExactlyOnceWith(note.url, note.etag);
  expect(refresh).toHaveBeenCalledOnce();
  expect(message).toHaveBeenCalledWith(expect.stringContaining("changed somewhere else"));
  expect(mutations.project([note])).toEqual([note]);
});
