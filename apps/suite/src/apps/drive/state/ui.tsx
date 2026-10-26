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
  useMemo,
  useRef,
  useState,
} from "react";
import { encodeRef } from "@/lib/refs";
import { type DriveClient, DriveError, type DriveItem, nameOf } from "../lib/client/client";
import {
  copyItem,
  createFolder,
  deleteForever,
  moveItems,
  renameItem,
  restoreItems,
  TrashMovingError,
  trashItems,
} from "../lib/operations/operations";
import type { TrashEntry } from "../lib/operations/trash-index";
import { useDrive } from "./drive-context";
import { moveWithValidator } from "./undo";

export type DriveDialog =
  | { kind: "new-folder"; parent: string }
  | { kind: "rename"; item: DriveItem }
  | { kind: "move"; items: DriveItem[] }
  | { kind: "delete-forever"; entries: TrashEntry[] }
  | { kind: "empty-trash"; entries: TrashEntry[] };

export interface PreviewState {
  readonly items: readonly DriveItem[];
  readonly index: number;
}

interface DriveUiValue {
  readonly dialog: DriveDialog | undefined;
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

export function DriveUiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DriveDialog>();
  const [preview, setPreview] = useState<PreviewState>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsItems, setDetailsItems] = useState<readonly DriveItem[]>([]);
  const [uploadRequest, setUploadRequest] = useState<{ id: number; folder: boolean }>();
  const [currentFolder, setCurrentFolder] = useState<string>();
  const dialogFocus = useRef<{ element: HTMLElement | null; url: string | undefined } | undefined>(
    undefined,
  );
  const dialogOpen = useRef(false);
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
    };
    dialogOpen.current = true;
    setDialog(next);
  }, []);
  const closeDialog = useCallback(() => {
    dialogOpen.current = false;
    setDialog(undefined);
  }, []);
  const restoreDialogFocus = useCallback((event: Event) => {
    event.preventDefault();
    // Name -> extension confirmation replaces one dialog with another.
    if (dialogOpen.current) return;
    const saved = dialogFocus.current;
    const row = saved?.url
      ? document.querySelector<HTMLElement>(`[data-url="${CSS.escape(saved.url)}"]`)
      : null;
    const listing = document.querySelector<HTMLElement>("[data-drive-listing]");
    const target = saved?.element?.isConnected ? saved.element : (row ?? listing);
    target?.focus();
    // A connected element may have become disabled or hidden during the mutation.
    if (document.activeElement !== target) (row ?? listing)?.focus();
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
  if (error instanceof TrashMovingError) return error.message;
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

function folderLabel(url: string, driveRoot: string | undefined): string {
  return url === driveRoot ? "My Drive" : nameOf(url);
}

export function useDriveActions() {
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

  const copyLink = useCallback(async (item: DriveItem) => {
    const link = `${location.origin}${hrefFor(item)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied", { description: "Only you can open this link" });
    } catch {
      toast.error("Couldn't copy the link");
    }
  }, []);

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
      const pending = toast.loading(
        items.length === 1 ? `Moving ${items[0]?.name}…` : `Moving ${items.length} items…`,
      );
      // Capture each validator before moving the next item in a potentially slow
      // batch. URL equality does not establish which resource now occupies it.
      const validators = new Map<
        string,
        { etag: string | undefined; children?: readonly string[] } | undefined
      >();
      const movingClient: DriveClient = undoable
        ? {
            ...client,
            move: async (from, to) => {
              const url = await client.move(from, to);
              validators.set(
                url,
                await (async () => {
                  const item = await client.stat(url);
                  return {
                    etag: item.etag,
                    ...(url.endsWith("/")
                      ? { children: (await client.list(url)).map((child) => child.url) }
                      : {}),
                  };
                })().catch(() => undefined),
              );
              return url;
            },
          }
        : client;
      const result = await moveItems(
        movingClient,
        items.map((item) => item.url),
        target,
      );
      toast.dismiss(pending);
      for (const { from, to } of result.done) {
        invalidate(from);
        invalidate(to);
      }
      if (result.failed.length > 0) {
        toast.error(
          result.done.length === 0
            ? errorMessage(result.failed[0]?.error, "Couldn't move")
            : `Moved ${result.done.length} of ${items.length} items`,
        );
      }
      if (result.done.length === 0) return result;
      // An unreadable/absent validator makes Undo fail closed for that item.
      const undo = result.done.map((entry) => ({ ...entry, identity: validators.get(entry.to) }));
      const label = folderLabel(target, driveRoot);
      const first = result.done[0];
      const message =
        result.done.length === 1 && first
          ? `Moved ${nameOf(first.from)} to ${label}`
          : `Moved ${result.done.length} items to ${label}`;
      toast.success(message, {
        ...(undoable
          ? {
              action: {
                label: "Undo",
                onClick: async () => {
                  const failed: string[] = [];
                  for (const { from, to, identity } of undo) {
                    try {
                      if (!identity?.etag) throw new Error("No validator for Undo");
                      await moveWithValidator(
                        { storageUrl: session.storageUrl, fetch: session.fetch },
                        to,
                        from,
                        identity.etag,
                        ...(identity.children ? ([identity.children] as const) : ([] as const)),
                      );
                      invalidate(to);
                      invalidate(from);
                    } catch {
                      failed.push(nameOf(from));
                    }
                  }
                  if (failed.length > 0)
                    toast.error(`This move cannot be safely undone: ${failed.join(", ")}`);
                },
              },
            }
          : {}),
      });
      return result;
    },
    [client, driveRoot, invalidate, session],
  );

  const rename = useCallback(
    async (item: DriveItem, name: string) => {
      try {
        const url = await renameItem(client, item, name);
        invalidate(item.url);
        if (url !== item.url) {
          invalidate(url);
          if (starred.has(item.url)) {
            updatePrefs((current) => ({
              ...current,
              starred: current.starred.map((entry) => (entry === item.url ? url : entry)),
            }));
          }
          toast.success(`Renamed to ${nameOf(url)}`);
        }
        return url;
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't rename"));
        return undefined;
      }
    },
    [client, invalidate, starred, updatePrefs],
  );

  const makeCopy = useCallback(
    async (item: DriveItem) => {
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
    [client, invalidate],
  );

  const newFolder = useCallback(
    async (parent: string, name: string) => {
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
    [client, invalidate],
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
      const first = result.done[0];
      if (result.failed.length > 0)
        toast.error(errorMessage(result.failed[0]?.error, "Couldn't restore"));
      if (first && result.done.length === 1) {
        toast.success(
          first.renamed ? `Restored as ${nameOf(first.url)}` : `Restored ${first.entry.name}`,
        );
      } else if (result.done.length > 1) toast.success(`Restored ${result.done.length} items`);
    },
    [client, driveRoot, invalidate],
  );

  const trash = useCallback(
    async (items: readonly DriveItem[]) => {
      if (!driveRoot || items.length === 0) return;
      const result = await trashItems(client, driveRoot, items, { webId: session.webId });
      for (const entry of result.done) {
        invalidate(entry.original);
        invalidate(entry.url);
      }
      if (result.failed.length > 0) {
        toast.error(errorMessage(result.failed[0]?.error, "Couldn't move to trash"));
      }
      const first = result.done[0];
      if (!first) return;
      toast(
        result.done.length === 1
          ? `Moved ${first.name} to trash`
          : `Moved ${result.done.length} items to trash`,
        {
          duration: 8000,
          action: { label: "Undo", onClick: () => void restore(result.done) },
        },
      );
    },
    [client, driveRoot, invalidate, restore, session.webId],
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
    },
    [client, driveRoot, invalidate],
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
  };
}

export type DriveActions = ReturnType<typeof useDriveActions>;
