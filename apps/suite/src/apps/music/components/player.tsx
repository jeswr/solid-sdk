// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  IconButton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Slider,
} from "@jeswr/suite-ui";
import {
  ArrowDown,
  ArrowUp,
  Expand,
  GripVertical,
  ListMusic,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { MusicTrack } from "../lib/data/library";
import { currentLineAt } from "../lib/lyrics";
import { albumHref, artistHref } from "../lib/navigation";
import { usePlayer } from "../state/player-context";
import { Artwork } from "./artwork";

function time(value: number) {
  const seconds = Math.floor(Math.max(0, value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function PlayTrack({ track }: { track: MusicTrack }) {
  const player = usePlayer();
  if (!track.contentUrl) return null;
  const active = player.current?.id === track.id && player.active;
  return (
    <IconButton
      variant="ghost"
      label={`${active ? "Pause" : "Play"} ${track.title}`}
      onClick={() => {
        if (player.current?.id === track.id) player.toggle();
        else player.playTracks([track]);
      }}
    >
      {active ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
    </IconButton>
  );
}
export function PlayCollection({
  tracks,
  total = tracks.length,
}: {
  tracks: readonly MusicTrack[];
  total?: number;
}) {
  const player = usePlayer();
  const playable = tracks.filter((track) => track.contentUrl);
  return (
    <div className="mus-collection-play">
      <Button disabled={!playable.length} onClick={() => player.playTracks(playable)}>
        <Play size={16} aria-hidden="true" />
        Play
      </Button>
      <Button
        variant="outline"
        disabled={!playable.length}
        onClick={() => player.playTracks(playable, true)}
      >
        <Shuffle size={16} aria-hidden="true" />
        Shuffle
      </Button>
      {playable.length < total && (
        <span className="mus-muted">
          {total - playable.length} songs need an audio file to play here.
        </span>
      )}
    </div>
  );
}
function PlayerIdentity() {
  const { current } = usePlayer();
  return current ? (
    <div className="mus-player-identity">
      <Artwork name={current.albumTitle} image={current.imageUrl} />
      <div className="mus-player-credit">
        <Link className="mus-player-title" href={albumHref(current.albumId)}>
          {current.title}
        </Link>
        <Link className="mus-player-artist" href={artistHref(current.artistId)}>
          {current.artist}
        </Link>
      </div>
    </div>
  ) : (
    <span className="mus-muted">Choose a song from Your files</span>
  );
}
function Transport() {
  const player = usePlayer();
  return (
    <div className="mus-transport">
      <IconButton
        label="Previous song"
        variant="ghost"
        disabled={!player.queue.entries.length}
        onClick={player.previous}
      >
        <SkipBack size={19} aria-hidden="true" />
      </IconButton>
      <IconButton
        label={player.active ? "Pause" : "Play"}
        disabled={!player.queue.entries.length}
        onClick={player.toggle}
      >
        {player.active ? (
          <Pause size={21} aria-hidden="true" />
        ) : (
          <Play size={21} aria-hidden="true" />
        )}
      </IconButton>
      <IconButton
        label="Next song"
        variant="ghost"
        disabled={!player.queue.entries.length}
        onClick={player.next}
      >
        <SkipForward size={19} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
function Queue({ trigger = true }: { trigger?: boolean }) {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const dragged = useRef<string | undefined>(undefined);
  const list = useRef<HTMLOListElement>(null);
  const clear = useRef<HTMLButtonElement>(null);
  const [announcement, setAnnouncement] = useState("");
  function focus(id: string | undefined) {
    requestAnimationFrame(() => {
      (
        Array.from(
          list.current?.querySelectorAll<HTMLButtonElement>("[data-queue-handle]") ?? [],
        ).find((button) => button.dataset.queueHandle === id) ?? clear.current
      )?.focus();
    });
  }
  function move(id: string, index: number) {
    player.dispatch({ type: "move", id, toIndex: index });
    setAnnouncement(`Moved song to position ${index + 1}`);
    focus(id);
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ? (
          <IconButton label="Open queue" variant="ghost">
            <ListMusic size={20} aria-hidden="true" />
          </IconButton>
        ) : (
          <Button variant="outline">Queue</Button>
        )}
      </SheetTrigger>
      <SheetContent className="mus-player-sheet">
        <SheetHeader>
          <SheetTitle>Play queue</SheetTitle>
          <SheetDescription>
            Drag to reorder, use Move up and Move down, or Alt + arrow keys on a handle.
          </SheetDescription>
        </SheetHeader>
        <p role="status" className="mus-sr-only">
          {announcement}
        </p>
        <Button
          ref={clear}
          variant="outline"
          onClick={() => {
            if (!player.queue.entries.length) return;
            player.clear();
            setAnnouncement("Queue cleared");
          }}
        >
          Clear queue
        </Button>
        {player.queue.entries.length ? (
          <ol className="mus-queue" ref={list}>
            {player.queue.entries.map((entry, i) => (
              <li
                key={entry.id}
                aria-current={entry.id === player.queue.currentId ? "true" : undefined}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged.current) move(dragged.current, i);
                  dragged.current = undefined;
                }}
              >
                <IconButton
                  data-queue-handle={entry.id}
                  label={`Reorder ${entry.track.title}, position ${i + 1}`}
                  variant="ghost"
                  draggable
                  onDragStart={(event) => {
                    dragged.current = entry.id;
                    event.dataTransfer.setData("text/plain", entry.id);
                  }}
                  onDragEnd={() => {
                    dragged.current = undefined;
                  }}
                  onKeyDown={(event) => {
                    const to = i + (event.key === "ArrowUp" ? -1 : 1);
                    if (
                      event.altKey &&
                      ["ArrowUp", "ArrowDown"].includes(event.key) &&
                      to >= 0 &&
                      to < player.queue.entries.length
                    ) {
                      event.preventDefault();
                      move(entry.id, to);
                    }
                  }}
                >
                  <GripVertical size={16} aria-hidden="true" />
                </IconButton>
                <span className="mus-queue-title">
                  {entry.track.title}
                  <small>{entry.track.artist}</small>
                </span>
                <IconButton
                  label={`Move ${entry.track.title} up`}
                  variant="ghost"
                  disabled={i === 0}
                  onClick={() => move(entry.id, i - 1)}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Move ${entry.track.title} down`}
                  variant="ghost"
                  disabled={i === player.queue.entries.length - 1}
                  onClick={() => move(entry.id, i + 1)}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Remove ${entry.track.title} from queue`}
                  variant="ghost"
                  onClick={() => {
                    player.dispatch({ type: "remove", id: entry.id });
                    setAnnouncement(`Removed ${entry.track.title}`);
                    focus(player.queue.entries[i + 1]?.id ?? player.queue.entries[i - 1]?.id);
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </IconButton>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mus-muted">Your queue is empty. Play a song or add one from its menu.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
function Lyrics() {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const current = player.lyrics && currentLineAt(player.lyrics, player.audio.elapsed * 1000);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <IconButton label="Lyrics" variant="ghost" disabled={!player.current?.lyricsUrl}>
          <Mic2 size={19} aria-hidden="true" />
        </IconButton>
      </SheetTrigger>
      <SheetContent className="mus-player-sheet">
        <SheetHeader>
          <SheetTitle>Lyrics</SheetTitle>
          <SheetDescription>{player.current?.title ?? "No song selected"}</SheetDescription>
        </SheetHeader>
        {player.lyricsError ? (
          <p role="alert">{player.lyricsError}</p>
        ) : !player.lyrics ? (
          <p role="status">Loading lyrics…</p>
        ) : player.lyrics.kind === "plain" ? (
          <p className="mus-lyrics-plain">{player.lyrics.text}</p>
        ) : (
          <ol className="mus-lyrics">
            {player.lyrics.lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: LRC cues are immutable and can share timestamps and text.
              <li key={`${line.timeMs}-${i}`} aria-current={line === current ? "true" : undefined}>
                {line.text || "♪"}
              </li>
            ))}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  );
}
function FullControls() {
  const player = usePlayer();
  const duration = player.audio.duration || player.current?.durationSeconds || 0;
  const repeat = player.queue.repeat;
  return (
    <div className="mus-full-controls">
      <div className="mus-player-middle">
        <Transport />
        <div className="mus-seek">
          <span>{time(player.audio.elapsed)}</span>
          <Slider
            aria-label="Seek"
            value={[Math.min(player.audio.elapsed, duration)]}
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            disabled={!duration || player.audio.loading}
            onValueChange={([seconds]) => player.seek(seconds ?? 0)}
          />
          <span>−{time(duration - player.audio.elapsed)}</span>
        </div>
      </div>
      <div className="mus-player-options">
        <IconButton
          label="Shuffle"
          variant="ghost"
          aria-pressed={player.queue.unshuffledOrder !== null}
          onClick={() =>
            player.dispatch({
              type: "shuffle",
              enabled: player.queue.unshuffledOrder === null,
              seed: Math.floor(Math.random() * 0x100000000),
            })
          }
        >
          <Shuffle size={18} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={`Repeat: ${repeat}`}
          variant="ghost"
          aria-pressed={repeat !== "off"}
          onClick={() =>
            player.dispatch({
              type: "repeat",
              mode: repeat === "off" ? "all" : repeat === "all" ? "one" : "off",
            })
          }
        >
          {repeat === "one" ? (
            <Repeat1 size={18} aria-hidden="true" />
          ) : (
            <Repeat size={18} aria-hidden="true" />
          )}
        </IconButton>
        <IconButton
          label={player.muted ? "Unmute" : "Mute"}
          variant="ghost"
          onClick={() => player.setMuted(!player.muted)}
        >
          {player.muted ? (
            <VolumeX size={18} aria-hidden="true" />
          ) : (
            <Volume2 size={18} aria-hidden="true" />
          )}
        </IconButton>
        <div className="mus-volume">
          <Slider
            aria-label="Volume"
            value={[player.muted ? 0 : player.volume]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={([value]) => {
              player.setVolume(value ?? 0);
              player.setMuted(false);
            }}
          />
        </div>
        <Lyrics />
        <Queue />
      </div>
    </div>
  );
}
export function MusicPlayer() {
  const player = usePlayer();
  return (
    <section className="mus-player" aria-label="Music player">
      <p role="status" className="mus-sr-only">
        {player.current ? `Now playing: ${player.current.title}, ${player.current.artist}` : ""}
      </p>
      <PlayerIdentity />
      <div className="mus-player-desktop">
        <FullControls />
      </div>
      <div className="mus-mini-controls">
        <IconButton
          label={player.active ? "Pause" : "Play"}
          disabled={!player.queue.entries.length}
          onClick={player.toggle}
        >
          {player.active ? (
            <Pause size={19} aria-hidden="true" />
          ) : (
            <Play size={19} aria-hidden="true" />
          )}
        </IconButton>
        <IconButton
          label="Next song"
          variant="ghost"
          disabled={!player.queue.entries.length}
          onClick={player.next}
        >
          <SkipForward size={19} aria-hidden="true" />
        </IconButton>
        <Sheet>
          <SheetTrigger asChild>
            <IconButton label="Expand player" variant="ghost">
              <Expand size={18} aria-hidden="true" />
            </IconButton>
          </SheetTrigger>
          <SheetContent side="bottom" className="mus-expanded-player" data-music-player="">
            <SheetHeader>
              <SheetTitle>Now playing</SheetTitle>
              <SheetDescription>Music from your pod</SheetDescription>
            </SheetHeader>
            <PlayerIdentity />
            <FullControls />
          </SheetContent>
        </Sheet>
      </div>
      {player.audio.loading && (
        <p className="mus-player-message" role="status">
          Loading audio…
        </p>
      )}
      {player.audio.error && (
        <p className="mus-player-message" role="alert">
          {player.audio.error}{" "}
          <Button variant="outline" onClick={player.toggle}>
            Retry playback
          </Button>
        </p>
      )}
    </section>
  );
}
