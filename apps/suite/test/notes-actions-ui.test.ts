// AUTHORED-BY Codex GPT-6
import type { Editor } from "@tiptap/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
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
const { CaptureBar } = await import("../src/apps/notes/components/capture-bar");
const { NoteDialog } = await import("../src/apps/notes/components/note-dialog");
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
beforeEach(() => {
  vi.clearAllMocks();
  const save = vi.fn(async (baseline, input) => ({ ...baseline, ...input, etag: '"v2"' }));
  mocks.context = {
    labels: ["A", "B"],
    create: vi.fn(async () => note()),
    store: { save, read: vi.fn() },
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
