// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { isRecord, type Listen, type ListenSource, type ScrobbleWarning } from "./types";

const MIN_TIME = Date.UTC(2002, 0, 1);
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function invalidListen(
  warnings: ScrobbleWarning[],
  source: ListenSource,
  line: number,
): void {
  warnings.push({
    source,
    line,
    code: "INVALID_LISTEN",
    message: "Invalid or out-of-range listen.",
  });
}

export function csvTimestamp(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/.test(text)) return NaN;
  const day = Number(text.slice(0, 2));
  const month = MONTHS.indexOf(text.slice(3, 6));
  const year = Number(text.slice(7, 11));
  const hour = Number(text.slice(12, 14));
  const minute = Number(text.slice(15, 17));
  const date = new Date(Date.UTC(year, month, day, hour, minute));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  )
    return NaN;
  return date.getTime() / 1000;
}

interface RawListen {
  artist: unknown;
  track: unknown;
  album: unknown;
  seconds: unknown;
  info: unknown;
}

export function listenBrainzFields(raw: unknown): RawListen | undefined {
  if (!isRecord(raw) || !isRecord(raw.track_metadata)) return undefined;
  const meta = raw.track_metadata;
  return {
    artist: meta.artist_name,
    track: meta.track_name,
    album: meta.release_name,
    seconds: raw.listened_at,
    info: meta.additional_info,
  };
}

export function normalize(
  raw: RawListen | undefined,
  source: ListenSource,
  line: number,
  now: number,
  warnings: ScrobbleWarning[],
): Listen | undefined {
  if (
    !raw ||
    typeof raw.artist !== "string" ||
    !raw.artist.trim() ||
    typeof raw.track !== "string" ||
    !raw.track.trim() ||
    typeof raw.seconds !== "number" ||
    !Number.isSafeInteger(raw.seconds) ||
    raw.seconds * 1000 < MIN_TIME ||
    raw.seconds * 1000 > now + DAY_MS ||
    (raw.album !== undefined && typeof raw.album !== "string") ||
    (raw.info !== undefined && !isRecord(raw.info))
  ) {
    invalidListen(warnings, source, line);
    return undefined;
  }
  const date = new Date(raw.seconds * 1000);
  if (!Number.isFinite(date.getTime())) {
    invalidListen(warnings, source, line);
    return undefined;
  }
  const info = raw.info as Record<string, unknown> | undefined;
  const duration = info?.duration_ms;
  if (
    duration !== undefined &&
    (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 0)
  ) {
    invalidListen(warnings, source, line);
    return undefined;
  }
  const mbids: { recording?: string; release?: string; artists?: string[] } = {};
  const mbid = (value: unknown, field: string): string | undefined => {
    if (typeof value === "string" && UUID.test(value)) return value;
    warnings.push({ source, line, code: "INVALID_MBID", field, message: "Invalid MBID dropped." });
    return undefined;
  };
  if (info?.recording_mbid !== undefined) {
    const value = mbid(info.recording_mbid, "recording_mbid");
    if (value !== undefined) mbids.recording = value;
  }
  if (info?.release_mbid !== undefined) {
    const value = mbid(info.release_mbid, "release_mbid");
    if (value !== undefined) mbids.release = value;
  }
  if (info?.artist_mbids !== undefined) {
    if (!Array.isArray(info.artist_mbids)) {
      warnings.push({
        source,
        line,
        code: "INVALID_MBID",
        field: "artist_mbids",
        message: "Invalid MBID dropped.",
      });
    } else {
      const artists: string[] = [];
      info.artist_mbids.forEach((value, index) => {
        const id = mbid(value, `artist_mbids[${index}]`);
        if (id !== undefined) artists.push(id);
      });
      if (artists.length) mbids.artists = artists;
    }
  }
  return {
    playedAt: date.toISOString(),
    artist: raw.artist,
    track: raw.track,
    ...(typeof raw.album === "string" && raw.album.trim() ? { album: raw.album } : {}),
    ...(duration !== undefined ? { durationMs: duration as number } : {}),
    mbids,
    source,
  };
}
