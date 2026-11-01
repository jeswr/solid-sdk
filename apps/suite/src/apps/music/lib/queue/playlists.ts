// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { MusicQueueError } from "./errors";

export interface PlaylistEntry {
  readonly url: string;
  /** Empty string means no display title. */
  readonly title: string;
  /** Whole seconds; null means unknown (-1 in playlist text). */
  readonly durationSeconds: number | null;
}

function singleLine(value: unknown): value is string {
  return typeof value === "string" && value.isWellFormed() && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value);
}
function reference(value: unknown): value is string {
  return (
    singleLine(value) &&
    value.length > 0 &&
    !/[\s\\<>"{}|^`]/u.test(value) &&
    !/%(?![\da-f]{2})/iu.test(value) &&
    (!/^[a-z][a-z\d+.-]*:/iu.test(value) || /^https?:\/\//iu.test(value))
  );
}
function resolveUrl(value: string, base?: string): string {
  if (!reference(value)) throw new MusicQueueError("invalid-url");
  let url: URL;
  try {
    url = base === undefined ? new URL(value) : new URL(value, base);
  } catch {
    throw new MusicQueueError("invalid-url");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new MusicQueueError("invalid-url");
  }
  return url.href;
}
function lines(text: string): string[] {
  if (
    typeof text !== "string" ||
    !text.isWellFormed() ||
    /[\p{Zl}\p{Zp}]/u.test(text) ||
    /\p{Cc}/u.test(text.replace(/[\r\n]/g, ""))
  ) {
    throw new MusicQueueError("invalid-playlist");
  }
  return text.replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u);
}
function duration(value: string): number | null {
  if (value === "-1") return null;
  if (!/^(0|[1-9]\d*)$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new MusicQueueError("invalid-playlist");
  }
  return Number(value);
}
function validateEntries(entries: readonly PlaylistEntry[]): PlaylistEntry[] {
  if (!Array.isArray(entries)) throw new MusicQueueError("invalid-entry");
  return Array.from(entries).map((entry) => {
    if (
      !entry ||
      !singleLine(entry.title) ||
      (entry.durationSeconds !== null &&
        (!Number.isSafeInteger(entry.durationSeconds) || entry.durationSeconds < 0))
    ) {
      throw new MusicQueueError("invalid-entry");
    }
    return { ...entry, url: resolveUrl(entry.url) };
  });
}

/** Decoded Unicode M3U/M3U8 track lists; HLS and other extensions are rejected. */
export function parseM3u(text: string, baseIri: string): PlaylistEntry[] {
  const base = resolveUrl(baseIri);
  const input = lines(text);
  const entries: PlaylistEntry[] = [];
  let extended = false;
  let seenContent = false;
  let pending: { title: string; durationSeconds: number | null } | null = null;
  for (const line of input) {
    if (line === "") continue;
    if (line === "#EXTM3U") {
      if (seenContent) throw new MusicQueueError("invalid-playlist");
      extended = true;
    } else if (line.startsWith("#EXTINF:")) {
      if (!extended || pending !== null) throw new MusicQueueError("invalid-playlist");
      const match = /^#EXTINF:([^,]+),(.*)$/u.exec(line);
      if (!match) throw new MusicQueueError("invalid-playlist");
      pending = { durationSeconds: duration(match[1] as string), title: match[2] as string };
    } else if (line.startsWith("#EXT") || line.startsWith("#PLAYLIST")) {
      throw new MusicQueueError("unsupported-playlist");
    } else if (!line.startsWith("#")) {
      entries.push({
        url: resolveUrl(line, base),
        title: pending?.title ?? "",
        durationSeconds: pending?.durationSeconds ?? null,
      });
      pending = null;
    }
    seenContent = true;
  }
  if (pending !== null) throw new MusicQueueError("invalid-playlist");
  return entries;
}
/** M3U8 uses the same text grammar. Decode UTF-8 strictly before calling. */
export const parseM3u8 = parseM3u;

export function serialiseM3u(entries: readonly PlaylistEntry[]): string {
  const output = ["#EXTM3U"];
  for (const entry of validateEntries(entries)) {
    output.push(`#EXTINF:${entry.durationSeconds ?? -1},${entry.title}`, entry.url);
  }
  return `${output.join("\n")}\n`;
}
export const serialiseM3u8 = serialiseM3u;

/** Strict PLS v2: indexed File/Title/Length plus required count and version. */
export function parsePls(text: string, baseIri: string): PlaylistEntry[] {
  const base = resolveUrl(baseIri);
  const input = lines(text).filter((line) => line !== "");
  if (input.shift() !== "[playlist]") throw new MusicQueueError("invalid-playlist");
  const fields = new Map<string, string>();
  const indexes = new Set<number>();
  for (const line of input) {
    const match = /^(NumberOfEntries|Version|(?:File|Title|Length)[1-9]\d*)=(.*)$/u.exec(line);
    if (!match) throw new MusicQueueError("unsupported-playlist");
    const key = match[1] as string;
    if (fields.has(key)) throw new MusicQueueError("invalid-playlist");
    fields.set(key, match[2] as string);
    if (key !== "Version" && key !== "NumberOfEntries") {
      const index = Number(key.replace(/^[a-z]+/iu, ""));
      if (!Number.isSafeInteger(index)) throw new MusicQueueError("invalid-playlist");
      indexes.add(index);
    }
  }
  if (fields.get("Version") !== "2") throw new MusicQueueError("unsupported-playlist");
  const count = fields.get("NumberOfEntries");
  if (count === undefined || !/^(0|[1-9]\d*)$/u.test(count) || Number(count) !== indexes.size) {
    throw new MusicQueueError("invalid-playlist");
  }
  const entries: PlaylistEntry[] = [];
  for (let i = 1; i <= indexes.size; i++) {
    const file = fields.get(`File${i}`);
    if (file === undefined) throw new MusicQueueError("invalid-playlist");
    const length = fields.get(`Length${i}`);
    entries.push({
      url: resolveUrl(file, base),
      title: fields.get(`Title${i}`) ?? "",
      durationSeconds: length === undefined ? null : duration(length),
    });
  }
  return entries;
}
export function serialisePls(entries: readonly PlaylistEntry[]): string {
  const validated = validateEntries(entries);
  const output = ["[playlist]"];
  for (const [i, entry] of validated.entries()) {
    output.push(
      `File${i + 1}=${entry.url}`,
      `Title${i + 1}=${entry.title}`,
      `Length${i + 1}=${entry.durationSeconds ?? -1}`,
    );
  }
  output.push(`NumberOfEntries=${validated.length}`, "Version=2");
  return `${output.join("\n")}\n`;
}
