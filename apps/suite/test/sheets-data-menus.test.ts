// AUTHORED-BY Codex GPT-6.1-Sol
import "./drive-ui-dom";
import { DropdownMenuItem } from "@jeswr/suite-ui";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { DataMenus } from "../src/apps/sheets/components/sheet-data-menus";
import type { SheetEngine, SortResult } from "../src/apps/sheets/lib/contract";
import { act, click, h, key, mount } from "./drive-ui-dom";

vi.mock("@jeswr/suite-ui", async (original) => {
  const ui = await original<typeof import("@jeswr/suite-ui")>();
  const { createElement } = await import("react");
  return {
    ...ui,
    DropdownMenuItem: vi.fn((props: ComponentProps<typeof ui.DropdownMenuItem>) =>
      createElement(ui.DropdownMenuItem, props),
    ),
  };
});
function button(text: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
function item(text: string) {
  const element = [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === text,
  );
  if (!element) throw new Error(`Missing menu item ${text}`);
  return element;
}
async function open() {
  await key(button("Data"), "ArrowDown");
}
async function fill(id: string, value: string) {
  const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  const prototype =
    element.tagName === "INPUT"
      ? window.HTMLInputElement.prototype
      : window.HTMLSelectElement.prototype;
  await act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() {
  await act(() => {
    document
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function fixture() {
  let filtered = false;
  let values = () => {};
  let selection = () => {};
  const unsubValues = vi.fn();
  const unsubSelection = vi.fn();
  const engine: SheetEngine = {
    snapshot: () => ({}),
    load: vi.fn(),
    onChange: () => () => {},
    activeSheet: () => ({ id: "data", name: "Data" }),
    importCsv: vi.fn(),
    exportCsv: () => "",
    setDark: vi.fn(),
    setReadOnly: vi.fn(),
    dispose: vi.fn(),
    sortRange: vi.fn((): SortResult => ({ status: "sorted" })),
    findReplace: vi.fn(async () => {}),
    editLink: vi.fn(async () => {}),
    hasFilter: () => filtered,
    toggleFilter: vi.fn(async () => {
      filtered = !filtered;
      return true;
    }),
    clearFilter: vi.fn(async () => true),
    onValuesChange: (listener) => {
      values = listener;
      return unsubValues;
    },
    onSelection: (listener) => {
      selection = () => listener(undefined);
      return unsubSelection;
    },
  };
  return {
    engine,
    values: () => values(),
    selection: () => selection(),
    unsubValues,
    unsubSelection,
  };
}

it("wires sorting, filter create/clear/remove and find to the engine", async () => {
  const f = fixture();
  const ui = await mount(h(DataMenus, { engine: f.engine, locked: false }));
  await open();
  expect(item("Clear filter").getAttribute("aria-disabled")).toBe("true");
  await click(item("Create a filter"));
  await open();
  await click(item("Clear filter"));
  expect(f.engine.clearFilter).toHaveBeenCalledOnce();
  await open();
  await click(item("Remove filter"));
  expect(f.engine.toggleFilter).toHaveBeenCalledTimes(2);
  await open();
  await click(item("Sort range"));
  await fill("sht-sort-scope", "sheet");
  await fill("sht-sort-column", "b");
  await fill("sht-sort-direction", "desc");
  const checkbox = document.querySelector('input[type="checkbox"]');
  if (!checkbox) throw new Error("Missing header checkbox");
  await click(checkbox);
  await submit();
  expect(f.engine.sortRange).toHaveBeenCalledWith({
    scope: "sheet",
    column: 1,
    ascending: false,
    header: false,
  });
  await open();
  await click(item("Sort range"));
  await fill("sht-sort-scope", "range");
  await fill("sht-sort-direction", "asc");
  await submit();
  expect(f.engine.sortRange).toHaveBeenLastCalledWith({
    scope: "range",
    column: 1,
    ascending: true,
    header: false,
  });
  await key(button("Edit"), "ArrowDown");
  await click(item("Insert or edit link"));
  expect(f.engine.editLink).toHaveBeenCalledOnce();
  await key(button("Edit"), "ArrowDown");
  await click(item("Find and replace"));
  expect(f.engine.findReplace).toHaveBeenCalledOnce();
  await act(() => {
    f.values();
    f.selection();
  });
  await ui.unmount();
  expect(f.unsubValues).toHaveBeenCalledOnce();
  expect(f.unsubSelection).toHaveBeenCalledOnce();
});

it("validates sort input and respects a lock that arrives while the dialog is open", async () => {
  const f = fixture();
  const ui = await mount(h(DataMenus, { engine: f.engine, locked: false }));
  await open();
  await click(item("Sort range"));
  await fill("sht-sort-column", "A1");
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("enter a column");
  await fill("sht-sort-column", "A");
  if (!f.engine.sortRange) throw new Error("Missing sort method");
  vi.mocked(f.engine.sortRange).mockReturnValue({ status: "blocked", reason: "Invalid range" });
  await submit();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await ui.render(h(DataMenus, { engine: f.engine, locked: true }));
  expect(button("Sort").disabled).toBe(true);
  vi.mocked(f.engine.sortRange).mockClear();
  await submit();
  expect(f.engine.sortRange).not.toHaveBeenCalled();
  await ui.unmount();
  const locked = await mount(h(DataMenus, { engine: f.engine, locked: true }));
  await open();
  expect(item("Sort range").getAttribute("aria-disabled")).toBe("true");
  expect(item("Create a filter").getAttribute("aria-disabled")).toBeNull();
  await key(item("Sort range"), "Escape");
  await key(button("Edit"), "ArrowDown");
  expect(item("Insert or edit link").getAttribute("aria-disabled")).toBe("true");
  expect(item("Find and replace").getAttribute("aria-disabled")).toBeNull();
  await locked.unmount();
});

it("keeps the sort dialog open and shows the engine's validation reason, then allows retry", async () => {
  const f = fixture();
  if (!f.engine.sortRange) throw new Error("Missing sort method");
  vi.mocked(f.engine.sortRange).mockReturnValueOnce({
    status: "blocked",
    reason: "Merged cells must be the same size to sort this range.",
  });
  const ui = await mount(h(DataMenus, { engine: f.engine, locked: false }));
  await open();
  await click(item("Sort range"));
  await submit();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Merged cells must be the same size to sort this range.",
  );
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(button("Sort").disabled).toBe(false);
  await submit();
  expect(f.engine.sortRange).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await ui.unmount();
});

it("handles Ctrl/Cmd+H and grid Find while preserving browser Find elsewhere and cleaning up", async () => {
  const f = fixture();
  const ui = await mount(h(DataMenus, { engine: f.engine, locked: true }));
  const grid = document.createElement("div");
  grid.className = "sht-univer";
  document.body.append(grid);
  async function shortcut(target: EventTarget, key: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    await act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }
  expect((await shortcut(document, "h")).defaultPrevented).toBe(false);
  for (const options of [
    { ctrlKey: true, altKey: true },
    { metaKey: true, shiftKey: true },
  ])
    expect((await shortcut(grid, "h", options)).defaultPrevented).toBe(false);
  expect((await shortcut(grid, "x", { ctrlKey: true })).defaultPrevented).toBe(false);
  expect((await shortcut(document, "f", { ctrlKey: true })).defaultPrevented).toBe(false);
  expect((await shortcut(button("Edit"), "f", { ctrlKey: true })).defaultPrevented).toBe(false);
  expect((await shortcut(document, "H", { ctrlKey: true })).defaultPrevented).toBe(true);
  expect((await shortcut(grid, "h", { metaKey: true })).defaultPrevented).toBe(true);
  expect((await shortcut(grid, "F", { ctrlKey: true })).defaultPrevented).toBe(true);
  expect(f.engine.findReplace).toHaveBeenCalledTimes(3);
  await ui.unmount();
  expect((await shortcut(grid, "h", { ctrlKey: true })).defaultPrevented).toBe(false);
  grid.remove();
});

it("handles unavailable engines and optional capabilities during loading and reload", async () => {
  const f = fixture();
  delete f.engine.hasFilter;
  delete f.engine.toggleFilter;
  delete f.engine.clearFilter;
  delete f.engine.findReplace;
  delete f.engine.editLink;
  delete f.engine.onValuesChange;
  delete f.engine.onSelection;
  delete f.engine.sortRange;
  const ui = await mount(h(DataMenus, { engine: null, locked: true }));
  expect(button("Data").disabled).toBe(true);
  expect(button("Edit").disabled).toBe(true);
  await ui.render(h(DataMenus, { engine: f.engine, locked: false }));
  await open();
  await click(item("Create a filter"));
  await key(button("Edit"), "ArrowDown");
  await click(item("Insert or edit link"));
  await key(button("Edit"), "ArrowDown");
  await click(item("Find and replace"));
  await act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true }),
    );
  });
  await open();
  await click(item("Sort range"));
  await submit();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await ui.render(h(DataMenus, { engine: null, locked: false }));
  await submit();
  await ui.unmount();
});

it("guards menu callbacks when an engine disappears while a menu is open", async () => {
  const f = fixture();
  const ui = await mount(h(DataMenus, { engine: f.engine, locked: false }));
  await open();
  await ui.render(h(DataMenus, { engine: null, locked: false }));
  const callbacks = vi
    .mocked(DropdownMenuItem)
    .mock.calls.map(([props]) => props as ComponentProps<typeof DropdownMenuItem>);
  for (const label of ["Create a filter", "Clear filter"]) {
    const props = callbacks.filter((props) => props.children === label).at(-1);
    if (!props) throw new Error(`Missing callback ${label}`);
    await act(async () => {
      await props.onSelect?.(new Event("select"));
    });
  }
  await key(item("Sort range"), "Escape");
  await ui.render(h(DataMenus, { engine: f.engine, locked: false }));
  await key(button("Edit"), "ArrowDown");
  await ui.render(h(DataMenus, { engine: null, locked: false }));
  const props = vi
    .mocked(DropdownMenuItem)
    .mock.calls.map(([props]) => props)
    .filter((props) => props.children === "Find and replace")
    .at(-1);
  if (!props) throw new Error("Missing find callback");
  await act(() => props.onSelect?.(new Event("select")));
  const linkProps = vi
    .mocked(DropdownMenuItem)
    .mock.calls.map(([props]) => props)
    .filter((props) => props.children === "Insert or edit link")
    .at(-1);
  if (!linkProps) throw new Error("Missing link callback");
  await act(() => linkProps.onSelect?.(new Event("select")));
  await ui.unmount();
});

it("routes Ctrl/Cmd+K from the grid to cell links and blocks it while locked", async () => {
  const f = fixture();
  const ui = await mount(h(DataMenus, { engine: f.engine, locked: false }));
  const grid = document.createElement("div");
  grid.className = "sht-univer";
  document.body.append(grid);
  async function shortcut(target: EventTarget, metaKey = false) {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: !metaKey,
      metaKey,
      bubbles: true,
      cancelable: true,
    });
    await act(() => target.dispatchEvent(event));
    return event;
  }
  expect((await shortcut(document)).defaultPrevented).toBe(false);
  for (const mac of [false, true]) expect((await shortcut(grid, mac)).defaultPrevented).toBe(true);
  expect(f.engine.editLink).toHaveBeenCalledTimes(2);
  await ui.render(h(DataMenus, { engine: f.engine, locked: true }));
  expect((await shortcut(grid)).defaultPrevented).toBe(true);
  expect(f.engine.editLink).toHaveBeenCalledTimes(2);
  await ui.render(h(DataMenus, { engine: f.engine, locked: false }));
  delete f.engine.editLink;
  expect((await shortcut(grid)).defaultPrevented).toBe(true);
  await ui.unmount();
  grid.remove();
});
