// AUTHORED-BY Claude Opus 5.5
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import {
  loadMusic,
  monthKey,
  NEAR_DUPLICATE_MS,
  nameKey,
  type Playback,
  readHistory,
} from "../model";

/**
 * The Spotify connector's history documents, mirroring `spotifyHistorySlug` and
 * `SPOTIFY_FILE_LIMITS.monthParts` in `@jeswr/pod-connectors/spotify/file-adapter`
 * (test/spotify-history.test.ts pins the agreement): `YYYY-MM.ttl`, then contiguous
 * `YYYY-MM-part-N.ttl` documents.
 */
export const SPOTIFY_HISTORY_PARTS = 64;

export function spotifyHistoryUrl(storage: string, month: string, part: number): string {
  const name = part === 1 ? `${month}.ttl` : `${month}-part-${part}.ttl`;
  return new URL(`integrations/spotify/music/history/${name}`, storage).href;
}

/**
 * Plays imported from Spotify history files for the given months. Best effort: a month
 * stops at its first missing part, and a failed read keeps the parts read before it, so
 * imported history can never hide the user's own.
 */
export async function loadSpotifyHistory(
  fetch: typeof globalThis.fetch,
  storage: string,
  dates: readonly Date[],
): Promise<Playback[]> {
  const scoped = createPodScopedFetch(new URL("integrations/spotify/music/", storage).href, {
    fetch,
  });
  const months = await Promise.all(
    [...new Set(dates.map(monthKey))].map(async (month) => {
      const plays: Playback[] = [];
      for (let part = 1; part <= SPOTIFY_HISTORY_PARTS; part++) {
        try {
          const doc = await loadMusic(scoped, spotifyHistoryUrl(storage, month, part));
          plays.push(...readHistory(doc.dataset));
        } catch (error) {
          if (!(error instanceof RdfFetchError) || error.status !== 404)
            console.warn("Couldn't read imported Spotify history", error);
          break;
        }
      }
      return plays;
    }),
  );
  return months.flat();
}

const MINUTE_MS = 60_000;
/** Basic exports truncate the end time to the minute; allow that plus Music's near-duplicate slack. */
export const IMPORTED_DUPLICATE_MS = MINUTE_MS + NEAR_DUPLICATE_MS;

const minuteAligned = (play: Playback) => play.startTime.getTime() % MINUTE_MS === 0;
const artistKeys = (artist: string | undefined) =>
  artist === undefined ? undefined : new Set(nameKey(artist).split(/\s*,\s*/u));

/**
 * One listen can reach Music several times: the live connector's recently-played document
 * and a history file import name the same play with different ids, and Basic
 * (minute-precision, names) and Extended (second-precision, track URI) exports of the
 * same plays hash differently. Imported plays with the same normalised title and a shared
 * artist, within {@link IMPORTED_DUPLICATE_MS}, are one listen when they come from
 * different sources or exactly one of them has Basic's minute precision (two minute-precise
 * plays from one export are real repeats). Precise plays win.
 * Native Music history is never passed here.
 */
export function dedupeImportedPlays(plays: readonly Playback[], liveDocument: string): Playback[] {
  const source = (play: Playback) => play.iri.split("#")[0] === liveDocument;
  const ordered = [...plays].sort(
    (a, b) =>
      Number(minuteAligned(a)) - Number(minuteAligned(b)) ||
      a.startTime.getTime() - b.startTime.getTime() ||
      a.iri.localeCompare(b.iri),
  );
  const kept: Playback[] = [];
  const byTitle = new Map<string, Playback[]>();
  for (const play of ordered) {
    if (play.title === undefined) {
      kept.push(play);
      continue;
    }
    const key = nameKey(play.title);
    const artists = artistKeys(play.artist);
    const same = byTitle.get(key) ?? [];
    const duplicate = same.some((other) => {
      const others = artistKeys(other.artist);
      return (
        (artists === undefined ||
          others === undefined ||
          [...artists].some((artist) => others.has(artist))) &&
        Math.abs(other.startTime.getTime() - play.startTime.getTime()) <= IMPORTED_DUPLICATE_MS &&
        (source(other) !== source(play) || minuteAligned(other) !== minuteAligned(play))
      );
    });
    if (duplicate) continue;
    same.push(play);
    byTitle.set(key, same);
    kept.push(play);
  }
  return kept;
}
