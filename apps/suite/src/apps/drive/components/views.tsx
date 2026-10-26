// AUTHORED-BY Claude Opus 5.5
"use client";
/** Drive's route bodies: folder, Recent, Starred, Shared, Search, Trash and preview. */

import { Alert, AlertDescription, Button, FileTypeIcon, IconButton } from "@jeswr/suite-ui";
import { Clock, FolderOpen, HardDrive, Search, Star, Trash2, Users } from "lucide-react";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { decodeRef, InvalidRefError } from "@/lib/refs";
import { DriveError, type DriveItem, nameOf, parentOf } from "../lib/client/client";
import { listTrash, recentFiles, searchByName, trashFolderOf } from "../lib/operations/operations";
import type { TrashEntry } from "../lib/operations/trash-index";
import { formatSize } from "../lib/view/view";
import { useDrive, useFolder } from "../state/drive-context";
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

export function RecentView() {
  const { client, driveRoot, changes } = useDrive();
  const [items, setItems] = useState<BrowserItem[]>();
  const [error, setError] = useState<unknown>();
  const load = useCallback(() => {
    if (!driveRoot) return;
    recentFiles(client, [driveRoot]).then(setItems, setError);
  }, [client, driveRoot]);
  useEffect(load, [load]);
  useEffect(
    () => (driveRoot ? changes.subscribe(driveRoot, load) : undefined),
    [driveRoot, changes, load],
  );
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
  const { client, prefs } = useDrive();
  const [items, setItems] = useState<BrowserItem[]>();
  const starred = prefs.starred;
  useEffect(() => {
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
  }, [client, starred]);
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
  const { client, driveRoot, changes } = useDrive();
  const query = useSearchParams().get("q") ?? "";
  const [items, setItems] = useState<BrowserItem[]>();
  const load = useCallback(() => {
    if (!driveRoot) return;
    setItems(undefined);
    searchByName(client, driveRoot, query).then(setItems, () => setItems([]));
  }, [client, driveRoot, query]);
  useEffect(load, [load]);
  useEffect(
    () => (driveRoot ? changes.subscribe(driveRoot, load) : undefined),
    [driveRoot, changes, load],
  );
  return (
    <FileBrowser
      title={query ? `Results for "${query}"` : "Search"}
      items={items}
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
  const [item, setItem] = useState<DriveItem | "missing">();
  useEffect(() => {
    let live = true;
    client.stat(url).then(
      (found) => live && setItem(found),
      () => live && setItem("missing"),
    );
    return () => {
      live = false;
    };
  }, [client, url]);
  if (item === "missing") notFound();
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
  const [entries, setEntries] = useState<TrashEntry[]>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const load = useCallback(() => {
    if (!driveRoot) return;
    listTrash(client, driveRoot).then(setEntries, () => setEntries([]));
  }, [client, driveRoot]);
  useEffect(load, [load]);
  useEffect(
    () => (driveRoot ? changes.subscribe(trashFolderOf(driveRoot), load) : undefined),
    [driveRoot, changes, load],
  );
  const chosen = (entries ?? []).filter((entry) => selected.has(entry.url));
  const { restore } = useDriveActions();
  return (
    <div className="drv-page">
      <div className="drv-heading">
        <h1>Trash</h1>
      </div>
      <Alert className="drv-banner">
        <Trash2 aria-hidden="true" size={16} />
        <AlertDescription>Items in the trash are deleted for ever after 30 days.</AlertDescription>
      </Alert>
      <div className="drv-toolbar" role="toolbar" aria-label="Trash actions">
        {chosen.length > 0 ? (
          <>
            <span className="drv-selection-count">{chosen.length} selected</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void restore(chosen).then(() => setSelected(new Set()))}
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => ui.openDialog({ kind: "delete-forever", entries: chosen })}
            >
              Delete for ever
            </Button>
          </>
        ) : null}
        <div className="drv-toolbar-end">
          <Button
            size="sm"
            variant="destructive"
            disabled={!entries || entries.length === 0}
            onClick={() => entries && ui.openDialog({ kind: "empty-trash", entries })}
          >
            Empty trash
          </Button>
        </div>
      </div>
      <div className="drv-content">
        {!entries ? (
          <div className="drv-state" role="status">
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="drv-state">
            <div className="drv-state-icon" aria-hidden="true">
              <Trash2 size={32} />
            </div>
            <h2>Trash is empty</h2>
          </div>
        ) : (
          <table className="drv-table" aria-label="Trash">
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
                  () => void restore([entry]),
                  () => ui.openDialog({ kind: "delete-forever", entries: [entry] }),
                );
                return (
                  <tr key={entry.url} data-selected={selected.has(entry.url) || undefined}>
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
