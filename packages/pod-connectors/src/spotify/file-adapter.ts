// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import type { FileImportAdapter, ImportFile } from "../core/file-import.js";
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
import { MEDIA, MediaThing, SCHEMA, TIME } from "./vocab.js";
import { vocabMap } from "./vocab-map.js";

/** Hard ceilings shared across every selected entry, including malformed/duplicate rows. */
export const SPOTIFY_FILE_LIMITS = {
  archiveBytes: 512 * 1024 * 1024,
  inflatedBytes: 256 * 1024 * 1024,
  entries: 1_000,
  textBytes: 16 * 1024 * 1024,
  months: 600,
} as const;

interface Play {
  when: string;
  title: string;
  artist?: string;
  album?: string;
  uri?: string;
  ms: number;
}
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() && value.length <= 4096 ? value.trim() : undefined;

function play(value: unknown): Play | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
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
  };
}

/** Accept only the documented filenames, at root or in Spotify's export directory. */
function historyEntry(name: string): boolean {
  return (
    /^(?:Spotify Extended Streaming History\/)?Streaming_History_(?:Audio|Video)_[A-Za-z0-9_-]+\.json$/.test(
      name,
    ) || /^(?:Spotify Account Data\/)?StreamingHistory_music_\d+\.json$/.test(name)
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
    'Spotify → Account → Privacy settings → Download your data. Request "Extended streaming history" (or "Account data"). Select the downloaded ZIP, or a Streaming_History_Audio_*.json, Streaming_History_Video_*.json or StreamingHistory_music_*.json file. IP address, country and device are discarded. Short plays are kept.',
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
      for (const entry of entries) {
        ctx.signal?.throwIfAborted();
        if (!historyEntry(entry.name)) continue;
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
    // Stage the bounded, allowlisted records first: damaged archives never partially import.
    let done = 0;
    for (const [month, items] of months) {
      const slug = `music/history/${month}.ttl`;
      const doc = ctx.resolve(slug);
      const dataset = new Store();
      for (const item of items) {
        ctx.signal?.throwIfAborted();
        const identity = item.uri ?? JSON.stringify([item.artist ?? "", item.title]);
        const id = await sha256(JSON.stringify([item.when, identity]));
        const root = `${doc}#scrobble-${id}`;
        const work = new MediaThing(`${root}-track`, dataset, DataFactory);
        work.types.add(`${MEDIA}Track`);
        work.types.add(`${MEDIA}CreativeWork`);
        work.types.add(`${SCHEMA}MusicRecording`);
        work.title = item.title;
        work.name = item.title;
        if (item.uri) work.sourceUrl = `https://open.spotify.com/track/${item.uri.slice(14)}`;
        if (item.artist) {
          const artist = new MediaThing(`${root}-artist`, dataset, DataFactory);
          artist.types.add(`${MEDIA}Artist`);
          artist.artistName = item.artist;
          work.performedByArtist = artist.value;
        }
        if (item.album) {
          const album = new MediaThing(`${root}-album`, dataset, DataFactory);
          album.types.add(`${MEDIA}Album`);
          album.title = item.album;
          work.album = album.value;
        }
        const event = new MediaThing(root, dataset, DataFactory);
        event.types.add(`${MEDIA}PlaybackEvent`);
        event.types.add(`${SCHEMA}ListenAction`);
        event.playedWork = work.value;
        event.atTime = `${root}-instant`;
        event.msPlayed = item.ms;
        event.playedVia = "https://open.spotify.com/";
        const instant = new MediaThing(`${root}-instant`, dataset, DataFactory);
        instant.types.add(`${TIME}Instant`);
        instant.instant = new Date(item.when);
      }
      ctx.progress({
        label: "Saving Spotify history to your pod…",
        done: done++,
        total: months.size,
      });
      await ctx.write({
        slug,
        category: "media",
        forClass: `${MEDIA}PlaybackEvent`,
        dataset,
        writeMode: "merge",
      });
    }
    return { skipped };
  },
};
