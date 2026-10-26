// AUTHORED-BY Codex GPT-6.1-Sol
import type { LibraryTrack, PlayEvent, PlayWindow, TrackPlayStats } from "./types";
import {
  exactCompare,
  instant,
  MusicLibraryError,
  record,
  text,
  validateTracks,
} from "./validation";

/** Validate the entire log before filtering; dangling or duplicate events never disappear. */
function aggregate(
  tracks: readonly LibraryTrack[],
  log: readonly PlayEvent[],
  window: PlayWindow,
): TrackPlayStats[] {
  validateTracks(tracks);
  record(window, "invalid-window");
  if (window.from !== undefined) instant(window.from, "invalid-window");
  if (window.to !== undefined) instant(window.to, "invalid-window");
  if (window.from !== undefined && window.to !== undefined && window.from > window.to) {
    throw new MusicLibraryError("invalid-window");
  }
  if (!Array.isArray(log)) throw new MusicLibraryError("invalid-play");
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const ids = new Set<string>();
  const stats = new Map<string, TrackPlayStats>();
  for (const event of log) {
    record(event, "invalid-play");
    text(event.id, "invalid-play");
    text(event.trackId, "invalid-play");
    instant(event.playedAt, "invalid-play");
    if (ids.has(event.id)) throw new MusicLibraryError("duplicate-play");
    ids.add(event.id);
    const track = byId.get(event.trackId);
    if (!track) throw new MusicLibraryError("unknown-track");
    if (
      (window.from !== undefined && event.playedAt < window.from) ||
      (window.to !== undefined && event.playedAt >= window.to)
    )
      continue;
    const previous = stats.get(track.id);
    stats.set(track.id, {
      track,
      playCount: (previous?.playCount ?? 0) + 1,
      lastPlayedAt: Math.max(previous?.lastPlayedAt ?? -Infinity, event.playedAt),
    });
  }
  return [...stats.values()];
}

function compareRecent(a: TrackPlayStats, b: TrackPlayStats): number {
  return b.lastPlayedAt - a.lastPlayedAt || exactCompare(a.track.id, b.track.id);
}

/** One row per played track, latest first. Does not mutate tracks or log. */
export function recentlyPlayed(
  tracks: readonly LibraryTrack[],
  log: readonly PlayEvent[],
  window: PlayWindow = {},
): TrackPlayStats[] {
  return aggregate(tracks, log, window).sort(compareRecent);
}

/** One row per played track, count descending, then latest play, then exact track ID. */
export function mostPlayed(
  tracks: readonly LibraryTrack[],
  log: readonly PlayEvent[],
  window: PlayWindow = {},
): TrackPlayStats[] {
  return aggregate(tracks, log, window).sort(
    (a, b) => b.playCount - a.playCount || compareRecent(a, b),
  );
}
