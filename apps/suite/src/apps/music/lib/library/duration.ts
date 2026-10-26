// AUTHORED-BY Codex GPT-6.1-Sol
import type { LibraryTrack } from "./types";
import { duration, MusicLibraryError, validateTracks } from "./validation";

/** Unknown in any track means an unknown total, never an understated subtotal. */
export function totalDuration(tracks: readonly LibraryTrack[]): number | undefined {
  validateTracks(tracks);
  let total = 0;
  let unknown = false;
  for (const track of tracks) {
    if (track.durationSeconds === undefined) unknown = true;
    else {
      total += track.durationSeconds;
      if (!Number.isSafeInteger(total)) throw new MusicLibraryError("duration-overflow");
    }
  }
  return unknown ? undefined : total;
}

/** Integer seconds to m:ss or h:mm:ss; unknown is an em dash. No rounding. */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  duration(seconds);
  const tail = String(seconds % 60).padStart(2, "0");
  const minutes = Math.floor(seconds / 60);
  if (seconds < 3600) return `${minutes}:${tail}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${tail}`;
}
