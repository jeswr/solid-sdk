// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { act, click, h, mount } from "./drive-ui-dom";

const { NotesAvailability, NotesEmptyState, NotesLoadError, NotesMissingState } = await import(
  "../src/apps/notes/components/notes-states"
);

afterEach(() => vi.restoreAllMocks());

it.each([
  ["active", "Notes you add appear here", "first-use"],
  ["label", "No notes with this label", "filtered-empty"],
  ["search", "No matching notes", "no-results"],
  ["archived", "Your archived notes appear here", "first-use"],
  ["trashed", "No notes in Trash", "first-use"],
  ["reminders", "Notes with reminders appear here", "first-use"],
] as const)("offers a useful next step for the empty %s view", async (view, title, variant) => {
  const create = vi.fn();
  const ui = await mount(h(NotesEmptyState, { view, onCreate: create }));
  expect(ui.host.querySelector('[role="status"]')?.getAttribute("data-variant")).toBe(variant);
  expect(ui.host.querySelector("h3")?.textContent).toBe(title);
  expect(ui.host.querySelector("p")?.textContent).toBeTruthy();
  if (view === "active" || view === "label") {
    await click(ui.host.querySelector("button") as HTMLButtonElement);
    expect(create).toHaveBeenCalledOnce();
  }
  const back = ui.host.querySelector("a");
  if (view === "active") expect(back).toBeNull();
  else {
    expect(back?.textContent).toBe("Back to Notes");
    expect(back?.getAttribute("href")).toBe("/notes");
  }
});

it("retries a load failure and changes its explanation when offline", async () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const retry = vi.fn();
  const ui = await mount(h(NotesLoadError, { retry }));
  expect(ui.host.querySelector('[role="alert"]')?.getAttribute("data-category")).toBe(
    "unreachable",
  );
  await click(ui.host.querySelector("button") as HTMLButtonElement);
  expect(retry).toHaveBeenCalledOnce();
  online.mockReturnValue(false);
  await act(() => window.dispatchEvent(new Event("offline")));
  expect(ui.host.querySelector('[role="alert"]')?.getAttribute("data-category")).toBe("offline");
  await click(ui.host.querySelector("button") as HTMLButtonElement);
  expect(retry).toHaveBeenCalledTimes(2);
});

it("keeps a missing note's recovery link visible", async () => {
  const ui = await mount(h(NotesMissingState));
  expect(ui.host.querySelector("h1")?.textContent).toBe("Note not found");
  expect(ui.host.querySelector('[role="alert"]')?.getAttribute("data-category")).toBe("not-found");
  expect(ui.host.querySelector("a")?.getAttribute("href")).toBe("/notes");
});

it("explains offline saving and Trash read-only access, updating on reconnect", async () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const ui = await mount(h(NotesAvailability));
  expect(ui.host.textContent).toBe("");
  online.mockReturnValue(false);
  await act(() => window.dispatchEvent(new Event("offline")));
  expect(ui.host.querySelector('[role="status"]')?.textContent).toContain("Reconnect to save");
  await ui.render(h(NotesAvailability, { trashed: true }));
  expect(ui.host.textContent).toContain("read-only in Trash");
  online.mockReturnValue(true);
  await act(() => window.dispatchEvent(new Event("online")));
  expect(ui.host.textContent).not.toContain("offline");
  expect(ui.host.textContent).toContain("Restore it to make changes");
});
