// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { TemplateGallery, type TemplateGalleryItem } from "../src/templates/template-gallery.js";

const items: TemplateGalleryItem[] = [
  {
    id: "meeting",
    name: "Meeting notes",
    description: "Discuss work",
    category: "Work",
    previewText: "Agenda",
    app: "docs",
    source: "builtin",
  },
  {
    id: "journal",
    name: "Journal entry",
    category: "Personal",
    previewImage: "https://example.org/preview.png",
    app: "notes",
    source: "builtin",
  },
  { id: "mine", name: "My checklist", category: "Personal", app: "notes", source: "user" },
];
function setup(props: Partial<Parameters<typeof TemplateGallery>[0]> = {}) {
  const choose = vi.fn();
  const close = vi.fn();
  return {
    choose,
    close,
    ...render(
      <TemplateGallery open onOpenChange={close} items={items} onChoose={choose} {...props} />,
    ),
  };
}
describe("template gallery", () => {
  it("previews built-ins and pod templates and supports keyboard selection", async () => {
    const user = userEvent.setup();
    const { choose } = setup();
    const meeting = screen.getByRole("button", { name: "Use Meeting notes" });
    meeting.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Use Journal entry" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Use My checklist" }));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(meeting);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Use My checklist" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(meeting);
    await user.keyboard("{End}{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Use Journal entry" }));
    await user.keyboard("{Enter}");
    expect(choose).toHaveBeenCalledWith(items[1]);
    expect(screen.getByAltText("").getAttribute("referrerpolicy")).toBe("no-referrer");
  });
  it("filters by category and source and displays a useful empty state", async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByLabelText("Category"), "Work");
    expect(screen.queryByRole("button", { name: "Use Journal entry" })).toBeNull();
    await user.selectOptions(screen.getByLabelText("Template source"), "user");
    expect(screen.getByText("No templates match these filters.")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Category"), "");
    expect(screen.getByRole("button", { name: "Use My checklist" })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Template source"), "builtin");
    expect(screen.queryByRole("button", { name: "Use My checklist" })).toBeNull();
  });
  it("deletes only user templates, propagates retry and closes with Escape", async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    const retry = vi.fn();
    const { close } = setup({
      onDelete: remove,
      error: "Failed to load",
      onRetry: retry,
      loading: true,
    });
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(screen.getAllByRole("button", { name: /^Delete template/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Delete template My checklist" }));
    expect(remove).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel deletion" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(remove).toHaveBeenCalledWith(items[2]);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledWith(false);
  });
  it("disables mutation and dismissal while preparing a document", async () => {
    const user = userEvent.setup();
    const { choose, close } = setup({ busy: true, onDelete: vi.fn() });
    expect(screen.getByRole("status").textContent).toContain("Preparing");
    expect(
      (screen.getByRole("button", { name: "Use Meeting notes" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Use Meeting notes" }));
    expect(choose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
  });
  it("does not render unsafe image schemes or nested interactive controls", async () => {
    setup({
      items: [{ ...(items[0] as TemplateGalleryItem), previewImage: "javascript:alert(1)" }],
      error: "Unavailable",
    });
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("button button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("list", { name: "Templates" }), { key: "ArrowRight" });
    const result = await axe.run(screen.getByRole("dialog"), {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
  it("renders no dialog while closed and handles an empty list", async () => {
    const { rerender } = setup({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<TemplateGallery open onOpenChange={() => {}} items={[]} onChoose={() => {}} />);
    await waitFor(() => expect(screen.getByText("No templates match these filters.")).toBeTruthy());
  });
});

it("preserves card names, describes previews, confirms deletion and restores focus", async () => {
  const user = userEvent.setup();
  const remove = vi.fn();
  const { rerender } = setup({ onDelete: remove });
  const meeting = screen.getByRole("button", { name: "Use Meeting notes" });
  expect(
    meeting
      .getAttribute("aria-describedby")
      ?.split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" "),
  ).toContain("Agenda");
  await user.click(screen.getByRole("button", { name: "Delete template My checklist" }));
  await user.click(screen.getByRole("button", { name: "Cancel deletion" }));
  expect(remove).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Delete template My checklist" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete template My checklist" }));
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  rerender(
    <TemplateGallery
      open
      onOpenChange={() => {}}
      items={items.slice(0, 2)}
      onChoose={() => {}}
      onDelete={remove}
    />,
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Use Journal entry" })),
  );
});
it("focuses the filter when the last visible card is removed", async () => {
  const user = userEvent.setup();
  const { rerender } = setup({ items: [items[2] as TemplateGalleryItem], onDelete: () => {} });
  await user.click(screen.getByRole("button", { name: "Delete template My checklist" }));
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  rerender(<TemplateGallery open onOpenChange={() => {}} items={[]} onChoose={() => {}} />);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Category")));
});
// AUTHORED-BY Claude Opus 5.5 (tests below)
it("references only rendered descriptions, including on image previews", () => {
  setup();
  for (const name of ["Use Meeting notes", "Use Journal entry", "Use My checklist"]) {
    const ids = screen.getByRole("button", { name }).getAttribute("aria-describedby")?.split(" ");
    expect(ids?.length).toBeGreaterThan(0);
    for (const id of ids ?? []) expect(document.getElementById(id)).not.toBeNull();
  }
  expect(
    screen.getByRole("button", { name: "Use Journal entry" }).getAttribute("aria-describedby"),
  ).not.toContain("preview");
});
it("returns focus to Delete after a failed deletion and still follows a later removal", async () => {
  const user = userEvent.setup();
  const props = { open: true, onOpenChange: () => {}, onChoose: () => {}, onDelete: vi.fn() };
  const { rerender } = render(<TemplateGallery {...props} items={items} />);
  const trigger = screen.getByRole("button", { name: "Delete template My checklist" });
  await user.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel deletion" }));
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  rerender(<TemplateGallery {...props} items={items} busy />);
  rerender(<TemplateGallery {...props} items={items} />);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete template My checklist" }),
    ),
  );
  // The failed attempt is forgotten: an unrelated later re-render moves no focus.
  rerender(<TemplateGallery {...props} items={items.slice(0, 2)} />);
  expect(document.activeElement).not.toBe(
    screen.getByRole("button", { name: "Use Journal entry" }),
  );
  rerender(<TemplateGallery {...props} items={items} />);
  await user.click(screen.getByRole("button", { name: "Delete template My checklist" }));
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  rerender(<TemplateGallery {...props} items={items} busy />);
  rerender(<TemplateGallery {...props} items={items.slice(0, 2)} />);
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Use Journal entry" })),
  );
});
