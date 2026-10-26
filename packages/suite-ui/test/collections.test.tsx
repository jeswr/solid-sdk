// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CollectionErrorKind, CollectionState } from "../src/collections/collection-state.js";
import { type DataColumn, DataTable } from "../src/collections/data-table.js";
import { FileGrid } from "../src/collections/file-grid.js";
import { useSelection } from "../src/collections/use-selection.js";
import { DropZoneOverlay } from "../src/components/drop-zone-overlay.js";

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
