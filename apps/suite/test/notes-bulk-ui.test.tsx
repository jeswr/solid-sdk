// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, expect, it, vi } from "vitest";
import { NoteMoveBlockedError } from "../src/apps/notes/lib/model/errors";
import type { NotesPreferences } from "../src/apps/notes/lib/model/prefs";
import type { NoteChanges, StoredNote } from "../src/apps/notes/lib/model/store";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

type MockNotesContext = {
  notes: StoredNote[];
  prefs: NotesPreferences;
  labels: string[];
  session: { storageUrl: string; fetch: ReturnType<typeof vi.fn>; webId: string };
  active: { data: StoredNote[] };
  archived: { data: StoredNote[] };
  trashed: { data: StoredNote[] };
  refresh: ReturnType<typeof vi.fn>;
  store: object;
  move: ReturnType<typeof vi.fn<(note: StoredNote, action: string) => Promise<StoredNote>>>;
  mutations: { save: ReturnType<typeof vi.fn>; deleteForever: ReturnType<typeof vi.fn> };
  pin: ReturnType<typeof vi.fn>;
  colour: ReturnType<typeof vi.fn>;
  openNote: ReturnType<typeof vi.fn>;
  openShare: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  attempt: (work: () => Promise<unknown>) => void;
};
const mocks = vi.hoisted(() => ({
  context: {} as MockNotesContext,
  realCapture: false,
  toast: { error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/notes",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/welcome/walkthrough", () => ({ WalkthroughDock: () => null }));
vi.mock("../src/apps/notes/state/notes-context", () => ({ useNotesContext: () => mocks.context }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: mocks.toast,
}));
vi.mock("../src/apps/notes/components/capture-bar", async (original) => {
  const { CaptureBar } =
    await original<typeof import("../src/apps/notes/components/capture-bar")>();
  return {
    CaptureBar: () =>
      mocks.realCapture
        ? h(CaptureBar)
        : h("div", { className: "notes-capture" }, h("input", { "aria-label": "Take a note" })),
  };
});

const { NotesGrid } = await import("../src/apps/notes/components/notes-grid");
const { ShortcutsProvider } = await import("../src/shell/shortcuts/provider");
const { SuiteFrame } = await import("../src/components/interim-shell/suite-frame");
const { SHORTCUTS_SETTING_KEY } = await import("../src/shell/lib/shortcut-settings");
const saved = (title: string, location: StoredNote["location"] = "active"): StoredNote => ({
  url: `https://pod.example/notes/${title}.ttl`,
  title,
  body: "",
  labels: ["Work"],
  format: "text/html",
  location,
  revisions: [],
  etag: '"v1"',
});
function button(name: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );
  expect(found, name).toBeDefined();
  return found as HTMLButtonElement;
}
function checkbox(title: string) {
  return document.querySelector<HTMLInputElement>(
    `[aria-label="Select ${title}"]`,
  ) as HTMLInputElement;
}
function toolbar() {
  return document.querySelector('[role="toolbar"][aria-label="Selected notes"]') as HTMLElement;
}
function render(view: "active" | "archived" | "trashed" | "search" = "active", query = "") {
  return h(ShortcutsProvider, {
    children: h(
      "div",
      {},
      h("input", { "data-global-search": true, "aria-label": "Search notes" }),
      h(NotesGrid, { view, query }),
    ),
  });
}
async function fill(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(
    `[aria-label="${label}"]`,
  ) as HTMLInputElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.realCapture = false;
  localStorage.clear();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const notes = [saved("Alpha"), saved("Beta"), saved("Gamma")];
  const prefs: NotesPreferences = { pinned: [saved("Alpha").url], colours: {}, view: "grid" };
  const move = vi.fn(async (note: StoredNote, action: string) => {
    mocks.context.notes = mocks.context.notes.filter((item: StoredNote) => item.url !== note.url);
    return {
      ...note,
      location: action === "archive" ? ("archived" as const) : ("active" as const),
    };
  });
  const save = vi.fn(async (note: StoredNote, changes: NoteChanges) => {
    const updated: StoredNote = {
      ...note,
      ...changes,
      labels: [...(changes.labels ?? note.labels)],
      reminder: changes.reminder === null ? undefined : (changes.reminder ?? note.reminder),
      etag: '"v2"',
    };
    mocks.context.notes = mocks.context.notes.map((item: StoredNote) =>
      item.url === note.url ? updated : item,
    );
    return updated;
  });
  mocks.context = {
    notes,
    prefs,
    labels: ["Work"],
    session: {
      storageUrl: "https://pod.example/",
      fetch: vi.fn(),
      webId: "https://pod.example/#me",
    },
    active: { data: notes },
    archived: { data: [] },
    trashed: { data: [] },
    refresh: vi.fn(async () => {}),
    store: {},
    move,
    mutations: { save, deleteForever: vi.fn(async () => {}) },
    pin: vi.fn((url: string) => {
      prefs.pinned = prefs.pinned.includes(url)
        ? prefs.pinned.filter((id) => id !== url)
        : [...prefs.pinned, url];
    }),
    colour: vi.fn(),
    openNote: vi.fn(),
    openShare: vi.fn(),
    create: vi.fn(async () => saved("New")),
    attempt: (work: () => Promise<unknown>) => void work(),
  };
});

it("selects ranges across sections, toggles with a card click, announces the count and clears with Escape", async () => {
  await mount(render());
  const titles = [...document.querySelectorAll(".notes-card h3")].map(
    (element) => element.textContent as string,
  );
  await click(checkbox(titles[0] as string));
  expect(toolbar()).toBeTruthy();
  expect(document.querySelector("h1")?.textContent).toBe("1 selected");
  await act(() =>
    checkbox(titles[2] as string).dispatchEvent(
      new MouseEvent("click", { bubbles: true, shiftKey: true }),
    ),
  );
  expect(document.querySelector("h1")?.textContent).toBe("3 selected");
  expect(document.querySelector('p[aria-live="polite"]')?.textContent).toBe("3 selected");
  await click(button(`Open ${titles[1]}`));
  expect(checkbox(titles[1] as string).checked).toBe(false);
  expect(mocks.context.openNote).not.toHaveBeenCalled();
  await key(document.body, "Escape");
  expect(toolbar()).toBeNull();
  expect(document.querySelector("h1")?.textContent).toBe("Notes");
});

it("uses roving focus in the labelled toolbar and clears with its button", async () => {
  await mount(render());
  await click(checkbox("Alpha"));
  const controls = [...toolbar().querySelectorAll<HTMLButtonElement>("button")];
  expect(controls.filter((control) => control.tabIndex === 0)).toHaveLength(1);
  await act(() => controls[0]?.focus());
  await key(controls[0] as HTMLButtonElement, "ArrowRight");
  expect(document.activeElement).toBe(controls[1]);
  await key(controls[1] as HTMLButtonElement, "End");
  expect(document.activeElement).toBe(controls.at(-1));
  await click(button("Clear selection", toolbar()));
  expect(toolbar()).toBeNull();
});

it("keeps successes, selects failures and retries only the failed note with a fresh ETag", async () => {
  const original = mocks.context.notes[1] as StoredNote;
  const archive = mocks.context.move;
  archive.mockImplementation(async (note: StoredNote) => {
    if (note.url === original.url && note.etag === '"v1"') {
      mocks.context.notes = mocks.context.notes.map((item: StoredNote) =>
        item.url === note.url ? { ...item, etag: '"v2"' } : item,
      );
      throw new Error("Conflict");
    }
    mocks.context.notes = mocks.context.notes.filter((item: StoredNote) => item.url !== note.url);
    return note;
  });
  await mount(render());
  await click(checkbox("Alpha"));
  await click(checkbox("Beta"));
  await click(button("Archive", toolbar()));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "1 of 2 notes couldn't be archived",
  );
  expect(checkbox("Alpha")).toBeNull();
  expect(checkbox("Beta").checked).toBe(true);
  expect(document.querySelector("h1")?.textContent).toBe("1 selected");
  await click(button("Retry failed notes"));
  expect(archive).toHaveBeenCalledTimes(3);
  expect(archive).toHaveBeenLastCalledWith({ ...original, etag: '"v2"' }, "archive");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(checkbox("Beta")).toBeNull();
});

it("keeps the count stable during optimistic removal and prevents duplicate bulk writes", async () => {
  const gate = deferred<void>();
  mocks.context.move.mockImplementation(async (note: StoredNote) => {
    mocks.context.notes = mocks.context.notes.filter((item: StoredNote) => item.url !== note.url);
    await gate.promise;
    return note;
  });
  await mount(render());
  await click(checkbox("Alpha"));
  await click(button("Archive", toolbar()));
  expect(document.querySelector("h1")?.textContent).toBe("1 selected");
  expect(button("Archive", toolbar()).disabled).toBe(true);
  await key(document.body, "e");
  await key(document.body, "Escape");
  expect(mocks.context.move).toHaveBeenCalledTimes(1);
  await act(() => gate.resolve());
  expect(toolbar()).toBeNull();
});

it.each([
  true,
  false,
])("reports bulk failures and retries only failed notes across navigation (leave while pending: %s)", async (leaveWhilePending) => {
  const gate = deferred<StoredNote>();
  const failed = saved("Beta");
  mocks.context.move.mockImplementation(async (note: StoredNote) => {
    if (note.url === failed.url && note.etag === failed.etag) return gate.promise;
    const moved = { ...note, location: "archived" as const };
    mocks.context.notes = mocks.context.notes.map((item) => (item.url === note.url ? moved : item));
    return moved;
  });
  const ui = await mount(render());
  await click(checkbox("Alpha"));
  await click(checkbox("Beta"));
  await click(button("Archive", toolbar()));
  if (leaveWhilePending) {
    await ui.render(render("archived"));
    expect(toolbar()).toBeNull();
  }
  await act(() => gate.reject(new Error("403")));
  const [message, options] = mocks.toast.error.mock.lastCall ?? [];
  expect(message).toBe("1 of 2 notes couldn't be archived");
  expect(options.action.label).toBe("Retry");
  if (!leaveWhilePending) await ui.render(render("archived"));
  expect(toolbar()).toBeNull();
  expect(document.querySelector(".notes-bulk-failure")?.textContent).toContain(message);
  await click(checkbox("Alpha"));
  mocks.context.notes = mocks.context.notes.map((note) =>
    note.url === failed.url ? { ...note, etag: '"v2"' } : note,
  );
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await ui.render(render("archived"));
  await act(() => options.action.onClick());
  expect(mocks.context.move).toHaveBeenCalledTimes(2);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await ui.render(render("archived"));
  await act(() => options.action.onClick());
  expect(mocks.context.move).toHaveBeenCalledTimes(3);
  expect(mocks.context.move).toHaveBeenLastCalledWith({ ...failed, etag: '"v2"' }, "archive");
  expect(checkbox("Alpha").checked).toBe(true);
  expect(checkbox("Beta").checked).toBe(false);
  expect(document.querySelector(".notes-bulk-failure")).toBeNull();
  expect(mocks.toast.dismiss).toHaveBeenCalledWith(options.id);
});

it("offers restore and confirmed permanent deletion only in Trash", async () => {
  mocks.context.notes = [saved("Discarded", "trashed")];
  await mount(render("trashed"));
  await click(checkbox("Discarded"));
  expect([...toolbar().querySelectorAll("button")].map((element) => element.textContent)).toEqual([
    "Clear selection",
    "Restore",
    "Delete forever",
  ]);
  await click(button("Delete forever", toolbar()));
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog.textContent).toContain("Permanently delete 1 selected notes?");
  expect(mocks.context.mutations.deleteForever).not.toHaveBeenCalled();
  await click(button("Cancel", dialog));
  expect(checkbox("Discarded").checked).toBe(true);
  await click(button("Delete forever", toolbar()));
  await click(button("Delete forever", document.querySelector('[role="dialog"]') as HTMLElement));
  expect(mocks.context.mutations.deleteForever).toHaveBeenCalledExactlyOnceWith(
    saved("Discarded", "trashed"),
  );
});

it("adds/removes labels without losing unrelated labels and offers colour choices", async () => {
  await mount(render());
  await click(checkbox("Alpha"));
  await click(button("Labels", toolbar()));
  await fill("Label name", "Home");
  await click(button("Add label", document.querySelector('[role="dialog"]') as HTMLElement));
  expect(mocks.context.mutations.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: "Alpha" }),
    { labels: ["Work", "Home"] },
  );
  expect(checkbox("Alpha").checked).toBe(true);
  await click(button("Labels", toolbar()));
  await fill("Label name", "Work");
  await click(button("Remove label", document.querySelector('[role="dialog"]') as HTMLElement));
  expect(mocks.context.mutations.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ etag: '"v2"' }),
    { labels: ["Home"] },
  );
  await click(button("Colour", toolbar()));
  await click(button("Note colour", document.querySelector('[role="dialog"]') as HTMLElement));
  await click(document.querySelector('[aria-label="Yellow"]') as HTMLElement);
  expect(mocks.context.colour).toHaveBeenCalledWith(saved("Alpha").url, "yellow");
  expect(checkbox("Alpha").checked).toBe(true);
});

it.each([
  { colours: ["yellow", "yellow"], checked: "Yellow", target: "Default", value: "default" },
  { colours: ["yellow", "blue"], checked: undefined, target: "Default", value: "default" },
  { colours: ["default", "yellow"], checked: undefined, target: "Yellow", value: "yellow" },
  { colours: ["default", "default"], checked: "Default", target: "Blue", value: "blue" },
] as const)("shows common or mixed bulk colours and applies $target for $colours", async (test) => {
  mocks.context.prefs.colours = {
    [saved("Alpha").url]: test.colours[0],
    [saved("Beta").url]: test.colours[1],
  };
  await mount(render());
  await click(checkbox("Alpha"));
  await click(checkbox("Beta"));
  await click(button("Colour", toolbar()));
  await click(button("Note colour", document.querySelector('[role="dialog"]') as HTMLElement));
  const checked = [...document.querySelectorAll<HTMLInputElement>(".notes-swatches input:checked")];
  expect(checked.map((input) => input.getAttribute("aria-label"))).toEqual(
    test.checked ? [test.checked] : [],
  );
  await click(document.querySelector(`[aria-label="${test.target}"]`) as HTMLElement);
  expect(mocks.context.colour).toHaveBeenCalledTimes(2);
  for (const title of ["Alpha", "Beta"])
    expect(mocks.context.colour).toHaveBeenCalledWith(saved(title).url, test.value);
});

it("disables unqueueable pod writes offline with a reason while allowing local pin changes", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await mount(render());
  await click(checkbox("Alpha"));
  expect(button("Archive", toolbar()).disabled).toBe(true);
  expect(document.querySelector(".notes-selection-heading")?.textContent).toContain(
    "cannot be queued",
  );
  await key(document.body, "e");
  expect(mocks.context.move).not.toHaveBeenCalled();
  await click(button("Unpin", toolbar()));
  expect(mocks.context.pin).toHaveBeenCalledWith(saved("Alpha").url);
});

it("navigates, opens, selects, pins and archives using the shared shortcut registry", async () => {
  await mount(render());
  await key(document.body, "j");
  expect(document.activeElement).toBe(button("Open Alpha"));
  await key(document.activeElement as HTMLElement, "j");
  const next = document.activeElement as HTMLElement;
  expect(next).not.toBe(button("Open Alpha"));
  await key(next, "k");
  expect(document.activeElement).toBe(button("Open Alpha"));
  await key(document.activeElement as HTMLElement, "o");
  expect(mocks.context.openNote).toHaveBeenCalledWith(saved("Alpha"), button("Open Alpha"));
  await key(document.activeElement as HTMLElement, "Enter");
  expect(mocks.context.openNote).toHaveBeenCalledTimes(2);
  await key(document.activeElement as HTMLElement, "x");
  expect(checkbox("Alpha").checked).toBe(true);
  await key(document.activeElement as HTMLElement, "f");
  expect(mocks.context.pin).toHaveBeenCalledWith(saved("Alpha").url);
  await key(document.activeElement as HTMLElement, "e");
  expect(mocks.context.move).toHaveBeenCalledWith(saved("Alpha"), "archive");
});

it("handles shifted #, ignores editable targets and dialogs, and lists Notes keys in the existing help dialog", async () => {
  await mount(render());
  await key(document.body, "j");
  for (const tag of ["input", "textarea", "div"]) {
    const editor = document.createElement(tag);
    if (tag === "div") editor.setAttribute("contenteditable", "true");
    document.body.append(editor);
    await act(() => editor.focus());
    for (const shortcut of ["j", "k", "o", "Enter", "e", "#", "f", "x", "c", "/", "?"])
      await key(editor, shortcut, ["#", "?"].includes(shortcut));
    expect(document.activeElement).toBe(editor);
    editor.remove();
  }
  expect(mocks.context.move).not.toHaveBeenCalled();
  expect(mocks.context.openNote).not.toHaveBeenCalled();
  await act(() => button("Open Alpha").focus());
  await key(document.activeElement as HTMLElement, "?", true);
  const help = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(help.textContent).toContain("Keyboard shortcuts");
  for (const description of [
    "Next note",
    "Previous note",
    "Open note",
    "Archive or unarchive notes",
    "Move notes to trash",
    "Pin or unpin notes",
    "Select note",
    "New note",
    "Search notes",
  ])
    expect(help.textContent).toContain(description);
  await key(help, "e");
  expect(mocks.context.move).not.toHaveBeenCalled();
  await key(help, "Escape");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await key(document.body, "#", true);
  expect(mocks.context.move).toHaveBeenCalledWith(saved("Alpha"), "trash");
});

it("clears selection when the folder or search changes and respects the single-key setting", async () => {
  const ui = await mount(render());
  await click(checkbox("Alpha"));
  await ui.render(render("search"));
  expect(toolbar()).toBeNull();
  await act(() =>
    checkbox("Gamma").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })),
  );
  expect(document.querySelector("h1")?.textContent).toBe("1 selected");
  expect(checkbox("Alpha").checked).toBe(false);
  await ui.render(render("search", "Alpha"));
  expect(toolbar()).toBeNull();
  await click(checkbox("Alpha"));
  await ui.render(render("search", "Beta"));
  expect(toolbar()).toBeNull();
  localStorage.setItem(SHORTCUTS_SETTING_KEY, "off");
  await act(() => window.dispatchEvent(new Event("storage")));
  await key(document.body, "j");
  expect(document.activeElement).toBe(document.body);
});

it("focuses search and capture, and creates a new note from Archive", async () => {
  const ui = await mount(render());
  await key(document.body, "/");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Search notes");
  await act(() => (document.activeElement as HTMLElement).blur());
  await key(document.body, "c");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Take a note");
  await ui.render(render("archived"));
  await key(document.body, "c");
  expect(mocks.context.create).toHaveBeenCalledExactlyOnceWith({}, false, "default");
  expect(mocks.context.openNote).toHaveBeenCalledWith(saved("New"), document.body);
});

it("focuses an expanded checklist capture from its footer without creating a blank note", async () => {
  mocks.realCapture = true;
  await mount(render());
  await click(button("New list"));
  await fill("Note title", "Shopping");
  await fill("List item 1", "Apples");
  const capture = document.querySelector(".notes-capture") as HTMLElement;
  await act(() => button("Close", capture).focus());
  await key(document.activeElement as HTMLElement, "c");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Note title");
  expect(capture.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value).toBe(
    "Shopping",
  );
  expect(capture.querySelector<HTMLInputElement>('[aria-label="List item 1"]')?.value).toBe(
    "Apples",
  );
  expect(mocks.context.create).not.toHaveBeenCalled();
  expect(mocks.context.openNote).not.toHaveBeenCalled();
});

it("keeps selection when Escape closes help, then clears it even from an editable field", async () => {
  await mount(render());
  await click(checkbox("Alpha"));
  await key(document.body, "?", true);
  const help = document.querySelector('[role="dialog"]') as HTMLElement;
  await key(help, "Escape");
  expect(checkbox("Alpha").checked).toBe(true);
  const input = document.querySelector('[aria-label="Take a note"]') as HTMLInputElement;
  await act(() => input.focus());
  await key(input, "Escape");
  expect(toolbar()).toBeNull();
});

it("clears selection on a load error and never offers a mutation for read-only notes", async () => {
  mocks.context.notes[0] = { ...saved("Alpha"), readOnly: true };
  const ui = await mount(render());
  await click(checkbox("Alpha"));
  expect([...toolbar().querySelectorAll("button")].map((element) => element.textContent)).toEqual([
    "Clear selection",
  ]);
  expect(document.querySelector(".notes-selection-heading")?.textContent).toContain(
    "Read-only or pending",
  );
  mocks.context.active = { data: [], error: new Error("403") } as typeof mocks.context.active;
  await ui.render(render());
  expect(toolbar()).toBeNull();
});

it("keeps the interim frame's search shortcut from taking focus out of help", async () => {
  await mount(
    h(ShortcutsProvider, {
      children: h(SuiteFrame, {
        app: "notes",
        sidebar: null,
        search: { placeholder: "Search notes", action: "/notes/search", scopeLabel: "in Notes" },
        children: h(NotesGrid),
      }),
    }),
  );
  await key(document.body, "?");
  const help = document.querySelector('[role="dialog"]') as HTMLElement;
  const focused = document.activeElement;
  expect(help.contains(focused)).toBe(true);
  await key(help, "/");
  expect(document.activeElement).toBe(focused);
  await key(help, "Escape");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await key(document.body, "/");
  expect(document.activeElement?.getAttribute("data-global-search")).not.toBeNull();
});

it("keeps the single-note sharing remedy on a refused bulk move", async () => {
  mocks.context.move.mockRejectedValue(new NoteMoveBlockedError(saved("Alpha").url));
  await mount(render());
  await click(checkbox("Alpha"));
  await click(button("Archive", toolbar()));
  expect(document.querySelector(".notes-bulk-failure")?.textContent).toContain(
    "Stop sharing this note before archiving or deleting it.",
  );
  await click(button("Share", document.querySelector(".notes-bulk-failure") as HTMLElement));
  expect(mocks.context.openShare).toHaveBeenCalledExactlyOnceWith(saved("Alpha").url);
});

it("retains multiple selected notes after pinning so the next action applies to the same set", async () => {
  await mount(render());
  await click(checkbox("Alpha"));
  await click(checkbox("Beta"));
  await click(button("Pin", toolbar()));
  expect(checkbox("Alpha").checked).toBe(true);
  expect(checkbox("Beta").checked).toBe(true);
  expect(mocks.context.pin).toHaveBeenCalledExactlyOnceWith(saved("Beta").url);
  await click(button("Archive", toolbar()));
  expect(mocks.context.move).toHaveBeenCalledTimes(2);
  expect(toolbar()).toBeNull();
});
