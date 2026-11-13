// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, type MockInstance, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { NoteDialog } from "../src/apps/notes/components/note-dialog";
import { NoteVersionHistory } from "../src/apps/notes/components/version-history";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { getPendingDrafts } from "../src/apps/notes/state/draft-registry";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const mock = vi.hoisted(() => ({ context: {} as Record<string, unknown> }));
vi.mock("../src/apps/notes/state/notes-context", () => ({
  useNotesContext: () => mock.context,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const podRoot = "https://pod.example/";
let serial = 0;
let now: Date;
let stored: StoredNote;
let webId: string;
let store: ReturnType<typeof createNotesStore>;
let save: MockInstance<ReturnType<typeof createNotesStore>["save"]>;
let failWrite: number | undefined;
let writes: Headers[];
let http: typeof fetch;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.clear();
  webId = `${podRoot}profile#history-${++serial}`;
  now = new Date("2026-11-11T12:00:00Z");
  const pod = createDemoPod({ root: podRoot });
  failWrite = undefined;
  writes = [];
  http = async (input, init) => {
    if (init?.method === "PUT" && String(input).endsWith("original.ttl")) {
      writes.push(new Headers(init.headers));
      if (failWrite) {
        const status = failWrite;
        failWrite = undefined;
        return new Response(null, { status });
      }
    }
    return pod.fetch(input, init);
  };
  store = createNotesStore({ fetch: http, podRoot, webId, now: () => now });
  const original = await store.create({
    title: "Original",
    body: "<p>Original body</p>",
    labels: ["work"],
  });
  (original.revisions[0] as StoredNote["revisions"][number]).label = "First draft";
  now = new Date("2026-11-11T12:11:00Z");
  stored = await store.save(
    original,
    { title: "Current title", body: "<p>Current body</p>" },
    original.etag,
  );
  writes = [];
  save = vi.spyOn(store, "save");
  mock.context = {
    store,
    session: { webId, storageUrl: podRoot, fetch: http },
    refresh: vi.fn(async () => {}),
    prefs: { pinned: [], colours: {} },
    opener: { current: null },
    closeNote: vi.fn(),
    labels: [],
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const button = (name: string | RegExp) => screen.getByRole("button", { name });
async function openHistory() {
  fireEvent.click(button("More note actions"));
  fireEvent.click(button("Version history"));
  await screen.findByRole("dialog", { name: "Version history" });
}
async function selectFirst() {
  fireEvent.click(button(/First draft/));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Version preview" }).textContent).toBe(
      "Original body",
    ),
  );
}
async function restoreFirst() {
  await selectFirst();
  fireEvent.click(button("Restore this version"));
  fireEvent.click(button("Restore"));
}

it("lists newest first with time, author and labels, previews without saving, and returns focus to the menu", async () => {
  render(<NoteDialog note={stored} />);
  await openHistory();
  const list = screen.getByRole("list", { name: "Note versions" });
  const times = Array.from(list.querySelectorAll("time")).map((time) => time.dateTime);
  expect(times).toEqual(["2026-11-11T12:11:00.000Z", "2026-11-11T12:00:00.000Z"]);
  expect(within(list).getAllByText(webId)).toHaveLength(2);
  await selectFirst();
  expect(button(/First draft/).getAttribute("aria-current")).toBe("true");
  const preview = screen.getByRole("textbox", { name: "Version preview" });
  expect(preview.getAttribute("contenteditable")).toBe("false");
  expect(preview.getAttribute("aria-readonly")).toBe("true");
  expect(screen.getByRole("heading", { name: "Original" })).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(button("Current version"));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Version preview" }).textContent).toBe(
      "Current body",
    ),
  );
  fireEvent.click(button("Close version history"));
  await waitFor(() => expect(document.activeElement).toBe(button("More note actions")));
  expect((screen.getByRole("textbox", { name: "Note title" }) as HTMLInputElement).value).toBe(
    "Current title",
  );
});

it("confirms restore, flushes local edits first, preserves metadata and uses the acknowledged ETag", async () => {
  render(<NoteDialog note={stored} />);
  fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "Pending title" } });
  await openHistory();
  await selectFirst();
  fireEvent.click(button("Restore this version"));
  fireEvent.click(button("Cancel"));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(button("Restore this version"));
  fireEvent.click(button("Restore"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Version history" })).toBeNull());
  const saved = await store.read(stored.url);
  expect(saved).toMatchObject({
    title: "Original",
    body: "<p>Original body</p>",
    labels: ["work"],
  });
  expect(saved?.revisions[0]).toMatchObject({
    label: "Before restore",
    title: "Pending title",
    body: "<p>Current body</p>",
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(writes.map((headers) => headers.get("if-match"))).toEqual([
    stored.etag,
    (await save.mock.results[0]?.value)?.etag,
  ]);
  expect(getPendingDrafts(webId).get(stored.url)).toBeUndefined();
  expect((screen.getByLabelText("Note title") as HTMLInputElement).value).toBe("Original");
  await waitFor(() => expect(document.activeElement).toBe(button("More note actions")));
});

it("keeps a restore conflict in the normal draft flow, leaves the server intact, and loads the latest version", async () => {
  render(<NoteDialog note={stored} />);
  await act(async () => {
    await store.save(stored, { title: "Other editor" }, stored.etag);
  });
  save.mockClear();
  await openHistory();
  await restoreFirst();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Close version history to review"),
  );
  expect((await store.read(stored.url))?.title).toBe("Other editor");
  expect(getPendingDrafts(webId).get(stored.url)).toMatchObject({
    status: "conflict",
    draft: { title: "Original", preserveCurrent: true },
  });
  fireEvent.click(button("Close version history"));
  expect(screen.getByRole("alert").textContent).toContain("This note changed somewhere else");
  fireEvent.click(button("Load latest"));
  await waitFor(() =>
    expect((screen.getByLabelText("Note title") as HTMLInputElement).value).toBe("Other editor"),
  );
  expect(getPendingDrafts(webId).get(stored.url)).toBeUndefined();
});

it("aborts before restore when flushing the pending draft conflicts", async () => {
  render(<NoteDialog note={stored} />);
  fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "Local edits" } });
  await act(async () => {
    await store.save(stored, { title: "Remote edits" }, stored.etag);
  });
  save.mockClear();
  await openHistory();
  await restoreFirst();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("changed somewhere else"),
  );
  expect(save).toHaveBeenCalledOnce();
  expect(getPendingDrafts(webId).get(stored.url)?.draft.title).toBe("Local edits");
  expect((await store.read(stored.url))?.title).toBe("Remote edits");
});

it("keeps failed restores recoverable and retries through the editor's normal save path", async () => {
  render(<NoteDialog note={stored} />);
  await openHistory();
  failWrite = 503;
  await restoreFirst();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't restore"));
  expect((await store.read(stored.url))?.title).toBe("Current title");
  fireEvent.click(button("Close version history"));
  fireEvent.click(button("Retry"));
  await waitFor(() => expect(getPendingDrafts(webId).get(stored.url)).toBeUndefined());
  expect((await store.read(stored.url))?.revisions[0]).toMatchObject({
    title: "Current title",
    body: "<p>Current body</p>",
    label: "Before restore",
  });
});

it("disables history in Trash and lets view-only collaborators browse without restoring", async () => {
  const view = render(<NoteDialog note={{ ...stored, location: "trashed" }} />);
  fireEvent.click(button("More note actions"));
  expect((button("Version history") as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  render(<NoteDialog note={{ ...stored, readOnly: true }} />);
  await openHistory();
  await selectFirst();
  expect((button("Restore this version") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button("Restore this version"));
  expect(screen.queryByRole("dialog", { name: "Restore this version?" })).toBeNull();
  expect(save).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Version history" })).toBeNull());
});

it("stops restoring after a permission refusal and keeps browse access", async () => {
  render(<NoteDialog note={stored} />);
  await openHistory();
  failWrite = 403;
  await restoreFirst();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't restore"));
  expect((button("Restore this version") as HTMLButtonElement).disabled).toBe(true);
  expect(getPendingDrafts(webId).get(stored.url)?.status).toBe("read-only");
  expect((await store.read(stored.url))?.title).toBe("Current title");
});

it("previews legacy HTML through the editor sanitizer and keeps the title for untitled legacy revisions", async () => {
  const revision = {
    ...(stored.revisions[1] as StoredNote["revisions"][number]),
    title: undefined,
    attributedTo: undefined,
    body: '<p onclick="bad()">Safe <a href="javascript:bad()">link</a></p><script>bad()</script><img src="https://evil.example/track" onerror="bad()">',
  };
  const legacy = { ...stored, title: "", revisions: [revision] };
  render(<NoteDialog note={legacy} />);
  await openHistory();
  expect(screen.getByText("Unknown author")).toBeTruthy();
  fireEvent.click(button(/First draft/));
  const preview = await screen.findByRole("textbox", { name: "Version preview" });
  await waitFor(() => expect(preview.textContent).toBe("Safe link"));
  expect(preview.querySelector("script, img, [onclick], [onerror], a[href] ")).toBeNull();
  expect(screen.getByRole("heading", { name: "Untitled note" })).toBeTruthy();
  fireEvent.click(button("Restore this version"));
  fireEvent.click(button("Restore"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Version history" })).toBeNull());
  expect((await store.read(stored.url))?.title).toBe("");
});

it("shows an empty history and ignores a duplicate confirmation while restoring", async () => {
  const restore = vi.fn<() => Promise<void>>();
  let finish!: () => void;
  restore.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = {
    revisions: [],
    current: stored,
    readOnly: false,
    restore,
    close: vi.fn(),
    menu: { current: null },
    http,
    podRoot,
  };
  const view = render(<NoteVersionHistory {...props} />);
  expect(screen.getByText("No saved versions yet.")).toBeTruthy();
  view.rerender(<NoteVersionHistory {...props} revisions={stored.revisions} />);
  await restoreFirst();
  fireEvent.click(button("Restoring…"));
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
  expect(restore).toHaveBeenCalledOnce();
  expect(props.close).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Restore this version?" })).toBeNull(),
  );
});
