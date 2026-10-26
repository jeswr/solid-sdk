// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Breadcrumbs, EditableText, FilterChips, TagInput, Toolbar } from "../src/index.js";

let available = 375;
const observers = new Set<() => void>();
class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    this.callback = () => callback([], this);
  }
  callback: () => void;
  observe() {
    observers.add(this.callback);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this.callback);
  }
}
function resize(width: number) {
  available = width;
  act(() => {
    for (const callback of observers) callback();
  });
}
beforeEach(() => {
  available = 375;
  observers.clear();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.classList.contains("suite-measure")
      ? 600
      : this.parentElement?.classList.contains("suite-measure")
        ? this.textContent?.startsWith("More")
          ? 80
          : 100
        : available;
    return {
      x: 0,
      y: 0,
      width,
      height: 36,
      top: 0,
      bottom: 36,
      left: 0,
      right: width,
      toJSON() {},
    };
  });
});

const tags = [
  { id: "work", label: "Work" },
  { id: "personal", label: "Personal" },
  { id: "finance", label: "Finance" },
];
const crumbs = ["Drive", "Work", "Projects", "Campaigns"].map((label) => ({
  id: label,
  label,
  href: `/folders/${label}`,
}));
const onSelect = vi.fn();
const actions = ["Upload", "New folder", "Share", "Download", "Delete"].map((label) => ({
  id: label,
  label,
  onSelect: () => onSelect(label),
  disabled: label === "Delete",
}));
function Filters() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <FilterChips
      label="Types"
      options={tags}
      value={value}
      onChange={setValue}
      resultCount={value.length ? 1 : 12}
    />
  );
}
function Tags() {
  const [value, setValue] = useState<string[]>(["work"]);
  return <TagInput label="Labels" options={tags} value={value} onChange={setValue} />;
}
function Name() {
  const [value, setValue] = useState("Plan");
  return (
    <EditableText
      label="Name"
      value={value}
      onCommit={setValue}
      validate={(draft) => (draft.trim() ? undefined : "Enter a name")}
    />
  );
}
async function accessible(container: HTMLElement) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(
    result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}

describe("Toolbar", () => {
  it("measures overflow, invokes menu actions, and restores all actions after growth", async () => {
    const user = userEvent.setup();
    render(<Toolbar label="Files" actions={actions} />);
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(
      screen.getByRole("menuitem", { name: "Delete" }).getAttribute("data-disabled"),
    ).not.toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(onSelect).toHaveBeenLastCalledWith("Download");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More" }));
    resize(900);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Upload" }));
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });
  it("uses a single tab stop, skips disabled actions, and moves focus to More when shrinking", async () => {
    available = 900;
    const user = userEvent.setup();
    render(<Toolbar label="Files" actions={actions} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Upload" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Download" }));
    resize(180);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More" }));
  });
  it("keeps focus in the toolbar when a reorder moves the focused action into overflow", () => {
    const { rerender } = render(<Toolbar label="Files" actions={actions} />);
    screen.getByRole("button", { name: "Upload" }).focus();
    const [upload, folder, share, ...rest] = actions as [
      (typeof actions)[number],
      (typeof actions)[number],
      (typeof actions)[number],
      ...typeof actions,
    ];
    rerender(<Toolbar label="Files" actions={[share, upload, folder, ...rest]} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Upload" }));
    rerender(<Toolbar label="Files" actions={[folder, share, upload, ...rest]} />);
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More" }));
    act(() => (document.activeElement as HTMLElement).blur());
    rerender(<Toolbar label="Files" actions={actions} />);
    expect(document.activeElement).toBe(document.body);
  });
  it("leaves modified arrow keys to the browser", () => {
    available = 900;
    render(<Toolbar label="Files" actions={actions} />);
    const upload = screen.getByRole("button", { name: "Upload" });
    upload.focus();
    for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
      const allowed = fireEvent.keyDown(upload, { key: "ArrowRight", [modifier]: true });
      expect(allowed).toBe(true);
      expect(document.activeElement).toBe(upload);
    }
  });
  it("can overflow every action and disconnects measurement on unmount", () => {
    available = 60;
    const { unmount } = render(<Toolbar label="Files" actions={actions} />);
    expect(within(screen.getByRole("toolbar")).getAllByRole("button")).toHaveLength(1);
    unmount();
    expect(observers.size).toBe(0);
  });
  it("remeasures when labels or action inventory changes", () => {
    const { rerender } = render(<Toolbar label="Files" actions={actions} />);
    rerender(<Toolbar label="Files" actions={actions.slice(0, 1)} />);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });
});

describe("Breadcrumbs", () => {
  it("restores the focused portalled menu crumb when widening with the menu open", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Breadcrumbs label="First path" items={crumbs} />
        <Breadcrumbs label="Second path" items={crumbs} />
        <button type="button">After paths</button>
      </>,
    );
    const nav = screen.getByRole("navigation", { name: "First path" });
    act(() => within(nav).getByRole("button", { name: "Show parent folders" }).focus());
    await user.keyboard("{ArrowDown}{ArrowDown}");
    const parent = screen.getByRole("menuitem", { name: "Projects" });
    expect(document.activeElement).toBe(parent);
    expect(nav.contains(parent)).toBe(false);
    resize(300);
    expect(document.activeElement).toBe(parent);
    resize(900);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show parent folders" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(nav).getByRole("link", { name: "Projects" })),
    );
    const outside = screen.getByRole("button", { name: "After paths" });
    act(() => outside.focus());
    resize(200);
    expect(document.activeElement).toBe(outside);
  });

  it("collapses middle segments, opens with keyboard, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<Breadcrumbs items={crumbs} />);
    expect(screen.queryByRole("link", { name: "Work" })).toBeNull();
    expect(screen.getByRole("link", { name: "Campaigns" }).getAttribute("aria-current")).toBe(
      "page",
    );
    const trigger = screen.getByRole("button", { name: "Show parent folders" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Work" }).getAttribute("href")).toBe(
      "/folders/Work",
    );
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Projects" }));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
    resize(900);
    expect(screen.queryByRole("button", { name: "Show parent folders" })).toBeNull();
    expect(screen.getByRole("link", { name: "Work" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Work" }));
  });
  it("supports drop handlers on visible and collapsed crumbs", async () => {
    const drop = vi.fn((event) => event.preventDefault());
    render(<Breadcrumbs items={crumbs.map((crumb) => ({ ...crumb, onDrop: drop }))} />);
    const current = screen.getByRole("link", { name: "Campaigns" });
    expect(fireEvent.dragOver(current)).toBe(false);
    fireEvent.drop(current);
    await userEvent.click(screen.getByRole("button", { name: "Show parent folders" }));
    fireEvent.drop(screen.getByRole("menuitem", { name: "Work" }));
    expect(drop).toHaveBeenCalledTimes(2);
  });
  it("moves focus from a collapsing crumb to the menu trigger", () => {
    available = 900;
    render(<Breadcrumbs items={crumbs} />);
    screen.getByRole("link", { name: "Work" }).focus();
    resize(200);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Show parent folders" }),
    );
  });
  it("keeps a root or two-segment path visible", () => {
    available = 40;
    render(<Breadcrumbs items={crumbs.slice(0, 2)} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("FilterChips", () => {
  it("toggles, clears, and announces result count changes", async () => {
    const user = userEvent.setup();
    render(<Filters />);
    await user.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.getByRole("button", { name: "Work" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("1 result");
    await user.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.getByRole("status").textContent).toBe("12 results");
    await user.click(screen.getByRole("button", { name: "Personal" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("EditableText", () => {
  it("edits by F2, validates, commits with Enter and returns focus", async () => {
    const user = userEvent.setup();
    render(<Name />);
    screen.getByRole("button").focus();
    await user.keyboard("{F2}");
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(document.activeElement).toBe(input);
    await user.clear(input);
    await user.keyboard("{Enter}");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Enter a name");
    expect(input.getAttribute("aria-describedby")).toContain(screen.getByRole("alert").id);
    await user.type(input, "New plan{Enter}");
    expect(screen.getByRole("button").textContent).toBe("New plan");
    expect(document.activeElement).toBe(screen.getByRole("button"));
  });
  it("cancels by Escape without committing and picks up external value changes", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    const { rerender } = render(<EditableText label="Name" value="Plan" onCommit={commit} />);
    await user.click(screen.getByRole("button"));
    await user.type(screen.getByRole("textbox"), " draft{Escape}");
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole("button").textContent).toBe("Plan");
    rerender(<EditableText label="Name" value="Updated elsewhere" onCommit={commit} />);
    await user.click(screen.getByRole("button"));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Updated elsewhere");
  });
  it("ignores IME Enter and does not commit on blur", async () => {
    const commit = vi.fn();
    render(<EditableText label="Name" value="Plan" onCommit={commit} />);
    await userEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});

describe("TagInput", () => {
  it("filters suggestions, selects by keyboard, and removes chips by button and Backspace", async () => {
    const user = userEvent.setup();
    render(<Tags />);
    const input = screen.getByRole("combobox", { name: "Labels" });
    await user.click(input);
    expect(screen.queryByRole("option", { name: "Work" })).toBeNull();
    await user.type(input, "fin");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "Finance" }).id,
    );
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Remove Finance" })).toBeTruthy();
    await user.keyboard("{Backspace}");
    expect(screen.queryByRole("button", { name: "Remove Finance" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove Work" }));
    expect(screen.queryByRole("button", { name: "Remove Work" })).toBeNull();
    expect(document.activeElement).toBe(input);
  });
  it("replaces the add announcement with the suggestion count once the user filters again", async () => {
    const user = userEvent.setup();
    render(<Tags />);
    const input = screen.getByRole("combobox", { name: "Labels" });
    await user.click(input);
    await user.type(input, "fin");
    await user.keyboard("{ArrowDown}{Enter}");
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Finance added");
    await user.type(input, "zzz");
    expect(status.textContent).toBe("0 suggestions");
  });
  it("supports pointer selection, no-results, Escape, and Tab leaving the composite", async () => {
    const user = userEvent.setup();
    render(<Tags />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "Personal" }));
    expect(screen.getByRole("button", { name: "Remove Personal" })).toBeTruthy();
    await user.click(input);
    await user.type(input, "absent");
    expect(screen.getByText("No results for 'absent'")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    await user.click(input);
    await user.tab();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
  it("does not remove a tag while text is being composed", async () => {
    render(<Tags />);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    fireEvent.keyDown(input, { key: "Backspace", isComposing: true });
    expect(screen.getByRole("button", { name: "Remove Work" })).toBeTruthy();
  });
});

it("has no serious or critical axe findings across default, empty, selected and disabled states", async () => {
  const { container } = render(
    <main>
      <Toolbar label="File actions" actions={actions} />
      <Toolbar label="Empty actions" actions={[]} />
      <FilterChips
        label="Types"
        options={tags.map((tag) => ({ ...tag, disabled: true }))}
        value={["work"]}
        onChange={() => {}}
        resultCount={0}
      />
      <Breadcrumbs items={crumbs} />
      <EditableText label="Name" value="Plan" onCommit={() => {}} disabled />
      <TagInput
        label="Shared labels"
        options={tags}
        value={["work"]}
        onChange={() => {}}
        disabled
      />
      <TagInput label="Empty labels" options={[]} value={[]} onChange={() => {}} />
    </main>,
  );
  await accessible(container);
  await userEvent.click(screen.getByRole("combobox", { name: "Empty labels" }));
  expect(screen.getByText("No labels yet")).toBeTruthy();
  await accessible(container);
});

it("has no serious or critical axe findings for editing, validation, autocomplete and menu states", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <main>
      <Name />
      <Tags />
      <Breadcrumbs items={crumbs} />
      <Toolbar label="Files" actions={actions} />
    </main>,
  );
  await user.click(screen.getByRole("button", { name: "Name: Plan" }));
  await accessible(container);
  await user.clear(screen.getByRole("textbox", { name: "Name" }));
  await user.keyboard("{Enter}");
  await accessible(container);
  await user.click(screen.getByRole("combobox"));
  await user.keyboard("{ArrowDown}");
  await accessible(container);
  await user.type(screen.getByRole("combobox"), "absent");
  await accessible(container);
  await user.click(screen.getByRole("button", { name: "Show parent folders" }));
  await accessible(document.body);
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "More" }));
  await accessible(document.body);
});

it("closes tag suggestions when disabled and ignores selection until enabled", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <TagInput label="Labels" options={tags} value={[]} onChange={onChange} />,
  );
  const input = screen.getByRole("combobox");
  await userEvent.click(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getAllByRole("option")).toHaveLength(3);
  rerender(<TagInput label="Labels" options={tags} value={[]} onChange={onChange} disabled />);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.focus(input);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole("option")).toBeNull();
  rerender(<TagInput label="Labels" options={tags} value={[]} onChange={onChange} />);
  expect(screen.queryByRole("option")).toBeNull();
  await userEvent.click(input);
  await userEvent.click(screen.getByRole("option", { name: "Work" }));
  expect(onChange).toHaveBeenCalledWith(["work"]);
});

it("recovers collapsed breadcrumb focus only in the container that owned it", () => {
  available = 900;
  render(
    <>
      <Breadcrumbs label="First path" items={crumbs} />
      <Breadcrumbs label="Second path" items={crumbs} />
    </>,
  );
  const first = screen.getByRole("navigation", { name: "First path" });
  act(() => within(first).getByRole("link", { name: "Work" }).focus());
  resize(200);
  expect(document.activeElement).toBe(
    within(first).getByRole("button", { name: "Show parent folders" }),
  );
});
