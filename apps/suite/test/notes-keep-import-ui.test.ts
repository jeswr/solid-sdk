// AUTHORED-BY Claude Opus 5.5
import { beforeEach, expect, it, vi } from "vitest";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("../src/apps/notes/state/notes-context", () => ({ useNotesContext: () => mocks.context }));
vi.mock("next/navigation", () => ({ usePathname: () => "/notes" }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: mocks.toast,
}));
const { KeepImportDialog } = await import("../src/apps/notes/components/keep-import");
const { NotesSidebar } = await import("../src/apps/notes/components/sidebar");

let serial = 0;
const stored = (title = ""): StoredNote => ({
  url: `https://pod.example/notes/k-${++serial}.ttl`,
  title,
  body: "",
  labels: [],
  location: "active",
  format: "text/html",
  revisions: [],
  etag: '"v1"',
});
const keepFile = (name: string, note: Record<string, unknown>, path = `Takeout/Keep/${name}`) => {
  const file = new File([JSON.stringify(note)], name, { type: "application/json" });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
};
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found as HTMLButtonElement;
}
const text = () => document.body.textContent ?? "";
async function choose(label: string, files: File[]) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(input).not.toBeNull();
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => {
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

type Prefs = { pinned: string[]; colours: Record<string, string> };
let prefs: Prefs;
const loadedList = () => ({ data: [], error: undefined });
const create = () => (mocks.context.store as { create: ReturnType<typeof vi.fn> }).create;
const archive = () => (mocks.context.store as { archive: ReturnType<typeof vi.fn> }).archive;

beforeEach(() => {
  vi.clearAllMocks();
  prefs = { pinned: [], colours: {} };
  mocks.context = {
    notes: [
      { ...stored("Old"), body: "<p>Kept</p>" },
      { ...stored("Binned"), body: "<p>x</p>", location: "trashed" },
    ],
    store: {
      create: vi.fn(async (input: { title: string }) => stored(input.title)),
      archive: vi.fn(async (note: StoredNote) => ({
        ...note,
        url: note.url.replace("/notes/", "/notes/archive/"),
        location: "archived",
      })),
    },
    updatePrefs: vi.fn((change: (value: Prefs) => Prefs) => {
      prefs = change(prefs);
    }),
    active: loadedList(),
    archived: loadedList(),
    trashed: loadedList(),
    refresh: vi.fn(async () => {}),
    labels: [],
    persistLabels: vi.fn(),
  };
});

it("opens from the sidebar and imports a Takeout folder with pins, colours and archive", async () => {
  const ui = await mount(h(NotesSidebar));
  await click(button("Import from Keep"));
  expect(text()).toContain("Import from Google Keep");
  const folder = document.querySelector<HTMLInputElement>('input[aria-label="Keep folder"]');
  expect(folder?.hasAttribute("webkitdirectory")).toBe(true);
  await choose("Keep folder", [
    keepFile("Shopping.json", {
      title: "Shopping",
      listContent: [{ text: "Milk", isChecked: true }],
      isPinned: true,
      color: "YELLOW",
      labels: [{ name: "Home" }],
      attachments: [{ filePath: "a.jpg", mimetype: "image/jpeg" }],
    }),
    keepFile("Ideas.json", {
      title: "Ideas",
      textContent: "Plant beans",
      isArchived: true,
      isPinned: true,
      color: "GREEN",
    }),
    keepFile("Old.json", { title: "Old", textContent: "Kept" }),
    keepFile("Binned.json", { title: "Binned", textContent: "x", isTrashed: true }),
    keepFile("Broken.json", { title: 1 }),
    keepFile("Shopping.html", {}),
    new File(["x".repeat(1024 * 1024 + 1)], "Huge.json"),
  ]);
  expect(text()).toContain("2 notes ready to import.");
  expect(text()).toContain("1 note from Keep's Trash will be left out.");
  expect(text()).toContain("1 image or recording will stay in Takeout");
  expect(text()).toContain("1 other file in the selection will be ignored.");
  expect(text()).toContain("3 files can't be imported");
  expect(text()).toContain("Huge.json: Larger than 1 MB");
  expect(text()).toContain("Takeout/Keep/Old.json: Already in Notes");
  expect(text()).toContain("Takeout/Keep/Broken.json: Not a Google Keep note");
  await click(button("Import 2 notes"));
  expect(create()).toHaveBeenNthCalledWith(1, {
    title: "Shopping",
    body: expect.stringContaining("Milk"),
    labels: ["Home"],
  });
  expect(create()).toHaveBeenNthCalledWith(2, {
    title: "Ideas",
    body: "<p>Plant beans</p>",
    labels: [],
  });
  expect(archive()).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Ideas" }));
  // Pins and colours follow each note to its final (archived) address.
  expect(prefs.pinned).toHaveLength(2);
  expect(prefs.pinned[1]).toContain("/notes/archive/");
  expect(Object.values(prefs.colours)).toEqual(["yellow", "green"]);
  // One list refresh for the whole import, not one per note.
  expect(mocks.context.refresh).toHaveBeenCalledOnce();
  expect(text()).toContain("Imported 2 notes.");
  await click(button("Done"));
  expect(text()).not.toContain("Import from Google Keep");
  await ui.unmount();
});

it("waits for every note list before checking for duplicates", async () => {
  mocks.context.archived = { data: undefined, error: undefined };
  const ui = await mount(h(KeepImportDialog, { open: true, close: vi.fn() }));
  expect(text()).toContain("Loading the notes you already have…");
  expect(button("Choose Keep folder").disabled).toBe(true);
  expect(button("Choose note files").disabled).toBe(true);
  mocks.context.archived = { data: undefined, error: new Error("403") };
  await ui.render(h(KeepImportDialog, { open: true, close: vi.fn() }));
  expect(text()).toContain("Couldn't load all of your notes");
  expect(text()).not.toContain("Loading the notes you already have…");
  await click(button("Try again"));
  expect(mocks.context.refresh).toHaveBeenCalledOnce();
  (mocks.context.refresh as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("offline"));
  await click(button("Try again"));
  mocks.context.archived = loadedList();
  await ui.render(h(KeepImportDialog, { open: true, close: vi.fn() }));
  expect(button("Choose note files").disabled).toBe(false);
  await ui.unmount();
});

it("reports failures, retries only notes not yet in the pod, and notes archive failures", async () => {
  const close = vi.fn();
  create().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
  archive().mockRejectedValueOnce(new Error("412"));
  const ui = await mount(h(KeepImportDialog, { open: true, close }));
  await choose("Keep note files", [
    keepFile("A.json", { title: "A", textContent: "a", isArchived: true, color: "MAUVE" }),
    keepFile("B.json", { title: "B", textContent: "b" }),
    keepFile("C.json", { title: "C", textContent: "c", isArchived: true }),
  ]);
  expect(text()).toContain("1 note had a colour or link Notes can't use; the rest of it");
  await click(button("Import 3 notes"));
  expect(text()).toContain("Imported 1 note.");
  expect(text()).toContain("1 note couldn't be moved to the Archive and is in Notes instead.");
  expect(text()).toContain("2 notes couldn't be saved to your pod.");
  // B reached the pod after all; only A is retried.
  mocks.context.notes = [{ ...stored("B"), body: "<p>b</p>" }];
  await ui.render(h(KeepImportDialog, { open: true, close }));
  await click(button("Try again"));
  expect(create()).toHaveBeenCalledTimes(4);
  expect(create()).toHaveBeenLastCalledWith({ title: "A", body: "<p>a</p>", labels: [] });
  expect(text()).toContain("Imported 1 note.");
  await click(button("Done"));
  expect(close).toHaveBeenCalledOnce();
  await ui.unmount();
});

async function startTwo(close: () => void) {
  const first = deferred<StoredNote>();
  create().mockReturnValueOnce(first.promise);
  const ui = await mount(h(KeepImportDialog, { open: true, close }));
  await choose("Keep note files", [
    keepFile("A.json", { title: "A", textContent: "a" }),
    keepFile("B.json", { title: "B", textContent: "b" }),
  ]);
  await click(button("Import 2 notes"));
  expect(text()).toContain("Importing 0 of 2…");
  return { ui, first };
}

it("stops between notes from the Stop button and offers to import the rest", async () => {
  const { ui, first } = await startTwo(vi.fn());
  await click(button("Stop"));
  expect(text()).toContain("Stopping after this note…");
  expect(button("Stop").disabled).toBe(true);
  await act(() => first.resolve(stored("A")));
  expect(create()).toHaveBeenCalledTimes(1);
  expect(text()).toContain("Imported 1 note.");
  expect(text()).toContain("Stopped with 1 note still to import.");
  await click(button("Import the rest"));
  expect(create()).toHaveBeenLastCalledWith({ title: "B", body: "<p>b</p>", labels: [] });
  expect(text()).toContain("Imported 1 note.");
  await ui.unmount();
});

it("stops instead of closing when the dialog is dismissed mid-import", async () => {
  const close = vi.fn();
  const { ui, first } = await startTwo(close);
  await act(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(close).not.toHaveBeenCalled();
  expect(text()).toContain("Stopping after this note…");
  await act(() => first.resolve(stored("A")));
  expect(create()).toHaveBeenCalledTimes(1);
  expect(text()).toContain("Stopped with 1 note still to import.");
  await ui.unmount();
});

it("handles empty choices, nothing to import, unreadable files and choosing again", async () => {
  const ui = await mount(h(KeepImportDialog, { open: true, close: vi.fn() }));
  await choose("Keep note files", []);
  expect(text()).toContain("Choose Keep folder");
  await choose("Keep note files", [keepFile("Old.json", { title: "Old", textContent: "Kept" })]);
  expect(text()).toContain("No notes to import from these files.");
  expect(button("Import").disabled).toBe(true);
  await click(button("Choose other files"));
  const broken = new File(["{}"], "Bad.json");
  Object.defineProperty(broken, "text", { value: () => Promise.reject(new Error("gone")) });
  await choose("Keep note files", [broken]);
  expect(mocks.toast.error).toHaveBeenCalledWith(
    "Couldn't read those files. Try choosing them again.",
  );
  expect(text()).toContain("Choose note files");
  await ui.unmount();
});
