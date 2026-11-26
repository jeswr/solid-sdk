// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5 (scrobble writes through @jeswr/solid-listening)
import { addScrobble } from "@jeswr/solid-listening";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { canonicalizeJeswrDataset } from "../core/canonical-vocab.js";
import type { FileImportAdapter, FileImportContext, ImportFile } from "../core/file-import.js";
import { MAX_FILE_BYTES } from "../core/file-import.js";
import { jsonEntries } from "../core/file-json.js";
import { sniffInput } from "../google-takeout/dispatch.js";
import { sha256 } from "../google-takeout/mbox.js";
import {
  cappedSink,
  InflationBudget,
  readZipEntry,
  zipDirectory,
} from "../google-takeout/zip-reader.js";
import { MEDIA } from "./vocab.js";
import { vocabMap } from "./vocab-map.js";

/** Hard ceilings shared across every selected entry, including malformed/duplicate rows. */
export const SPOTIFY_FILE_LIMITS = {
  archiveBytes: 512 * 1024 * 1024,
  inflatedBytes: 256 * 1024 * 1024,
  entries: 1_000,
  textBytes: 16 * 1024 * 1024,
  months: 600,
  /** Plays in one history document; a month splits into `-part-N` documents beyond it. */
  documentPlays: 2_000,
  /** Estimated Turtle bytes of one history document, well below readers' 16 MiB cap. */
  documentBytes: 4 * 1024 * 1024,
  /** History documents for one month (`YYYY-MM.ttl`, then `YYYY-MM-part-2.ttl`, …). */
  monthParts: 64,
} as const;

/**
 * The connector-relative slug of part `part` (from 1) of a month's history. Parts are
 * contiguous: part N exists only after part N - 1, so readers stop at the first missing one.
 */
export function spotifyHistorySlug(month: string, part: number): string {
  return part === 1 ? `music/history/${month}.ttl` : `music/history/${month}-part-${part}.ttl`;
}

interface Play {
  when: string;
  title: string;
  artist?: string;
  album?: string;
  uri?: string;
  ms: number;
  /** Basic rows only: earlier rows in the same file with this minute and recording. */
  occurrence?: number;
}
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() && value.length <= 4096 ? value.trim() : undefined;

function play(value: unknown): Play | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  // Private Session plays stay private: Spotify keeps them out of history and taste.
  if (row.incognito_mode === true) return;
  const basic = row.ts === undefined;
  const raw = basic ? row.endTime : row.ts;
  if (typeof raw !== "string") return;
  const timestamp =
    basic && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw) ? `${raw.replace(" ", "T")}:00.000Z` : raw;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)) return;
  const date = new Date(timestamp);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().replace(".000Z", "Z") !== timestamp.replace(".000Z", "Z")
  )
    return;
  const title =
    text(basic ? row.trackName : row.master_metadata_track_name) ??
    (!basic ? text(row.episode_name) : undefined);
  const ms = basic ? row.msPlayed : row.ms_played;
  if (!title || typeof ms !== "number" || !Number.isSafeInteger(ms) || ms < 0) return;
  const uri =
    typeof row.spotify_track_uri === "string" &&
    /^spotify:track:[A-Za-z0-9]{22}$/.test(row.spotify_track_uri)
      ? row.spotify_track_uri
      : undefined;
  // All other export fields (including IP, country and device) are deliberately discarded.
  return {
    when: date.toISOString(),
    title,
    ms,
    uri,
    artist:
      text(basic ? row.artistName : row.master_metadata_album_artist_name) ??
      (!basic ? text(row.episode_show_name) : undefined),
    album: !basic ? text(row.master_metadata_album_album_name) : undefined,
    ...(basic ? { occurrence: 0 } : {}),
  };
}

/** A play's recording identity: the track URI, else its names. */
const identity = (item: Play) => item.uri ?? JSON.stringify([item.artist ?? "", item.title]);

/** The play id: SHA-256 of its instant and recording, plus a Basic repeat's occurrence. */
function playId(item: Play): Promise<string> {
  const key: unknown[] = [item.when, identity(item)];
  if (item.occurrence) key.push(item.occurrence);
  return sha256(JSON.stringify(key));
}

/**
 * Accept only documented filenames, at root or in Spotify's export directory: current
 * extended (`Streaming_History_*`) and account (`StreamingHistory_music_N`) exports, and
 * the older extended `MyData/endsong_N.json` and account `StreamingHistoryN.json` names.
 * Each row's own fields decide whether it is an extended or a basic record.
 */
function historyEntry(name: string): boolean {
  return (
    /^(?:Spotify Extended Streaming History\/)?Streaming_History_(?:Audio|Video)_[A-Za-z0-9_-]+\.json$/.test(
      name,
    ) ||
    /^(?:MyData\/)?endsong_\d+\.json$/.test(name) ||
    /^(?:Spotify Account Data\/|MyData\/)?StreamingHistory(?:_music_)?\d+\.json$/.test(name)
  );
}

/** Propagate cancellation through sniffing, ranged ZIP reads and JSON streams. */
function cancellableFile(file: ImportFile, signal: AbortSignal | undefined): ImportFile {
  if (!signal) return file;
  const open = file.stream?.bind(file);
  const slice = file.slice?.bind(file);
  const stream = (open: () => ReadableStream<Uint8Array>) => {
    signal.throwIfAborted();
    return open().pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), { signal });
  };
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    async text() {
      signal.throwIfAborted();
      const result = await file.text();
      signal.throwIfAborted();
      return result;
    },
    ...(open ? { stream: () => stream(open) } : {}),
    ...(slice
      ? {
          slice: (start: number, end: number) => ({
            stream: () => stream(() => slice(start, end).stream()),
          }),
        }
      : {}),
  };
}

export const spotifyFileAdapter: FileImportAdapter = {
  vocabMap,
  metadata: {
    id: "spotify",
    name: "Spotify",
    tier: "A",
    authKind: "export-file",
    scopes: [],
    categories: ["media"],
    whatYouGet: "Your Spotify streaming history in Music, without a Spotify app.",
    requirements: [],
  },
  accept: ".zip,application/zip,.json,application/json",
  streaming: true,
  fileHint:
    'Spotify → Account → Privacy settings → Download your data. Request "Extended streaming history" (or "Account data"). Select the downloaded ZIP, or a Streaming_History_Audio_*.json, Streaming_History_Video_*.json or StreamingHistory_music_*.json file (older exports: endsong_*.json or StreamingHistory*.json). IP address, country and device are discarded, and Private Session (incognito) plays are skipped. Short plays are kept.',
  exportUrl: "https://www.spotify.com/account/privacy/",
  async importFile(file, ctx) {
    ctx.signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > SPOTIFY_FILE_LIMITS.archiveBytes
    )
      throw new Error("Spotify export exceeds the 512 MiB archive limit.");
    file = cancellableFile(file, ctx.signal);
    const months = new Map<string, Play[]>();
    let rows = 0;
    let retained = 0;
    let skipped = 0;
    const count = () => {
      ctx.signal?.throwIfAborted();
      if (++rows > ctx.maxRows)
        throw new Error("Spotify export exceeds the record limit. Split the export.");
    };
    const parse = async (input: ImportFile) => {
      const raw = await input.text();
      ctx.signal?.throwIfAborted();
      if (!raw.trimStart().startsWith("["))
        throw new Error("Spotify history must be a JSON array.");
      // Basic rows carry minute precision: repeats of one recording in the same minute are
      // numbered in file order, so re-importing the same file yields the same ids, and
      // overlapping files (each numbering from zero) still name each repeat once.
      const repeats = new Map<string, number>();
      for await (const entry of jsonEntries({ ...input, text: async () => raw }, [""], [], () => {
        count();
        skipped++;
      })) {
        count();
        const item = play(entry.value);
        if (!item) {
          skipped++;
          continue;
        }
        if (item.occurrence !== undefined) {
          const key = JSON.stringify([item.when, identity(item)]);
          item.occurrence = repeats.get(key) ?? 0;
          repeats.set(key, item.occurrence + 1);
        }
        retained += new TextEncoder().encode(JSON.stringify(item)).length;
        if (retained > SPOTIFY_FILE_LIMITS.textBytes)
          throw new Error("Spotify export exceeds the metadata limit. Split the export.");
        const month = item.when.slice(0, 7);
        let group = months.get(month);
        if (!group) {
          if (months.size >= SPOTIFY_FILE_LIMITS.months)
            throw new Error("Spotify export exceeds the month limit.");
          group = [];
          months.set(month, group);
        }
        group.push(item);
      }
    };
    ctx.progress({ label: "Reading Spotify streaming history…", done: 0 });
    const input = await sniffInput(file);
    if (input.zip) {
      const entries = await zipDirectory(file, SPOTIFY_FILE_LIMITS.entries);
      const inflationBudget = new InflationBudget(SPOTIFY_FILE_LIMITS.inflatedBytes);
      const selected = entries.filter((entry) => historyEntry(entry.name));
      if (selected.length === 0)
        throw new Error("No Spotify streaming history found in this archive.");
      for (const entry of selected) {
        ctx.signal?.throwIfAborted();
        if (entry.invalid || entry.size > MAX_FILE_BYTES)
          throw new Error("Invalid or oversized Spotify history ZIP entry.");
        // Parsing happens only after the shared reader verifies CRC, size and DEFLATE framing.
        await readZipEntry(
          file,
          entry,
          cappedSink(MAX_FILE_BYTES, async (bytes) => {
            if (!bytes) throw new Error("Spotify history entry exceeds 64 MiB.");
            await parse({
              name: entry.name,
              size: bytes.length,
              type: "application/json",
              text: async () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            });
          }),
          { inflationBudget },
          MAX_FILE_BYTES,
        );
      }
    } else {
      await parse({
        name: file.name,
        size: file.size,
        type: file.type,
        text: async () => input.text,
      });
    }
    // Stage the bounded, allowlisted records and plan every month's documents before the
    // first write: damaged archives and months over a document limit never partially import.
    ctx.progress({ label: "Checking your Spotify history in your pod…", done: 0 });
    const plans: Part[][] = [];
    for (const [month, items] of months) plans.push(await planMonth(month, items, ctx));
    let done = 0;
    for (const parts of plans) {
      ctx.progress({
        label: "Saving Spotify history to your pod…",
        done: done++,
        total: plans.length,
      });
      await writeParts(parts, ctx);
    }
    return { skipped };
  },
};

const RDF_TYPE = DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const PLAYBACK_EVENT = DataFactory.namedNode(`${MEDIA}PlaybackEvent`);
const utf8 = (value: string | undefined) =>
  value === undefined ? 0 : new TextEncoder().encode(value).length;

/**
 * Per-play Turtle bytes besides its text, with provenance: about a dozen IRIs in the
 * document's namespace plus fixed terms. Measured at ~2.2 KB a play with unshared
 * recordings and a 68-character document URL; this overestimates that by a third.
 */
const playOverhead = (doc: string) => 1_500 + 20 * doc.length;

/** Conservative Turtle size of one play beside its document's other plays. */
function playBytes(doc: string, item: Play): number {
  // Literal text counts twice, covering Turtle escapes.
  return playOverhead(doc) + 2 * (utf8(item.title) + utf8(item.artist) + utf8(item.album));
}

interface Part {
  slug: string;
  url: string;
  /** Plays already stored in the part (deduplicated ids). */
  stored: Set<string>;
  plays: number;
  bytes: number;
  assigned: [id: string, item: Play][];
}

/** The stored play ids of one part, and its estimated size, from the session's read. */
function storedPart(slug: string, url: string, dataset: DatasetCore): Part {
  const stored = new Set<string>();
  const prefix = `${url}#scrobble-`;
  for (const quad of dataset.match(null, RDF_TYPE, PLAYBACK_EVENT, null)) {
    const id = quad.subject.value.startsWith(prefix) ? quad.subject.value.slice(prefix.length) : "";
    if (/^[0-9a-f]{64}$/.test(id)) stored.add(id);
  }
  let literals = 0;
  for (const quad of dataset)
    if (quad.object.termType === "Literal") literals += utf8(quad.object.value);
  const plays = dataset.match(null, RDF_TYPE, PLAYBACK_EVENT, null).size;
  return {
    slug,
    url,
    stored,
    plays,
    bytes: plays * playOverhead(url) + 2 * literals,
    assigned: [],
  };
}

/**
 * Plan one month's plays into its contiguous history parts, reading the stored parts but
 * writing nothing. A play already stored stays in its part, so re-imports never move or
 * duplicate it; new plays fill parts in order under the play and size budgets, then open
 * the next part. Throws when the month would need more parts than allowed.
 */
async function planMonth(
  month: string,
  items: readonly Play[],
  ctx: FileImportContext,
): Promise<Part[]> {
  // Rows that share an id are one play; the last one read wins, as on re-import.
  const unique = new Map<string, Play>();
  for (const item of items) {
    ctx.signal?.throwIfAborted();
    unique.set(await playId(item), item);
  }
  const parts: Part[] = [];
  for (let part = 1; ; part++) {
    const slug = spotifyHistorySlug(month, part);
    const dataset = await ctx.read(slug);
    if (!dataset) break;
    if (part > SPOTIFY_FILE_LIMITS.monthParts)
      throw new Error(`Spotify history for ${month} has too many documents.`);
    parts.push(storedPart(slug, ctx.resolve(slug), dataset));
  }
  const fresh: [string, Play][] = [];
  for (const [id, item] of unique) {
    const part = parts.find((candidate) => candidate.stored.has(id));
    if (part) part.assigned.push([id, item]);
    else fresh.push([id, item]);
  }
  fresh.sort(([a, x], [b, y]) => x.when.localeCompare(y.when) || a.localeCompare(b));
  let index = 0;
  for (const entry of fresh) {
    for (;;) {
      let part = parts[index];
      if (!part) {
        if (parts.length >= SPOTIFY_FILE_LIMITS.monthParts)
          throw new Error(`Spotify history for ${month} exceeds the document limit.`);
        const slug = spotifyHistorySlug(month, parts.length + 1);
        part = {
          slug,
          url: ctx.resolve(slug),
          stored: new Set(),
          plays: 0,
          bytes: 0,
          assigned: [],
        };
        parts.push(part);
      }
      const bytes = playBytes(part.url, entry[1]);
      // An empty part always takes one play, so every play has a home.
      if (
        part.plays === 0 ||
        (part.plays < SPOTIFY_FILE_LIMITS.documentPlays &&
          part.bytes + bytes <= SPOTIFY_FILE_LIMITS.documentBytes)
      ) {
        part.assigned.push(entry);
        part.plays++;
        part.bytes += bytes;
        break;
      }
      index++;
    }
  }
  return parts;
}

/** Write one month's planned parts, in ascending order so they stay contiguous on failure. */
async function writeParts(parts: readonly Part[], ctx: FileImportContext) {
  for (const part of parts) {
    if (part.assigned.length === 0) continue;
    const scrobbles = new Store();
    const keys = new Map<string, string>();
    const key = async (value: unknown) => {
      const text = JSON.stringify(value);
      let hash = keys.get(text);
      if (!hash) {
        hash = (await sha256(text)).slice(0, 32);
        keys.set(text, hash);
      }
      return hash;
    };
    for (const [id, item] of part.assigned) {
      ctx.signal?.throwIfAborted();
      const root = `${part.url}#scrobble-${id}`;
      const artist = item.artist ?? null;
      const album = item.album ?? null;
      // Plays of one recording in a document share its track, artist and album nodes. Each
      // node id covers every value its description holds, so shared nodes always agree.
      addScrobble(
        scrobbles,
        {
          event: root,
          instant: `${root}-instant`,
          track: `${part.url}#track-${await key([item.title, artist, album])}`,
          artist: `${part.url}#artist-${await key([artist])}`,
          album: `${part.url}#album-${await key([artist, album])}`,
        },
        {
          trackTitle: item.title,
          artistName: item.artist,
          albumTitle: item.album,
          playedAt: new Date(item.when),
          msPlayed: item.ms,
        },
      );
    }
    // solid-listening still emits the legacy w3id media/core namespaces; connector
    // documents store the canonical suite terms (CON-13), as Music reads both.
    await ctx.write({
      slug: part.slug,
      category: "media",
      forClass: `${MEDIA}PlaybackEvent`,
      dataset: canonicalizeJeswrDataset(scrobbles),
      writeMode: "merge",
    });
  }
}
