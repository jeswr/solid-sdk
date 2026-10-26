// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";

import {
  type ColumnDef,
  type ColumnSizingState,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  CollectionPlaceholder,
  CollectionStatus,
  type CollectionSurfaceProps,
  hasCollectionContent,
} from "./collection-state.js";
import {
  isInteractiveDescendant,
  useCollectionMetrics,
  useCollectionNavigation,
} from "./use-collection.js";
import { type SelectionModel, useSelection } from "./use-selection.js";

export interface DataColumn<T> {
  id: string;
  header: string;
  accessor: (item: T) => string | number;
  render?: (item: T) => ReactNode;
  size?: number;
  minSize?: number;
  maxSize?: number;
  hideable?: boolean;
  sortable?: boolean;
}
export interface DataTableProps<T> extends CollectionSurfaceProps {
  items: T[];
  columns: DataColumn<T>[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  label: string;
  selection?: SelectionModel;
  onOpen: (item: T) => void;
  onDetails?: (item: T) => void;
  height?: number;
}

function SelectionCheckbox({
  checked,
  mixed = false,
  label,
  onClick,
  tabIndex,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  onClick: (event: MouseEvent<HTMLInputElement>) => void;
  tabIndex?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      className="suite-selection-checkbox"
      type="checkbox"
      aria-label={label}
      checked={checked}
      aria-checked={mixed ? "mixed" : checked}
      onChange={() => {}}
      onClick={onClick}
      tabIndex={tabIndex}
    />
  );
}

/** Pass filtered items; sorting and range selection always use the displayed row order. */
export function DataTable<T>({
  items,
  columns,
  getKey,
  getLabel,
  label,
  selection: supplied,
  onOpen,
  onDetails,
  height = 440,
  ...surface
}: DataTableProps<T>) {
  const local = useSelection();
  const selection = supplied ?? local;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const metrics = useCollectionMetrics("table");
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const visibleDefinitions = columns.filter((column) => columnVisibility[column.id] !== false);
  const first = visibleDefinitions[0];
  const otherWidth = visibleDefinitions
    .slice(1)
    .reduce(
      (sum, column) =>
        sum +
        Math.max(
          column.minSize ?? 100,
          Math.min(column.maxSize ?? 640, columnSizing[column.id] ?? column.size ?? 180),
        ),
      0,
    );
  // TanStack and the rendered grid share the same width, including automatic viewport fill.
  const effectiveSizing = { ...columnSizing };
  if (first && effectiveSizing[first.id] === undefined) {
    effectiveSizing[first.id] = Math.max(
      first.minSize ?? 100,
      Math.min(first.maxSize ?? 640, Math.max(first.size ?? 180, metrics.width - 44 - otherWidth)),
    );
  }
  const definitions = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        accessorFn: column.accessor,
        header: column.header,
        enableHiding: column.hideable !== false,
        enableSorting: column.sortable !== false,
        size: column.size ?? 180,
        minSize: column.minSize ?? 100,
        maxSize: column.maxSize ?? 640,
      })),
    [columns],
  );
  const table = useReactTable({
    data: items,
    columns: definitions,
    state: { sorting, columnVisibility, columnSizing: effectiveSizing },
    onColumnSizingChange: (updater) =>
      setColumnSizing(typeof updater === "function" ? updater(effectiveSizing) : updater),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: getKey,
    columnResizeMode: "onChange",
  });
  const rows = table.getRowModel().rows;
  const keys = useMemo(() => rows.map((row) => row.id), [rows]);
  const byKey = useMemo(() => new Map(items.map((item) => [getKey(item), item])), [items, getKey]);
  const navigation = useCollectionNavigation({
    keys,
    selection,
    scrollToIndex: (index) => virtual.scrollToIndex(index, { align: "auto" }),
    onOpen: (key) => {
      const item = byKey.get(key);
      if (item) onOpen(item);
    },
    onDetails: (key) => {
      const item = byKey.get(key);
      if (item) onDetails?.(item);
    },
  });
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => metrics.viewport.current,
    estimateSize: () => metrics.height,
    overscan: 5,
    getItemKey: (index) => keys[index] ?? index,
    rangeExtractor: navigation.rangeExtractor,
    paddingStart: metrics.headerHeight,
    scrollPaddingStart: metrics.headerHeight + 4,
    initialRect: { width: 800, height },
  });
  useEffect(() => {
    if (metrics.height) virtual.measure();
  }, [virtual, metrics.height]);
  const visible = table.getVisibleLeafColumns();
  const widths = visible.map((column) => column.getSize());
  const gridTemplateColumns = `44px ${widths.map((width) => `${width}px`).join(" ")}`;
  const minWidth = 44 + widths.reduce((sum, width) => sum + width, 0);
  const allSelected = keys.length > 0 && keys.every((key) => selection.selectedKeys.has(key));
  const someSelected = keys.some((key) => selection.selectedKeys.has(key));
  const content = hasCollectionContent(surface.state, items.length);

  return (
    <div ref={navigation.collection} className="suite-collection" data-collection="table">
      <div className="suite-collection-toolbar">
        <details className="suite-column-options">
          <summary>Columns</summary>
          <fieldset>
            <legend>Visible columns</legend>
            {table.getAllLeafColumns().map((column) => (
              <label key={column.id}>
                <input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  disabled={!column.getCanHide() || (column.getIsVisible() && visible.length === 1)}
                  onChange={column.getToggleVisibilityHandler()}
                />
                {String(column.columnDef.header)}
              </label>
            ))}
          </fieldset>
        </details>
        <CollectionStatus state={surface.state} selectedCount={selection.selectedKeys.size} />
      </div>
      <CollectionPlaceholder kind="table" count={items.length} {...surface} />
      <div
        ref={metrics.viewport}
        className="suite-table-viewport"
        style={{ height: content ? height : 0 }}
        hidden={!content}
      >
        <table
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: The spec requires an interactive native table grid.
          role="grid"
          aria-label={label}
          aria-multiselectable="true"
          aria-rowcount={rows.length + 1}
          aria-colcount={visible.length + 1}
          aria-busy={surface.state?.status === "refreshing"}
          style={{ minWidth }}
        >
          <thead>
            <tr style={{ gridTemplateColumns }} aria-rowindex={1}>
              <th scope="col">
                <SelectionCheckbox
                  label="Select all visible files"
                  checked={allSelected}
                  mixed={someSelected && !allSelected}
                  onClick={() => selection.toggleAll(keys)}
                />
              </th>
              {table
                .getFlatHeaders()
                .filter((header) => header.column.getIsVisible())
                .map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    <button
                      type="button"
                      className="suite-sort"
                      disabled={!header.column.getCanSort()}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {String(header.column.columnDef.header)}
                      {header.column.getIsSorted() === "asc" ? (
                        <ArrowUp aria-hidden="true" size={16} strokeWidth={1.75} />
                      ) : header.column.getIsSorted() === "desc" ? (
                        <ArrowDown aria-hidden="true" size={16} strokeWidth={1.75} />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="suite-column-resize"
                      aria-label={`Resize ${String(header.column.columnDef.header)} column`}
                      title={`Resize ${String(header.column.columnDef.header)} column (arrow keys)`}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                        // Leave modified arrows (e.g. Alt+Left for Back) to the browser.
                        if (event.altKey || event.ctrlKey || event.metaKey) return;
                        event.preventDefault();
                        const size = Math.max(
                          header.column.columnDef.minSize ?? 100,
                          Math.min(
                            header.column.columnDef.maxSize ?? 640,
                            header.column.getSize() + (event.key === "ArrowRight" ? 16 : -16),
                          ),
                        );
                        table.setColumnSizing((previous) => ({
                          ...previous,
                          [header.column.id]: size,
                        }));
                      }}
                    >
                      <GripVertical aria-hidden="true" size={16} strokeWidth={1.75} />
                    </button>
                  </th>
                ))}
            </tr>
          </thead>
          <tbody style={{ height: Math.max(0, virtual.getTotalSize() - metrics.headerHeight) }}>
            {virtual.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <tr
                  key={row.id}
                  {...navigation.itemProps(row.id)}
                  data-collection-item="true"
                  aria-label={getLabel(row.original)}
                  aria-selected={selection.selectedKeys.has(row.id)}
                  aria-rowindex={virtualRow.index + 2}
                  style={{
                    height: metrics.height,
                    transform: `translateY(${virtualRow.start - metrics.headerHeight}px)`,
                    gridTemplateColumns,
                  }}
                  onClick={(event) => {
                    if (event.defaultPrevented || isInteractiveDescendant(event)) return;
                    selection.select(row.id, keys, {
                      range: event.shiftKey,
                      toggle: event.ctrlKey || event.metaKey,
                      additive: event.ctrlKey || event.metaKey,
                    });
                  }}
                >
                  <td>
                    <SelectionCheckbox
                      label={`Select ${getLabel(row.original)}`}
                      checked={selection.selectedKeys.has(row.id)}
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        selection.select(row.id, keys, { range: event.shiftKey, toggle: true });
                      }}
                    />
                  </td>
                  {row.getVisibleCells().map((cell, index) => {
                    const column = columns.find((candidate) => candidate.id === cell.column.id);
                    const value = column?.render?.(row.original) ?? String(cell.getValue());
                    return (
                      <td key={cell.id}>
                        {index === 0 && !column?.render ? (
                          <button
                            type="button"
                            className="suite-file-name"
                            tabIndex={-1}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(row.original);
                            }}
                          >
                            {value}
                          </button>
                        ) : (
                          value
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
