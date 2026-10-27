// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/** Drive's route bodies: folder, Recent, Starred, Shared, Search, Trash and preview. */

import { Alert, AlertDescription, Button, FileTypeIcon, IconButton } from "@jeswr/suite-ui";
import { Clock, FolderOpen, HardDrive, Search, Star, Trash2, Users } from "lucide-react";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeRef, InvalidRefError } from "@/lib/refs";
import {
  type DriveClient,
  DriveError,
  type DriveItem,
  nameOf,
  parentOf,
} from "../lib/client/client";
import { listTrash, recentFiles, searchByName, trashFolderOf } from "../lib/operations/operations";
import type { TrashEntry } from "../lib/operations/trash-index";
import { formatSize } from "../lib/view/view";
import { useDrive, useFolder } from "../state/drive-context";
import { useDriveListingFocus } from "../state/listing-focus";
import { useDriveActions, useDriveUi } from "../state/ui";
import { Breadcrumbs } from "./breadcrumbs";
import { type BrowserItem, FileBrowser } from "./file-browser";
import { trashMenu } from "./item-menu";
import { PreviewPage } from "./preview";

function useRefParam(): string {
  const params = useParams<{ ref: string }>();
  try {
    return decodeRef(params.ref);
  } catch (error) {
    if (error instanceof InvalidRefError) notFound();
    throw error;
  }
}

export function FolderView({ url }: { url?: string }) {
  const { driveRoot, uploads } = useDrive();
  const ui = useDriveUi();
  const folder = url ?? driveRoot;
  const listing = useFolder(folder);
  const isRoot = folder === driveRoot;
  if (
    listing.status === "error" &&
    listing.error instanceof DriveError &&
    listing.error.kind === "not-found"
  ) {
    notFound();
  }
  return (
    <>
      {folder && driveRoot && !isRoot ? <Breadcrumbs folder={folder} /> : null}
      <FileBrowser
        title={!folder || isRoot ? "My Drive" : nameOf(folder)}
        items={listing.status === "ready" ? listing.items : undefined}
        error={listing.status === "error" ? listing.error : undefined}
        onRetry={listing.reload}
        refreshing={listing.status === "ready" && listing.refreshing}
        {...(folder ? { folder } : {})}
        columns={["owner", "modified", "size"]}
        empty={
          isRoot
            ? {
                title: "Your Drive is empty",
                body: "Upload files or create a folder to get started",
                icon: <HardDrive size={32} />,
                actions: (
                  <>
                    <Button onClick={() => ui.requestUpload(false)}>Upload</Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        folder && ui.openDialog({ kind: "new-folder", parent: folder })
                      }
                    >
                      New folder
                    </Button>
                  </>
                ),
              }
            : {
                title: "This folder is empty",
                body: "Drag files here or use New",
                icon: <FolderOpen size={32} />,
              }
        }
      />
      {uploads.tasks.length > 0 ? <div className="drv-dock-spacer" /> : null}
    </>
  );
}

export function FolderRefView() {
  const url = useRefParam();
  if (!url.endsWith("/")) notFound();
  return <FolderView url={url} />;
}

/** A cancellable tree scan; results are tied to the root, query and request generation. */
function useTreeFiles(query?: string) {
  const { client, driveRoot, changes } = useDrive();
  const [snapshot, setSnapshot] = useState<{
    client: DriveClient;
    root: string;
    query: string | undefined;
    items?: BrowserItem[];
    error?: unknown;
  }>();
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const active = useRef<AbortController | undefined>(undefined);
  const load = useCallback(() => {
    active.current?.abort();
    setTick((value) => value + 1);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick requests a new scan
  useEffect(() => {
    if (!driveRoot) return;
    const request = ++generation.current;
    const controller = new AbortController();
    active.current = controller;
    // Live scans keep the rendered rows (and their focused controls) until the
    // replacement arrives. A root, client or query change still starts fresh.
    setSnapshot((previous) => ({
      client,
      root: driveRoot,
      query,
      ...(previous?.client === client &&
      previous.root === driveRoot &&
      previous.query === query &&
      previous.items
        ? { items: previous.items }
        : {}),
    }));
    // The operations' scan API does not expose cancellation. Bind its list seam to
    // this request so aborted scans stop issuing IO, even if a transport ignores abort.
    const scoped: DriveClient = {
      ...client,
      list: async (url, options) => {
        controller.signal.throwIfAborted();
        const items = await client.list(url, { ...options, signal: controller.signal });
        controller.signal.throwIfAborted();
        return items;
      },
    };
    const result =
      query === undefined
        ? recentFiles(scoped, [driveRoot])
        : searchByName(scoped, driveRoot, query);
    result.then(
      (items) => {
        if (!controller.signal.aborted && request === generation.current)
          setSnapshot({ client, root: driveRoot, query, items });
      },
      (error: unknown) => {
        if (!controller.signal.aborted && request === generation.current)
          setSnapshot({ client, root: driveRoot, query, error });
      },
    );
    return () => controller.abort();
  }, [client, driveRoot, query, tick]);
  useEffect(
    () => (driveRoot ? changes.subscribeSubtree(driveRoot, load) : undefined),
    [driveRoot, changes, load],
  );
  const current =
    snapshot?.client === client && snapshot.root === driveRoot && snapshot.query === query
      ? snapshot
      : undefined;
  return { items: current?.items, error: current?.error, load };
}

export function RecentView() {
  const { items, error, load } = useTreeFiles();
  return (
    <FileBrowser
      title="Recent"
      items={items}
      error={error}
      onRetry={load}
      columns={["location", "modified", "size"]}
      fixedOrder
      empty={{
        title: "Nothing recent yet",
        body: "Files you open or change will show up here",
        icon: <Clock size={32} />,
      }}
      footer={
        items && items.length >= 50 ? (
          <p className="drv-footnote">Showing your 50 most recent items</p>
        ) : null
      }
    />
  );
}

export function StarredView() {
  const { client, prefs, driveRoot, changes } = useDrive();
  const [items, setItems] = useState<BrowserItem[]>();
  const [version, setVersion] = useState(0);
  const starred = prefs.starred;
  // Starred items live anywhere in Drive, so any change there may remove or alter a row.
  useEffect(
    () =>
      driveRoot ? changes.subscribeSubtree(driveRoot, () => setVersion((v) => v + 1)) : undefined,
    [changes, driveRoot],
  );
  useEffect(() => {
    void version;
    let live = true;
    Promise.all(
      starred.map((url) =>
        client.stat(url).then(
          (item): BrowserItem => {
            const parent = parentOf(url);
            return parent ? { ...item, folder: parent } : item;
          },
          () => undefined,
        ),
      ),
    ).then(
      (found) => live && setItems(found.filter((item): item is BrowserItem => item !== undefined)),
    );
    return () => {
      live = false;
    };
  }, [client, starred, version]);
  return (
    <FileBrowser
      title="Starred"
      items={items}
      columns={["location", "modified", "size"]}
      empty={{
        title: "No starred items",
        body: "Star items to find them quickly",
        icon: <Star size={32} />,
      }}
    />
  );
}

export function SharedView() {
  const { prefs } = useDrive();
  const items = useMemo<BrowserItem[]>(
    () =>
      prefs.openedShared.map(({ url }) => ({
        url,
        name: nameOf(url),
        kind: url.endsWith("/") ? "folder" : "file",
      })),
    [prefs.openedShared],
  );
  return (
    <FileBrowser
      title="Shared with me"
      items={items}
      columns={["modified"]}
      banner={
        <Alert className="drv-banner">
          <Users aria-hidden="true" size={16} />
          <AlertDescription>
            Items people share with you appear here when you open their link. Shared lists from your
            storage are coming later.
          </AlertDescription>
        </Alert>
      }
      empty={{
        title: "Nothing shared with you yet",
        body: "When someone sends you a link, open it and it will appear here",
        icon: <Users size={32} />,
      }}
    />
  );
}

export function SearchView() {
  const query = useSearchParams().get("q") ?? "";
  const { items, error, load } = useTreeFiles(query);
  return (
    <FileBrowser
      title={query ? `Results for "${query}"` : "Search"}
      items={items}
      error={error}
      onRetry={load}
      columns={["location", "modified", "size"]}
      empty={{
        title: query ? "No results" : "Search your Drive",
        body: query ? "Try another name" : "Type a name in the search box",
        icon: <Search size={32} />,
      }}
    />
  );
}

export function PreviewRouteView() {
  const url = useRefParam();
  const { client } = useDrive();
  const [result, setResult] = useState<{
    url: string;
    client: DriveClient;
    item?: DriveItem;
    error?: unknown;
  }>();
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries HEAD
  useEffect(() => {
    let live = true;
    setResult(undefined);
    client.stat(url).then(
      (item) => live && setResult({ url, client, item }),
      (error: unknown) => live && setResult({ url, client, error }),
    );
    return () => {
      live = false;
    };
  }, [client, url, attempt]);
  const current = result?.url === url && result.client === client ? result : undefined;
  const error = current?.error;
  if (error instanceof DriveError && (error.status === 404 || error.status === 410)) notFound();
  if (current && !current.item) {
    const status = error instanceof DriveError ? error.status : undefined;
    return (
      <div className="drv-state" role="alert">
        <h1>
          {status === 401
            ? "Sign in to open this file"
            : status === 403
              ? "You don't have access to this file"
              : "Can't open this file"}
        </h1>
        <p>
          {status === 401
            ? "Sign in again, then retry."
            : status === 403
              ? "Request access from the owner, then retry."
              : "The storage didn't respond. Try again."}
        </p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </Button>
      </div>
    );
  }
  const item = current?.item;
  if (!item)
    return (
      <div className="drv-boot" role="status">
        Loading…
      </div>
    );
  if (item.kind === "folder") return <FolderView url={url} />;
  return <PreviewPage item={item} parent={parentOf(url)} />;
}

export function TrashView() {
  const { client, driveRoot, changes } = useDrive();
  const ui = useDriveUi();
  const [snapshot, setSnapshot] = useState<{
    client: DriveClient;
    root: string;
    entries?: TrashEntry[];
    failed?: boolean;
  }>();
  const generation = useRef(0);
  const current = snapshot?.client === client && snapshot.root === driveRoot ? snapshot : undefined;
  const entries = current?.entries;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const load = useCallback(() => {
    const request = ++generation.current;
    if (!driveRoot) return;
    const accept = (entries: TrashEntry[]) => {
      if (request === generation.current) setSnapshot({ client, root: driveRoot, entries });
    };
    listTrash(client, driveRoot).then(accept, () => {
      if (request !== generation.current) return;
      setSnapshot((previous) => ({
        client,
        root: driveRoot,
        ...(previous?.client === client && previous.root === driveRoot && previous.entries
          ? { entries: previous.entries }
          : {}),
        failed: true,
      }));
    });
  }, [client, driveRoot]);
  useEffect(() => {
    load();
    return () => {
      ++generation.current;
    };
  }, [load]);
  useEffect(
    () => (driveRoot ? changes.subscribeSubtree(trashFolderOf(driveRoot), load) : undefined),
    [driveRoot, changes, load],
  );
  const chosen = (entries ?? []).filter((entry) => selected.has(entry.url));
  const { restore } = useDriveActions();
  const listing = useRef<HTMLDivElement>(null);
  const listingFocus = useDriveListingFocus(entries?.map((entry) => entry.url) ?? [], listing);
  const focusAfterRemoval = (removedUrls: readonly string[]) => {
    const removed = new Set(removedUrls);
    if (removed.size === 0) return;
    setSelected((current) => new Set([...current].filter((url) => !removed.has(url))));
    listingFocus.focusAfterRemoval(removedUrls);
  };
  const restoreEntries = async (targets: readonly TrashEntry[]) => {
    const result = await restore(targets);
    focusAfterRemoval(result?.done.map(({ entry }) => entry.url) ?? []);
  };
  const confirmDelete = (targets: TrashEntry[], empty = false) =>
    ui.openDialog({
      kind: empty ? "empty-trash" : "delete-forever",
      entries: targets,
      onRemoved: focusAfterRemoval,
    });
  return (
    <div className="drv-page">
      <div className="drv-heading">
        <h1>Trash</h1>
      </div>
      <Alert className="drv-banner">
        <Trash2 aria-hidden="true" size={16} />
        <AlertDescription>Items in the trash are deleted for ever after 30 days.</AlertDescription>
      </Alert>
      <div
        className="drv-toolbar"
        role="toolbar"
        aria-label="Trash actions"
        onFocusCapture={(event) => listingFocus.onFocusCapture(event, chosen[0]?.url)}
        onBlurCapture={listingFocus.onBlurCapture}
      >
        {chosen.length > 0 ? (
          <>
            <span className="drv-selection-count">{chosen.length} selected</span>
            <Button size="sm" variant="outline" onClick={() => void restoreEntries(chosen)}>
              Restore
            </Button>
            <Button size="sm" variant="outline" onClick={() => confirmDelete(chosen)}>
              Delete for ever
            </Button>
          </>
        ) : null}
        <div className="drv-toolbar-end">
          <Button
            size="sm"
            variant="destructive"
            disabled={!entries || entries.length === 0}
            onClick={() => entries && confirmDelete(entries, true)}
          >
            Empty trash
          </Button>
        </div>
      </div>
      <div
        className="drv-content"
        ref={listing}
        data-drive-listing=""
        tabIndex={-1}
        onFocusCapture={listingFocus.onFocusCapture}
        onBlurCapture={listingFocus.onBlurCapture}
      >
        {current?.failed ? (
          <div role="alert">
            <p>Couldn't refresh Trash. Your recovery items are kept. Try again.</p>
            <Button variant="outline" onClick={load}>
              Retry
            </Button>
          </div>
        ) : null}
        {!entries ? (
          current?.failed ? null : (
            <div className="drv-state" role="status">
              Loading…
            </div>
          )
        ) : entries.length === 0 && !current?.failed ? (
          <div className="drv-state">
            <div className="drv-state-icon" aria-hidden="true">
              <Trash2 size={32} />
            </div>
            <h2>Trash is empty</h2>
          </div>
        ) : entries.length === 0 ? null : (
          <table
            className="drv-table"
            aria-label="Trash"
            onKeyDown={(event) => {
              // 04-drive §8: Shift+Delete in Trash deletes the selected entries for ever.
              if (event.defaultPrevented || event.key !== "Delete" || !event.shiftKey) return;
              if (chosen.length === 0) return;
              event.preventDefault();
              confirmDelete(chosen);
            }}
          >
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Select</span>
                </th>
                <th scope="col">Name</th>
                <th scope="col" className="drv-col-location">
                  Original location
                </th>
                <th scope="col" className="drv-col-modified">
                  Trashed on
                </th>
                <th scope="col" className="drv-col-size">
                  Size
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const menu = trashMenu(
                  () => void restoreEntries([entry]),
                  () => confirmDelete([entry]),
                );
                return (
                  <tr
                    key={entry.url}
                    data-url={entry.url}
                    tabIndex={-1}
                    data-selected={selected.has(entry.url) || undefined}
                  >
                    <td className="drv-cell-check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.name}`}
                        checked={selected.has(entry.url)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(entry.url);
                            else next.delete(entry.url);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      <div className="drv-cell-name">
                        <FileTypeIcon
                          {...(entry.contentType ? { contentType: entry.contentType } : {})}
                          name={entry.name}
                          size={24}
                          decorative
                        />
                        <span className="drv-name">{entry.name}</span>
                        {entry.status === "partial" ? (
                          <span role="note">
                            Partly moved to Trash. Restore to recover missing items; existing files
                            will be kept.
                            {entry.remaining?.length
                              ? ` Recovery copies: ${entry.remaining.map(nameOf).join(", ")}.`
                              : null}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="drv-col-location">{originalLabel(entry.original, driveRoot)}</td>
                    <td className="drv-col-modified">
                      {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                        entry.trashedAt,
                      )}
                    </td>
                    <td className="drv-col-size">
                      {formatSize({
                        kind: entry.original.endsWith("/") ? "folder" : "file",
                        ...(entry.size !== undefined ? { size: entry.size } : {}),
                      })}
                    </td>
                    <td className="drv-cell-menu">
                      {menu.map((action) =>
                        action === "separator" ? null : (
                          <IconButton
                            key={action.id}
                            label={`${action.label}: ${entry.name}`}
                            variant="ghost"
                            onClick={action.onSelect}
                          >
                            <action.icon aria-hidden="true" size={16} />
                          </IconButton>
                        ),
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function originalLabel(original: string, driveRoot: string | undefined): string {
  const parent = parentOf(original);
  if (!parent || parent === driveRoot) return "My Drive";
  return nameOf(parent);
}
