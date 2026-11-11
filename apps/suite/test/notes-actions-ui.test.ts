// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { Editor } from "@tiptap/react";
import { Parser, Store } from "n3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildDocument, parseDocument } from "../src/apps/docs/lib/model/document";
import type { StoredDocument } from "../src/apps/docs/lib/model/store";
import { NoteConflictError, NoteMoveBlockedError } from "../src/apps/notes/lib/model/errors";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { encodeRef } from "../src/lib/refs";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  push: vi.fn(),
  createDoc: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  editor: undefined as Editor | undefined,
}));
vi.mock("../src/apps/notes/state/notes-context", () => ({ useNotesContext: () => mocks.context }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/notes",
}));
vi.mock("../src/apps/docs/lib/model/store", () => ({
  createDocsStore: () => ({ create: mocks.createDoc }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: mocks.toast,
}));
vi.mock("@tiptap/react", async (original) => {
  const actual = await original<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      mocks.editor = editor ?? undefined;
      return editor;
    },
  };
});
const { getPendingDrafts } = await import("../src/apps/notes/state/draft-registry");
const captureKey = () =>
  `notes-capture-draft:${getPendingDrafts("https://pod.example/profile/card#me").tabId}`;
const { CaptureBar } = await import("../src/apps/notes/components/capture-bar");
const { NoteDialog } = await import("../src/apps/notes/components/note-dialog");
const { NotesGrid } = await import("../src/apps/notes/components/notes-grid");
const { NoteCard } = await import("../src/apps/notes/components/note-card");
const { NotesSidebar } = await import("../src/apps/notes/components/sidebar");
let serial = 0;
function note(): StoredNote {
  return {
    url: `https://pod.example/notes/ui-${++serial}.ttl`,
    title: "Original",
    body: "<p>Body</p>",
    labels: [],
    location: "active",
    format: "text/html",
    revisions: [],
    etag: '"v1"',
  };
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === text || element.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found as HTMLButtonElement;
}
async function fill(label: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  );
  expect(element).toBeTruthy();
  await act(() => {
    const prototype =
      element?.tagName === "INPUT"
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createDoc.mockReset();
  localStorage.clear();
  const save = vi.fn(async (baseline, input) => ({ ...baseline, ...input, etag: '"v2"' }));
  mocks.context = {
    labels: ["A", "B"],
    create: vi.fn(async () => note()),
    store: { save, read: vi.fn(), assertMovable: vi.fn(async () => {}) },
    refresh: vi.fn(async () => {}),
    session: {
      fetch: vi.fn(),
      storageUrl: "https://pod.example/",
      webId: "https://pod.example/#me",
    },
    prefs: { pinned: [], colours: {} },
    pin: vi.fn(),
    colour: vi.fn(),
    closeNote: vi.fn(),
    opener: { current: null },
    move: vi.fn(async (saved) => saved),
    reportError: vi.fn(),
    openShare: vi.fn(),
    persistLabels: vi.fn(),
  };
});

it("submits a nonempty capture on keyboard navigation unmount, once", async () => {
  const ui = await mount(h(CaptureBar));
  await act(() => document.querySelector<HTMLInputElement>('[aria-label="Take a note"]')?.focus());
  await fill("Note text", "Captured by keyboard\nFull text");
  await ui.unmount(); // Client navigation from an anchor activated with Enter.
  expect(mocks.context.create).toHaveBeenCalledExactlyOnceWith(
    {
      title: "Captured by keyboard",
      body: "<p>Captured by keyboard</p><p>Full text</p>",
      labels: [],
    },
    false,
    "default",
  );
});

it("captures unsupported checklist markers literally when keyboard navigation removes the form", async () => {
  const ui = await mount(h(CaptureBar));
  await act(() => document.querySelector<HTMLInputElement>('[aria-label="Take a note"]')?.focus());
  await fill("Note text", "[X] Done\nKeep <this> & that");
  await ui.unmount();
  expect(mocks.context.create).toHaveBeenCalledExactlyOnceWith(
    {
      title: "[X] Done",
      body: "<p>[X] Done</p><p>Keep &lt;this&gt; &amp; that</p>",
      labels: [],
    },
    false,
    "default",
  );
});

it.each([
  "Plain capture",
  "[X] Done",
])("restores raw capture text and its error after an unmounted create fails (%s)", async (raw) => {
  const writing = deferred<StoredNote>();
  const create = vi.fn().mockReturnValueOnce(writing.promise).mockResolvedValueOnce(note());
  mocks.context.create = create;
  const ui = await mount(h(CaptureBar));
  await act(() => document.querySelector<HTMLInputElement>('[aria-label="Take a note"]')?.focus());
  await fill("Note text", raw);
  await ui.unmount();
  await act(() => writing.reject(new Error("Offline")));
  expect(JSON.parse(localStorage.getItem(captureKey()) as string).body).toBe(raw);
  const reopened = await mount(h(CaptureBar));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Note text"]')?.value).toBe(raw);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn't create");
  if (raw.startsWith("[X]")) {
    await click(button("Close"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenLastCalledWith(
      expect.stringContaining("checklist markers"),
    );
    await fill("Note text", "[x] Done");
  }
  await click(button("Close"));
  expect(create).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(captureKey())).toBeNull();
  await reopened.unmount();
  expect(create).toHaveBeenCalledTimes(2);
});

it("restores a creation that started before navigation and then failed", async () => {
  const writing = deferred<StoredNote>();
  mocks.context.create = vi.fn().mockReturnValue(writing.promise);
  const ui = await mount(h(CaptureBar));
  await click(button("New list"));
  await fill("Note title", "Keep my list");
  await fill("List item 1", "First item");
  await click(button("Pin note"));
  await click(button("Close"));
  await ui.unmount();
  expect(mocks.context.create).toHaveBeenCalledTimes(1);
  await act(() => writing.reject(new Error("Offline")));
  const reopened = await mount(h(CaptureBar));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value).toBe(
    "Keep my list",
  );
  expect(document.querySelector<HTMLInputElement>('[aria-label="List item 1"]')?.value).toBe(
    "First item",
  );
  expect(button("Unpin note").getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn't create");
  mocks.context.create = vi.fn().mockResolvedValue(note());
  await reopened.unmount();
});

it("keeps a failed capture editable, and does not resubmit an unfinished Close on unmount", async () => {
  const first = deferred<StoredNote>();
  const create = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(note());
  mocks.context.create = create;
  const ui = await mount(h(CaptureBar));
  await act(() => document.querySelector<HTMLInputElement>('[aria-label="Take a note"]')?.focus());
  const line = "a".repeat(201);
  await fill("Note text", line);
  await click(button("Close"));
  expect(create).toHaveBeenCalledWith(
    { title: `${"a".repeat(199)}…`, body: `<p>${line}</p>`, labels: [] },
    false,
    "default",
  );
  await act(() => first.reject(new Error("Offline")));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Note text"]')?.value).toBe(line);
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Note text"]')?.disabled).toBe(
    false,
  );
  await fill("Note title", "Corrected");
  await click(button("Close"));
  expect(create).toHaveBeenLastCalledWith(
    { title: "Corrected", body: `<p>${line}</p>`, labels: [] },
    false,
    "default",
  );
  await ui.unmount();
  expect(create).toHaveBeenCalledTimes(2);
});

it("never duplicates a capture when navigation unmounts it during creation", async () => {
  const writing = deferred<StoredNote>();
  mocks.context.create = vi.fn().mockReturnValue(writing.promise);
  const ui = await mount(h(CaptureBar));
  await act(() => document.querySelector<HTMLInputElement>('[aria-label="Take a note"]')?.focus());
  await fill("Note title", "One capture");
  await click(button("Close"));
  await ui.unmount();
  expect(mocks.context.create).toHaveBeenCalledTimes(1);
  await act(() => writing.resolve(note()));
});

it.each([
  "Archive note",
  "Move to trash",
  "Close",
])("locks both editors before the initial %s flush and restores them on failure", async (action) => {
  const saving = deferred<StoredNote>();
  const store = mocks.context.store as { save: ReturnType<typeof vi.fn> };
  store.save.mockImplementationOnce(() => {
    expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.readOnly).toBe(
      true,
    );
    expect(mocks.editor?.isEditable).toBe(false);
    return saving.promise;
  });
  await mount(h(NoteDialog, { note: note() }));
  await fill("Note title", "Latest");
  await click(button(action));
  await act(() => saving.reject(new Error("Offline")));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.readOnly).toBe(
    false,
  );
  expect(mocks.editor?.isEditable).toBe(true);
  expect(mocks.context.move).not.toHaveBeenCalled();
});

it("confirms Open in Docs, holds the snapshot read-only during conversion, then trashes and navigates without Undo", async () => {
  const converting = deferred<{ url: string }>();
  mocks.createDoc.mockReturnValue(converting.promise);
  await mount(h(NoteDialog, { note: note() }));
  await fill("Note title", "Latest title");
  await click(button("Open in Docs"));
  expect(document.body.textContent).toContain(
    "This note moves to Trash in Notes, and you can restore it from there.",
  );
  expect(mocks.createDoc).not.toHaveBeenCalled();
  await click(button("Cancel"));
  expect(mocks.editor?.isEditable).toBe(true);
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(mocks.createDoc).toHaveBeenCalledExactlyOnceWith({
    title: "Latest title",
    body: "<p>Body</p>",
    format: "text/html",
  });
  expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.readOnly).toBe(
    true,
  );
  expect(mocks.editor?.isEditable).toBe(false);
  await fill("Note title", "Must not enter the draft");
  await act(() => converting.resolve({ url: "https://pod.example/docs/new.ttl" }));
  expect(mocks.context.move).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Latest title" }),
    "trash",
  );
  expect(mocks.push).toHaveBeenCalledOnce();
  expect(mocks.toast.success).not.toHaveBeenCalled();
});

it("unlocks the draft when document conversion fails", async () => {
  mocks.createDoc.mockRejectedValue(new Error("Offline"));
  await mount(h(NoteDialog, { note: note() }));
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.readOnly).toBe(
    false,
  );
  expect(mocks.editor?.isEditable).toBe(true);
  expect(mocks.context.move).not.toHaveBeenCalled();
});

it("reuses the created document after trashing fails, including after dismissing confirmation", async () => {
  const documentUrl = "https://pod.example/docs/converted.ttl";
  mocks.createDoc.mockResolvedValue({ url: documentUrl });
  const move = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(note());
  mocks.context.move = move;
  const original = note();
  await mount(h(NoteDialog, { note: original }));
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(move).toHaveBeenCalledTimes(1);
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.editor?.isEditable).toBe(true);
  await click(button("Open in Docs"));
  await click(button("Cancel"));
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(mocks.createDoc).toHaveBeenCalledExactlyOnceWith({
    title: original.title,
    body: original.body,
    format: "text/html",
  });
  expect(move).toHaveBeenCalledTimes(2);
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("/docs/d/"));
});

it("confirms an existing destination before merging labels", async () => {
  const store = mocks.context.store as Record<string, unknown>;
  store.renameLabelEverywhere = vi.fn(async () => []);
  await mount(h(NotesSidebar));
  await click(button("Edit labels"));
  await fill("Rename A", "B");
  const form = document.querySelector('[aria-label="Rename A"]')?.closest("form");
  await act(() => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(store.renameLabelEverywhere).not.toHaveBeenCalled();
  await click(button("Merge “A” into “B”?"));
  expect(store.renameLabelEverywhere).toHaveBeenCalledExactlyOnceWith("A", "B");
});

it.each([
  false,
  true,
])("persists unfinished capture before creation, flushes pagehide, and restores after reload (list=%s)", async (list) => {
  vi.useFakeTimers();
  const writing = deferred<StoredNote>();
  mocks.context.create = vi.fn().mockReturnValue(writing.promise);
  const ui = await mount(h(CaptureBar));
  if (list) await click(button("New list"));
  else
    await act(() =>
      document.querySelector<HTMLInputElement>('[aria-label="Take a note"]')?.focus(),
    );
  await fill("Note title", "Unfinished title");
  const field = list ? "List item 1" : "Note text";
  await fill(field, "First text");
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(JSON.parse(localStorage.getItem(captureKey()) as string)).toMatchObject({
    title: "Unfinished title",
    ...(list ? { items: [{ text: "First text", checked: false }] } : { body: "First text" }),
  });
  await fill(field, "Last keystroke before reload");
  await act(() => window.dispatchEvent(new Event("pagehide")));
  expect(mocks.context.create).not.toHaveBeenCalled();
  const durable = JSON.parse(localStorage.getItem(captureKey()) as string);
  expect(list ? durable.items[0].text : durable.body).toBe("Last keystroke before reload");
  await ui.unmount();
  await act(() => writing.reject(new Error("Cancelled by reload")));
  const reloaded = await mount(h(CaptureBar));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value).toBe(
    "Unfinished title",
  );
  expect(document.querySelector<HTMLInputElement>(`[aria-label="${field}"]`)?.value).toBe(
    "Last keystroke before reload",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn't create");
  mocks.context.create = vi.fn().mockResolvedValue(note());
  await reloaded.render(h(CaptureBar));
  await click(button("Close"));
  expect(localStorage.getItem(captureKey())).toBeNull();
  await reloaded.unmount();
});

function createdDocument(url = "https://pod.example/docs/converted.ttl"): StoredDocument {
  return {
    url,
    etag: '"doc-v1"',
    data: parseDocument(
      url,
      buildDocument(url, { title: "Original", body: "<p>Body</p>", format: "text/html" }),
    ) as StoredDocument["data"],
  };
}

it.each([
  200, 412,
])("refreshes a conversion retry after further title/body edits (document update %s)", async (status) => {
  const first = createdDocument();
  const replacement = createdDocument("https://pod.example/docs/newer.ttl");
  mocks.createDoc.mockResolvedValueOnce(first).mockResolvedValueOnce(replacement);
  const fetchImpl = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status, headers: { etag: '"doc-v2"' } }),
  );
  (mocks.context.session as { fetch: typeof fetch }).fetch = fetchImpl;
  const move = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(note());
  mocks.context.move = move;
  await mount(h(NoteDialog, { note: note() }));
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(mocks.editor?.isEditable).toBe(true);
  await fill("Note title", "Edited after conversion");
  await act(() =>
    mocks.editor?.commands.setContent("<p>More recent body</p>", { emitUpdate: true }),
  );
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
    first.url,
    expect.objectContaining({ method: "PUT" }),
  );
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  expect(new Headers(init.headers).get("if-match")).toBe(first.etag);
  const content = parseDocument(first.url, new Store(new Parser().parse(String(init.body))));
  expect(content).toMatchObject({
    title: "Edited after conversion",
    body: "<p>More recent body</p>",
  });
  expect(move).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: "Edited after conversion", body: "<p>More recent body</p>" }),
    "trash",
  );
  expect(mocks.createDoc).toHaveBeenCalledTimes(status === 412 ? 2 : 1);
  if (status === 412)
    expect(mocks.createDoc).toHaveBeenLastCalledWith({
      title: "Edited after conversion",
      body: "<p>More recent body</p>",
      format: "text/html",
    });
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
    `/docs/d/${encodeRef(status === 412 ? replacement.url : first.url)}`,
  );
});

it("retains the edited note and cached document validator if updating the conversion fails", async () => {
  const first = createdDocument();
  mocks.createDoc.mockResolvedValue(first);
  const fetchImpl = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 503 }),
  );
  (mocks.context.session as { fetch: typeof fetch }).fetch = fetchImpl;
  const move = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(note());
  mocks.context.move = move;
  await mount(h(NoteDialog, { note: note() }));
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  await fill("Note title", "Latest");
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(move).toHaveBeenCalledOnce();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.editor?.isEditable).toBe(true);
  fetchImpl.mockResolvedValue(new Response(null, { headers: { etag: '"doc-v2"' } }));
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("if-match")).toBe(first.etag);
  expect(move).toHaveBeenCalledTimes(2);
  expect(mocks.push).toHaveBeenCalledOnce();
});

it.each([
  "card",
  "empty trash",
])("keeps confirmed validators on refresh and shows deletion conflicts (%s)", async (surface) => {
  const confirmed = { ...note(), location: "trashed" as const };
  const replacement = { ...confirmed, etag: '"replacement"', title: "Unrelated" };
  const deletion = vi.fn().mockRejectedValue(new NoteConflictError(confirmed.url));
  mocks.context.mutations = { deleteForever: deletion };
  (mocks.context.store as Record<string, unknown>).deleteForever = deletion;
  mocks.context.notes = [confirmed];
  mocks.context.prefs = { pinned: [], colours: {}, view: "grid", manualOrder: [] };
  const resource = { data: [confirmed], loading: false };
  Object.assign(mocks.context, { active: resource, archived: resource, trashed: resource });
  const render = (n: StoredNote) =>
    surface === "card" ? h(NoteCard, { note: n }) : h(NotesGrid, { view: "trashed" });
  const ui = await mount(render(confirmed));
  await click(button(surface === "card" ? "Delete forever" : "Empty trash"));
  mocks.context.notes = [replacement];
  await ui.render(render(replacement));
  const confirm = document.querySelector<HTMLButtonElement>(
    ".notes-confirm-actions button:last-child",
  );
  expect(confirm).toBeTruthy();
  await click(confirm as HTMLButtonElement);
  expect(deletion).toHaveBeenCalledExactlyOnceWith(
    ...(surface === "card" ? [confirmed] : [confirmed.url, confirmed.etag]),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("changed somewhere else");
  if (surface === "empty trash") expect(mocks.context.refresh).toHaveBeenCalled();
});

it("offers Add to Tasks only for notes with unchecked checklist items", async () => {
  const checklist =
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Buy milk</p></div></li></ul>';
  const ui = await mount(h(NoteDialog, { note: { ...note(), body: checklist } }));
  await click(button("Add to Tasks"));
  expect(document.body.textContent).toContain("Each unchecked item becomes a task");
  expect(document.body.textContent).toContain("Buy milk");
  await click(button("Cancel"));
  expect(document.body.textContent).not.toContain("Each unchecked item becomes a task");
  await ui.unmount();
  await mount(h(NoteDialog, { note: note() }));
  expect(
    [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Add to Tasks"),
  ).toBe(false);
});

it("keeps pod image URLs when opening an image note in Docs", async () => {
  const original = {
    ...note(),
    body: '<p>Body</p><img src="https://pod.example/notes/media/bird.png" alt="A bird">',
  };
  const documentUrl = "https://pod.example/docs/converted-image.ttl";
  mocks.createDoc.mockResolvedValue({ url: documentUrl });
  await mount(h(NoteDialog, { note: original }));
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(mocks.createDoc).toHaveBeenCalledExactlyOnceWith({
    title: original.title,
    body: original.body,
    format: "text/html",
  });
  expect(mocks.context.move).toHaveBeenCalledWith(
    expect.objectContaining({ body: original.body }),
    "trash",
  );
  expect(mocks.push).toHaveBeenCalledWith(`/docs/d/${encodeRef(documentUrl)}`);
});

it("opens read-only notes with locked title and body, recovery actions and no writer", async () => {
  const target = { ...note(), readOnly: true };
  await mount(h(NoteDialog, { note: target }));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.readOnly).toBe(
    true,
  );
  expect(mocks.editor?.isEditable).toBe(false);
  expect(document.body.textContent).toContain("View only");
  expect(button("Copy local changes")).toBeTruthy();
  expect(button("Download local changes")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Collaborator");
  await click(button("Close"));
  expect(mocks.context.closeNote).toHaveBeenCalledOnce();
  expect((mocks.context.store as { save: unknown }).save).not.toHaveBeenCalled();
});

it("locks the mounted editor on a 403 save and keeps the local text available", async () => {
  const { ResourceWriteError } = await import("../src/apps/docs/lib/model/errors");
  const target = note();
  const save = vi.fn().mockRejectedValue(new ResourceWriteError(target.url, 403));
  mocks.context.store = { save };
  const ui = await mount(h(NoteDialog, { note: target }));
  await fill("Note title", "Local work");
  await click(button("Close"));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.readOnly).toBe(
    true,
  );
  expect(mocks.editor?.isEditable).toBe(false);
  expect(document.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value).toBe(
    "Local work",
  );
  const pending = getPendingDrafts((mocks.context.session as { webId: string }).webId);
  await act(() => pending.retry());
  await ui.unmount();
  expect(save).toHaveBeenCalledTimes(1);
  expect(pending.get(target.url)?.draft.title).toBe("Local work");
});

it("shows the shared card indicator only for known grants", async () => {
  const target = note();
  mocks.context.sharedNotes = {};
  const ui = await mount(h(NoteCard, { note: target }));
  expect(document.querySelector(".notes-shared-indicator")).toBeNull();
  mocks.context.sharedNotes = { [target.url]: false };
  await ui.render(h(NoteCard, { note: target }));
  expect(document.querySelector(".notes-shared-indicator")).toBeNull();
  mocks.context.sharedNotes = { [target.url]: true };
  await ui.render(h(NoteCard, { note: target }));
  expect(document.querySelector(".notes-shared-indicator")?.textContent).toBe("Shared");
});

it.each([
  ["active", "Archive note"],
  ["archived", "Unarchive note"],
  ["active", "Move to trash"],
  ["trashed", "Restore note"],
] as const)("shows the sharing refusal for %s / %s in the editor", async (location, label) => {
  const original = { ...note(), location };
  const error = new NoteMoveBlockedError(original.url);
  mocks.context.move = vi.fn().mockRejectedValue(error);
  await mount(h(NoteDialog, { note: original }));
  await click(button(label));
  expect(mocks.context.reportError).toHaveBeenCalledExactlyOnceWith(error);
  expect(mocks.context.closeNote).not.toHaveBeenCalled();
  expect(mocks.toast.error).not.toHaveBeenCalled();
  expect(button(label).disabled).toBe(false);
});

it("refuses Open in Docs before creating a copy of a shared note", async () => {
  const original = note();
  const error = new NoteMoveBlockedError(original.url);
  (
    mocks.context.store as { assertMovable: ReturnType<typeof vi.fn> }
  ).assertMovable.mockRejectedValue(error);
  await mount(h(NoteDialog, { note: original }));
  await click(button("Open in Docs"));
  await click(button("Open in Docs?"));
  expect(mocks.createDoc).not.toHaveBeenCalled();
  expect(mocks.context.move).not.toHaveBeenCalled();
  expect(mocks.context.reportError).toHaveBeenCalledExactlyOnceWith(error);
});

it("offers Share from a refused permanent deletion", async () => {
  const original = { ...note(), location: "trashed" as const };
  mocks.context.mutations = {
    deleteForever: vi.fn().mockRejectedValue(new NoteMoveBlockedError(original.url)),
  };
  await mount(h(NoteCard, { note: original }));
  await click(button("Delete forever"));
  await click(
    document.querySelector(".notes-confirm-actions button:last-child") as HTMLButtonElement,
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Stop sharing this note before archiving or deleting it.",
  );
  await click(button("Share"));
  expect(mocks.context.openShare).toHaveBeenCalledExactlyOnceWith(original.url);
  expect(document.querySelector(".notes-confirm")).toBeNull();
});

it("empty trash reports refused notes and continues deleting the rest", async () => {
  const shared = { ...note(), title: "Shared", location: "trashed" as const };
  const unknown = { ...note(), title: "Unknown", location: "trashed" as const };
  const unshared = { ...note(), location: "trashed" as const };
  const deletion = vi.fn(async (url: string) => {
    if (url !== unshared.url) throw new NoteMoveBlockedError(url);
  });
  Object.assign(mocks.context, {
    notes: [shared, unknown, unshared],
    active: {},
    archived: {},
    trashed: { data: [shared, unknown, unshared], loading: false },
    prefs: { pinned: [], colours: {}, view: "grid", manualOrder: [] },
    store: { deleteForever: deletion },
  });
  await mount(h(NotesGrid, { view: "trashed" }));
  await click(button("Empty trash"));
  await click(
    document.querySelector(".notes-confirm-actions button:last-child") as HTMLButtonElement,
  );
  expect(deletion).toHaveBeenCalledTimes(3);
  expect(deletion).toHaveBeenCalledWith(unshared.url, unshared.etag);
  expect(document.querySelector(".notes-confirm")).toBeNull();
  const alert = document.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Shared: Stop sharing");
  expect(alert?.textContent).toContain("Unknown: Stop sharing");
  expect(alert?.querySelectorAll("button")).toHaveLength(2);
  await click(alert?.querySelector("button") as HTMLButtonElement);
  expect(mocks.context.openShare).toHaveBeenCalledExactlyOnceWith(shared.url);
});
