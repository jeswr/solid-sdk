// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/**
 * The Drive listing (04-drive §2.2–2.4, §4): toolbar with filter chips, sort
 * and view toggle; list (grid-pattern table) or grid of cards; selection,
 * keyboard shortcuts, context and overflow menus, drag to move, drop to
 * upload. Folder, Recent, Starred and Search all render through it.
 *
 * Stand-in for DS-06 `DataTable` / DS-07 `FileGrid` until those support
 * controlled sorting, row menus and drag and drop (tracked as a bead).
 */

import {
  Button,
  ContextMenu,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Skeleton,
  toast,
} from "@jeswr/suite-ui";
import {
  ArrowDownUp,
  FolderPlus,
  LayoutGrid,
  List,
  MoreVertical,
  RefreshCw,
  Star,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { encodeRef } from "@/lib/refs";
import { type DriveItem, nameOf, parentOf } from "../lib/client/client";
import { isOwnStorage } from "../lib/client/ownership";
import {
  createSelection,
  type SelectionState,
  selectionReducer,
  TYPE_FILTERS,
  type TypeFilter,
} from "../lib/list";
import {
  formatModified,
  formatSize,
  MODIFIED_FILTERS,
  type ModifiedFilter,
  TYPE_FILTER_LABELS,
  viewItems,
} from "../lib/view/view";
import {
  captureDragItems,
  clearDragItems,
  DRIVE_ITEMS_TYPE,
  takeDragItems,
} from "../state/drag-items";
import { useDrive } from "../state/drive-context";
import { readDrop } from "../state/dropped-files";
import { useDriveListingFocus } from "../state/listing-focus";
import { OwnerLabel } from "../state/ownership";
import { errorMessage, focusDriveListing, useDriveActions, useDriveUi } from "../state/ui";
import { ItemIcon } from "./item-icon";
import { ContextEntries, DropdownEntries, useItemMenu } from "./item-menu";
import { ProtectionBanner } from "./protection-banner";

export type BrowserItem = DriveItem & { readonly folder?: string; readonly openedAt?: Date };
export type BrowserColumn =
  | "owner"
  | "modified"
  | "size"
  | "location"
  | "shared-by"
  | "opened"
  | "host";

export interface EmptyCopy {
  readonly title: string;
  readonly body?: string;
  readonly icon: ReactNode;
  readonly actions?: ReactNode;
}

export interface FileBrowserProps {
  readonly title: string;
  /** `undefined` while loading. */
  readonly items: readonly BrowserItem[] | undefined;
  readonly error?: unknown;
  readonly onRetry?: () => void;
  readonly refreshing?: boolean;
  /** The folder being shown: enables upload, drop, New folder and "go to parent". */
  readonly folder?: string;
  readonly columns: readonly BrowserColumn[];
  readonly empty: EmptyCopy;
  /** Keep the given order (Recent): no sort menu, no folders-first. */
  readonly fixedOrder?: boolean;
  readonly showModifiedFilter?: boolean;
  readonly banner?: ReactNode;
  readonly footer?: ReactNode;
}

const PLACEHOLDERS = Array.from({ length: 10 }, (_, n) => `placeholder-${n}`);

function locationLabel(folder: string | undefined, driveRoot: string | undefined): string {
  if (!folder) return "—";
  return folder === driveRoot ? "My Drive" : nameOf(folder);
}

function useFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const types = useMemo(
    () =>
      (params.get("type") ?? "")
        .split(",")
        .filter((value): value is TypeFilter =>
          (TYPE_FILTERS as readonly string[]).includes(value),
        ),
    [params],
  );
  const modifiedParam = params.get("modified");
  const modified = MODIFIED_FILTERS.some((filter) => filter.id === modifiedParam)
    ? (modifiedParam as ModifiedFilter)
    : undefined;
  const set = useCallback(
    (next: { types?: readonly TypeFilter[]; modified?: ModifiedFilter | undefined }) => {
      const search = new URLSearchParams(params.toString());
      const nextTypes = next.types ?? types;
      const nextModified = "modified" in next ? next.modified : modified;
      if (nextTypes.length > 0) search.set("type", nextTypes.join(","));
      else search.delete("type");
      if (nextModified) search.set("modified", nextModified);
      else search.delete("modified");
      const query = search.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router, types, modified],
  );
  return { types, modified, set };
}

function hasFiles(event: DragEvent): boolean {
  return [...event.dataTransfer.types].includes("Files");
}

function reconcileSelection(
  current: SelectionState,
  ids: readonly string[],
  previous: readonly string[],
): SelectionState {
  const selected = current.selected.filter((id) => ids.includes(id));
  const focus =
    current.focus && ids.includes(current.focus)
      ? current.focus
      : (ids[Math.min(Math.max(0, previous.indexOf(current.focus ?? "")), ids.length - 1)] ?? null);
  const anchor = current.anchor && ids.includes(current.anchor) ? current.anchor : null;
  return selected.length === current.selected.length &&
    focus === current.focus &&
    anchor === current.anchor
    ? current
    : { selected, focus, anchor };
}

/** Reconcile metadata without discarding fields hydrated outside preference listings. */
function reconcileItem(item: DriveItem, row: DriveItem): DriveItem {
  const merged = row.etag !== undefined && row.etag !== item.etag ? row : { ...item, ...row };
  return item.name === merged.name &&
    item.kind === merged.kind &&
    item.contentType === merged.contentType &&
    item.size === merged.size &&
    item.etag === merged.etag &&
    item.protectionRequired === merged.protectionRequired &&
    item.modified?.getTime() === merged.modified?.getTime()
    ? item
    : merged;
}

export function FileBrowser(props: FileBrowserProps) {
  const { title, items, error, onRetry, folder, columns, empty, fixedOrder, refreshing } = props;
  const { prefs, updatePrefs, uploads, driveRoot, session, client } = useDrive();
  const ui = useDriveUi();
  const actions = useDriveActions();
  const router = useRouter();
  const filters = useFilters();
  const [storedSelection, setSelection] = useState<SelectionState>(createSelection);
  const previousIds = useRef<readonly string[]>([]);
  const [menuFor, setMenuFor] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const view = prefs.view;
  const shared = columns.includes("opened");

  const visible = useMemo(
    () =>
      items
        ? viewItems(items, {
            types: filters.types,
            modified: filters.modified,
            sort: fixedOrder ? { key: "modified", dir: "desc" } : prefs.sort,
            foldersFirst: !fixedOrder,
          }).sort((a, b) =>
            shared ? (b.openedAt?.getTime() ?? 0) - (a.openedAt?.getTime() ?? 0) : 0,
          )
        : [],
    [items, filters.types, filters.modified, prefs.sort, fixedOrder, shared],
  );
  const ids = useMemo(() => visible.map((item) => item.url), [visible]);
  const selection = useMemo(
    () => reconcileSelection(storedSelection, ids, previousIds.current),
    [storedSelection, ids],
  );
  const selected = useMemo(
    () => visible.filter((item) => selection.selected.includes(item.url)),
    [visible, selection.selected],
  );

  // Clear the selection when the folder changes (04-drive §4.4).
  // biome-ignore lint/correctness/useExhaustiveDependencies: folder change is the event
  useEffect(() => setSelection(createSelection()), [folder]);
  useLayoutEffect(() => {
    setSelection(selection);
    previousIds.current = ids;
  }, [ids, selection]);
  const listingFocus = useDriveListingFocus(ids, container);

  const { setDetailsItems, setCurrentFolder, uploadRequest } = ui;
  // Details lives above route bodies. Release this listing's targets when its
  // route unmounts, including navigation to views without another FileBrowser.
  useLayoutEffect(() => () => setDetailsItems([]), [setDetailsItems]);
  const selectionRequest = useRef(0);
  const detailsSelection = useRef({ folder, request: selectionRequest.current });
  useEffect(() => {
    const previous = detailsSelection.current;
    detailsSelection.current = { folder, request: selectionRequest.current };
    // Only a user selection or navigation takes ownership from explicit Details.
    // Listing reconciliation below updates the existing targets independently.
    if (folder !== previous.folder || selectionRequest.current !== previous.request)
      setDetailsItems(selected);
  }, [folder, selected, setDetailsItems]);
  const previousItems = useRef<readonly BrowserItem[]>([]);
  useEffect(() => {
    if (!items || refreshing) return;
    const before = new Set(previousItems.current.map((item) => item.url));
    previousItems.current = items;
    const byUrl = new Map(items.map((item) => [item.url, item]));
    setDetailsItems((current) => {
      const next = current.flatMap((item) => {
        const row = byUrl.get(item.url);
        // Prune vanished listing targets; explicit targets outside this listing
        // (including a completed Move) retain their own live metadata stream.
        return row ? [reconcileItem(item, row)] : before.has(item.url) ? [] : [item];
      });
      return next.length === current.length && next.every((item, index) => item === current[index])
        ? current
        : next;
    });
  }, [items, refreshing, setDetailsItems]);
  const { preview, setPreview } = ui;
  useEffect(() => {
    if (!items || refreshing || !preview) return;
    // Keep hydrated fields when preference rows omit them, and preserve the
    // preview item itself when only a row's timestamp or object identity changed.
    const byUrl = new Map(items.map((item) => [item.url, item]));
    const next = preview.items.map((item) => {
      const row = byUrl.get(item.url);
      if (!row) return item;
      return reconcileItem(item, row);
    });
    if (next.some((item, index) => item !== preview.items[index]))
      setPreview({ ...preview, items: next });
  }, [items, refreshing, preview, setPreview]);
  useEffect(() => {
    setCurrentFolder(folder && isOwnStorage(folder, session.storageUrl) ? folder : undefined);
    return () => setCurrentFolder(undefined);
  }, [folder, setCurrentFolder, session.storageUrl]);
  const lastUpload = useRef(uploadRequest?.id ?? 0);
  useEffect(() => {
    if (
      !uploadRequest ||
      uploadRequest.id === lastUpload.current ||
      !folder ||
      !isOwnStorage(folder, session.storageUrl)
    )
      return;
    lastUpload.current = uploadRequest.id;
    (uploadRequest.folder ? folderInput : fileInput).current?.click();
  }, [uploadRequest, folder, session.storageUrl]);

  const dispatch = useCallback(
    (action: Parameters<typeof selectionReducer>[1]) => {
      selectionRequest.current += 1;
      setSelection((current) =>
        selectionReducer(reconcileSelection(current, ids, previousIds.current), action, ids),
      );
    },
    [ids],
  );

  const focusRow = useCallback((url: string) => {
    const row = container.current?.querySelector<HTMLElement>(`[data-url="${CSS.escape(url)}"]`);
    row?.focus();
  }, []);

  // Switching view with `v` replaces every row element, so focus moves to the same item
  // in the new view (or the listing) instead of falling back to the document body.
  const refocusAfterView = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the new view's rows render
  useEffect(() => {
    const url = refocusAfterView.current;
    if (url === null) return;
    refocusAfterView.current = null;
    const find = () =>
      url
        ? container.current?.querySelector<HTMLElement>(`[data-url="${CSS.escape(url)}"]`)
        : undefined;
    const row = find();
    // A virtualised grid may only render the item after it has measured itself.
    if (row) row.focus();
    else requestAnimationFrame(() => (find() ?? container.current)?.focus());
  }, [view]);

  const writable = (targets: readonly DriveItem[]) =>
    targets.every((item) => isOwnStorage(item.url, session.storageUrl));
  const writableFolder = folder && isOwnStorage(folder, session.storageUrl) ? folder : undefined;

  const targetsFor = useCallback(
    (item: BrowserItem) => (selection.selected.includes(item.url) ? selected : [item]),
    [selection.selected, selected],
  );

  // Menu content is portalled but React events still bubble through the row:
  // only clicks inside the row's own DOM select or open it.
  const fromRow = (event: React.MouseEvent) => event.currentTarget.contains(event.target as Node);

  const onItemClick = (event: React.MouseEvent, item: BrowserItem) => {
    if (!fromRow(event)) return;
    if (event.shiftKey)
      dispatch({ type: "range", id: item.url, additive: event.metaKey || event.ctrlKey });
    else if (event.metaKey || event.ctrlKey) dispatch({ type: "toggle", id: item.url });
    else if (window.matchMedia("(max-width: 767px)").matches && selection.selected.length === 0)
      actions.open(item, visible, ui.setPreview);
    else dispatch({ type: "click", id: item.url });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // The roving item (or the listing itself, once its last item is gone) owns listing
    // shortcuts; descendants such as menus and inputs keep their native keys.
    if (event.defaultPrevented || (target !== event.currentTarget && !target.matches("[data-url]")))
      return;
    const focusUrl = target.dataset.url;
    const focused = visible.find((item) => item.url === focusUrl);
    const index = focused ? visible.indexOf(focused) : -1;
    const mod = event.metaKey || event.ctrlKey;
    const step = (delta: number) => {
      const next = visible[Math.min(visible.length - 1, Math.max(0, index + delta))];
      if (!next) return;
      event.preventDefault();
      dispatch({ type: "keyboard", id: next.url, extend: event.shiftKey });
      if (!event.shiftKey) dispatch({ type: "click", id: next.url });
      focusRow(next.url);
    };
    // Use the rendered track count: breakpoints change the grid template.
    const grid = container.current?.querySelector<HTMLElement>(".drv-grid");
    const tracks = grid
      ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length
      : 0;
    const columnsPerRow =
      view === "grid"
        ? Math.max(1, tracks || Math.round((container.current?.clientWidth ?? 800) / 200))
        : 1;
    const targets = focused ? targetsFor(focused) : selected;
    switch (true) {
      case event.key === "ArrowDown":
        return step(view === "grid" ? columnsPerRow : 1);
      case event.key === "ArrowUp" && !event.altKey:
        return step(view === "grid" ? -columnsPerRow : -1);
      case event.key === "ArrowRight" && view === "grid":
        return step(1);
      case event.key === "ArrowLeft" && view === "grid":
        return step(-1);
      case event.key === "Home":
        return step(-visible.length);
      case event.key === "End":
        return step(visible.length);
      case event.key === "v" && !mod && !event.altKey:
        event.preventDefault();
        refocusAfterView.current = focusUrl ?? "";
        return updatePrefs((current) => ({
          ...current,
          view: current.view === "list" ? "grid" : "list",
        }));
      case mod && event.key.toLowerCase() === "a":
        event.preventDefault();
        return dispatch({ type: "select-all" });
      case event.key === "Escape" && selection.selected.length > 0:
        event.preventDefault();
        return dispatch({ type: "clear" });
      case event.key === " " && Boolean(focused):
        event.preventDefault();
        return dispatch({ type: "toggle", id: focused?.url as string });
      case (event.key === "Enter" && !event.altKey) || (event.key === "o" && !mod):
        if (focused) {
          event.preventDefault();
          actions.open(focused, visible, ui.setPreview);
        }
        return;
      case (event.key === "Enter" && event.altKey) ||
        ((event.key === "d" || event.key === "]") && !mod && !event.altKey):
        event.preventDefault();
        event.stopPropagation();
        ui.setDetailsItems(targets);
        return ui.setDetailsOpen((open) => !open);
      case (event.key === "F2" || (event.key === "n" && !mod)) &&
        targets.length === 1 &&
        writable(targets):
        event.preventDefault();
        return ui.openDialog({ kind: "rename", item: targets[0] as DriveItem });
      case event.key === "m" && !mod && targets.length > 0 && writable(targets):
        event.preventDefault();
        return ui.openDialog({ kind: "move", items: [...targets] });
      case event.key === "s" && !mod && targets.length > 0:
        event.preventDefault();
        return actions.toggleStar(targets);
      case mod && event.shiftKey && event.key.toLowerCase() === "c" && targets.length === 1:
        event.preventDefault();
        return void actions.copyLink(targets[0] as DriveItem);
      case (event.key === "Delete" || event.key === "Backspace") && selected.length > 0:
        event.preventDefault();
        return void actions.trash(selected);
      case (event.key === "Backspace" || (event.key === "ArrowUp" && event.altKey)) &&
        Boolean(folder) &&
        folder !== driveRoot: {
        event.preventDefault();
        const parent = folder ? parentOf(folder) : undefined;
        if (parent)
          router.push(parent === driveRoot ? "/drive/my" : `/drive/f/${encodeRef(parent)}`);
        return;
      }
    }
  };

  const onDragStart = (event: DragEvent, item: BrowserItem) => {
    const targets = targetsFor(item);
    if (!writable(targets)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(DRIVE_ITEMS_TYPE, captureDragItems(client, targets));
    event.dataTransfer.effectAllowed = "move";
  };

  const dropUpload = (target: string, data: DataTransfer) =>
    void readDrop(data).then(
      (files) => uploads.enqueue(target, files),
      () => toast.error("Couldn't read the dropped folder"),
    );

  const folderDropProps = (item: BrowserItem) =>
    item.kind === "folder" && isOwnStorage(item.url, session.storageUrl)
      ? {
          onDragOver: (event: DragEvent) => {
            const types = [...event.dataTransfer.types];
            if (!types.includes(DRIVE_ITEMS_TYPE) && !types.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            setDropTarget(item.url);
          },
          onDragLeave: () =>
            setDropTarget((current) => (current === item.url ? undefined : current)),
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            setDropTarget(undefined);
            setDropping(false);
            if (hasFiles(event)) dropUpload(item.url, event.dataTransfer);
            else {
              const moving = takeDragItems(
                client,
                event.dataTransfer.getData(DRIVE_ITEMS_TYPE),
              ).filter((entry) => entry.url !== item.url);
              if (moving.length > 0) void actions.move(moving, item.url);
            }
          },
        }
      : {};

  const contentDropProps = writableFolder
    ? {
        onDragOver: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setDropping(true);
        },
        onDragLeave: (event: DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
        },
        onDrop: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setDropping(false);
          dropUpload(writableFolder, event.dataTransfer);
        },
      }
    : {};

  const filtered = filters.types.length > 0 || filters.modified !== undefined;
  const sortLabel = { name: "Name", modified: "Modified", size: "Size" }[prefs.sort.key];
  const clearFilters = () => {
    filters.set({ types: [], modified: undefined });
    focusDriveListing(undefined, undefined, container.current);
  };

  const toolbar =
    selected.length > 0 ? (
      <SelectionBar
        selected={selected}
        visible={visible}
        onClear={() => {
          dispatch({ type: "clear" });
          focusDriveListing(selection.focus ?? selected[0]?.url, undefined, container.current);
        }}
        onFocusCapture={(event) =>
          listingFocus.onFocusCapture(
            event,
            selected.find((item) => item.url === selection.focus)?.url ?? selected[0]?.url,
          )
        }
        onBlurCapture={listingFocus.onBlurCapture}
      />
    ) : (
      <div className="drv-toolbar" role="toolbar" aria-label="Folder actions">
        {writableFolder ? (
          <>
            <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden="true" size={16} /> Upload
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => ui.openDialog({ kind: "new-folder", parent: writableFolder })}
            >
              <FolderPlus aria-hidden="true" size={16} /> New folder
            </Button>
          </>
        ) : null}
        {/* biome-ignore lint/a11y/useSemanticElements: a chip row, not a form fieldset */}
        <div className="drv-chips" role="group" aria-label="Filters">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="drv-chip"
                data-active={filters.types.length > 0 || undefined}
              >
                {filters.types.length === 0
                  ? "Type"
                  : filters.types.map((type) => TYPE_FILTER_LABELS[type]).join(", ")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {TYPE_FILTERS.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={filters.types.includes(type)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    filters.set({
                      types: checked
                        ? [...filters.types, type]
                        : filters.types.filter((t) => t !== type),
                    })
                  }
                >
                  {TYPE_FILTER_LABELS[type]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {props.showModifiedFilter !== false ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="drv-chip"
                  data-active={filters.modified ? true : undefined}
                >
                  {MODIFIED_FILTERS.find((f) => f.id === filters.modified)?.label ?? "Modified"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={filters.modified ?? ""}
                  onValueChange={(value) =>
                    filters.set({ modified: (value || undefined) as ModifiedFilter | undefined })
                  }
                >
                  <DropdownMenuRadioItem value="">Any time</DropdownMenuRadioItem>
                  {MODIFIED_FILTERS.map((filter) => (
                    <DropdownMenuRadioItem key={filter.id} value={filter.id}>
                      {filter.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {filtered ? (
            <button type="button" className="drv-chip drv-chip-clear" onClick={clearFilters}>
              <X aria-hidden="true" size={14} /> Clear filters
            </button>
          ) : null}
        </div>
        <div className="drv-toolbar-end">
          {!fixedOrder ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label={`Sort by ${sortLabel}`}>
                  <ArrowDownUp aria-hidden="true" size={16} />
                  <span className="drv-hide-sm">{sortLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={prefs.sort.key}
                  onValueChange={(key) =>
                    updatePrefs((current) => ({
                      ...current,
                      sort: { ...current.sort, key: key as typeof current.sort.key },
                    }))
                  }
                >
                  <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="modified">Modified</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={prefs.sort.dir}
                  onValueChange={(dir) =>
                    updatePrefs((current) => ({
                      ...current,
                      sort: { ...current.sort, dir: dir as typeof current.sort.dir },
                    }))
                  }
                >
                  <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <IconButton
            label={view === "list" ? "Grid view" : "List view"}
            variant="ghost"
            onClick={() =>
              updatePrefs((current) => ({
                ...current,
                view: current.view === "list" ? "grid" : "list",
              }))
            }
          >
            {view === "list" ? (
              <LayoutGrid aria-hidden="true" size={18} />
            ) : (
              <List aria-hidden="true" size={18} />
            )}
          </IconButton>
        </div>
      </div>
    );

  let body: ReactNode;
  if (error && !items) {
    body = (
      <div className="drv-state" role="alert">
        <h2>Can't open this folder</h2>
        <p>{errorMessage(error, "The storage didn't respond")}</p>
        {onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" size={16} /> Retry
          </Button>
        ) : null}
      </div>
    );
  } else if (!items) {
    body = <LoadingList view={view} />;
  } else if (visible.length === 0) {
    body = filtered ? (
      <div className="drv-state">
        <h2>No items match these filters</h2>
        <Button variant="outline" onClick={clearFilters}>
          Clear filters
        </Button>
      </div>
    ) : (
      <div className="drv-state">
        <div className="drv-state-icon" aria-hidden="true">
          {empty.icon}
        </div>
        <h2>{empty.title}</h2>
        {empty.body ? <p>{empty.body}</p> : null}
        {empty.actions ? <div className="drv-state-actions">{empty.actions}</div> : null}
      </div>
    );
  } else if (view === "grid") {
    body = (
      <ul className="drv-grid" aria-label={title}>
        {visible.map((item) => (
          <ItemShell
            key={item.url}
            item={item}
            targets={targetsFor(item)}
            visible={visible}
            menuOpen={menuFor === item.url}
            onMenuOpenChange={(open) => setMenuFor(open ? item.url : undefined)}
          >
            {(menuButton) => (
              <li
                className="drv-card"
                data-drive-row={item.url}
                data-selected={selection.selected.includes(item.url) || undefined}
                data-drop={dropTarget === item.url || undefined}
                {...folderDropProps(item)}
              >
                <button
                  type="button"
                  className="drv-card-main"
                  data-url={item.url}
                  aria-pressed={selection.selected.includes(item.url)}
                  tabIndex={
                    selection.focus === item.url || (!selection.focus && item === visible[0])
                      ? 0
                      : -1
                  }
                  draggable={Boolean(folder)}
                  onDragStart={(event) => onDragStart(event, item)}
                  onDragEnd={() => clearDragItems(client)}
                  onClick={(event) => onItemClick(event, item)}
                  onDoubleClick={(event) =>
                    fromRow(event) && actions.open(item, visible, ui.setPreview)
                  }
                >
                  <span className="drv-card-thumb">
                    <ItemIcon item={item} size={48} />
                  </span>
                  <span className="drv-card-name">
                    {item.name}
                    {actions.starred.has(item.url) ? (
                      <Star aria-label="Starred" className="drv-star-mark" size={14} />
                    ) : null}
                  </span>
                  <span className="drv-card-meta">
                    {item.kind === "folder"
                      ? "Folder"
                      : `Modified ${formatModified(item.modified)}`}
                  </span>
                </button>
                {menuButton}
              </li>
            )}
          </ItemShell>
        ))}
      </ul>
    );
  } else {
    body = (
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA grid pattern for a selectable listing
      <table className="drv-table" role="grid" aria-label={title} aria-multiselectable="true">
        <thead>
          <tr>
            <th scope="col">Name</th>
            {columns.includes("location") ? (
              <th scope="col" className="drv-col-location">
                Location
              </th>
            ) : null}
            {columns.includes("owner") ? (
              <th scope="col" className="drv-col-owner">
                Owner
              </th>
            ) : null}
            {columns.includes("shared-by") ? <th scope="col">Shared by</th> : null}
            {columns.includes("opened") ? <th scope="col">Opened</th> : null}
            {columns.includes("host") ? <th scope="col">Location</th> : null}
            {columns.includes("modified") ? (
              <th scope="col" className="drv-col-modified">
                Modified
              </th>
            ) : null}
            {columns.includes("size") ? (
              <th scope="col" className="drv-col-size">
                Size
              </th>
            ) : null}
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => {
            const isSelected = selection.selected.includes(item.url);
            const isActive =
              selection.focus === item.url || (!selection.focus && item === visible[0]);
            const starred = actions.starred.has(item.url);
            return (
              <ItemShell
                key={item.url}
                item={item}
                targets={targetsFor(item)}
                visible={visible}
                menuOpen={menuFor === item.url}
                onMenuOpenChange={(open) => setMenuFor(open ? item.url : undefined)}
              >
                {(menuButton) => (
                  <tr
                    data-url={item.url}
                    aria-selected={isSelected}
                    data-drop={dropTarget === item.url || undefined}
                    tabIndex={isActive ? 0 : -1}
                    draggable={Boolean(folder)}
                    onDragStart={(event) => onDragStart(event, item)}
                    onDragEnd={() => clearDragItems(client)}
                    onClick={(event) => onItemClick(event, item)}
                    onDoubleClick={(event) =>
                      fromRow(event) && actions.open(item, visible, ui.setPreview)
                    }
                    {...folderDropProps(item)}
                  >
                    <td>
                      <div className="drv-cell-name">
                        <ItemIcon item={item} size={24} />
                        <span className="drv-name-text">
                          <span className="drv-name">{item.name}</span>
                          <span className="drv-name-meta">
                            {item.kind === "folder"
                              ? formatModified(item.modified)
                              : `${formatModified(item.modified)} · ${formatSize(item)}`}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="drv-star"
                          data-on={starred || undefined}
                          aria-label={
                            starred ? `Remove star from ${item.name}` : `Star ${item.name}`
                          }
                          aria-pressed={starred}
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            actions.toggleStar([item]);
                          }}
                        >
                          <Star aria-hidden="true" size={16} />
                        </button>
                      </div>
                    </td>
                    {columns.includes("location") ? (
                      <td className="drv-col-location">
                        {item.folder ? (
                          <Link
                            href={
                              item.folder === driveRoot
                                ? "/drive/my"
                                : `/drive/f/${encodeRef(item.folder)}`
                            }
                            onClick={(event) => event.stopPropagation()}
                            // The active row's location is the next Tab stop.
                            tabIndex={isActive ? 0 : -1}
                          >
                            {locationLabel(item.folder, driveRoot)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                    {columns.includes("owner") ? (
                      <td className="drv-col-owner">
                        <OwnerLabel url={item.url} />
                      </td>
                    ) : null}
                    {columns.includes("shared-by") ? (
                      <td>
                        <OwnerLabel url={item.url} fallback={new URL(item.url).host} />
                      </td>
                    ) : null}
                    {columns.includes("opened") ? <td>{formatModified(item.openedAt)}</td> : null}
                    {columns.includes("host") ? <td>{new URL(item.url).host}</td> : null}
                    {columns.includes("modified") ? (
                      <td className="drv-col-modified">{formatModified(item.modified)}</td>
                    ) : null}
                    {columns.includes("size") ? (
                      <td className="drv-col-size">{formatSize(item)}</td>
                    ) : null}
                    <td className="drv-cell-menu">{menuButton}</td>
                  </tr>
                )}
              </ItemShell>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div className="drv-page">
      <div className="drv-heading">
        <h1>{title}</h1>
        {refreshing ? (
          <span className="drv-refreshing" role="status" aria-label="Refreshing" />
        ) : null}
      </div>
      {props.banner}
      {items
        ?.filter((item) => item.protectionRequired)
        .map((item) => (
          <ProtectionBanner key={item.url} item={item} />
        ))}
      {toolbar}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard model for the listing lives on its wrapper */}
      <div
        ref={container}
        className="drv-content"
        data-drive-listing
        tabIndex={-1}
        onFocusCapture={(event) => {
          listingFocus.onFocusCapture(event);
          const row = (event.target as HTMLElement).closest<HTMLElement>("[data-url]");
          const url = row?.dataset.url;
          if (url)
            setSelection((current) =>
              current.focus === url ? current : { ...current, focus: url },
            );
        }}
        onBlurCapture={listingFocus.onBlurCapture}
        onKeyDown={onKeyDown}
        {...contentDropProps}
      >
        {error && items ? (
          <div role="alert" className="drv-banner">
            <p>Some items couldn't be read.</p>
            {onRetry ? (
              <Button variant="outline" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        {body}
        {dropping && folder ? (
          <div className="drv-drop-overlay" aria-hidden="true">
            Drop to upload to {locationLabel(folder, driveRoot)}
          </div>
        ) : null}
      </div>
      {props.footer}
      {writableFolder ? (
        <>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            data-testid="drive-upload-input"
            onChange={(event) => {
              if (event.target.files) uploads.enqueue(writableFolder, event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            data-testid="drive-folder-upload-input"
            {...({ webkitdirectory: "" } as Record<string, string>)}
            onChange={(event) => {
              if (event.target.files) uploads.enqueue(writableFolder, event.target.files);
              event.target.value = "";
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/** Wraps a row/card with its context menu and supplies the `…` menu button. */
function ItemShell({
  item,
  targets,
  visible,
  menuOpen,
  onMenuOpenChange,
  children,
}: {
  item: BrowserItem;
  targets: readonly DriveItem[];
  visible: readonly DriveItem[];
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  children: (menuButton: ReactNode) => ReactNode;
}) {
  const actions = useDriveActions();
  const entries = useItemMenu(actions, targets, visible);
  const menuButton = (
    <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="drv-more"
          aria-label={`More actions for ${item.name}`}
          tabIndex={-1}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <MoreVertical aria-hidden="true" size={18} />
        </button>
      </DropdownMenuTrigger>
      <DropdownEntries entries={entries} />
    </DropdownMenu>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children(menuButton)}</ContextMenuTrigger>
      <ContextEntries entries={entries} />
    </ContextMenu>
  );
}

function SelectionBar({
  selected,
  visible,
  onClear,
  onFocusCapture,
  onBlurCapture,
}: {
  selected: readonly DriveItem[];
  visible: readonly DriveItem[];
  onClear: () => void;
  onFocusCapture: React.FocusEventHandler<HTMLDivElement>;
  onBlurCapture: React.FocusEventHandler<HTMLDivElement>;
}) {
  const actions = useDriveActions();
  const entries = useItemMenu(actions, selected, visible).filter(
    (entry) => entry === "separator" || entry.id !== "open",
  );
  const primary = entries.filter(
    (entry) => entry !== "separator" && ["download", "move", "star", "trash"].includes(entry.id),
  );
  return (
    <div
      className="drv-toolbar drv-selectionbar"
      role="toolbar"
      aria-label="Selection actions"
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      <IconButton label="Clear selection" variant="ghost" onClick={onClear}>
        <X aria-hidden="true" size={18} />
      </IconButton>
      <span className="drv-selection-count" aria-live="polite">
        {selected.length} selected
      </span>
      <div className="drv-toolbar-end">
        {primary.map((entry) =>
          entry === "separator" ? null : (
            <IconButton
              key={entry.id}
              label={entry.label}
              variant="ghost"
              disabled={entry.disabled ?? false}
              onClick={entry.onSelect}
            >
              <entry.icon aria-hidden="true" size={18} />
            </IconButton>
          ),
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More actions" variant="ghost">
              <MoreVertical aria-hidden="true" size={18} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownEntries entries={entries} />
        </DropdownMenu>
      </div>
    </div>
  );
}

function LoadingList({ view }: { view: "list" | "grid" }) {
  return (
    <div
      className={view === "grid" ? "drv-grid drv-loading" : "drv-loading"}
      role="status"
      aria-label="Loading"
    >
      {PLACEHOLDERS.slice(0, view === "grid" ? 8 : 10).map((key) => (
        <Skeleton
          key={key}
          className={view === "grid" ? "drv-skeleton-card" : "drv-skeleton-row"}
        />
      ))}
    </div>
  );
}
