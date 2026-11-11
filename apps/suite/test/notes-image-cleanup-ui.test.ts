// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { beforeEach, expect, it, vi } from "vitest";
import type {
  NoteImageCleanupPlan,
  NoteImageCleanupResult,
} from "../src/apps/notes/lib/image-cleanup";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  online: true,
  scan: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../src/apps/notes/state/notes-context", () => ({ useNotesContext: () => mocks.context }));
vi.mock("../src/shell/sync/connection-state", () => ({
  useConnectionState: () => (mocks.online ? "online" : "offline"),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/notes" }));
const { NotesSidebar } = await import("../src/apps/notes/components/sidebar");
const plan: NoteImageCleanupPlan = {
  images: [{ url: "https://pod.example/notes/media/bird.png", bytes: 2048, etag: '"v1"' }],
  totalBytes: 2048,
};
const text = () => document.body.textContent ?? "";
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(found, label).toBeDefined();
  return found as HTMLButtonElement;
}
async function open() {
  const trigger = button("Clean up unused images");
  await act(() => trigger.focus());
  await click(trigger);
  return trigger;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.online = true;
  mocks.scan.mockResolvedValue(plan);
  mocks.remove.mockResolvedValue({ deleted: 1, kept: 0, failed: 0 });
  mocks.context = {
    labels: [],
    persistLabels: vi.fn(),
    store: { imageCleanup: { scan: mocks.scan, delete: mocks.remove } },
  };
});

it("opens from maintenance actions, previews count and total size, then requires confirmation", async () => {
  await mount(h(NotesSidebar));
  const trigger = await open();
  expect(mocks.scan).toHaveBeenCalledOnce();
  expect(mocks.remove).not.toHaveBeenCalled();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  const title = document.getElementById(dialog?.getAttribute("aria-labelledby") as string);
  expect(title?.textContent).toBe("Clean up unused images");
  expect(dialog?.getAttribute("aria-describedby")).toBeTruthy();
  expect(text()).toContain("1 unused image · 2 KB. Nothing has been deleted.");
  await vi.waitFor(() => expect(dialog?.contains(document.activeElement)).toBe(true));
  await click(button("Delete unused images"));
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(plan, expect.any(Function));
  expect(text()).toContain("Deleted 1 image. Kept 0 images. Failed 0 images.");
  await click(button("Close"));
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("cancels without deletion and rescans when reopened", async () => {
  await mount(h(NotesSidebar));
  await open();
  await key(document.querySelector('[role="dialog"]') as HTMLElement, "Escape");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.remove).not.toHaveBeenCalled();
  mocks.scan.mockResolvedValue({ images: [], totalBytes: 0 });
  await open();
  expect(text()).toContain("No unused images found.");
  expect(
    [...document.querySelectorAll("button")].some((b) => b.textContent === "Delete unused images"),
  ).toBe(false);
  await click(button("Scan again"));
  expect(mocks.scan).toHaveBeenCalledTimes(3);
});

it.each([
  "success",
  "failure",
])("ignores an older scan's %s after closing and retains the latest dry-run", async (outcome) => {
  const first = deferred<NoteImageCleanupPlan>();
  mocks.scan.mockReturnValueOnce(first.promise);
  await mount(h(NotesSidebar));
  await open();
  expect(text()).toContain("Checking all notes and images…");
  expect(button("Scan again").disabled).toBe(true);
  await click(button("Close"));
  await open();
  await act(() => {
    if (outcome === "success") first.resolve({ images: [], totalBytes: 0 });
    else first.reject(new Error("Unreadable note"));
  });
  expect(text()).toContain("1 unused image");
});

it("shows a fail-closed read error and allows a new scan", async () => {
  mocks.scan.mockRejectedValueOnce(new Error("Unreadable note"));
  await mount(h(NotesSidebar));
  await open();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Nothing was deleted");
  expect(mocks.remove).not.toHaveBeenCalled();
  await click(button("Scan again"));
  expect(text()).toContain("1 unused image");
});

it("handles offline opening and reconnecting, and disables confirmation while offline", async () => {
  mocks.online = false;
  const ui = await mount(h(NotesSidebar));
  await open();
  expect(text()).toContain("You're offline. Reconnect");
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(button("Scan again").disabled).toBe(true);
  mocks.online = true;
  await ui.render(h(NotesSidebar));
  expect(button("Scan again").disabled).toBe(false);
  await click(button("Scan again"));
  mocks.online = false;
  await ui.render(h(NotesSidebar));
  expect(button("Delete unused images").disabled).toBe(true);
  await click(button("Delete unused images"));
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("keeps confirmation busy until rechecks finish, then reports newly referenced images", async () => {
  const deleting = deferred<NoteImageCleanupResult>();
  mocks.remove.mockReturnValueOnce(deleting.promise);
  await mount(h(NotesSidebar));
  await open();
  await click(button("Delete unused images"));
  expect(text()).toContain("Rechecking notes and deleting");
  expect(button("Close").disabled).toBe(true);
  await key(document.querySelector('[role="dialog"]') as HTMLElement, "Escape");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(() => deleting.resolve({ deleted: 0, kept: 1, failed: 0 }));
  expect(text()).toContain("Deleted 0 images. Kept 1 image. Failed 0 images.");
});

it("reports a failed rescan as deleting nothing and allows a fresh preview", async () => {
  mocks.remove.mockRejectedValueOnce(new Error("Unreadable note"));
  await mount(h(NotesSidebar));
  await open();
  await click(button("Delete unused images"));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Nothing was deleted");
  expect(
    [...document.querySelectorAll("button")].some((b) => b.textContent === "Delete unused images"),
  ).toBe(false);
  await click(button("Scan again"));
  expect(mocks.scan).toHaveBeenCalledTimes(2);
});

it("reports partial deletion counts after failure and requires a fresh preview for retry", async () => {
  mocks.remove.mockResolvedValueOnce({ deleted: 2, kept: 1, failed: 1, stopped: "failed" });
  await mount(h(NotesSidebar));
  await open();
  await click(button("Delete unused images"));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Cleanup stopped");
  expect(text()).toContain("Deleted 2 images. Kept 1 image. Failed 1 image.");
  expect(text()).toContain("Scan again to check what remains");
  expect(
    [...document.querySelectorAll("button")].some((b) => b.textContent === "Delete unused images"),
  ).toBe(false);
  await click(button("Scan again"));
  expect(mocks.scan).toHaveBeenCalledTimes(2);
});

it("uses current connectivity during deletion and keeps partial counts visible offline", async () => {
  const deleting = deferred<NoteImageCleanupResult>();
  mocks.remove.mockReturnValueOnce(deleting.promise);
  const ui = await mount(h(NotesSidebar));
  await open();
  await click(button("Delete unused images"));
  const isOnline = mocks.remove.mock.calls[0]?.[1] as () => boolean;
  expect(isOnline()).toBe(true);
  mocks.online = false;
  await ui.render(h(NotesSidebar));
  expect(isOnline()).toBe(false);
  await act(() => deleting.resolve({ deleted: 1, kept: 0, failed: 0, stopped: "offline" }));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("after going offline");
  expect(text()).toContain("Deleted 1 image. Kept 0 images. Failed 0 images.");
  expect(button("Close").disabled).toBe(false);
  expect(button("Scan again").disabled).toBe(true);
  mocks.online = true;
  await ui.render(h(NotesSidebar));
  expect(text()).toContain("Deleted 1 image. Kept 0 images. Failed 0 images.");
  await click(button("Scan again"));
  expect(mocks.scan).toHaveBeenCalledTimes(2);
});
