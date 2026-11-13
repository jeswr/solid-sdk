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
import {
  Fragment,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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

export type DataTableSorting = SortingState;
export interface DataTableRowContext {
  selected: boolean;
  active: boolean;
}
/** Native row events/attributes; style must not set display or position. Layout and grid semantics remain table-owned. */
export type DataTableRowProps = Omit<
  HTMLAttributes<HTMLTableRowElement>,
  | "children"
  | "dangerouslySetInnerHTML"
  | "role"
  | "tabIndex"
  | "aria-selected"
  | "aria-label"
  | "aria-rowindex"
  | "hidden"
  | "aria-hidden"
  | "inert"
  | "onClickCapture"
  | "onKeyDownCapture"
  | "onFocusCapture"
  | "onContextMenuCapture"
  | "onPointerDownCapture"
> & { [attribute: `data-${string}`]: string | number | boolean | undefined };

export interface DataColumn<T> {
  id: string;
  header: string;
  accessor: (item: T) => string | number;
  render?: (item: T, context?: DataTableRowContext) => ReactNode;
  size?: number;
  minSize?: number;
  maxSize?: number;
  hideable?: boolean;
  sortable?: boolean;
  /** Hide below this collection viewport width in CSS pixels, independently of user choices. */
  visibleFrom?: number;
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
  /** Controlled sort state. Omit to retain the table's local sorting. */
  sorting?: DataTableSorting;
  onSortingChange?: (sorting: DataTableSorting) => void;
  /** Keep the supplied item order (e.g. server sorting or folders first). */
  manualSorting?: boolean;
  showSelectionCheckboxes?: boolean;
  showColumnOptions?: boolean;
  resizableColumns?: boolean;
  stickyHeader?: boolean;
  openOnDoubleClick?: boolean;
  selectionFollowsFocus?: boolean;
  getRowProps?: (item: T, context: DataTableRowContext) => DataTableRowProps;
  /** Wrap the supplied native row with an asChild context-menu trigger, without replacing it. */
  renderRow?: (item: T, row: ReactElement) => ReactNode;
}

/** React portals bubble through the row's React tree despite living outside its DOM. */
function ownsRowEvent(event: SyntheticEvent<HTMLTableRowElement>, skipInteractive = false) {
  if (!event.currentTarget.contains(event.target as Node)) {
    // Never stopPropagation(): the portalled content and listeners above the row still need it.
    // Radix composes its slotted handler after ours and checks this synthetic flag.
    // Do not call preventDefault(): portalled inputs must keep native context menus/focus.
    event.defaultPrevented = true;
    return false;
  }
  return !skipInteractive || !isInteractiveDescendant(event);
}

/** Enter/leave pair up across portals: React sends the row's leave with the portal as target. */
const boundaryHandlers = new Set([
  "onMouseEnter",
  "onMouseLeave",
  "onPointerEnter",
  "onPointerLeave",
]);

/** Apply containment to every supplied handler, including drag and pointer events. */
function ownedRowProps(props: DataTableRowProps | undefined): DataTableRowProps {
  return Object.fromEntries(
    Object.entries(props ?? {}).map(([name, value]) => [
      name,
      name.startsWith("on") && !boundaryHandlers.has(name) && typeof value === "function"
        ? (event: SyntheticEvent<HTMLTableRowElement>) => {
            if (ownsRowEvent(event)) value(event);
          }
        : value,
    ]),
  );
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
  sorting: suppliedSorting,
  onSortingChange,
  manualSorting = false,
  showSelectionCheckboxes = true,
  showColumnOptions = true,
  resizableColumns = true,
  stickyHeader = true,
  openOnDoubleClick = false,
  selectionFollowsFocus = false,
  getRowProps,
  renderRow,
  ...surface
}: DataTableProps<T>) {
  const local = useSelection();
  const selection = supplied ?? local;
  const [localSorting, setSorting] = useState<SortingState>([]);
  const sorting = suppliedSorting ?? localSorting;
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const metrics = useCollectionMetrics("table");
  const optionsId = useId();
  // Keep TanStack's per-row cell visibility caches intact during virtual scrolling.
  const effectiveVisibility = useMemo(() => {
    const visibility = Object.fromEntries(
      columns.map((column) => [
        column.id,
        columnVisibility[column.id] !== false &&
          (!metrics.width || metrics.width >= (column.visibleFrom ?? 0)),
      ]),
    );
    // Retain a data column when every responsive threshold is above the viewport.
    const fallback = columns.find((column) => columnVisibility[column.id] !== false) ?? columns[0];
    if (fallback && !Object.values(visibility).some(Boolean)) visibility[fallback.id] = true;
    return visibility;
  }, [columns, columnVisibility, metrics.width]);
  const selectionWidth = showSelectionCheckboxes ? 44 : 0;
  const headerHeight = metrics.headerHeight;
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const visibleDefinitions = columns.filter((column) => effectiveVisibility[column.id]);
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
      Math.min(
        first.maxSize ?? 640,
        Math.max(first.size ?? 180, metrics.width - selectionWidth - otherWidth),
      ),
    );
  }
  const canChangeSorting = suppliedSorting === undefined || onSortingChange !== undefined;
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
    state: { sorting, columnVisibility: effectiveVisibility, columnSizing: effectiveSizing },
    onColumnSizingChange: (updater) =>
      setColumnSizing(typeof updater === "function" ? updater(effectiveSizing) : updater),
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (suppliedSorting === undefined) setSorting(next);
      onSortingChange?.(next);
    },
    manualSorting,
    enableMultiSort: false,
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
    selectionFollowsFocus,
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
    paddingStart: headerHeight,
    scrollPaddingStart: (stickyHeader ? headerHeight : 0) + 4,
    initialRect: { width: 800, height },
  });
  useEffect(() => {
    if (metrics.height) virtual.measure();
  }, [virtual, metrics.height]);
  const visible = table.getVisibleLeafColumns();
  const widths = visible.map((column) => column.getSize());
  const gridTemplateColumns = `${showSelectionCheckboxes ? "44px " : ""}${widths.map((width) => `${width}px`).join(" ")}`;
  const minWidth = selectionWidth + widths.reduce((sum, width) => sum + width, 0);
  const allSelected = keys.length > 0 && keys.every((key) => selection.selectedKeys.has(key));
  const someSelected = keys.some((key) => selection.selectedKeys.has(key));
  const content = hasCollectionContent(surface.state, items.length);

  return (
    <div ref={navigation.collection} className="suite-collection" data-collection="table">
      <div className="suite-collection-toolbar">
        {showColumnOptions && (
          <details className="suite-column-options">
            <summary>Columns</summary>
            <fieldset>
              <legend>Visible columns</legend>
              {table.getAllLeafColumns().map((column, index) => (
                <label key={column.id}>
                  <input
                    type="checkbox"
                    checked={columnVisibility[column.id] !== false}
                    aria-describedby={
                      columnVisibility[column.id] !== false && !column.getIsVisible()
                        ? `${optionsId}-${index}`
                        : undefined
                    }
                    disabled={
                      !column.getCanHide() || (column.getIsVisible() && visible.length === 1)
                    }
                    onChange={(event) =>
                      setColumnVisibility((previous) => ({
                        ...previous,
                        [column.id]: event.target.checked,
                      }))
                    }
                  />
                  {String(column.columnDef.header)}
                  {columnVisibility[column.id] !== false && !column.getIsVisible() && (
                    <span id={`${optionsId}-${index}`} aria-hidden="true">
                      {" "}
                      (hidden at this width)
                    </span>
                  )}
                </label>
              ))}
            </fieldset>
          </details>
        )}
        <CollectionStatus state={surface.state} selectedCount={selection.selectedKeys.size} />
      </div>
      <CollectionPlaceholder kind="table" count={items.length} {...surface} />
      <div
        ref={metrics.viewport}
        className="suite-table-viewport"
        data-sticky-header={stickyHeader}
        style={{ height: content ? height : 0 }}
        hidden={!content}
      >
        <table
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: The spec requires an interactive native table grid.
          role="grid"
          aria-label={label}
          aria-multiselectable="true"
          aria-rowcount={rows.length + 1}
          aria-colcount={visible.length + (showSelectionCheckboxes ? 1 : 0)}
          aria-busy={surface.state?.status === "refreshing"}
          style={{ minWidth }}
        >
          <thead>
            <tr style={{ gridTemplateColumns }} aria-rowindex={1}>
              {showSelectionCheckboxes && (
                <th scope="col">
                  <SelectionCheckbox
                    label="Select all visible files"
                    checked={allSelected}
                    mixed={someSelected && !allSelected}
                    onClick={() => selection.toggleAll(keys)}
                  />
                </th>
              )}
              {table
                .getFlatHeaders()
                .filter((header) => header.column.getIsVisible())
                .map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      !header.column.getCanSort()
                        ? undefined
                        : header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : undefined
                    }
                  >
                    <button
                      type="button"
                      className="suite-sort"
                      disabled={!header.column.getCanSort() || !canChangeSorting}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {String(header.column.columnDef.header)}
                      {header.column.getIsSorted() === "asc" ? (
                        <ArrowUp aria-hidden="true" size={16} strokeWidth={1.75} />
                      ) : header.column.getIsSorted() === "desc" ? (
                        <ArrowDown aria-hidden="true" size={16} strokeWidth={1.75} />
                      ) : null}
                    </button>
                    {resizableColumns && (
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
                    )}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody style={{ height: Math.max(0, virtual.getTotalSize() - headerHeight) }}>
            {virtual.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              const context = {
                selected: selection.selectedKeys.has(row.id),
                active: navigation.activeKey === row.id,
              };
              const rowProps = getRowProps?.(row.original, context);
              const itemProps = navigation.itemProps(row.id);
              const element = (
                <tr
                  {...ownedRowProps(rowProps)}
                  {...itemProps}
                  data-collection-item="true"
                  aria-label={getLabel(row.original)}
                  aria-selected={selection.selectedKeys.has(row.id)}
                  aria-rowindex={virtualRow.index + 2}
                  style={{
                    ...rowProps?.style,
                    height: metrics.height,
                    transform: `translateY(${virtualRow.start - headerHeight}px)`,
                    gridTemplateColumns,
                  }}
                  onFocus={(event) => {
                    if (!ownsRowEvent(event)) return;
                    itemProps.onFocus();
                    rowProps?.onFocus?.(event);
                  }}
                  onBlur={(event) => {
                    if (!ownsRowEvent(event)) return;
                    itemProps.onBlur(event);
                    rowProps?.onBlur?.(event);
                  }}
                  onKeyDown={(event) => {
                    if (!ownsRowEvent(event)) return;
                    // The selection checkbox acts for the row, as it does for navigation.
                    if (
                      (event.target as HTMLElement).matches?.(".suite-selection-checkbox") ||
                      ownsRowEvent(event, true)
                    )
                      rowProps?.onKeyDown?.(event);
                    itemProps.onKeyDown(event);
                  }}
                  onContextMenu={(event) => {
                    if (ownsRowEvent(event)) rowProps?.onContextMenu?.(event);
                  }}
                  onPointerDown={(event) => {
                    if (ownsRowEvent(event)) rowProps?.onPointerDown?.(event);
                  }}
                  onClick={(event) => {
                    if (!ownsRowEvent(event, true)) return;
                    rowProps?.onClick?.(event);
                    if (event.defaultPrevented) return;
                    event.currentTarget.focus({ preventScroll: true });
                    selection.select(row.id, keys, {
                      range: event.shiftKey,
                      toggle: event.ctrlKey || event.metaKey,
                      additive: event.ctrlKey || event.metaKey,
                    });
                  }}
                  onDoubleClick={(event) => {
                    if (!ownsRowEvent(event, true)) return;
                    rowProps?.onDoubleClick?.(event);
                    if (openOnDoubleClick && !event.defaultPrevented) onOpen(row.original);
                  }}
                >
                  {showSelectionCheckboxes && (
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
                  )}
                  {row.getVisibleCells().map((cell, index) => {
                    const column = columns.find((candidate) => candidate.id === cell.column.id);
                    const value = column?.render
                      ? column.render(row.original, context)
                      : String(cell.getValue());
                    return (
                      <td key={cell.id}>
                        {index === 0 && !column?.render && !openOnDoubleClick ? (
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
              return (
                <Fragment key={row.id}>
                  {renderRow ? renderRow(row.original, element) : element}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
