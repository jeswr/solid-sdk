// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
} from "@jeswr/suite-ui";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Heart,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { type MusicTrack, sortTracks } from "../lib/data/library";
import type { MusicPlaylist } from "../lib/data/playlists";
import { formatDuration } from "../lib/library";
import { useMusic } from "../state/music-context";
import { AddToPlaylist } from "./playlist-dialogs";

export const albumHref = (id: string) => `/music/a/${encodeRef(id)}`;
export const artistHref = (id: string) => `/music/ar/${encodeRef(id)}`;
export function Like({ track }: { track: MusicTrack }) {
  const music = useMusic();
  return (
    <IconButton
      label={`${track.loved ? "Unlike" : "Like"} ${track.title}`}
      variant="ghost"
      aria-pressed={track.loved}
      onClick={() => music.like(track.id, !track.loved)}
    >
      <Heart size={17} aria-hidden="true" fill={track.loved ? "currentColor" : "none"} />
    </IconButton>
  );
}
function safeSource(source: string | undefined): string | undefined {
  try {
    if (!source) return;
    const url = new URL(source);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
      return url.href;
  } catch {
    return;
  }
}
export function TrackMenu({
  track,
  playlist,
  position,
  onMove,
  onRemove,
}: {
  track: MusicTrack;
  playlist?: MusicPlaylist;
  position?: number;
  onMove?: (from: number, to: number) => void;
  onRemove?: (position: number) => void;
}) {
  const source = safeSource(track.sourceUrl);
  const [adding, setAdding] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const fromMenu = useRef(false);
  const reordering = useRef(false);
  return (
    <div className="mus-row-actions">
      <AddToPlaylist
        trackId={track.id}
        open={adding}
        onOpenChange={(open) => {
          if (open) fromMenu.current = false;
          setAdding(open);
        }}
        returnFocus={() => (fromMenu.current ? menuTrigger.current : undefined)}
      >
        <IconButton label={`Add ${track.title} to playlist`} variant="ghost">
          <Plus size={16} aria-hidden="true" />
        </IconButton>
      </AddToPlaylist>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) reordering.current = false;
        }}
      >
        <DropdownMenuTrigger asChild>
          <IconButton ref={menuTrigger} label={`More actions for ${track.title}`} variant="ghost">
            <MoreHorizontal size={18} aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (reordering.current) event.preventDefault();
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              fromMenu.current = true;
              setTimeout(() => setAdding(true), 0);
            }}
          >
            Add to playlist…
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={albumHref(track.albumId)}>Go to album</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={artistHref(track.artistId)}>Go to artist</Link>
          </DropdownMenuItem>
          {source && (
            <DropdownMenuItem asChild>
              <a href={source} target="_blank" rel="noopener noreferrer">
                Open in{" "}
                {new URL(source).hostname === "open.spotify.com"
                  ? "Spotify"
                  : new URL(source).hostname}
              </a>
            </DropdownMenuItem>
          )}
          {playlist && position !== undefined && (
            <>
              <DropdownMenuItem
                disabled={position === 0}
                onSelect={() => {
                  reordering.current = true;
                  onMove?.(position, position - 1);
                }}
              >
                <ArrowUp size={16} aria-hidden="true" />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={position === playlist.tracks.length - 1}
                onSelect={() => {
                  reordering.current = true;
                  onMove?.(position, position + 1);
                }}
              >
                <ArrowDown size={16} aria-hidden="true" />
                Move down
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  reordering.current = true;
                  onRemove?.(position);
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
                Remove from playlist
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
export function TrackName({ track }: { track: MusicTrack }) {
  return (
    <span className="mus-track-name">
      <strong>{track.title}</strong>
      <Link href={artistHref(track.artistId)}>{track.artist}</Link>
    </span>
  );
}
export function TrackList({
  tracks,
  label = "Tracks",
  sortable = true,
}: {
  tracks: MusicTrack[];
  label?: string;
  sortable?: boolean;
}) {
  const router = useRouter();
  const music = useMusic();
  const [sort, setSort] = useState<"title" | "artist" | "albumTitle" | "added">("title");
  const current = new Map(music.snapshot?.library.tracks.map((track) => [track.id, track]));
  const visibleTracks = tracks.map((track) => current.get(track.id) ?? track);
  const items = sortable ? sortTracks(visibleTracks, sort) : visibleTracks;
  if (!tracks.length)
    return (
      <EmptyState
        title="No songs here yet"
        body="Explore your library or import the Spotify sample from Tracks."
        primaryAction={
          <Button asChild>
            <Link href="/music/tracks">Browse tracks</Link>
          </Button>
        }
      />
    );
  return (
    <div className="mus-track-list">
      {sortable && (
        <div className="mus-sort">
          <label>
            Sort by{" "}
            <select
              aria-label="Sort tracks"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="title">Title</option>
              <option value="artist">Artist</option>
              <option value="albumTitle">Album</option>
              <option value="added">Date added</option>
            </select>
          </label>
          <span>{tracks.length} songs</span>
        </div>
      )}
      <div className="mus-desktop-table">
        <DataTable
          key={sort}
          items={items}
          label={label}
          getKey={(track) => track.id}
          getLabel={(track) => track.title}
          onOpen={(track) => router.push(albumHref(track.albumId))}
          height={520}
          columns={[
            {
              id: "number",
              header: "#",
              accessor: (track) => items.indexOf(track) + 1,
              size: 42,
              minSize: 36,
              maxSize: 60,
              sortable: false,
            },
            {
              id: "title",
              header: "Title",
              accessor: (track) => track.title,
              render: (track) => <TrackName track={track} />,
              size: 240,
              minSize: 160,
            },
            {
              id: "album",
              header: "Album",
              accessor: (track) => track.albumTitle,
              render: (track) => (
                <Link className="mus-album-link" href={albumHref(track.albumId)}>
                  {track.albumTitle}
                </Link>
              ),
              size: 190,
              minSize: 130,
            },
            {
              id: "duration",
              header: "Duration",
              accessor: (track) => track.durationSeconds ?? 0,
              render: (track) => (
                <span className="mus-number">{formatDuration(track.durationSeconds)}</span>
              ),
              size: 90,
              minSize: 75,
            },
            {
              id: "liked",
              header: "Liked",
              accessor: (track) => Number(track.loved),
              render: (track) => <Like track={track} />,
              size: 65,
              minSize: 60,
              sortable: false,
            },
            {
              id: "actions",
              header: "Actions",
              accessor: () => "",
              render: (track) => <TrackMenu track={track} />,
              size: 90,
              minSize: 85,
              sortable: false,
            },
          ]}
        />
      </div>
      <ul className="mus-mobile-tracks" aria-label={label}>
        {items.map((track, index) => (
          <li key={track.id}>
            <span className="mus-number mus-index">{index + 1}</span>
            <TrackName track={track} />
            <span className="mus-number mus-duration">{formatDuration(track.durationSeconds)}</span>
            <Like track={track} />
            <TrackMenu track={track} />
          </li>
        ))}
      </ul>
    </div>
  );
}
export function PlaylistTracks({
  playlist,
  emptyFocus,
}: {
  playlist: MusicPlaylist;
  emptyFocus?: RefObject<HTMLButtonElement | null>;
}) {
  const music = useMusic();
  const dragged = useRef<number | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const [focusPosition, setFocusPosition] = useState<number>();
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (focusPosition === undefined) return;
    const frame = requestAnimationFrame(() => {
      const target =
        list.current?.querySelector<HTMLButtonElement>(`[data-mus-handle="${focusPosition}"]`) ??
        emptyFocus?.current;
      target?.focus();
      setFocusPosition(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPosition, emptyFocus]);
  const tracks = new Map(music.snapshot?.library.tracks.map((track) => [track.id, track]));
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= playlist.tracks.length) return;
    music.edit(playlist, { kind: "move", from, to });
    setAnnouncement(`Moved song from position ${from + 1} to ${to + 1}`);
    setFocusPosition(to);
  }
  function remove(position: number) {
    music.edit(playlist, { kind: "remove", position });
    setAnnouncement(`Removed song at position ${position + 1}`);
    setFocusPosition(Math.max(0, Math.min(position, playlist.tracks.length - 2)));
  }
  // Keep the focus owner mounted when the final occurrence disappears.
  if (!playlist.tracks.length)
    return (
      <p role="status" className="mus-sr-only">
        {announcement}
      </p>
    );
  return (
    <>
      <p className="mus-hint">Drag the handle to reorder, or focus it and press Alt + ↑ / ↓.</p>
      <p role="status" className="mus-sr-only">
        {announcement}
      </p>
      <ol ref={list} className="mus-playlist-tracks" aria-label="Playlist songs">
        {playlist.tracks.map((id, position) => {
          const track = tracks.get(id);
          // Position is the identity of a playlist occurrence; repeats remain separate.
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: Position identifies a repeated playlist occurrence.
              key={`${position}-${id}`}
              className="mus-playlist-row"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged.current !== undefined) move(dragged.current, position);
                dragged.current = undefined;
              }}
            >
              <button
                type="button"
                className="mus-drag"
                data-mus-handle={position}
                draggable
                onDragStart={(e) => {
                  dragged.current = position;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(position));
                }}
                onDragEnd={() => {
                  dragged.current = undefined;
                }}
                aria-label={`Reorder ${track?.title ?? "Unavailable song"}, position ${position + 1}`}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    move(position, position + (e.key === "ArrowUp" ? -1 : 1));
                  }
                }}
              >
                <GripVertical size={18} aria-hidden="true" />
                <span className="mus-number">{position + 1}</span>
              </button>
              {track ? (
                <>
                  <TrackName track={track} />
                  <Link className="mus-playlist-album" href={albumHref(track.albumId)}>
                    {track.albumTitle}
                  </Link>
                  <span className="mus-number mus-duration">
                    {formatDuration(track.durationSeconds)}
                  </span>
                  <Like track={track} />
                  <TrackMenu
                    track={track}
                    playlist={playlist}
                    position={position}
                    onMove={move}
                    onRemove={remove}
                  />
                </>
              ) : (
                <>
                  <span>Unavailable song</span>
                  <Button variant="ghost" onClick={() => remove(position)}>
                    Remove
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
