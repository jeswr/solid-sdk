// AUTHORED-BY Codex GPT-6.1-Sol
import { LyricsError } from "./errors";

export const LYRICS_LIMITS = Object.freeze({
  maxCodeUnits: 1_000_000,
  maxLines: 10_000,
  maxLineCodeUnits: 16_384,
  maxTimeMs: 86_400_000,
});
export interface LyricsTag {
  readonly key: string;
  readonly value: string;
}
export interface LyricsWord {
  /** Absolute source timestamp, before the document offset is applied. */
  readonly timeMs: number;
  /** Includes intervening whitespace; an empty final segment is an end marker. */
  readonly text: string;
}
export interface LyricsLine {
  readonly timeMs: number;
  readonly text: string;
  readonly words: readonly LyricsWord[];
}
export interface Lyrics {
  readonly kind: "lrc" | "plain";
  readonly metadata: readonly LyricsTag[];
  /** Positive values advance lyrics: effective time = timeMs - offsetMs. */
  readonly offsetMs: number;
  readonly lines: readonly LyricsLine[];
  /** Plain fallback, or timed lines joined without their timing markers. */
  readonly text: string;
}

const documents = new WeakSet<Lyrics>();
const lrcSyntax = /\[\s*(?:[+-]?\d|[a-z][\w-]*\s*:)|\[offset\b|<\s*[+-]?\d/iu;
const timePattern = /^(\d{2,4}):([0-5]\d)(?:\.(\d{1,3}))?$/u;

function boundedLines(text: string): string[] {
  if (text.length > LYRICS_LIMITS.maxCodeUnits) throw new LyricsError("limit-exceeded");
  const lines = text.split("\n");
  if (
    lines.length > LYRICS_LIMITS.maxLines ||
    lines.some((line) => line.length > LYRICS_LIMITS.maxLineCodeUnits)
  ) {
    throw new LyricsError("limit-exceeded");
  }
  return lines;
}
function time(value: string): number {
  const match = timePattern.exec(value);
  if (!match) throw new LyricsError("invalid-timestamp");
  const ms =
    Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Number((match[3] ?? "").padEnd(3, "0"));
  if (ms > LYRICS_LIMITS.maxTimeMs) throw new LyricsError("invalid-timestamp");
  return ms;
}
function formatTime(ms: number): string {
  return `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(
    Math.floor(ms / 1000) % 60,
  ).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
function wordSegments(text: string, lineTime: number): LyricsWord[] {
  if (!lrcSyntax.test(text)) return [];
  // A numeric-looking square tag inside the lyric is never silently treated as text.
  if (!text.includes("<") || /\[/u.test(text)) throw new LyricsError("invalid-lrc");
  const words: LyricsWord[] = [];
  let previous = lineTime;
  const markers = [...text.matchAll(/<([^<>]*)>/gu)];
  if (markers.length === 0) throw new LyricsError("invalid-lrc");
  const prefix = text.slice(0, (markers[0] as RegExpExecArray).index);
  if (prefix.includes("<") || prefix.includes(">")) throw new LyricsError("invalid-lrc");
  if (prefix) words.push({ timeMs: lineTime, text: prefix });
  for (const [i, marker] of markers.entries()) {
    const ms = time(marker[1] as string);
    if (ms < previous) throw new LyricsError("invalid-timestamp");
    const segment = text.slice(marker.index + marker[0].length, markers[i + 1]?.index);
    if (segment.includes("<") || segment.includes(">")) throw new LyricsError("invalid-lrc");
    words.push({ timeMs: ms, text: segment });
    previous = ms;
  }
  return words;
}
function encodeLine(line: LyricsLine): string {
  const text =
    line.words.length === 0
      ? line.text
      : line.words.map((word) => `<${formatTime(word.timeMs)}>${word.text}`).join("");
  return `[${formatTime(line.timeMs)}]${text}`;
}
function encode(document: Lyrics): string {
  if (document.kind === "plain") return document.text;
  const output = document.metadata.map((tag) => `[${tag.key}:${tag.value}]`);
  if (document.offsetMs !== 0 || (output.length === 0 && document.lines.length === 0)) {
    output.push(`[offset:${document.offsetMs}]`);
  }
  for (const line of document.lines) output.push(encodeLine(line));
  return output.join("\n");
}
function finish(document: Lyrics): Lyrics {
  // Expanded repetitions and canonical precision must obey the same input bounds.
  boundedLines(encode(document));
  for (const tag of document.metadata) Object.freeze(tag);
  for (const line of document.lines) {
    for (const word of line.words) Object.freeze(word);
    Object.freeze(line.words);
    Object.freeze(line);
  }
  Object.freeze(document.metadata);
  Object.freeze(document.lines);
  Object.freeze(document);
  documents.add(document);
  return document;
}
function known(document: Lyrics): void {
  if (!documents.has(document)) throw new LyricsError("invalid-document");
}

/** Strict LRC subset, with plain fallback only when no LRC-shaped syntax exists. */
export function parseLrc(source: string): Lyrics {
  if (typeof source !== "string") throw new LyricsError("invalid-input");
  if (source.length > LYRICS_LIMITS.maxCodeUnits) throw new LyricsError("limit-exceeded");
  if (
    !source.isWellFormed() ||
    /[\p{Zl}\p{Zp}]/u.test(source) ||
    /\p{Cc}/u.test(source.replace(/[\t\r\n]/gu, ""))
  ) {
    throw new LyricsError("invalid-input");
  }
  const text = source.replace(/^\uFEFF/u, "").replace(/\r\n|\r/gu, "\n");
  const input = boundedLines(text);
  if (!lrcSyntax.test(text)) {
    return finish({ kind: "plain", metadata: [], offsetMs: 0, lines: [], text });
  }
  const metadata: LyricsTag[] = [];
  const lines: LyricsLine[] = [];
  let offsetMs = 0;
  let seenOffset = false;
  let expandedCodeUnits = 0;
  for (const line of input) {
    if (line.trim() === "") continue;
    const tag = /^\[([a-z][\w-]*):([^[\]]*)\]$/iu.exec(line);
    if (tag) {
      const key = tag[1] as string;
      const value = tag[2] as string;
      if (key.toLowerCase() === "offset") {
        if (
          seenOffset ||
          !/^[+-]?\d+$/u.test(value.trim()) ||
          Math.abs(Number(value)) > LYRICS_LIMITS.maxTimeMs
        ) {
          throw new LyricsError("invalid-offset");
        }
        offsetMs = Number(value) || 0;
        seenOffset = true;
      } else {
        metadata.push({ key, value });
      }
      continue;
    }
    const timestamps: number[] = [];
    let cursor = 0;
    while (/^\[\d/u.test(line.slice(cursor))) {
      const end = line.indexOf("]", cursor);
      if (end < 0) throw new LyricsError("invalid-timestamp");
      timestamps.push(time(line.slice(cursor + 1, end)));
      cursor = end + 1;
    }
    if (timestamps.length === 0) throw new LyricsError("invalid-lrc");
    const first = timestamps[0] as number;
    const lyric = line.slice(cursor);
    const words = wordSegments(lyric, first);
    for (const ms of timestamps) {
      const shifted = words.map((word) => {
        const timeMs = word.timeMs + ms - first;
        if (timeMs > LYRICS_LIMITS.maxTimeMs) throw new LyricsError("invalid-timestamp");
        return { timeMs, text: word.text };
      });
      const cue: LyricsLine = {
        timeMs: ms,
        text: words.length === 0 ? lyric : words.map((word) => word.text).join(""),
        words: shifted,
      };
      expandedCodeUnits += encodeLine(cue).length;
      lines.push(cue);
      if (
        lines.length > LYRICS_LIMITS.maxLines ||
        expandedCodeUnits + lines.length - 1 > LYRICS_LIMITS.maxCodeUnits
      )
        throw new LyricsError("limit-exceeded");
    }
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return finish({
    kind: "lrc",
    metadata,
    offsetMs,
    lines,
    text: lines.map((line) => line.text).join("\n"),
  });
}

/** Canonical millisecond LRC (one timestamp per line), or normalised plain text. */
export function serialiseLrc(document: Lyrics): string {
  known(document);
  return encode(document);
}

/** O(log n), last equal timestamp wins. Positions are finite nonnegative milliseconds. */
export function currentLineAt(document: Lyrics, positionMs: number): LyricsLine | null {
  known(document);
  if (!Number.isFinite(positionMs) || positionMs < 0) throw new LyricsError("invalid-position");
  const target = positionMs + document.offsetMs;
  let low = 0;
  let high = document.lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((document.lines[middle] as LyricsLine).timeMs <= target) low = middle + 1;
    else high = middle;
  }
  return document.lines[low - 1] ?? null;
}
