// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  IconButton,
  Input,
  Label,
  Textarea,
} from "@jeswr/suite-ui";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, type Ref, useId, useState } from "react";
import type { MusicPlaylist } from "../lib/data/playlists";
import { playlistHref } from "../lib/navigation";
import { useMusic } from "../state/music-context";

export function CreatePlaylist({ compact = false }: { compact?: boolean }) {
  const music = useMusic();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        {compact ? (
          <IconButton label="New playlist" variant="ghost" disabled={!music.snapshot}>
            <Plus size={18} aria-hidden="true" />
          </IconButton>
        ) : (
          <Button disabled={!music.snapshot}>
            <Plus size={16} aria-hidden="true" />
            New playlist
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="mus-dialog">
        <DialogHeader>
          <DialogTitle>New playlist</DialogTitle>
          <DialogDescription>
            Give your collection a name. You can add songs next.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) {
              setError("Enter a playlist name.");
              return;
            }
            setBusy(true);
            const iri = await music.create(name, description);
            setBusy(false);
            if (iri) {
              setOpen(false);
              setName("");
              setDescription("");
              router.push(playlistHref(iri));
            } else setError("Couldn’t create your playlist. Try again.");
          }}
          className="mus-form"
        >
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            autoComplete="off"
          />
          <Label htmlFor={`${id}-description`}>Description</Label>
          <Textarea
            id={`${id}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
          {error && (
            <p id={`${id}-error`} role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create playlist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditPlaylistDetails({ playlist }: { playlist: MusicPlaylist }) {
  const music = useMusic();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description);
  const [opening, setOpening] = useState(playlist);
  const [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setOpening(playlist);
          setName(playlist.name);
          setDescription(playlist.description);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Edit details</Button>
      </DialogTrigger>
      <DialogContent className="mus-dialog">
        <DialogHeader>
          <DialogTitle>Edit playlist details</DialogTitle>
          <DialogDescription>Update the name and description of your collection.</DialogDescription>
        </DialogHeader>
        <form
          className="mus-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) {
              setError("Enter a playlist name.");
              return;
            }
            music.edit(opening, {
              kind: "rename",
              ...(name.trim() !== opening.name ? { name } : {}),
              ...(description.trim() !== opening.description ? { description } : {}),
            });
            setOpen(false);
          }}
        >
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <Label htmlFor={`${id}-description`}>Description</Label>
          <Textarea
            id={`${id}-description`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
          />
          {error && (
            <p role="alert" id={`${id}-error`}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save details</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddSongs({
  playlist,
  triggerRef,
}: {
  playlist: MusicPlaylist;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const music = useMusic();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const pickerId = useId();
  const tracks =
    music.snapshot?.library.tracks.filter((track) =>
      `${track.title} ${track.artist} ${track.albumTitle}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSelected([]);
          setQuery("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button ref={triggerRef}>
          <Plus size={16} aria-hidden="true" />
          Add songs
        </Button>
      </DialogTrigger>
      <DialogContent className="mus-dialog">
        <DialogHeader>
          <DialogTitle>Add songs</DialogTitle>
          <DialogDescription>
            Choose songs for {playlist.name}. Songs can appear more than once.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label="Find songs"
          placeholder="Search your library"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mus-song-picker">
          <ul>
            {tracks.map((track) => (
              <li key={track.id}>
                <label htmlFor={`${pickerId}-${encodeURIComponent(track.id)}`}>
                  <Checkbox
                    id={`${pickerId}-${encodeURIComponent(track.id)}`}
                    checked={selected.includes(track.id)}
                    onCheckedChange={(checked) =>
                      setSelected((ids) =>
                        checked ? [...ids, track.id] : ids.filter((id) => id !== track.id),
                      )
                    }
                  />
                  <span>
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {tracks.length === 0 && (
            <EmptyState variant="no-results" query={query} onClearFilters={() => setQuery("")} />
          )}
        </div>
        <p role="status">{selected.length} songs selected</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => {
              music.edit(playlist, { kind: "add", tracks: selected });
              setOpen(false);
              setSelected([]);
              setQuery("");
            }}
          >
            Add selected songs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function AddToPlaylist({
  trackId,
  children,
  open: controlledOpen,
  onOpenChange,
  returnFocus,
}: {
  trackId: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const music = useMusic();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="mus-dialog"
        onCloseAutoFocus={(event) => {
          const target = returnFocus?.();
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Add to playlist</DialogTitle>
          <DialogDescription>Choose a playlist for this song.</DialogDescription>
        </DialogHeader>
        <div className="mus-playlist-picker">
          {music.snapshot?.playlists.map((playlist) => (
            <Button
              variant="outline"
              key={playlist.id}
              onClick={() => {
                music.edit(playlist, { kind: "add", tracks: [trackId] });
                setOpen(false);
              }}
            >
              {playlist.name}
              <span className="mus-muted">{playlist.tracks.length} songs</span>
            </Button>
          ))}
        </div>
        {!music.snapshot?.playlists.length && (
          <EmptyState
            title="Create a playlist first"
            body="Make a collection for your favourite songs."
            primaryAction={<CreatePlaylist />}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
