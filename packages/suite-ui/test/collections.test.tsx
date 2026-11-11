// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CollectionErrorKind,
  CollectionState,
  CollectionSurfaceProps,
} from "../src/collections/collection-state.js";
import {
  type DataColumn,
  DataTable,
  type DataTableProps,
  type DataTableSorting,
} from "../src/collections/data-table.js";
import { FileGrid } from "../src/collections/file-grid.js";
import { useSelection } from "../src/collections/use-selection.js";
import { DropZoneOverlay } from "../src/components/drop-zone-overlay.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../src/components/ui/context-menu.js";

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
  ...surface
}: {
  kind: "table" | "grid";
  data?: Item[];
} & CollectionSurfaceProps) {
  const selection = useSelection();
  const props = {
    items: data,
    getKey,
    getLabel,
    label: "Files",
    selection,
    onOpen,
    onDetails,
    ...surface,
  };
  return (
    <main>
      <h1>Files</h1>
      <input aria-label="Search" />
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
    it("keeps focus on Search when results arrive after an empty collection", () => {
      const { rerender } = render(<Fixture kind={kind} />);
      act(() => screen.getByRole(itemRole, { name: "Beta" }).focus());
      rerender(<Fixture kind={kind} data={[]} />);
      expect(document.activeElement).toBe(document.body);
      const search = screen.getByRole("textbox", { name: "Search" });
      act(() => search.focus());
      rerender(<Fixture kind={kind} data={[items[0] as Item]} />);
      expect(screen.getByRole(itemRole, { name: "Alpha" }).tabIndex).toBe(0);
      expect(document.activeElement).toBe(search);
    });
    it("restores focus after an empty collection when the removed item still owns focus", () => {
      const { rerender } = render(<Fixture kind={kind} />);
      act(() => screen.getByRole(itemRole, { name: "Beta" }).focus());
      rerender(<Fixture kind={kind} data={[]} />);
      expect(document.activeElement).toBe(document.body);
      rerender(<Fixture kind={kind} data={[items[0] as Item]} />);
      expect(document.activeElement).toBe(screen.getByRole(itemRole, { name: "Alpha" }));
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
      // Fifteen axe runs: allow for slow shared CI runners (the default 5 s timed out there).
    }, 30_000);
    it.each<CollectionErrorKind>([
      "forbidden",
      "not-found",
      "conflict",
      "name-taken",
      "quota",
      "too-large",
      "unreachable",
      "unsupported",
      "unknown",
    ])("preserves the legacy Retry callback for %s", (error) => {
      const onRetry = vi.fn();
      render(<Fixture kind={kind} state={{ status: "error", kind: error }} onRetry={onRetry} />);
      const alert = within(screen.getByRole("alert"));
      expect(alert.getAllByRole("button")).toHaveLength(1);
      fireEvent.click(alert.getByRole("button", { name: "Retry" }));
      expect(onRetry).toHaveBeenCalledOnce();
    });
    it("omits fallback recovery without a callback", () => {
      render(<Fixture kind={kind} state={{ status: "error", kind: "unknown" }} />);
      expect(within(screen.getByRole("alert")).queryByRole("button")).toBeNull();
    });
    it("prefers category-specific recovery to the legacy callback", () => {
      const onRetry = vi.fn();
      const reload = vi.fn();
      render(
        <Fixture
          kind={kind}
          state={{ status: "error", kind: "unknown" }}
          onRetry={onRetry}
          errorActions={{ reload }}
        />,
      );
      const alert = within(screen.getByRole("alert"));
      expect(alert.getAllByRole("button")).toHaveLength(1);
      fireEvent.click(alert.getByRole("button", { name: "Reload" }));
      expect(reload).toHaveBeenCalledOnce();
      expect(onRetry).not.toHaveBeenCalled();
    });
    it.each([
      false,
      true,
    ])("respects access-request capability %s before falling back", (accessRequests) => {
      const onRetry = vi.fn();
      const requestAccess = vi.fn();
      render(
        <Fixture
          kind={kind}
          state={{ status: "error", kind: "forbidden" }}
          onRetry={onRetry}
          errorActions={{ requestAccess, reload: vi.fn<() => void>() }}
          accessRequests={accessRequests}
        />,
      );
      const alert = within(screen.getByRole("alert"));
      expect(alert.getAllByRole("button")).toHaveLength(1);
      fireEvent.click(
        alert.getByRole("button", { name: accessRequests ? "Request access" : "Retry" }),
      );
      expect(requestAccess).toHaveBeenCalledTimes(accessRequests ? 1 : 0);
      expect(onRetry).toHaveBeenCalledTimes(accessRequests ? 0 : 1);
    });
    it.each<CollectionErrorKind>([
      "unknown",
      "unreachable",
    ])("keeps custom recovery in place of the legacy fallback for %s", (error) => {
      const onRetry = vi.fn();
      const recover = vi.fn();
      render(
        <Fixture
          kind={kind}
          state={{
            status: "error",
            kind: error,
            actions: (
              <button type="button" onClick={recover}>
                Recover
              </button>
            ),
          }}
          onRetry={onRetry}
        />,
      );
      const alert = within(screen.getByRole("alert"));
      expect(alert.getAllByRole("button")).toHaveLength(1);
      fireEvent.click(alert.getByRole("button", { name: "Recover" }));
      expect(recover).toHaveBeenCalledOnce();
      expect(onRetry).not.toHaveBeenCalled();
    });
    it("keeps the typed retry delay without an immediate fallback", () => {
      const onRetry = vi.fn();
      render(
        <Fixture
          kind={kind}
          state={{ status: "error", kind: "unreachable", retryAfterMs: 60000 }}
          onRetry={onRetry}
        />,
      );
      const alert = within(screen.getByRole("alert"));
      expect(alert.getAllByRole("button")).toHaveLength(1);
      const retry = alert.getByRole("button", { name: "Retry" });
      expect(retry.hasAttribute("disabled")).toBe(true);
      fireEvent.click(retry);
      expect(onRetry).not.toHaveBeenCalled();
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
  for (const modifier of ["altKey", "ctrlKey", "metaKey"])
    expect(fireEvent.keyDown(resize, { key: "ArrowLeft", [modifier]: true })).toBe(true);
  expect(screen.getByRole("row", { name: "Alpha" }).style.gridTemplateColumns).toBe(before);
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

it.each([
  "drop",
  "file picker",
  "folder picker",
])("keeps table contents and local state mounted throughout ingestion from %s", async (source) => {
  let finish = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onFiles = vi.fn(() => pending);
  render(
    <DropZoneOverlay folderName="Projects" onFiles={onFiles}>
      <DataTable
        items={items}
        columns={columns}
        getKey={getKey}
        getLabel={getLabel}
        label="Files"
        onOpen={onOpen}
      />
    </DropZoneOverlay>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Name" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Resize Name column" }), {
    key: "ArrowLeft",
  });
  fireEvent.click(screen.getByText("Columns", { selector: "summary" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Size" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Beta" }));
  const grid = screen.getByRole("grid");
  const alpha = screen.getByRole("row", { name: "Alpha" });
  const widths = alpha.style.gridTemplateColumns;
  const zone = screen.getByRole("region", { name: "Upload to Projects" });
  const file = new File(["a"], "one.txt");
  if (source === "drop") {
    fireEvent.drop(zone, {
      dataTransfer: {
        types: ["Files"],
        items: [{ kind: "file", getAsFile: () => file }],
        files: [file],
      },
    });
  } else {
    fireEvent.change(
      screen.getByLabelText(source === "file picker" ? "Choose files" : "Choose folder"),
      {
        target: { files: [file] },
      },
    );
  }
  await waitFor(() => expect(onFiles).toHaveBeenCalledOnce());
  const expectState = () => {
    expect(screen.getByRole("grid")).toBe(grid);
    expect(screen.getByRole("row", { name: "Alpha" })).toBe(alpha);
    expect(alpha.style.gridTemplateColumns).toBe(widths);
    expect(
      screen.getByRole("button", { name: "Name" }).closest("th")?.getAttribute("aria-sort"),
    ).toBe("ascending");
    expect(screen.queryByRole("button", { name: "Size" })).toBeNull();
    for (const name of ["Alpha", "Beta"])
      expect(screen.getByRole("row", { name }).getAttribute("aria-selected")).toBe("true");
  };
  try {
    expect(zone.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    expectState();
  } finally {
    await act(async () => finish());
  }
  expect(zone.getAttribute("aria-busy")).toBe("false");
  expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
  expectState();
});

for (const kind of ["table", "grid"] as const) {
  it.each(["Enter", " "])(`${kind} lets native summaries own %j and disclosure clicks`, (key) => {
    const controls = (item: Item) => (
      <details>
        <summary>
          <span>More about {item.name}</span>
        </summary>
        Extra metadata
      </details>
    );
    const props = { items, getKey, getLabel, label: "Files", onOpen, onDetails };
    render(
      kind === "table" ? (
        <DataTable
          {...props}
          columns={[
            columns[0] as DataColumn<Item>,
            { ...(columns[1] as DataColumn<Item>), render: controls },
          ]}
        />
      ) : (
        <FileGrid {...props} renderMetadata={controls} />
      ),
    );
    for (const name of ["Alpha", "Beta"])
      fireEvent.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
    const label = screen.getByText("More about Alpha");
    const summary = label.closest("summary") as HTMLElement;
    act(() => summary.focus());
    // jsdom does not synthesize a summary's keyboard click; verify the native default is allowed.
    for (const target of [summary, label]) expect(fireEvent.keyDown(target, { key })).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDetails).not.toHaveBeenCalled();
    fireEvent.click(label);
    expect(label.closest("details")?.open).toBe(true);
    for (const name of ["Alpha", "Beta"])
      expect(
        screen
          .getByRole(kind === "table" ? "row" : "gridcell", { name })
          .getAttribute("aria-selected"),
      ).toBe("true");
  });

  it(`${kind} preserves selection for clicks inside every interactive descendant`, async () => {
    const user = userEvent.setup();
    const controls = (item: Item) =>
      item.id === "a" && (
        <>
          <a href="#custom">
            <span>Custom link</span>
          </a>
          <input aria-label="Custom input" />
          <select aria-label="Custom select">
            <option>First choice</option>
          </select>
          <textarea aria-label="Custom textarea" />
          <span role="menuitem" tabIndex={0}>
            Custom menu item
          </span>
          <div contentEditable suppressContentEditableWarning>
            <span>Custom editor</span>
          </div>
          <div data-row-interactive>
            <span>Custom interactive area</span>
          </div>
          <label>
            <input type="checkbox" />
            <span>Custom label</span>
          </label>
          <div role="listbox" aria-label="Custom suggestions">
            {/* biome-ignore lint/a11y/useFocusableInteractive: aria-activedescendant options, like TagInput's, are not focusable themselves. */}
            <div role="option" aria-selected="false">
              <span>Custom option</span>
            </div>
          </div>
        </>
      );
    const props = { items, getKey, getLabel, label: "Files", onOpen };
    render(
      kind === "table" ? (
        <DataTable
          {...props}
          columns={[
            columns[0] as DataColumn<Item>,
            { ...(columns[1] as DataColumn<Item>), render: controls },
          ]}
        />
      ) : (
        <FileGrid {...props} renderMetadata={controls} />
      ),
    );
    for (const name of ["Alpha", "Beta"])
      await user.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
    for (const control of [
      screen.getByText("Custom link"),
      screen.getByRole("textbox", { name: "Custom input" }),
      screen.getByRole("combobox", { name: "Custom select" }),
      screen.getByRole("textbox", { name: "Custom textarea" }),
      screen.getByRole("menuitem", { name: "Custom menu item" }),
      screen.getByText("Custom editor"),
      screen.getByText("Custom interactive area"),
      screen.getByText("Custom label"),
      screen.getByText("Custom option"),
    ]) {
      await user.click(control);
      for (const name of ["Alpha", "Beta"])
        expect(
          screen
            .getByRole(kind === "table" ? "row" : "gridcell", { name })
            .getAttribute("aria-selected"),
        ).toBe("true");
    }
    await user.click(screen.getByRole(kind === "table" ? "row" : "gridcell", { name: "Alpha" }));
    expect(
      screen
        .getByRole(kind === "table" ? "row" : "gridcell", { name: "Beta" })
        .getAttribute("aria-selected"),
    ).toBe("false");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it.each([
    "{Enter}",
    " ",
  ])(`${kind} preserves multi-selection when a custom button activates with %s`, async (key) => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const controls = (item: Item) => (
      <button type="button" onClick={onActivate}>
        <span>Star {item.name}</span>
      </button>
    );
    const props = { items, getKey, getLabel, label: "Files", onOpen, onDetails };
    render(
      kind === "table" ? (
        <DataTable
          {...props}
          columns={[
            columns[0] as DataColumn<Item>,
            { ...(columns[1] as DataColumn<Item>), render: controls },
          ]}
        />
      ) : (
        <FileGrid {...props} renderMetadata={controls} />
      ),
    );
    for (const name of ["Alpha", "Beta"])
      await user.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
    const button = screen.getByRole("button", { name: "Star Alpha" });
    act(() => button.focus());
    await user.keyboard(key);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDetails).not.toHaveBeenCalled();
    for (const name of ["Alpha", "Beta"])
      expect(
        screen
          .getByRole(kind === "table" ? "row" : "gridcell", { name })
          .getAttribute("aria-selected"),
      ).toBe("true");
    await user.click(within(button).getByText("Star Alpha"));
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(
      screen
        .getByRole(kind === "table" ? "row" : "gridcell", { name: "Beta" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it(`${kind} leaves custom buttons and links in control of Enter and Space`, () => {
    const onActivate = vi.fn();
    const controls = () => (
      <>
        <button type="button" onClick={onActivate}>
          <span>Custom action</span>
        </button>
        <a href="#custom">Custom link</a>
      </>
    );
    const props = {
      items: [items[0] as Item],
      getKey,
      getLabel,
      label: "Files",
      onOpen,
      onDetails,
    };
    render(
      kind === "table" ? (
        <DataTable
          {...props}
          columns={[{ ...(columns[0] as DataColumn<Item>), render: controls }]}
        />
      ) : (
        <FileGrid {...props} renderMetadata={controls} />
      ),
    );
    const button = screen.getByRole("button", { name: "Custom action" });
    expect(button.parentElement?.closest("button")).toBeNull();
    for (const target of [
      within(button).getByText("Custom action"),
      screen.getByRole("link", { name: "Custom link" }),
    ]) {
      for (const key of ["Enter", " "]) expect(fireEvent.keyDown(target, { key })).toBe(true);
    }
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDetails).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole(kind === "table" ? "row" : "gridcell", { name: "Alpha" })
        .getAttribute("aria-selected"),
    ).toBe("false");
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it(`${kind} respects prevented keyboard events from custom content`, () => {
    const content = () => <span>Handled keys</span>;
    const props = {
      items: [items[0] as Item],
      getKey,
      getLabel,
      label: "Files",
      onOpen,
      onDetails,
    };
    render(
      kind === "table" ? (
        <DataTable
          {...props}
          columns={[
            columns[0] as DataColumn<Item>,
            { ...(columns[1] as DataColumn<Item>), render: content },
          ]}
        />
      ) : (
        <FileGrid {...props} renderMetadata={content} />
      ),
    );
    const target = screen.getByText("Handled keys");
    target.addEventListener("keydown", (event) => event.preventDefault());
    for (const key of ["Enter", " ", "a", "ArrowDown"])
      fireEvent.keyDown(target, { key, ctrlKey: key === "a" });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDetails).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole(kind === "table" ? "row" : "gridcell", { name: "Alpha" })
        .getAttribute("aria-selected"),
    ).toBe("false");
  });
}

it("gives column resize handles a 44px touch target on coarse pointers", () => {
  const css = readFileSync("src/styles/collections.css", "utf8");
  const base = css.indexOf(".suite-collection .suite-column-resize {\n  justify-content");
  const coarse = css.indexOf("@media (pointer: coarse)");
  const override = css.indexOf(".suite-collection .suite-column-resize {", coarse);
  // Same selector, later in the file, inside the coarse-pointer block: it wins the cascade.
  expect(base).toBeGreaterThan(-1);
  expect(override).toBeGreaterThan(Math.max(base, coarse));
  expect(css.slice(override, css.indexOf("}", override))).toMatch(
    /min-height: 44px;\s+min-width: 44px;/,
  );
});

it("renders an empty cell when a custom renderer deliberately returns null", () => {
  render(
    <DataTable
      items={items}
      columns={[
        columns[0] as DataColumn<Item>,
        { id: "actions", header: "Actions", accessor: getKey, render: () => null },
      ]}
      getKey={getKey}
      getLabel={getLabel}
      label="Files"
      onOpen={onOpen}
    />,
  );
  const cells = within(screen.getByRole("row", { name: "Alpha" })).getAllByRole("cell");
  expect(cells.at(-1)?.textContent).toBe("");
});

function ListingFixture(props: Partial<DataTableProps<Item>>) {
  const selection = useSelection();
  return (
    <main>
      <h1>Listing</h1>
      <DataTable
        items={items}
        columns={columns}
        getKey={getKey}
        getLabel={getLabel}
        label="Listing"
        onOpen={onOpen}
        selection={selection}
        {...props}
      />
      <output aria-label="Selected IDs">{[...selection.selectedKeys].join(",")}</output>
    </main>
  );
}

describe("DataTable listing options", () => {
  const order = () =>
    within(screen.getByRole("grid"))
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.getAttribute("aria-label"));

  it("controls sorting from a toolbar, reports header changes and leaves ownership with the caller", () => {
    const change = vi.fn();
    const { rerender } = render(
      <ListingFixture sorting={[{ id: "size", desc: true }]} onSortingChange={change} />,
    );
    expect(order()).toEqual(["Delta", "Alpha", "Charlie", "Beta"]);
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(change).toHaveBeenCalledWith([{ id: "size", desc: false }]);
    expect(order()[0]).toBe("Delta");
    rerender(<ListingFixture sorting={[{ id: "size", desc: false }]} onSortingChange={change} />);
    expect(order()[0]).toBe("Beta");
    expect(
      screen.getByRole("button", { name: "Size" }).closest("th")?.getAttribute("aria-sort"),
    ).toBe("ascending");
  });

  it("reports uncontrolled sort changes and preserves manual input order while displaying sort state", () => {
    const change = vi.fn();
    const { rerender } = render(<ListingFixture onSortingChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(change).toHaveBeenCalledWith([{ id: "size", desc: true }]);
    expect(order()[0]).toBe("Delta");
    rerender(<ListingFixture manualSorting sorting={[{ id: "size", desc: false }]} />);
    expect(order()).toEqual(["Alpha", "Beta", "Charlie", "Delta"]);
  });

  it("only marks the sorted sortable header and keeps Shift-click sorting to one key", () => {
    const change = vi.fn();
    render(
      <ListingFixture
        onSortingChange={change}
        columns={[
          ...columns,
          { id: "actions", header: "Actions", accessor: getKey, sortable: false },
        ]}
      />,
    );
    expect(document.querySelectorAll("th[aria-sort]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    fireEvent.click(screen.getByRole("button", { name: "Name" }), { shiftKey: true });
    expect(change).toHaveBeenLastCalledWith([{ id: "name", desc: false }]);
    expect(document.querySelectorAll("th[aria-sort]")).toHaveLength(1);
    expect(document.querySelector("th[aria-sort]")?.textContent).toBe("Name");
    expect(
      screen.getByRole("button", { name: "Size" }).closest("th")?.hasAttribute("aria-sort"),
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "Actions" }).closest("th")?.hasAttribute("aria-sort"),
    ).toBe(false);
  });

  it("ranges in the caller's manual order and supports both Cmd and Ctrl toggles without checkboxes", () => {
    render(
      <ListingFixture
        manualSorting
        showSelectionCheckboxes={false}
        items={[items[3] as Item, items[1] as Item, items[0] as Item, items[2] as Item]}
      />,
    );
    fireEvent.click(screen.getByRole("row", { name: "Delta" }));
    fireEvent.click(screen.getByRole("row", { name: "Alpha" }), { shiftKey: true });
    expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("d,b,a");
    fireEvent.click(screen.getByRole("row", { name: "Beta" }), { metaKey: true });
    fireEvent.click(screen.getByRole("row", { name: "Charlie" }), { ctrlKey: true });
    expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("d,a,c");
    expect(screen.queryByRole("checkbox", { name: /Select/ })).toBeNull();
    expect(screen.getByRole("grid").getAttribute("aria-colcount")).toBe("2");
    expect(document.activeElement).toBe(screen.getByRole("row", { name: "Charlie" }));
  });

  it("optionally selects on focus navigation; Shift, Space and Enter retain their meaning", () => {
    render(
      <ListingFixture
        selectionFollowsFocus
        showSelectionCheckboxes={false}
        onDetails={onDetails}
      />,
    );
    const alpha = screen.getByRole("row", { name: "Alpha" });
    act(() => alpha.focus());
    fireEvent.keyDown(alpha, { key: "ArrowDown" });
    expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("b");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown", shiftKey: true });
    expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("b,c");
    fireEvent.keyDown(document.activeElement as Element, { key: " " });
    expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("b");
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(items[2]);
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter", altKey: true });
    expect(onDetails).toHaveBeenCalledWith(items[2]);
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter", isComposing: true });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[data-collection-item][tabindex="0"]')).toHaveLength(1);
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown", ctrlKey: true });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Delta");
    expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("b");
    fireEvent.keyDown(document.activeElement as Element, { key: " " });
    expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("b,d");
    fireEvent.keyDown(document.activeElement as Element, { key: "Home", metaKey: true });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Alpha");
    expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("b,d");
  });

  it.each([
    "ctrlKey",
    "metaKey",
  ])("leaves %s+Left/Right to the browser while selection follows focus", (modifier) => {
    render(<ListingFixture selectionFollowsFocus />);
    const beta = screen.getByRole("row", { name: "Beta" });
    fireEvent.click(beta);
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      expect(fireEvent.keyDown(beta, { key, [modifier]: true })).toBe(true);
      expect(document.activeElement).toBe(beta);
      expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("b");
    }
    for (const [key, name] of [
      ["ArrowUp", "Alpha"],
      ["End", "Delta"],
      ["Home", "Alpha"],
      ["ArrowDown", "Beta"],
    ] as const) {
      expect(fireEvent.keyDown(document.activeElement as Element, { key, [modifier]: true })).toBe(
        false,
      );
      expect(document.activeElement).toBe(screen.getByRole("row", { name }));
      expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("b");
    }
  });

  it("keeps input keydowns out of row shortcuts while preserving checkbox navigation", () => {
    const rowKeyDown = vi.fn();
    render(
      <ListingFixture
        getRowProps={() => ({ onKeyDown: rowKeyDown })}
        columns={[
          columns[0] as DataColumn<Item>,
          {
            ...(columns[1] as DataColumn<Item>),
            render: (item) => <input aria-label={`Rename ${item.name}`} />,
          },
        ]}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Rename Alpha" });
    act(() => input.focus());
    for (const key of ["Backspace", "Enter", " "]) {
      expect(fireEvent.keyDown(input, { key })).toBe(true);
    }
    expect(rowKeyDown).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Selected IDs" }).textContent).toBe("");
    // The selection checkbox acts for its row: navigation and row shortcuts both see it.
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Select Alpha" }), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("row", { name: "Beta" }));
    expect(rowKeyDown).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("row", { name: "Beta" }), { key: "Backspace" });
    expect(rowKeyDown).toHaveBeenCalledTimes(2);
  });

  it("hides columns by collection width, keeps user choices across resizes and retains a fallback column", () => {
    const responsive: DataColumn<Item>[] = [
      columns[0] as DataColumn<Item>,
      { ...(columns[1] as DataColumn<Item>), visibleFrom: 700 },
    ];
    const { rerender } = render(<ListingFixture columns={responsive} />);
    const sizeHeader = () => screen.queryByRole("button", { name: "Size" });
    expect(sizeHeader()).not.toBeNull();
    act(() => {
      viewportWidth = 400;
      for (const callback of resizeCallbacks) callback();
    });
    expect(sizeHeader()).toBeNull();
    const sizeOption = screen.getByRole("checkbox", { name: "Size", hidden: true });
    const describedBy = sizeOption.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy ?? "")?.textContent).toContain(
      "hidden at this width",
    );
    expect(screen.getByRole("grid").getAttribute("aria-colcount")).toBe("2");
    fireEvent.click(screen.getByText("Columns", { selector: "summary" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Size" }));
    act(() => {
      viewportWidth = 800;
      for (const callback of resizeCallbacks) callback();
    });
    expect(sizeHeader()).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Size" }));
    expect(sizeHeader()).not.toBeNull();
    rerender(
      <ListingFixture columns={responsive.map((column) => ({ ...column, visibleFrom: 2000 }))} />,
    );
    expect(screen.getByRole("button", { name: "Name" })).toBeDefined();
    expect(sizeHeader()).toBeNull();
  });

  it("offers a plain listing without built-in column controls and with a nonsticky header", () => {
    render(
      <ListingFixture
        showColumnOptions={false}
        resizableColumns={false}
        showSelectionCheckboxes={false}
        stickyHeader={false}
      />,
    );
    expect(screen.queryByText("Columns", { selector: "summary" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Resize/ })).toBeNull();
    expect(screen.getByRole("grid").parentElement?.dataset.stickyHeader).toBe("false");
    expect(screen.getByRole("row", { name: "Alpha" }).style.gridTemplateColumns).toBe(
      "620px 180px",
    );
  });

  it("only opens a row on opted-in double click, respecting controls and prevented events", () => {
    const { rerender } = render(<ListingFixture />);
    fireEvent.doubleClick(screen.getByRole("row", { name: "Alpha" }));
    expect(onOpen).not.toHaveBeenCalled();
    rerender(<ListingFixture openOnDoubleClick />);
    const alpha = screen.getByRole("row", { name: "Alpha" });
    expect(within(alpha).queryByRole("button", { name: "Alpha" })).toBeNull();
    fireEvent.click(within(alpha).getByText("Alpha"));
    expect(alpha.getAttribute("aria-selected")).toBe("true");
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByRole("row", { name: "Alpha" }));
    expect(onOpen).toHaveBeenCalledOnce();
    rerender(
      <ListingFixture
        openOnDoubleClick
        columns={[
          {
            ...(columns[0] as DataColumn<Item>),
            render: (item) => <button type="button">Action for {item.name}</button>,
          },
        ]}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: "Action for Alpha" }));
    expect(onOpen).toHaveBeenCalledOnce();
    rerender(
      <ListingFixture
        openOnDoubleClick
        getRowProps={() => ({ onDoubleClick: (event) => event.preventDefault() })}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("row", { name: "Alpha" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("composes row events, exposes context and preserves table layout and keyboard ownership", () => {
    const drag = vi.fn();
    const drop = vi.fn();
    const focus = vi.fn();
    const blur = vi.fn();
    const contexts = vi.fn();
    render(
      <ListingFixture
        getRowProps={(item, context) => {
          contexts(item.id, context);
          return {
            draggable: true,
            onDragStart: drag,
            onDrop: drop,
            onFocus: focus,
            onBlur: blur,
            onKeyDown: (event) => {
              if (event.key === "Enter") event.preventDefault();
            },
            onClick: (event) => {
              if (event.shiftKey) event.preventDefault();
            },
            "data-drop": item.id === "a",
            className: "custom-row",
            style: { height: 999, color: "red" },
          };
        }}
      />,
    );
    const alpha = screen.getByRole("row", { name: "Alpha" });
    fireEvent.dragStart(alpha);
    fireEvent.drop(alpha);
    expect(drag).toHaveBeenCalledOnce();
    expect(drop).toHaveBeenCalledOnce();
    expect(alpha.dataset.drop).toBe("true");
    expect(alpha.className).toBe("custom-row");
    expect(alpha.style.height).toBe("44px");
    expect(alpha.style.color).toBe("red");
    act(() => alpha.focus());
    expect(focus).toHaveBeenCalled();
    fireEvent.keyDown(alpha, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(alpha, { shiftKey: true });
    expect(alpha.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(alpha);
    expect(contexts).toHaveBeenCalledWith("a", { selected: true, active: true });
    act(() => screen.getByRole("row", { name: "Beta" }).focus());
    expect(blur).toHaveBeenCalled();
  });

  it("wraps rows with context menus and ignores events from noninteractive portalled content", async () => {
    const rowHandlers = {
      onClick: vi.fn(),
      onDoubleClick: vi.fn(),
      onKeyDown: vi.fn(),
      onContextMenu: vi.fn(),
      onPointerDown: vi.fn(),
      onDragStart: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDragEnd: vi.fn(),
      onDrop: vi.fn(),
      onFocus: vi.fn(),
      onBlur: vi.fn(),
    };
    const portalled = vi.fn();
    const { container } = render(
      <ListingFixture
        openOnDoubleClick
        getRowProps={() => rowHandlers}
        renderRow={(item, row) => (
          <ContextMenu>
            <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem>Inspect {item.name}</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
        columns={[
          columns[0] as DataColumn<Item>,
          {
            ...(columns[1] as DataColumn<Item>),
            render: (item, context) => (
              <>
                <button type="button" tabIndex={context?.active ? 0 : -1}>
                  Actions for {item.name}
                </button>
                {item.id === "a" &&
                  createPortal(
                    <div>
                      <span>Portalled text</span>
                      <button type="button" onClick={portalled}>
                        Portalled action
                      </button>
                      <input aria-label="Portalled rename" />
                    </div>,
                    document.body,
                  )}
              </>
            ),
          },
        ]}
      />,
    );
    const text = screen.getByText("Portalled text");
    const alpha = screen.getByRole("row", { name: "Alpha" });
    const beta = screen.getByRole("row", { name: "Beta" });
    // A plain span has no interactive ancestor: containment alone must reject it.
    expect(alpha.contains(text)).toBe(false);
    act(() => beta.focus());
    for (const handler of Object.values(rowHandlers)) handler.mockClear();
    fireEvent.click(text);
    fireEvent.doubleClick(text);
    for (const key of ["Enter", " "]) expect(fireEvent.keyDown(text, { key })).toBe(true);
    expect(fireEvent.contextMenu(text)).toBe(true);
    fireEvent.pointerDown(text);
    fireEvent.dragStart(text);
    fireEvent.dragOver(text);
    fireEvent.dragLeave(text);
    fireEvent.drop(text);
    fireEvent.dragEnd(text);
    fireEvent.focus(text);
    fireEvent.blur(text);
    const input = screen.getByRole("textbox", { name: "Portalled rename" });
    expect(fireEvent.contextMenu(input)).toBe(true);
    expect(fireEvent.pointerDown(input)).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(beta);
    expect(beta.tabIndex).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Portalled action" }));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Portalled action" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Portalled action" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Actions for Alpha" }));
    fireEvent.doubleClick(screen.getByRole("button", { name: "Actions for Alpha" }));
    expect(portalled).toHaveBeenCalledOnce();
    for (const handler of Object.values(rowHandlers)) expect(handler).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("row", { name: "Alpha" }).getAttribute("aria-selected")).toBe("false");
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(
      results.violations.filter(
        (entry) => entry.impact === "serious" || entry.impact === "critical",
      ),
    ).toEqual([]);
    fireEvent.contextMenu(screen.getByRole("row", { name: "Alpha" }));
    expect(await screen.findByRole("menuitem", { name: "Inspect Alpha" })).toBeDefined();
    expect(rowHandlers.onContextMenu).toHaveBeenCalledOnce();
  });

  it("lets portalled events keep propagating and pairs row enter/leave across portals", () => {
    const outerKeyDown = vi.fn();
    const windowKeyDown = vi.fn();
    const portalledMouseDown = vi.fn();
    const rowHandlers = {
      onMouseDownCapture: vi.fn(),
      onMouseEnter: vi.fn(),
      onMouseLeave: vi.fn(),
    };
    window.addEventListener("keydown", windowKeyDown);
    try {
      render(
        // biome-ignore lint/a11y/noStaticElementInteractions: probe for bubbling past the table.
        <div onKeyDown={outerKeyDown}>
          <ListingFixture
            getRowProps={() => rowHandlers}
            columns={[
              columns[0] as DataColumn<Item>,
              {
                ...(columns[1] as DataColumn<Item>),
                render: (item) =>
                  item.id === "a" &&
                  createPortal(
                    <button type="button" onMouseDown={portalledMouseDown}>
                      Portalled menu item
                    </button>,
                    document.body,
                  ),
              },
            ]}
          />
        </div>,
      );
      const portalled = screen.getByRole("button", { name: "Portalled menu item" });
      fireEvent.keyDown(portalled, { key: "Escape" });
      fireEvent.mouseDown(portalled);
      expect(outerKeyDown).toHaveBeenCalledOnce();
      expect(windowKeyDown).toHaveBeenCalledOnce();
      expect(portalledMouseDown).toHaveBeenCalledOnce();
      expect(rowHandlers.onMouseDownCapture).not.toHaveBeenCalled();
      const alpha = screen.getByRole("row", { name: "Alpha" });
      fireEvent.mouseEnter(alpha);
      fireEvent.mouseLeave(portalled, { relatedTarget: document.body });
      expect(rowHandlers.onMouseEnter).toHaveBeenCalledOnce();
      expect(rowHandlers.onMouseLeave).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", windowKeyDown);
    }
  });

  it("blocks the slotted touch long-press handler for portals and retains it on the row", () => {
    vi.useFakeTimers();
    try {
      render(
        <ListingFixture
          renderRow={(item, row) => (
            <ContextMenu>
              <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>Inspect {item.name}</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
          columns={[
            {
              ...(columns[0] as DataColumn<Item>),
              render: (item) =>
                item.id === "a" && createPortal(<span>Portalled long press</span>, document.body),
            },
          ]}
        />,
      );
      fireEvent.pointerDown(screen.getByText("Portalled long press"), { pointerType: "touch" });
      act(() => vi.advanceTimersByTime(750));
      expect(screen.queryByRole("menu")).toBeNull();
      fireEvent.pointerDown(screen.getByRole("row", { name: "Alpha" }), { pointerType: "touch" });
      act(() => vi.advanceTimersByTime(750));
      expect(screen.getByRole("menuitem", { name: "Inspect Alpha" })).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("displays controlled sorting without interactive headers when no change callback is supplied", () => {
    render(<ListingFixture sorting={[{ id: "size", desc: true }]} />);
    const header = screen.getByRole("button", { name: "Size" });
    expect(header.hasAttribute("disabled")).toBe(true);
    expect(header.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(order()[0]).toBe("Delta");
  });

  it("uses a controlled sort in an interactive host without resetting selected IDs", () => {
    function Controlled() {
      const [sorting, setSorting] = useState<DataTableSorting>([]);
      return <ListingFixture sorting={sorting} onSortingChange={setSorting} />;
    }
    render(<Controlled />);
    fireEvent.click(screen.getByRole("row", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(order()[0]).toBe("Delta");
    expect(screen.getByRole("row", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
  });
});
