// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Toolbar,
} from "@jeswr/suite-ui";
import { Album, Heart, Images, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { decodeRef, encodeRef } from "@/lib/refs";
import { normalizePathname, useRoutePathname } from "@/lib/route-params";
import { changeMembers, type StoredAlbum } from "../lib/data/albums";
import { type LibraryPhoto, searchPhotos } from "../lib/data/library";
import { usePhotos } from "../state/photos-context";
import { AlbumDialog, ConfirmDialog, RenameAlbumDialog } from "./album-dialogs";
import { useDialogFocus } from "./dialog-focus";
import { PhotoGrid } from "./photo-grid";
import { PhotoImage } from "./photo-image";
import { useRequestUpload } from "./photos-app";
import { VideoBadge } from "./video-badge";

export function collectionPhotos(
  photos: LibraryPhoto[],
  albums: StoredAlbum[],
  favourites: string[],
  from: string,
): LibraryPhoto[] {
  const url = new URL(from, "https://suite.invalid");
  url.pathname = normalizePathname(url.pathname);
  if (url.pathname === "/photos/favourites")
    return photos.filter((photo) => favourites.includes(photo.ref));
  if (url.pathname === "/photos/search")
    return searchPhotos(photos, albums, url.searchParams.get("q") ?? "");
  if (url.pathname.startsWith("/photos/a/")) {
    try {
      const album = albums.find(
        (item) => item.url === decodeRef(url.pathname.slice("/photos/a/".length)),
      );
      return album?.members.flatMap((ref) => photos.filter((photo) => photo.ref === ref)) ?? [];
    } catch {
      return [];
    }
  }
  return photos;
}
export function CollectionScreen({
  kind = "timeline",
  collectionPath,
}: {
  collectionPath?: string;
  kind?: "timeline" | "favourites" | "trash" | "search" | "album";
}) {
  const state = usePhotos();
  const requestUpload = useRequestUpload();
  const currentPath = useRoutePathname();
  const pathname = collectionPath?.split("?")[0] ?? currentPath;
  const search = useSearchParams();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const [add, setAdd] = useState(false);
  const [picker, setPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const pickerFocus = useDialogFocus();
  const [picked, setPicked] = useState(new Set<string>());
  const [confirmation, setConfirmation] = useState<"album" | "empty" | "purge" | null>(null);
  const [purgeUrls, setPurgeUrls] = useState<string[]>([]);
  let album: StoredAlbum | undefined;
  if (kind === "album") {
    try {
      album = state.albums.find((item) => item.url === decodeRef(pathname.split("/").at(-1) ?? ""));
    } catch {
      /* Invalid route has the same unavailable state. */
    }
  }
  const query =
    (collectionPath
      ? new URLSearchParams(collectionPath.split("?")[1]).get("q")
      : search.get("q")) ?? "";
  const from = kind === "search" ? `${pathname}?q=${encodeURIComponent(query)}` : pathname;
  const photos: LibraryPhoto[] =
    kind === "trash"
      ? state.trash.map((item) => ({
          ...item.photo,
          url: item.url,
          ref: item.url,
          etag: item.etag,
          readOnly: true,
        }))
      : collectionPhotos(state.photos, state.albums, state.favourites, from);
  const title =
    kind === "favourites"
      ? "Favourites"
      : kind === "trash"
        ? "Trash"
        : kind === "search"
          ? `Results for “${query}”`
          : kind === "album"
            ? (album?.name ?? "Album unavailable")
            : "Photos";
  const selectedPhotos = photos.filter((photo) => selected.has(photo.ref));
  const recoveryUrls = new Set(
    state.trash.filter((item) => item.status === "needs-recovery").map((item) => item.url),
  );
  const selectedTrash = selectedPhotos
    .filter((photo) => !recoveryUrls.has(photo.url))
    .map((photo) => photo.url);
  const selectedRecovery = selectedPhotos
    .filter((photo) => recoveryUrls.has(photo.url))
    .map((photo) => photo.url);
  const focusRef = search.get("focus");
  useEffect(() => {
    if (!focusRef || state.status === "loading") return;
    try {
      const ref = decodeRef(focusRef);
      const node = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a[data-photo-ref]"),
      ).find((link) => link.dataset.photoRef === ref);
      node?.focus();
    } catch {
      /* Ignore a stale or invalid focus hint. */
    }
  }, [focusRef, state.status]);
  // Collection navigation starts a fresh selection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the navigation event
  useEffect(() => {
    setSelected(new Set());
    setSelecting(false);
  }, [pathname, query]);
  useEffect(() => {
    const clear = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        (event.target as HTMLElement)?.closest('[role="dialog"]')
      )
        return;
      setSelected(new Set());
      setSelecting(false);
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);
  const activeAlbum = album;
  return (
    <div className="pho-page">
      <header className="pho-page-header">
        <div className="pho-header-text">
          {kind !== "trash" && kind !== "favourites" && (
            <p className="pho-eyebrow">
              {kind === "album" ? "Your collection" : "Your memories, in your hands"}
            </p>
          )}
          <h1>{title}</h1>
          <p>
            {kind === "trash"
              ? "Photos and videos in Trash stay in your pod until you delete them forever."
              : kind === "album"
                ? `${photos.length} items · Use Alt + ↑ / ↓ to reorder`
                : `${photos.length} item${photos.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="pho-header-actions">
          <Button
            variant="outline"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting(!selecting);
              setSelected(new Set());
            }}
          >
            {selecting ? "Done selecting" : "Select photos"}
          </Button>
          {kind === "album" && album && (
            <Button
              onClick={() => {
                setPicked(new Set());
                setPicker(true);
              }}
            >
              <Plus size={16} />
              Add photos
            </Button>
          )}
          {kind === "trash" && (
            <Button
              variant="outline"
              disabled={!state.trash.some((item) => item.status !== "needs-recovery")}
              onClick={() => setConfirmation("empty")}
            >
              Empty trash
            </Button>
          )}
        </div>
      </header>
      {kind === "trash" && recoveryUrls.size > 0 && (
        <div className="pho-warning" role="status">
          {recoveryUrls.size} photo{recoveryUrls.size === 1 ? " needs" : "s need"} recovery and
          {recoveryUrls.size === 1 ? " is" : " are"} still in your library. Resume the move to trash
          before restoring or deleting.
        </div>
      )}
      {album && (
        <div className="pho-album-settings">
          <Button variant="outline" onClick={() => setRenaming(true)}>
            Rename
          </Button>
          <Button variant="ghost" onClick={() => setConfirmation("album")}>
            Delete album
          </Button>
          <span title="Sharing arrives with the suite share dialog">
            <Button disabled variant="outline">
              Share album
            </Button>
          </span>
        </div>
      )}
      {state.warnings > 0 && (
        <div className="pho-warning" role="status">
          {state.warnings} item{state.warnings === 1 ? "" : "s"} couldn't be read. Your other photos
          are available.{" "}
          <Button
            variant="ghost"
            onClick={() => {
              void state.refresh();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {selectedPhotos.length > 0 && (
        <div className="pho-selection">
          <p role="status">{selectedPhotos.length} selected</p>
          <Toolbar
            label="Photo selection"
            actions={
              kind === "trash"
                ? [
                    ...(selectedRecovery.length
                      ? [
                          {
                            id: "resume",
                            label: "Resume",
                            onSelect: () => {
                              void state.resume(selectedRecovery).then((ok) => {
                                if (ok) setSelected(new Set());
                              });
                            },
                          },
                        ]
                      : []),
                    ...(selectedTrash.length
                      ? [
                          {
                            id: "restore",
                            label: "Restore",
                            onSelect: () => {
                              void state.restore(selectedTrash).then((ok) => {
                                if (ok) setSelected(new Set());
                              });
                            },
                          },
                          {
                            id: "purge",
                            label: "Delete forever",
                            onSelect: () => {
                              setPurgeUrls(selectedTrash);
                              setConfirmation("purge");
                            },
                          },
                        ]
                      : []),
                    {
                      id: "clear",
                      label: "Clear selection",
                      onSelect: () => setSelected(new Set()),
                    },
                  ]
                : [
                    {
                      id: "album",
                      label: "Add to album",
                      icon: <Album size={16} />,
                      onSelect: () => setAdd(true),
                    },
                    {
                      id: "favourite",
                      label: kind === "favourites" ? "Remove favourite" : "Favourite",
                      icon: <Heart size={16} />,
                      onSelect: () => {
                        void state.favourite(
                          selectedPhotos.map((photo) => photo.ref),
                          kind !== "favourites",
                        );
                      },
                    },
                    {
                      id: "trash",
                      label: "Move to trash",
                      icon: <Trash2 size={16} />,
                      disabled: selectedPhotos.some((photo) => photo.readOnly),
                      onSelect: () => {
                        void state.moveToTrash(selectedPhotos).then((ok) => {
                          if (ok) setSelected(new Set());
                        });
                      },
                    },
                    {
                      id: "clear",
                      label: "Clear selection",
                      onSelect: () => setSelected(new Set()),
                    },
                  ]
            }
          />
        </div>
      )}
      {state.status === "loading" ? (
        <LoadingSkeleton preset="grid" label="Loading photos…" />
      ) : state.status === "error" ? (
        <ErrorState
          error="unreachable"
          actions={{
            retry: () => {
              void state.refresh();
            },
          }}
        />
      ) : kind === "album" && !album ? (
        <EmptyState
          title="Album unavailable"
          body="This album may have been deleted."
          primaryAction={<Link href="/photos/albums">Back to albums</Link>}
        />
      ) : !photos.length ? (
        <EmptyState
          icon={<Images size={24} />}
          title={
            kind === "trash"
              ? "Trash is empty"
              : kind === "favourites"
                ? "Keep your favourites close"
                : kind === "search"
                  ? "No matching photos or videos"
                  : kind === "album"
                    ? "Make this album yours"
                    : "Your story starts here"
          }
          body={
            kind === "trash"
              ? "Photos and videos you move to trash will appear here."
              : kind === "favourites"
                ? "Mark a photo or video with a heart to find it here."
                : kind === "search"
                  ? "Try a date, month, keyword or album name."
                  : "Add a few photos and videos to get started."
          }
          primaryAction={
            kind === "album" ? (
              <Button onClick={() => setPicker(true)}>Choose photos</Button>
            ) : kind === "timeline" ? (
              <Button onClick={requestUpload}>Upload photos and videos</Button>
            ) : (
              <Link href="/photos">Browse photos</Link>
            )
          }
        />
      ) : (
        <PhotoGrid
          photos={photos}
          from={from}
          grouped={kind !== "album" && kind !== "trash"}
          selecting={selecting || selected.size > 0 || kind === "trash"}
          selected={selected}
          onSelection={setSelected}
          album={album}
          itemActions={
            kind === "trash"
              ? (photo) =>
                  recoveryUrls.has(photo.url) ? (
                    <>
                      <Badge>Needs recovery</Badge>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void state.resume([photo.url]);
                        }}
                      >
                        Resume
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void state.restore([photo.url]);
                        }}
                      >
                        Restore
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setPurgeUrls([photo.url]);
                          setConfirmation("purge");
                        }}
                      >
                        Delete forever
                      </Button>
                    </>
                  )
              : undefined
          }
        />
      )}
      <AlbumDialog
        open={add}
        refs={selectedPhotos.map((photo) => photo.ref)}
        onClose={() => setAdd(false)}
      />
      {renaming && album && <RenameAlbumDialog album={album} onClose={() => setRenaming(false)} />}
      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="pho-picker" {...pickerFocus}>
          <DialogHeader>
            <DialogTitle>Add photos to {album?.name}</DialogTitle>
            <DialogDescription>
              Choose photos from your library, then add them to this album.
            </DialogDescription>
          </DialogHeader>
          <div className="pho-picker-body">
            <PhotoGrid
              photos={state.photos}
              from="/photos"
              selecting
              selected={picked}
              onSelection={setPicked}
            />
          </div>
          <Button
            disabled={!picked.size}
            onClick={() => {
              if (activeAlbum)
                void state
                  .editAlbum(
                    activeAlbum.url,
                    (value) => changeMembers(value, [...picked], true),
                    "Photos added to album",
                  )
                  .then((ok) => {
                    if (ok) setPicker(false);
                  });
            }}
          >
            Add {picked.size || "selected"} photos
          </Button>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
        title={
          confirmation === "album"
            ? "Delete this album?"
            : confirmation === "empty"
              ? "Empty trash?"
              : "Delete photos forever?"
        }
        description={
          confirmation === "album"
            ? "The album will be removed. Your photos will be kept."
            : confirmation === "empty" && recoveryUrls.size
              ? "Completed trash moves will be permanently deleted. Photos needing recovery will be kept. This can't be undone."
              : "The originals and their previews will be permanently deleted. This can't be undone."
        }
        action={
          confirmation === "album"
            ? "Delete album"
            : confirmation === "empty"
              ? "Empty trash"
              : "Delete forever"
        }
        onConfirm={async () => {
          if (confirmation === "album" && activeAlbum) {
            const ok = await state.removeAlbum(activeAlbum);
            return ok;
          }
          const ok = await state.purge(confirmation === "empty" ? undefined : purgeUrls);
          if (ok) setSelected(new Set());
          return ok;
        }}
      />
    </div>
  );
}
export function AlbumsScreen() {
  const state = usePhotos();
  const [create, setCreate] = useState(false);
  const albumFailureMessage = `${state.albumFailures.length} album${state.albumFailures.length === 1 ? "" : "s"} couldn't be read.`;
  return (
    <div className="pho-page">
      <header className="pho-page-header">
        <div className="pho-header-text">
          <p className="pho-eyebrow">Stories worth keeping together</p>
          <h1>Albums</h1>
          <p>{state.albums.length} collections</p>
        </div>
        <Button onClick={() => setCreate(true)}>
          <Plus size={18} />
          New album
        </Button>
      </header>
      {state.albumFailures.length > 0 && state.albums.length > 0 && (
        <div className="pho-warning" role="status">
          {albumFailureMessage} Your other albums are available.{" "}
          <Button variant="ghost" onClick={() => void state.refresh()}>
            Retry
          </Button>
        </div>
      )}
      {state.status === "loading" ? (
        <LoadingSkeleton preset="grid" />
      ) : state.status === "error" || (state.albumFailures.length > 0 && !state.albums.length) ? (
        <ErrorState
          error="unreachable"
          actions={{
            retry: () => {
              void state.refresh();
            },
          }}
        >
          {state.albumFailures.length > 0 && <p>{albumFailureMessage}</p>}
        </ErrorState>
      ) : !state.albums.length ? (
        <EmptyState
          title="A home for every story"
          body="Collect a trip, a season or a small everyday moment."
          primaryAction={<Button onClick={() => setCreate(true)}>New album</Button>}
        />
      ) : (
        <ul className="pho-albums">
          {state.albums.map((album) => {
            const cover = state.photos.find(
              (photo) => photo.ref === (album.coverUrl ?? album.members[0]),
            );
            return (
              <li key={album.url}>
                <Link href={`/photos/a/${encodeRef(album.url)}`} className="pho-album-card">
                  <div className="pho-album-cover" aria-hidden="true">
                    {cover ? (
                      <>
                        <PhotoImage
                          url={
                            cover.thumbnailUrl ??
                            (cover.kind === "video" ? undefined : cover.contentUrl)
                          }
                          name=""
                        />
                        <VideoBadge photo={cover} />
                      </>
                    ) : (
                      <Album size={32} aria-hidden="true" />
                    )}
                  </div>
                  <h2>{album.name}</h2>
                  <p>
                    {album.members.length} photo{album.members.length === 1 ? "" : "s"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <AlbumDialog open={create} refs={[]} createOnly onClose={() => setCreate(false)} />
    </div>
  );
}
