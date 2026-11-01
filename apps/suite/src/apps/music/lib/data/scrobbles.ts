// AUTHORED-BY Claude Opus 5.5
import type { LibraryTrack } from "../library";
import { appendPlaybacks, historyShard, type ImportedPlayback } from "../model";
import {
  importScrobbles,
  type Listen,
  type ListenSource,
  ScrobbleError,
  type ScrobbleWarning,
} from "../scrobbles";
import { musicRoot } from "./library";

/** Plays imported from a scrobble service carry it as their agent (shown as a badge). */
export const SCROBBLE_AGENTS: Record<ListenSource, string> = {
  lastfm: "https://www.last.fm/",
  listenbrainz: "https://listenbrainz.org/",
};

/** Case, width and spacing-insensitive name used to match listens to library songs. */
export function matchName(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en").trim().replace(/\s+/gu, " ");
}
const songKey = (artist: string, title: string) => `${matchName(artist)}\u0000${matchName(title)}`;

/** 64-bit FNV-1a (two 32-bit lanes) for stable, idempotent fragment names. */
export function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    a = Math.imul(a ^ unit, 0x01000193) >>> 0;
    b = Math.imul(b ^ unit, 0x01000193) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export interface ScrobbleFile {
  name: string;
  text: string;
}
export interface ScrobblePlan {
  plays: ImportedPlayback[];
  /** Listens matched to a song in the library. */
  matched: number;
  /** Listens saved with just the song and artist name. */
  unmatched: number;
  warnings: readonly ScrobbleWarning[];
  first?: Date | undefined;
  last?: Date | undefined;
}

const startsWithArray = (text: string) => text.replace(/^﻿/u, "").trimStart().startsWith("[");

/**
 * Reads a Last.fm CSV export and/or ListenBrainz exports (`.json` or `.jsonl`).
 * Several JSON Lines files (ListenBrainz's monthly files) are read together.
 */
export function readScrobbleFiles(files: readonly ScrobbleFile[], now: Date) {
  const csv = files.filter((file) => /\.csv$/iu.test(file.name));
  const json = files.filter((file) => /\.jsonl?$/iu.test(file.name));
  if (csv.length + json.length !== files.length)
    throw new RangeError("Choose Last.fm .csv files or ListenBrainz .json or .jsonl files");
  if (csv.length > 1) throw new RangeError("Choose one Last.fm file at a time");
  if (json.length > 1 && json.some((file) => startsWithArray(file.text)))
    throw new RangeError("Choose one ListenBrainz .json file at a time");
  return importScrobbles(
    {
      ...(csv[0] ? { lastFm: csv[0].text } : {}),
      ...(json.length ? { listenBrainz: json.map((file) => file.text).join("\n") } : {}),
    },
    { now },
  );
}

/** Matches listens to library songs and gives every play a stable IRI in its month shard. */
export function planScrobbleImport(
  listens: readonly Listen[],
  warnings: readonly ScrobbleWarning[],
  tracks: readonly LibraryTrack[],
  storage: string,
): ScrobblePlan {
  const base = musicRoot(storage);
  const library = new Map<string, string>();
  for (const track of [...tracks].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = songKey(track.artist, track.title);
    if (!library.has(key)) library.set(key, track.id);
  }
  const plays: ImportedPlayback[] = [];
  let matched = 0;
  let first: Date | undefined;
  let last: Date | undefined;
  for (const listen of listens) {
    const startTime = new Date(listen.playedAt);
    const shard = historyShard(base, startTime);
    const key = songKey(listen.artist, listen.track);
    const iri = `${shard}#scrobble-${fingerprint(`${listen.playedAt}\u0000${key}`)}`;
    const agent = SCROBBLE_AGENTS[listen.source];
    const trackIri = library.get(key);
    if (trackIri) {
      matched += 1;
      plays.push({ iri, trackIri, startTime, agent });
    } else {
      const song = `${shard}#song-${fingerprint(key)}`;
      plays.push({
        iri,
        trackIri: song,
        startTime,
        agent,
        recording: {
          iri: song,
          title: listen.track.trim(),
          artistIri: `${shard}#artist-${fingerprint(matchName(listen.artist))}`,
          artist: listen.artist.trim(),
        },
      });
    }
    if (!first || startTime < first) first = startTime;
    if (!last || startTime > last) last = startTime;
  }
  return { plays, matched, unmatched: plays.length - matched, warnings, first, last };
}

/** Saves a plan; plays already in the pod (an earlier import) are counted, not duplicated. */
export function saveScrobbles(
  fetch: typeof globalThis.fetch,
  storage: string,
  plan: ScrobblePlan,
  onProgress?: (done: number, total: number) => void,
) {
  return appendPlaybacks(fetch, musicRoot(storage), plan.plays, onProgress);
}

/** User-facing copy for a file that couldn't be read. */
export function scrobbleErrorMessage(error: unknown): string {
  if (error instanceof RangeError) return error.message;
  if (error instanceof ScrobbleError && error.code === "EXPORT_TOO_LARGE")
    return "That export is too large to import at once (64 MB or a million listens). Split it and import each part.";
  return "That file isn't a Last.fm or ListenBrainz export we can read.";
}
