// AUTHORED-BY Codex GPT-6.1-Sol

import { dedupe } from "./dedupe";
import { csvTimestamp, invalidListen, listenBrainzFields, normalize } from "./normalize";
import { checkBytes, csvFields, scanCsv, scanListenBrainz } from "./scan";
import {
  isRecord,
  type Listen,
  MAX_LISTENS,
  ScrobbleError,
  type ScrobbleExports,
  type ScrobbleImportOptions,
  type ScrobbleResult,
  type ScrobbleWarning,
} from "./types";

export type {
  Listen,
  ListenSource,
  ScrobbleErrorCode,
  ScrobbleExports,
  ScrobbleImportOptions,
  ScrobbleResult,
  ScrobbleWarning,
} from "./types";
export { MAX_EXPORT_BYTES, MAX_LISTENS, ScrobbleError } from "./types";

/** Import either or both exports, with limits shared across sources before row materialization. */
export function importScrobbles(
  input: ScrobbleExports,
  options: ScrobbleImportOptions,
): ScrobbleResult {
  if (
    !isRecord(input as unknown) ||
    Object.keys(input).some((key) => key !== "listenBrainz" && key !== "lastFm") ||
    !options ||
    !(options.now instanceof Date) ||
    !Number.isFinite(options.now.getTime())
  )
    throw new ScrobbleError("INVALID_EXPORT");
  const inputs: string[] = [];
  for (const text of [input.listenBrainz, input.lastFm]) {
    if (text === undefined) continue;
    if (typeof text !== "string") throw new ScrobbleError("INVALID_EXPORT");
    inputs.push(text);
  }
  checkBytes(inputs);
  let count = 0;
  const countRow = () => {
    if (++count > MAX_LISTENS) throw new ScrobbleError("EXPORT_TOO_LARGE");
  };
  if (input.listenBrainz !== undefined) scanListenBrainz(input.listenBrainz, countRow);
  if (input.lastFm !== undefined) {
    let header = true;
    scanCsv(input.lastFm, () => {
      if (header) header = false;
      else countRow();
    });
  }
  const warnings: ScrobbleWarning[] = [];
  const listens: Listen[] = [];
  const now = options.now.getTime();
  if (input.listenBrainz !== undefined) {
    const text = input.listenBrainz;
    scanListenBrainz(text, (start, end, line) => {
      let raw: unknown;
      try {
        raw = JSON.parse(text.slice(start, end));
      } catch {
        throw new ScrobbleError("INVALID_EXPORT");
      }
      const listen = normalize(listenBrainzFields(raw), "listenbrainz", line, now, warnings);
      if (listen) listens.push(listen);
    });
  }
  if (input.lastFm !== undefined) {
    const text = input.lastFm;
    let headers: string[] | undefined;
    scanCsv(text, (start, end, line) => {
      const values = csvFields(text.slice(start, end));
      if (!headers) {
        if (
          !["artist", "album", "track", "timestamp"].every((key) => values.includes(key)) ||
          new Set(values).size !== values.length ||
          values.includes("")
        )
          throw new ScrobbleError("INVALID_EXPORT");
        headers = values;
        return;
      }
      if (values.length !== headers.length) {
        invalidListen(warnings, "lastfm", line);
        return;
      }
      // Header presence and record width were checked above.
      const row = Object.fromEntries(headers.map((key, index) => [key, values[index]])) as {
        artist: string;
        album: string;
        track: string;
        timestamp: string;
      };
      const listen = normalize(
        {
          artist: row.artist,
          track: row.track,
          album: row.album,
          seconds: csvTimestamp(row.timestamp),
          info: undefined,
        },
        "lastfm",
        line,
        now,
        warnings,
      );
      if (listen) listens.push(listen);
    });
    if (!headers) throw new ScrobbleError("INVALID_EXPORT");
  }
  return { listens: dedupe(listens), warnings };
}

export function parseListenBrainz(text: string, options: ScrobbleImportOptions): ScrobbleResult {
  if (typeof text !== "string") throw new ScrobbleError("INVALID_EXPORT");
  return importScrobbles({ listenBrainz: text }, options);
}

export function parseLastFm(text: string, options: ScrobbleImportOptions): ScrobbleResult {
  if (typeof text !== "string") throw new ScrobbleError("INVALID_EXPORT");
  return importScrobbles({ lastFm: text }, options);
}
