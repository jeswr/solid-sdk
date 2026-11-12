// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5 (best-effort, de-duplicated Spotify imports)
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import {
  type ArtistPeriod,
  appendPlayback,
  computeTopArtists,
  loadMusic,
  monthKey,
  type Playback,
  periodStart,
  readHistory,
  loadHistory as readMonths,
  recentlyPlayed,
} from "../model";
import { type Library, musicRoot } from "./library";
import { dedupeImportedPlays, loadSpotifyHistory } from "./spotify-history";

export { computeTopArtists, recentlyPlayed };
export async function loadHistory(
  fetch: typeof globalThis.fetch,
  storage: string,
  now: Date,
  months = 12,
  offset = 0,
): Promise<Playback[]> {
  const dates = Array.from(
    { length: months },
    (_, index) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index - offset, 1)),
  );
  // Imported file history is best effort: it never rejects the user's own history.
  const [history, imported] = await Promise.all([
    readMonths(fetch, musicRoot(storage), dates),
    loadSpotifyHistory(fetch, storage, dates),
  ]);
  const selected = new Set(dates.map(monthKey));
  const liveHistory = new URL("integrations/spotify/music/recently-played.ttl", storage).href;
  try {
    const doc = await loadMusic(createPodScopedFetch(storage, { fetch }), liveHistory);
    imported.push(
      ...readHistory(doc.dataset).filter((play) => selected.has(monthKey(play.startTime))),
    );
  } catch (error) {
    if (!(error instanceof RdfFetchError) || error.status !== 404) throw error;
  }
  history.push(...dedupeImportedPlays(imported, liveHistory));
  return history.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
}
export async function recordPlay(
  fetch: typeof globalThis.fetch,
  storage: string,
  play: Playback,
): Promise<void> {
  await appendPlayback(fetch, musicRoot(storage), play);
}
export function mostPlayedTracks(
  library: Library,
  history: readonly Playback[],
  period: ArtistPeriod,
  now: Date,
) {
  const from = periodStart(period, now).getTime();
  const counts = new Map<string, number>();
  for (const play of new Map(history.map((play) => [play.iri, play])).values()) {
    if (play.startTime.getTime() >= from && play.startTime <= now)
      counts.set(play.trackIri, (counts.get(play.trackIri) ?? 0) + 1);
  }
  return library.tracks
    .filter((track) => counts.has(track.id))
    .map((track) => ({ track, plays: counts.get(track.id) as number }))
    .sort((a, b) => b.plays - a.plays || a.track.title.localeCompare(b.track.title));
}
