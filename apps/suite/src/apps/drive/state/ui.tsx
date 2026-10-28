// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/**
 * Drive's UI state shared across routes: the open dialog, the preview, the
 * details pane, and the item actions (04-drive §4) with their toasts and
 * undo. Every mutation goes through the operations layer; listings refresh
 * through the demo pod's change events (or an explicit invalidate).
 */

import { toast } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { encodeRef } from "@/lib/refs";
import { accessControl, accessLabel, DriveAccessError } from "../lib/client/access";
import { DriveError, type DriveItem, nameOf } from "../lib/client/client";
import { isOwnStorage } from "../lib/client/ownership";
import {
  copyItem,
  createFolder,
  deleteForever,
  moveItems,
  renameItem,
  restoreItems,
  TrashMovingError,
  TrashRestorePartialError,
  trashItems,
} from "../lib/operations/operations";
import type { TrashEntry } from "../lib/operations/trash-index";
import { useDrive } from "./drive-context";
import { moveWithValidator } from "./undo";

export type DriveDialog =
  | { kind: "new-folder"; parent: string }
  | { kind: "rename"; item: DriveItem }
  | { kind: "move"; items: DriveItem[] }
  | { kind: "delete-source"; items: DriveItem[] }
  | {
      kind: "delete-forever" | "empty-trash";
      entries: TrashEntry[];
      onRemoved?: (urls: readonly string[]) => void;
    };

export interface PreviewState {
  readonly items: readonly DriveItem[];
  readonly index: number;
}

interface DriveUiValue {
  readonly dialog: (DriveDialog & { readonly id: number }) | undefined;
  readonly openDialog: (dialog: DriveDialog) => void;
  readonly closeDialog: () => void;
  readonly restoreDialogFocus: (event: Event) => void;
  readonly preview: PreviewState | undefined;
  readonly setPreview: (preview: PreviewState | undefined) => void;
  readonly detailsOpen: boolean;
  readonly setDetailsOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  /** The items the details pane describes (the current selection). */
  readonly detailsItems: readonly DriveItem[];
  readonly setDetailsItems: (items: readonly DriveItem[]) => void;
  /** Ask the current folder view to open the file picker (`folder` = directory picker). */
  readonly requestUpload: (folder?: boolean) => void;
  readonly uploadRequest: { id: number; folder: boolean } | undefined;
  /** The folder new items go into from the New menu. */
  readonly currentFolder: string | undefined;
  readonly setCurrentFolder: (url: string | undefined) => void;
}

const DriveUiContext = createContext<DriveUiValue | undefined>(undefined);

/** Return focus to an item, listing, preview or main region after a control is removed. */
export function focusDriveListing(
  url?: string,
  preferred?: HTMLElement | null,
  listing = document.querySelector<HTMLElement>("[data-drive-listing]"),
  scope: ParentNode = document,
) {
  const row = url ? listing?.querySelector<HTMLElement>(`[data-url="${CSS.escape(url)}"]`) : null;
  for (const target of [
    preferred,
    row,
    listing,
    scope.querySelector<HTMLElement>("[data-drive-preview]"),
    scope.querySelector<HTMLElement>('main, [role="main"]'),
  ]) {
    if (!target?.isConnected || target === document.body) continue;
    target.focus();
    // A connected element may have become disabled or hidden during the mutation.
    if (document.activeElement === target) return;
  }
}

/** Capture focus before removal; preserve any surviving control the user moves to. */
export function captureDriveFocusRemoval(subtree?: Element | null) {
  const focused = document.activeElement;
  const inside = subtree?.contains(focused);
  return (url?: string, preferred?: HTMLElement | null, listing?: HTMLElement | null) => {
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active.isConnected &&
      !active.matches(":disabled") &&
      !(inside && active === focused)
    )
      return;
    focusDriveListing(url, preferred, listing);
  };
}

export function DriveUiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DriveUiValue["dialog"]>();
  const [preview, setPreview] = useState<PreviewState>();
  const [detailsOpen, setDetailsOpenState] = useState(false);
  const [detailsItems, setDetailsItems] = useState<readonly DriveItem[]>([]);
  const detailsFocus = useRef<HTMLElement | null>(null);
  const detailsVisible = useRef(false);
  const restoreDetailsFocus = useRef<ReturnType<typeof captureDriveFocusRemoval> | undefined>(
    undefined,
  );
  const setDetailsOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    const open = typeof next === "function" ? next(detailsVisible.current) : next;
    if (open === detailsVisible.current) return;
    if (open) {
      detailsFocus.current =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
    } else {
      restoreDetailsFocus.current = captureDriveFocusRemoval(
        document.querySelector(".ish-details, .ish-details-sheet"),
      );
    }
    detailsVisible.current = open;
    setDetailsOpenState(open);
  }, []);
  useLayoutEffect(() => {
    if (detailsOpen || !restoreDetailsFocus.current) return;
    const restore = restoreDetailsFocus.current;
    restoreDetailsFocus.current = undefined;
    const listing = document.querySelector<HTMLElement>("[data-drive-listing]");
    const row =
      listing?.querySelector<HTMLElement>('[data-url][tabindex="0"]') ??
      (detailsItems[0]
        ? listing?.querySelector<HTMLElement>(`[data-url="${CSS.escape(detailsItems[0].url)}"]`)
        : null);
    restore(detailsItems[0]?.url, row ?? detailsFocus.current, listing);
  }, [detailsOpen, detailsItems]);
  const [uploadRequest, setUploadRequest] = useState<{ id: number; folder: boolean }>();
  const [currentFolder, setCurrentFolder] = useState<string>();
  const dialogFocus = useRef<
    | {
        element: HTMLElement | null;
        url: string | undefined;
        restore: ReturnType<typeof captureDriveFocusRemoval>;
      }
    | undefined
  >(undefined);
  const dialogOpen = useRef<number | undefined>(undefined);
  const nextDialog = useRef(0);
  const openDialog = useCallback((next: DriveDialog) => {
    const item =
      next.kind === "rename" ? next.item : next.kind === "move" ? next.items[0] : undefined;
    const url = item?.url ?? ("entries" in next ? next.entries[0]?.url : undefined);
    dialogFocus.current = {
      element:
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null,
      url,
      restore: captureDriveFocusRemoval(),
    };
    const id = ++nextDialog.current;
    dialogOpen.current = id;
    setDialog({ ...next, id });
  }, []);
  const closeDialog = useCallback(() => {
    // Async submissions retain the close callback of their own opening.
    if (dialogOpen.current !== dialog?.id) return;
    dialogOpen.current = undefined;
    setDialog(undefined);
  }, [dialog?.id]);
  const restoreDialogFocus = useCallback((event: Event) => {
    event.preventDefault();
    // Name -> extension confirmation replaces one dialog with another.
    if (dialogOpen.current !== undefined) return;
    const saved = dialogFocus.current;
    saved?.restore(saved.url, saved.element);
  }, []);
  const value = useMemo<DriveUiValue>(
    () => ({
      dialog,
      openDialog,
      closeDialog,
      restoreDialogFocus,
      preview,
      setPreview,
      detailsOpen,
      setDetailsOpen,
      detailsItems,
      setDetailsItems,
      uploadRequest,
      requestUpload: (folder = false) =>
        setUploadRequest((current) => ({ id: (current?.id ?? 0) + 1, folder })),
      currentFolder,
      setCurrentFolder,
    }),
    [
      dialog,
      preview,
      detailsOpen,
      detailsItems,
      uploadRequest,
      currentFolder,
      openDialog,
      closeDialog,
      restoreDialogFocus,
      setDetailsOpen,
    ],
  );
  return <DriveUiContext value={value}>{children}</DriveUiContext>;
}

export function useDriveUi(): DriveUiValue {
  const value = useContext(DriveUiContext);
  if (!value) throw new Error("useDriveUi outside DriveUiProvider");
  return value;
}

/** User-facing message for a failed operation. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (
    error instanceof DriveAccessError ||
    error instanceof TrashMovingError ||
    error instanceof TrashRestorePartialError
  )
    return error.message;
  if (error instanceof DriveError) {
    switch (error.kind) {
      case "conflict":
        return "An item with that name already exists";
      case "forbidden":
        return "You don't have permission to do that";
      case "not-found":
        return "That item no longer exists";
      case "unauthenticated":
        return "Sign in again to continue";
      default:
        return fallback;
    }
  }
  return fallback;
}

/** The Drive URL that opens `item`: folders navigate, files preview. */
export function hrefFor(item: Pick<DriveItem, "url" | "kind">): string {
  return item.kind === "folder"
    ? `/drive/f/${encodeRef(item.url)}`
    : `/drive/p/${encodeRef(item.url)}`;
}

/** Follow stars to an item's new URL, including the descendants of a moved folder. */
export function repointStarred(
  starred: readonly string[],
  moves: readonly { from: string; to: string }[],
): string[] {
  const repointed = starred.map((entry) => {
    for (const { from, to } of moves) {
      if (entry === from) return to;
      if (from.endsWith("/") && to.endsWith("/") && entry.startsWith(from))
        return to + entry.slice(from.length);
    }
    return entry;
  });
  // A stale star (for example on a trashed item) may already name the destination.
  return [...new Set(repointed)];
}

function folderLabel(url: string, driveRoot: string | undefined): string {
  return url === driveRoot ? "My Drive" : nameOf(url);
}

export function useDriveActions() {
  const { openDialog } = useDriveUi();
  const { client, driveRoot, session, updatePrefs, prefs, invalidate } = useDrive();
  const router = useRouter();

  const starred = useMemo(() => new Set(prefs.starred), [prefs.starred]);

  const open = useCallback(
    (item: DriveItem, siblings?: readonly DriveItem[], setPreview?: DriveUiValue["setPreview"]) => {
      if (item.kind === "folder") {
        router.push(hrefFor(item));
        return;
      }
      if (setPreview) {
        const files = (siblings ?? [item]).filter((entry) => entry.kind === "file");
        setPreview({
          items: files,
          index: Math.max(
            0,
            files.findIndex((f) => f.url === item.url),
          ),
        });
      } else router.push(hrefFor(item));
    },
    [router],
  );

  const download = useCallback(
    async (item: DriveItem) => {
      try {
        const blob = await client.read(item.url);
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = item.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      } catch (error) {
        toast.error(errorMessage(error, "Download failed"));
      }
    },
    [client],
  );

  const copyLink = useCallback(
    async (item: DriveItem) => {
      const link = `${location.origin}${hrefFor(item)}`;
      try {
        await navigator.clipboard.writeText(link);
        const access = await accessControl(session.fetch, session.storageUrl).effective(item.url);
        toast("Link copied", { description: accessLabel(access, item.url, session.webId) });
      } catch {
        toast.error("Couldn't copy the link");
      }
    },
    [session],
  );

  const toggleStar = useCallback(
    (items: readonly DriveItem[]) => {
      const allStarred = items.every((item) => starred.has(item.url));
      updatePrefs((current) => {
        const next = new Set(current.starred);
        for (const item of items) {
          if (allStarred) next.delete(item.url);
          else next.add(item.url);
        }
        return { ...current, starred: [...next] };
      });
      const [first] = items;
      if (allStarred) toast("Removed star");
      else
        toast(
          items.length === 1 && first ? `Starred ${first.name}` : `Starred ${items.length} items`,
        );
    },
    [starred, updatePrefs],
  );

  const move = useCallback(
    async (items: readonly DriveItem[], target: string, { undoable = true } = {}) => {
      if (
        !isOwnStorage(target, session.storageUrl) ||
        items.some((item) => !isOwnStorage(item.url, session.storageUrl))
      )
        return;
      const pending = toast.loading(
        items.length === 1 ? `Moving ${items[0]?.name}…` : `Moving ${items.length} items…`,
      );
      const result = await moveItems(
        client,
        items.map((item) => item.url),
        target,
      );
      toast.dismiss(pending);
      for (const { from, to } of result.done) {
        invalidate(from);
        invalidate(to);
      }
      // A star follows the item; leaving it on the old URL would star a replacement.
      updatePrefs((current) => ({
        ...current,
        starred: repointStarred(current.starred, result.done),
      }));
      if (result.failed.length > 0) {
        toast.error(
          result.done.length === 0
            ? errorMessage(result.failed[0]?.error, "Couldn't move")
            : `Moved ${result.done.length} of ${items.length} items`,
        );
      }
      if (result.done.length === 0) return result;
      // An unreadable/absent validator makes Undo fail closed for that item.
      const undo = result.done;
      const canUndo =
        undoable &&
        undo.every(
          ({ identity }) =>
            identity.etag &&
            !identity.etag.startsWith("W/") &&
            (!identity.url.endsWith("/") || identity.tree !== undefined),
        );
      const label = folderLabel(target, driveRoot);
      const first = result.done[0];
      const message =
        result.done.length === 1 && first
          ? `Moved ${nameOf(first.from)} to ${label}`
          : `Moved ${result.done.length} items to ${label}`;
      toast.success(message, {
        ...(canUndo
          ? {
              action: {
                label: "Undo",
                onClick: async () => {
                  const failed: string[] = [];
                  let accessError: DriveAccessError | undefined;
                  const restored: { from: string; to: string }[] = [];
                  for (const { from, to, identity } of undo) {
                    try {
                      if (!identity?.etag) throw new Error("No validator for Undo");
                      await moveWithValidator(
                        {
                          storageUrl: session.storageUrl,
                          fetch: session.fetch,
                          ...(client.confirmAccess ? { confirmAccess: client.confirmAccess } : {}),
                        },
                        to,
                        from,
                        identity.etag,
                        ...(identity.tree ? ([identity.tree] as const) : ([] as const)),
                      );
                      invalidate(to);
                      invalidate(from);
                      restored.push({ from: to, to: from });
                    } catch (error) {
                      if (error instanceof DriveAccessError) accessError = error;
                      failed.push(nameOf(from));
                    }
                  }
                  if (restored.length > 0)
                    updatePrefs((current) => ({
                      ...current,
                      starred: repointStarred(current.starred, restored),
                    }));
                  if (failed.length > 0)
                    toast.error(
                      accessError
                        ? accessError.message
                        : `This move cannot be safely undone: ${failed.join(", ")}`,
                    );
                },
              },
            }
          : {}),
      });
      return result;
    },
    [client, driveRoot, invalidate, session, updatePrefs],
  );

  const rename = useCallback(
    async (item: DriveItem, name: string) => {
      if (!isOwnStorage(item.url, session.storageUrl)) return;
      try {
        const url = await renameItem(client, item, name);
        invalidate(item.url);
        if (url !== item.url) {
          invalidate(url);
          updatePrefs((current) => ({
            ...current,
            starred: repointStarred(current.starred, [{ from: item.url, to: url }]),
          }));
          toast.success(`Renamed to ${nameOf(url)}`);
        }
        return url;
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't rename"));
        return undefined;
      }
    },
    [client, invalidate, updatePrefs, session.storageUrl],
  );

  const makeCopy = useCallback(
    async (item: DriveItem) => {
      if (!isOwnStorage(item.url, session.storageUrl)) return;
      try {
        const url = await copyItem(client, item.url);
        invalidate(url);
        toast.success(`Created ${nameOf(url)}`);
        return url;
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't make a copy"));
        return undefined;
      }
    },
    [client, invalidate, session.storageUrl],
  );

  const newFolder = useCallback(
    async (parent: string, name: string) => {
      if (!isOwnStorage(parent, session.storageUrl)) return;
      try {
        const url = await createFolder(client, parent, name);
        invalidate(url);
        toast.success(`Created ${nameOf(url)}`);
        return url;
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't create the folder"));
        return undefined;
      }
    },
    [client, invalidate, session.storageUrl],
  );

  const restore = useCallback(
    async (entries: readonly TrashEntry[]) => {
      if (!driveRoot) return;
      const result = await restoreItems(client, driveRoot, entries);
      for (const warning of result.warnings ?? []) toast.error(warning.message);
      for (const { entry, url } of result.done) {
        invalidate(entry.url);
        invalidate(url);
      }
      for (const { url } of result.failed) {
        invalidate(url);
        const entry = entries.find((entry) => entry.url === url);
        if (entry) invalidate(entry.original);
      }
      const first = result.done[0];
      if (result.failed.length > 0)
        toast.error(errorMessage(result.failed[0]?.error, "Couldn't restore"));
      if (first && result.done.length === 1) {
        toast.success(
          first.renamed ? `Restored as ${nameOf(first.url)}` : `Restored ${first.entry.name}`,
        );
      } else if (result.done.length > 1) toast.success(`Restored ${result.done.length} items`);
      return result;
    },
    [client, driveRoot, invalidate],
  );

  const trash = useCallback(
    async (items: readonly DriveItem[]) => {
      if (
        !driveRoot ||
        items.length === 0 ||
        items.some((item) => !isOwnStorage(item.url, session.storageUrl))
      )
        return;
      try {
        const result = await trashItems(client, driveRoot, items, { webId: session.webId });
        for (const warning of result.warnings ?? []) toast.error(warning.message);
        for (const entry of result.done) {
          invalidate(entry.original);
          invalidate(entry.url);
        }
        if (result.failed.length > 0) {
          const failure = result.failed[0]?.error;
          if (failure instanceof DriveAccessError) {
            toast.error(errorMessage(failure), {
              action: {
                label: "Delete forever",
                onClick: () =>
                  openDialog({
                    kind: "delete-source",
                    items: items.filter((item) =>
                      result.failed.some((failed) => failed.url === item.url),
                    ),
                  }),
              },
            });
          } else toast.error(errorMessage(failure, "Couldn't move to trash"));
        }
        const first = result.done[0];
        if (!first) return;
        toast(
          result.done.length === 1
            ? `Moved ${first.name} to trash`
            : `Moved ${result.done.length} items to trash`,
          {
            duration: 8000,
            ...(!result.warnings?.length
              ? { action: { label: "Undo", onClick: () => void restore(result.done) } }
              : {}),
          },
        );
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't move to trash"));
      }
    },
    [client, driveRoot, invalidate, restore, session.webId, session.storageUrl, openDialog],
  );

  const removeForever = useCallback(
    async (entries: readonly TrashEntry[]) => {
      if (!driveRoot) return;
      const result = await deleteForever(client, driveRoot, entries);
      for (const warning of result.warnings ?? []) toast.error(warning.message);
      for (const entry of result.done) invalidate(entry.url);
      if (result.failed.length > 0)
        toast.error(errorMessage(result.failed[0]?.error, "Couldn't delete"));
      if (result.done.length > 0) toast.success("Deleted for ever");
      return result;
    },
    [client, driveRoot, invalidate],
  );

  const removeSourcesForever = useCallback(
    async (items: readonly DriveItem[]) => {
      if (items.some((item) => !isOwnStorage(item.url, session.storageUrl))) return;
      const done: DriveItem[] = [];
      for (const item of items) {
        try {
          await client.remove(item.url, { recursive: item.kind === "folder" });
          done.push(item);
          invalidate(item.url);
        } catch (error) {
          toast.error(errorMessage(error, "Couldn't delete"));
        }
      }
      if (done.length) toast.success("Deleted for ever");
      return { done };
    },
    [client, invalidate, session.storageUrl],
  );

  return {
    starred,
    open,
    download,
    copyLink,
    toggleStar,
    move,
    rename,
    makeCopy,
    newFolder,
    trash,
    restore,
    removeForever,
    removeSourcesForever,
  };
}

export type DriveActions = ReturnType<typeof useDriveActions>;
