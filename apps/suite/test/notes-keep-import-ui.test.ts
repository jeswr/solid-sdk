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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context = {
    notes: [
      { ...stored("Old"), body: "<p>Kept</p>" },
      { ...stored("Binned"), body: "<p>x</p>", location: "trashed" },
    ],
    create: vi.fn(async (input: { title: string }) => stored(input.title)),
    move: vi.fn(async (note: StoredNote) => ({ ...note, location: "archived" })),
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
    keepFile("Ideas.json", { title: "Ideas", textContent: "Plant beans", isArchived: true }),
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
  expect(mocks.context.create).toHaveBeenNthCalledWith(
    1,
    { title: "Shopping", body: expect.stringContaining("Milk"), labels: ["Home"] },
    true,
    "yellow",
  );
  expect(mocks.context.create).toHaveBeenNthCalledWith(
    2,
    { title: "Ideas", body: "<p>Plant beans</p>", labels: [] },
    false,
    "default",
  );
  expect(mocks.context.move).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "Ideas" }),
    "archive",
  );
  expect(mocks.context.refresh).toHaveBeenCalled();
  expect(text()).toContain("Imported 2 notes.");
  await click(button("Done"));
  expect(text()).not.toContain("Import from Google Keep");
  await ui.unmount();
});

it("reports failures, retries only notes not yet in the pod, and notes archive failures", async () => {
  const close = vi.fn();
  const create = mocks.context.create as ReturnType<typeof vi.fn>;
  create.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
  (mocks.context.move as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("412"));
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
  expect(create).toHaveBeenCalledTimes(4);
  expect(create).toHaveBeenLastCalledWith(
    { title: "A", body: "<p>a</p>", labels: [] },
    false,
    "default",
  );
  expect(text()).toContain("Imported 1 note.");
  await click(button("Done"));
  expect(close).toHaveBeenCalledOnce();
  await ui.unmount();
});

it("stops between notes and offers to import the rest", async () => {
  const create = mocks.context.create as ReturnType<typeof vi.fn>;
  const first = deferred<StoredNote>();
  create.mockReturnValueOnce(first.promise);
  const close = vi.fn();
  const ui = await mount(h(KeepImportDialog, { open: true, close }));
  await choose("Keep note files", [
    keepFile("A.json", { title: "A", textContent: "a" }),
    keepFile("B.json", { title: "B", textContent: "b" }),
  ]);
  await click(button("Import 2 notes"));
  expect(text()).toContain("Importing 0 of 2…");
  // Escape or the close button stops the import instead of closing mid-way.
  await act(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(close).not.toHaveBeenCalled();
  await click(button("Stop"));
  await act(() => first.resolve(stored("A")));
  expect(text()).toContain("Imported 1 note.");
  expect(text()).toContain("Stopped with 1 note still to import.");
  await click(button("Import the rest"));
  expect(create).toHaveBeenLastCalledWith(
    { title: "B", body: "<p>b</p>", labels: [] },
    false,
    "default",
  );
  expect(text()).toContain("Imported 1 note.");
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
