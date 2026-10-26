// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CollectionErrorKind, CollectionState } from "../src/collections/collection-state.js";
import { type DataColumn, DataTable } from "../src/collections/data-table.js";
import { FileGrid } from "../src/collections/file-grid.js";
import { useSelection } from "../src/collections/use-selection.js";

type Item = { id: string; name: string; size: number };
const items: Item[] = [
  { id: "a", name: "Alpha", size: 30 },
  { id: "b", name: "Beta", size: 10 },
  { id: "c", name: "Charlie", size: 20 },
  { id: "d", name: "Delta", size: 40 },
];
const getKey = (item: Item) => item.id;
const getLabel = (item: Item) => item.name;
const columns: DataColumn<Item>[] = [
  { id: "name", header: "Name", accessor: getLabel, hideable: false },
  { id: "size", header: "Size", accessor: (item) => item.size },
];
const onOpen = vi.fn();
const onDetails = vi.fn();
let viewportWidth = 800;
const resizeCallbacks = new Set<() => void>();

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: () => void;
      constructor(callback: ResizeObserverCallback) {
        this.callback = () => callback([], this);
        resizeCallbacks.add(this.callback);
      }
      observe() {}
      unobserve() {
        resizeCallbacks.delete(this.callback);
      }
      disconnect() {
        resizeCallbacks.delete(this.callback);
      }
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => viewportWidth },
    clientHeight: { configurable: true, get: () => 440 },
    offsetWidth: { configurable: true, get: () => viewportWidth },
    offsetHeight: { configurable: true, get: () => 440 },
    scrollHeight: { configurable: true, get: () => 500000 },
    scrollWidth: { configurable: true, get: () => viewportWidth },
    scrollTo: {
      configurable: true,
      value(options: ScrollToOptions) {
        this.scrollTop = options.top ?? 0;
        this.dispatchEvent(new Event("scroll"));
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  viewportWidth = 800;
});

function Fixture({
  kind,
  data = items,
  state,
}: {
  kind: "table" | "grid";
  data?: Item[];
  state?: CollectionState;
}) {
  const selection = useSelection();
  const props = {
    items: data,
    getKey,
    getLabel,
    label: "Files",
    selection,
    onOpen,
    onDetails,
    ...(state ? { state } : {}),
  };
  return (
    <main>
      <h1>Files</h1>
      {kind === "table" ? <DataTable {...props} columns={columns} /> : <FileGrid {...props} />}
      <output aria-label="Selection">{[...selection.selectedKeys].join(",")}</output>
    </main>
  );
}

for (const kind of ["table", "grid"] as const) {
  const itemRole = kind === "table" ? "row" : "gridcell";
  describe(kind, () => {
    it("selects three items with the keyboard, opens and shows details", () => {
      render(<Fixture kind={kind} />);
      const alpha = screen.getByRole(itemRole, { name: "Alpha" });
      act(() => alpha.focus());
      fireEvent.keyDown(alpha, { key: " " });
      fireEvent.keyDown(alpha, { key: "J", shiftKey: true });
      fireEvent.keyDown(document.activeElement as Element, { key: "j", shiftKey: true });
      expect(screen.getAllByRole("status")[0]?.textContent).toContain("3 selected");
      expect(screen.getByRole("status", { name: "Selection" }).textContent).toBe("a,b,c");
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Charlie");
      fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
      expect(onOpen).toHaveBeenCalledWith(items[2]);
      fireEvent.keyDown(document.activeElement as Element, { key: "Enter", altKey: true });
      expect(onDetails).toHaveBeenCalledWith(items[2]);
      fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
      expect(screen.getAllByRole("status")[0]?.textContent).toContain("0 selected");
    });
    it("supports checkbox range selection, select-all and a single roving tab stop", () => {
      render(<Fixture kind={kind} />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Charlie" }), { shiftKey: true });
      expect(screen.getByRole("status", { name: "Selection" }).textContent).toBe("a,b,c");
      expect(document.querySelectorAll('[data-collection-item][tabindex="0"]')).toHaveLength(1);
      const alpha = screen.getByRole(itemRole, { name: "Alpha" });
      fireEvent.keyDown(alpha, { key: "a", ctrlKey: true });
      expect(screen.getByRole("status", { name: "Selection" }).textContent).toBe("a,b,c,d");
      fireEvent.keyDown(alpha, { key: " " });
      expect(screen.getByRole("status", { name: "Selection" }).textContent).toBe("b,c,d");
    });
    it("uses grid column geometry for vertical arrows and preserves focus while scrolling", () => {
      const data = Array.from({ length: 10000 }, (_, index) => ({
        id: String(index),
        name: `File ${index}`,
        size: index,
      }));
      render(<Fixture kind={kind} data={data} />);
      const first = screen.getByRole(itemRole, { name: "File 0" });
      act(() => first.focus());
      fireEvent.keyDown(first, { key: "ArrowDown" });
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        kind === "table" ? "File 1" : "File 3",
      );
      const grid = screen.getByRole("grid");
      const viewport = kind === "table" ? grid.parentElement : grid;
      fireEvent.scroll(viewport as Element, { target: { scrollTop: 150000 } });
      expect(document.activeElement?.isConnected).toBe(true);
      expect(document.querySelectorAll("[data-collection-item]").length).toBeLessThan(100);
      expect(screen.getByRole("grid").getAttribute("aria-rowcount")).toBe(
        kind === "table" ? "10001" : "3334",
      );
    });
    it("restores the roving stop after filtering/removal", () => {
      const { rerender } = render(<Fixture kind={kind} />);
      const beta = screen.getByRole(itemRole, { name: "Beta" });
      act(() => beta.focus());
      rerender(<Fixture kind={kind} data={[items[2] as Item]} />);
      expect(screen.getByRole(itemRole, { name: "Charlie" }).tabIndex).toBe(0);
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Charlie");
    });
    it("renders actual component DOM with no serious or critical axe violations", async () => {
      const { container } = render(<Fixture kind={kind} />);
      const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
      expect(
        results.violations.filter(
          (entry) => entry.impact === "serious" || entry.impact === "critical",
        ),
      ).toEqual([]);
    });
    it("renders typed states accessibly", async () => {
      const errors: CollectionErrorKind[] = [
        "reauth",
        "forbidden",
        "not-found",
        "conflict",
        "name-taken",
        "quota",
        "too-large",
        "unreachable",
        "unsupported",
        "unknown",
      ];
      const states: CollectionState[] = [
        { status: "ready" },
        { status: "refreshing" },
        { status: "offline", cached: true },
        { status: "loading" },
        { status: "offline", cached: false },
        ...errors.map((kind) => ({
          status: "error" as const,
          kind,
          actions: <button type="button">Resolve</button>,
        })),
      ];
      for (const state of states) {
        const { container, unmount } = render(<Fixture kind={kind} state={state} data={[]} />);
        expect(screen.queryByRole("grid")).toBeNull();
        const results = await axe.run(container, {
          rules: { "color-contrast": { enabled: false } },
        });
        expect(
          results.violations.filter(
            (entry) => entry.impact === "serious" || entry.impact === "critical",
          ),
        ).toEqual([]);
        unmount();
      }
    });
    it("keeps cached and refreshing content available", () => {
      const { rerender } = render(
        <Fixture kind={kind} state={{ status: "offline", cached: true }} />,
      );
      expect(screen.getAllByRole("status")[0]?.textContent).toContain(
        "Offline — showing saved copies",
      );
      expect(screen.getByRole(itemRole, { name: "Alpha" })).toBeDefined();
      rerender(<Fixture kind={kind} state={{ status: "refreshing" }} />);
      expect(screen.getByRole("grid").getAttribute("aria-busy")).toBe("true");
      expect(screen.getByRole(itemRole, { name: "Alpha" })).toBeDefined();
    });
  });
}

it("sorts numeric values, ranges in sorted order, hides and resizes columns by keyboard", () => {
  render(<Fixture kind="table" />);
  fireEvent.click(screen.getByRole("button", { name: "Size" }));
  const rows = within(screen.getByRole("grid")).getAllByRole("row").slice(1);
  // TanStack defaults number columns to descending on the first click.
  expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
    "Delta",
    "Alpha",
    "Charlie",
    "Beta",
  ]);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Beta" }), { shiftKey: true });
  expect(screen.getByRole("status", { name: "Selection" }).textContent).toBe("a,c,b");
  const resize = screen.getByRole("button", { name: "Resize Size column" });
  const before = screen.getByRole("row", { name: "Alpha" }).style.gridTemplateColumns;
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  expect(screen.getByRole("row", { name: "Alpha" }).style.gridTemplateColumns).not.toBe(before);
  fireEvent.click(screen.getByText("Columns", { selector: "summary" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Size" }));
  expect(screen.queryByRole("columnheader", { name: /Resize Size/ })).toBeNull();
  expect(screen.getByRole("grid").getAttribute("aria-colcount")).toBe("2");
});

it("preserves FileGrid focus when a responsive column change reparents the active card", () => {
  render(<Fixture kind="grid" />);
  act(() => screen.getByRole("gridcell", { name: "Charlie" }).focus());
  act(() => {
    viewportWidth = 430;
    for (const callback of resizeCallbacks) callback();
  });
  expect(screen.getByRole("grid").getAttribute("aria-colcount")).toBe("2");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Charlie");
  expect(screen.getByRole("gridcell", { name: "Charlie" }).getAttribute("aria-colindex")).toBe("1");
});

for (const kind of ["table", "grid"] as const) {
  it(`${kind} clears an accessible filtered empty state`, async () => {
    const clear = vi.fn();
    const props = {
      items: [],
      getKey,
      getLabel,
      label: "Files",
      onOpen,
      filterQuery: "missing",
      onClearFilters: clear,
    };
    const { container } = render(
      <main>
        <h1>Files</h1>
        {kind === "table" ? <DataTable {...props} columns={columns} /> : <FileGrid {...props} />}
      </main>,
    );
    expect(screen.getByRole("heading", { name: "No results for 'missing'" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(clear).toHaveBeenCalledOnce();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(
      results.violations.filter(
        (entry) => entry.impact === "serious" || entry.impact === "critical",
      ),
    ).toEqual([]);
  });
}

it("resizes the first column from its rendered fill width within its real limits", () => {
  render(<Fixture kind="table" />);
  const resize = screen.getByRole("button", { name: "Resize Name column" });
  const width = () =>
    Number.parseFloat(
      screen.getByRole("row", { name: "Alpha" }).style.gridTemplateColumns.split(" ")[1] ?? "0",
    );
  expect(width()).toBe(576);
  fireEvent.keyDown(resize, { key: "ArrowLeft" });
  expect(width()).toBe(560);
  for (let i = 0; i < 40; i++) fireEvent.keyDown(resize, { key: "ArrowLeft" });
  expect(width()).toBe(100);
  for (let i = 0; i < 40; i++) fireEvent.keyDown(resize, { key: "ArrowRight" });
  expect(width()).toBe(640);
  fireEvent.keyDown(resize, { key: "ArrowLeft" });
  expect(width()).toBe(624);
});

it("uses the rendered first-column width as the pointer resize origin", () => {
  render(<Fixture kind="table" />);
  const resize = screen.getByRole("button", { name: "Resize Name column" });
  fireEvent.mouseDown(resize, { clientX: 576, button: 0 });
  fireEvent.mouseMove(document, { clientX: 496 });
  fireEvent.mouseUp(document, { clientX: 496 });
  expect(screen.getByRole("row", { name: "Alpha" }).style.gridTemplateColumns).toBe(
    "44px 496px 180px",
  );
});
