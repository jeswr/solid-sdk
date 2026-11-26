// AUTHORED-BY Codex GPT-6
"use client";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@jeswr/suite-ui";
import { Heart, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import type { StoredAlbum } from "../lib/data/albums";
import { changeMembers, coverAlbum, orderAlbum } from "../lib/data/albums";
import { dayGroups, type LibraryPhoto } from "../lib/data/library";
import { layoutJustifiedRows } from "../lib/library/justified";
import { getOrientationTransform } from "../lib/library/orientation";
import { usePhotos } from "../state/photos-context";
import { PhotoImage } from "./photo-image";
import { mediaLabel, VideoBadge } from "./video-badge";

function dayLabel(key: string) {
  if (key === "undated") return "Undated";
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${key}T12:00:00Z`));
}
export function PhotoGrid({
  photos,
  from,
  grouped = true,
  selecting,
  selected,
  onSelection,
  album,
  itemActions,
}: {
  photos: LibraryPhoto[];
  from: string;
  grouped?: boolean;
  selecting: boolean;
  selected: Set<string>;
  onSelection: (refs: Set<string>) => void;
  album?: StoredAlbum | undefined;
  itemActions?: ((photo: LibraryPhoto) => React.ReactNode) | undefined;
}) {
  const state = usePhotos();
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const [focused, setFocused] = useState(photos[0]?.ref);
  const anchor = useRef<string | undefined>(undefined);
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const drag = useRef<string | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const node = root.current;
    const observer = new ResizeObserver(() => setWidth(Math.max(1, node.clientWidth)));
    setWidth(Math.max(1, node.clientWidth));
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearTimeout(longPress.current);
    };
  }, []);
  const groups = grouped ? dayGroups(photos) : [{ key: "collection", photos, monthLabel: "" }];
  const tabStop = photos.some((photo) => photo.ref === focused) ? focused : photos[0]?.ref;
  function toggle(photo: LibraryPhoto, range = false) {
    const next = new Set(selected);
    const start = photos.findIndex((item) => item.ref === anchor.current);
    const end = photos.findIndex((item) => item.ref === photo.ref);
    if (range && start >= 0)
      for (const item of photos.slice(Math.min(start, end), Math.max(start, end) + 1))
        next.add(item.ref);
    else {
      if (next.has(photo.ref)) next.delete(photo.ref);
      else next.add(photo.ref);
      anchor.current = photo.ref;
    }
    onSelection(next);
  }
  function reorder(ref: string, delta: number) {
    if (!album) return;
    void state.editAlbum(
      album.url,
      (current) => {
        const members = [...current.members];
        const index = members.indexOf(ref);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= members.length) return current;
        members.splice(index, 1);
        members.splice(target, 0, ref);
        return orderAlbum(current, members);
      },
      `Photo moved ${delta < 0 ? "earlier" : "later"}`,
    );
  }
  function key(event: KeyboardEvent<HTMLAnchorElement>, photo: LibraryPhoto) {
    const index = photos.findIndex((item) => item.ref === photo.ref);
    if (event.altKey && album && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      reorder(photo.ref, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      toggle(photo, event.shiftKey);
      return;
    }
    if (itemActions && event.key === "Enter") {
      event.preventDefault();
      toggle(photo, event.shiftKey);
      return;
    }
    if (event.key === "Escape") {
      onSelection(new Set());
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    const links = Array.from(
      root.current?.querySelectorAll<HTMLAnchorElement>("a[data-photo-ref]") ?? [],
    );
    const rect = event.currentTarget.getBoundingClientRect();
    let next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? photos.length - 1
          : index + (event.key === "ArrowLeft" ? -1 : 1);
    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
      const down = event.key === "ArrowDown";
      const candidates = links
        .map((link, i) => ({ i, rect: link.getBoundingClientRect() }))
        .filter((item) => (down ? item.rect.top > rect.top + 2 : item.rect.top < rect.top - 2));
      candidates.sort(
        (a, b) =>
          Math.abs(a.rect.top - rect.top) - Math.abs(b.rect.top - rect.top) ||
          Math.abs(a.rect.left - rect.left) - Math.abs(b.rect.left - rect.left),
      );
      next = candidates[0]?.i ?? index;
    }
    next = Math.max(0, Math.min(photos.length - 1, next));
    const target = photos[next];
    if (target) {
      if (event.shiftKey) {
        if (!anchor.current) anchor.current = photo.ref;
        toggle(target, true);
      }
      setFocused(target.ref);
      links[next]?.focus();
    }
  }
  return (
    <div className="pho-grid" ref={root}>
      {groups.map((group, groupIndex) => {
        const ratios = group.photos.map(
          (photo) =>
            getOrientationTransform(
              photo.exif.pixelWidth ?? 160,
              photo.exif.pixelHeight ?? 100,
              photo.exif.orientation ?? 1,
            ).aspectRatio,
        );
        const targetRowHeight = width < 500 ? 128 : 138;
        const layout = layoutJustifiedRows(ratios, width, {
          targetRowHeight,
          gap: 8,
        });
        return (
          <section
            className="pho-day"
            key={group.key}
            aria-label={grouped ? dayLabel(group.key) : "Collection photos"}
          >
            {grouped && (
              <header className="pho-day-header">
                {(groupIndex === 0 || groups[groupIndex - 1]?.monthLabel !== group.monthLabel) && (
                  <p>{group.monthLabel}</p>
                )}
                <h2>{dayLabel(group.key)}</h2>
                <span>
                  {group.photos.length} item{group.photos.length === 1 ? "" : "s"}
                </span>
              </header>
            )}
            <ul
              className="pho-tiles"
              data-actions={Boolean(itemActions)}
              style={itemActions ? undefined : { height: layout.height }}
            >
              {layout.rows.flatMap((row) =>
                row.items.map((item) => {
                  const photo = group.photos[item.index] as LibraryPhoto;
                  const index = photos.indexOf(photo);
                  const style: CSSProperties = {
                    left: item.left,
                    top: row.top,
                    width: item.width,
                    height: row.height,
                  };
                  return (
                    <li
                      key={photo.ref}
                      style={itemActions ? undefined : style}
                      className="pho-tile"
                      data-selected={selected.has(photo.ref)}
                      draggable={Boolean(album)}
                      onDragStart={(event) => {
                        drag.current = photo.ref;
                        event.dataTransfer.setData("text/plain", photo.ref);
                      }}
                      onDragOver={(event) => {
                        if (album && drag.current) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (!album || !drag.current) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const ref = drag.current;
                        drag.current = null;
                        if (ref === photo.ref) return;
                        void state.editAlbum(
                          album.url,
                          (current) => {
                            const members = current.members.filter((member) => member !== ref);
                            const position = members.indexOf(photo.ref);
                            members.splice(Math.max(0, position), 0, ref);
                            return orderAlbum(current, members);
                          },
                          "Photo order updated",
                        );
                      }}
                      onDragEnd={() => {
                        drag.current = null;
                      }}
                    >
                      <Link
                        href={`/photos/p/${encodeRef(photo.ref)}?from=${encodeURIComponent(from)}`}
                        data-photo-ref={photo.ref}
                        aria-label={`Open ${mediaLabel(photo)}`}
                        tabIndex={photo.ref === tabStop ? 0 : -1}
                        onFocus={() => setFocused(photo.ref)}
                        onKeyDown={(event) => key(event, photo)}
                        onPointerDown={(event) => {
                          if (event.pointerType === "touch") {
                            longPressed.current = false;
                            longPress.current = setTimeout(() => {
                              longPressed.current = true;
                              toggle(photo);
                            }, 500);
                          }
                        }}
                        onPointerUp={() => clearTimeout(longPress.current)}
                        onPointerCancel={() => clearTimeout(longPress.current)}
                        onPointerMove={() => clearTimeout(longPress.current)}
                        onClick={(event) => {
                          if (selecting || event.shiftKey || longPressed.current) {
                            event.preventDefault();
                            if (!longPressed.current) toggle(photo, event.shiftKey);
                            longPressed.current = false;
                          }
                        }}
                      >
                        <PhotoImage
                          url={
                            photo.thumbnailUrl ??
                            (photo.kind === "video" ? undefined : photo.contentUrl)
                          }
                          name={photo.name}
                        />
                        <VideoBadge photo={photo} />
                      </Link>
                      <label
                        className="pho-select"
                        data-visible={selecting || selected.has(photo.ref)}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${photo.name}`}
                          checked={selected.has(photo.ref)}
                          tabIndex={photo.ref === tabStop && selecting ? 0 : -1}
                          onChange={(event) =>
                            toggle(photo, (event.nativeEvent as MouseEvent).shiftKey)
                          }
                        />
                      </label>
                      {state.favourites.includes(photo.ref) && (
                        <span className="pho-favourite-mark" title="Favourite">
                          <Heart size={16} fill="currentColor" aria-label="Favourite" />
                        </span>
                      )}
                      {!itemActions && (
                        <span className="pho-tile-caption" data-source={photo.source}>
                          <span className="pho-tile-name">{photo.name}</span>
                          {photo.source === "google-photos" && <Badge>From Google Photos</Badge>}
                        </span>
                      )}
                      {album && (
                        <div className="pho-tile-menu">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton
                                label={`Actions for ${photo.name}`}
                                tabIndex={photo.ref === tabStop ? 0 : -1}
                                variant="secondary"
                              >
                                <MoreHorizontal size={18} />
                              </IconButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                disabled={index === 0}
                                onSelect={() => reorder(photo.ref, -1)}
                              >
                                Move earlier
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === photos.length - 1}
                                onSelect={() => reorder(photo.ref, 1)}
                              >
                                Move later
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  void state.editAlbum(
                                    album.url,
                                    (value) => coverAlbum(value, photo.ref),
                                    "Album cover updated",
                                  );
                                }}
                              >
                                Set as cover
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  void state.editAlbum(
                                    album.url,
                                    (value) => changeMembers(value, [photo.ref], false),
                                    "Photo removed from album",
                                  );
                                }}
                              >
                                Remove from album
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                      {itemActions && (
                        <div className="pho-card-body">
                          <p className="pho-card-name">{photo.name}</p>
                          <div className="pho-tile-actions">{itemActions(photo)}</div>
                        </div>
                      )}
                    </li>
                  );
                }),
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
